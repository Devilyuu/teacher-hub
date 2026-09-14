"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Link2Off, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { ACHIEVEMENT_TYPE_LABELS, ATTACHMENT_KIND_LABELS } from "@/lib/labels";
import {
  linkRequirementMaterial,
  setRequirementMaterialQualified,
  unlinkRequirementMaterial,
} from "@/lib/actions/material-actions";
import { uploadRequirementReport } from "@/lib/actions/attachment-actions";
import {
  linkAchievement,
  setQualified,
  unlinkAchievement,
} from "./requirement-actions";
import type { AchievementType, AttachmentKind } from "@/lib/generated/prisma/enums";

/** 挂接区里的两个原生 select 共用一套样式 */
const SELECT_CLASS =
  "h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

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

/**
 * 达标勾选。**这是全站唯一决定"算不算达标"的入口**，
 * 必须由人点，系统不会因为约束校验全过就替你勾上。
 */
export function QualifyControl({
  linkId,
  projectId,
  isQualified,
  qualifyNote,
}: {
  linkId: string;
  projectId: string;
  isQualified: boolean;
  qualifyNote: string | null;
}) {
  const action = setQualified.bind(null, projectId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const [checked, setChecked] = useState(isQualified);
  const [open, setOpen] = useState(false);

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="linkId" value={linkId} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isQualified"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked);
              // 勾上时展开说明框，鼓励写清楚"凭什么算达标"
              if (e.target.checked) setOpen(true);
            }}
            className="size-4 rounded border-input"
          />
          确认达标
        </label>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            {qualifyNote ? "查看/修改说明" : "补充说明"}
          </button>
        ) : null}

        <PendingButton type="submit" size="sm" variant="secondary">
          保存
        </PendingButton>

        {state.message ? (
          <span className={formMessageClass(state.ok)}>
            {state.message}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-1">
          <Label htmlFor={`note-${linkId}`} className="text-xs font-normal text-muted-foreground">
            确认说明（凭什么算达标，如「已见刊，见 2026-09 期第 12 页」）
          </Label>
          <Textarea
            id={`note-${linkId}`}
            name="qualifyNote"
            rows={2}
            defaultValue={qualifyNote ?? ""}
          />
        </div>
      ) : (
        <input type="hidden" name="qualifyNote" value={qualifyNote ?? ""} />
      )}
    </form>
  );
}

/** 课题材料自己的人工达标入口；上传或关联动作都不会替用户勾选。 */
export function MaterialQualifyControl({
  linkId,
  projectId,
  isQualified,
  qualifyNote,
}: {
  linkId: string;
  projectId: string;
  isQualified: boolean;
  qualifyNote: string | null;
}) {
  const action = setRequirementMaterialQualified.bind(null, projectId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const [checked, setChecked] = useState(isQualified);
  const [open, setOpen] = useState(false);

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="linkId" value={linkId} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isQualified"
            checked={checked}
            onChange={(event) => {
              setChecked(event.target.checked);
              if (event.target.checked) setOpen(true);
            }}
            className="size-4 rounded border-input"
          />
          确认材料达标
        </label>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            {qualifyNote ? "查看/修改说明" : "补充说明"}
          </button>
        ) : null}

        <PendingButton type="submit" size="sm" variant="secondary">
          保存
        </PendingButton>

        {state.message ? (
          <span
            className={
              formMessageClass(state.ok)
            }
          >
            {state.message}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-1">
          <Label
            htmlFor={`material-note-${linkId}`}
            className="text-xs font-normal text-muted-foreground"
          >
            确认说明（如「报告终稿已提交」）
          </Label>
          <Textarea
            id={`material-note-${linkId}`}
            name="qualifyNote"
            rows={2}
            defaultValue={qualifyNote ?? ""}
          />
        </div>
      ) : (
        <input type="hidden" name="qualifyNote" value={qualifyNote ?? ""} />
      )}
    </form>
  );
}

export function UnlinkButton({ linkId, projectId }: { linkId: string; projectId: string }) {
  const unlink = unlinkAchievement.bind(null, linkId, projectId);

  return (
    <form action={unlink}>
      <PendingButton
        type="submit"
        size="sm"
        variant="ghost"
        className="h-7 text-muted-foreground"
        title="解除挂接"
      >
        <Link2Off className="size-3.5" aria-hidden />
        解除
      </PendingButton>
    </form>
  );
}

export type LinkCandidate = {
  id: string;
  title: string;
  type: AchievementType;
};

export function LinkAchievementForm({
  requirementId,
  projectId,
  candidates,
}: {
  requirementId: string;
  projectId: string;
  candidates: LinkCandidate[];
}) {
  const action = linkAchievement.bind(null, projectId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        成果库里没有可挂接的独立成果。论文、专利或可独立认定的研究报告请先到
        <Link href="/achievements/new" className="mx-1 underline underline-offset-4">
          成果库新建
        </Link>
        ；纯结题报告请使用下面的「上传结题报告」。
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requirementId" value={requirementId} />

      <select name="achievementId" defaultValue="" className={`${SELECT_CLASS} flex-1`}>
        <option value="">选择要挂接的成果…</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            [{ACHIEVEMENT_TYPE_LABELS[candidate.type]}] {candidate.title}
          </option>
        ))}
      </select>

      <PendingButton type="submit" size="sm" variant="secondary">
        挂接
      </PendingButton>

      {state.message ? (
        <span className={formMessageClass(state.ok)}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

// ─── 课题材料关联（规格 6.4 / 7.4） ──────────────────────────────────

export type MaterialCandidate = {
  id: string;
  kind: AttachmentKind;
  filename: string;
  code: string | null;
};

/**
 * 在结题要求下直接上传报告：固定保存成当前课题的 FINAL_REPORT，
 * 并在同一事务中建立 RequirementAttachment。它不是成果登记入口。
 */
export function UploadRequirementReportForm({
  requirementId,
  projectId,
  legacyAchievementId,
}: {
  requirementId: string;
  projectId: string;
  legacyAchievementId?: string;
}) {
  const action = uploadRequirementReport.bind(null, projectId, requirementId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  return (
    <form
      action={formAction}
      className="space-y-2 rounded-xl bg-muted/40 p-3"
      onSubmit={(event) => {
        if (
          legacyAchievementId &&
          !confirm("上传后将保留当前达标状态，并删除成果库里的旧研究报告记录。继续吗？")
        ) {
          event.preventDefault();
        }
      }}
    >
      {legacyAchievementId ? (
        <input type="hidden" name="legacyAchievementId" value={legacyAchievementId} />
      ) : null}
      <p className="text-xs font-medium">
        {legacyAchievementId ? "迁为课题结题材料" : "上传结题报告"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="file"
          type="file"
          required
          aria-invalid={state.fieldErrors?.file ? true : undefined}
          className="h-8 min-w-64 flex-1"
        />
        <Input name="note" placeholder="版本说明（选填）" className="h-8 sm:w-56" />
        <PendingButton type="submit" size="sm" variant="secondary">
          <Upload className="size-3.5" aria-hidden />
          {legacyAchievementId ? "迁移并删除旧成果" : "上传并关联"}
        </PendingButton>
      </div>
      {state.fieldErrors?.file?.map((error) => (
        <p key={error} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ))}
      {state.message ? (
        <p
          className={
            formMessageClass(state.ok)
          }
        >
          {state.message}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {legacyAchievementId
            ? "上传真实报告文件后，系统会保留当前达标状态并删除这条仅用于结题的成果记录。"
            : "作为本课题的结题材料保存，不进入成果、绩效或职称列表；上传后仍需人工确认达标。"}
        </p>
      )}
    </form>
  );
}

/**
 * 把一份课题材料关联到这条要求项上。
 *
 * **只列课题级材料。** 成果级证据（论文 PDF、录用通知）不出现在这里——
 * 它们跟着所挂接的成果自动到达要求项，再手动关联一次就会在材料 ZIP 里重复。
 *
 * 关联不是达标：关联只说明「这份材料用来说明这条要求」，
 * 达标仍然只能靠上面那个复选框人工勾（CLAUDE.md 第 1 条）。
 */
export function LinkMaterialForm({
  requirementId,
  projectId,
  candidates,
}: {
  requirementId: string;
  projectId: string;
  candidates: MaterialCandidate[];
}) {
  const action = linkRequirementMaterial.bind(null, projectId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        课题材料都关联过了。新材料在「材料」里上传后会出现在这里。
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requirementId" value={requirementId} />

      <select name="attachmentId" defaultValue="" className={`${SELECT_CLASS} flex-1`}>
        <option value="">关联一份课题材料…</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            [{ATTACHMENT_KIND_LABELS[candidate.kind]}]{" "}
            {candidate.code ? `${candidate.code} ` : ""}
            {candidate.filename}
          </option>
        ))}
      </select>

      <Input
        name="note"
        placeholder="说明（选填），如「第三章对应中期指标」"
        className="h-8 w-full text-sm sm:w-64"
      />

      <PendingButton type="submit" size="sm" variant="secondary">
        关联
      </PendingButton>

      {state.message ? (
        <span
          className={
            formMessageClass(state.ok)
          }
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** 解除关联。只删连接，磁盘上的材料本体不动 */
export function UnlinkMaterialButton({
  linkId,
  projectId,
  filename,
}: {
  linkId: string;
  projectId: string;
  filename: string;
}) {
  const unlink = unlinkRequirementMaterial.bind(null, linkId, projectId);

  return (
    <form action={unlink}>
      <PendingButton
        type="submit"
        size="sm"
        variant="ghost"
        className="h-7 text-muted-foreground"
        title="解除关联"
        aria-label={`解除关联 ${filename}`}
      >
        <Link2Off className="size-3.5" aria-hidden />
        解除
      </PendingButton>
    </form>
  );
}
