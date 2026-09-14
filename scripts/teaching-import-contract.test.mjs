import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function source(pathname) {
  return readFileSync(resolve(root, pathname), "utf8");
}

const route = source("app/api/teaching/import/route.ts");

/**
 * 教案回流接口的静态契约（增量 3.6）。
 *
 * 这个接口**在公开路径白名单里**——proxy 不再为它兜底，令牌是唯一的门。
 * 下面几条锁的就是这层边界，以及那条最容易被"顺手优化"掉的铁律。
 */
describe("教案回流接口的安全契约", () => {
  it("令牌闸门在最前，早于读取请求体", () => {
    expect(route).toMatch(
      /export async function POST[^]*?const denied = teachingImportGuard\(request\);\s*if \(denied\) return denied;/,
    );
    const guardAt = route.indexOf("teachingImportGuard(request)");
    const formAt = route.indexOf("request.formData()");
    expect(guardAt).toBeGreaterThan(-1);
    expect(formAt).toBeGreaterThan(guardAt);
  });

  it("在公开路径白名单里，且门禁登记了替代鉴权手段", () => {
    // 少了白名单，外部调用拿到的是 HTML 登录页而不是 401（规格 §5.4）
    expect(source("lib/auth.ts")).toContain('"/api/teaching/import"');

    // 少了这条登记，鉴权门禁会把它当成没鉴权的接口而报红——这正是我们要的
    const verifier = source("scripts/verify-server-actions-auth.mjs");
    expect(verifier).toContain('"app/api/teaching/import/route.ts"');
    expect(verifier).toContain('guard: "teachingImportGuard"');
  });

  it("payload 走 auditPayload，不整体转存请求", () => {
    // 整体转存会把 Authorization 一起写进库，毫无症状，
    // 直到全库备份（3.8）把令牌一起送出门
    expect(route).toContain("auditPayload(input)");
    expect(route).not.toMatch(/payload:\s*(?:body|json|raw|Object\.fromEntries)/);
  });

  it("**不自动创建成果**", () => {
    // 第 1 条铁律 + 规格 §6.6：教案按周产出，自动入库会把待核实队列淹掉。
    // 这条最容易被"顺手优化"掉——回流时直接建成果看起来省了一步
    expect(route).not.toContain("achievement.create");
    expect(route).not.toContain("achievementId:");
  });

  it("附件失败落 FAILED 而不是丢掉整条记录", () => {
    // 教案已经收到了，丢掉记录反而让对方无从得知发生过什么
    expect(route).toContain('status: "FAILED"');
    expect(route).toContain("failureReason");
    expect(route).toContain("deleteUpload");
  });

  it("幂等靠唯一键，不靠先查后写", () => {
    // 先查后写在并发重试下会双双查空、双双插入
    expect(route).toContain("isUniqueViolation");
    const createAt = route.indexOf("teachingImport.create");
    const findAt = route.indexOf("teachingImport.findUnique");
    expect(createAt).toBeGreaterThan(-1);
    expect(findAt).toBeGreaterThan(createAt);
  });

  it("已引用为成果的记录拒绝覆盖", () => {
    // 附件那时已改挂到成果上，材料可能进了申报包。悄悄覆盖等于改台账
    expect(route).toContain('existing.status === "ADOPTED"');
    expect(route).toContain("status: 409");
  });

  it("覆盖时先落新文件、成功了再删旧的", () => {
    // 反过来写的话，一次失败的重推会让记录既没有新文件也没有旧文件
    const attachAt = route.indexOf("const attached = await attachFile(teachingImportId, file)");
    const deleteAt = route.indexOf("attachment.deleteMany");
    expect(attachAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(attachAt);
    expect(route).toMatch(/if \(!attached\.ok\) return attached;/);
  });
});
