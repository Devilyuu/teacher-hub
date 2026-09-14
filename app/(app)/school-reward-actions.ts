"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { toFormState, type FormState } from "@/lib/form-state";
import { schoolRewardFormSchema } from "@/lib/schemas/school-reward";
import { requireSession } from "@/lib/server-auth";

export type RewardTarget = {
  kind: "PROJECT" | "ACHIEVEMENT";
  id: string;
};

const rewardTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PROJECT"), id: z.string().trim().min(1) }),
  z.object({ kind: z.literal("ACHIEVEMENT"), id: z.string().trim().min(1) }),
]);

const rewardIdSchema = z.string().trim().min(1);

function revalidateSchoolRewards(target: RewardTarget) {
  revalidatePath(
    target.kind === "PROJECT"
      ? `/projects/${target.id}`
      : `/achievements/${target.id}`,
  );
  revalidatePath("/projects");
  revalidatePath("/achievements");
  revalidatePath("/export");
}

export async function createSchoolRewardDecision(
  targetInput: RewardTarget,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const targetResult = rewardTargetSchema.safeParse(targetInput);
  if (!targetResult.success) {
    return { ok: false, message: "学校奖励审定对象无效" };
  }
  const target = targetResult.data;

  const parsed = schoolRewardFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const targetExists =
        target.kind === "PROJECT"
          ? await tx.project.findUnique({
              where: { id: target.id },
              select: { id: true },
            })
          : await tx.achievement.findUnique({
              where: { id: target.id },
              select: { id: true },
            });
      if (!targetExists) return { status: "missing" } as const;

      const decision = await tx.schoolRewardDecision.create({
        data: {
          projectId: target.kind === "PROJECT" ? target.id : null,
          achievementId: target.kind === "ACHIEVEMENT" ? target.id : null,
          ...parsed.data,
        },
        select: { id: true },
      });

      await logActivity(
        "SchoolRewardDecision",
        decision.id,
        "记录学校突出成果审定通过",
        {
          targetKind: target.kind,
          targetId: target.id,
          approvedAt: formatDateOnly(parsed.data.approvedAt),
          batch: parsed.data.batch,
          domain: parsed.data.domain,
          awardItem: parsed.data.awardItem,
          awardLevel: parsed.data.awardLevel,
          awardAmountYuan:
            parsed.data.awardAmountYuan == null
              ? null
              : String(parsed.data.awardAmountYuan),
          evidenceRef: parsed.data.evidenceRef,
          note: parsed.data.note,
        },
        tx,
      );
      return { status: "created" } as const;
    });

    if (result.status === "missing") {
      return {
        ok: false,
        message: target.kind === "PROJECT" ? "课题不存在" : "成果不存在",
      };
    }
  } catch {
    return {
      ok: false,
      message: "学校奖励审定记录保存失败，请稍后重试",
    };
  }

  revalidateSchoolRewards(target);
  return { ok: true, message: "已记录学校审定通过" };
}

export async function deleteSchoolRewardDecision(idInput: string): Promise<FormState> {
  await requireSession();
  const idResult = rewardIdSchema.safeParse(idInput);
  if (!idResult.success) {
    return { ok: false, message: "学校奖励审定记录编号无效" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const decision = await tx.schoolRewardDecision.findUnique({
        where: { id: idResult.data },
      });
      if (!decision) return { status: "missing" } as const;

      // 日志先保存完整快照，再在同一事务中删除；后一步失败时日志也会一起回滚。
      await logActivity(
        "SchoolRewardDecision",
        decision.id,
        "删除误录的学校突出成果审定",
        {
          projectId: decision.projectId,
          achievementId: decision.achievementId,
          approvedAt: formatDateOnly(decision.approvedAt),
          batch: decision.batch,
          domain: decision.domain,
          awardItem: decision.awardItem,
          awardLevel: decision.awardLevel,
          awardAmountYuan: decision.awardAmountYuan?.toString() ?? null,
          evidenceRef: decision.evidenceRef,
          note: decision.note,
          createdAt: decision.createdAt.toISOString(),
          updatedAt: decision.updatedAt.toISOString(),
        },
        tx,
      );
      await tx.schoolRewardDecision.delete({ where: { id: decision.id } });

      const target: RewardTarget = decision.projectId
        ? { kind: "PROJECT", id: decision.projectId }
        : { kind: "ACHIEVEMENT", id: decision.achievementId! };
      return { status: "deleted", target } as const;
    });

    if (result.status === "missing") {
      return { ok: false, message: "学校奖励审定记录不存在" };
    }
    revalidateSchoolRewards(result.target);
  } catch {
    return {
      ok: false,
      message: "学校奖励审定记录删除失败，请稍后重试",
    };
  }

  return { ok: true, message: "误录的学校审定记录已删除" };
}
