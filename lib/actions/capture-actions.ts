"use server";

import { revalidatePath } from "next/cache";
import { todayAsDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  captureFormSchema,
  captureMenteeRecordSchema,
  captureSnoozeSchema,
  captureStudentRecordSchema,
} from "@/lib/schemas/capture";
import { requireSession } from "@/lib/server-auth";

/**
 * 快速记录与收件箱（二期规格 §7.1）。
 *
 * 转换一律走事务：创建正式实体和更新 CaptureItem 状态**要么同时成功，
 * 要么都不发生**。半途失败留下一条孤儿成果、而收件箱里那条还在，
 * 是最难查的一类脏数据。
 */

function revalidateCapture() {
  revalidatePath("/");
}

/** 记一条。面板提交后立刻关闭，不等页面刷新 */
export async function createCapture(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();

  const parsed = captureFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  await prisma.captureItem.create({ data: parsed.data });
  revalidateCapture();
  return { ...IDLE_FORM_STATE, ok: true, message: "记下了" };
}

/**
 * 延期到指定日期。到期后会自己浮回收件箱（见 lib/capture.ts）。
 */
export async function snoozeCapture(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = captureSnoozeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  await prisma.captureItem.update({
    where: { id },
    data: { status: "SNOOZED", snoozedUntil: parsed.data.snoozedUntil, handledAt: new Date() },
  });
  revalidateCapture();
  return { ...IDLE_FORM_STATE, ok: true, message: "已延期" };
}

/** 不要了。**不硬删**——留着才能回答「我那条随手记的哪去了」 */
export async function dismissCapture(id: string) {
  await requireSession();
  await prisma.captureItem.update({
    where: { id },
    data: { status: "DISMISSED", handledAt: new Date() },
  });
  revalidateCapture();
}

/** 误删找回 */
export async function restoreCapture(id: string) {
  await requireSession();
  await prisma.captureItem.update({
    where: { id },
    data: { status: "INBOX", snoozedUntil: null, handledAt: null },
  });
  revalidateCapture();
}

/**
 * 在事务里**认领**这条速记：只有把它从「未转」改成「已转」的那个请求才往下建实体。
 *
 * 2026-09-26 前的写法是「事务外先查 status，没转过就进事务建」，注释说「幂等靠 @unique 外键兜底」——
 * **兜不住**：@unique 管的是「一个任务不被两条速记指着」，管不了「一条速记转出两个任务」。
 * 双击或两个标签页同时点，两个请求都读到「未转」、各建一个，后写的覆盖转换指针，
 * 先建的那个成了没人指着的孤儿。认领用 updateMany 带条件：并发的第二个会被行锁挡到第一个提交后，
 * 再读到「已转」，改到 0 行就收手（同 ensureRecurringTasks 的 lastRunYmd 认领）
 */
async function claimCapture(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const claimed = await tx.captureItem.updateMany({
    where: { id, status: { not: "CONVERTED" } },
    data: { status: "CONVERTED", handledAt: new Date() },
  });
  return claimed.count === 1;
}

const ALREADY_CONVERTED: FormState = { ...IDLE_FORM_STATE, ok: true, message: "这条已经转过了" };

/**
 * 转成正式记录。
 *
 * 重复提交（手抖点两次、网络重试）时照实说「已经转过了」，不抛异常糊到用户脸上；
 * 同时并发的两次靠 `claimCapture` 保证只建一个实体。
 *
 * 转换后原记录保留转换指针，不再出现在待处理列表——
 * **不删**，因为「这条成果是哪天随手记下来的」是有用的线索。
 */
export async function convertCapture(id: string): Promise<FormState> {
  await requireSession();

  const item = await prisma.captureItem.findUnique({ where: { id } });
  if (!item) return { ok: false, message: "这条速记已经不在了" };

  // 已经转过的直接说，不必进事务；并发的那种由 claimCapture 兜住
  if (item.status === "CONVERTED") return ALREADY_CONVERTED;

  const title = item.title.trim();
  const note = item.content?.trim() || null;

  const converted = await prisma.$transaction(async (tx) => {
    if (!(await claimCapture(tx, id))) return false;

    if (item.kind === "TASK") {
      const task = await tx.task.create({ data: { title, note, source: "SELF" } });
      await tx.captureItem.update({ where: { id }, data: { convertedTaskId: task.id } });
      return true;
    }

    if (item.kind === "ACHIEVEMENT") {
      // 类型留 OTHER、状态留 PLANNED、isVerified=false：这条还没人核过，
      // 它应该出现在「待核实」里等着补全，而不是冒充一条可信记录
      const achievement = await tx.achievement.create({
        data: { title, note, type: "OTHER", isVerified: false },
      });
      await tx.captureItem.update({
        where: { id },
        data: { convertedAchievementId: achievement.id },
      });
      return true;
    }

    // NOTE → 会议。时间先按当下，进详情页再改
    const meeting = await tx.meeting.create({
      data: { title, minutes: note, meetingTime: new Date(), type: "TEMP" },
    });
    await tx.captureItem.update({ where: { id }, data: { convertedMeetingId: meeting.id } });
    return true;
  });
  if (!converted) return ALREADY_CONVERTED;

  revalidateCapture();
  revalidatePath("/tasks");
  revalidatePath("/achievements");
  revalidatePath("/meetings");
  return { ...IDLE_FORM_STATE, ok: true, message: "已转为正式记录" };
}

/**
 * 速记 → 学生记录（班主任模块）。这是记录流水的主入口：
 * 随手记一句，归类时选「归到学生」，比打开模块填表单少一次打开动作。
 *
 * 与 convertCapture 同一套纪律：事务 + @unique 转换指针防重复，
 * 原速记保留不删。日期取今天——归类的就是刚发生的事，回头可改日期的
 * 场景走记录页手工建。
 */
export async function convertCaptureToStudentRecord(
  id: string,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = captureStudentRecordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const item = await prisma.captureItem.findUnique({ where: { id } });
  if (!item) return { ok: false, message: "这条速记已经不在了" };
  if (item.status === "CONVERTED") return ALREADY_CONVERTED;

  const { classGroupId, typeId, studentId } = parsed.data;

  // 归属拿库里的值复核，不信表单
  const [classGroup, recordType, student] = await Promise.all([
    prisma.classGroup.findUnique({ where: { id: classGroupId }, select: { id: true } }),
    prisma.studentRecordType.findUnique({ where: { id: typeId }, select: { id: true } }),
    studentId
      ? prisma.student.findUnique({
          where: { id: studentId },
          select: { classGroupId: true },
        })
      : Promise.resolve(null),
  ]);
  if (!classGroup || !recordType) return { ok: false, message: "班级或类型不存在，刷新后重试" };
  if (studentId && student?.classGroupId !== classGroupId) {
    return { ok: false, message: "学生不在这个班里，刷新后重试" };
  }

  const content = [item.title.trim(), item.content?.trim()].filter(Boolean).join("\n");

  const converted = await prisma.$transaction(async (tx) => {
    if (!(await claimCapture(tx, id))) return false;
    const record = await tx.studentRecord.create({
      data: {
        classGroupId,
        typeId,
        date: todayAsDateOnly(),
        content,
        members: studentId ? { create: [{ studentId }] } : undefined,
      },
    });
    await tx.captureItem.update({
      where: { id },
      data: { convertedStudentRecordId: record.id },
    });
    return true;
  });
  if (!converted) return ALREADY_CONVERTED;

  revalidateCapture();
  revalidatePath("/students/records");
  return { ...IDLE_FORM_STATE, ok: true, message: "已归到学生记录" };
}

/**
 * 速记 → 指导记录（学业导师模块）。这是导师模块记录流水的主入口，
 * 理由和班主任那条一样：随手记一句，归类时选「归到导师学生」，
 * 比打开模块填表单少一次打开动作。
 *
 * **和上面那个 convertCaptureToStudentRecord 不复用**——两个模块是两张表、
 * 两个转换指针、两个开关。合并成一个带 target 参数的函数，读的人就得先去
 * 查参数才知道这条速记落到了哪张表上，而那两张表的归属列还不一样。
 */
export async function convertCaptureToMenteeRecord(
  id: string,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = captureMenteeRecordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const item = await prisma.captureItem.findUnique({ where: { id } });
  if (!item) return { ok: false, message: "这条速记已经不在了" };
  if (item.status === "CONVERTED") return ALREADY_CONVERTED;

  const { batchId, typeId, menteeId } = parsed.data;

  // 归属拿库里的值复核，不信表单
  const [batch, recordType, mentee] = await Promise.all([
    prisma.menteeBatch.findUnique({ where: { id: batchId }, select: { id: true } }),
    prisma.menteeRecordType.findUnique({ where: { id: typeId }, select: { id: true } }),
    menteeId
      ? prisma.mentee.findUnique({
          where: { id: menteeId },
          select: { batchId: true },
        })
      : Promise.resolve(null),
  ]);
  if (!batch || !recordType) return { ok: false, message: "批次或类型不存在，刷新后重试" };
  if (menteeId && mentee?.batchId !== batchId) {
    return { ok: false, message: "这名学生不在这一批里，刷新后重试" };
  }

  const content = [item.title.trim(), item.content?.trim()].filter(Boolean).join("\n");

  const converted = await prisma.$transaction(async (tx) => {
    if (!(await claimCapture(tx, id))) return false;
    const record = await tx.menteeRecord.create({
      data: {
        batchId,
        typeId,
        date: todayAsDateOnly(),
        content,
        members: menteeId ? { create: [{ menteeId }] } : undefined,
      },
    });
    await tx.captureItem.update({
      where: { id },
      data: { convertedMenteeRecordId: record.id },
    });
    return true;
  });
  if (!converted) return ALREADY_CONVERTED;

  revalidateCapture();
  revalidatePath("/mentees/records");
  revalidatePath("/mentees");
  return { ...IDLE_FORM_STATE, ok: true, message: "已归到指导记录" };
}
