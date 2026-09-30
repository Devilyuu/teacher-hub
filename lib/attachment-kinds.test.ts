import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_KIND_PROFILES,
  attachmentKindOptions,
  isAttachmentKindAllowed,
  type AttachmentUploadOwner,
} from "@/lib/attachment-kinds";
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";

const OWNERS = Object.keys(ATTACHMENT_KIND_PROFILES) as AttachmentUploadOwner[];
const ALL = Object.keys(ATTACHMENT_KIND_LABELS);

describe("附件类型按归属", () => {
  it.each(OWNERS)("%s：默认值在自己的名单里、名单都是真实枚举值", (owner) => {
    const profile = ATTACHMENT_KIND_PROFILES[owner];
    expect(profile.kinds).toContain(profile.defaultKind);
    for (const kind of profile.kinds) expect(ALL).toContain(kind);
  });

  it.each(OWNERS)("%s：下拉顺序跟全局分组顺序一致（分组和下拉不各排各的）", (owner) => {
    const values = attachmentKindOptions(owner).map((option) => option.value);
    expect(values).toEqual(ALL.filter((kind) => values.includes(kind as never)));
  });

  // 这是 2026-09-23 验收查出来的：学生项目传任务书，不改下拉就被归成「申报书」
  it("参赛和学生项目不再默认「申报书」，也不收课题专属的类型", () => {
    for (const owner of ["competitionEntry", "menteeProject"] as const) {
      expect(ATTACHMENT_KIND_PROFILES[owner].defaultKind).not.toBe("PROPOSAL");
      for (const kind of ["PROPOSAL", "APPROVAL", "CONTRACT", "PUBLICATION", "TEACHING_PLAN"] as const) {
        expect(isAttachmentKindAllowed(owner, kind)).toBe(false);
      }
    }
  });

  it("参赛必须能选「获奖证书」：引用为成果时只有它跟着走", () => {
    expect(isAttachmentKindAllowed("competitionEntry", "AWARD_CERTIFICATE")).toBe(true);
  });

  it("课题和成果维持全量", () => {
    expect(ATTACHMENT_KIND_PROFILES.project.kinds).toHaveLength(ALL.length);
    expect(ATTACHMENT_KIND_PROFILES.achievement.kinds).toHaveLength(ALL.length);
  });

  it("空状态文案不再四处共用课题那一句", () => {
    const hints = OWNERS.map((owner) => ATTACHMENT_KIND_PROFILES[owner].emptyHint);
    expect(new Set(hints).size).toBe(OWNERS.length);
  });
});
