"use client";

import { startTransition, useActionState, type FormEvent } from "react";

/**
 * 不让 React 在动作跑完后重置表单的 useActionState。
 *
 * `<form action={fn}>` 的动作一跑完（**不管返回的是成功还是报错**），React 19 就把表单重置：
 * 未受控的字段回到默认值，受控的复选框和下拉在 DOM 上也会被复原——界面上看着还勾着，
 * 下一次提交的 FormData 里却没有它。2026-09-27 粘贴导入就栽在这里：预览时「第一行是表头」勾着，
 * 点「确认导入」提交上去的却是没勾，服务端核对出参数变了，退回一份按没有表头重算的预览。
 *
 * 这里自己从表单取 FormData（连同点的是哪个按钮：`mode=confirm` 靠它）再派发，不走 form 的 action，
 * 也就没有那次重置。代价是 `useFormStatus` 用不了，按钮的「提交中」改看这里返回的 `pending`。
 * 需要成功后清空的表单（「添加一项」）由调用方自己 `reset()`。
 */
export function useDispatchForm<State>(
  action: (state: Awaited<State>, formData: FormData) => State | Promise<State>,
  initial: Awaited<State>,
) {
  const [state, dispatch, pending] = useActionState(action, initial);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }
  return { state, onSubmit, pending };
}
