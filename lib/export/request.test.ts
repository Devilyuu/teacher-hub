import { describe, expect, it } from "vitest";
import { isSameOrigin, isSameOriginRequest, parseDeclarationRequest } from "./request";

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseDeclarationRequest", () => {
  it("默认使用安全筛选", () => {
    expect(
      parseDeclarationRequest(
        form([
          ["kind", "performance"],
          ["year", "2026"],
          ["preflightFingerprint", "fingerprint-1"],
          ["requestKey", "request-1"],
        ]),
      ),
    ).toEqual({
      ok: true,
      kind: "performance",
      year: 2026,
      options: { includeUnverified: false, includeMissingYear: false },
      isOverride: false,
      preflightFingerprint: "fingerprint-1",
      requestKey: "request-1",
      format: "xlsx",
    });
  });

  it("任何覆盖安全默认的请求都必须带显式确认", () => {
    expect(
      parseDeclarationRequest(
        form([
          ["kind", "promotion"],
          ["year", "2026"],
          ["includeUnverified", "true"],
          ["preflightFingerprint", "fingerprint-1"],
          ["requestKey", "request-1"],
        ]),
      ),
    ).toEqual({
      ok: false,
      error: "带问题导出需要显式确认",
    });
  });

  it("确认后保留两个独立覆盖开关", () => {
    expect(
      parseDeclarationRequest(
        form([
          ["kind", "promotion"],
          ["year", "2026"],
          ["includeUnverified", "true"],
          ["includeMissingYear", "true"],
          ["confirmIssues", "true"],
          ["preflightFingerprint", "fingerprint-1"],
          ["requestKey", "request-1"],
        ]),
      ),
    ).toMatchObject({
      ok: true,
      options: { includeUnverified: true, includeMissingYear: true },
      isOverride: true,
    });
  });

  it.each([
    ["kind", "wrong"],
    ["year", "not-a-year"],
    ["year", "-1"],
  ])("拒绝非法 %s，不静默回退", (key, value) => {
    const data = form([
      ["kind", "promotion"],
      ["year", "2026"],
      ["preflightFingerprint", "fingerprint-1"],
      ["requestKey", "request-1"],
    ]);
    data.set(key, value);
    expect(parseDeclarationRequest(data)).toMatchObject({ ok: false });
  });

  it.each(["1e3", "0x7ea", "+2026", " 2026", "2026 ", "2026.0", "02026", "1899", "2200"])(
    "拒绝协议外或不合理的年度表示 %s",
    (year) => {
      expect(
        parseDeclarationRequest(
          form([
            ["kind", "promotion"],
            ["year", year],
            ["preflightFingerprint", "fingerprint-1"],
            ["requestKey", "request-1"],
          ]),
        ),
      ).toMatchObject({ ok: false });
    },
  );

  it.each(["1900", "2026", "2199"])("接受合理范围内的四位十进制年度 %s", (year) => {
    expect(
      parseDeclarationRequest(
        form([
          ["kind", "performance"],
          ["year", year],
          ["preflightFingerprint", "fingerprint-1"],
          ["requestKey", "request-1"],
        ]),
      ),
    ).toMatchObject({ ok: true, year: Number(year) });
  });

  it.each(["includeUnverified", "includeMissingYear", "confirmIssues"])(
    "拒绝 %s 的未知布尔值",
    (key) => {
      const data = form([
        ["kind", "promotion"],
        ["year", "2026"],
        ["preflightFingerprint", "fingerprint-1"],
        ["requestKey", "request-1"],
      ]);
      data.set(key, "banana");
      expect(parseDeclarationRequest(data)).toMatchObject({ ok: false });
    },
  );

  it("允许覆盖参数显式传 false", () => {
    expect(
      parseDeclarationRequest(
        form([
          ["kind", "performance"],
          ["year", "2026"],
          ["includeUnverified", "false"],
          ["includeMissingYear", "false"],
          ["confirmIssues", "false"],
          ["preflightFingerprint", "fingerprint-1"],
          ["requestKey", "request-1"],
        ]),
      ),
    ).toMatchObject({
      ok: true,
      options: { includeUnverified: false, includeMissingYear: false },
      isOverride: false,
    });
  });

  it.each(["preflightFingerprint", "requestKey"])("拒绝缺少 %s", (key) => {
    const data = form([
      ["kind", "promotion"],
      ["year", "2026"],
      ["preflightFingerprint", "fingerprint-1"],
      ["requestKey", "request-1"],
    ]);
    data.delete(key);
    expect(parseDeclarationRequest(data)).toMatchObject({ ok: false });
  });
});

describe("parseDeclarationRequest · 导出格式", () => {
  const base: Array<[string, string]> = [
    ["kind", "promotion"],
    ["year", "2027"],
    ["preflightFingerprint", "fingerprint-1"],
    ["requestKey", "request-1"],
  ];

  /** 旧页面、书签没有这个字段，照旧拿到那张 xlsx */
  it("不带 format 就是 xlsx", () => {
    expect(parseDeclarationRequest(form(base))).toMatchObject({ ok: true, format: "xlsx" });
  });

  it("format=zip 是连同支撑材料的申报包，和覆盖开关互不影响", () => {
    expect(
      parseDeclarationRequest(
        form([...base, ["format", "zip"], ["includeUnverified", "true"], ["confirmIssues", "true"]]),
      ),
    ).toMatchObject({
      ok: true,
      format: "zip",
      options: { includeUnverified: true, includeMissingYear: false },
    });
  });

  it("不认识的格式、重复的格式一律拒绝，不猜", () => {
    expect(parseDeclarationRequest(form([...base, ["format", "pdf"]]))).toEqual({
      ok: false,
      error: "无效的导出格式",
    });
    expect(
      parseDeclarationRequest(form([...base, ["format", "zip"], ["format", "xlsx"]])),
    ).toEqual({ ok: false, error: "无效的导出格式" });
  });
});

describe("isSameOrigin", () => {
  it("只接受与下载接口同源的 POST", () => {
    const requestUrl = new URL("https://desk.example/api/export/declaration");
    expect(isSameOrigin(requestUrl, "https://desk.example")).toBe(true);
    expect(isSameOrigin(requestUrl, "https://evil.example")).toBe(false);
    expect(isSameOrigin(requestUrl, null)).toBe(false);
  });
});

describe("isSameOriginRequest", () => {
  const req = (url: string, headers: Record<string, string>) => ({
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });

  it("服务器版（Nginx 转 Host、request.url 就是站点地址）照旧放行", () => {
    expect(isSameOriginRequest(req("https://desk.example/api/backup", { origin: "https://desk.example", host: "desk.example" }))).toBe(true);
  });

  /** 2026-09-28 实测：standalone 里 request.url 恒为 http://localhost:端口，和浏览器地址栏无关 */
  it("桌面版窗口（127.0.0.1）与手机（局域网地址）按 Host 认出是同源", () => {
    const url = "http://localhost:5980/api/export/declaration";
    expect(isSameOriginRequest(req(url, { origin: "http://127.0.0.1:5980", host: "127.0.0.1:5980" }))).toBe(true);
    expect(isSameOriginRequest(req(url, { origin: "http://192.168.2.11:9258", host: "192.168.2.11:9258" }))).toBe(true);
  });

  it("跨站页面提交过来：Origin 是别人的、Host 是我们的，拒绝", () => {
    const url = "http://localhost:5980/api/export/declaration";
    expect(isSameOriginRequest(req(url, { origin: "http://evil.example", host: "127.0.0.1:5980" }))).toBe(false);
    expect(isSameOriginRequest(req(url, { origin: "http://127.0.0.1:5981", host: "127.0.0.1:5980" }))).toBe(false);
    expect(isSameOriginRequest(req(url, { host: "127.0.0.1:5980" }))).toBe(false);
    expect(isSameOriginRequest(req(url, { origin: "null", host: "127.0.0.1:5980" }))).toBe(false);
  });
});
