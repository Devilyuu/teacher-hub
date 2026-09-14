import { describe, expect, it } from "vitest";
import { parseBulkStudents } from "./student";

describe("parseBulkStudents", () => {
  it("Excel 整块粘贴（制表符分列）逐列落位", () => {
    const rows = parseBulkStudents(
      "张三\t2022010101\t13800000001\t13900000001\t5-302\n李四\t2022010102",
    );
    expect(rows).toEqual([
      {
        name: "张三",
        studentNo: "2022010101",
        phone: "13800000001",
        parentPhone: "13900000001",
        dormRoom: "5-302",
      },
      { name: "李四", studentNo: "2022010102", phone: null, parentPhone: null, dormRoom: null },
    ]);
  });

  it("只贴一列姓名也行——空行、行首尾空白全吃掉", () => {
    const rows = parseBulkStudents("  张三  \n\n李四\r\n王五\n");
    expect(rows.map((row) => row.name)).toEqual(["张三", "李四", "王五"]);
  });

  it("手打名单常用的逗号、顿号、连续空格都认", () => {
    expect(parseBulkStudents("张三，2022010101")[0].studentNo).toBe("2022010101");
    expect(parseBulkStudents("张三、2022010101")[0].studentNo).toBe("2022010101");
    expect(parseBulkStudents("张三  2022010101")[0].studentNo).toBe("2022010101");
  });

  it("中间缺列的单元格转 null 而不是空串——空串进库就是脏数据", () => {
    const [row] = parseBulkStudents("张三\t\t13800000001");
    expect(row.studentNo).toBeNull();
    expect(row.phone).toBe("13800000001");
  });

  it("解析不出姓名的行整行丢弃", () => {
    // 逗号开头 = 首列（姓名）为空
    expect(parseBulkStudents(",2022010101")).toEqual([]);
  });
});
