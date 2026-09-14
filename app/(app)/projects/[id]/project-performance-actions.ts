"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import {
  PROJECT_PERF_MINORS,
  projectPerformanceDraft,
} from "@/lib/project-performance";
import { projectPerformanceFormSchema } from "@/lib/schemas/project-performance";
import { requireSession } from "@/lib/server-auth";

const deleteProjectPerformanceEventSchema = z.object({
  id: z.string().trim().min(1, "缺少课题绩效事项编号"),
});

function revalidateProjectPerformance(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/achievements");
  revalidatePath("/export");
}

export async function createProjectPerformanceEvent(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = projectPerformanceFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: {
          title: true,
          shortTitle: true,
          level: true,
          role: true,
          fundingType: true,
          status: true,
          applyDeadline: true,
          startDate: true,
          endDate: true,
          closingDeadline: true,
          fundingReceived: true,
          dateText: true,
        },
      });
      if (!project) {
        return { ok: false, message: "课题不存在" } as const;
      }

      const currentRules = await tx.perfCategory.findFirst({
        orderBy: { year: "desc" },
        select: { year: true },
      });
      if (!currentRules) {
        return { ok: false, message: "当前没有可用的绩效分类" } as const;
      }

      const category = await tx.perfCategory.findFirst({
        where: {
          id: parsed.data.perfCategoryId,
          year: currentRules.year,
          isActive: true,
          minorCategory: { in: [...PROJECT_PERF_MINORS] },
        },
        select: { id: true },
      });
      if (!category) {
        return {
          ok: false,
          message: "绩效分类不存在或不在当前可用候选中",
        } as const;
      }

      const source = {
        ...project,
        fundingReceived: project.fundingReceived?.toString() ?? null,
      };
      const draft = projectPerformanceDraft(source, parsed.data);
      const event = await tx.projectPerformanceEvent.create({
        data: { projectId, ...draft },
      });
      await logActivity(
        "ProjectPerformanceEvent",
        event.id,
        "新增课题绩效事项",
        {
          projectId,
          kind: draft.kind,
          year: draft.year,
          perfCategoryId: draft.perfCategoryId,
          declaredScore: draft.declaredScore,
        },
        tx,
      );
      return { ok: true } as const;
    });

    if (!result.ok) return result;
  } catch {
    return { ok: false, message: "课题绩效事项保存失败，请稍后重试" };
  }

  revalidateProjectPerformance(projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "课题绩效事项已添加，等待核实" };
}

export async function deleteProjectPerformanceEvent(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = deleteProjectPerformanceEventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.projectPerformanceEvent.findUnique({
        where: { id: parsed.data.id },
        select: {
          id: true,
          projectId: true,
          legacyAchievementId: true,
          kind: true,
          year: true,
        },
      });
      if (!event) return { status: "missing" } as const;
      if (event.legacyAchievementId) return { status: "legacy" } as const;

      const deleted = await tx.projectPerformanceEvent.deleteMany({
        where: { id: event.id, legacyAchievementId: null },
      });
      if (deleted.count === 0) {
        const current = await tx.projectPerformanceEvent.findUnique({
          where: { id: event.id },
          select: { legacyAchievementId: true },
        });
        if (current?.legacyAchievementId) return { status: "legacy" } as const;
        return { status: "missing" } as const;
      }

      await logActivity(
        "ProjectPerformanceEvent",
        event.id,
        "删除课题绩效事项",
        {
          projectId: event.projectId,
          kind: event.kind,
          year: event.year,
        },
        tx,
      );
      return { status: "deleted", projectId: event.projectId } as const;
    });

    if (result.status === "missing") {
      return { ok: false, message: "课题绩效事项不存在" };
    }
    if (result.status === "legacy") {
      return {
        ok: false,
        message: "迁移形成的绩效事项需在迁移核对工具中处理",
      };
    }
    revalidateProjectPerformance(result.projectId);
  } catch {
    return { ok: false, message: "课题绩效事项删除失败，请稍后重试" };
  }

  return { ...IDLE_FORM_STATE, ok: true, message: "课题绩效事项已删除" };
}
