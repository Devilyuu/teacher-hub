const OUTCOME_LIST_PATH = "/achievements";
const FALLBACK_PATH = "/projects";
const LOCAL_ORIGIN = "https://return.local";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Accept only the outcomes list itself, optionally with its query string.
 *
 * This value is rendered into a Link, so it intentionally rejects every other
 * pathname and every browser path separator/origin ambiguity.
 */
export function safeOutcomeReturnPath(
  value: string | null | undefined,
): string {
  if (
    !value ||
    CONTROL_CHARACTER.test(value) ||
    value.includes("\\") ||
    value.includes("#")
  ) {
    return FALLBACK_PATH;
  }

  const queryIndex = value.indexOf("?");
  const rawPath = queryIndex === -1 ? value : value.slice(0, queryIndex);
  if (rawPath !== OUTCOME_LIST_PATH) return FALLBACK_PATH;

  try {
    const parsed = new URL(value, LOCAL_ORIGIN);
    if (
      parsed.origin !== LOCAL_ORIGIN ||
      parsed.pathname !== OUTCOME_LIST_PATH ||
      parsed.hash ||
      `${parsed.pathname}${parsed.search}` !== value
    ) {
      return FALLBACK_PATH;
    }
  } catch {
    return FALLBACK_PATH;
  }

  return value;
}

export function outcomeProjectHref(
  projectId: string,
  currentOutcomePath: string,
): string {
  const returnPath = safeOutcomeReturnPath(currentOutcomePath);
  return `/projects/${encodeURIComponent(projectId)}?returnTo=${encodeURIComponent(returnPath)}`;
}
