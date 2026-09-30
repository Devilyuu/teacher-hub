"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { ClipboardArt } from "@/components/empty-art";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { createMenteeProject, createMenteeProjectKind, deleteMenteeProjectKind } from "../actions";
import { ProjectMemberPicker } from "./member-picker";

export type ProjectKindRow = { id: string; name: string; projectCount: number };

export type ProjectRow = {
  id: string;
  title: string;
  kindName: string;
  schoolYear: string | null;
  outcomeText: string | null;
  memberNames: string[];
  /** 「开题 03-14」，没有节点时为 null */
  nextMilestoneText: string | null;
  milestoneCount: number;
  attachmentCount: number;
  recordCount: number;
  adopted: boolean;
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

function NewProjectForm({
  batchId,
  kinds,
  mentees,
  onDone,
}: {
  batchId: string;
  kinds: ProjectKindRow[];
  mentees: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [state, action] = useActionState(
    createMenteeProject.bind(null, batchId),
    IDLE_FORM_STATE,
  );

  return (
    <form action={action} className="surface space-y-4 p-5">
      <div className="space-y-1.5">
        <Label htmlFor="project-title">题目</Label>
        <Input
          id="project-title"
          name="title"
          required
          autoFocus
          placeholder="如「基于 AI 的非遗纹样生成工具」"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="project-kind">类型</Label>
          <select id="project-kind" name="kindId" className={selectClass} required>
            {kinds.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-year">学年</Label>
          {/* 原文照收，不解析成两个数字——学年跨年（第 8 条铁律） */}
          <Input id="project-year" name="schoolYear" placeholder="2025—2026 学年" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-outcome">结项情况</Label>
          <Input id="project-outcome" name="outcomeText" placeholder="出结果后再填" />
        </div>
      </div>

      <ProjectMemberPicker mentees={mentees} />

      <div className="space-y-1.5">
        <Label htmlFor="project-note">备注</Label>
        <Input id="project-note" name="note" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label="创建" />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          收起
        </Button>
        {state.message ? (
          <span className={formMessageClass(state.ok)}>{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}

export function MenteeProjectsPanel({
  batchId,
  kinds,
  mentees,
  projects,
}: {
  batchId: string;
  kinds: ProjectKindRow[];
  mentees: Array<{ id: string; name: string }>;
  projects: ProjectRow[];
}) {
  const [creating, setCreating] = useState(false);
  const [kindState, kindAction] = useActionState(
    createMenteeProjectKind,
    IDLE_FORM_STATE,
  );
  const [kindDeleteState, setKindDeleteState] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-4">
        {creating ? (
          <NewProjectForm
            batchId={batchId}
            kinds={kinds}
            mentees={mentees}
            onDone={() => setCreating(false)}
          />
        ) : (
          <div className="flex justify-end">
            <Button type="button" onClick={() => setCreating(true)} disabled={kinds.length === 0}>
              <Plus className="size-4" aria-hidden />
              新建项目
            </Button>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
            <ClipboardArt className="size-12 text-muted-foreground/60" />
            <p className="measure text-sm text-muted-foreground">
              还没有项目。毕设、大创、课程作品都放这儿——题目、节点日期、材料各归各位，
              答辩季那张「指导记录表」就是从这里导出去的。
            </p>
          </div>
        ) : (
          /* 一条记录不是一张卡片：整组共用一张 surface，行之间只用 divide-y */
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {projects.map((project) => (
              <li key={project.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/mentees/projects/${project.id}`}
                    className="min-w-0 font-medium underline-offset-4 hover:underline"
                  >
                    {project.title}
                  </Link>
                  {/* 分类标记一律无色——它是正交维度不是状态 */}
                  <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                    {project.kindName}
                  </span>
                  {project.adopted ? (
                    <span className="text-xs text-muted-foreground">已引用为成果</span>
                  ) : null}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {project.memberNames.length > 0
                      ? project.memberNames.join("、")
                      : "未挂学生"}
                  </span>
                  {project.schoolYear ? <span>{project.schoolYear}</span> : null}
                  {/* 只报事实，不算「还剩几天」——那是判定 */}
                  <span className="tabular-nums">
                    {project.nextMilestoneText ?? "未排节点"}
                  </span>
                  <span className="tabular-nums">
                    材料 {project.attachmentCount} · 指导 {project.recordCount}
                  </span>
                  {project.outcomeText ? (
                    <span className="max-w-[16rem] truncate" title={project.outcomeText}>
                      {project.outcomeText}
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-3">
        {/* 类型是字典表不是自由文本（第 12 条）：案例索引要按类型分组统计，
            「毕业设计」多打一个字就会被算成两类 */}
        <h2 className="px-1 text-sm font-medium">项目类型</h2>
        <form action={kindAction} className="surface space-y-3 p-4">
          <Input name="name" placeholder="毕业设计 / 大创项目 / 课程作品…" required />
          <div className="flex items-center gap-2">
            <SubmitButton label="添加" />
            {kindState.message ? (
              <span className={formMessageClass(kindState.ok)}>{kindState.message}</span>
            ) : null}
          </div>
        </form>
        {kinds.length === 0 ? (
          <p className="measure px-1 text-xs text-muted-foreground">
            先加一个类型才能建项目。
          </p>
        ) : (
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {kinds.map((kind) => (
              <li key={kind.id} className="flex items-center gap-2 px-3.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{kind.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {kind.projectCount} 个项目
                  </p>
                </div>
                <ConfirmSubmitButton
                  action={async () => {
                    const result = await deleteMenteeProjectKind(kind.id);
                    setKindDeleteState(result.ok ? null : (result.message ?? null));
                  }}
                  message={
                    kind.projectCount > 0
                      ? `「${kind.name}」下还有 ${kind.projectCount} 个项目，删不掉；确定要试吗？`
                      : `删除类型「${kind.name}」？删掉就没有了。`
                  }
                  size="icon-sm"
                  label={`删除类型 ${kind.name}`}
                >
                  <Trash2 className="size-3" aria-hidden />
                </ConfirmSubmitButton>
              </li>
            ))}
          </ul>
        )}
        {kindDeleteState ? (
          <p className="px-1 text-xs text-destructive">{kindDeleteState}</p>
        ) : null}
      </aside>
    </div>
  );
}
