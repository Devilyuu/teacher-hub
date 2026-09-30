import type { z } from "zod";

/**
 * Server Action 的统一返回形状。
 * `fieldErrors` 按字段名分组，表单直接把对应的消息渲染到输入框下面。
 */
export type FormState = {
  ok: boolean;
  /** 允许成功但需要人工跟进的结果（如数据库记录已删、文件仍待清理）。 */
  tone?: "success" | "warning" | "error";
  /** 整体错误，如"课题编号已存在" */
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const IDLE_FORM_STATE: FormState = { ok: false };

export type FormMessageTone = NonNullable<FormState["tone"]>;

/** 三档语气对应的文字颜色。完整类名写死在这里，Tailwind 扫源码才收得到 */
const FORM_MESSAGE_TONE_CLASS: Record<FormMessageTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-300",
  error: "text-destructive",
};

/**
 * `FormState.message` 那一行字的配色：成功绿、警告琥珀、失败红。
 *
 * 集中一处的原因：这串类名曾在 20 多个表单里逐字复制，
 * 谁改配色少改一处，就会出现「这页的保存成功是另一种绿」的漂移。
 * 传 `state.ok` 走成功/失败两档；有 `tone` 的（如删除结果）直接传 tone。
 */
export function formMessageClass(
  okOrTone: boolean | FormMessageTone,
  size: "xs" | "sm" = "xs",
): string {
  const tone: FormMessageTone =
    typeof okOrTone === "boolean" ? (okOrTone ? "success" : "error") : okOrTone;
  return `${size === "sm" ? "text-sm" : "text-xs"} ${FORM_MESSAGE_TONE_CLASS[tone]}`;
}

/**
 * 把 zod 的错误摊平成 FormState。
 *
 * 整体提示**直接说出第一条原因**，不再是「看下标红的地方」：不少表单只渲染
 * `state.message`、不画字段级报错，那句话在它们那里是个兑现不了的承诺——
 * 2026-09-24 用户建批次时就是看着这句话、满屏找不到一处红。
 *
 * schema 里写的中文提示才是给人看的；zod 自带的英文报错（「expected string,
 * received undefined」）几乎都是表单和 schema 对不上，**不是用户填错了**，
 * 照实说是系统的问题，并带上字段名方便报给维护的人
 */
export function toFormState(error: z.ZodError): FormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }

  const [first, ...rest] = error.issues;
  if (!first) return { ok: false, message: "没保存成功，请重试", fieldErrors };
  const reason = /[一-鿿]/.test(first.message)
    ? first.message
    : `「${first.path.join(".") || "表单"}」这一项和系统对不上，不是你填错了，请把这句话告诉维护的人`;
  const message = rest.length > 0 ? `${reason}（另有 ${rest.length} 处没填对）` : reason;
  return { ok: false, message, fieldErrors };
}
