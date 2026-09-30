import { describe, expect, it } from "vitest";
import type { DeclarationPackage, PackageRow } from "./declaration";
import {
  buildDeclarationMaterialPlan,
  declarationSourceKey,
  isDeclarationMaterial,
  type DeclarationMaterial,
} from "./declaration-materials";

function row(index: number, sourceKind: PackageRow["sourceKind"], sourceId: string): PackageRow {
  return {
    index,
    sourceKind,
    sourceId,
    title: sourceId,
    year: 2026,
    level: "省级",
    ownerRole: "",
    score: 1,
    attachmentCount: 0,
  };
}

function pkg(rows: PackageRow[]): DeclarationPackage {
  return {
    kind: "performance",
    year: 2026,
    groups: [{ key: "g", label: "g", parent: "p", subtotal: 0, rows }],
    total: 0,
    missingMaterialCount: 0,
  };
}

function material(
  id: string,
  kind: DeclarationMaterial["kind"],
  filename: string,
  uploadedAt = new Date("2026-03-01T00:00:00Z"),
  size = 100,
): DeclarationMaterial {
  return { id, kind, filename, storagePath: `2026/${id}`, size, uploadedAt };
}

describe("buildDeclarationMaterialPlan", () => {
  /** prd-ledger 4.2：支撑材料按材料编号命名，编号就是明细表的序号 */
  it("文件按明细表序号编号：第几行就是几号，同一行里再编 -1、-2", () => {
    const plan = buildDeclarationMaterialPlan(
      pkg([row(1, "ACHIEVEMENT", "a1"), row(2, "ACHIEVEMENT", "a2")]),
      new Map([
        [declarationSourceKey("ACHIEVEMENT", "a1"), [material("f1", "AWARD_CERTIFICATE", "证书.pdf")]],
        [
          declarationSourceKey("ACHIEVEMENT", "a2"),
          [material("f2", "PUBLICATION", "见刊页.pdf"), material("f3", "INDEX_PROOF", "收录.pdf")],
        ],
      ]),
    );
    expect(plan.entries.map((entry) => [entry.rowIndex, entry.no, entry.name])).toEqual([
      [1, "01-1", "支撑材料/01-1_获奖证书_证书.pdf"],
      [2, "02-1", "支撑材料/02-1_见刊页_见刊页.pdf"],
      [2, "02-2", "支撑材料/02-2_收录证明_收录.pdf"],
    ]);
    expect(plan.totalBytes).toBe(300);
  });

  it("没有材料的行不占编号以外的位置，后面的行照旧用自己的序号", () => {
    const plan = buildDeclarationMaterialPlan(
      pkg([row(1, "ACHIEVEMENT", "empty"), row(2, "ACHIEVEMENT", "a2")]),
      new Map([[declarationSourceKey("ACHIEVEMENT", "a2"), [material("f", "OTHER", "x.pdf")]]]),
    );
    expect(plan.entries.map((entry) => entry.no)).toEqual(["02-1"]);
  });

  /** 资源管理器按名字排：10 号不能排到 2 号前面 */
  it("序号补零到统一宽度，一百行以上补到三位", () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i + 1, "ACHIEVEMENT", `a${i + 1}`));
    const plan = buildDeclarationMaterialPlan(
      pkg(rows),
      new Map([
        [declarationSourceKey("ACHIEVEMENT", "a7"), [material("f7", "OTHER", "x.pdf")]],
        [declarationSourceKey("ACHIEVEMENT", "a120"), [material("f120", "OTHER", "y.pdf")]],
      ]),
    );
    expect(plan.entries.map((entry) => entry.no)).toEqual(["007-1", "120-1"]);
  });

  /** 同一份数据导两次编号一模一样，两次下载的包放在一起不会对不上 */
  it("同一行里按类型的生命周期、再按上传时间排，结果和传入顺序无关", () => {
    const later = new Date("2026-05-01T00:00:00Z");
    const earlier = new Date("2026-01-01T00:00:00Z");
    const plan = buildDeclarationMaterialPlan(
      pkg([row(1, "ACHIEVEMENT", "a1")]),
      new Map([
        [
          declarationSourceKey("ACHIEVEMENT", "a1"),
          [
            material("c", "OTHER", "其他.pdf"),
            material("b", "PUBLICATION", "晚.pdf", later),
            material("a", "PUBLICATION", "早.pdf", earlier),
            material("d", "ACCEPTANCE", "录用.pdf"),
          ],
        ],
      ]),
    );
    expect(plan.entries.map((entry) => entry.filename)).toEqual([
      "录用.pdf",
      "早.pdf",
      "晚.pdf",
      "其他.pdf",
    ]);
  });

  /**
   * 课题绩效事项没有自己的附件，收它所属课题的材料（sources.ts 按事项 id 挂好）。
   * 同一课题同一年两条事项，两行各带一份——和明细表两行各写的「材料份数」对得上
   */
  it("两条事项指向同一份课题材料时，两行各带一份、各用各的序号", () => {
    const shared = [material("p1", "APPROVAL", "立项通知.pdf")];
    const plan = buildDeclarationMaterialPlan(
      pkg([row(1, "PROJECT_EVENT", "e1"), row(2, "PROJECT_EVENT", "e2")]),
      new Map([
        [declarationSourceKey("PROJECT_EVENT", "e1"), shared],
        [declarationSourceKey("PROJECT_EVENT", "e2"), shared],
      ]),
    );
    expect(plan.entries.map((entry) => [entry.no, entry.attachmentId])).toEqual([
      ["01-1", "p1"],
      ["02-1", "p1"],
    ]);
  });

  it("成果和事项的 id 撞了也不会串到别人的材料", () => {
    const plan = buildDeclarationMaterialPlan(
      pkg([row(1, "ACHIEVEMENT", "x"), row(2, "PROJECT_EVENT", "x")]),
      new Map([[declarationSourceKey("PROJECT_EVENT", "x"), [material("f", "OTHER", "y.pdf")]]]),
    );
    expect(plan.entries.map((entry) => entry.no)).toEqual(["02-1"]);
  });

  it("包内名字不带路径穿越：原文件名里的斜杠和冒号被换掉，只留一层目录", () => {
    const plan = buildDeclarationMaterialPlan(
      pkg([row(1, "ACHIEVEMENT", "a1")]),
      new Map([[declarationSourceKey("ACHIEVEMENT", "a1"), [material("f", "OTHER", "../../etc:passwd")]]]),
    );
    const [name] = plan.entries.map((entry) => entry.name);
    expect(name).toBe("支撑材料/01-1_其他__.._etc_passwd");
    // 穿越要的是一整段等于「..」；字符里带两个点无害（lib/zip.ts 也按段查）
    expect(name.split("/")).toEqual(["支撑材料", "01-1_其他__.._etc_passwd"]);
  });
});

describe("isDeclarationMaterial", () => {
  /** 研究参考是看过的别人的东西，不是本课题的产出 */
  it("研究参考不进申报包，其余类型都进", () => {
    expect(isDeclarationMaterial("REFERENCE")).toBe(false);
    expect(isDeclarationMaterial("AWARD_CERTIFICATE")).toBe(true);
    expect(isDeclarationMaterial("PROCESS_EVIDENCE")).toBe(true);
    expect(isDeclarationMaterial("OTHER")).toBe(true);
  });
});
