import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("minutes minimal UI contract", () => {
  test("all minutes server actions authenticate before doing work", () => {
    const source = readFileSync(resolve(root, "app/(app)/meetings/minutes-actions.ts"), "utf8");
    expect(source.startsWith('"use server"')).toBe(true);
    for (const name of [
      "initializeManualMinutesAction",
      "generateMinutesDraftAction",
      "saveMinutesDraftAction",
      "confirmMinutesAction",
      "deleteRecordingAudioAction",
    ]) {
      expect(source).toMatch(new RegExp(`export async function ${name}\\([^]*?\\{\\s*await requireSession\\(\\);`));
    }
    expect(source).toContain("result.alreadyConfirmed");
    expect(source).toContain("纪要已在其他标签页确认，请刷新查看正式记录");
  });

  test("home places pending minutes after today's task queue and before inbox", () => {
    const source = readFileSync(resolve(root, "app/(app)/page.tsx"), "utf8");
    const today = source.indexOf("<TodayQueue");
    const minutes = source.indexOf("<MinutesQueue");
    const inbox = source.indexOf("<CaptureInbox");
    expect(today).toBeGreaterThan(-1);
    expect(minutes).toBeGreaterThan(today);
    expect(inbox).toBeGreaterThan(minutes);
  });

  test("meeting recording query exposes only draft and lifecycle metadata needed by the minimal UI", () => {
    const source = readFileSync(resolve(root, "lib/queries/routines.ts"), "utf8");
    for (const field of ["draftSummary", "draftDiscussion", "draftResolutions", "draftTasks", "draftOpenIssues", "confirmedAt", "audioDeletedAt", "expiresAt", "errorCode"]) {
      expect(source).toContain(`${field}: true`);
    }
  });

  test("meeting cards expose a structured editor without a raw JSON field", () => {
    const editorPath = resolve(root, "app/(app)/meetings/[id]/minutes-editor.tsx");
    expect(existsSync(editorPath), "minutes editor component is missing").toBe(true);
    if (!existsSync(editorPath)) return;
    const editor = readFileSync(editorPath, "utf8");
    const panel = readFileSync(resolve(root, "app/(app)/meetings/[id]/recording-panel.tsx"), "utf8");
    for (const label of ["会议摘要", "主要讨论", "决议", "候选任务", "未决问题", "保存草稿", "确认纪要并创建所选任务"]) {
      expect(editor).toContain(label);
    }
    expect(editor).not.toContain("persistMinutesBeforeConfirmation");
    expect(editor).toContain("saveMinutesDraftAction");
    expect(editor).toContain('formData.set("draft", JSON.stringify(draft))');
    expect(editor).toContain("confirmMinutesAction(recordingId, meetingId, formData)");
    expect(editor).not.toContain('name="draft"');
    expect(panel).toContain("<MinutesEditor");
  });

  test("manual minutes save carries the page snapshot for optimistic conflict detection", () => {
    const detail = readFileSync(resolve(root, "app/(app)/meetings/[id]/meeting-detail.tsx"), "utf8");
    const actions = readFileSync(resolve(root, "app/(app)/meetings/actions.ts"), "utf8");
    expect(detail).toContain('name="originalMinutes"');
    expect(actions).toContain("saveMeetingMinutes");
    expect(actions).toContain("纪要已被其他操作更新，请刷新后再保存");
  });

  test("resolution actions carry the displayed resolution identity", () => {
    const detail = readFileSync(resolve(root, "app/(app)/meetings/[id]/meeting-detail.tsx"), "utf8");
    expect(detail).toContain("resolutionSnapshot(resolution)");
    expect(detail).toContain("convertResolutionToTask.bind(null, meetingId, index, expected)");
    expect(detail).toContain("removeResolution.bind(null, meetingId, index, expected)");
  });

  test("uses state-accurate queue, draft, deletion, and expiry wording", () => {
    const queue = readFileSync(resolve(root, "components/minutes-queue.tsx"), "utf8");
    const panel = readFileSync(resolve(root, "app/(app)/meetings/[id]/recording-panel.tsx"), "utf8");
    expect(queue).toContain("待处理会议记录");
    expect(panel).toContain(">整理纪要<");
    expect(panel).toContain('"重试删除"');
    expect(panel).toContain('recording.errorCode === "AUDIO_DELETE_FAILED"');
    expect(panel).toContain("正在删除原音频");
    expect(panel).toMatch(/24\s*小时内.*自动删除/);
  });

  test("manual audio deletion requires an irreversible-action acknowledgement", () => {
    const panel = readFileSync(resolve(root, "app/(app)/meetings/[id]/recording-panel.tsx"), "utf8");
    expect(panel).toContain("confirmRecordingAudioDeletion");
    expect(panel).toContain("event.preventDefault()");
  });
});
