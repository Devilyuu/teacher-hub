import { expect, it } from "vitest";
import { projectOutcomeRevalidationPaths } from "@/lib/outcomes/revalidation";

it("invalidates both project entry points after editing the shared project", () => {
  expect(projectOutcomeRevalidationPaths("project-1")).toEqual([
    "/",
    "/projects",
    "/projects/project-1",
    "/achievements",
  ]);
});
