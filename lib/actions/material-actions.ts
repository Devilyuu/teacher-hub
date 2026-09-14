"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { checkMaterialLinkable, MATERIAL_LINK_MESSAGES } from "@/lib/materials";
import {
  materialLinkFormSchema,
  materialQualificationFormSchema,
} from "@/lib/schemas/material";
import { requireSession } from "@/lib/server-auth";

function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
}

/**
 * 把一份课题材料关联到一条结题要求项上。
 *
 * `projectId` 从 URL 绑进来，是唯一可信的那个；`requirementId` / `attachmentId`
 * 都来自 FormData，必须回查库核对归属（规格 6.4 的四条边界，
 * 逐条见 checkMaterialLinkable）。
 *
 * **关联不等于达标。** 这里只记录「这份材料说明这条要求」，
 * 完整度界面只显示已有/缺失，不做任何判定（CLAUDE.md 第 1 条）。
 */
export async function linkRequirementMaterial(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = materialLinkFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { requirementId, attachmentId, note } = parsed.data;

  const [requirement, attachment] = await Promise.all([
    prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { projectId: true },
    }),
    prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { projectId: true, filename: true },
    }),
  ]);

  const check = checkMaterialLinkable({ projectId, requirement, attachment });
  if (!check.ok) {
    return { ok: false, message: MATERIAL_LINK_MESSAGES[check.reason] };
  }

  const existing = await prisma.requirementAttachment.findUnique({
    where: { requirementId_attachmentId: { requirementId, attachmentId } },
    select: { id: true },
  });
  if (existing) return { ok: false, message: "这份材料已经关联到该要求项了" };

  await prisma.requirementAttachment.create({
    data: { requirementId, attachmentId, note },
  });
  await logActivity("RequirementAttachment", `${requirementId}:${attachmentId}`, "关联材料", {
    projectId,
    filename: attachment?.filename ?? null,
  });

  revalidateProject(projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已关联" };
}

/**
 * 解除关联。**只删连接，不删材料本体**——
 * 误点一下不该把磁盘上的申报书一起带走。
 */
export async function unlinkRequirementMaterial(linkId: string, projectId: string) {
  await requireSession();

  // 归属核对：linkId 来自页面，但页面可能是别的课题的
  const link = await prisma.requirementAttachment.findUnique({
    where: { id: linkId },
    select: { requirement: { select: { projectId: true } } },
  });
  if (!link || link.requirement.projectId !== projectId) return;

  await prisma.requirementAttachment.delete({ where: { id: linkId } });
  await logActivity("RequirementAttachment", linkId, "解除材料关联", { projectId });

  revalidateProject(projectId);
}

/**
 * 人工确认一份课题材料是否满足当前要求。
 *
 * 关联、上传和材料类型都不能替用户下判断；只有这个动作能改 isQualified。
 * projectId 来自 URL 绑定，linkId 来自不可信表单，所以修改前必须回查归属。
 */
export async function setRequirementMaterialQualified(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = materialQualificationFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const current = await prisma.requirementAttachment.findUnique({
    where: { id: parsed.data.linkId },
    select: { requirement: { select: { projectId: true } } },
  });
  if (!current || current.requirement.projectId !== projectId) {
    return { ok: false, message: "找不到这条课题材料关联" };
  }

  await prisma.requirementAttachment.update({
    where: { id: parsed.data.linkId },
    data: {
      isQualified: parsed.data.isQualified,
      qualifiedAt: parsed.data.isQualified ? new Date() : null,
      qualifyNote: parsed.data.qualifyNote,
    },
  });
  await logActivity(
    "RequirementAttachment",
    parsed.data.linkId,
    parsed.data.isQualified ? "确认材料达标" : "取消材料达标",
    { projectId, note: parsed.data.qualifyNote },
  );

  revalidateProject(projectId);
  return {
    ...IDLE_FORM_STATE,
    ok: true,
    message: parsed.data.isQualified ? "已确认达标" : "已取消达标",
  };
}
