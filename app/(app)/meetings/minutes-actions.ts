"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { clientMinutesDraftSchema } from "@/lib/minutes/schema";
import { requireSession } from "@/lib/server-auth";
import {
  confirmMinutesWithRuntime,
  generateMinutesWithRuntime,
  initializeManualMinutesWithRuntime,
  removeRecordingAudioWithRuntime,
  saveMinutesDraftWithRuntime,
} from "@/lib/transcription/runtime";

function refreshMeeting(meetingId?: string) {
  revalidatePath("/");
  revalidatePath("/meetings");
  if (meetingId) revalidatePath(`/meetings/${meetingId}`);
}

export async function initializeManualMinutesAction(recordingId: string, meetingId: string, _formData: FormData): Promise<void> {
  await requireSession();
  try {
    await initializeManualMinutesWithRuntime(recordingId);
    refreshMeeting(meetingId);
  } catch {
    throw new Error("暂时无法建立手工草稿，请刷新后重试");
  }
}

export async function generateMinutesDraftAction(recordingId: string, meetingId: string, _formData: FormData): Promise<void> {
  await requireSession();
  try {
    await generateMinutesWithRuntime(recordingId);
    refreshMeeting(meetingId);
  } catch {
    throw new Error("纪要生成失败，可重试或手工整理");
  }
}

export async function saveMinutesDraftAction(
  recordingId: string,
  meetingId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  try {
    const raw = formData.get("draft");
    if (typeof raw !== "string") return { ok: false, tone: "error", message: "纪要草稿格式有误" };
    await saveMinutesDraftWithRuntime(recordingId, JSON.parse(raw));
    refreshMeeting(meetingId);
    return { ok: true, tone: "success", message: "纪要草稿已保存" };
  } catch {
    return { ok: false, tone: "error", message: "纪要草稿格式有误，未保存" };
  }
}

export async function confirmMinutesAction(recordingId: string, meetingId: string, formData: FormData): Promise<FormState> {
  await requireSession();
  try {
    const raw = formData.get("draft");
    if (typeof raw !== "string") return { ok: false, tone: "error", message: "纪要草稿格式有误" };
    const draft = clientMinutesDraftSchema.parse(JSON.parse(raw));
    const result = await confirmMinutesWithRuntime(recordingId, draft);
    refreshMeeting(meetingId);
    if (result.alreadyConfirmed) {
      return { ok: false, tone: "error", message: "纪要已在其他标签页确认，请刷新查看正式记录" };
    }
    return { ok: true, tone: "success", message: "纪要已确认，所选任务已创建" };
  } catch {
    return { ok: false, tone: "error", message: "纪要确认失败，未创建任何任务" };
  }
}

export async function deleteRecordingAudioAction(recordingId: string, meetingId: string, _formData: FormData): Promise<void> {
  await requireSession();
  try {
    await removeRecordingAudioWithRuntime(recordingId);
    refreshMeeting(meetingId);
  } catch {
    refreshMeeting(meetingId);
  }
}
