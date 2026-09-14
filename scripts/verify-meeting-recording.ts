import "dotenv/config";
import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { prisma } from "../lib/db";
import { confirmRecordingMinutes } from "../lib/minutes/service";
import { getMinutesHomeQueue } from "../lib/minutes/home";
import { removeRecordingAudio, runMinutesCleanupMaintenance } from "../lib/minutes/cleanup";
import { createPrismaMinutesRepository } from "../lib/minutes/prisma-repository";
import { AUTOMATIC_MINUTES_BEGIN, AUTOMATIC_MINUTES_END } from "../lib/minutes/formal";
import { withStableCandidateIds } from "../lib/minutes/schema";
import {
  addMeetingResolution,
  convertMeetingResolutionToTask,
  removeMeetingResolution,
  saveMeetingMinutes,
} from "../lib/meeting-mutations";
import { resolutionEntries, resolutionSnapshot, type Resolution } from "../lib/meetings";
import { createPrismaTranscriptionRepository } from "../lib/transcription/prisma-repository";
import { createRecordingStoragePath, removeRecordingFile, writeRecordingFile } from "../lib/transcription/storage";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = crypto.randomUUID();
  const meetingId = `verify-recording-meeting-${suffix}`;
  const disabledMeetingId = `verify-recording-disabled-${suffix}`;
  const ids: string[] = [];
  const storageRoot = resolve(tmpdir(), `teacher-desk-recording-verify-${suffix}`);
  const repository = createPrismaTranscriptionRepository(prisma);
  const minutesRepository = createPrismaMinutesRepository(prisma);
  const now = new Date();
  const old = new Date(now.getTime() - 60 * 60_000);
  const result = {
    quotaRejected: false,
    secondClaimRejected: false,
    staleWriteRejected: false,
    leaseRecovered: false,
    disabledClaimRejected: false,
    constraintRejected: false,
    staleUploadClaimed: false,
    concurrentFinalizeRejected: false,
    cleanupFailureRetained: false,
    cleanupRetryDeleted: false,
    partialFileRemoved: false,
    minutesConcurrentIdempotent: false,
    multiRecordingSequentialPreserved: false,
    multiRecordingConcurrentPreserved: false,
    keptManualMinutes: false,
    keptManualResolution: false,
    interleavedMeetingWritesSafe: false,
    crlfMinutesSafe: false,
    staleResolutionConflictSafe: false,
    notePreserved: false,
    atomicDraftConfirmed: false,
    minutesRollbackVerified: false,
    confirmationSurvivedDeleteFailure: false,
    daySixReminderFound: false,
    daySevenAudioDeleted: false,
    deletePendingRetried: false,
    failedAsrRetained: false,
    confirmedAfterAudioDeleted: false,
    homePriorityBeyondEight: false,
    minutesFilesCleaned: false,
  };
  const triggerSuffix = suffix.replaceAll("-", "");
  const triggerName = `verify_minutes_trigger_${triggerSuffix}`;
  const functionName = `verify_minutes_fail_${triggerSuffix}`;
  let rollbackTriggerCreated = false;

  try {
    await prisma.meeting.createMany({ data: [
      { id: meetingId, title: "录音真实库验证", meetingTime: now, transcriptionEnabled: true },
      { id: disabledMeetingId, title: "关闭转写验证", meetingTime: now, transcriptionEnabled: false },
    ] });

    const usage = await prisma.meetingRecording.aggregate({
      where: { status: { not: "AUDIO_DELETED" } },
      _sum: { bytes: true },
    });
    const quotaBytes = (usage._sum.bytes ?? 0) + 100;
    const reserved = await repository.reserve(meetingId, {
      source: "UPLOAD",
      originalName: "claim.wav",
      mimeType: "audio/wav",
      bytes: 50,
      storagePath: `recording-${suffix}/${suffix}.wav`,
      cloudConsentAt: now,
      quotaBytes,
    });
    ids.push(reserved.id);
    await repository.finalize(reserved.id, reserved.claimedAt, { durationSec: 10 });
    try {
      await repository.reserve(meetingId, {
        source: "UPLOAD",
        originalName: "quota.wav",
        mimeType: "audio/wav",
        bytes: 51,
        storagePath: createRecordingStoragePath("quota.wav"),
        cloudConsentAt: now,
        quotaBytes,
      });
    } catch {
      result.quotaRejected = true;
    }

    const cleanupStoragePath = createRecordingStoragePath("partial.wav");
    const partial = await writeRecordingFile(
      new File([Buffer.from("partial-upload")], "partial.wav", { type: "audio/wav" }),
      cleanupStoragePath,
      storageRoot,
    );
    const cleanup = await repository.reserve(meetingId, {
      source: "UPLOAD",
      originalName: "partial.wav",
      mimeType: "audio/wav",
      bytes: 10,
      storagePath: cleanupStoragePath,
      cloudConsentAt: now,
      quotaBytes,
    });
    ids.push(cleanup.id);
    await prisma.meetingRecording.update({ where: { id: cleanup.id }, data: { claimedAt: old } });
    const cleanupClaim = (await repository.claimStaleUploads(now, 30)).find((row) => row.id === cleanup.id);
    assert(cleanupClaim, "过期 UPLOADING 没有被清理任务认领");
    result.staleUploadClaimed = true;
    try {
      await repository.finalize(cleanup.id, cleanup.claimedAt, { durationSec: 1 });
    } catch {
      result.concurrentFinalizeRejected = true;
    }
    await repository.failUploadCleanup(cleanup.id, cleanupClaim.claimedAt);
    const retained = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: cleanup.id } });
    result.cleanupFailureRetained = retained.errorCode === "UPLOAD_CLEANUP_FAILED";
    await prisma.meetingRecording.update({ where: { id: cleanup.id }, data: { claimedAt: old } });
    const retryClaim = (await repository.claimStaleUploads(now, 30)).find((row) => row.id === cleanup.id);
    assert(retryClaim, "失败的上传清理没有在租约过期后重试");
    await removeRecordingFile(retryClaim.storagePath, storageRoot);
    await repository.completeUploadCleanup(cleanup.id, retryClaim.claimedAt);
    result.cleanupRetryDeleted = await prisma.meetingRecording.findUnique({ where: { id: cleanup.id } }) === null;
    try {
      await access(partial.absolutePath);
    } catch {
      result.partialFileRemoved = true;
    }

    const claim = await repository.claim(reserved.id, now, 30);
    assert(claim, "首个转写租约没有成功认领");
    result.secondClaimRejected = (await repository.claim(reserved.id, now, 30)) === null;
    try {
      await repository.complete(reserved.id, new Date(now.getTime() - 1), {
        provider: "fake",
        providerTaskId: "stale",
        transcript: "stale",
        transcriptSegments: [],
        durationSec: 10,
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
        claimedAt: null,
      });
    } catch {
      result.staleWriteRejected = true;
    }
    await repository.complete(reserved.id, claim.claimedAt, {
      provider: "fake",
      providerTaskId: `request-${suffix}`,
      transcript: "verified",
      transcriptSegments: [],
      durationSec: 10,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      claimedAt: null,
    });
    const completed = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: reserved.id } });
    assert(completed.providerTaskId === `request-${suffix}`, "request_id 未写入 providerTaskId");
    assert(completed.attempts === 1, "认领没有原子递增 attempts");

    const lease = await prisma.meetingRecording.create({ data: {
      meetingId,
      source: "UPLOAD",
      status: "TRANSCRIBING",
      originalName: "lease.wav",
      mimeType: "audio/wav",
      bytes: 10,
      durationSec: 1,
      storagePath: `${suffix}/lease.wav`,
      cloudConsentAt: now,
      claimedAt: old,
    } });
    ids.push(lease.id);
    result.leaseRecovered = await repository.recoverExpired(now, 30) === 1;

    const disabled = await prisma.meetingRecording.create({ data: {
      meetingId: disabledMeetingId,
      source: "UPLOAD",
      status: "UPLOADED",
      originalName: "disabled.wav",
      mimeType: "audio/wav",
      bytes: 10,
      durationSec: 1,
      storagePath: `${suffix}/disabled.wav`,
      cloudConsentAt: now,
      createdAt: old,
    } });
    ids.push(disabled.id);
    result.disabledClaimRejected = (await repository.claim(disabled.id, now, 30)) === null;

    const stale = await prisma.meetingRecording.create({ data: {
      meetingId,
      source: "UPLOAD",
      status: "UPLOADED",
      originalName: "stale.wav",
      mimeType: "audio/wav",
      bytes: 10,
      durationSec: 1,
      storagePath: `${suffix}/stale.wav`,
      cloudConsentAt: now,
      createdAt: old,
    } });
    ids.push(stale.id);
    const staleIds = await repository.listStaleUploaded(now);
    assert(staleIds.includes(stale.id), "维护任务没有发现滞留录音");
    assert(!staleIds.includes(disabled.id), "关闭转写的会议进入了维护队列");

    try {
      await prisma.meetingRecording.create({ data: {
        meetingId,
        source: "UPLOAD",
        originalName: "too-large.wav",
        mimeType: "audio/wav",
        bytes: 104_857_601,
      } });
    } catch {
      result.constraintRejected = true;
    }

    const makeDraft = (taskTitle: string) => withStableCandidateIds({
      summary: "确认交付安排",
      discussion: "讨论上线风险",
      resolutions: [{ text: "先完成内测", assignee: "我", dueDate: null }],
      tasks: [
        { title: taskTitle, assignee: "我", dueDate: "2026-08-06", selected: true },
        { title: `${taskTitle}-不选择`, assignee: "我", dueDate: null, selected: false },
      ],
      openIssues: [{ text: "是否扩大试点" }],
    });
    const createTranscribedFixture = async (
      label: string,
      expiresAt: Date,
      taskTitle: string,
    ) => {
      const storagePath = createRecordingStoragePath(`${label}.wav`);
      const written = await writeRecordingFile(
        new File([Buffer.from(`audio-${label}`)], `${label}.wav`, { type: "audio/wav" }),
        storagePath,
        storageRoot,
      );
      const recording = await prisma.meetingRecording.create({ data: {
        meetingId,
        source: "UPLOAD",
        status: "TRANSCRIBED",
        originalName: `${label}.wav`,
        mimeType: "audio/wav",
        bytes: 11,
        durationSec: 1,
        storagePath,
        transcript: `转写-${label}`,
        transcriptSegments: [{ text: `转写-${label}`, startMs: 0, endMs: 1000, speakerId: 0 }],
        expiresAt,
      } });
      ids.push(recording.id);
      assert(await minutesRepository.saveDraft(recording.id, makeDraft(taskTitle)), "纪要草稿未写入");
      return { recording, absolutePath: written.absolutePath };
    };

    const manualMinutes = `会前手工纪要-${suffix}`;
    const manualResolutionText = `会前手工决议-${suffix}`;
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        minutes: manualMinutes,
        resolutions: [{
          text: manualResolutionText,
          assignee: "我",
          dueDate: null,
          convertedTaskId: null,
          note: "必须跨自动聚合原样保留",
        }],
      },
    });

    const concurrentTitle = `并发确认-${suffix}`;
    const concurrent = await createTranscribedFixture(
      "concurrent-confirm",
      new Date(now.getTime() + 7 * 86_400_000),
      concurrentTitle,
    );
    const concurrentDraft = makeDraft(concurrentTitle);
    const concurrentResults = await Promise.all([
      minutesRepository.confirm(concurrent.recording.id, concurrentDraft, now),
      minutesRepository.confirm(concurrent.recording.id, concurrentDraft, now),
    ]);
    const concurrentTasks = await prisma.task.findMany({ where: { title: concurrentTitle } });
    const concurrentRow = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: concurrent.recording.id } });
    result.minutesConcurrentIdempotent = concurrentResults.filter((item) => item.alreadyConfirmed).length === 1
      && concurrentTasks.length === 1
      && concurrentRow.confirmedAt !== null;

    const makeSegmentDraft = (label: string, taskTitle: string) => withStableCandidateIds({
      summary: `${label}摘要`,
      discussion: `${label}讨论`,
      resolutions: [{ text: `${label}决议`, assignee: "我", dueDate: null }],
      tasks: [{ title: taskTitle, assignee: "我", dueDate: null, selected: true }],
      openIssues: [{ text: `${label}未决问题` }],
    });
    const sequentialOne = await createTranscribedFixture(
      "sequential-one",
      new Date(now.getTime() + 7 * 86_400_000),
      `数据库旧草稿一-${suffix}`,
    );
    const sequentialTwo = await createTranscribedFixture(
      "sequential-two",
      new Date(now.getTime() + 7 * 86_400_000),
      `数据库旧草稿二-${suffix}`,
    );
    const sequentialDraftOne = makeSegmentDraft("顺序分段一", `顺序分段任务一-${suffix}`);
    const sequentialDraftTwo = makeSegmentDraft("顺序分段二", `顺序分段任务二-${suffix}`);
    await minutesRepository.confirm(sequentialOne.recording.id, sequentialDraftOne, now);
    const atomicRow = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: sequentialOne.recording.id } });
    result.atomicDraftConfirmed = atomicRow.draftSummary === sequentialDraftOne.summary
      && atomicRow.draftDiscussion === sequentialDraftOne.discussion
      && atomicRow.draftSummary !== "确认交付安排";
    await minutesRepository.confirm(sequentialTwo.recording.id, sequentialDraftTwo, now);
    const sequentialMeeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    const sequentialResolutions = Array.isArray(sequentialMeeting.resolutions) ? sequentialMeeting.resolutions : [];
    result.multiRecordingSequentialPreserved = sequentialMeeting.minutes?.includes("顺序分段一摘要") === true
      && sequentialMeeting.minutes.includes("顺序分段二摘要")
      && sequentialMeeting.minutes.includes(sequentialOne.recording.id)
      && sequentialMeeting.minutes.includes(sequentialTwo.recording.id)
      && sequentialResolutions.some((item) => typeof item === "object" && item !== null
        && "recordingId" in item && item.recordingId === sequentialOne.recording.id)
      && sequentialResolutions.some((item) => typeof item === "object" && item !== null
        && "recordingId" in item && item.recordingId === sequentialTwo.recording.id);

    const manualMinutesAppend = `会后手工补充-${suffix}`;
    const latestSequentialMinutes = sequentialMeeting.minutes ?? "";
    assert(
      await saveMeetingMinutes(
        prisma,
        meetingId,
        latestSequentialMinutes,
        `${latestSequentialMinutes}\n\n${manualMinutesAppend}`,
      ) === "saved",
      "最新纪要的显式编辑没有保存",
    );

    const parallelOne = await createTranscribedFixture(
      "parallel-one",
      new Date(now.getTime() + 7 * 86_400_000),
      `数据库旧并发草稿一-${suffix}`,
    );
    const parallelTwo = await createTranscribedFixture(
      "parallel-two",
      new Date(now.getTime() + 7 * 86_400_000),
      `数据库旧并发草稿二-${suffix}`,
    );
    const parallelDraftOne = makeSegmentDraft("并发分段一", `并发分段任务一-${suffix}`);
    const parallelDraftTwo = makeSegmentDraft("并发分段二", `并发分段任务二-${suffix}`);
    await Promise.all([
      minutesRepository.confirm(parallelOne.recording.id, parallelDraftOne, now),
      minutesRepository.confirm(parallelTwo.recording.id, parallelDraftTwo, now),
    ]);
    const parallelMeeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    const parallelTaskCount = await prisma.task.count({
      where: { title: { in: [parallelDraftOne.tasks[0]!.title, parallelDraftTwo.tasks[0]!.title] } },
    });
    result.multiRecordingConcurrentPreserved = parallelMeeting.minutes?.includes("并发分段一摘要") === true
      && parallelMeeting.minutes.includes("并发分段二摘要")
      && parallelMeeting.minutes.includes("顺序分段一摘要")
      && parallelTaskCount === 2;
    const parallelResolutions = Array.isArray(parallelMeeting.resolutions) ? parallelMeeting.resolutions : [];
    result.keptManualMinutes = parallelMeeting.minutes?.includes(manualMinutes) === true
      && parallelMeeting.minutes.includes(manualMinutesAppend);
    result.keptManualResolution = parallelResolutions.some((item) => typeof item === "object" && item !== null
      && "text" in item && item.text === manualResolutionText
      && "note" in item && item.note === "必须跨自动聚合原样保留");

    const isIdentifiedAutomatic = (item: unknown) => typeof item === "object" && item !== null
      && "recordingId" in item && typeof item.recordingId === "string"
      && "candidateId" in item && typeof item.candidateId === "string";
    const manualBeforeInterleave = parallelResolutions.filter((item) => !isIdentifiedAutomatic(item));
    const automaticBeforeInterleave = parallelResolutions.filter(isIdentifiedAutomatic);
    const convertResolutionText = `并发转任务决议-${suffix}`;
    const removeResolutionText = `并发删除决议-${suffix}`;
    const addResolutionText = `并发新增决议-${suffix}`;
    const convertResolution: Resolution = {
      text: convertResolutionText,
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
    };
    const removeResolution: Resolution = {
      text: removeResolutionText,
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
    };
    const convertExpected = resolutionSnapshot(convertResolution);
    const removeExpected = resolutionSnapshot(removeResolution);
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { resolutions: [
        "保留的无效决议元素",
        ...manualBeforeInterleave,
        { ...convertResolution, note: "并发转任务备注必须保留" },
        removeResolution,
        { malformed: true },
        ...automaticBeforeInterleave,
      ] },
    });
    const convertIndex = manualBeforeInterleave.length;
    const removeIndex = convertIndex + 1;
    const beforeInterleave = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    const interleaveMinutesOriginal = beforeInterleave.minutes ?? "";
    const interleaveMinutesEdit = `并发保存手工纪要-${suffix}`;
    const interleave = await createTranscribedFixture(
      "interleaved-writes",
      new Date(now.getTime() + 7 * 86_400_000),
      `并发写入任务-${suffix}`,
    );
    const interleaveDraft = makeSegmentDraft("并发写入分段", `并发写入任务-${suffix}`);
    const [confirmInterleave, convertInterleave, removeInterleave, addInterleave, saveInterleave] = await Promise.all([
      minutesRepository.confirm(interleave.recording.id, interleaveDraft, now),
      convertMeetingResolutionToTask(prisma, meetingId, convertIndex, convertExpected),
      removeMeetingResolution(prisma, meetingId, removeIndex, removeExpected),
      addMeetingResolution(prisma, meetingId, {
        text: addResolutionText,
        assignee: "我",
        dueDate: null,
        convertedTaskId: null,
      }),
      saveMeetingMinutes(
        prisma,
        meetingId,
        interleaveMinutesOriginal,
        `${interleaveMinutesOriginal}\n\n${interleaveMinutesEdit}`,
      ),
    ]);
    const afterInterleave = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    const afterInterleaveResolutions = Array.isArray(afterInterleave.resolutions) ? afterInterleave.resolutions : [];
    const convertedInterleave = afterInterleaveResolutions.find((item) => typeof item === "object" && item !== null
      && "text" in item && item.text === convertResolutionText);
    const repeatedConversion = await convertMeetingResolutionToTask(prisma, meetingId, convertIndex, convertExpected);
    const convertedTaskCount = await prisma.task.count({ where: { title: convertResolutionText } });
    result.interleavedMeetingWritesSafe = !confirmInterleave.alreadyConfirmed
      && convertInterleave.status === "converted"
      && removeInterleave === "removed"
      && addInterleave === "added"
      && (saveInterleave === "conflict"
        || (saveInterleave === "saved" && afterInterleave.minutes?.includes(interleaveMinutesEdit) === true))
      && afterInterleave.minutes?.includes("并发写入分段摘要") === true
      && afterInterleave.minutes.includes(manualMinutes)
      && afterInterleave.minutes.includes(manualMinutesAppend)
      && afterInterleaveResolutions.some((item) => typeof item === "object" && item !== null
        && "text" in item && item.text === addResolutionText)
      && !afterInterleaveResolutions.some((item) => typeof item === "object" && item !== null
        && "text" in item && item.text === removeResolutionText)
      && typeof convertedInterleave === "object" && convertedInterleave !== null
      && "convertedTaskId" in convertedInterleave && typeof convertedInterleave.convertedTaskId === "string"
      && repeatedConversion.status === "already-converted"
      && convertedTaskCount === 1;
    result.notePreserved = typeof convertedInterleave === "object" && convertedInterleave !== null
      && "note" in convertedInterleave && convertedInterleave.note === "并发转任务备注必须保留"
      && afterInterleaveResolutions.includes("保留的无效决议元素")
      && afterInterleaveResolutions.some((item) => typeof item === "object" && item !== null
        && "malformed" in item && item.malformed === true);

    const crlfOriginal = afterInterleave.minutes ?? "";
    const crlfRoundtrip = crlfOriginal.replaceAll("\n", "\r\n");
    const crlfManualAppend = `CRLF 手工补充-${suffix}`;
    const crlfSave = await saveMeetingMinutes(
      prisma,
      meetingId,
      crlfRoundtrip,
      `${crlfRoundtrip}\r\n\r\n${crlfManualAppend}`,
    );
    const crlfRecording = await createTranscribedFixture(
      "crlf-roundtrip",
      new Date(now.getTime() + 7 * 86_400_000),
      `CRLF 任务-${suffix}`,
    );
    await minutesRepository.confirm(
      crlfRecording.recording.id,
      makeSegmentDraft("CRLF 分段", `CRLF 任务-${suffix}`),
      now,
    );
    const afterCrlf = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    const crlfMinutes = afterCrlf.minutes ?? "";
    result.crlfMinutesSafe = crlfSave === "saved"
      && crlfMinutes.includes(crlfManualAppend)
      && crlfMinutes.includes("CRLF 分段摘要")
      && crlfMinutes.split(AUTOMATIC_MINUTES_BEGIN).length - 1 === 1
      && crlfMinutes.split(AUTOMATIC_MINUTES_END).length - 1 === 1;

    const staleBase = Array.isArray(afterCrlf.resolutions) ? afterCrlf.resolutions : [];
    const staleB: Resolution = {
      text: `旧页决议 B-${suffix}`,
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
    };
    const staleC: Resolution = {
      text: `下标漂移决议 C-${suffix}`,
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
    };
    const staleDisplayIndex = resolutionEntries(staleBase).length;
    const staleExpectedB = resolutionSnapshot(staleB);
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { resolutions: [...staleBase, staleB, staleC] },
    });
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { resolutions: [...staleBase, staleC] },
    });
    const staleConvert = await convertMeetingResolutionToTask(
      prisma,
      meetingId,
      staleDisplayIndex,
      staleExpectedB,
    );
    const staleCTasks = await prisma.task.count({ where: { title: staleC.text } });
    result.staleResolutionConflictSafe = staleConvert.status === "conflict" && staleCTasks === 0;

    const deleteFailure = await createTranscribedFixture(
      "delete-failure",
      new Date(now.getTime() + 7 * 86_400_000),
      `删除失败确认-${suffix}`,
    );
    const deleteFailureDraft = makeDraft(`删除失败确认-${suffix}`);
    const deleteFailureResult = await confirmRecordingMinutes(deleteFailure.recording.id, deleteFailureDraft, {
      repository: minutesRepository,
      now: () => now,
      removeAudio: (id) => removeRecordingAudio(id, {
        repository: minutesRepository,
        now: () => now,
        remove: async () => { throw new Error("private path must not escape"); },
      }),
    });
    const deleteFailureRow = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: deleteFailure.recording.id } });
    result.confirmationSurvivedDeleteFailure = deleteFailureResult.audio === "pending"
      && deleteFailureRow.confirmedAt !== null
      && deleteFailureRow.status === "DELETE_PENDING"
      && deleteFailureRow.errorCode === "AUDIO_DELETE_FAILED";
    await prisma.meetingRecording.update({ where: { id: deleteFailure.recording.id }, data: { claimedAt: old } });
    await runMinutesCleanupMaintenance({
      repository: minutesRepository,
      now: () => now,
      remove: (storagePath) => removeRecordingFile(storagePath, storageRoot),
    });
    const retried = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: deleteFailure.recording.id } });
    result.deletePendingRetried = retried.status === "AUDIO_DELETED" && retried.audioDeletedAt !== null;

    const daySeven = await createTranscribedFixture(
      "day-seven",
      new Date(now.getTime() - 1),
      `第七天-${suffix}`,
    );
    const failedStoragePath = createRecordingStoragePath("failed-asr.wav");
    const failedWritten = await writeRecordingFile(
      new File([Buffer.from("failed-asr")], "failed-asr.wav", { type: "audio/wav" }),
      failedStoragePath,
      storageRoot,
    );
    const failedAsr = await prisma.meetingRecording.create({ data: {
      meetingId,
      source: "UPLOAD",
      status: "FAILED",
      originalName: "failed-asr.wav",
      mimeType: "audio/wav",
      bytes: 10,
      durationSec: 1,
      storagePath: failedStoragePath,
      transcript: null,
      expiresAt: null,
      errorCode: "TRANSCRIPTION_FAILED",
      errorNote: "转写失败，请稍后重试",
    } });
    ids.push(failedAsr.id);
    await runMinutesCleanupMaintenance({
      repository: minutesRepository,
      now: () => now,
      remove: (storagePath) => removeRecordingFile(storagePath, storageRoot),
    });
    const daySevenRow = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: daySeven.recording.id } });
    result.daySevenAudioDeleted = daySevenRow.status === "AUDIO_DELETED"
      && daySevenRow.audioDeletedAt !== null
      && daySevenRow.transcript === "转写-day-seven"
      && daySevenRow.draftSummary === "确认交付安排";
    await access(failedWritten.absolutePath);
    const failedAsrRow = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: failedAsr.id } });
    result.failedAsrRetained = failedAsrRow.status === "FAILED" && failedAsrRow.audioDeletedAt === null;

    const daySix = await createTranscribedFixture(
      "day-six",
      new Date(now.getTime() + 12 * 60 * 60_000),
      `第六天-${suffix}`,
    );
    const homeQueue = await getMinutesHomeQueue(now, prisma);
    result.daySixReminderFound = homeQueue.items.some((item) => item.id === daySix.recording.id && item.daySixReminder);

    const deleteBeforeConfirm = await createTranscribedFixture(
      "delete-before-confirm",
      new Date(now.getTime() + 7 * 86_400_000),
      `先删后确认-${suffix}`,
    );
    await removeRecordingAudio(deleteBeforeConfirm.recording.id, {
      repository: minutesRepository,
      now: () => now,
      remove: (storagePath) => removeRecordingFile(storagePath, storageRoot),
    });
    const confirmedAfterDelete = await minutesRepository.confirm(
      deleteBeforeConfirm.recording.id,
      makeDraft(`先删后确认-${suffix}`),
      now,
    );
    const confirmedAfterDeleteRow = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: deleteBeforeConfirm.recording.id } });
    result.confirmedAfterAudioDeleted = !confirmedAfterDelete.needsAudioCleanup
      && confirmedAfterDeleteRow.status === "AUDIO_DELETED"
      && confirmedAfterDeleteRow.confirmedAt !== null
      && confirmedAfterDeleteRow.draftSummary === "确认交付安排";

    for (let index = 0; index < 9; index += 1) {
      await createTranscribedFixture(
        `priority-ordinary-${index}`,
        new Date(now.getTime() + 7 * 86_400_000),
        `普通纪要-${index}-${suffix}`,
      );
    }
    const priorityDelete = await createTranscribedFixture(
      "priority-delete",
      new Date(now.getTime() + 7 * 86_400_000),
      `删除优先-${suffix}`,
    );
    await prisma.meetingRecording.update({
      where: { id: priorityDelete.recording.id },
      data: {
        status: "DELETE_PENDING",
        errorCode: "AUDIO_DELETE_FAILED",
        errorNote: "音频删除失败，已进入维护重试队列",
      },
    });
    const priorityQueue = await getMinutesHomeQueue(now, prisma);
    result.homePriorityBeyondEight = priorityQueue.total > 8
      && priorityQueue.items.length === 8
      && priorityQueue.items[0]?.id === priorityDelete.recording.id
      && priorityQueue.items.some((item) => item.id === daySix.recording.id && item.daySixReminder);

    const rollbackTitle = `FORCE_MINUTES_ROLLBACK_${triggerSuffix}`;
    const rollback = await createTranscribedFixture(
      "rollback",
      new Date(now.getTime() + 7 * 86_400_000),
      rollbackTitle,
    );
    const meetingBeforeRollback = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $body$
      BEGIN
        IF NEW."title" = '${rollbackTitle}' THEN
          RAISE EXCEPTION 'forced minutes rollback';
        END IF;
        RETURN NEW;
      END;
      $body$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "Task"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);
    rollbackTriggerCreated = true;
    const rollbackDraft = makeDraft(rollbackTitle);
    rollbackDraft.summary = "这段原子草稿必须随事务回滚";
    try {
      await minutesRepository.confirm(rollback.recording.id, rollbackDraft, now);
    } catch {
      const rollbackRow = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: rollback.recording.id } });
      const meetingAfterRollback = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
      const rollbackTasks = await prisma.task.count({ where: { title: rollbackTitle } });
      result.minutesRollbackVerified = rollbackRow.confirmedAt === null
        && rollbackTasks === 0
        && meetingAfterRollback.minutes === meetingBeforeRollback.minutes
        && rollbackRow.draftSummary === "确认交付安排";
    }

  } finally {
    if (rollbackTriggerCreated) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "Task"`).catch(() => {});
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`).catch(() => {});
    }
    await prisma.task.deleteMany({ where: { sourceMeetingId: { in: [meetingId, disabledMeetingId] } } });
    await prisma.meetingRecording.deleteMany({ where: { meetingId: { in: [meetingId, disabledMeetingId] } } });
    await prisma.meeting.deleteMany({ where: { id: { in: [meetingId, disabledMeetingId] } } });
    await rm(storageRoot, { recursive: true, force: true });
    let minutesFilesLeftBehind = 0;
    try {
      await access(storageRoot);
      minutesFilesLeftBehind = 1;
    } catch {
      result.minutesFilesCleaned = true;
    }
    assert(minutesFilesLeftBehind === 0, "纪要验证留下了临时音频目录");
  }

  assert(Object.values(result).every(Boolean), `真实库验证不完整：${JSON.stringify(result)}`);

  const rowsLeftBehind = {
    recordings: await prisma.meetingRecording.count({ where: { id: { in: ids } } }),
    meetings: await prisma.meeting.count({ where: { id: { in: [meetingId, disabledMeetingId] } } }),
    tasks: await prisma.task.count({ where: { sourceMeetingId: { in: [meetingId, disabledMeetingId] } } }),
  };
  assert(Object.values(rowsLeftBehind).every((count) => count === 0), "验证留下了临时数据");
  console.log(JSON.stringify({ ...result, rowsLeftBehind }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
