export function projectOutcomeRevalidationPaths(projectId: string): string[] {
  return [
    "/",
    "/projects",
    `/projects/${projectId}`,
    "/achievements",
  ];
}
