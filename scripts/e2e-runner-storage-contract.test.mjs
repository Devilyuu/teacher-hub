import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("E2E Postgres storage contract", () => {
  it("uses only a bounded tmpfs for container-owned PGDATA", () => {
    const source = readFileSync(new URL("./run-e2e.mjs", import.meta.url), "utf8");

    expect(source).toContain(
      '"--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=512m"',
    );
    expect(source).toContain('{"Mounts":{{json .Mounts}}');
    expect(source).toContain('"Binds":{{json .HostConfig.Binds}}');
    expect(source).toContain('"Tmpfs":{{json .HostConfig.Tmpfs}}}');
    expect(source).not.toContain('{{json dict "Mounts"');
    expect(source).toContain('console.log("E2E Postgres storage: tmpfs")');
    expect(source).not.toMatch(/pgDataPrefix|pgDataMarker|containerDataParent|containerDataDir/);
    expect(source).not.toContain("pg-data-parent");
    expect(source).not.toMatch(/-v.+:\/var\/lib\/postgresql\/data/);
    const createIndex = source.indexOf('"create", "--name", containerName');
    const trackedIndex = source.indexOf("containerCreated = true");
    const inspectIndex = source.indexOf('"inspect",');
    const startIndex = source.indexOf('"start", containerName');
    expect([createIndex, trackedIndex, inspectIndex, startIndex]).not.toContain(-1);
    expect([createIndex, trackedIndex, inspectIndex, startIndex]).toEqual(
      [...[createIndex, trackedIndex, inspectIndex, startIndex]].sort((left, right) => left - right),
    );
    expect(source).toContain("if (!containerCreated) return");
    expect(source).toContain("if (cleanupDrill) await assertOwnedContainerAbsent()");
    expect(source).not.toContain('"run", "-d", "--name", containerName');
  });

  it("requires the tmpfs handshake and surfaces runner cleanup labels in the signal drill", () => {
    const source = readFileSync(
      new URL("./verify-e2e-signal-cleanup.mjs", import.meta.url),
      "utf8",
    );

    expect(source).toContain("E2E Postgres storage: tmpfs");
    expect(source).toContain("extractRunnerCleanupLabels");
    expect(source).toContain("runner cleanup: ${label}");
    expect(source).toContain("assertExactContainerAbsent");
    expect(source).toContain("waitForPostSignalExit");
    expect(source).toContain('failures.push("post-signal cleanup deadline")');
  });
});
