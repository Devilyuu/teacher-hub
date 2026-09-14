"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import type { RelationRow } from "./roster-panel";
import {
  createStudentRelation,
  deleteStudentRelation,
  toggleRelationResolved,
} from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "记录"}
    </Button>
  );
}

/**
 * 矛盾关系面板。放在名册页下方而不是独立 tab：
 * 它是名册的注脚，不是一个「功能」。
 */
export function RelationsPanel({
  students,
  relations,
}: {
  students: Array<{ id: string; name: string }>;
  relations: RelationRow[];
}) {
  const [state, action] = useActionState(createStudentRelation, IDLE_FORM_STATE);

  return (
    <section className="space-y-3">
      <h2 className="px-1 text-sm font-medium">矛盾关系</h2>
      <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
        谁和谁有矛盾记在这里，排宿舍、分组、排座位时扫一眼。宿舍视图里同屋且未化解的会自动提示。
        <span className="text-foreground">化解了标掉就行，别删</span>
        ——「他俩以前闹过」在重新分组时仍是有用信息。
      </p>

      <form action={action} className="surface space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
          <select aria-label="学生一" name="studentAId" className={selectClass} required>
            <option value="">选学生…</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
          <select aria-label="学生二" name="studentBId" className={selectClass} required>
            <option value="">选学生…</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
          <Input name="note" placeholder="一句话：因为什么、什么程度" required />
          <SubmitButton />
        </div>
        {state.message ? (
          <p className={formMessageClass(state.ok)}>{state.message}</p>
        ) : null}
      </form>

      {relations.length === 0 ? null : (
        <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
          {relations.map((relation) => (
            <li key={relation.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className={relation.resolved ? "text-sm text-muted-foreground line-through" : "text-sm"}>
                {relation.studentAName} × {relation.studentBName}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={relation.note}>
                {relation.note}
              </span>
              <form action={toggleRelationResolved.bind(null, relation.id, !relation.resolved)}>
                <Button type="submit" variant="ghost" size="sm" className="text-xs text-muted-foreground">
                  {relation.resolved ? "标回未化解" : "标记已化解"}
                </Button>
              </form>
              <form action={deleteStudentRelation.bind(null, relation.id)}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`删除 ${relation.studentAName} 与 ${relation.studentBName} 的矛盾记录`}
                  onClick={(event) => {
                    if (!confirm("删除这条矛盾记录？（化解了的话用「标记已化解」，别删）"))
                      event.preventDefault();
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
