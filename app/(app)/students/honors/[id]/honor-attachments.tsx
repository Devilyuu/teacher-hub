"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteAttachment,
  uploadStudentHonorAttachment,
} from "@/lib/actions/attachment-actions";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";

export type HonorAttachmentRow = {
  id: string;
  filename: string;
  sizeText: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Upload className="size-3.5" aria-hidden />
      {pending ? "上传中…" : "上传"}
    </Button>
  );
}

/** 奖状照片/扫描件。类型钉死为获奖证书，不给下拉——这里只放奖状 */
export function HonorAttachments({
  honorId,
  rows,
}: {
  honorId: string;
  rows: HonorAttachmentRow[];
}) {
  const [state, action] = useActionState(
    uploadStudentHonorAttachment.bind(null, honorId),
    IDLE_FORM_STATE,
  );

  return (
    <section className="space-y-3">
      <h2 className="px-1 text-sm font-medium">奖状</h2>

      <form action={action} className="surface space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
          <Input name="file" type="file" required accept="image/*,.pdf" />
          <Input name="note" placeholder="备注（可空）" />
          <SubmitButton />
        </div>
        {state.message ? (
          <p className={formMessageClass(state.ok)}>{state.message}</p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          还没有奖状。拍张照传上来，评优时「奖状包」一键带走。
        </p>
      ) : (
        <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              {/* 文件名不进 URL（代码约定）：预览走 /api/attachments/<id> */}
              <a
                href={`/api/attachments/${row.id}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline"
                title={row.filename}
              >
                {row.filename}
              </a>
              <span className="text-xs text-muted-foreground tabular-nums">{row.sizeText}</span>
              <form
                action={deleteAttachment.bind(null, row.id, `/students/honors/${honorId}`)}
              >
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`删除 ${row.filename}`}
                  onClick={(event) => {
                    if (!confirm(`删除奖状「${row.filename}」？`)) event.preventDefault();
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
