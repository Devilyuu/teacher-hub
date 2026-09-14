import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createProject } from "@/app/(app)/projects/actions";
import { getProjectSources } from "@/lib/queries/projects";
import { getPromotionOptions } from "@/lib/queries/promotion-categories";
import { projectIndicatorOptions } from "@/lib/promotion";
import { ProjectForm } from "./project-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "新建课题" };

export default async function NewProjectPage() {
  const sources = await getProjectSources();
  const projectPromotionOptions = projectIndicatorOptions(await getPromotionOptions());
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        课题列表
      </Link>

      <header className="space-y-2">
        <h1 className="page-title">新建课题</h1>
        <p className="measure text-muted-foreground">
          建好之后到「结题清单」里逐条录入结题要求，缺口才算得出来。
        </p>
      </header>

      <ProjectForm
        action={createProject}
        submitLabel="创建"
        sources={sources}
        projectPromotionOptions={projectPromotionOptions}
      />
    </div>
  );
}
