"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { PerfSelect } from "@/components/perf-select";
import { PromotionSelect } from "@/components/promotion-select";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { achievementStatusLabel, statusesForAchievementType } from "@/lib/labels";
import { formatPerfRules } from "@/lib/perf-rules";
import { ACHIEVEMENT_TYPE_OPTIONS, LEVEL_OPTIONS } from "@/lib/options";
import type { PerfOption } from "@/lib/queries/perf-categories";
import type { PromotionOption } from "@/lib/promotion";
import { quickEditAchievement } from "./actions";
import type {
  AchievementStatus,
  AchievementType,
  AchievementUsage,
  Level,
} from "@/lib/generated/prisma/enums";

export type QuickEditDefaults = {
  id: string;
  year: number | null;
  type: AchievementType;
  status: AchievementStatus;
  level: Level;
  perfCategoryId: string | null;
  promotionCategoryId: string | null;
  promotionScore: number | null;
  /** 申报分（绩效口径）。与 promotionScore 是两套口径的分，不互相赋值 */
  declaredScore: number | null;
  usableFor: AchievementUsage[];
  isVerified: boolean;
};

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

/**
 * 列表页的行内订正。
 *
 * 默认收起，点「订正」才展开——70 条成果同时铺开七十个表单，
 * 页面会重得没法用，视线也没处落。
 *
 * 改标题、期刊、字数那些进详情页。
 *
 * **「职称指标」是这一行里最要紧的一项。** 把台账分成「能评职称」和
 * 「只能算绩效」，靠的就是逐条给它挂或不挂人事处那 30 个指标之一，
 * 而这活儿在列表页一行行过最快。
 */
export function QuickEditRow({
  defaults,
  promotionOptions,
  perfOptions,
}: {
  defaults: QuickEditDefaults;
  promotionOptions: PromotionOption[];
  perfOptions: PerfOption[];
}) {
  const [open, setOpen] = useState(false);
  const action = quickEditAchievement.bind(null, defaults.id);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  // 「填了分却没挂指标」的软提示。**要跟着当前选择走**，不能只看 defaults——
  // 用户在这一行里刚把指标改回「不计入职称」时就该看到提示，
  // 而不是等保存刷新完才发现这条又掉出职称口径了
  const [scoreWithoutCategory, setScoreWithoutCategory] = useState(
    () => defaults.promotionCategoryId == null && defaults.promotionScore != null,
  );

  /**
   * 状态选项跟着类型走，**档位和文案都要跟**（prd-ledger 2.1）。
   * 类型在同一行里也能改，所以这里和完整表单一样把它做成状态。
   *
   * 「获奖」只放 5 档，且显示成「计划中／进行中／已提交／已确认／已完成」——
   * 论文那套「选题／写作中／已见刊」套在一等奖上没一个词说得通。
   */
  const [type, setType] = useState<AchievementType>(defaults.type);
  const statusOptions = statusesForAchievementType(type).map((value) => ({
    value,
    label: achievementStatusLabel(value, type),
  }));

  // 选中小类的赋分规则，跟着下拉走。填 17 条缺分的记录时不用另开一处查
  // 「教材编写出版 = 8/门」——**只显示不解析，分仍由人填**（第 1 条）
  const [perfCategoryId, setPerfCategoryId] = useState(defaults.perfCategoryId);
  const selectedPerf = perfOptions.find((option) => option.id === perfCategoryId);
  const perfRuleText = selectedPerf ? formatPerfRules(selectedPerf.rules) : "";

  // 挂在 form 上而不是逐个字段：几个字段任一变化都要重算，冒泡到这里一次搞定
  function recheck(form: HTMLFormElement) {
    const data = new FormData(form);
    setScoreWithoutCategory(
      !data.get("promotionCategoryId") && String(data.get("promotionScore") ?? "").trim() !== "",
    );
    setPerfCategoryId(String(data.get("perfCategoryId") ?? "") || null);
    setType(String(data.get("type") ?? "") as AchievementType);
  }

  // 收起态是个铅笔图标，不是「订正」两个字。台账有 100 行，
  // 一列重复 100 遍的同一个词是纯噪音；图标占的地方小一半，
  // 又跟着标题排在同一行里，把整整一行的高度省了下来。
  // **不做 hover 才显形**——那样在触摸屏上就没法订正了
  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="订正"
        aria-label="订正"
        className="size-6 shrink-0 rounded-full text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-3.5" aria-hidden />
      </Button>
    );
  }

  return (
    // `basis-full`：展开后要独占一整行。收起态那个图标是排在标题右边的，
    // 展开的表单要是也挤在标题那一行里，十来个控件会被压成一根面条
    <form
      action={formAction}
      onChange={(e) => recheck(e.currentTarget)}
      className="flex basis-full flex-wrap items-center gap-2 pt-1"
    >
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        年度
        <input
          name="year"
          type="number"
          inputMode="numeric"
          defaultValue={defaults.year ?? ""}
          placeholder="—"
          className={`${selectClass} w-20`}
        />
      </label>

      <select name="type" defaultValue={defaults.type} className={selectClass} aria-label="成果类型">
        {ACHIEVEMENT_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* 状态排在类型后面。存量导入的 68 条全是「选题」，导出预检会把它们
          标成「状态存疑」——这一项就是用来一行行把它们改对的 */}
      <select
        name="status"
        defaultValue={defaults.status}
        className={selectClass}
        aria-label="状态"
      >
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select name="level" defaultValue={defaults.level} className={selectClass} aria-label="级别">
        {LEVEL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* 绩效小类。和下面的职称指标对称——两套坐标系各挂各的，不许互推 */}
      {perfOptions.length > 0 ? (
        <PerfSelect
          name="perfCategoryId"
          options={perfOptions}
          defaultValue={defaults.perfCategoryId}
          className={`${selectClass} max-w-[16rem]`}
        />
      ) : (
        // 同职称那两个字段：绩效规则表还没导入时也得留隐藏域，
        // 否则 key 不在 FormData 里会直接报 expected string，
        // 而且原值必须原样回传，不能被这一趟清空
        <input type="hidden" name="perfCategoryId" value={defaults.perfCategoryId ?? ""} />
      )}

      {promotionOptions.length > 0 ? (
        <>
          <PromotionSelect
            name="promotionCategoryId"
            options={promotionOptions}
            defaultValue={defaults.promotionCategoryId}
            className={`${selectClass} max-w-[16rem]`}
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            职称分
            <input
              name="promotionScore"
              type="number"
              step="0.1"
              inputMode="decimal"
              defaultValue={defaults.promotionScore ?? ""}
              placeholder="—"
              className={`${selectClass} w-16`}
            />
          </label>
        </>
      ) : (
        // 职称表还没导入时整栏隐藏，而不是摆一个空下拉让人以为坏了。
        // **两个字段都得留隐藏域**：schema 是严格的，key 不在 FormData 里
        // 会直接报 expected string；而且原值必须原样回传，不能被这一趟清空
        <>
          <input
            type="hidden"
            name="promotionCategoryId"
            value={defaults.promotionCategoryId ?? ""}
          />
          <input type="hidden" name="promotionScore" value={defaults.promotionScore ?? ""} />
        </>
      )}

      {/* 申报分和职称分并排。**两套口径的分，绝不相加也不互相赋值**——
          左边这个是人事处评职称的量化表，这个是二级学院分钱的表 */}
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        申报分
        <input
          name="declaredScore"
          type="number"
          step="0.1"
          inputMode="decimal"
          defaultValue={defaults.declaredScore ?? ""}
          placeholder="—"
          className={`${selectClass} w-16`}
        />
      </label>

      <fieldset className="flex items-center gap-2 text-xs">
        <legend className="sr-only">用途</legend>
        {(
          [
            ["usableForPerformance", "PERFORMANCE", "绩效"],
            ["usableForPromotion", "PROMOTION", "职称"],
            ["usableForProjectClosing", "PROJECT_CLOSING", "结题"],
          ] as const
        ).map(([name, value, label]) => (
          <label key={name} className="flex items-center gap-1">
            <input
              type="checkbox"
              name={name}
              defaultChecked={defaults.usableFor.includes(value)}
              className="size-3.5"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          name="isVerified"
          defaultChecked={defaults.isVerified}
          className="size-3.5"
        />
        已核实
      </label>

      <SaveButton />
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        收起
      </Button>

      {state.message ? (
        <span className={formMessageClass(state.ok)}>
          {state.message}
        </span>
      ) : null}

      {/* 选中小类的赋分规则原文。**摆在分值输入框附近**，因为分是对着它填的。
          规则一律不解析（源表里是「10/次」「0.5/万元（上限10分）」这类写法，
          没有统一语法），也不按成果级别挑列——六列全摆出来，由人自己看哪条适用 */}
      {perfRuleText || selectedPerf?.remark ? (
        <p className="basis-full text-xs leading-relaxed text-muted-foreground">
          {perfRuleText}
          {selectedPerf?.remark ? (
            <span className="ml-2 opacity-80">备注：{selectedPerf.remark}</span>
          ) : null}
        </p>
      ) : null}

      {/* 软提示，只说不拦（CLAUDE.md 第 3 条）。填了分照样能存，
          只是得让人知道这条仍然进不了职称口径 */}
      {scoreWithoutCategory ? (
        <span className="basis-full text-xs text-[var(--h-amber-fg)]">
          填了职称分，但指标是「不计入职称」——这条进不了职称口径。要计入就挂一个指标。
        </span>
      ) : null}
    </form>
  );
}
