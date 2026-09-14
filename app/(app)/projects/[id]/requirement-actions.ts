"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import {
  rejectedRequirementTypes,
  rejectedRequirementTypesMessage,
} from "@/lib/requirement-types";
import {
  linkFormSchema,
  qualifyFormSchema,
  requirementFormSchema,
} from "@/lib/schemas/link";
import { requireSession } from "@/lib/server-auth";
import type { AchievementType, FundingType } from "@/lib/generated/prisma/enums";

function revalidateProject(projectId: string) {
  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/achievements");
}

/** 要求项不属于当前课题（或已被删）时统一这么说 */
const REQUIREMENT_NOT_FOUND = "找不到这条结题要求项";

/**
 * 用课题**库里的**纵向 / 横向复核提交上来的类型。
 *
 * 表单值全是不可信输入：到账经费的按钮只在横向课题下渲染，但按钮没了不等于
 * 提交不了，隐藏域照样能改。课题类型只认这一处读出来的那份。
 */
function checkRequirementTypes(
  fundingType: FundingType,
  allowedTypes: AchievementType[],
): FormState | null {
  const rejected = rejectedRequirementTypes(fundingType, allowedTypes);
  if (rejected.length === 0) return null;

  const message = rejectedRequirementTypesMessage(rejected);
  return { ok: false, message, fieldErrors: { allowedTypes: [message] } };
}

// ─── 要求项 CRUD ─────────────────────────────────────────────────────

export async function createRequirement(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = requirementFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { fundingType: true },
  });
  if (!project) return { ok: false, message: "课题不存在" };

  const rejection = checkRequirementTypes(project.fundingType, parsed.data.allowedTypes);
  if (rejection) return rejection;

  const last = await prisma.requirement.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const requirement = await prisma.requirement.create({
    data: { ...parsed.data, projectId, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  await logActivity("Requirement", requirement.id, "新增结题要求项", { projectId });

  revalidateProject(projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已添加" };
}

export async function updateRequirement(
  requirementId: string,
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = requirementFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  // requirementId 和 projectId 都从页面绑进来，凑一对别人的照样得拒
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { projectId: true, project: { select: { fundingType: true } } },
  });
  if (!requirement || requirement.projectId !== projectId) {
    return { ok: false, message: REQUIREMENT_NOT_FOUND };
  }

  const rejection = checkRequirementTypes(
    requirement.project.fundingType,
    parsed.data.allowedTypes,
  );
  if (rejection) return rejection;

  await prisma.requirement.update({ where: { id: requirementId }, data: parsed.data });
  await logActivity("Requirement", requirementId, "修改结题要求项", { projectId });

  revalidateProject(projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

export async function deleteRequirement(requirementId: string, projectId: string) {
  await requireSession();
  // 挂接会被级联删掉，但要求项本身是照抄立项文件的，删掉等于丢证据，先记一笔。
  // 顺手核对归属：页面上的 projectId 和 requirementId 凑错对，不该删掉别人的要求
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { projectId: true, rawText: true, links: { select: { id: true } } },
  });
  if (!requirement || requirement.projectId !== projectId) return;

  await prisma.requirement.delete({ where: { id: requirementId } });
  await logActivity("Requirement", requirementId, "删除结题要求项", {
    projectId,
    rawText: requirement.rawText,
    removedLinks: requirement.links.length,
  });

  revalidateProject(projectId);
}

// ─── 挂接 ────────────────────────────────────────────────────────────

export async function linkAchievement(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = linkFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { requirementId, achievementId } = parsed.data;

  const existing = await prisma.requirementLink.findUnique({
    where: { requirementId_achievementId: { requirementId, achievementId } },
  });
  if (existing) return { ok: false, message: "这条成果已经挂在该要求项上了" };

  // 挂接一律不带达标：是否达标只能人工另行勾选（CLAUDE.md 第 1 条）
  await prisma.requirementLink.create({ data: { requirementId, achievementId } });
  await logActivity("RequirementLink", `${requirementId}:${achievementId}`, "挂接成果", {
    projectId,
  });

  revalidateProject(projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已挂接" };
}

export async function unlinkAchievement(linkId: string, projectId: string) {
  await requireSession();
  await prisma.requirementLink.delete({ where: { id: linkId } });
  await logActivity("RequirementLink", linkId, "解除挂接", { projectId });

  revalidateProject(projectId);
}

/**
 * 达标勾选。这是全站唯一决定「算不算达标」的地方，
 * 必须来自人工点击——系统永远不根据成果状态或约束校验结果自动勾。
 */
export async function setQualified(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = qualifyFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { linkId, isQualified, qualifyNote } = parsed.data;

  await prisma.requirementLink.update({
    where: { id: linkId },
    data: {
      isQualified,
      qualifyNote,
      qualifiedAt: isQualified ? new Date() : null,
    },
  });
  await logActivity("RequirementLink", linkId, isQualified ? "确认达标" : "取消达标", {
    projectId,
    note: qualifyNote,
  });

  revalidateProject(projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: isQualified ? "已确认达标" : "已取消达标" };
}

/**
 * 跨课题重复使用检查（PRD 2.4）。
 * 只返回事实，由界面决定怎么提醒——不阻止挂接。
 */
export async function findOtherQualifiedUses(achievementId: string, currentProjectId: string) {
  await requireSession();
  const links = await prisma.requirementLink.findMany({
    where: {
      achievementId,
      isQualified: true,
      requirement: { projectId: { not: currentProjectId } },
    },
    select: {
      requirement: { select: { project: { select: { id: true, title: true, shortTitle: true } } } },
    },
  });

  const projects = new Map<string, string>();
  for (const link of links) {
    const project = link.requirement.project;
    projects.set(project.id, project.shortTitle ?? project.title);
  }
  return [...projects.entries()].map(([id, name]) => ({ id, name }));
}
