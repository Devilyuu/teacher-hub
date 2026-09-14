import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAchievement } from "@/app/(app)/achievements/actions";
import { getPerfOptions } from "@/lib/queries/perf-categories";
import { getPromotionOptions } from "@/lib/queries/promotion-categories";
import { AchievementForm } from "../achievement-form";

export const metadata: Metadata = { title: "新建成果" };

export default async function NewAchievementPage() {
  const promotionOptions = await getPromotionOptions();
  const perfOptions = await getPerfOptions();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/achievements"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        成果库
      </Link>

      <header className="space-y-2">
        <h1 className="page-title">新建成果</h1>
        <p className="measure text-muted-foreground">建好之后到课题的结题清单里挂到对应的要求项上。</p>
      </header>

      <AchievementForm
        action={createAchievement}
        submitLabel="创建"
        promotionOptions={promotionOptions}
        perfOptions={perfOptions}
      />
    </div>
  );
}
