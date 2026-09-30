import { describe, expect, it } from "vitest";
import {
  menteeBatchFormSchema,
  menteeRecordFormSchema,
  parseBulkMentees,
} from "./mentee";

// 举例一律用虚构名（open-source/README.md 的规矩），
// 电话也刻意不写成 11 位手机号——开源导出的扫描器会把 `1[3-9]\d{9}` 当真号拦下

describe("parseBulkMentees", () => {
  it("Excel 整块粘贴（制表符分列）逐列落位：姓名 学号 班级 手机", () => {
    const rows = parseBulkMentees(
      "林知远\t2023010101\t数媒2301\t0519-86660001\n苏明宇\t2023010102",
    );
    expect(rows).toEqual([
      {
        name: "林知远",
        studentNo: "2023010101",
        className: "数媒2301",
        phone: "0519-86660001",
      },
      { name: "苏明宇", studentNo: "2023010102", className: null, phone: null },
    ]);
  });

  it("只贴一列姓名也行——空行、行首尾空白全吃掉", () => {
    const rows = parseBulkMentees("  林知远  \n\n苏明宇\r\n周彦\n");
    expect(rows.map((row) => row.name)).toEqual(["林知远", "苏明宇", "周彦"]);
  });

  it("手打名单常用的逗号、顿号、连续空格都认", () => {
    expect(parseBulkMentees("林知远，2023010101")[0].studentNo).toBe("2023010101");
    expect(parseBulkMentees("林知远、2023010101")[0].studentNo).toBe("2023010101");
    expect(parseBulkMentees("林知远  2023010101")[0].studentNo).toBe("2023010101");
  });

  it("中间缺列的单元格转 null 而不是空串——空串进库就是脏数据", () => {
    const [row] = parseBulkMentees("林知远\t\t数媒2301");
    expect(row.studentNo).toBeNull();
    expect(row.className).toBe("数媒2301");
  });

  it("解析不出姓名的行整行丢弃", () => {
    // 逗号开头 = 首列（姓名）为空
    expect(parseBulkMentees(",2023010101")).toEqual([]);
  });

  it("第三列是班级不是手机——导师学生跨班，这一列不能跟班主任那份对调", () => {
    // 这条断言是防回归的：两个模块的粘贴解析长得几乎一样，
    // 哪天有人想「合并成一个通用函数」，列序对调不会有任何编译错误，
    // 只会让整批学生的班级里存着手机号
    const [row] = parseBulkMentees("林知远\t2023010101\t数媒2301\t0519-86660001");
    expect(row.className).toBe("数媒2301");
    expect(row.phone).toBe("0519-86660001");
  });
});

describe("menteeBatchFormSchema", () => {
  // 喂给 schema 的对象**只放表单真会提交的键**。原来这里多塞了一个 `note: ""`，
  // 而建批次的表单根本没有备注框——单测全绿，线上却从来建不成批次（2026-09-24）
  it("表单只交批次名和年份两个键，照样建得成", () => {
    const parsed = menteeBatchFormSchema.safeParse({ name: "2025艺术设计", year: "2025" });
    expect(parsed.success).toBe(true);
  });

  it("年份从表单的字符串强制转数字——FormData 里什么都是字符串", () => {
    const parsed = menteeBatchFormSchema.safeParse({ name: "2023 级数媒", year: "2023" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.year).toBe(2023);
  });

  it("手滑打多一位的年份挡下来——它是届次排序口径，不是业务判定", () => {
    const parsed = menteeBatchFormSchema.safeParse({ name: "数媒", year: "20233" });
    expect(parsed.success).toBe(false);
  });
});

describe("menteeRecordFormSchema", () => {
  const base = { typeId: "type-1", date: "2026-09-24", content: "聊了选题方向" };

  it("这一批还没有项目时表单不渲染项目下拉，缺这个键也能存", () => {
    const parsed = menteeRecordFormSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.projectId).toBeNull();
  });

  it("下拉里选「不挂项目」（空串）同样是 null", () => {
    const parsed = menteeRecordFormSchema.safeParse({ ...base, projectId: "" });
    expect(parsed.success && parsed.data.projectId).toBeNull();
  });

  it("选了项目就原样带出来，归属由动作拿库里的批次复核", () => {
    const parsed = menteeRecordFormSchema.safeParse({ ...base, projectId: "project-1" });
    expect(parsed.success && parsed.data.projectId).toBe("project-1");
  });
});
