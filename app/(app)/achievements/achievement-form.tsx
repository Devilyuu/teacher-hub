"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  DateField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/form-field";
import { PerfSelect } from "@/components/perf-select";
import { PromotionSelect } from "@/components/promotion-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, type FormState, formMessageClass } from "@/lib/form-state";
import type { PromotionOption } from "@/lib/promotion";
import type { PerfOption } from "@/lib/queries/perf-categories";
import { achievementStatusLabel, statusesForAchievementType } from "@/lib/labels";
import {
  ACHIEVEMENT_TYPE_OPTIONS,
  DATE_PRECISION_OPTIONS,
  LEVEL_OPTIONS,
} from "@/lib/options";
import type { AchievementType } from "@/lib/generated/prisma/enums";

/** 两个分类下拉共用。小类原文很长，宽度给满 */
const CATEGORY_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

export type AchievementFormDefaults = {
  type?: AchievementType;
  title?: string | null;
  status?: string | null;
  authorPosition?: number | null;
  ownerRole?: string | null;
  level?: string | null;
  journalName?: string | null;
  journalLevel?: string | null;
  indexedBy?: string | null;
  wordCount?: number | null;
  completedAt?: Date | null;
  publishedAt?: Date | null;
  dateText?: string | null;
  datePrecision?: string | null;
  tags?: string[];
  evidenceRef?: string | null;
  obsidianPath?: string | null;
  externalRef?: string | null;
  promotionCategoryId?: string | null;
  promotionScore?: number | null;
  perfCategoryId?: string | null;
  declaredScore?: number | null;
  isVerified?: boolean;
  note?: string | null;
};

export function AchievementForm({
  action,
  defaults,
  submitLabel,
  dataVersion,
  promotionOptions,
  perfOptions,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: AchievementFormDefaults;
  submitLabel: string;
  /**
   * 服务端数据的版本号，传 `updatedAt`。变了就重挂字段区（见下方 key 的说明）。
   * 新建页没有这个概念，不传即可。
   */
  dataVersion?: string;
  /** 人事处那张表的二级指标。没导入职称表时传空数组，整栏隐藏 */
  promotionOptions: PromotionOption[];
  /** 学校绩效对照表的小类。没导入时传空数组 */
  perfOptions: PerfOption[];
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const errorsOf = (field: string) => state.fieldErrors?.[field];

  // 非论文类成果只走简版生命周期（prd-ledger 2.1），选项随类型变
  const [type, setType] = useState<AchievementType>(defaults?.type ?? "PAPER");
  // 文案也随类型走：获奖类的「选题 / 已见刊」要显示成「计划中 / 已完成」
  const statusOptions = statusesForAchievementType(type).map((value) => ({
    value,
    label: achievementStatusLabel(value, type),
  }));
  const isPaperLike = type === "PAPER" || type === "REPORT";

  return (
    <form action={formAction} className="space-y-8">
      {/*
       * **这层 key 不能省，也不能提到 <form> 上去。**
       *
       * 保存后 Server Action 会 revalidate，本页重新渲染，Base UI 拿新的
       * defaultValue 去重刷非受控输入框——不换 key 的话输入框会弹回旧值，
       * 库里明明存对了，界面上却像没存进去（这正是「改完保存不了」的真相；
       * 顺带还会报 console.error，在 Next 16 开发模式下弹出浮层盖住保存按钮）。
       *
       * 换 key 让字段区整体重挂，用刚存进去的值重新初始化。
       * 而 key 只能放在这层 div 上：放到 <form> 上会把 useActionState 也一起重挂，
       * 「已保存」那句提示当场就没了。状态留在外面，字段重挂在里面。
       */}
      <div key={dataVersion} className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            基本信息
          </h2>

          <TextField
            name="title"
            label="成果题目"
            required
            defaultValue={defaults?.title}
            errors={errorsOf("title")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="type">类型</Label>
              <select
                id="type"
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as AchievementType)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {ACHIEVEMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                媒体报道、培训讲座、社会服务、指导学生这几类不能挂到结题要求上，
                但一样要录——绩效申报用得着。到账经费只有横向项目的结题要求能挂
              </p>
            </div>

            <SelectField
              name="status"
              label="当前状态"
              options={statusOptions}
              defaultValue={defaults?.status ?? "PLANNED"}
              errors={errorsOf("status")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              name="level"
              label="级别"
              options={LEVEL_OPTIONS}
              defaultValue={defaults?.level ?? "UNRATED"}
              hint="行政级别，与收录情况分开"
              errors={errorsOf("level")}
            />
            <TextField
              name="authorPosition"
              label="作者位次"
              type="number"
              defaultValue={defaults?.authorPosition?.toString()}
              placeholder="1"
              errors={errorsOf("authorPosition")}
            />
            <TextField
              name="ownerRole"
              label="本人角色"
              defaultValue={defaults?.ownerRole}
              placeholder="第一作者 / 主编 / 负责人"
              errors={errorsOf("ownerRole")}
            />
          </div>
        </section>

        {isPaperLike ? (
          <section className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              论文 / 报告
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="journalName"
                label="期刊 / 出版社"
                defaultValue={defaults?.journalName}
                errors={errorsOf("journalName")}
              />
              <SelectField
                name="journalLevel"
                label="期刊级别"
                options={LEVEL_OPTIONS}
                placeholder="未填"
                defaultValue={defaults?.journalLevel}
                errors={errorsOf("journalLevel")}
              />
              <TextField
                name="indexedBy"
                label="收录情况"
                defaultValue={defaults?.indexedBy}
                placeholder="CNKI / EI / SCI / 无"
                errors={errorsOf("indexedBy")}
              />
              <TextField
                name="wordCount"
                label="字数"
                type="number"
                defaultValue={defaults?.wordCount?.toString()}
                hint="研究报告类的字数要求靠它校验"
                errors={errorsOf("wordCount")}
              />
            </div>
          </section>
        ) : (
          <>
            <input type="hidden" name="journalName" value="" />
            <input type="hidden" name="journalLevel" value="" />
            <input type="hidden" name="indexedBy" value="" />
            <input type="hidden" name="wordCount" value="" />
          </>
        )}

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">时间</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              name="completedAt"
              label="定稿日"
              defaultValue={defaults?.completedAt}
              errors={errorsOf("completedAt")}
            />
            <DateField
              name="publishedAt"
              label="见刊 / 授权 / 获奖日"
              defaultValue={defaults?.publishedAt}
              errors={errorsOf("publishedAt")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="datePrecision"
              label="日期精度"
              options={DATE_PRECISION_OPTIONS}
              defaultValue={defaults?.datePrecision ?? "UNKNOWN"}
              hint="说不准到哪一天就别硬填，选个粗精度，原文写在下一栏"
              errors={errorsOf("datePrecision")}
            />
            <TextField
              name="dateText"
              label="时间原文"
              defaultValue={defaults?.dateText}
              placeholder="如 2026年10—11月（拟）"
              errors={errorsOf("dateText")}
            />
          </div>
        </section>

        {/* 两套分类并排。**它们是两套坐标系，不是一个字段的两种叫法**——
          左边人事处评职称用，右边二级学院分钱用，一条成果可以同时属于两边、
          也可以只属于一边。摆在一起是为了让人一眼看清它到底归哪儿。

          两边都是**单选**，这不是偷懒：赋分细则说明第 3 条明写
          「同一成果适合多个项目时仅按一个项目计算」。想表达"这条能用在哪些场景"
          的是下面「归档线索」里的用途（usableFor），那个才是多选。 */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            分类与赋分
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="promotionCategoryId">职称指标（人事处）</Label>
              {promotionOptions.length > 0 ? (
                <>
                  <PromotionSelect
                    name="promotionCategoryId"
                    options={promotionOptions}
                    defaultValue={defaults?.promotionCategoryId}
                    className={CATEGORY_SELECT_CLASS}
                  />
                  <p className="text-xs text-muted-foreground">
                    《业绩量化考核赋分细则》的二级指标。留「不计入职称」就表示这条评职称用不上，
                    成果库的职称口径会把它过滤掉
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    还没导入职称量化表，跑一次{" "}
                    <code>npm run import:promotion-rules</code>。
                  </p>
                  <input
                    type="hidden"
                    name="promotionCategoryId"
                    value={defaults?.promotionCategoryId ?? ""}
                  />
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="perfCategoryId">绩效分类（二级学院）</Label>
              {perfOptions.length > 0 ? (
                <>
                  <PerfSelect
                    name="perfCategoryId"
                    options={perfOptions}
                    defaultValue={defaults?.perfCategoryId}
                    className={CATEGORY_SELECT_CLASS}
                  />
                  <p className="text-xs text-muted-foreground">
                    《超额工作绩效积分对照表》的小类。和左边各管各的，不互推
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    还没导入绩效对照表，跑一次{" "}
                    <code>npm run import:perf-rules</code>。
                  </p>
                  <input
                    type="hidden"
                    name="perfCategoryId"
                    value={defaults?.perfCategoryId ?? ""}
                  />
                </>
              )}
            </div>

            <TextField
              name="promotionScore"
              label="职称量化分"
              type="number"
              step="0.1"
              defaultValue={defaults?.promotionScore?.toString()}
              hint="人工填，系统只显示赋分细则不替你算；扣分项可以填负数"
              errors={errorsOf("promotionScore")}
            />
            <TextField
              name="declaredScore"
              label="绩效申报分"
              type="number"
              step="0.1"
              defaultValue={defaults?.declaredScore?.toString()}
              hint="与左边是两套口径的分，不要互相赋值"
              errors={errorsOf("declaredScore")}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            归档线索
          </h2>

          <TextField
            name="tags"
            label="主题标签"
            defaultValue={defaults?.tags?.join("、")}
            placeholder="AI教育方向、数字媒体方向、产教融合"
            hint="研究方向之类的主题词，用顿号或逗号分隔。用途（绩效 / 职称 / 结题）不写在这里"
            errors={errorsOf("tags")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="evidenceRef"
              label="支撑材料出处"
              defaultValue={defaults?.evidenceRef}
              placeholder="文件名或链接"
              errors={errorsOf("evidenceRef")}
            />
            <TextField
              name="obsidianPath"
              label="Obsidian 笔记路径"
              defaultValue={defaults?.obsidianPath}
              errors={errorsOf("obsidianPath")}
            />
          </div>

          <TextField
            name="externalRef"
            label="导入来源标识"
            defaultValue={defaults?.externalRef}
            hint="从别处导入时留下的记录标识，如 jixiao:42。手工录入的成果不用填"
            errors={errorsOf("externalRef")}
          />

          <div className="flex items-center gap-2">
            <input
              id="isVerified"
              name="isVerified"
              type="checkbox"
              defaultChecked={defaults?.isVerified}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="isVerified" className="font-normal">
              信息已核实
            </Label>
          </div>

          <TextAreaField
            name="note"
            label="备注"
            rows={3}
            defaultValue={defaults?.note}
            errors={errorsOf("note")}
          />
        </section>
      </div>

      {state.message ? (
        <p
          role="alert"
          className={
            formMessageClass(state.ok, "sm")
          }
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
