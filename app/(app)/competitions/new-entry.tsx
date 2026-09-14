"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { createCompetitionEntry } from "./actions";
import { EntryFields, type CompetitionOption } from "./entry-fields";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

/**
 * 新建参赛。主操作是右上角实心胶囊，点开在下面展开整张表单——
 * 和「新建课题」「新建成果」长一个样（CLAUDE.md：同一个动作在不同页面要长一个样）。
 */
export function NewEntry({
  competitions,
}: {
  competitions: Array<{ id: string; name: string; level: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createCompetitionEntry, IDLE_FORM_STATE);

  const options: CompetitionOption[] = competitions.map((competition) => ({
    id: competition.id,
    name: competition.name,
    level: competition.level,
  }));

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        新建参赛
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
        收起
      </Button>
      <form action={action} className="surface order-last w-full space-y-4 p-5">
        {/* 存完 revalidate 会让 defaults 变值，字段区靠 key 重挂一次；
            key 加在 <form> 上会连「已保存」提示一起清掉（CLAUDE.md 代码约定） */}
        <div key={state.ok ? "saved" : "editing"}>
          <EntryFields
            competitions={options}
            defaults={{
              competitionId: null,
              track: null,
              year: new Date().getFullYear(),
              editionText: null,
              level: "UNRATED",
              status: "PLANNED",
              registerDeadline: null,
              competeAt: null,
              competeDateText: null,
              award: null,
              awardTitle: null,
              awardedAt: null,
              awardDateText: null,
              myOrder: null,
              note: null,
            }}
            state={state}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-4">
          <SubmitButton />
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
          {state.message ? (
            <span className={formMessageClass(state.ok)}>{state.message}</span>
          ) : null}
        </div>
      </form>
    </>
  );
}
