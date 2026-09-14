"use server";

import { revalidatePath } from "next/cache";
import { dateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { requireSession } from "@/lib/server-auth";

function revalidateDuties() {
  revalidatePath("/duties");
  revalidatePath("/calendar");
  revalidatePath("/");
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

// ─── 教师名录 ────────────────────────────────────────────────────────

/** 名字唯一，重复添加当成幂等——手抖点两次不该报错 */
export async function createTeacher(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const name = text(formData, "name");
  if (!name) return { ok: false, message: "请填写姓名" };

  await prisma.teacher.upsert({ where: { name }, update: {}, create: { name } });
  revalidateDuties();
  return { ...IDLE_FORM_STATE, ok: true, message: `已添加 ${name}` };
}

export async function setTeacherActive(id: string, active: boolean) {
  await requireSession();
  await prisma.teacher.update({ where: { id }, data: { active } });
  revalidateDuties();
}

/**
 * 删教师。**有轮派记录的只停用不删**——删了会把历史记录里的人名一并抹掉，
 * 而那是要查证的（「上学期这场监考是谁」）。
 */
export async function deleteTeacher(id: string) {
  await requireSession();
  const teacher = await prisma.teacher.findUnique({
    where: { id },
    select: { _count: { select: { dutyParticipations: true } } },
  });
  if (!teacher) return;

  if (teacher._count.dutyParticipations > 0) {
    await prisma.teacher.update({ where: { id }, data: { active: false } });
  } else {
    await prisma.teacher.delete({ where: { id } });
  }
  revalidateDuties();
}

// ─── 轮派类型（字典表）────────────────────────────────────────────────

export async function createDutyType(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const name = text(formData, "name");
  if (!name) return { ok: false, message: "请填写类型名称" };

  const existing = await prisma.dutyType.findUnique({ where: { name } });
  if (existing) return { ok: false, message: `「${name}」已经有了` };

  await prisma.dutyType.create({ data: { name, note: text(formData, "note") || null } });
  revalidateDuties();
  return { ...IDLE_FORM_STATE, ok: true, message: `已添加「${name}」` };
}

/** 删类型连同它下面的记录——类型没了，记录也就无处安放 */
export async function deleteDutyType(id: string) {
  await requireSession();
  await prisma.$transaction([
    prisma.dutyRecord.deleteMany({ where: { dutyTypeId: id } }),
    prisma.dutyType.delete({ where: { id } }),
  ]);
  revalidateDuties();
}

// ─── 轮派记录 ────────────────────────────────────────────────────────

export async function createDutyRecord(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const title = text(formData, "title");
  const dutyTypeId = text(formData, "dutyTypeId");
  const dateStr = text(formData, "date");
  const teacherIds = formData
    .getAll("teachers")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (!title) return { ok: false, message: "请填写事项说明" };
  if (!dutyTypeId) return { ok: false, message: "请选择轮派类型" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, message: "请选择日期" };
  if (teacherIds.length === 0) return { ok: false, message: "至少选一个参与人" };

  const type = await prisma.dutyType.findUnique({ where: { id: dutyTypeId } });
  if (!type) return { ok: false, message: "轮派类型不存在" };

  const [year, month, day] = dateStr.split("-").map(Number);
  const date = dateOnly(year, month, day);

  await prisma.dutyRecord.create({
    data: {
      dutyTypeId,
      date,
      title,
      note: text(formData, "note") || null,
      // 显式连接表用 create 不是 connect（connect 是隐式 m2m 的写法）
      participants: { create: teacherIds.map((teacherId) => ({ teacherId })) },
    },
  });

  // 顺带给每个人建一条任务。**默认不建**——排班表本身就是记录，
  // 多数排班不需要变成待办，勾了才建
  if (formData.get("generateTasks") === "on") {
    const teachers = await prisma.teacher.findMany({ where: { id: { in: teacherIds } } });
    await prisma.task.createMany({
      data: teachers.map((teacher) => ({
        title: `${title}（${type.name}）`,
        assignee: teacher.name,
        dueDate: date,
        source: "SUPERIOR" as const,
        note: `来自轮派「${type.name}」`,
      })),
    });
    revalidatePath("/tasks");
  }

  revalidateDuties();
  return { ...IDLE_FORM_STATE, ok: true, message: "已记录" };
}

export async function deleteDutyRecord(id: string) {
  await requireSession();
  await prisma.dutyRecord.delete({ where: { id } });
  revalidateDuties();
}
