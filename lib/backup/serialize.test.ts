import { describe, expect, it } from "vitest";
import {
  BACKUP_NOTE,
  assertCountsMatch,
  backupFileName,
  closeDocument,
  closeTable,
  openDocument,
  openTable,
  serializeRow,
  type BackupMeta,
} from "./serialize";

const meta: BackupMeta = {
  generatedAt: "2026-08-05T01:30:00.000Z",
  appVersion: "0.1.0",
  schemaMigration: "20260803103000_add_meeting_recording",
  tableCounts: { Project: 2, Achievement: 0 },
  note: BACKUP_NOTE,
};

/** 按流的顺序拼出整份文件，模拟 streamBackup 的产出 */
function assemble(tables: Array<{ model: string; rows: unknown[] }>): string {
  let out = openDocument(meta);
  tables.forEach((table, tableIndex) => {
    out += openTable(table.model, tableIndex === 0);
    table.rows.forEach((row, rowIndex) => {
      out += serializeRow(row, rowIndex === 0);
    });
    out += closeTable();
  });
  return out + closeDocument();
}

describe("备份 JSON 拼装", () => {
  it("多表多行拼出合法 JSON", () => {
    const text = assemble([
      { model: "Project", rows: [{ id: "p1", title: "课题一" }, { id: "p2", title: "课题二" }] },
      { model: "Achievement", rows: [{ id: "a1" }] },
    ]);

    const parsed = JSON.parse(text);
    expect(parsed.meta.schemaMigration).toBe("20260803103000_add_meeting_recording");
    expect(parsed.tables.Project).toHaveLength(2);
    expect(parsed.tables.Project[1].title).toBe("课题二");
    expect(parsed.tables.Achievement).toHaveLength(1);
  });

  it("空表拼出空数组而不是坏 JSON", () => {
    // 手写流式 JSON 最容易在这里翻车：空表如果多写一个逗号，
    // 整份文件都解析不了，而那时已经下载到用户机器上了
    const text = assemble([
      { model: "Project", rows: [] },
      { model: "Achievement", rows: [] },
    ]);

    const parsed = JSON.parse(text);
    expect(parsed.tables.Project).toEqual([]);
    expect(parsed.tables.Achievement).toEqual([]);
  });

  it("只有一张表也合法", () => {
    const parsed = JSON.parse(assemble([{ model: "Profile", rows: [{ id: "x" }] }]));
    expect(parsed.tables.Profile).toEqual([{ id: "x" }]);
  });

  it("一张表都没有也合法", () => {
    const parsed = JSON.parse(assemble([]));
    expect(parsed.tables).toEqual({});
  });

  it("中文、引号和换行原样往返", () => {
    const row = { id: "r1", note: '含"引号"、换行\n和中文——破折号' };
    const parsed = JSON.parse(assemble([{ model: "Task", rows: [row] }]));
    expect(parsed.tables.Task[0]).toEqual(row);
  });

  it("嵌套 Json 字段不被二次字符串化", () => {
    const row = { id: "m1", draftResolutions: [{ text: "决议一", convertedTaskId: null }] };
    const parsed = JSON.parse(assemble([{ model: "MeetingRecording", rows: [row] }]));
    expect(parsed.tables.MeetingRecording[0].draftResolutions).toEqual([
      { text: "决议一", convertedTaskId: null },
    ]);
  });
});

describe("备份文件名", () => {
  it("按本地日期命名", () => {
    // 进程时区 = Asia/Shanghai（CLAUDE.md 部署那节），用户看到的日期就是本地日期
    expect(backupFileName(new Date(2026, 7, 5, 9, 30))).toBe("teacher-desk-backup-2026-08-05.json");
  });

  it("月份和日补零", () => {
    expect(backupFileName(new Date(2026, 0, 9))).toBe("teacher-desk-backup-2026-01-09.json");
  });
});

describe("行数一致性", () => {
  it("一致时通过", () => {
    expect(() => assertCountsMatch({ Project: 2 }, { Project: 2 })).not.toThrow();
  });

  it("实际比承诺少就抛错", () => {
    expect(() => assertCountsMatch({ Project: 3 }, { Project: 2 })).toThrow(/承诺 3、实际 2/);
  });

  it("表整个缺失也抛错", () => {
    expect(() => assertCountsMatch({ Project: 1 }, {})).toThrow(/Project/);
  });

  it("错误信息列出全部不一致的表", () => {
    const run = () => assertCountsMatch({ Project: 1, Task: 5 }, { Project: 0, Task: 4 });
    expect(run).toThrow(/Project/);
    expect(run).toThrow(/Task/);
  });
});
