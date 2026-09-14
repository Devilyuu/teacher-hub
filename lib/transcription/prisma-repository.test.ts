import { describe, expect, it, vi } from "vitest";
import { createPrismaTranscriptionRepository } from "./prisma-repository";

describe("Prisma transcription repository", () => {
  it("serializes quota reservation and counts every undeleted recording", async () => {
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      meetingRecording: {
        aggregate: vi.fn(async () => ({ _sum: { bytes: 90 } })),
        create: vi.fn(async () => ({ id: "recording-1", claimedAt: new Date("2026-08-03T00:00:01Z") })),
      },
    };
    const client = { $transaction: vi.fn(async (fn) => fn(tx)) };
    const repository = createPrismaTranscriptionRepository(client as never);
    await expect(repository.reserve("meeting-1", {
      source: "UPLOAD",
      originalName: "meeting.wav",
      mimeType: "audio/wav",
      bytes: 10,
      storagePath: "recording-safe/audio.wav",
      cloudConsentAt: new Date("2026-08-03T00:00:00Z"),
      quotaBytes: 100,
    })).resolves.toEqual({ id: "recording-1", claimedAt: new Date("2026-08-03T00:00:01Z") });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.meetingRecording.aggregate).toHaveBeenCalledWith({
      where: { status: { not: "AUDIO_DELETED" } },
      _sum: { bytes: true },
    });
    expect(tx.meetingRecording.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        meetingId: "meeting-1",
        status: "UPLOADING",
        bytes: 10,
        storagePath: "recording-safe/audio.wav",
        claimedAt: expect.any(Date),
      }),
    }));
  });

  it("rejects quota overflow before creating a reservation", async () => {
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      meetingRecording: {
        aggregate: vi.fn(async () => ({ _sum: { bytes: 91 } })),
        create: vi.fn(),
      },
    };
    const repository = createPrismaTranscriptionRepository({ $transaction: (fn: (value: unknown) => unknown) => fn(tx) } as never);
    await expect(repository.reserve("meeting-1", {
      source: "UPLOAD", originalName: "meeting.wav", mimeType: "audio/wav", bytes: 10, storagePath: "recording-safe/audio.wav", cloudConsentAt: new Date(), quotaBytes: 100,
    })).rejects.toThrow(/先确认或删除既有录音/);
    expect(tx.meetingRecording.create).not.toHaveBeenCalled();
  });

  it("claims with status, lease, consent, and fencing conditions in one SQL statement", async () => {
    const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain('r."status" IN (\'UPLOADED\', \'FAILED\')');
      expect(sql).toContain('r."claimedAt" IS NULL');
      expect(sql).toContain('m."transcriptionEnabled" = true');
      expect(sql).toContain('r."cloudConsentAt" IS NOT NULL');
      expect(sql).toContain('"attempts" = r."attempts" + 1');
      return [{ ...{
        id: "recording-1", claimedAt: new Date(), bytes: 1, storagePath: "recording-x/a.wav",
        mimeType: "audio/wav", originalName: "a.wav",
      } }];
    });
    const repository = createPrismaTranscriptionRepository({ $queryRaw: queryRaw } as never);
    await expect(repository.claim("recording-1", new Date(), 30)).resolves.toMatchObject({ id: "recording-1" });
  });

  it("uses claimedAt as a fencing token for success and failure writes", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const repository = createPrismaTranscriptionRepository({ meetingRecording: { updateMany } } as never);
    const claim = new Date("2026-08-03T04:00:00Z");
    await expect(repository.complete("recording-1", claim, {
      provider: "fake", providerTaskId: "request", transcript: "text", transcriptSegments: [],
      durationSec: 1, expiresAt: new Date(), claimedAt: null,
    })).rejects.toThrow(/租约已失效/);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "recording-1", status: "TRANSCRIBING", claimedAt: claim },
    }));
  });

  it("does not schedule local-only recordings for cloud maintenance", async () => {
    const findMany = vi.fn(async () => []);
    const repository = createPrismaTranscriptionRepository({ meetingRecording: { findMany } } as never);
    await repository.listStaleUploaded(new Date());
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cloudConsentAt: { not: null } }),
    }));
  });

  it("claims only stale uploads with a fresh cleanup fencing token", async () => {
    const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain('r."status" = \'UPLOADING\'');
      expect(sql).toContain('r."claimedAt" <=');
      expect(sql).toContain("FOR UPDATE SKIP LOCKED");
      expect(sql).toContain('"errorCode" = \'UPLOAD_CLEANUP_PENDING\'');
      return [{ id: "recording-1", storagePath: "recording-safe/audio.wav", claimedAt: new Date() }];
    });
    const repository = createPrismaTranscriptionRepository({ $queryRaw: queryRaw } as never);
    await expect(repository.claimStaleUploads(new Date(), 30)).resolves.toHaveLength(1);
  });

  it("deletes or marks upload cleanup failure only through the cleanup fence", async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = createPrismaTranscriptionRepository({ meetingRecording: { deleteMany, updateMany } } as never);
    const fence = new Date("2026-08-03T04:00:00Z");
    await repository.completeUploadCleanup("recording-1", fence);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "recording-1", status: "UPLOADING", claimedAt: fence } });
    await repository.failUploadCleanup("recording-1", fence);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "recording-1", status: "UPLOADING", claimedAt: fence },
      data: expect.objectContaining({ errorCode: "UPLOAD_CLEANUP_FAILED" }),
    }));
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain("recording-safe/audio.wav");
  });
});
