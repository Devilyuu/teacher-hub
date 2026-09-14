import { describe, expect, it } from "vitest";
import {
  buildMaterialZipPlan,
  sanitizeZipSegment,
  type MaterialAttachment,
} from "./materials-zip";

const UPLOADED = new Date("2026-07-31T00:00:00.000Z");

function attachment(overrides: Partial<MaterialAttachment> & { id: string }): MaterialAttachment {
  return {
    code: null,
    kind: "PROPOSAL",
    filename: "文件.pdf",
    storagePath: `projects/p/${overrides.id}.pdf`,
    size: 100,
    uploadedAt: UPLOADED,
    ...overrides,
  };
}

describe("sanitizeZipSegment", () => {
  it("路径分隔符换成下划线——包里不留任何路径结构", () => {
    expect(sanitizeZipSegment("a/b\\c")).toBe("a_b_c");
    expect(sanitizeZipSegment("../../.env")).toBe("_.._.env");
  });

  it("Windows 非法字符换掉", () => {
    expect(sanitizeZipSegment('报告<1>:"x"|y?z*')).toBe("报告_1___x__y_z_");
  });

  it("非空白控制字符直接删掉，不留占位", () => {
    const raw = `报${String.fromCharCode(0)}告${String.fromCharCode(31)}${String.fromCharCode(127)}`;
    expect(sanitizeZipSegment(raw)).toBe("报告");
  });

  /** 删掉制表和换行会把两个词粘成一个，「报告 终稿」变成「报告终稿」 */
  it("制表与换行换成空格，不是删掉", () => {
    expect(sanitizeZipSegment("报告\t终稿")).toBe("报告 终稿");
    expect(sanitizeZipSegment("报告\r\n终稿")).toBe("报告 终稿");
  });

  /** Windows 会把末尾的点静默吃掉，末尾空格则根本创建不出来 */
  it("去掉首尾的点和空格", () => {
    expect(sanitizeZipSegment("  报告.  ")).toBe("报告");
    expect(sanitizeZipSegment("...报告")).toBe("报告");
  });

  it("连续空白压成一个空格", () => {
    expect(sanitizeZipSegment("研究  报告\t\n终稿")).toBe("研究 报告 终稿");
  });

  it("清完变空时给个兜底名，不返回空串", () => {
    expect(sanitizeZipSegment("///")).toBe("___");
    expect(sanitizeZipSegment("   ")).toBe("未命名");
    expect(sanitizeZipSegment(String.fromCharCode(0))).toBe("未命名");
  });
});

describe("buildMaterialZipPlan 命名", () => {
  it("编号 + 类型 + 原始文件名（规格 7.4）", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [
        attachment({ id: "a", code: "1-1", kind: "FINAL_REPORT", filename: "结项报告.docx" }),
      ],
      achievementEvidence: [],
      selectedIds: null,
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].name).toBe("1-1_结题报告_结项报告.docx");
  });

  it("没有编号时用运行序号补，保证包内有稳定次序", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [
        attachment({ id: "a", filename: "甲.pdf" }),
        attachment({ id: "b", filename: "乙.pdf" }),
      ],
      achievementEvidence: [],
      selectedIds: null,
    });

    expect(plan.entries.map((e) => e.name)).toEqual(["01_申报书_甲.pdf", "02_申报书_乙.pdf"]);
  });

  /**
   * 同一课题里同名文件很常见（同一份报告的两个版本各存了一次）。
   * ZIP 允许重名条目，但解压时后者会覆盖前者，用户拿到的材料就少一份。
   */
  it("重名加 (2)(3)，序号加在扩展名前面", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [
        attachment({ id: "a", code: "1", filename: "报告.pdf" }),
        attachment({ id: "b", code: "1", filename: "报告.pdf" }),
        attachment({ id: "c", code: "1", filename: "报告.pdf" }),
      ],
      achievementEvidence: [],
      selectedIds: null,
    });

    expect(plan.entries.map((e) => e.name)).toEqual([
      "1_申报书_报告.pdf",
      "1_申报书_报告(2).pdf",
      "1_申报书_报告(3).pdf",
    ]);
  });

  /**
   * `CON`/`AUX`/`COM1` 这类名字在 Windows 上创建不出来，解压当场失败。
   * 挡住它们的不是一段专门的代码，而是「编号_类型_」这个必然存在的前缀——
   * 锁住这条不变量，改命名规则时才会被提醒。
   */
  it("条目主干永远不会正好是 Windows 保留设备名", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [
        attachment({ id: "a", code: "", kind: "OTHER", filename: "CON.pdf" }),
        attachment({ id: "b", code: null, kind: "OTHER", filename: "AUX" }),
        attachment({ id: "c", code: "  ", kind: "OTHER", filename: "COM1.docx" }),
      ],
      achievementEvidence: [],
      selectedIds: null,
    });

    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    for (const entry of plan.entries) {
      const base = entry.name.replace(/\.[^.]*$/, "");
      expect(base, entry.name).not.toMatch(reserved);
      // 前缀段非空是这条保证的前提，一并锁住
      expect(entry.name.split("_").length).toBeGreaterThanOrEqual(3);
      expect(entry.name.startsWith("_")).toBe(false);
    }
  });

  it("超长名截断但保住扩展名", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [attachment({ id: "a", code: "1", filename: `${"长".repeat(300)}.docx` })],
      achievementEvidence: [],
      selectedIds: null,
    });

    expect(plan.entries[0].name.length).toBeLessThanOrEqual(110);
    expect(plan.entries[0].name.endsWith(".docx")).toBe(true);
  });
});

describe("buildMaterialZipPlan 去重与选择", () => {
  /**
   * 规格 6.4：两条路径各取一次再按 attachment id 去重。
   * 不去重的话，既是课题材料又被成果引用的 PDF 会进包两次，
   * 评审看到两个同名文件会以为交重了。
   */
  it("同一附件走两条路只进包一次，算作课题材料", () => {
    const shared = attachment({ id: "shared", code: "2", filename: "共用.pdf" });
    const plan = buildMaterialZipPlan({
      projectMaterials: [shared],
      achievementEvidence: [shared, attachment({ id: "only-evidence", code: "3" })],
      selectedIds: null,
    });

    expect(plan.entries.map((e) => e.attachmentId)).toEqual(["shared", "only-evidence"]);
    expect(plan.entries[0].source).toBe("PROJECT");
    expect(plan.entries[1].source).toBe("ACHIEVEMENT");
  });

  it("课题材料排在成果证据前面", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [attachment({ id: "p1" }), attachment({ id: "p2" })],
      achievementEvidence: [attachment({ id: "e1" })],
      selectedIds: null,
    });

    expect(plan.entries.map((e) => e.source)).toEqual(["PROJECT", "PROJECT", "ACHIEVEMENT"]);
  });

  it("勾选下载只收勾中的，编号仍按全部候选算", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [
        attachment({ id: "a", filename: "甲.pdf" }),
        attachment({ id: "b", filename: "乙.pdf" }),
        attachment({ id: "c", filename: "丙.pdf" }),
      ],
      achievementEvidence: [],
      selectedIds: ["c"],
    });

    // 单勾第三份时仍叫 03，和整包下载里的那份同名，不会互相覆盖
    expect(plan.entries.map((e) => e.name)).toEqual(["03_申报书_丙.pdf"]);
  });

  it("勾了不属于本课题的 id 时如实报出来，不静默忽略", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [attachment({ id: "a" })],
      achievementEvidence: [],
      selectedIds: ["a", "不存在的", "别的课题的"],
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.unknownSelectedIds).toEqual(["不存在的", "别的课题的"]);
  });

  it("统计总字节数，供路由决定要不要拦下超大包", () => {
    const plan = buildMaterialZipPlan({
      projectMaterials: [attachment({ id: "a", size: 1000 }), attachment({ id: "b", size: 2000 })],
      achievementEvidence: [],
      selectedIds: null,
    });

    expect(plan.totalBytes).toBe(3000);
  });

  it("什么都没有时返回空计划，不抛错", () => {
    expect(
      buildMaterialZipPlan({ projectMaterials: [], achievementEvidence: [], selectedIds: null }),
    ).toEqual({ entries: [], unknownSelectedIds: [], totalBytes: 0 });
  });
});
