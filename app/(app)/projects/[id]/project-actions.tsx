"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Archive, ArchiveRestore, Pencil, X } from "lucide-react";
import {
  ProjectForm,
  type ProjectFormDefaults,
  type ProjectSourceOption,
} from "@/app/(app)/projects/new/project-form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";
import type { PromotionOption } from "@/lib/promotion";

function PendingButton({
  children,
  ...props
}: React.ComponentProps<typeof Button> & { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} disabled={pending || props.disabled}>
      {pending ? "处理中…" : children}
    </Button>
  );
}

export function ArchiveButton({
  action,
  archived,
}: {
  action: () => Promise<void>;
  archived: boolean;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !archived &&
          !confirm("归档后这个课题不再占看板位置，但仍可在课题列表里查到。确定归档？")
        ) {
          e.preventDefault();
        }
      }}
    >
      <PendingButton type="submit" variant="ghost" size="sm" className="text-muted-foreground">
        {archived ? (
          <>
            <ArchiveRestore className="size-3.5" aria-hidden />
            取消归档
          </>
        ) : (
          <>
            <Archive className="size-3.5" aria-hidden />
            归档
          </>
        )}
      </PendingButton>
    </form>
  );
}

/**
 * 编辑课题。就地展开表单，复用新建时那一套字段，
 * 免得两处表单各写一遍、字段还对不上。
 */
export function EditProjectPanel({
  action,
  defaults,
  dataVersion,
  sources,
  projectPromotionOptions,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: ProjectFormDefaults;
  dataVersion?: string;
  sources: ProjectSourceOption[];
  projectPromotionOptions: PromotionOption[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" aria-hidden />
        编辑课题
      </Button>
    );
  }

  return (
    <section className="w-full space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">编辑课题</h2>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="收起">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <ProjectForm
        action={action}
        defaults={defaults}
        dataVersion={dataVersion}
        submitLabel="保存"
        sources={sources}
        projectPromotionOptions={projectPromotionOptions}
      />
    </section>
  );
}
