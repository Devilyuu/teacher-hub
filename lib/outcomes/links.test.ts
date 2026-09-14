import { describe, expect, it } from "vitest";
import {
  outcomeProjectHref,
  safeOutcomeReturnPath,
} from "@/lib/outcomes/links";

describe("safeOutcomeReturnPath", () => {
  it("preserves the achievements page and its existing filter query", () => {
    expect(safeOutcomeReturnPath("/achievements")).toBe("/achievements");
    expect(
      safeOutcomeReturnPath(
        "/achievements?scope=performance&year=2026&major=%E7%A7%91%E7%A0%94",
      ),
    ).toBe(
      "/achievements?scope=performance&year=2026&major=%E7%A7%91%E7%A0%94",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "https://evil.example/achievements",
    "//evil.example/achievements",
    "/\\evil.example/achievements",
    "\\\\evil.example\\achievements",
    "/achievements\\..\\evil",
    "/achievements\u0000?scope=all",
    "/achievements\n?scope=all",
    "/achievements#scope=all",
    "/projects",
    "/achievements/new",
  ])("falls back for unsafe or non-achievements input %s", (value) => {
    expect(safeOutcomeReturnPath(value)).toBe("/projects");
  });

  it.each([
    "%2F%2Fevil.example%2Fachievements",
    "/%2F%2Fevil.example/achievements",
    "/achievements%2F%2Fevil.example",
    "/%5C%5Cevil.example/achievements",
    "///evil.example/achievements",
  ])("does not decode or accept an external-origin-shaped variant %s", (value) => {
    expect(safeOutcomeReturnPath(value)).toBe("/projects");
  });
});

describe("outcomeProjectHref", () => {
  it("encodes a complex outcomes return path exactly once", () => {
    const currentPath =
      "/achievements?scope=performance&major=%E7%A7%91%E7%A0%94&unverified=1";
    const href = outcomeProjectHref("project/1", currentPath);
    const parsed = new URL(href, "https://local.example");

    expect(parsed.pathname).toBe("/projects/project%2F1");
    expect(parsed.searchParams.get("returnTo")).toBe(currentPath);
    expect(href).toBe(
      `/projects/project%2F1?returnTo=${encodeURIComponent(currentPath)}`,
    );
    expect(href).not.toContain(
      encodeURIComponent(encodeURIComponent(currentPath)),
    );
  });

  it("falls back to the projects page before encoding an unsafe return path", () => {
    const href = outcomeProjectHref(
      "project-1",
      "https://evil.example/achievements",
    );
    const parsed = new URL(href, "https://local.example");

    expect(parsed.searchParams.get("returnTo")).toBe("/projects");
    expect(href).toBe("/projects/project-1?returnTo=%2Fprojects");
  });
});
