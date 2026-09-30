"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { deleteMenteeProject } from "../../actions";

/**
 * 删项目。**找不回来，所以走确认，且文案写清后果**：
 * 材料会跟着删（连磁盘文件），但指导记录不删——`MenteeRecord.projectId`
 * 是 SetNull，项目没了，谈过的话还在。
 *
 * **已引用为成果的不给删**（同参赛）：动作那边也挡着，这里不摆按钮、直接说原因。
 */
export function ProjectDangerZone({
  projectId,
  title,
  attachmentCount,
  recordCount,
  adopted,
}: {
  projectId: string;
  title: string;
  attachmentCount: number;
  recordCount: number;
  adopted: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (adopted) {
    return (
      <p className="measure rounded-2xl bg-well px-4 py-3 text-xs text-muted-foreground">
        已引用为成果，不能删——那条成果还在台账里，项目一没，
        「这个成果是哪个题目、哪几个学生做的」就查不到了。
      </p>
    );
  }

  const consequences = [
    attachmentCount > 0 ? `${attachmentCount} 份材料会一起删掉` : null,
    recordCount > 0 ? `${recordCount} 条指导记录会保留，只是不再挂在项目上` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-well px-4 py-3">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {consequences.length > 0 ? consequences.join("；") : "这个项目还是空的。"}
      </p>
      <ConfirmSubmitButton
        action={async () => {
          const result = await deleteMenteeProject(projectId);
          if (result.ok) router.push("/mentees/projects");
          else setError(result.message ?? null);
        }}
        message={
          attachmentCount > 0
            ? `删除「${title}」会连同 ${attachmentCount} 份材料一起删掉，找不回来。指导记录会留下。`
            : `删除「${title}」？找不回来。指导记录会留下。`
        }
        size="sm"
        label={`删除项目 ${title}`}
      >
        <Trash2 className="size-3.5" aria-hidden />
        删除项目
      </ConfirmSubmitButton>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
