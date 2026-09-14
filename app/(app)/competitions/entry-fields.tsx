"use client";

import { useState } from "react";
import {
  DateField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/form-field";
import {
  COMPETITION_AWARD_OPTIONS,
  COMPETITION_STATUS_OPTIONS,
  LEVEL_OPTIONS,
} from "@/lib/options";
import type { FormState } from "@/lib/form-state";

export type CompetitionOption = { id: string; name: string; level: string };

export type EntryDefaults = {
  competitionId: string | null;
  track: string | null;
  year: number;
  editionText: string | null;
  level: string;
  status: string;
  registerDeadline: Date | null;
  competeAt: Date | null;
  competeDateText: string | null;
  award: string | null;
  awardTitle: string | null;
  awardedAt: Date | null;
  awardDateText: string | null;
  myOrder: number | null;
  note: string | null;
};

export const NEW_COMPETITION = "__new__";

/**
 * 新建和编辑共用的字段区。
 *
 * 三处刻意的设计：
 * - **赛事可以现场新建**（同课题的立项来源）。字典必须是表（第 12 条），
 *   但不能因此逼着用户先跳出去建一条再回来
 * - **日期分两格**：精确日期一格、原文一格。只知道「五月底」就写原文，
 *   不许硬转成 5-31（第 8 条铁律）
 * - **奖项和阶段是两个字段**：阶段说走到哪一步，奖项说拿了什么。
 *   谁也不从对方推导（第 1 条铁律）
 */
export function EntryFields({
  competitions,
  defaults,
  state,
}: {
  competitions: CompetitionOption[];
  defaults: EntryDefaults;
  state: FormState;
}) {
  const [competitionId, setCompetitionId] = useState(
    defaults.competitionId ?? (competitions.length === 0 ? NEW_COMPETITION : ""),
  );
  const creatingCompetition = competitionId === NEW_COMPETITION;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="competitionId" className="text-sm font-medium">
            赛事<span className="text-destructive">*</span>
          </label>
          {/* 原生 select：shadcn 的 Select 值不进 FormData，而 Server Action 靠它取值 */}
          <select
            id="competitionId"
            name={creatingCompetition ? "competitionIdUnused" : "competitionId"}
            value={competitionId}
            onChange={(event) => setCompetitionId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">请选择</option>
            {competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
              </option>
            ))}
            <option value={NEW_COMPETITION}>＋ 新赛事…</option>
          </select>
          {/* 选了「新赛事」时把 competitionId 留空提交，由 newCompetitionName 兜底 */}
          {creatingCompetition ? <input type="hidden" name="competitionId" value="" /> : null}
          {state.fieldErrors?.competitionId?.map((error) => (
            <p key={error} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ))}
        </div>

        {creatingCompetition ? (
          <TextField
            name="newCompetitionName"
            label="新赛事名称"
            placeholder="如「全国职业院校技能大赛」"
            hint="不含赛项和届次——那两样每年变，填在下面"
            errors={state.fieldErrors?.newCompetitionName}
          />
        ) : (
          <input type="hidden" name="newCompetitionName" value="" />
        )}

        <TextField
          name="track"
          label="赛项 / 赛道"
          defaultValue={defaults.track}
          placeholder="如「软件测试赛项」"
          errors={state.fieldErrors?.track}
        />

        <TextField
          name="year"
          label="年度"
          type="number"
          required
          defaultValue={`${defaults.year}`}
          hint="历年分组、统计都按它"
          errors={state.fieldErrors?.year}
        />

        <TextField
          name="editionText"
          label="届次"
          defaultValue={defaults.editionText}
          placeholder="如「第十八届」"
          hint="通知上有就填，没有不猜"
          errors={state.fieldErrors?.editionText}
        />

        <SelectField
          name="level"
          label="本赛段级别"
          defaultValue={defaults.level}
          options={LEVEL_OPTIONS}
          hint="校赛、省赛、国赛各记一条，级别各填各的"
          errors={state.fieldErrors?.level}
        />

        <SelectField
          name="status"
          label="进行到哪一步"
          defaultValue={defaults.status}
          options={COMPETITION_STATUS_OPTIONS}
          errors={state.fieldErrors?.status}
        />

        <TextField
          name="myOrder"
          label="我是第几指导"
          type="number"
          defaultValue={defaults.myOrder != null ? `${defaults.myOrder}` : ""}
          placeholder="1"
          hint="绩效和职称都看这个排名。没填就是没填，不当 0"
          errors={state.fieldErrors?.myOrder}
        />
      </div>

      <fieldset className="grid gap-4 rounded-2xl bg-well p-4 sm:grid-cols-3">
        <legend className="px-1 text-xs text-muted-foreground">时间</legend>
        <DateField
          name="registerDeadline"
          label="报名截止"
          defaultValue={defaults.registerDeadline}
          hint="精确到日才填，它要进首页倒计时"
          errors={state.fieldErrors?.registerDeadline}
        />
        <DateField
          name="competeAt"
          label="比赛日期"
          defaultValue={defaults.competeAt}
          errors={state.fieldErrors?.competeAt}
        />
        <TextField
          name="competeDateText"
          label="比赛时间原文"
          defaultValue={defaults.competeDateText}
          placeholder="如「2026年5月」"
          hint="只知道月份就写这里，别填成 5-31"
          errors={state.fieldErrors?.competeDateText}
        />
      </fieldset>

      <fieldset className="grid gap-4 rounded-2xl bg-well p-4 sm:grid-cols-2">
        <legend className="px-1 text-xs text-muted-foreground">结果</legend>
        <SelectField
          name="award"
          label="奖项"
          defaultValue={defaults.award ?? ""}
          options={COMPETITION_AWARD_OPTIONS}
          placeholder="还没出结果"
          hint="「未获奖」是一个事实，和「还没出结果」不是一回事"
          errors={state.fieldErrors?.award}
        />
        <TextField
          name="awardTitle"
          label="奖状原文"
          defaultValue={defaults.awardTitle}
          placeholder="如「省一等奖」「金奖」"
          hint="引用为成果时拿它当标题——评审核对的就是这行字"
          errors={state.fieldErrors?.awardTitle}
        />
        <DateField
          name="awardedAt"
          label="获奖日"
          defaultValue={defaults.awardedAt}
          errors={state.fieldErrors?.awardedAt}
        />
        <TextField
          name="awardDateText"
          label="获奖日期原文"
          defaultValue={defaults.awardDateText}
          placeholder="如「2026年6月」"
          hint="奖状上常常只有年月"
          errors={state.fieldErrors?.awardDateText}
        />
      </fieldset>

      <TextAreaField
        name="note"
        label="备注"
        rows={3}
        defaultValue={defaults.note}
        placeholder="集训安排、通知里写的模糊日期、和谁对接…"
        errors={state.fieldErrors?.note}
      />
    </div>
  );
}
