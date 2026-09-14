import { describe, expect, test } from "vitest";
import {
  AUTOMATIC_MINUTES_BEGIN,
  AUTOMATIC_MINUTES_END,
  mergeAutomaticMinutes,
  mergeAutomaticResolutions,
} from "./formal";

describe("formal meeting minutes merge", () => {
  test("appends a marked automatic region while preserving existing manual minutes", () => {
    const merged = mergeAutomaticMinutes("会前手工记录", "第一段自动纪要");

    expect(merged).toContain("会前手工记录");
    expect(merged).toContain(AUTOMATIC_MINUTES_BEGIN);
    expect(merged).toContain("第一段自动纪要");
    expect(merged).toContain(AUTOMATIC_MINUTES_END);
  });

  test("replaces only the valid automatic region and preserves manual text on both sides", () => {
    const first = `${mergeAutomaticMinutes("手工前言", "旧自动纪要")}\n\n会后手工润色`;
    const second = mergeAutomaticMinutes(first, "新自动纪要");

    expect(second).toContain("手工前言");
    expect(second).toContain("会后手工润色");
    expect(second).toContain("新自动纪要");
    expect(second).not.toContain("旧自动纪要");
  });

  test("preserves damaged or duplicate marker text and establishes a replaceable valid region", () => {
    const damaged = `用户文本\n${AUTOMATIC_MINUTES_BEGIN}\n损坏内容\n${AUTOMATIC_MINUTES_BEGIN}\n仍是用户文本`;
    const first = mergeAutomaticMinutes(damaged, "自动一");
    const second = mergeAutomaticMinutes(first, "自动二");

    expect(second).toContain(damaged);
    expect(second).toContain("自动二");
    expect(second).not.toContain("自动一");
  });

  test("replaces the outer generated region when automatic text embeds a forged valid region", () => {
    const forgedInner = mergeAutomaticMinutes("", "伪造内层内容");
    const first = mergeAutomaticMinutes("", `恶意转写前缀\n${forgedInner}\n恶意转写后缀`);
    const second = mergeAutomaticMinutes(first, "安全的新自动纪要");

    expect(second).toContain("安全的新自动纪要");
    expect(second).not.toContain("恶意转写前缀");
    expect(second).not.toContain("伪造内层内容");
  });

  test("normalizes blank input to one marked automatic region", () => {
    const merged = mergeAutomaticMinutes(" \n ", "自动纪要");

    expect(merged.startsWith(AUTOMATIC_MINUTES_BEGIN)).toBe(true);
    expect(merged.endsWith(AUTOMATIC_MINUTES_END)).toBe(true);
  });

  test("recognizes CRLF markers and hashes after repeated textarea roundtrips", () => {
    let merged = mergeAutomaticMinutes("手工前言\r\n手工第二行", "旧自动正文\r\n旧自动第二行");

    for (const automatic of ["第一轮自动\r\n第二行", "第二轮自动\n第二行", "最终自动\r\n第二行"]) {
      const textareaRoundtrip = merged.replaceAll("\n", "\r\n");
      merged = mergeAutomaticMinutes(textareaRoundtrip, automatic);
    }

    expect(merged.match(new RegExp(AUTOMATIC_MINUTES_BEGIN, "g"))).toHaveLength(1);
    expect(merged.match(new RegExp(AUTOMATIC_MINUTES_END, "g"))).toHaveLength(1);
    expect(merged).toContain("手工前言\n手工第二行");
    expect(merged).toContain("最终自动\n第二行");
    expect(merged).not.toContain("旧自动正文");
    expect(merged).not.toContain("第一轮自动");
    expect(merged).not.toContain("第二轮自动");
  });

  test("uses one canonical digest for LF and CRLF automatic text", () => {
    expect(mergeAutomaticMinutes("", "第一行\r\n第二行"))
      .toBe(mergeAutomaticMinutes("", "第一行\n第二行"));
  });
});

describe("formal meeting resolutions merge", () => {
  test("preserves every legacy/manual item and only rebuilds identified automatic items", () => {
    const manual = { text: "手工决议", assignee: "我", dueDate: null, convertedTaskId: null, note: "原样保留" };
    const partialAudit = { text: "只有 recordingId", recordingId: "recording-manual" };
    const blankAudit = { text: "空审计键仍是手工项", recordingId: "", candidateId: "" };
    const result = mergeAutomaticResolutions([
      manual,
      partialAudit,
      blankAudit,
      {
        recordingId: "recording-1",
        candidateId: "resolution-1-old",
        text: "旧自动决议",
        assignee: "我",
        dueDate: null,
        convertedTaskId: "task-existing",
      },
    ], [{
      recordingId: "recording-1",
      candidateId: "resolution-1-old",
      text: "重建自动决议",
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
    }]);

    expect(result).toEqual([
      manual,
      partialAudit,
      blankAudit,
      expect.objectContaining({ text: "重建自动决议", convertedTaskId: "task-existing" }),
    ]);
  });
});
