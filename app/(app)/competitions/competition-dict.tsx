"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { LEVEL_LABELS } from "@/lib/labels";
import { LEVEL_OPTIONS } from "@/lib/options";
import { createCompetition, deleteCompetition } from "./actions";
import type { Level } from "@/lib/generated/prisma/enums";

export type CompetitionDictRow = {
  id: string;
  name: string;
  organizer: string | null;
  level: Level;
  entryCount: number;
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "添加"}
    </Button>
  );
}

/**
 * 赛事字典。**是表不是自由文本**（第 12 条铁律）——「全国职业院校技能大赛」
 * 多打一个字就会被算成两家，历年统计当场碎。
 *
 * 名称里不含赛项和届次：那两样每年变，属于参赛记录。
 */
export function CompetitionDict({ rows }: { rows: CompetitionDictRow[] }) {
  const [adding, setAdding] = useState(false);
  const [state, action] = useActionState(createCompetition, IDLE_FORM_STATE);

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium">赛事</h2>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setAdding((current) => !current)}
        >
          <Plus className="size-3.5" aria-hidden />
          添加
        </Button>
      </div>

      {adding ? (
        <form action={action} className="surface space-y-3 p-4">
          <div key={state.ok ? "saved" : "editing"} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">名称</Label>
              <Input id="name" name="name" placeholder="全国职业院校技能大赛" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="organizer">主办单位</Label>
              <Input id="organizer" name="organizer" placeholder="教育部等" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="level">通常级别</Label>
              <select id="level" name="level" defaultValue="UNRATED" className={selectClass}>
                {LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                只当新建参赛时的默认值，每条记录可以自己改
              </p>
            </div>
            <input type="hidden" name="note" value="" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton />
            {state.message ? (
              <span className={formMessageClass(state.ok)}>{state.message}</span>
            ) : null}
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-3xl bg-well p-6 text-center text-xs text-muted-foreground">
          还没有赛事。新建参赛时可以现场添加，不必先来这里建。
        </div>
      ) : (
        <ul className="surface divide-y divide-border/40">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={row.name}>
                  {row.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {LEVEL_LABELS[row.level]}
                  {row.organizer ? ` · ${row.organizer}` : ""}
                  {row.entryCount > 0 ? ` · ${row.entryCount} 次参赛` : ""}
                </p>
              </div>
              {/* 有记录的赛事删不掉（库里外键是 Restrict）。
                  直接不给按钮，比点了没反应强 */}
              {row.entryCount === 0 ? (
                <form action={deleteCompetition}>
                  <input type="hidden" name="competitionId" value={row.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-muted-foreground"
                    aria-label={`删除 ${row.name}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
