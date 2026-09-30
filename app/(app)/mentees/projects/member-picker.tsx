"use client";

import { useState } from "react";

/**
 * 「做这个题的学生」+「主责」。新建和编辑两张表单共用。
 *
 * 原来只有复选框、标题写着「第一个是主责」——可复选框按姓名排，
 * 主责就成了勾选者里汉字编码最小的那个，编辑保存一次还会把原主责换掉
 * （2026-09-23 验收实测）。现在主责明着选：勾上的人旁边出一个「主责」单选。
 * 顺序怎么落库见 `orderProjectMembers`（lib/mentees.ts）。
 *
 * 编辑表单里它在 `key={dataVersion}` 那层里面，保存后随字段区一起重挂，
 * state 从新的 defaults 重新起，不会停在旧值上。
 */
export function ProjectMemberPicker({
  mentees,
  defaultMemberIds = [],
}: {
  mentees: Array<{ id: string; name: string }>;
  /** 按 orderIndex 升序，第一个就是现在的主责 */
  defaultMemberIds?: string[];
}) {
  const [checked, setChecked] = useState<string[]>(defaultMemberIds);
  const [lead, setLead] = useState<string | null>(defaultMemberIds[0] ?? null);

  function toggle(id: string, on: boolean) {
    const next = on ? [...checked, id] : checked.filter((current) => current !== id);
    setChecked(next);
    // 第一个勾上的人默认是主责；主责被取消，就交给列表里下一个还勾着的人
    if (on && lead == null) setLead(id);
    if (!on && lead === id) {
      setLead(mentees.find((mentee) => next.includes(mentee.id))?.id ?? null);
    }
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">做这个题的学生</legend>
      <p className="measure text-xs text-muted-foreground">
        勾上以后点「主责」选谁牵头——月历、首页倒计时和材料包的文件名用主责的名字。
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {mentees.map((mentee) => {
          const on = checked.includes(mentee.id);
          return (
            <div key={mentee.id} className="flex items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="mentees"
                  value={mentee.id}
                  checked={on}
                  onChange={(event) => toggle(mentee.id, event.target.checked)}
                  className="size-4"
                />
                {mentee.name}
              </label>
              {on ? (
                <label className="flex items-center gap-1 rounded-full bg-well px-2 py-0.5 text-xs text-muted-foreground has-[:checked]:font-medium has-[:checked]:text-foreground">
                  <input
                    type="radio"
                    name="lead"
                    value={mentee.id}
                    checked={lead === mentee.id}
                    onChange={() => setLead(mentee.id)}
                    aria-label={`${mentee.name}为主责`}
                    className="size-3.5"
                  />
                  主责
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
