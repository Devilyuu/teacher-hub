/**
 * 课题材料（规格 6.4 / 7.4）。
 *
 * 「材料」就是挂在 Project 上的 Attachment——界面上课题详情里叫材料，
 * 台账里叫附件，是同一张表（CLAUDE.md 术语对照）。这里只放纯函数，
 * 数据库访问在 lib/actions/material-actions.ts。
 */
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";
import type { AttachmentKind } from "@/lib/generated/prisma/enums";

/**
 * 要求项能不能关联这份材料。
 *
 * 四条全部要过，缺一条就是一个能被利用的口子：
 * 1. 要求项存在，且属于 URL 上那个课题——`requirementId` 来自 FormData，不可信；
 * 2. 材料存在；
 * 3. 材料是**课题级**的（`projectId` 非空）。成果级证据不走这张表，
 *    它们经 RequirementLink → Achievement → attachments 到达要求项；
 * 4. 材料和要求项属于同一个课题。
 *
 * 返回原因码而不是直接抛错：调用方要把它翻成给人看的话，
 * 而「找不到」和「跨课题」在界面上该说的不是一句话。
 */
export type MaterialLinkRejection =
  | "REQUIREMENT_NOT_FOUND"
  | "ATTACHMENT_NOT_FOUND"
  | "NOT_PROJECT_MATERIAL"
  | "CROSS_PROJECT";

export type MaterialLinkCheck = { ok: true } | { ok: false; reason: MaterialLinkRejection };

export const MATERIAL_LINK_MESSAGES: Record<MaterialLinkRejection, string> = {
  REQUIREMENT_NOT_FOUND: "找不到这条结题要求项",
  ATTACHMENT_NOT_FOUND: "找不到这份材料，可能已被删除",
  NOT_PROJECT_MATERIAL: "这不是当前课题的课题材料，不能直接关联要求项",
  CROSS_PROJECT: "这份材料属于另一个课题，不能跨课题关联",
};

export function checkMaterialLinkable(input: {
  /** 从 URL 绑进来的课题 id，唯一可信的那个 */
  projectId: string;
  requirement: { projectId: string } | null;
  attachment: { projectId: string | null; docCategoryId?: string | null } | null;
}): MaterialLinkCheck {
  const { projectId, requirement, attachment } = input;

  if (!requirement || requirement.projectId !== projectId) {
    return { ok: false, reason: "REQUIREMENT_NOT_FOUND" };
  }
  if (!attachment) {
    return { ok: false, reason: "ATTACHMENT_NOT_FOUND" };
  }
  if (attachment.projectId == null) {
    return { ok: false, reason: "NOT_PROJECT_MATERIAL" };
  }
  if (attachment.projectId !== requirement.projectId) {
    return { ok: false, reason: "CROSS_PROJECT" };
  }
  return { ok: true };
}

/** 材料行上显示的「这份材料说明了哪条要求」 */
export type RequirementSummary = {
  /** 短标签，如「要求 3」。要求原文太长，塞进 chip 会把材料行撑爆 */
  label: string;
  /** 悬停看的全文。rawText 是真相来源，任何地方都不许改写它（CLAUDE.md 第 2 条） */
  title: string;
};

/**
 * attachmentId → 它说明了哪几条要求。
 *
 * 序号按 `requirements` 的顺序给（调用方已按 sortOrder 排好），
 * 和结题清单里从上往下数的位置一致——两处对不上，用户就得自己数一遍。
 */
export function requirementSummariesByAttachment(
  requirements: Array<{ rawText: string; materials: Array<{ attachmentId: string }> }>,
): Record<string, RequirementSummary[]> {
  const result: Record<string, RequirementSummary[]> = {};

  requirements.forEach((requirement, index) => {
    const summary = { label: `要求 ${index + 1}`, title: requirement.rawText };
    for (const material of requirement.materials) {
      (result[material.attachmentId] ??= []).push(summary);
    }
  });

  return result;
}

/** 材料分组里的一条 */
export type MaterialLike = { id: string; kind: AttachmentKind };

export type MaterialGroup<T extends MaterialLike> = {
  kind: AttachmentKind;
  label: string;
  items: T[];
};

/**
 * 按类型分组，空组不出现。
 *
 * 顺序取自 `ATTACHMENT_KIND_LABELS` 的键顺序（课题生命周期），
 * **不按数量排也不按字母排**——材料区要回答的是「这个课题走到哪一步了」，
 * 按数量排会让刚开题的课题把获奖证书顶到最前面。
 */
export function groupMaterialsByKind<T extends MaterialLike>(materials: T[]): MaterialGroup<T>[] {
  const order = Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[];

  return order
    .map((kind) => ({
      kind,
      label: ATTACHMENT_KIND_LABELS[kind],
      items: materials.filter((material) => material.kind === kind),
    }))
    .filter((group) => group.items.length > 0);
}
