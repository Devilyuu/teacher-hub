import { z } from "zod";
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";

/**
 * 材料类型。**从中文映射表派生，不再手抄一份取值**——
 * 照 `levelEnum`（lib/schemas/project.ts）的做法。
 *
 * 这里原本是手抄的 11 项，而 schema.prisma 的 `AttachmentKind` 有 12 项：
 * 后加的 `AWARD_CERTIFICATE`（获奖证书，台账里这类最多）只补进了下拉，
 * 没补进校验，于是选它上传必然失败。`ATTACHMENT_KIND_LABELS` 有
 * `satisfies Record<AttachmentKind, string>` 锁着完整性，从它派生就不会再漏。
 */
export const attachmentKindEnum = z.enum(
  Object.keys(ATTACHMENT_KIND_LABELS) as [
    keyof typeof ATTACHMENT_KIND_LABELS,
    ...(keyof typeof ATTACHMENT_KIND_LABELS)[],
  ],
  // 默认文案是英文的一长串取值枚举，会原样显示在界面上（界面文案全中文）
  { error: "材料类型不认识，请从下拉里重选一个" },
);

export const attachmentUploadSchema = z.object({
  kind: attachmentKindEnum,
  note: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value)),
});
