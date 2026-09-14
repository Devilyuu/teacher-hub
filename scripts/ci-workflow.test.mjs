import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function jobSource(workflow, jobName) {
  const jobs = [...workflow.matchAll(/^  ([a-z][a-z0-9_-]*):\s*$/gm)];
  const jobIndex = jobs.findIndex((match) => match[1] === jobName);
  if (jobIndex === -1) throw new Error(`Missing workflow job: ${jobName}`);
  const start = jobs[jobIndex].index;
  const end = jobs[jobIndex + 1]?.index ?? workflow.length;
  return workflow.slice(start, end);
}

describe("CI workflow prerequisites", () => {
  it("imports both rule catalogs after seed and before project outcome verification", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const quality = jobSource(workflow, "quality");
    const steps = [
      "npx prisma db seed",
      "npm run import:perf-rules -- --apply",
      "npm run import:promotion-rules -- --apply",
      "npm run verify:project-outcomes",
    ];
    const positions = steps.map((step) => quality.indexOf(step));
    expect(positions, "every prerequisite and verifier step must exist in the quality job").not.toContain(-1);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("gives the runtime-image verifier a workflow-level timeout", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const quality = jobSource(workflow, "quality");

    expect(quality).toMatch(
      /- name: Verify runtime image\s+run: npm run verify:runtime-image\s+timeout-minutes: 5/,
    );
  });

  it("gives the E2E signal cleanup drill a workflow-level timeout", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const e2e = jobSource(workflow, "e2e");

    expect(e2e).toMatch(
      /- name: Verify E2E signal cleanup\s+run: npm run test:e2e:signal-drill\s+timeout-minutes: 4/,
    );
  });
});
