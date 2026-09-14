import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const dockerfileCode = (source) => source
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

function uniqueLineOffset(source, pattern) {
  const matches = [...source.matchAll(pattern)];
  expect(matches).toHaveLength(1);
  return matches[0].index;
}

describe("private temporary audio deployment boundary", () => {
  it("uses a dedicated runtime volume and declares every operational setting", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toContain("AUDIO_TEMP_ROOT: /var/lib/teacher-desk-audio");
    expect(compose).toContain("audio_temp:/var/lib/teacher-desk-audio");
    for (const name of [
      "AUDIO_QUOTA_BYTES", "TRANSCRIPTION_LEASE_MINUTES", "MAINTENANCE_TOKEN",
      "TENCENT_ASR_APP_ID", "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY",
    ]) expect(compose).toContain(name);
  });

  it("documents the private root while intentionally excluding it from backups", () => {
    const example = read(".env.example");
    expect(example).toContain("AUDIO_TEMP_ROOT");
    expect(example).toContain("AUDIO_QUOTA_BYTES");
    const backup = read("scripts/backup.sh");
    expect(backup).toContain("AUDIO_TEMP_ROOT is intentionally excluded");
    expect(backup).not.toMatch(/tar[^\n]*AUDIO_TEMP_ROOT/);
  });

  it("documents the exact token-authenticated maintenance cron endpoint", () => {
    const deploy = read("docs/deploy.md");
    expect(deploy).toContain("/api/maintenance/cleanup");
    expect(deploy).toContain("X-Maintenance-Token");
    expect(deploy).toContain(". ./.env");
  });

  it("makes the build trace gate reject a workspace-local audio root", () => {
    const verifier = read("scripts/verify-build-trace.mjs");
    expect(verifier).toContain("AUDIO_TEMP_ROOT");
    expect(verifier).toContain("audioRootInvalid");
  });

  it("seeds a fresh named volume with node ownership before dropping privileges", () => {
    const code = dockerfileCode(read("Dockerfile"));
    const userIndex = uniqueLineOffset(code, /^USER node$/gm);
    const mkdirIndex = uniqueLineOffset(code, /^RUN mkdir -p \/var\/lib\/teacher-desk-audio \\$/gm);
    const ownershipIndex = uniqueLineOffset(code, /^\s*&& chown node:node \/var\/lib\/teacher-desk-audio \\$/gm);
    const modeIndex = uniqueLineOffset(code, /^\s*&& chmod 0700 \/var\/lib\/teacher-desk-audio$/gm);
    expect(mkdirIndex).toBeLessThan(userIndex);
    expect(ownershipIndex).toBeLessThan(userIndex);
    expect(modeIndex).toBeLessThan(userIndex);
  });

  it("ignores comments when locating Dockerfile privilege directives", () => {
    const code = dockerfileCode("# USER node\n# RUN mkdir -p /var/lib/teacher-desk-audio\nUSER node");
    expect([...code.matchAll(/^USER node$/gm)]).toHaveLength(1);
    expect(code).not.toContain("mkdir -p /var/lib/teacher-desk-audio");
  });

  it("runs the fresh named-volume permission drill during runtime image verification", () => {
    expect(read("scripts/verify-runtime-image.mjs")).toContain("probeFreshAudioVolume");
    expect(read("scripts/runtime-audio-volume-probe.mjs")).toContain("teacher-desk.runtime-audio-volume-probe");
  });

  it("marks the runtime-only dynamic path so Turbopack does not trace the workspace", () => {
    expect(read("lib/transcription/storage.ts")).toContain("turbopackIgnore: true");
    expect(read("next.config.ts")).toMatch(/turbopack:\s*\{\s*root:/);
  });
});
