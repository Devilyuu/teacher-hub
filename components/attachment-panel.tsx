"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import { FolderArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFileSize, formatTimestampDate } from "@/lib/format";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";
import { ATTACHMENT_KIND_OPTIONS } from "@/lib/options";
import { groupMaterialsByKind, type RequirementSummary } from "@/lib/materials";
import {
  deleteAttachment,
  uploadAchievementAttachment,
  uploadCompetitionAttachment,
  uploadProjectAttachment,
} from "@/lib/actions/attachment-actions";
import type { AttachmentKind } from "@/lib/generated/prisma/enums";

export type AttachmentItem = {
  id: string;
  kind: AttachmentKind;
  /** 材料编号，从绩效库导入的才有 */
  code: string | null;
  filename: string;
  size: number;
  mimeType: string;
  note: string | null;
  uploadedAt: Date;
  /** 浏览器能不能直接渲染。docx 不行，只能下载 */
  previewable: boolean;
};

/** 附件挂在课题、成果还是参赛记录上。三边的上传动作签名一样，只是归属不同 */
export type AttachmentOwner = {
  kind: "project" | "achievement" | "competitionEntry";
  id: string;
};

/** 上传动作与回跳路径。**写成穷尽的查表而不是三元链**：
 *  漏一种归属不会报错，只会把材料传到别的对象上（同 attachment-actions 里的教训） */
const OWNER_UPLOAD = {
  project: uploadProjectAttachment,
  achievement: uploadAchievementAttachment,
  competitionEntry: uploadCompetitionAttachment,
} as const;

const OWNER_SEGMENT = {
  project: "projects",
  achievement: "achievements",
  competitionEntry: "competitions",
} as const;

/**
 * 字段级报错。整体提示写的是「看下标红的地方」，
 * 那就必须真有地方标红——否则用户只看到一句红字，无从下手。
 */
function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <>
      {errors.map((error) => (
        <p key={error} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "上传中…" : (
        <>
          <Upload className="size-3.5" aria-hidden />
          上传
        </>
      )}
    </Button>
  );
}

export function AttachmentPanel({
  owner,
  attachments,
  requirementsByAttachment,
}: {
  owner: AttachmentOwner;
  attachments: AttachmentItem[];
  /**
   * 只读显示每份材料说明了哪几条结题要求（规格 6.4）。
   * 只有课题材料有；成果附件传不进来，因为成果级证据不走 RequirementAttachment。
   */
  requirementsByAttachment?: Record<string, RequirementSummary[]>;
}) {
  const action = OWNER_UPLOAD[owner.kind].bind(null, owner.id);
  const ownerPath = `/${OWNER_SEGMENT[owner.kind]}/${owner.id}`;
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const [preview, setPreview] = useState<AttachmentItem | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // ZIP 只给课题用：成果附件不是「课题材料」，打包口径也不一样（规格 7.4）
  const zipEnabled = owner.kind === "project" && attachments.length > 0;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 上传成功后清空文件选择，免得连传两个时误以为没换文件。
  // 用 key 让 React 重建整个表单，比在渲染期间去 reset() 干净——
  // 后者要在渲染中读 ref，是 React 明令禁止的
  const formKey = `${attachments.length}-${state.ok}`;

  // 按类型分组，空的分组不显示。顺序和结题清单里的材料下拉共用一份实现，
  // 免得两处各排各的（lib/materials.ts）
  const grouped = groupMaterialsByKind(attachments);

  return (
    <div className="space-y-6">
      <form key={formKey} action={formAction} className="surface space-y-4 p-5">
        <h3 className="text-sm font-medium">上传材料</h3>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="space-y-1.5">
            <Label htmlFor="file">文件</Label>
            <Input
              id="file"
              name="file"
              type="file"
              required
              aria-invalid={state.fieldErrors?.file ? true : undefined}
              className="file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs aria-invalid:border-destructive"
            />
            <FieldErrors errors={state.fieldErrors?.file} />
            <p className="text-xs text-muted-foreground">
              支持 PDF、Word、Excel、PPT、图片、zip，单个不超过 25MB
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kind">材料类型</Label>
            <select
              id="kind"
              name="kind"
              defaultValue="PROPOSAL"
              aria-invalid={state.fieldErrors?.kind ? true : undefined}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
            >
              {ATTACHMENT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldErrors errors={state.fieldErrors?.kind} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">备注</Label>
          <Input id="note" name="note" placeholder="如「第二轮修订版」「维普检测 18.4%」" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton />
          {state.message ? (
            <span className={formMessageClass(state.ok)}>
              {state.message}
            </span>
          ) : null}
        </div>
      </form>

      {attachments.length === 0 ? (
        // 空状态一律 well 面板 + 单色插画（CLAUDE.md），白卡留给正式内容
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-10 text-center">
          <FolderArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            还没有上传任何材料。申报书、立项通知、结题报告都可以放这里，按类型归好档。
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {zipEnabled ? <ZipToolbar projectId={owner.id} selected={selected} /> : null}

          {grouped.map((group) => (
            <section key={group.kind} className="space-y-2">
              <h3 className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                {group.label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                  {group.items.length}
                </span>
              </h3>

              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li key={item.id} className="surface flex flex-wrap items-center gap-3 p-3.5">
                    {zipEnabled ? (
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                        aria-label={`勾选 ${item.filename}`}
                        className="size-4 shrink-0 rounded border-input"
                      />
                    ) : null}
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={item.filename}>
                        {item.filename}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.code ? `${item.code} · ` : ""}
                        {formatFileSize(item.size)} · {formatTimestampDate(item.uploadedAt)}
                        {item.note ? ` · ${item.note}` : ""}
                      </p>
                      {requirementsByAttachment?.[item.id]?.length ? (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {requirementsByAttachment[item.id].map((summary) => (
                            <span
                              key={summary.label}
                              title={summary.title}
                              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {summary.label}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {item.previewable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreview(item)}
                        >
                          <Eye className="size-3.5" aria-hidden />
                          预览
                        </Button>
                      ) : null}

                      <Button
                        render={<a href={`/api/attachments/${item.id}?download=1`} download />}
                        nativeButton={false}
                        variant="ghost"
                        size="sm"
                      >
                        <Download className="size-3.5" aria-hidden />
                        下载
                      </Button>

                      <DeleteButton
                        attachmentId={item.id}
                        ownerPath={ownerPath}
                        filename={item.filename}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {preview ? <PreviewDialog item={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

/**
 * 材料 ZIP 下载（规格 7.4）。
 *
 * 两个**并列的原生表单**，不是一个表单两个按钮：整包下载不能带上
 * `attachmentIds`，而勾选下载必须带——同一个表单做不到，
 * 而原生表单 POST 又是拿到流式响应最省事的方式（不用 fetch + blob，
 * 浏览器自己处理下载和文件名）。
 */
function ZipToolbar({
  projectId,
  selected,
}: {
  projectId: string;
  selected: ReadonlySet<string>;
}) {
  return (
    <div className="surface flex flex-wrap items-center gap-3 p-3.5">
      <form action="/api/export/project-materials" method="post">
        <input type="hidden" name="projectId" value={projectId} />
        <Button type="submit" size="sm" variant="secondary">
          <Download className="size-3.5" aria-hidden />
          下载全部材料
        </Button>
      </form>

      <form action="/api/export/project-materials" method="post">
        <input type="hidden" name="projectId" value={projectId} />
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="attachmentIds" value={id} />
        ))}
        <Button type="submit" size="sm" variant="ghost" disabled={selected.size === 0}>
          <Download className="size-3.5" aria-hidden />
          下载勾选的 {selected.size > 0 ? selected.size : ""}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        整包还会带上已挂接成果的证据材料；同一份只进包一次
      </p>
    </div>
  );
}

function DeleteButton({
  attachmentId,
  ownerPath,
  filename,
}: {
  attachmentId: string;
  ownerPath: string;
  filename: string;
}) {
  const remove = deleteAttachment.bind(null, attachmentId, ownerPath);

  return (
    <form
      action={remove}
      onSubmit={(e) => {
        // 删了磁盘上的文件就找不回来了，问一句
        if (!confirm(`删除「${filename}」？磁盘上的文件会一并删掉，无法恢复。`)) {
          e.preventDefault();
        }
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        title="删除"
        aria-label={`删除 ${filename}`}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </Button>
    </form>
  );
}

/** PDF 与图片直接嵌进来看，省得为了瞄一眼先下载 */
function PreviewDialog({ item, onClose }: { item: AttachmentItem; onClose: () => void }) {
  return (
    <div
      // 深色下遮罩要更黑：页面本身已经接近纯黑，60% 的罩子压不住底下的内容
      className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4 sm:p-8 dark:bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${item.filename}`}
      onClick={onClose}
    >
      <div
        // **浮层不能用 bg-card。** 深色下 --card 是半透明白，
        // 铺在遮罩上会把底下的页面漏出来；浮层一律走不透明的 --popover
        className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.filename}</p>
            <p className="text-xs text-muted-foreground">
              {ATTACHMENT_KIND_LABELS[item.kind]} · {formatFileSize(item.size)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              render={<a href={`/api/attachments/${item.id}?download=1`} download />}
              nativeButton={false}
              variant="ghost"
              size="sm"
            >
              <Download className="size-3.5" aria-hidden />
              下载
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>

        {item.mimeType.startsWith("image/") ? (
          <div className="flex-1 overflow-auto bg-muted/40 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/attachments/${item.id}`}
              alt={item.filename}
              className="mx-auto max-w-full"
            />
          </div>
        ) : (
          <iframe
            src={`/api/attachments/${item.id}`}
            title={item.filename}
            className="flex-1 border-0"
          />
        )}
      </div>
    </div>
  );
}
