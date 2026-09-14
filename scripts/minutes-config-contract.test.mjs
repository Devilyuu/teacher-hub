import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

describe("minutes deployment configuration", () => {
  test("documents all server-only minutes variables", () => {
    const example = read(".env.example");
    for (const name of ["MINUTES_API_BASE_URL", "MINUTES_API_KEY", "MINUTES_MODEL"]) {
      expect(example).toContain(`${name}=`);
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  test("passes minutes variables into the production app container", () => {
    const compose = read("docker-compose.yml");
    for (const name of ["MINUTES_API_BASE_URL", "MINUTES_API_KEY", "MINUTES_MODEL"]) {
      expect(compose).toContain(`${name}: \${${name}:-}`);
    }
  });
});
