"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import {
  addMeetingResolution,
  convertMeetingResolutionToTask,
  removeMeetingResolution,
  saveMeetingMinutes,
} from "@/lib/meeting-mutations";
import { parseAgenda, parseMeetingTime, type ResolutionSnapshot } from "@/lib/meetings";
import { meetingFormSchema, resolutionFormSchema } from "@/lib/schemas/meeting";
import { requireSession } from "@/lib/server-auth";

function revalidateMeeting(id?: string) {
  revalidatePath("/");
  revalidatePath("/meetings");
  revalidatePath("/calendar");
  if (id) revalidatePath(`/meetings/${id}`);
}

// ─── 议题池 ──────────────────────────────────────────────────────────

/**
 * 往议题池里扔一条。**开会前想到就记**，不用当场决定放进哪次会——
 * 这正是议题池存在的理由：临开会前现想想不全。
 */
export async function createAgendaItem(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { ok: false, message: "请填写议题" };

  await prisma.agendaItem.create({ data: { content } });
  revalidateMeeting();
  return { ...IDLE_FORM_STATE, ok: true, message: "已记入议题池" };
}

export async function deleteAgendaItem(id: string) {
  await requireSession();
  await prisma.agendaItem.delete({ where: { id } });
  revalidateMeeting();
}

// ─── 会议 ────────────────────────────────────────────────────────────

export async function createMeeting(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = meetingFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const meetingTime = parseMeetingTime(parsed.data.meetingTime);
  if (!meetingTime) {
    return { ok: false, message: "会议时间格式不对", fieldErrors: { meetingTime: ["请选择时间"] } };
  }

  const meeting = await prisma.meeting.create({
    data: { title: parsed.data.title, type: parsed.data.type, meetingTime },
  });
  await logActivity("Meeting", meeting.id, "新建会议", { title: meeting.title });

  revalidateMeeting(meeting.id);
  redirect(`/meetings/${meeting.id}`);
}

export async function updateMeeting(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = meetingFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const meetingTime = parseMeetingTime(parsed.data.meetingTime);
  if (!meetingTime) {
    return { ok: false, message: "会议时间格式不对", fieldErrors: { meetingTime: ["请选择时间"] } };
  }

  await prisma.meeting.update({
    where: { id },
    data: { title: parsed.data.title, type: parsed.data.type, meetingTime },
  });
  revalidateMeeting(id);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

export async function setMeetingTranscriptionEnabled(meetingId: string, formData: FormData) {
  await requireSession();
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { transcriptionEnabled: formData.get("enabled") === "on" },
  });
  revalidateMeeting(meetingId);
}

/**
 * 删会议。**派生出去的任务和议题不跟着删**——
 * 决议转成的任务是独立的待办，会议记录删了不代表那件事不用做了。
 * 议题退回池子里，下次会还能用。
 */
export async function deleteMeeting(id: string) {
  await requireSession();
  const recordingCount = await prisma.meetingRecording.count({
    where: { meetingId: id, status: { not: "AUDIO_DELETED" } },
  });
  if (recordingCount > 0) {
    throw new Error("会议仍有私有录音，音频删除能力上线前不能删除会议");
  }
  await prisma.$transaction([
    prisma.task.updateMany({ where: { sourceMeetingId: id }, data: { sourceMeetingId: null } }),
    prisma.agendaItem.updateMany({
      where: { meetingId: id },
      data: { meetingId: null, status: "PENDING" },
    }),
    prisma.meeting.delete({ where: { id } }),
  ]);
  revalidateMeeting();
  redirect("/meetings");
}

// ─── 议程 ────────────────────────────────────────────────────────────

export async function addAgendaEntry(meetingId: string, formData: FormData) {
  await requireSession();
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return;

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { agenda: [...parseAgenda(meeting.agenda), text] },
  });
  revalidateMeeting(meetingId);
}

export async function removeAgendaEntry(meetingId: string, index: number) {
  await requireSession();
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return;

  const agenda = parseAgenda(meeting.agenda);
  if (index < 0 || index >= agenda.length) return;
  agenda.splice(index, 1);

  await prisma.meeting.update({ where: { id: meetingId }, data: { agenda } });
  revalidateMeeting(meetingId);
}

/** 把议题池里的一条拉进这次会的议程 */
export async function pullAgendaItem(meetingId: string, agendaItemId: string) {
  await requireSession();
  const [meeting, item] = await Promise.all([
    prisma.meeting.findUnique({ where: { id: meetingId } }),
    prisma.agendaItem.findUnique({ where: { id: agendaItemId } }),
  ]);
  if (!meeting || !item || item.status !== "PENDING") return;

  await prisma.$transaction([
    prisma.meeting.update({
      where: { id: meetingId },
      data: { agenda: [...parseAgenda(meeting.agenda), item.content] },
    }),
    prisma.agendaItem.update({
      where: { id: agendaItemId },
      data: { status: "SCHEDULED", meetingId },
    }),
  ]);
  revalidateMeeting(meetingId);
}

// ─── 纪要与决议 ──────────────────────────────────────────────────────

export async function saveMinutes(
  meetingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const minutes = formData.get("minutes");
  const originalMinutes = formData.get("originalMinutes");
  if (typeof minutes !== "string" || typeof originalMinutes !== "string") {
    return { ok: false, message: "纪要内容不对" };
  }

  const result = await saveMeetingMinutes(prisma, meetingId, originalMinutes, minutes);
  revalidateMeeting(meetingId);
  if (result === "not-found") return { ok: false, message: "会议不存在" };
  if (result === "conflict") {
    return { ok: false, message: "纪要已被其他操作更新，请刷新后再保存" };
  }
  return { ...IDLE_FORM_STATE, ok: true, message: "纪要已保存" };
}

export async function addResolution(
  meetingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = resolutionFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const result = await addMeetingResolution(prisma, meetingId, {
    text: parsed.data.text,
    assignee: parsed.data.assignee || "我",
    dueDate: parsed.data.dueDate || null,
    convertedTaskId: null,
  });
  if (result === "not-found") return { ok: false, message: "会议不存在" };
  revalidateMeeting(meetingId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已记下决议" };
}

export async function removeResolution(meetingId: string, index: number, expected: ResolutionSnapshot) {
  await requireSession();
  await removeMeetingResolution(prisma, meetingId, index, expected);
  revalidateMeeting(meetingId);
}

/**
 * **整个会议模块的关键动作**：一条决议 → 一条任务。
 *
 * 开会定下来的事，散会就该出现在待办里，而不是躺在纪要里等人再抄一遍。
 *
 * 建任务和标记 `convertedTaskId` 必须在**同一个事务**里：
 * 中间失败会留下一条没有标记的任务，重试时就会重复创建。
 */
export async function convertResolutionToTask(meetingId: string, index: number, expected: ResolutionSnapshot) {
  await requireSession();
  await convertMeetingResolutionToTask(prisma, meetingId, index, expected);
  revalidateMeeting(meetingId);
  revalidatePath("/tasks");
}
