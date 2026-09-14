import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("meeting deletion with private audio", () => {
  it("refuses to cascade database rows while an audio file can still exist", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../app/(app)/meetings/actions.ts"), "utf8");
    const body = source.match(/export async function deleteMeeting\(id: string\) \{([^]*?)\n\}/)?.[1] ?? "";
    expect(body).toContain("meetingRecording.count");
    expect(body.indexOf("meetingRecording.count")).toBeLessThan(body.indexOf("prisma.$transaction"));
  });
});
