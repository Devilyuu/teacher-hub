"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  DateField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, type FormState, formMessageClass } from "@/lib/form-state";
import { promotionOptionLabel, type PromotionOption } from "@/lib/promotion";
import {
  FUNDING_TYPE_OPTIONS,
  LEVEL_OPTIONS,
  PROJECT_CATEGORY_OPTIONS,
  PROJECT_ROLE_OPTIONS,
  PROJECT_STATUS_OPTIONS,
} from "@/lib/options";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg" className="min-w-32">
      {pending ? "保存中…" : label}
    </Button>
  );
}

export type ProjectSourceOption = { id: string; name: string };

export type ProjectFormDefaults = {
  title?: string | null;
  shortTitle?: string | null;
  code?: string | null;
  level?: string | null;
  category?: string | null;
  fundingType?: string | null;
  sourceId?: string | null;
  hostUnit?: string | null;
  ownerOrder?: number | null;
  memberCount?: number | null;
  role?: string | null;
  status?: string | null;
  applyDeadline?: Date | null;
  startDate?: Date | null;
  endDate?: Date | null;
  closingDeadline?: Date | null;
  promotionCategoryId?: string | null;
  promotionScore?: number | null;
  researchContent?: string | null;
  note?: string | null;
};

export function ProjectForm({
  action,
  defaults,
  submitLabel,
  dataVersion,
  sources,
  projectPromotionOptions,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: ProjectFormDefaults;
  submitLabel: string;
  /** 服务端数据版本，传 updatedAt。变了就重挂字段区，理由见 AchievementForm */
  dataVersion?: string;
  /** 已登记的来源单位。选不到时可以现场新增 */
  sources: ProjectSourceOption[];
  /** 课题能挂的职称指标，已由调用方筛成 5.2 / 5.3 两项 */
  projectPromotionOptions: PromotionOption[];
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const errorsOf = (field: string) => state.fieldErrors?.[field];

  const [addingSource, setAddingSource] = useState(false);

  return (
    <form action={formAction} className="space-y-8">
      {/* 字段区单独 key，状态留在外层——理由见 AchievementForm 里那段注释。
          分组之间加一道分隔线：原来四个小标题只是灰字，
          「基本信息」到「状态与时间」之间没有任何视觉断点，
          十几个输入框看上去是一长条 */}
      <div
        key={dataVersion}
        className="[&>section+section]:mt-6 [&>section+section]:border-t [&>section+section]:border-border/50 [&>section+section]:pt-6"
      >
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            基本信息
          </h2>

          <TextField
            name="title"
            label="课题全称"
            required
            defaultValue={defaults?.title}
            hint="照立项文件原文填，简称另填下一栏"
            errors={errorsOf("title")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="shortTitle"
              label="简称"
              defaultValue={defaults?.shortTitle}
              hint="看板卡片上显示这个"
              errors={errorsOf("shortTitle")}
            />
            <TextField
              name="code"
              label="课题编号"
              defaultValue={defaults?.code}
              placeholder="如 MZGZ202601"
              errors={errorsOf("code")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="fundingType"
              label="纵向 / 横向"
              options={FUNDING_TYPE_OPTIONS}
              defaultValue={defaults?.fundingType ?? "VERTICAL"}
              hint="纵向是政府或院校立项拨款，横向是企业委托的合同研究"
              errors={errorsOf("fundingType")}
            />
            <SelectField
              name="category"
              label="研究类型"
              options={PROJECT_CATEGORY_OPTIONS}
              defaultValue={defaults?.category ?? "RESEARCH"}
              hint="与上一栏无关——横向项目同样可以是科研"
              errors={errorsOf("category")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="level"
              label="级别"
              options={LEVEL_OPTIONS}
              defaultValue={defaults?.level ?? "UNRATED"}
              errors={errorsOf("level")}
            />
            <SelectField
              name="role"
              label="本人角色"
              options={PROJECT_ROLE_OPTIONS}
              defaultValue={defaults?.role ?? "LEAD"}
              errors={errorsOf("role")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="ownerOrder"
              label="本人排名"
              type="number"
              defaultValue={defaults?.ownerOrder?.toString()}
              placeholder="3"
              hint="在成员名单里排第几。主持人通常填 1"
              errors={errorsOf("ownerOrder")}
            />
            <TextField
              name="memberCount"
              label="成员总数"
              type="number"
              defaultValue={defaults?.memberCount?.toString()}
              placeholder="6"
              hint="两栏都填才会显示成「3/6」"
              errors={errorsOf("memberCount")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={addingSource ? "newSourceName" : "sourceId"}>
                立项来源
              </Label>

              {addingSource ? (
                <>
                  <Input
                    id="newSourceName"
                    name="newSourceName"
                    placeholder="如 明州市社科联"
                    autoFocus
                  />
                  <input type="hidden" name="sourceId" value="" />
                </>
              ) : (
                <>
                  <select
                    id="sourceId"
                    name="sourceId"
                    defaultValue={defaults?.sourceId ?? ""}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="">未填</option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                  <input type="hidden" name="newSourceName" value="" />
                </>
              )}

              <button
                type="button"
                onClick={() => setAddingSource((prev) => !prev)}
                className="text-xs text-muted-foreground underline underline-offset-4"
              >
                {addingSource ? "从已有来源里选" : "列表里没有？新增一个"}
              </button>
              {errorsOf("sourceId")?.map((error) => (
                <p
                  key={error}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {error}
                </p>
              ))}
            </div>

            <TextField
              name="hostUnit"
              label="承担单位"
              defaultValue={defaults?.hostUnit}
              errors={errorsOf("hostUnit")}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            状态与时间
          </h2>

          <SelectField
            name="status"
            label="状态"
            options={PROJECT_STATUS_OPTIONS}
            defaultValue={defaults?.status ?? "ONGOING"}
            hint="拟申报/申报中看申报截止日倒计时，在研之后看结题材料截止日"
            errors={errorsOf("status")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              name="applyDeadline"
              label="申报截止日"
              defaultValue={defaults?.applyDeadline}
              errors={errorsOf("applyDeadline")}
            />
            <DateField
              name="closingDeadline"
              label="结题材料截止日"
              defaultValue={defaults?.closingDeadline}
              hint="看板倒计时用的是这个，不是研究期终止日"
              errors={errorsOf("closingDeadline")}
            />
            <DateField
              name="startDate"
              label="立项日"
              defaultValue={defaults?.startDate}
              errors={errorsOf("startDate")}
            />
            <DateField
              name="endDate"
              label="研究期终止日"
              defaultValue={defaults?.endDate}
              errors={errorsOf("endDate")}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            职称量化
          </h2>

          {projectPromotionOptions.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="promotionCategoryId">人事处指标</Label>
                <select
                  id="promotionCategoryId"
                  name="promotionCategoryId"
                  defaultValue={defaults?.promotionCategoryId ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">不计入职称</option>
                  {projectPromotionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {promotionOptionLabel(option)}
                    </option>
                  ))}
                </select>
                {/* 不按纵向/横向自动选：那就是第 11 条禁止的映射函数，
                  人事处哪年把这两格合并或拆细，自动匹配就开始骗人 */}
                <p className="text-xs text-muted-foreground">
                  一个课题只占一行——5.2 是「每项加 N 分」，按项赋分，
                  不是立项算一次、结题再算一次。选哪一格由你定，系统不按纵横向替你猜
                </p>
              </div>
              <TextField
                name="promotionScore"
                label="职称量化分"
                type="number"
                step="0.1"
                defaultValue={defaults?.promotionScore?.toString()}
                hint="人工填。5.2 国家级 6 / 省级 4 / 市级 2，本栏上限 10 分"
                errors={errorsOf("promotionScore")}
              />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                还没导入人事处的职称量化表，跑一次{" "}
                <code>npm run import:promotion-rules</code> 后这里才有选项。
              </p>
              <input
                type="hidden"
                name="promotionCategoryId"
                value={defaults?.promotionCategoryId ?? ""}
              />
              <input
                type="hidden"
                name="promotionScore"
                value={defaults?.promotionScore ?? ""}
              />
            </>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">其他</h2>

          <TextAreaField
            name="researchContent"
            label="研究内容"
            defaultValue={defaults?.researchContent}
            hint="将来 AI 建议成果规划时会拿它当输入"
            errors={errorsOf("researchContent")}
          />
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

      {/* 长表单末尾的主操作。原来是一枚 56px 宽的小按钮孤零零贴在左下角，
          滚了两屏填完十几个字段之后，视线根本落不到它上面 */}
      <div className="border-t border-border/50 pt-5">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
