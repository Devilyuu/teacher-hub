"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { DateField, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";

export type ProfileFormDefaults = {
  name: string;
  unit: string;
  department: string | null;
  title: string | null;
  currentTitle: string | null;
  currentTitleSince: Date | null;
  phone: string | null;
  email: string | null;
  obsidianVaultPath: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

export function ProfileForm({
  action,
  defaults,
  dataVersion,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: ProfileFormDefaults;
  /** 传 updatedAt。存完 revalidate 后字段区靠它重挂，见下面那段注释 */
  dataVersion?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const errorsOf = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="space-y-8">
      {/* 字段区单独 key、状态留在外层。
          非受控表单 + Server Action + revalidatePath 本页 = 输入框弹回旧值：
          存完 revalidate 让 defaults 变了，Base UI 却不会拿新的 defaultValue
          重刷已挂载的输入框，看起来就是「保存不了」。key 挂到 <form> 上会连
          「已保存」提示一起清掉，所以只包字段区（代码约定）。 */}
      <div key={dataVersion} className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">基本信息</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="name" label="姓名" required defaultValue={defaults.name} />
            <TextField
              name="unit"
              label="承担单位"
              required
              defaultValue={defaults.unit}
              hint="申报书里「承担单位」那一栏的正式全称"
            />
            <TextField name="department" label="所在部门" defaultValue={defaults.department} />
            <TextField
              name="title"
              label="职务"
              defaultValue={defaults.title}
              hint="如「系主任」。与下面的职称是两回事"
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">职称</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="currentTitle"
              label="现职称"
              defaultValue={defaults.currentTitle}
              hint="如「副教授」"
            />
            <DateField
              name="currentTitleSince"
              label="现职称取得日期"
              defaultValue={defaults.currentTitleSince}
              errors={errorsOf("currentTitleSince")}
              hint="职称量化只算任现职以来的成果，成果库的职称口径按这个日期过滤"
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">其他</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="phone" label="联系电话" defaultValue={defaults.phone} />
            <TextField
              name="email"
              label="邮箱"
              defaultValue={defaults.email}
              errors={errorsOf("email")}
            />
            <TextField
              name="obsidianVaultPath"
              label="Obsidian vault 路径"
              defaultValue={defaults.obsidianVaultPath}
              className="sm:col-span-2"
              hint="本地笔记库的根目录，用来把课题和成果上记的笔记路径拼成可点的 obsidian:// 链接"
            />
          </div>
        </section>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state.message ? (
          <span
            role="status"
            className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
