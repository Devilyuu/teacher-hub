import type { DeclarationFilterOptions } from "./declaration";
import type { DeclarationKind } from "./preflight";

/** xlsx = 只要那张申报表；zip = 申报表连同按序号命名的支撑材料（declaration-materials.ts） */
export type DeclarationExportFormat = "xlsx" | "zip";

type ParsedDeclarationRequest =
  | {
      ok: true;
      kind: DeclarationKind;
      year: number;
      options: Required<DeclarationFilterOptions>;
      isOverride: boolean;
      preflightFingerprint: string;
      requestKey: string;
      format: DeclarationExportFormat;
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

  // 没带 format 就是原来那张 xlsx：旧页面、书签、脚本照旧能用。写了别的值就拒绝，不猜
  const rawFormat = form.getAll("format");
  if (rawFormat.length > 1) return { ok: false, error: "无效的导出格式" };
  const format = rawFormat.length === 0 ? "xlsx" : rawFormat[0];
  if (format !== "xlsx" && format !== "zip") {
    return { ok: false, error: "无效的导出格式" };
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
    format,
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

/**
 * 导出接口的同源校验：Origin 必须是浏览器发请求时所在的那个地址。两样比法任一对上就算同源：
 *
 * - Origin 与 request.url 的源（原来的比法；next dev、服务器版都对得上）
 * - Origin 的主机与请求头 Host（2026-09-28 加）。standalone 构建里 request.url **恒为 http://localhost:端口**，
 *   跟浏览器地址栏无关——桌面版的窗口走 127.0.0.1、手机经「手机访问」走局域网地址，只比 request.url
 *   会把同源导出全当跨站拒掉（技术验证只点了页面没点导出，没发现）。Host 是浏览器照着地址栏填的，
 *   跨站页面的表单改不了它，拿它比一样拦得住跨站提交
 */
export function isSameOriginRequest(request: { url: string; headers: { get(name: string): string | null } }): boolean {
  const origin = request.headers.get("origin");
  if (origin == null) return false;
  if (isSameOrigin(new URL(request.url), origin)) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host.trim().toLowerCase();
  } catch {
    return false;
  }
}
