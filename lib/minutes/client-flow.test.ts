import { describe, expect, test, vi } from "vitest";
import {
  confirmRecordingAudioDeletion,
  createManualCandidateId,
} from "./client-flow";

describe("minutes client flow", () => {
  test("requires explicit acknowledgement before deleting audio", async () => {
    const deny = vi.fn(() => false);

    expect(confirmRecordingAudioDeletion(deny)).toBe(false);
    expect(deny).toHaveBeenCalledWith(expect.stringMatching(/删除后无法回听.*转写.*草稿.*保留/));
  });

  test("creates valid stable ids for manually added candidates", async () => {
    expect(createManualCandidateId("task", "123e4567-e89b-42d3-a456-426614174000"))
      .toMatch(/^task-[a-z0-9-]{1,80}$/);
  });
});
