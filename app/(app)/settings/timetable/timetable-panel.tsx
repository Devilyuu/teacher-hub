"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Eraser, FileUp, Plus, Trash2 } from "lucide-react";
import { ClearCalendarArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addTimetableSlot,
  clearTimetable,
  deleteTimetableSlot,
  importTimetable,
  type TimetableImportState,
} from "@/lib/actions/timetable-actions";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import {
  formatClassName,
  formatPeriodRange,
  HALF_DAY_LABELS,
  halfDayOf,
  WEEKDAY_LABELS,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";

export type TimetableSemesterRow = {
  id: string;
  name: string;
  startText: string;
  count: number;
};

export type TimetableSlotRow = {
  id: string;
  weekday: number;
  periodStart: number;
  periodEnd: number;
  weeksText: string;
  courseName: string;
  className: string | null;
  location: string | null;
};

const IDLE_IMPORT_STATE: TimetableImportState = { ok: false };

function PendingButton({
  idle,
  pending,
  ...props
}: React.ComponentProps<typeof Button> & { idle: React.ReactNode; pending: React.ReactNode }) {
  const status = useFormStatus();
  return (
    <Button type="submit" disabled={status.pending} {...props}>
      {status.pending ? pending : idle}
    </Button>
  );
}

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

/**
 * 导入表单。**两次提交同一个文件**：先「解析预览」，看过之后「确认导入」。
 * fileKey 随第二次提交回到服务端核对是不是同一个文件。
 *
 * **文件存在 ref 里，不指望 input 留着它。** React 19 在 Server Action 跑完后
 * 会把表单重置，未受控的 `<input type=file>` 随之清空——预览一回来文件就没了，
 * 点「确认导入」只会撞上浏览器的「请选择一个文件」。所以 onChange 时把 File
 * 收进 ref，提交前发现表单里没文件就用 ref 里那份补上；input 也不能标
 * `required`，否则原生校验在客户端就把第二次提交拦了。
 */
function ImportForm() {
  const fileRef = useRef<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [state, action] = useActionState(
    async (prev: TimetableImportState, formData: FormData) => {
      const picked = formData.get("file");
      if (!(picked instanceof File) || picked.size === 0) {
        if (fileRef.current) formData.set("file", fileRef.current);
      } else {
        fileRef.current = picked;
      }
      return importTimetable(prev, formData);
    },
    IDLE_IMPORT_STATE,
  );
  const preview = state.preview;

  return (
    <form action={action} className="surface space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="timetable-file">教务系统导出的课表</Label>
          <Input
            id="timetable-file"
            name="file"
            type="file"
            accept=".xls,.xlsx"
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0] ?? null;
              fileRef.current = picked;
              setFileName(picked?.name ?? null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {fileName ? (
              <>
                已选 <span className="text-foreground">{fileName}</span>。
              </>
            ) : null}
            教务系统「我的课表 → 导出」得到的 .xls 直接传，不用另存。学期和开学日都写在表里，会一起读出来。
          </p>
        </div>
        <PendingButton
          size="sm"
          variant={preview ? "outline" : "default"}
          idle={
            <>
              <FileUp className="size-3.5" aria-hidden />
              解析预览
            </>
          }
          pending="解析中…"
        />
      </div>

      {preview ? <input type="hidden" name="fileKey" value={preview.fileKey} /> : null}

      {state.message ? (
        <p className={formMessageClass(state.ok)}>{state.message}</p>
      ) : null}

      {preview && !state.ok ? (
        <div className="space-y-3 border-t border-border/40 pt-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">{preview.semesterName ?? "学期未知"}</span>
            {preview.startDate ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                开学 {preview.startDate}
                {preview.totalWeeks ? ` · 共 ${preview.totalWeeks} 周` : ""}
              </span>
            ) : null}
            {preview.teacherName ? (
              <span className="text-xs text-muted-foreground">{preview.teacherName}</span>
            ) : null}
            <span className="text-xs text-muted-foreground tabular-nums">
              解析出 {preview.slots.length} 条
            </span>
          </div>

          {/* 提示都是软的：不一致、被跳过都只告诉你，导入照常 */}
          <div className="measure space-y-1 text-xs text-muted-foreground">
            {preview.existing ? (
              <p>
                学期已存在，确认后会
                <span className="text-foreground">替换它现有的 {preview.replacingCount} 条</span>
                课表。
              </p>
            ) : preview.startDate ? (
              <p>
                库里还没有这个学期，确认后会按表里的开学日
                <span className="text-foreground">新建学期「{preview.semesterName}」</span>。
              </p>
            ) : null}
            {preview.startDateMismatch && preview.existing ? (
              <p>
                表里写的开学日 {preview.startDate} 和设置里的 {preview.existing.startDate} 不一样。
                导入不会改学期的开学日；哪个对，到设置页核一下。
              </p>
            ) : null}
            {preview.skipped.length > 0 ? (
              <div>
                <p>有 {preview.skipped.length} 条没认出来，不会导入：</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.skipped.map((item) => (
                    <li key={`${item.weekday}-${item.text}`} className="truncate font-mono text-[11px]">
                      {WEEKDAY_LABELS[item.weekday]} · {item.reason} · {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <SlotTable
            rows={preview.slots.map((slot, index) => ({ ...slot, id: String(index) }))}
          />

          {preview.blocker ? (
            <p className={formMessageClass("warning")}>{preview.blocker}</p>
          ) : (
            <PendingButton
              size="sm"
              name="mode"
              value="confirm"
              idle="确认导入"
              pending="导入中…"
            />
          )}
        </div>
      ) : null}
    </form>
  );
}

/** 条目表。预览和正式列表共用，正式列表多一列删除 */
function SlotTable({
  rows,
  onDelete,
}: {
  rows: TimetableSlotRow[];
  onDelete?: (id: string) => void;
}) {
  return (
    <Table containerClassName="overflow-x-auto rounded-2xl bg-well/60">
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">周几</TableHead>
          <TableHead className="w-20">节次</TableHead>
          <TableHead className="w-16">半天</TableHead>
          <TableHead className="w-32">周次</TableHead>
          <TableHead>课程</TableHead>
          <TableHead>班级</TableHead>
          <TableHead>地点</TableHead>
          {onDelete ? <TableHead className="w-10" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{WEEKDAY_LABELS[row.weekday]}</TableCell>
            <TableCell className="tabular-nums">{formatPeriodRange(row.periodStart, row.periodEnd)}</TableCell>
            <TableCell className="text-muted-foreground">{HALF_DAY_LABELS[halfDayOf(row.periodStart)]}</TableCell>
            <TableCell className="tabular-nums">{row.weeksText}</TableCell>
            <TableCell className="max-w-56 truncate" title={row.courseName}>
              {row.courseName}
            </TableCell>
            <TableCell className="max-w-56 truncate text-muted-foreground" title={row.className ?? ""}>
              {formatClassName(row.className) ?? "—"}
            </TableCell>
            <TableCell className="max-w-48 truncate text-muted-foreground" title={row.location ?? ""}>
              {row.location ?? "—"}
            </TableCell>
            {onDelete ? (
              <TableCell>
                <form action={() => onDelete(row.id)}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`删除 ${WEEKDAY_LABELS[row.weekday]} ${row.courseName}`}
                    onClick={(event) => {
                      if (!confirm(`删除 ${WEEKDAY_LABELS[row.weekday]} ${formatPeriodRange(row.periodStart, row.periodEnd)} 的「${row.courseName}」？`))
                        event.preventDefault();
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </form>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ManualAddForm({ semesterId }: { semesterId: string }) {
  const [state, action] = useActionState(addTimetableSlot, IDLE_FORM_STATE);
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full bg-well px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <Plus className="size-3.5" aria-hidden />
        手工补一条
      </summary>
      <form action={action} className="surface mt-3 space-y-3 p-5">
        <input type="hidden" name="semesterId" value={semesterId} />
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="slot-weekday">周几</Label>
            {/* 表单一律原生 select：shadcn Select 的值不进 FormData（代码约定） */}
            <select
              id="slot-weekday"
              name="weekday"
              defaultValue="1"
              className="h-8 w-full rounded-full border border-input bg-transparent px-3 text-sm"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
                <option key={weekday} value={weekday}>
                  {WEEKDAY_LABELS[weekday]}
                </option>
              ))}
            </select>
            <FieldErrors errors={state.fieldErrors?.weekday} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-period-start">起始节</Label>
            <Input id="slot-period-start" name="periodStart" type="number" min={1} max={14} defaultValue={1} required />
            <FieldErrors errors={state.fieldErrors?.periodStart} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-period-end">结束节</Label>
            <Input id="slot-period-end" name="periodEnd" type="number" min={1} max={14} defaultValue={2} required />
            <FieldErrors errors={state.fieldErrors?.periodEnd} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-weeks">周次</Label>
            <Input id="slot-weeks" name="weeksText" placeholder="如 10-13周 或 13周,18-19周" required />
            <FieldErrors errors={state.fieldErrors?.weeksText} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="slot-course">课程</Label>
            <Input id="slot-course" name="courseName" required />
            <FieldErrors errors={state.fieldErrors?.courseName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-class">班级</Label>
            <Input id="slot-class" name="className" placeholder="可空" />
            <FieldErrors errors={state.fieldErrors?.className} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-location">地点</Label>
            <Input id="slot-location" name="location" placeholder="可空" />
            <FieldErrors errors={state.fieldErrors?.location} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PendingButton size="sm" idle="添加" pending="添加中…" />
          {state.message ? (
            <p className={formMessageClass(state.ok)}>{state.message}</p>
          ) : null}
        </div>
      </form>
    </details>
  );
}

export function TimetablePanel({
  semesters,
  selectedId,
  slots,
}: {
  semesters: TimetableSemesterRow[];
  selectedId: string | null;
  slots: TimetableSlotRow[];
}) {
  const selected = semesters.find((semester) => semester.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">导入</h2>
        <ImportForm />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 px-1">
          <h2 className="text-sm font-medium">课表</h2>
          {/* 学期胶囊：未选中走 well 无阴影，选中才是墨色实心（视觉语言） */}
          {semesters.map((semester) => (
            <Link
              key={semester.id}
              href={`/settings/timetable?semester=${semester.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
                semester.id === selectedId
                  ? "bg-primary text-primary-foreground"
                  : "bg-well text-muted-foreground hover:text-foreground",
              )}
            >
              {semester.name}
              <span className="tabular-nums opacity-70">{semester.count}</span>
            </Link>
          ))}
          {selected && slots.length > 0 ? (
            <form action={clearTimetable.bind(null, selected.id)} className="ml-auto">
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={(event) => {
                  if (!confirm(`清空「${selected.name}」的 ${slots.length} 条课表？学期本身保留。`))
                    event.preventDefault();
                }}
              >
                <Eraser className="size-3.5" aria-hidden />
                清空
              </Button>
            </form>
          ) : null}
        </div>

        {!selected ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl bg-well p-10 text-center">
            <ClearCalendarArt className="size-12 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">还没有学期。上面传一份课表，学期会一起建好。</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl bg-well p-10 text-center">
            <ClearCalendarArt className="size-12 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              {selected.name}（开学 {selected.startText}）还没有课表。
            </p>
          </div>
        ) : (
          <div className="surface p-2">
            <SlotTable rows={slots} onDelete={(id) => void deleteTimetableSlot(id)} />
          </div>
        )}

        {selected ? <ManualAddForm semesterId={selected.id} /> : null}
      </section>
    </div>
  );
}
