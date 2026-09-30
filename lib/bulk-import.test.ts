import { describe, expect, it } from "vitest";
import { dedupeRowsByName } from "@/lib/bulk-import";

describe("dedupeRowsByName", () => {
  const rows = [
    { name: "林知远", no: "1" },
    { name: "苏明宇", no: "2" },
    { name: "林知远", no: "3" },
    { name: "周彦", no: "4" },
  ];

  it("块内重名只留第一条——一次贴进自带重复的表不该建出两条同名", () => {
    expect(dedupeRowsByName(rows, []).map((r) => r.no)).toEqual(["1", "2", "4"]);
  });

  it("库里已有的照样跳过：整表重复粘贴是安全的", () => {
    expect(dedupeRowsByName(rows, ["苏明宇"]).map((r) => r.no)).toEqual(["1", "4"]);
    expect(dedupeRowsByName(rows, ["林知远", "苏明宇", "周彦"])).toEqual([]);
  });

  it("保持原顺序，不改动传入数组", () => {
    const snapshot = [...rows];
    expect(dedupeRowsByName(rows, []).map((r) => r.name)).toEqual([
      "林知远",
      "苏明宇",
      "周彦",
    ]);
    expect(rows).toEqual(snapshot);
  });
});
