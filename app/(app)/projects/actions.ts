"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { projectFormSchema } from "@/lib/schemas/project";
import { requireSession } from "@/lib/server-auth";
import { projectOutcomeRevalidationPaths } from "@/lib/outcomes/revalidation";

function revalidateProjectOutcome(projectId: string) {
  for (const path of projectOutcomeRevalidationPaths(projectId)) {
    revalidatePath(path);
  }
}

/**
 * 把表单里的来源选择解析成 sourceId。
 * 填了新名字就以它为准（去重靠 name 的唯一约束，同名直接复用现有条目）。
 */
async function resolveSourceId(input: {
  sourceId: string | null;
  newSourceName: string | null;
}): Promise<string | null> {
  if (input.newSourceName) {
    const existing = await prisma.projectSource.findUnique({
      where: { name: input.newSourceName },
    });
    if (existing) return existing.id;

    const created = await prisma.projectSource.create({ data: { name: input.newSourceName } });
    return created.id;
  }
  return input.sourceId;
}

export async function createProject(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = projectFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { newSourceName, sourceId, ...rest } = parsed.data;
  const data = { ...rest, sourceId: await resolveSourceId({ sourceId, newSourceName }) };

  // code 有唯一约束，撞车时给人话而不是抛 Prisma 错误
  if (data.code) {
    const duplicate = await prisma.project.findUnique({ where: { code: data.code } });
    if (duplicate) {
      return {
        ok: false,
        message: `课题编号 ${data.code} 已被《${duplicate.shortTitle ?? duplicate.title}》占用`,
        fieldErrors: { code: ["编号重复"] },
      };
    }
  }

  const project = await prisma.project.create({ data });
  await logActivity("Project", project.id, "创建课题", { title: project.title });

  revalidateProjectOutcome(project.id);
  redirect(`/projects/${project.id}`);
}

export async function updateProject(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = projectFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { newSourceName, sourceId, ...rest } = parsed.data;
  const data = { ...rest, sourceId: await resolveSourceId({ sourceId, newSourceName }) };

  if (data.code) {
    const duplicate = await prisma.project.findUnique({ where: { code: data.code } });
    if (duplicate && duplicate.id !== id) {
      return {
        ok: false,
        message: `课题编号 ${data.code} 已被《${duplicate.shortTitle ?? duplicate.title}》占用`,
        fieldErrors: { code: ["编号重复"] },
      };
    }
  }

  await prisma.project.update({ where: { id }, data });
  await logActivity("Project", id, "修改课题信息");

  revalidateProjectOutcome(id);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/**
 * 归档。历史课题不占看板位置但仍可检索（PRD 2.1），
 * 是删除之外的默认选项——真删会连带删掉挂接记录。
 */
export async function toggleArchive(id: string) {
  await requireSession();
  const project = await prisma.project.findUnique({ where: { id }, select: { archivedAt: true } });
  if (!project) return;

  const archivedAt = project.archivedAt ? null : new Date();
  await prisma.project.update({ where: { id }, data: { archivedAt } });
  await logActivity("Project", id, archivedAt ? "归档课题" : "取消归档");

  revalidateProjectOutcome(id);
}
