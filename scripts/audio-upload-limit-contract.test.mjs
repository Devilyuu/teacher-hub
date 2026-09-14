import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (pathname) => readFileSync(resolve(root, pathname), "utf8");

describe("audio upload limit contract", () => {
  it("locks the UI/server/Next/Nginx/Caddy layers to a 100 MiB upload with multipart headroom", () => {
    expect(source("lib/transcription/policy.ts")).toMatch(/AUDIO_MAX_BYTES\s*=\s*100\s*\*\s*1024\s*\*\s*1024/);
    expect(source("next.config.ts")).toMatch(/proxyClientMaxBodySize:\s*["']105mb["']/);
    expect(source("deploy/nginx/desk.conf")).toMatch(/client_max_body_size\s+105m;/);
    expect(source("Caddyfile")).toMatch(/max_size\s+105MB/);
    const panel = source("app/(app)/meetings/[id]/recording-panel.tsx");
    expect(panel).toMatch(/validateClientAudioFile/);
    expect(panel).toMatch(/probeBrowserAudioDuration/);
  });
});
