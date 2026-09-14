import { describe, expect, it } from "vitest";
import { integrationStatuses, teachingAppUrl, type IntegrationKey } from "./integrations";

const FULL_ENV = {
  TEACHING_APP_URL: "https://beike.example.edu.cn",
  TEACHING_IMPORT_TOKEN: "tk_teaching_secret_value",
  TENCENT_ASR_APP_ID: "1250000000",
  TENCENT_SECRET_ID: "AKIDsecret_id_value",
  TENCENT_SECRET_KEY: "secret_key_value",
  MINUTES_API_BASE_URL: "https://api.deepseek.com",
  MINUTES_API_KEY: "sk-minutes-secret-value",
  MINUTES_MODEL: "deepseek-chat",
  MAINTENANCE_TOKEN: "mt_secret_value",
};

function statusOf(key: IntegrationKey, env: Record<string, string | undefined>) {
  const found = integrationStatuses(env).find((item) => item.key === key);
  if (!found) throw new Error(`没有 ${key} 这一项`);
  return found;
}

describe("teachingAppUrl", () => {
  it("接受 http 和 https 绝对地址", () => {
    expect(teachingAppUrl({ TEACHING_APP_URL: "https://beike.example.edu.cn" })).toBe(
      "https://beike.example.edu.cn/",
    );
    expect(teachingAppUrl({ TEACHING_APP_URL: "http://localhost:3200" })).toBe(
      "http://localhost:3200/",
    );
  });

  it("没配或只填了空白时返回 null", () => {
    expect(teachingAppUrl({})).toBeNull();
    expect(teachingAppUrl({ TEACHING_APP_URL: "   " })).toBeNull();
  });

  it("解析不了的地址一律当没配置，不原样返回", () => {
    expect(teachingAppUrl({ TEACHING_APP_URL: "beike.example.edu.cn" })).toBeNull();
    expect(teachingAppUrl({ TEACHING_APP_URL: "不是地址" })).toBeNull();
  });

  it("拒绝非 http(s) 协议——这个值最终会进 <a href>", () => {
    // 环境变量是运维手填的，填成 javascript: 就是自己给自己开的 XSS
    expect(teachingAppUrl({ TEACHING_APP_URL: "javascript:alert(1)" })).toBeNull();
    expect(teachingAppUrl({ TEACHING_APP_URL: "file:///etc/passwd" })).toBeNull();
    expect(teachingAppUrl({ TEACHING_APP_URL: "data:text/html,<script>" })).toBeNull();
  });
});

describe("integrationStatuses", () => {
  it("四项配置齐全时全部为已配置", () => {
    for (const status of integrationStatuses(FULL_ENV)) {
      expect(status.configured, status.key).toBe(true);
      expect(status.missing, status.key).toEqual([]);
    }
  });

  it("空环境下四项全部未配置，并列出缺失的变量名", () => {
    const statuses = integrationStatuses({});
    expect(statuses.every((status) => !status.configured)).toBe(true);
    expect(statusOf("asr", {}).missing).toEqual([
      "TENCENT_ASR_APP_ID",
      "TENCENT_SECRET_ID",
      "TENCENT_SECRET_KEY",
    ]);
    expect(statusOf("maintenance", {}).missing).toEqual(["MAINTENANCE_TOKEN"]);
  });

  it("只配一半时算未配置，且只报缺的那几个", () => {
    const half = { ...FULL_ENV, TENCENT_SECRET_KEY: undefined };
    expect(statusOf("asr", half).configured).toBe(false);
    expect(statusOf("asr", half).missing).toEqual(["TENCENT_SECRET_KEY"]);
    // 其他三项不受影响
    expect(statusOf("minutes", half).configured).toBe(true);
  });

  it("纪要服务拒绝非 http(s) 地址，测试 fake 只能显式启用", () => {
    const invalid = { ...FULL_ENV, MINUTES_API_BASE_URL: "file:///private/model" };
    expect(statusOf("minutes", invalid).configured).toBe(false);
    expect(statusOf("minutes", invalid).missing).toContain("MINUTES_API_BASE_URL");
    expect(statusOf("minutes", { MINUTES_ADAPTER: "fake" }).configured).toBe(true);
    expect(statusOf("minutes", { MINUTES_ADAPTER: "fake" }).missing).toEqual([]);
  });

  it("维护任务文案说明当前音频清理生命周期", () => {
    const maintenance = statusOf("maintenance", { MAINTENANCE_TOKEN: "token" });

    expect(maintenance.hint).toContain("第 7 天");
    expect(maintenance.hint).toContain("删除失败");
    expect(maintenance.hint).not.toContain("不会自动删除音频");
  });

  it("备课系统地址填错时算未配置，而不是显示成已连上", () => {
    const bad = { ...FULL_ENV, TEACHING_APP_URL: "beike.example.edu.cn" };
    expect(statusOf("teaching", bad).configured).toBe(false);
    expect(statusOf("teaching", bad).missing).toContain("TEACHING_APP_URL");
    expect(statusOf("teaching", bad).detail).toBeUndefined();
  });

  it("已配置时只回传域名，不回传完整地址里的路径或凭据", () => {
    expect(statusOf("teaching", FULL_ENV).detail).toBe("beike.example.edu.cn");
  });

  /**
   * 这一条是整个模块存在的理由：返回值会被渲染进设置页的 HTML，
   * 任何一个密钥漏进去就等于把它贴到了页面上。
   * 断言方式是把返回值整个序列化再找，比逐字段检查更难绕过。
   */
  it("返回值里不出现任何密钥值", () => {
    const serialized = JSON.stringify(integrationStatuses(FULL_ENV));
    const secrets = [
      FULL_ENV.TEACHING_IMPORT_TOKEN,
      FULL_ENV.TENCENT_SECRET_ID,
      FULL_ENV.TENCENT_SECRET_KEY,
      FULL_ENV.TENCENT_ASR_APP_ID,
      FULL_ENV.MINUTES_API_KEY,
      FULL_ENV.MAINTENANCE_TOKEN,
    ];
    for (const secret of secrets) {
      expect(serialized, `密钥 ${secret} 泄漏到了配置状态里`).not.toContain(secret);
    }
  });
});
