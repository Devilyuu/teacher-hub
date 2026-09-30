import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BACKUP_ACTIVITY,
  DESKTOP_BACKUP_STALE_AFTER_HOURS,
  backupFreshness,
  formatHoursAgo,
  parseBackupActivity,
  type BackupRecord,
} from "./freshness";

const record = (completedAt: string): BackupRecord => ({
  completedAt: new Date(completedAt),
  stamp: "2026-09-26_0320",
  bytes: 43_000_000,
  tables: 55,
  codeVersion: "7b5ea53",
});

describe("backupFreshness", () => {
  const now = new Date("2026-09-26T12:00:00+08:00");

  it("每天 03:20 那一笔，到当天中午是新鲜的", () => {
    expect(backupFreshness(record("2026-09-26T03:20:00+08:00"), now)).toMatchObject({
      state: "fresh",
      hoursAgo: 8 + 40 / 60,
    });
  });

  /** 36 小时 = 错过一次还多留半天，某天晚跑几分钟不报警 */
  it("错过一次（超过 36 小时）才算过期", () => {
    expect(backupFreshness(record("2026-09-25T00:30:00+08:00"), now).state).toBe("fresh");
    expect(backupFreshness(record("2026-09-24T23:59:00+08:00"), now).state).toBe("stale");
  });

  /** 本机库、刚部署还没到第一次 03:20 的线上库都没有记录，报了就是狼来了 */
  it("一笔都没有时不报警", () => {
    expect(backupFreshness(null, now)).toEqual({ state: "never" });
  });

  it("桌面版一周才算过期（人手点备份，天天催就成了狼来了）", () => {
    expect(backupFreshness(record("2026-09-20T12:00:00+08:00"), now, DESKTOP_BACKUP_STALE_AFTER_HOURS).state).toBe("fresh");
    expect(backupFreshness(record("2026-09-19T11:00:00+08:00"), now, DESKTOP_BACKUP_STALE_AFTER_HOURS).state).toBe("stale");
  });
});

describe("formatHoursAgo", () => {
  it("两天内按小时，再往后按天", () => {
    expect(formatHoursAgo(0.5)).toBe("不到 1 小时前");
    expect(formatHoursAgo(8.7)).toBe("8 小时前");
    expect(formatHoursAgo(47.9)).toBe("47 小时前");
    expect(formatHoursAgo(75)).toBe("3 天前");
  });
});

describe("parseBackupActivity", () => {
  it("读 backup.sh 写的 detail，缺的字段给 null", () => {
    const createdAt = new Date("2026-09-26T03:21:00+08:00");
    expect(
      parseBackupActivity({
        entityId: "2026-09-26_0320",
        detail: { bytes: 43_000_000, tables: 55, codeVersion: "7b5ea53" },
        createdAt,
      }),
    ).toEqual({ completedAt: createdAt, stamp: "2026-09-26_0320", bytes: 43_000_000, tables: 55, codeVersion: "7b5ea53" });
    expect(parseBackupActivity({ entityId: "x", detail: null, createdAt })).toMatchObject({
      bytes: null,
      tables: null,
      codeVersion: null,
    });
  });
});

/**
 * backup.sh 是 shell 里手写的 SQL，Prisma 管不到它。表改名、列改名、这边常量改了，
 * 备份照样成功、那一笔却写不进去或写成别的名字——平台就会一直说「超过 36 小时没备份」
 * 或者永远不提示。这里对着 schema.prisma 和常量把它钉住
 */
describe("backup.sh 写的那一笔与 schema、常量对得上", () => {
  const script = readFileSync("scripts/backup.sh", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const insert = script.match(/INSERT INTO \\"(\w+)\\" \(([^)]*)\)/);

  it("写的是 ActivityLog，列都在 schema 里", () => {
    expect(insert?.[1]).toBe("ActivityLog");
    const model = schema.match(/model ActivityLog \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const columns = (insert?.[2] ?? "").split(",").map((column) => column.replace(/[\\"\s]/g, ""));
    expect(columns).toEqual(["id", "entityType", "entityId", "action", "detail", "createdAt"]);
    for (const column of columns) {
      expect(model).toMatch(new RegExp(`^\\s+${column}\\s`, "m"));
    }
  });

  /**
   * Prisma 往 timestamp 列里存 UTC 墙上时间；线上库会话时区是 Asia/Shanghai，
   * 靠列默认值会存成东八区时间、平台读出来晚 8 小时
   */
  it("createdAt 显式写成 UTC，不靠列默认值", () => {
    expect(script).toMatch(/now\(\) AT TIME ZONE 'UTC'\);"/);
  });

  it("entityType 和 action 与平台读取用的常量一致", () => {
    expect(script).toContain(`'${BACKUP_ACTIVITY.entityType}', '\${STAMP}', '${BACKUP_ACTIVITY.action}'`);
  });

  it("这一笔写在所有校验之后、清理旧备份之前", () => {
    const insertAt = script.indexOf("INSERT INTO");
    expect(insertAt).toBeGreaterThan(script.indexOf("pg_restore -l"));
    expect(insertAt).toBeGreaterThan(script.indexOf("manifest.txt"));
    expect(insertAt).toBeLessThan(script.indexOf("滚动清理 ──"));
  });
});
