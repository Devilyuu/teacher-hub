import { describe, expect, it } from "vitest";
import { isSameOrigin, parseDeclarationRequest } from "./request";

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

describe("isSameOrigin", () => {
  it("只接受与下载接口同源的 POST", () => {
    const requestUrl = new URL("https://desk.example/api/export/declaration");
    expect(isSameOrigin(requestUrl, "https://desk.example")).toBe(true);
    expect(isSameOrigin(requestUrl, "https://evil.example")).toBe(false);
    expect(isSameOrigin(requestUrl, null)).toBe(false);
  });
});
