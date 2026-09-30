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
 * 一级入口 = 4 个骨架项（首页/日常/科研/成果）+ 勾选的那些占一级位的模块；
 * 「轮派」是「日常」下的二级 tab，不占一级位，不计入这个数。
 * **名单不写死在这里**——它由服务端从 NAV_ITEMS 派生（settings/page.tsx），
 * 这段注释以前手抄了「教学/参赛/班主任」，加一个模块就少一个。
 *
 * 阈值 2026-09-12 随「参赛」从 5 抬到 6（理由记在 lib/nav.ts 的注释里）。
 * 2026-09-21 加「导师」后全集到 8 项，但阈值**没跟着抬**：
 * 提示的意思是「你启用得有点多了」，而不是「你超标了」——
 * 它本来就该在超过 6 个的时候响一声。
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
            {/* 手机端现在是底栏 ≤5 项 + 全集抽屉，不再横滚；
                真正的代价是扫一眼要认的入口变多了（lib/nav.ts） */}
            同时启用了 {navCount} 个一级入口，侧栏会变长、一眼要认的入口也更多
          </p>
        ) : null}
        {state.message ? (
          <p className={formMessageClass(state.ok)}>{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
