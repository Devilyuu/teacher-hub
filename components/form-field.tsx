"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type BaseProps = {
  name: string;
  label: string;
  /** 该字段的报错，来自 Server Action 返回的 fieldErrors */
  errors?: string[];
  hint?: string;
  required?: boolean;
  className?: string;
};

function FieldShell({
  name,
  label,
  errors,
  hint,
  required,
  className,
  children,
}: BaseProps & { children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
      {/* 字段说明也限行长：跨两列的字段（`sm:col-span-2`）说明会铺到 1232px，
          一行 45 个汉字 */}
      {hint ? <p className="measure text-xs text-muted-foreground">{hint}</p> : null}
      {errors?.map((error) => (
        <p key={error} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </div>
  );
}

export function TextField({
  defaultValue,
  type = "text",
  placeholder,
  step,
  ...props
}: BaseProps & {
  defaultValue?: string | null;
  type?: string;
  placeholder?: string;
  /** type="number" 时的步进。分值字段要 0.1，不给的话浏览器只让填整数 */
  step?: string;
}) {
  return (
    <FieldShell {...props}>
      <Input
        id={props.name}
        name={props.name}
        type={type}
        step={step}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        aria-invalid={props.errors ? true : undefined}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  defaultValue,
  rows = 4,
  placeholder,
  ...props
}: BaseProps & { defaultValue?: string | null; rows?: number; placeholder?: string }) {
  return (
    <FieldShell {...props}>
      <Textarea
        id={props.name}
        name={props.name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        aria-invalid={props.errors ? true : undefined}
      />
    </FieldShell>
  );
}

/**
 * 原生 select。shadcn 的 Select 是 JS 组件，值不会随原生表单提交，
 * 而 Server Action 走的正是原生 FormData——这里用原生元素最省事也最不容易错。
 */
export function SelectField({
  defaultValue,
  options,
  placeholder,
  ...props
}: BaseProps & {
  defaultValue?: string | null;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <FieldShell {...props}>
      <select
        id={props.name}
        name={props.name}
        defaultValue={defaultValue ?? ""}
        aria-invalid={props.errors ? true : undefined}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** 日期一律用原生 date 控件，提交上来是 YYYY-MM-DD，由 zod 转成 UTC 纯日期 */
export function DateField({
  defaultValue,
  ...props
}: BaseProps & { defaultValue?: Date | string | null }) {
  const value =
    defaultValue instanceof Date
      ? defaultValue.toISOString().slice(0, 10)
      : (defaultValue ?? "");

  return <TextField {...props} type="date" defaultValue={value} />;
}
