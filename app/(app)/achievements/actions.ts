"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import {
  achievementFormSchema,
  achievementQuickEditSchema,
} from "@/lib/schemas/achievement";
import { requireSession } from "@/lib/server-auth";
import { deleteUpload } from "@/lib/storage";
import type { AchievementUsage } from "@/lib/generated/prisma/enums";

function revalidateAchievement(id?: string) {
  revalidatePath("/");
  revalidatePath("/achievements");
  revalidatePath("/projects");
  if (id) revalidatePath(`/achievements/${id}`);
}

const ARCHIVED_ACHIEVEMENT_MESSAGE = "该成果已归档并合并到课题，不能再修改";

function guardedUpdateFailure(status: "archived" | "missing" | "conflict"): FormState {
  if (status === "archived") return { ok: false, message: ARCHIVED_ACHIEVEMENT_MESSAGE };
  if (status === "missing") return { ok: false, message: "成果不存在或已删除" };
  return { ok: false, message: "成果状态刚刚发生变化，请刷新后重试" };
}

export async function createAchievement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = achievementFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const achievement = await prisma.achievement.create({ data: parsed.data });
  await logActivity("Achievement", achievement.id, "创建成果", { title: achievement.title });

  revalidateAchievement();
  redirect(`/achievements/${achievement.id}`);
}

export async function updateAchievement(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = achievementFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.achievement.findUnique({
        where: { id },
        select: { status: true, archivedAt: true },
      });
      if (!before) return { status: "missing" } as const;
      if (before.archivedAt) return { status: "archived" } as const;

      const updated = await tx.achievement.updateMany({
        where: { id, archivedAt: null },
        data: parsed.data,
      });
      if (updated.count !== 1) {
        const current = await tx.achievement.findUnique({
          where: { id },
          select: { archivedAt: true },
        });
        if (!current) return { status: "missing" } as const;
        if (current.archivedAt) return { status: "archived" } as const;
        return { status: "conflict" } as const;
      }

      // 状态变更单独记一条，详情页时间轴要看得出流转过程（prd-ledger 2.1）
      if (before.status !== parsed.data.status) {
        await logActivity(
          "Achievement",
          id,
          "状态变更",
          { from: before.status, to: parsed.data.status },
          tx,
        );
      } else {
        await logActivity("Achievement", id, "修改成果信息", undefined, tx);
      }
      return { status: "updated" } as const;
    });

    if (result.status !== "updated") return guardedUpdateFailure(result.status);
  } catch {
    return { ok: false, message: "成果保存失败，请刷新后重试" };
  }

  revalidateAchievement(id);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/**
 * 列表页的行内订正（prd-ledger 5 遗留项：导入进来的记录要逐条核）。
 *
 * 改年度/类型/级别/用途/职称指标/职称分/申报分 + 核实标记。
 * **不碰标题**——那是最容易误改又最难发现的字段，要改就进详情页。
 *
 * 两套口径的分都在这里，是因为梳理时是分口径进行的：
 * 切到职称口径逐条挂指标填职称分，切到绩效口径逐条填申报分。
 * 少了任何一个，那一趟就得改成一条条点进详情页。
 */
export async function quickEditAchievement(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = achievementQuickEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { usableForPerformance, usableForPromotion, usableForProjectClosing, ...rest } =
    parsed.data;

  const usableFor: AchievementUsage[] = [];
  if (usableForPerformance) usableFor.push("PERFORMANCE");
  if (usableForPromotion) usableFor.push("PROMOTION");
  if (usableForProjectClosing) usableFor.push("PROJECT_CLOSING");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.achievement.findUnique({
        where: { id },
        select: { archivedAt: true },
      });
      if (!before) return { status: "missing" } as const;
      if (before.archivedAt) return { status: "archived" } as const;

      const updated = await tx.achievement.updateMany({
        where: { id, archivedAt: null },
        data: { ...rest, usableFor },
      });
      if (updated.count !== 1) {
        const current = await tx.achievement.findUnique({
          where: { id },
          select: { archivedAt: true },
        });
        if (!current) return { status: "missing" } as const;
        if (current.archivedAt) return { status: "archived" } as const;
        return { status: "conflict" } as const;
      }

      await logActivity(
        "Achievement",
        id,
        "行内订正",
        {
          year: rest.year,
          type: rest.type,
          status: rest.status,
          level: rest.level,
          perfCategoryId: rest.perfCategoryId,
          promotionCategoryId: rest.promotionCategoryId,
          promotionScore: rest.promotionScore,
          declaredScore: rest.declaredScore,
          usableFor,
          isVerified: rest.isVerified,
        },
        tx,
      );
      return { status: "updated" } as const;
    });

    if (result.status !== "updated") return guardedUpdateFailure(result.status);
  } catch {
    return { ok: false, message: "成果保存失败，请刷新后重试" };
  }

  revalidateAchievement(id);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/**
 * 删除成果。
 *
 * 走 `useActionState` 的签名（`_prev` / `_formData`），**不是**能直接丢给
 * `<form action>` 的裸函数：拒绝时要把原因说出来。之前这个动作确实返回了
 * 一句提示，但没有任何界面接它——按下去什么都不发生，看起来像坏了。
 *
 * 成功时 `redirect` 会抛出，所以下面没有返回语句。
 */
export async function deleteAchievement(
  id: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  await requireSession();

  const achievement = await prisma.achievement.findUnique({
    where: { id },
    select: {
      title: true,
      archivedAt: true,
      // 附件记录会跟着级联删掉，但**磁盘上的文件不会**——
      // 先把路径取出来，删完库再逐个清盘，否则文件永远留在 data/uploads 里
      attachments: { select: { storagePath: true } },
    },
  });
  if (!achievement) return { ok: false, message: "成果不存在或已删除" };
  // 归档副本是 2.7 的历史迁移产物，详情页会重定向到规范课题，
  // 这里一并挡住：要清理它得走迁移脚本，不是在界面上顺手删掉
  if (achievement.archivedAt) return { ok: false, message: ARCHIVED_ACHIEVEMENT_MESSAGE };

  // 挂接会被级联删掉，所以先看一眼有没有已确认达标的挂接
  const qualified = await prisma.requirementLink.count({
    where: { achievementId: id, isQualified: true },
  });
  if (qualified > 0) {
    // 只提示，不代替用户决定：先让他去解除挂接
    return { ok: false, message: `该成果还在 ${qualified} 条结题要求上被确认达标，请先解除挂接` };
  }

  await prisma.achievement.delete({ where: { id } });

  // 先删库再删盘：反过来的话删盘成功、删库失败会留下指向空文件的记录，
  // 而现在这个顺序最坏情况只是留个没人引用的孤儿文件（与 deleteAttachment 同序）
  for (const attachment of achievement.attachments) {
    await deleteUpload(attachment.storagePath);
  }

  await logActivity("Achievement", id, "删除成果", {
    title: achievement.title,
    removedAttachments: achievement.attachments.length,
  });

  revalidateAchievement();
  redirect("/achievements");
}
