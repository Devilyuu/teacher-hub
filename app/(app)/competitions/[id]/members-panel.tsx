"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { linkMemberToStudent, saveCompetitionMembers } from "../actions";

export type MemberRow = {
  id: string;
  name: string;
  note: string | null;
  studentId: string | null;
  /** 「智能2201班 张三」。没关联时为 null */
  studentLabel: string | null;
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "保存名单"}
    </Button>
  );
}

/**
 * 参赛学生名单。
 *
 * **姓名按文本存，关联在册学生是可选的**：参赛学生常常跨班、跨系，甚至已经
 * 毕业，而班主任模块默认是关的——强行要求关联等于逼着开那个模块。
 *
 * 名单按整块文本收不按一行一个输入框：队员就三五个人，改一次名单比加减
 * 输入框快得多（和班主任的批量粘贴是同一个取舍）。保存时**按姓名对齐**，
 * 已经挂上的学生关联不会因为改了个备注就丢。
 */
export function MembersPanel({
  entryId,
  members,
  students,
  advisorEnabled,
}: {
  entryId: string;
  members: MemberRow[];
  students: Array<{ id: string; label: string }>;
  advisorEnabled: boolean;
}) {
  const [editing, setEditing] = useState(members.length === 0);
  const [state, action] = useActionState(
    saveCompetitionMembers.bind(null, entryId),
    IDLE_FORM_STATE,
  );

  const asText = members
    .map((member) => (member.note ? `${member.name}\t${member.note}` : member.name))
    .join("\n");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium">参赛学生</h2>
        {members.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? "收起" : "改名单"}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form action={action} className="surface space-y-3 p-4">
          <div key={`${members.length}-${state.ok}`}>
            <Textarea
              name="members"
              rows={5}
              defaultValue={asText}
              placeholder={"张三\t队长\n李四\n王五"}
              className="font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            一行一个。姓名后面用制表符或逗号可以跟一句备注（队长、负责答辩…）。
            同名只留一条，整块重复粘贴是安全的。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton />
            {state.message ? (
              <span className={formMessageClass(state.ok)}>{state.message}</span>
            ) : null}
          </div>
        </form>
      ) : null}

      {members.length > 0 ? (
        <ul className="surface divide-y divide-border/40">
          {members.map((member) => (
            <li key={member.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm">{member.name}</span>
                {member.note ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {member.note}
                  </span>
                ) : null}
              </div>

              {advisorEnabled ? (
                <form action={linkMemberToStudent}>
                  <input type="hidden" name="memberId" value={member.id} />
                  <input type="hidden" name="entryId" value={entryId} />
                  <select
                    name="studentId"
                    defaultValue={member.studentId ?? ""}
                    className={selectClass}
                    aria-label={`把 ${member.name} 关联到在册学生`}
                    onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  >
                    <option value="">不关联在册学生</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.label}
                      </option>
                    ))}
                  </select>
                </form>
              ) : member.studentLabel ? (
                <p className="text-xs text-muted-foreground">{member.studentLabel}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : editing ? null : (
        <div className="rounded-3xl bg-well p-6 text-center text-xs text-muted-foreground">
          还没填队员。
        </div>
      )}
    </section>
  );
}
