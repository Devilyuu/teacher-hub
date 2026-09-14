import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function source(pathname) {
  return readFileSync(resolve(root, pathname), "utf8");
}

describe("transcription route authentication contract", () => {
  it.each([
    "app/api/meetings/[id]/recordings/route.ts",
    "app/api/recordings/[id]/transcribe/route.ts",
  ])("keeps %s behind the session guard before parsing input", (pathname) => {
    expect(source(pathname)).toMatch(
      /export async function POST[^]*?const denied = await sessionGuard\(\);\s*if \(denied\) return denied;/,
    );
  });

  it("keeps the exact maintenance route behind the independent token guard", () => {
    expect(source("app/api/maintenance/cleanup/route.ts")).toMatch(
      /export async function POST\(request: Request\)[^]*?const denied = maintenanceGuard\(request\);\s*if \(denied\) return denied;/,
    );
  });

  it("teaches the static authentication gate about the guarded public exception", () => {
    const verifier = source("scripts/verify-server-actions-auth.mjs");
    expect(verifier).toContain('"app/api/maintenance/cleanup/route.ts"');
    expect(verifier).toContain('guard: "maintenanceGuard"');
  });
});
