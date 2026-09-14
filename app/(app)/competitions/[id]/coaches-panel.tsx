"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { saveCompetitionCoaches } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

/**
 * 合作指导教师。名录复用轮派那份字典（Teacher），在「日常 → 轮派」里添加。
 *
 * **本人不在这份名单里**——本人的排名是记录上的「我是第几指导」，
 * 那一格才是绩效和职称要看的东西。
 */
export function CoachesPanel({
  entryId,
  teachers,
  selected,
  myOrder,
}: {
  entryId: string;
  teachers: Array<{ id: string; name: string }>;
  selected: string[];
  myOrder: number | null;
}) {
  const [state, action] = useActionState(
    saveCompetitionCoaches.bind(null, entryId),
    IDLE_FORM_STATE,
  );
  const chosen = new Set(selected);

  return (
    <section className="space-y-3">
      <h2 className="px-1 text-sm font-medium">合作指导教师</h2>
      <p className="measure px-1 text-xs text-muted-foreground">
        {myOrder != null ? `你是第 ${myOrder} 指导教师。` : "你的排名在左边那张表里填。"}
        这里只记和你一起指导的人。
      </p>

      {teachers.length === 0 ? (
        <div className="rounded-3xl bg-well p-6 text-center text-xs text-muted-foreground">
          教师名录是空的。名录和轮派共用一份，在「日常 → 轮派」里添加。
        </div>
      ) : (
        <form action={action} className="surface space-y-3 p-4">
          <div key={`${selected.join(",")}-${state.ok}`} className="flex flex-wrap gap-1.5">
            {teachers.map((teacher) => (
              // 筛选/勾选胶囊：未选中走 well 无阴影，选中才是主色实心
              <label
                key={teacher.id}
                className="cursor-pointer"
                title={teacher.name}
              >
                <input
                  type="checkbox"
                  name="coachIds"
                  value={teacher.id}
                  defaultChecked={chosen.has(teacher.id)}
                  className="peer sr-only"
                />
                <span className="inline-flex items-center rounded-full bg-well px-3 py-1 text-xs text-muted-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {teacher.name}
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
            <SubmitButton />
            {state.message ? (
              <span className={formMessageClass(state.ok)}>{state.message}</span>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
