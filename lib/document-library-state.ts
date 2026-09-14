import type { FormState } from "./form-state";

export type DocumentLibraryNotice = {
  tone: "success" | "warning" | "error";
  message: string;
};

/**
 * useActionState 每次 action 返回都会给出一个新对象；只消费尚未消费过的成功对象，
 * 就能避免父级 props 更新或失败结果重置文件选择，同时不漏掉文案相同的连续成功。
 */
export function shouldResetUploadForm(
  lastResetResult: FormState | undefined,
  nextResult: FormState,
): boolean {
  return nextResult.ok && nextResult !== lastResetResult;
}

/** 删除涉及不可逆的磁盘清理，界面一次只允许一个请求在途。 */
export function beginDocumentDelete(pendingDeleteId: string | null, attachmentId: string) {
  if (pendingDeleteId !== null) return { started: false, pendingDeleteId } as const;
  return { started: true, pendingDeleteId: attachmentId } as const;
}

/** 删除反馈必须脱离行组件保存，避免 revalidate 后行卸载带走消息。 */
export function deleteNoticeFromState(state: FormState): DocumentLibraryNotice | null {
  if (!state.message) return null;
  return {
    tone: state.tone ?? (state.ok ? "success" : "error"),
    message: state.message,
  };
}
