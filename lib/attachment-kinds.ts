import type { AttachmentKind } from "@/lib/generated/prisma/enums";
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";

/**
 * 附件类型**按归属**给：上传下拉有哪几项、默认选哪项、空状态怎么说。
 *
 * 2026-09-23 验收查出来的：附件面板是课题、成果、参赛、学生项目四处共用的，
 * 原来一律是全量 15 项、默认「申报书」、空状态写「申报书、立项通知、结题报告」。
 * 学生项目传一份任务书，不改下拉就被归成「申报书」；参赛记录从上线起就是这样。
 *
 * **界面下拉和服务端上传动作共用这一份**（同 `lib/requirement-types.ts` 的规矩）：
 * 两边各存一份，早晚出现「界面藏起来、服务端照收」。
 *
 * 只收窄选项，**不加枚举值**——任务书、开题报告归「过程证据」。
 * 枚举加了不可回滚（规格 §14），而分组看的是「这是哪一类东西」，不是文件的原名。
 */

export type AttachmentUploadOwner = "project" | "achievement" | "competitionEntry" | "menteeProject";

type KindProfile = {
  kinds: readonly AttachmentKind[];
  defaultKind: AttachmentKind;
  /** 还没有材料时的一句话，说清这里该放什么 */
  emptyHint: string;
};

const ALL_KINDS = Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[];

export const ATTACHMENT_KIND_PROFILES: Record<AttachmentUploadOwner, KindProfile> = {
  // 课题和成果维持全量：它们本来就是这套类型的主人，分组顺序也是按课题生命周期排的
  project: {
    kinds: ALL_KINDS,
    defaultKind: "PROPOSAL",
    emptyHint: "申报书、立项通知、结题报告都可以放这里，按类型归好档。",
  },
  achievement: {
    kinds: ALL_KINDS,
    defaultKind: "PROPOSAL",
    emptyHint: "录用通知、见刊页、收录证明、证书都可以放这里，按类型归好档。",
  },
  // 「获奖证书」必须在：引用为成果时只有它会跟着成果走（CLAUDE.md「指导参赛」）
  competitionEntry: {
    kinds: ["PROCESS_EVIDENCE", "CERTIFICATE", "AWARD_CERTIFICATE", "OTHER"],
    defaultKind: "PROCESS_EVIDENCE",
    emptyHint: "赛事通知、报名表归「过程证据」，获奖证书单独选「获奖证书」。",
  },
  menteeProject: {
    kinds: [
      "MIDTERM",
      "PROCESS_EVIDENCE",
      "CHECK_REPORT",
      "FINAL_REPORT",
      "CERTIFICATE",
      "AWARD_CERTIFICATE",
      "OTHER",
    ],
    defaultKind: "PROCESS_EVIDENCE",
    emptyHint: "任务书、开题报告、作品文件归「过程证据」，中期检查表和查重报告各有一类。",
  },
};

export function attachmentKindOptions(owner: AttachmentUploadOwner) {
  return ATTACHMENT_KIND_PROFILES[owner].kinds.map((kind) => ({
    value: kind,
    label: ATTACHMENT_KIND_LABELS[kind],
  }));
}

/** 服务端复核用。personal / studentHonor 走 forcedKind，不在这里 */
export function isAttachmentKindAllowed(owner: AttachmentUploadOwner, kind: AttachmentKind): boolean {
  return ATTACHMENT_KIND_PROFILES[owner].kinds.includes(kind);
}
