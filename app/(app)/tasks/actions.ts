"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { recurringRuleFormSchema, taskFormSchema } from "@/lib/schemas/task";
import { requireSession } from "@/lib/server-auth";
import { parseTags } from "@/lib/tasks";

/** 任务变化会影响首页收件箱和课题详情页的「任务」Tab */
function revalidateTasks(projectId?: string | null) {
  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath("/tasks/trash");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = taskFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { tags, relatedProjectId, ...rest } = parsed.data;
  const task = await prisma.task.create({
    data: {
      ...rest,
      relatedProjectId: relatedProjectId || null,
      tags: parseTags(tags),
      completedAt: rest.status === "DONE" ? new Date() : null,
    },
  });
  await logActivity("Task", task.id, "新建任务", { title: task.title });

  revalidateTasks(relatedProjectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已新建" };
}

export async function updateTask(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = taskFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.task.findUnique({
    where: { id },
    select: { status: true, completedAt: true, relatedProjectId: true },
  });
  if (!existing) return { ok: false, message: "任务不存在" };

  const { tags, relatedProjectId, ...rest } = parsed.data;
  await prisma.task.update({
    where: { id },
    data: {
      ...rest,
      relatedProjectId: relatedProjectId || null,
      tags: parseTags(tags),
      // 已完成的保留原完成时间，别因为改个标题就把完成日刷成今天
      completedAt: rest.status === "DONE" ? (existing.completedAt ?? new Date()) : null,
    },
  });

  revalidateTasks(relatedProjectId || existing.relatedProjectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/** 列表上的勾选框。**只改状态**，别的字段一律不碰 */
export async function toggleTaskDone(id: string, done: boolean) {
  await requireSession();
  const task = await prisma.task.update({
    where: { id },
    data: done
      ? { status: "DONE", completedAt: new Date() }
      : { status: "TODO", completedAt: null },
    select: { relatedProjectId: true },
  });
  revalidateTasks(task.relatedProjectId);
}

/** 软删除：进回收站，不是真删。改主意的成本应该低 */
export async function deleteTask(id: string) {
  await requireSession();
  const task = await prisma.task.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: { relatedProjectId: true },
  });
  revalidateTasks(task.relatedProjectId);
}

export async function restoreTask(id: string) {
  await requireSession();
  const task = await prisma.task.update({
    where: { id },
    data: { deletedAt: null },
    select: { relatedProjectId: true },
  });
  revalidateTasks(task.relatedProjectId);
}

/** 从回收站彻底删除。磁盘上没有文件要清，删了就是删了 */
export async function purgeTask(id: string) {
  await requireSession();
  await prisma.task.delete({ where: { id } });
  revalidateTasks();
}

// ─── 周期规则 ────────────────────────────────────────────────────────

export async function createRecurringRule(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = recurringRuleFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { relatedProjectId, ...rest } = parsed.data;
  await prisma.recurringRule.create({
    data: { ...rest, relatedProjectId: relatedProjectId || null },
  });

  revalidateTasks();
  return { ...IDLE_FORM_STATE, ok: true, message: "已新建规则，下次到期时自动生成任务" };
}

export async function toggleRecurringRule(id: string, active: boolean) {
  await requireSession();
  await prisma.recurringRule.update({ where: { id }, data: { active } });
  revalidateTasks();
}

export async function deleteRecurringRule(id: string) {
  await requireSession();
  // 已经生成出去的任务不动——它们是独立的待办，删规则不该连坐
  await prisma.recurringRule.delete({ where: { id } });
  revalidateTasks();
}
