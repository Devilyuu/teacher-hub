import type { DeclarationFilterOptions } from "./declaration";
import type { DeclarationKind } from "./preflight";

type ParsedDeclarationRequest =
  | {
      ok: true;
      kind: DeclarationKind;
      year: number;
      options: Required<DeclarationFilterOptions>;
      isOverride: boolean;
      preflightFingerprint: string;
      requestKey: string;
    }
  | { ok: false; error: string };

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" ? value : null;
}

type ParsedBoolean = { ok: true; value: boolean } | { ok: false };

function optionalBoolean(form: FormData, key: string): ParsedBoolean {
  const values = form.getAll(key);
  if (values.length === 0) return { ok: true, value: false };
  if (values.length !== 1 || typeof values[0] !== "string") return { ok: false };
  if (values[0] === "true") return { ok: true, value: true };
  if (values[0] === "false") return { ok: true, value: false };
  return { ok: false };
}

export function parseDeclarationRequest(form: FormData): ParsedDeclarationRequest {
  const rawKind = text(form, "kind");
  if (rawKind !== "promotion" && rawKind !== "performance") {
    return { ok: false, error: "无效的导出类型" };
  }

  const rawYear = text(form, "year");
  // API 协议只接受合理的四位十进制年份；范围故意宽于页面当前展示的三个年度。
  if (rawYear == null || !/^(?:19|20|21)\d{2}$/.test(rawYear)) {
    return { ok: false, error: "无效的申报年度" };
  }
  const year = Number.parseInt(rawYear, 10);

  const preflightFingerprint = text(form, "preflightFingerprint")?.trim();
  if (!preflightFingerprint) {
    return { ok: false, error: "缺少预检指纹，请刷新导出页后重试" };
  }

  const requestKey = text(form, "requestKey")?.trim();
  if (!requestKey || requestKey.length > 100) {
    return { ok: false, error: "缺少或无效的导出请求标识" };
  }

  const includeUnverified = optionalBoolean(form, "includeUnverified");
  const includeMissingYear = optionalBoolean(form, "includeMissingYear");
  const confirmIssues = optionalBoolean(form, "confirmIssues");
  if (!includeUnverified.ok || !includeMissingYear.ok || !confirmIssues.ok) {
    return { ok: false, error: "无效的导出选项" };
  }

  const options = {
    includeUnverified: includeUnverified.value,
    includeMissingYear: includeMissingYear.value,
  };
  const isOverride = options.includeUnverified || options.includeMissingYear;

  if (isOverride && !confirmIssues.value) {
    return { ok: false, error: "带问题导出需要显式确认" };
  }

  return {
    ok: true,
    kind: rawKind,
    year,
    options,
    isOverride,
    preflightFingerprint,
    requestKey,
  };
}

export function isSameOrigin(requestUrl: URL, origin: string | null): boolean {
  if (origin == null) return false;
  try {
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}
