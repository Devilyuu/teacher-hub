import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  SENSITIVE_FIELD_EXEMPTIONS,
  SENSITIVE_FIELD_PATTERN,
  cursorFieldOf,
} from "./tables";

/**
 * 备份表清单的 fail-closed 门禁。
 *
 * 这几条测试的价值不在于"现在是对的"，而在于**新增一张表时逼人做一次显式决定**。
 * 漏掉一张表不会抛异常，只会让备份静默少一块——等到真要搬迁那天才发现，
 * 那时已经没有补救的余地了。
 */

const schemaSource = readFileSync(
  join(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
);

/** schema.prisma 里声明的全部模型名 */
function declaredModels(source: string): string[] {
  return [...source.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]!);
}

/** 逐个模型取出它声明的字段名（跳过 `@@index` 这类块级属性和注释） */
function declaredFields(source: string): Array<{ model: string; field: string }> {
  const fields: Array<{ model: string; field: string }> = [];

  for (const block of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const model = block[1]!;
    for (const rawLine of block[2]!.split("\n")) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("//") || line.startsWith("@@") || line.startsWith("///")) {
        continue;
      }
      const name = line.split(/\s+/)[0];
      if (name) fields.push({ model, field: name });
    }
  }

  return fields;
}

describe("备份表清单", () => {
  it("覆盖 schema.prisma 里的每一张表，不多不少", () => {
    const declared = [...declaredModels(schemaSource)].sort();
    const listed = BACKUP_TABLES.map((table) => table.model).sort();

    // 用 toEqual 比对全集而不是逐个 includes：少一张要红，多一张（表删了但
    // 清单忘了改）同样要红——后者会让导出时按不存在的 delegate 取数而崩
    expect(listed).toEqual(declared);
  });

  it("delegate 名是模型名首字母小写", () => {
    for (const table of BACKUP_TABLES) {
      const expected = table.model.charAt(0).toLowerCase() + table.model.slice(1);
      expect(table.delegate, `${table.model} 的 delegate 写错了`).toBe(expected);
    }
  });

  it("每张表都写了理由", () => {
    for (const table of BACKUP_TABLES) {
      expect(table.reason.trim(), `${table.model} 没写理由`).not.toBe("");
    }
  });

  it("排除任何一张表都必须写明代价", () => {
    // 今天没有排除项。将来真要排除某张表时，这条会强制在 reason 里说清楚
    // 「搬迁时会缺什么」，而不是留一个光秃秃的 include: false
    for (const table of BACKUP_TABLES.filter((item) => !item.include)) {
      expect(
        table.reason.length,
        `${table.model} 被排除，但理由太短，说不清代价`,
      ).toBeGreaterThan(10);
    }
  });
});

/**
 * 找出 Prisma **隐式多对多**关系。
 *
 * 判据：字段 `xs Foo[]` 的目标模型 `Foo` 里，找不到任何**非列表**的本模型字段
 * 作为反向引用。显式连接表一定有那一侧（`entry CompetitionEntry`），
 * 隐式 m2m 两边都是列表。
 */
function implicitManyToMany(source: string): string[] {
  const blocks = [...source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const bodies = new Map(blocks.map((block) => [block[1]!, block[2]!]));
  const found: string[] = [];

  /** 一行里的「字段名 类型」。注释和块级属性返回 null */
  function fieldOf(rawLine: string): { name: string; type: string } | null {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("@@")) return null;
    const [name, type] = line.split(/\s+/);
    return name && type ? { name, type } : null;
  }

  for (const [model, body] of bodies) {
    for (const rawLine of body.split(/\r?\n/)) {
      const field = fieldOf(rawLine);
      if (!field?.type.endsWith("[]")) continue;

      const target = field.type.slice(0, -2);
      const targetBody = bodies.get(target);
      // 目标不是模型（标量数组，如 tags String[]）就不是关系
      if (!targetBody) continue;

      const hasSingularBackRef = targetBody.split(/\r?\n/).some((backRaw) => {
        const back = fieldOf(backRaw);
        return back?.type === model || back?.type === `${model}?`;
      });
      if (!hasSingularBackRef) found.push(`${model}.${field.name}`);
    }
  }

  return found;
}

describe("隐式多对多", () => {
  it("一个都不许有——隐式连接表不是 model，这份清单根本看不见它", () => {
    // 这条是 2026-09-12 补的，补的正是它**没能拦住**的那次：
    // `DutyRecord.participants Teacher[]` 当了两个月的隐式 m2m，
    // 全库 JSON 备份里轮派记录一条不少、参与者却全是空的，**不报任何错**。
    // 上面那条「不多不少」的断言对它完全无能为力——隐式表压根不是 model。
    //
    // 所以规矩是：**多对多一律写显式连接表**（StudentHonorMember、
    // CompetitionCoach、DutyParticipant 都是这么来的）。
    expect(implicitManyToMany(schemaSource)).toEqual([]);
  });
});

/** 每个模型的单字段主键（`@id` 所在的字段名） */
function primaryKeyFields(source: string): Record<string, string> {
  const keys: Record<string, string> = {};

  for (const block of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const model = block[1]!;
    for (const rawLine of block[2]!.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("//") || line.startsWith("@@")) continue;
      if (/@id\b/.test(line)) {
        keys[model] = line.split(/\s+/)[0]!;
        break;
      }
    }
  }

  return keys;
}

describe("游标字段", () => {
  const keys = primaryKeyFields(schemaSource);

  it("与 schema 里的 @id 一致", () => {
    // 踩过一次：PromotionRuleset 的主键是 `year Int @id` 而不是 `id`，
    // 按 id 排序会让 Prisma 抛 Unknown argument，整份备份取不出来。
    // 这条把「主键不叫 id」的表逼出来，而不是等到跑 verifier 才发现
    for (const table of BACKUP_TABLES) {
      expect(cursorFieldOf(table), `${table.model} 的游标字段与主键不符`).toBe(
        keys[table.model],
      );
    }
  });

  it("每张表都有单字段主键", () => {
    // 复合主键（@@id）没有单一游标可用，cursor 分页做不了。
    // 真出现了要先决定怎么翻页，不能让它悄悄退化成只导出第一批
    for (const table of BACKUP_TABLES) {
      expect(keys[table.model], `${table.model} 没有单字段主键`).toBeDefined();
    }
  });
});

describe("敏感字段探测", () => {
  it("schema 里没有未豁免的口令/密钥/令牌字段", () => {
    const hits = declaredFields(schemaSource)
      .filter(({ field }) => SENSITIVE_FIELD_PATTERN.test(field))
      .map(({ model, field }) => `${model}.${field}`)
      .filter((key) => !(key in SENSITIVE_FIELD_EXEMPTIONS));

    // 命中说明有人往库里加了疑似凭证的字段，而备份会把它一起送出门。
    // 要么别存进数据库（现有做法：全部走环境变量），要么在
    // SENSITIVE_FIELD_EXEMPTIONS 里写明为什么它可以导出
    expect(hits, `发现疑似敏感字段：${hits.join("、")}`).toEqual([]);
  });

  it("探测规则本身有效", () => {
    // 防止有人把正则改坏之后，上一条测试变成永远绿的摆设
    const fakeSchema = [
      "model Fake {",
      "  id String @id",
      "  webhookSecret String",
      "}",
    ].join("\n");

    const hits = declaredFields(fakeSchema).filter(({ field }) =>
      SENSITIVE_FIELD_PATTERN.test(field),
    );

    expect(hits).toEqual([{ model: "Fake", field: "webhookSecret" }]);
  });

  it("豁免清单里的每一条都写了理由", () => {
    for (const [key, reason] of Object.entries(SENSITIVE_FIELD_EXEMPTIONS)) {
      expect(reason.trim(), `${key} 被豁免但没写理由`).not.toBe("");
    }
  });
});
