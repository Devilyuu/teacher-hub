"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { deleteCompetitionEntry, updateCompetitionEntry } from "../actions";
import {
  EntryFields,
  type CompetitionOption,
  type EntryDefaults,
} from "../entry-fields";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

/**
 * 参赛记录的编辑表单。
 *
 * **`<form>` 里面套一层 `<div key={dataVersion}>`**（CLAUDE.md 代码约定）：
 * 非受控表单 + Server Action + 本页 revalidate，存完 defaults 变了，
 * 不重挂字段区就会显示旧值——库里明明存对了，看起来却像「保存不了」。
 * key 加在 `<form>` 上会连「已保存」提示一起清掉，所以只包字段区。
 */
export function EntryEditor({
  entryId,
  dataVersion,
  competitions,
  defaults,
  deletable,
}: {
  entryId: string;
  dataVersion: string;
  competitions: CompetitionOption[];
  defaults: EntryDefaults;
  deletable: boolean;
}) {
  const [state, action] = useActionState(
    updateCompetitionEntry.bind(null, entryId),
    IDLE_FORM_STATE,
  );
  const deleteFormId = `delete-entry-${entryId}`;

  return (
    <>
      <form action={action} className="surface space-y-4 p-5">
        <div key={dataVersion}>
          <EntryFields competitions={competitions} defaults={defaults} state={state} />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-4">
          <SubmitButton />
          {state.message ? (
            <span className={formMessageClass(state.ok)}>{state.message}</span>
          ) : null}

          {deletable ? (
            // 按 form 属性关联到下面那张表单：form 不能嵌套，浏览器会当场把它拆掉
            <Button
              type="submit"
              form={deleteFormId}
              size="sm"
              variant="ghost"
              className="ml-auto text-muted-foreground"
            >
              <Trash2 className="size-3.5" aria-hidden />
              删除
            </Button>
          ) : (
            <span className="measure ml-auto text-xs text-muted-foreground">
              已引用为成果，不能删——那条成果还在台账里，参赛记录一没，
              「这个奖是哪次比赛来的」就查不到了。
            </span>
          )}
        </div>
      </form>

      {deletable ? (
        <form
          id={deleteFormId}
          action={deleteCompetitionEntry}
          className="hidden"
          onSubmit={(event) => {
            // 硬删，材料一起没。只在手误建错时用，所以拦一道
            if (!window.confirm("删除这条参赛记录？上传的材料会一起删除。")) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="entryId" value={entryId} />
        </form>
      ) : null}
    </>
  );
}
