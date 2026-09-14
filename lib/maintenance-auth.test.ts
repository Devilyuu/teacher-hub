import { describe, expect, it } from "vitest";
import { maintenanceGuard, maintenanceTokenMatches } from "./maintenance-auth";

describe("maintenanceTokenMatches", () => {
  it("只接受独立维护令牌的精确值", () => {
    const env = { MAINTENANCE_TOKEN: "maintenance-secret", APP_PASSCODE: "login-secret" };
    expect(maintenanceTokenMatches("maintenance-secret", env)).toBe(true);
    expect(maintenanceTokenMatches("login-secret", env)).toBe(false);
    expect(maintenanceTokenMatches("maintenance-secre", env)).toBe(false);
    expect(maintenanceTokenMatches(undefined, env)).toBe(false);
  });

  it("缺少配置时固定拒绝而不是退回登录口令", () => {
    expect(maintenanceTokenMatches("login-secret", { APP_PASSCODE: "login-secret" })).toBe(false);
  });
});

describe("maintenanceGuard", () => {
  it("只从专用请求头读取维护令牌", async () => {
    const request = new Request("http://localhost/api/maintenance/cleanup", {
      headers: { "x-maintenance-token": "maintenance-secret" },
    });
    expect(maintenanceGuard(request, { MAINTENANCE_TOKEN: "maintenance-secret" })).toBeNull();
  });

  it("拒绝时只返回固定的 401，不泄露业务或配置细节", async () => {
    const response = maintenanceGuard(
      new Request("http://localhost/api/maintenance/cleanup"),
      { MAINTENANCE_TOKEN: "maintenance-secret" },
    );
    expect(response?.status).toBe(401);
    expect(response?.headers.get("cache-control")).toContain("no-store");
    expect(await response?.json()).toEqual({ error: "unauthorized" });
  });
});
