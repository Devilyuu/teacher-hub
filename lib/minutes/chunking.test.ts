import { describe, expect, test } from "vitest";
import { chunkTranscriptSegments } from "./chunking";

describe("chunkTranscriptSegments", () => {
  test("sorts transcript segments by time and keeps every chunk within the character limit", () => {
    const chunks = chunkTranscriptSegments([
      { text: "第三段。", startMs: 2000, endMs: 3000, speakerId: 0 },
      { text: "第一段。", startMs: 0, endMs: 1000, speakerId: 0 },
      { text: "第二段。", startMs: 1000, endMs: 2000, speakerId: 1 },
    ], 10);

    expect(chunks.every((chunk) => chunk.text.length <= 10)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("第一段。");
    expect(chunks[0]?.startMs).toBe(0);
    expect(chunks.at(-1)?.endMs).toBe(3000);
  });

  test("splits an oversized segment at sentence boundaries before hard cutting", () => {
    const chunks = chunkTranscriptSegments([
      { text: "第一句话。第二句话特别长没有结束符ABCDEFGHIJK", startMs: 100, endMs: 1100, speakerId: null },
    ], 10);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]?.text).toBe("第一句话。");
    expect(chunks.every((chunk) => chunk.text.length <= 10)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe("第一句话。第二句话特别长没有结束符ABCDEFGHIJK");
  });

  test("drops blank segments without inventing content", () => {
    expect(chunkTranscriptSegments([
      { text: "  ", startMs: 0, endMs: 1, speakerId: null },
    ])).toEqual([]);
  });
});
