"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { updateModuleSettings } from "@/lib/actions/module-actions";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";

export type ModuleRowData = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

/**
 * 功能模块勾选面板。
 *
 * 超过 6 个一级入口只给**软提示不阻止**——校验永远不阻止保存（铁律 3）。
 * 一级入口 = 4 个骨架项（首页/日常/科研/成果）+ 勾选的「教学」「参赛」「班主任」；
 * 「轮派」是「日常」下的二级 tab，不占一级位，不计入这个数。
 *
 * 阈值 2026-09-12 随「参赛」从 5 抬到 6（理由记在 lib/nav.ts 的注释里）。
 */
export function ModulesPanel({
  rows,
  fixedNavCount,
  topLevelKeys,
}: {
  rows: ModuleRowData[];
  /** 骨架一级入口数（不可关的那些），服务端从注册表算好传进来 */
  fixedNavCount: number;
  /** 占一级导航位的模块键。轮派不在其中 */
  topLevelKeys: string[];
}) {
  const [state, action] = useActionState(updateModuleSettings, IDLE_FORM_STATE);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((row) => [row.key, row.enabled])),
  );

  const navCount =
    fixedNavCount + topLevelKeys.filter((key) => checked[key]).length;

  return (
    <form action={action} className="surface">
      <ul className="divide-y divide-border/40">
        {rows.map((row) => (
          <li key={row.key} className="px-5 py-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name={row.key}
                checked={checked[row.key] ?? false}
                onChange={(event) =>
                  setChecked((prev) => ({
                    ...prev,
                    [row.key]: event.target.checked,
                  }))
                }
                className="mt-0.5 size-4 shrink-0"
              />
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-medium">{row.label}</span>
                <span className="measure block text-xs leading-relaxed text-muted-foreground">
                  {row.description}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-border/40 px-5 py-4">
        <SubmitButton />
        {navCount > 6 ? (
          <p className="text-xs text-[var(--h-amber-fg)]">
            同时启用了 {navCount} 个一级入口，手机上导航会需要横向滚动
          </p>
        ) : null}
        {state.message ? (
          <p className={formMessageClass(state.ok)}>{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
