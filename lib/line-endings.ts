export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
