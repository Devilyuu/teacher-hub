"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardPaste, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDispatchForm } from "@/components/use-dispatch-form";
import { importPastedRules, importRulePack, type RuleImportPreview, type RuleImportState } from "@/lib/actions/rule-actions";
import { formMessageClass } from "@/lib/form-state";
import { gridToTsv, guessColumnRoles, looksLikeHeader, parsePastedTable, roleLabel, rolesFor, type ColumnRole, type RuleTableKind } from "@/lib/import/pasted-table";
import { htmlTableToGrid } from "@/lib/import/clipboard-table";
import { cn } from "@/lib/utils";

const IDLE: RuleImportState = { ok: false };
const TABLE_LABELS: Record<RuleTableKind, string> = { promotion: "职称量化表", perf: "绩效对照表" };
/** 列设置那张小表只画前几行：看得出每一列是什么就够了，几十行全画出来反而找不到下拉 */
const PREVIEW_ROWS = 8;

/** 两张表单都不走 form 的 action（见 useDispatchForm），「提交中」由调用方传进来 */
function PendingButton({
  idle,
  pendingLabel,
  busy,
  ...props
}: React.ComponentProps<typeof Button> & { idle: React.ReactNode; pendingLabel: React.ReactNode; busy: boolean }) {
  return (
    <Button type="submit" {...props} disabled={busy || props.disabled}>
      {busy ? pendingLabel : idle}
    </Button>
  );
}

// ─── 预览 ───────────────────────────────────────────────────────────

const CHANGE_LABELS = { new: "新增", changed: "更新", same: "不变" } as const;

/**
 * 导入预览：会动哪几行、系统替人做了什么、读的时候有什么疑问。两条导入路共用。
 * 变化用中性的小胶囊标，不借健康度那几个语义色（CLAUDE.md 视觉语言）
 */
function ImportPreviewView({ preview }: { preview: RuleImportPreview }) {
  const groups = new Map<string, RuleImportPreview["diff"]["rows"]>();
  for (const row of preview.diff.rows) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
  const { counts } = preview.diff;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm">
          <span className="font-medium">
            {preview.year} 版{TABLE_LABELS[preview.table]}
          </span>
          <span className="ml-2 text-xs text-muted-foreground tabular-nums">
            共 {preview.diff.rows.length} 项 · 新增 {counts.new} · 更新 {counts.changed} · 不变 {counts.same}
          </span>
        </p>
        {preview.source ? <p className="text-xs text-muted-foreground">出处：{preview.source}</p> : null}
      </div>

      {preview.notes.length > 0 ? (
        <ul className="measure space-y-1 text-xs text-muted-foreground">
          {preview.notes.map((note) => (
            <li key={note}>· {note}</li>
          ))}
        </ul>
      ) : null}
      {preview.warnings.length > 0 ? (
        <ul className="measure space-y-1">
          {preview.warnings.map((warning) => (
            <li key={warning} className={formMessageClass("warning")}>
              · {warning}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.checks.length > 0 ? (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>封顶校验（各栏上限相加对不对得上表上写的总数）：</p>
          {preview.checks.map((check) => (
            <p key={check.label} className={check.ok ? undefined : formMessageClass("warning")}>
              {check.ok ? "✓" : "✗"} {check.label}：表上写 {check.expected}，各栏相加 {check.actual}
            </p>
          ))}
        </div>
      ) : null}

      <div className="space-y-3 rounded-2xl bg-well/60 p-3">
        {[...groups.entries()].map(([group, rows]) => (
          <div key={group} className="space-y-1">
            <p className="px-1 text-xs font-medium">{group}</p>
            <ul className="divide-y divide-border/40 rounded-xl bg-card">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm">{row.label}</p>
                    {row.detail ? (
                      <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground" title={row.detail}>
                        {row.detail}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs",
                      row.change === "new" ? "bg-primary/10 text-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {CHANGE_LABELS[row.change]}
                    {row.change === "changed" ? `：${row.changedFields.join("、")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {preview.diff.untouched.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            库里 {preview.year} 版另有 {preview.diff.untouched.length} 项这次没有（导入不删，原样保留；要删去分类表里删）
          </summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {preview.diff.untouched.map((row) => (
              <li key={row.label}>
                {row.label}
                {row.linkedCount > 0 ? `（挂了 ${row.linkedCount} 条记录）` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SuccessLine({ state }: { state: RuleImportState }) {
  if (!state.ok || !state.preview) return null;
  return (
    <p className={formMessageClass(true, "sm")} role="status">
      {state.message}。
      <Link
        href={`/settings/rules?table=${state.preview.table}&year=${state.preview.year}`}
        className="ml-1 underline underline-offset-4"
      >
        去分类表看看
      </Link>
    </p>
  );
}

// ─── 粘贴表格 ───────────────────────────────────────────────────────

/**
 * 粘贴导入。字段全是受控的，表单也**不走 form 的 action**（useDispatchForm）：
 * 走的话动作一跑完 React 就重置表单，「第一行是表头」在 DOM 上被复原成没勾，
 * 确认那一次提交上去的参数就和预览时对不上（2026-09-27 实测踩到）。
 *
 * 粘贴时先看剪贴板里有没有 HTML 表格：Excel、WPS、Word 复制的都有，
 * 合并单元格的结构只在它里面（lib/import/clipboard-table.ts）。有就按它展开再转成制表符文本；
 * 没有（从别的地方复制的纯文本）就照常粘贴。
 */
export function PasteImportForm({
  table,
  defaultYear,
  knownYears,
  currentSource,
}: {
  table: RuleTableKind;
  defaultYear: number;
  knownYears: number[];
  currentSource: string | null;
}) {
  const [text, setText] = useState("");
  const [year, setYear] = useState(String(defaultYear));
  const [source, setSource] = useState("");
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  const [roleOverrides, setRoleOverrides] = useState<Record<number, ColumnRole>>({});
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const { state, onSubmit, pending } = useDispatchForm(importPastedRules, IDLE);

  const grid = useMemo(() => parsePastedTable(text), [text]);
  const width = grid[0]?.length ?? 0;
  const hasHeader = headerOverride ?? (grid.length > 0 && looksLikeHeader(table, grid[0]!));
  const guessed = useMemo(() => guessColumnRoles(table, grid, hasHeader), [table, grid, hasHeader]);
  const roles = guessed.map((role, col) => roleOverrides[col] ?? role);
  const signature = JSON.stringify([text, hasHeader, roles, year, source]);
  // 预览之后又改了表格或列的设置：旧预览不能拿来确认，要重新预览（服务端也会核对 planKey）
  const stale = state.preview != null && submitted !== signature;
  const bodyRows = grid.slice(hasHeader ? 1 : 0);

  function replaceText(next: string, note: string | null) {
    setText(next);
    setRoleOverrides({});
    setHeaderOverride(null);
    setPasteNote(note);
  }

  return (
    <form
      onSubmit={(event) => {
        setSubmitted(signature);
        onSubmit(event);
      }}
      className="surface space-y-4 p-5"
    >
      <input type="hidden" name="table" value={table} />
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ClipboardPaste className="size-4 text-muted-foreground" aria-hidden />
          粘贴表格
        </h2>
        <p className="measure text-xs leading-relaxed text-muted-foreground">
          {"打开学校发的 Excel、WPS 或 Word，把整张表（连表头）选中复制，粘到下面。" +
            "PDF 里复制出来的通常不成表格，最好先找原始的 Excel / Word 版本。"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="paste-year">这是哪一年的表</Label>
          <Input
            id="paste-year"
            name="year"
            type="number"
            value={year}
            onChange={(event) => setYear(event.target.value)}
            required
          />
        </div>
        {table === "promotion" ? (
          <div className="space-y-1.5">
            <Label htmlFor="paste-source">出处（可空）</Label>
            <Input
              id="paste-source"
              name="source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={currentSource ?? "如「某校 2026 年专业技术职务评聘量化考核表」"}
            />
          </div>
        ) : (
          <input type="hidden" name="source" value="" />
        )}
      </div>
      {knownYears.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          库里已有 {knownYears.map((value) => `${value} 版`).join("、")}。填已有的年度就是更新那一版，填新年度就是新加一版。
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="paste-text">表格</Label>
        <Textarea
          id="paste-text"
          name="text"
          rows={6}
          value={text}
          onChange={(event) => replaceText(event.target.value, null)}
          onPaste={(event) => {
            const html = event.clipboardData.getData("text/html");
            const fromHtml = html ? htmlTableToGrid(html) : null;
            if (fromHtml && fromHtml.length > 0) {
              event.preventDefault();
              replaceText(gridToTsv(fromHtml), "按剪贴板里的表格结构读的：合并的单元格已经展开");
            }
          }}
          placeholder="在这里粘贴（Ctrl+V）"
          className="font-mono text-xs"
        />
        {pasteNote ? <p className="text-xs text-muted-foreground">{pasteNote}</p> : null}
      </div>

      {width > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              读到 {bodyRows.length} 行 × {width} 列
            </span>
            <label className="flex items-center gap-1.5 text-foreground">
              <input
                type="checkbox"
                name="hasHeader"
                checked={hasHeader}
                onChange={(event) => setHeaderOverride(event.target.checked)}
                className="size-4"
              />
              第一行是表头
            </label>
            <span>每一列是什么，在列头的下拉里改；用不上的列选「不导入」</span>
          </div>
          {roles.map((role, col) => (
            <input key={col} type="hidden" name="roles" value={role} />
          ))}
          <div className="overflow-x-auto rounded-2xl bg-well/60">
            <table className="w-full min-w-max text-xs">
              <thead>
                <tr>
                  {roles.map((role, col) => (
                    <th key={col} className="px-2 pt-2 pb-1 text-left align-bottom font-normal">
                      <select
                        aria-label={`第 ${col + 1} 列是什么`}
                        value={role}
                        onChange={(event) =>
                          setRoleOverrides((current) => ({ ...current, [col]: event.target.value as ColumnRole }))
                        }
                        className={cn(
                          "h-8 max-w-40 rounded-lg border border-input bg-card px-2 text-xs",
                          role === "ignore" && "text-muted-foreground",
                        )}
                      >
                        {rolesFor(table).map((value) => (
                          <option key={value} value={value}>
                            {roleLabel(table, value)}
                          </option>
                        ))}
                      </select>
                      {hasHeader ? (
                        <p className="mt-1 max-w-40 truncate px-0.5 text-muted-foreground" title={grid[0]![col]}>
                          {grid[0]![col] || "（无表头）"}
                        </p>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.slice(0, PREVIEW_ROWS).map((row, index) => (
                  <tr key={index} className="border-t border-border/40">
                    {row.map((cell, col) => (
                      <td
                        key={col}
                        className={cn(
                          "max-w-40 px-2 py-1.5 align-top",
                          roles[col] === "ignore" && "text-muted-foreground line-through",
                        )}
                      >
                        <span className="line-clamp-2" title={cell}>
                          {cell}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bodyRows.length > PREVIEW_ROWS ? (
            <p className="text-xs text-muted-foreground">另有 {bodyRows.length - PREVIEW_ROWS} 行没画出来，预览里会全部列出。</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <PendingButton
          size="sm"
          variant={state.preview && !stale ? "outline" : "default"}
          disabled={width === 0}
          idle="预览导入结果"
          pendingLabel="正在读…"
          busy={pending}
        />
        {!state.ok && state.message && !state.preview ? (
          <p className={formMessageClass(state.tone ?? false)}>{state.message}</p>
        ) : null}
      </div>

      {state.preview ? (
        <div className="space-y-4 border-t border-border/40 pt-4">
          <input type="hidden" name="planKey" value={state.preview.key} />
          {state.message && !state.ok ? <p className={formMessageClass(state.tone ?? false)}>{state.message}</p> : null}
          <SuccessLine state={state} />
          {stale ? (
            <p className={formMessageClass("warning")}>表格或列的设置改过了，先重新预览再确认。</p>
          ) : null}
          <ImportPreviewView preview={state.preview} />
          {!state.ok && !stale ? (
            <PendingButton size="sm" name="mode" value="confirm" idle="确认导入" pendingLabel="导入中…" busy={pending} />
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

// ─── 规则包 ─────────────────────────────────────────────────────────

/**
 * 规则包导入。同样不走 form 的 action（useDispatchForm）：走的话动作跑完 React 重置表单，
 * `<input type=file>` 里选好的文件随之清空（课表导入那个坑，那边是用 ref 兜的），
 * 预览一回来点「确认导入」就只剩一个空的文件框。
 */
export function PackImportForm() {
  const [fileName, setFileName] = useState<string | null>(null);
  const { state, onSubmit, pending } = useDispatchForm(importRulePack, IDLE);

  return (
    <form id="pack" onSubmit={onSubmit} className="surface scroll-mt-[calc(var(--topbar-h)+1rem)] space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <FileUp className="size-4 text-muted-foreground" aria-hidden />
          导入规则包
        </h2>
        <p className="measure text-xs leading-relaxed text-muted-foreground">
          {"同校同事在「职称表与绩效表」页点「导出规则包」得到的 .json 文件，选中就能导，不用再粘一遍表格。" +
            "职称表、绩效表的包都认，按文件内容分。"}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="pack-file">规则包文件</Label>
          <Input
            id="pack-file"
            name="file"
            type="file"
            accept=".json,application/json"
            onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? null)}
          />
          {fileName ? (
            <p className="text-xs text-muted-foreground">
              已选 <span className="text-foreground">{fileName}</span>
            </p>
          ) : null}
        </div>
        <PendingButton
          size="sm"
          variant={state.preview ? "outline" : "default"}
          idle="预览导入结果"
          pendingLabel="正在读…"
          busy={pending}
        />
      </div>

      {!state.preview && state.message ? (
        <p className={formMessageClass(state.tone ?? state.ok)}>{state.message}</p>
      ) : null}

      {state.preview ? (
        <div className="space-y-4 border-t border-border/40 pt-4">
          <input type="hidden" name="fileKey" value={state.preview.key} />
          {state.message && !state.ok ? <p className={formMessageClass(state.tone ?? false)}>{state.message}</p> : null}
          <SuccessLine state={state} />
          <ImportPreviewView preview={state.preview} />
          {!state.ok ? <PendingButton size="sm" name="mode" value="confirm" idle="确认导入" pendingLabel="导入中…" busy={pending} /> : null}
        </div>
      ) : null}
    </form>
  );
}
