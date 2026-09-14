"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { DoorOpen, Plus, Rows3 } from "lucide-react";
import { ClipboardArt } from "@/components/empty-art";
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
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { bulkImportStudents, createStudent } from "./actions";

export type StudentRow = {
  id: string;
  name: string;
  studentNo: string | null;
  phone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  dormRoom: string | null;
  internshipUnit: string | null;
  note: string | null;
  active: boolean;
};

export type RelationRow = {
  id: string;
  studentAId: string;
  studentAName: string;
  studentBId: string;
  studentBName: string;
  note: string;
  resolved: boolean;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

/** 学生姓名统一链到卡片页——电话、备注、记录都在那儿 */
function StudentLink({ id, name, active }: { id: string; name: string; active: boolean }) {
  return (
    <Link
      href={`/students/${id}`}
      className={
        active
          ? "font-medium underline-offset-4 hover:underline"
          : "text-muted-foreground underline-offset-4 hover:underline"
      }
    >
      {name}
      {active ? "" : "（已离班）"}
    </Link>
  );
}

function AddStudentForm({ classGroupId, onDone }: { classGroupId: string; onDone: () => void }) {
  const [state, action] = useActionState(
    createStudent.bind(null, classGroupId),
    IDLE_FORM_STATE,
  );

  return (
    <form action={action} className="surface space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="student-name">姓名</Label>
          <Input id="student-name" name="name" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-no">学号</Label>
          <Input id="student-no" name="studentNo" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-dorm">宿舍</Label>
          <Input id="student-dorm" name="dormRoom" placeholder="如 5-302" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-phone">手机</Label>
          <Input id="student-phone" name="phone" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-parent-name">家长</Label>
          <Input id="student-parent-name" name="parentName" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-parent-phone">家长电话</Label>
          <Input id="student-parent-phone" name="parentPhone" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-internship">实习单位</Label>
          <Input id="student-internship" name="internshipUnit" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-internship-contact">驻点联系人</Label>
          <Input id="student-internship-contact" name="internshipContact" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-note">备注</Label>
          <Input id="student-note" name="note" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label="添加" />
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

function BulkImportForm({ classGroupId, onDone }: { classGroupId: string; onDone: () => void }) {
  const [state, action] = useActionState(
    bulkImportStudents.bind(null, classGroupId),
    IDLE_FORM_STATE,
  );

  return (
    <form action={action} className="surface space-y-3 p-5">
      <div className="space-y-1.5">
        <Label htmlFor="bulk-lines">粘贴名单，一行一个学生</Label>
        <textarea
          id="bulk-lines"
          name="lines"
          rows={8}
          required
          placeholder={"从 Excel 整块复制过来即可。列序：\n姓名\t学号\t手机\t家长电话\t宿舍\n后四列都可以没有，只贴一列姓名也行。"}
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="measure text-xs text-muted-foreground">
          已在名册里的同名学生会跳过，所以整表重复粘贴是安全的。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label="导入" />
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

/** 宿舍分组视图。分组本身就是排错器：打错的宿舍号会裂成孤零零的一行 */
function DormView({
  students,
  relations,
}: {
  students: StudentRow[];
  relations: RelationRow[];
}) {
  const active = students.filter((student) => student.active);
  const groups = new Map<string, StudentRow[]>();
  for (const student of active) {
    const key = student.dormRoom?.trim() || "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(student);
    else groups.set(key, [student]);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => {
    // 未填的排最后，其余按宿舍号
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b, "zh-CN", { numeric: true });
  });

  const unresolved = relations.filter((relation) => !relation.resolved);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map(([dorm, occupants]) => {
        const ids = new Set(occupants.map((student) => student.id));
        // 同屋且未化解的矛盾——只提示，怎么调宿舍是人的决定（铁律 1）
        const conflicts = unresolved.filter(
          (relation) => ids.has(relation.studentAId) && ids.has(relation.studentBId),
        );
        return (
          <section key={dorm || "＿none"} className="surface space-y-2 p-4">
            <h3 className="flex items-baseline gap-2 text-sm font-medium">
              {dorm || "未填宿舍"}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {occupants.length} 人
              </span>
            </h3>
            <p className="text-sm leading-relaxed">
              {occupants.map((student, index) => (
                <span key={student.id}>
                  {index > 0 ? "、" : ""}
                  <StudentLink id={student.id} name={student.name} active />
                </span>
              ))}
            </p>
            {conflicts.map((relation) => (
              <p
                key={relation.id}
                className="text-xs text-[var(--h-amber-fg)]"
              >
                同宿舍未化解矛盾：{relation.studentAName} × {relation.studentBName}
              </p>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function RosterPanel({
  classGroupId,
  students,
  relations,
}: {
  classGroupId: string;
  students: StudentRow[];
  relations: RelationRow[];
}) {
  const [mode, setMode] = useState<"idle" | "add" | "import">("idle");
  const [view, setView] = useState<"list" | "dorm">("list");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 视图切换：未选中走 well 无阴影，选中墨色实心（筛选胶囊的规矩） */}
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={view === "list" ? "default" : "ghost"}
            className={view === "list" ? undefined : "bg-well"}
            onClick={() => setView("list")}
          >
            <Rows3 className="size-3.5" aria-hidden />
            名单
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "dorm" ? "default" : "ghost"}
            className={view === "dorm" ? undefined : "bg-well"}
            onClick={() => setView("dorm")}
          >
            <DoorOpen className="size-3.5" aria-hidden />
            宿舍
          </Button>
        </div>
        {mode === "idle" ? (
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" className="bg-well" onClick={() => setMode("import")}>
              批量导入
            </Button>
            <Button type="button" onClick={() => setMode("add")}>
              <Plus className="size-4" aria-hidden />
              新增学生
            </Button>
          </div>
        ) : null}
      </div>

      {mode === "add" ? (
        <AddStudentForm classGroupId={classGroupId} onDone={() => setMode("idle")} />
      ) : null}
      {mode === "import" ? (
        <BulkImportForm classGroupId={classGroupId} onDone={() => setMode("idle")} />
      ) : null}

      {students.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
          <ClipboardArt className="size-12 text-muted-foreground/60" />
          <p className="measure text-sm text-muted-foreground">
            名册还是空的。点「批量导入」把 Excel 里的名单整块粘过来，一分钟完事。
          </p>
        </div>
      ) : view === "dorm" ? (
        <DormView students={students} relations={relations} />
      ) : (
        <div className="surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>学号</TableHead>
                <TableHead>手机</TableHead>
                <TableHead>家长</TableHead>
                <TableHead>宿舍</TableHead>
                <TableHead>实习单位</TableHead>
                <TableHead>备注</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow key={student.id} className={student.active ? undefined : "opacity-50"}>
                  <TableCell className="whitespace-nowrap">
                    <StudentLink id={student.id} name={student.name} active={student.active} />
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {student.studentNo ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {student.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {student.parentName || student.parentPhone
                      ? `${student.parentName ?? ""}${student.parentName && student.parentPhone ? " " : ""}${student.parentPhone ?? ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {student.dormRoom ?? "—"}
                  </TableCell>
                  {/* 长文本列限宽 + clamp + title 存全文（CLAUDE.md 视觉语言） */}
                  <TableCell className="max-w-[12rem]">
                    <span className="line-clamp-1 text-muted-foreground" title={student.internshipUnit ?? undefined}>
                      {student.internshipUnit ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[14rem]">
                    <span className="line-clamp-1 text-muted-foreground" title={student.note ?? undefined}>
                      {student.note ?? "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
