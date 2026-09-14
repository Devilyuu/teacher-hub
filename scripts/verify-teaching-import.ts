import "dotenv/config";

// 必须在 import route 之前设好：teachingImportGuard 读的是 process.env
process.env.TEACHING_IMPORT_TOKEN ??= `verify-teaching-token-${crypto.randomUUID()}`;

import { readFile, rm, stat } from "node:fs/promises";
import { prisma } from "../lib/db";
import { POST } from "../app/api/teaching/import/route";
import { adoptTeachingImport } from "../lib/teaching-import-mutations";
import { resolveStoragePath, teachingImportScope } from "../lib/storage";

/**
 * 教案回流的真实数据库验证 + **假客户端验收**（规格 §11.2「用假客户端验收」）。
 *
 * 直接调用 Route Handler 的 `POST`，走完整的接口代码路径：令牌闸门、
 * multipart 解析、zod 校验、幂等、附件落盘与补偿。不起 HTTP 服务器——
 * 那只会把 Next 的启动问题混进来，而这里要验的是接口本身。
 */

const TOKEN = process.env.TEACHING_IMPORT_TOKEN!;
const ENDPOINT = "https://desk.test/api/teaching/import";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Payload = {
  externalSystem: string;
  externalId: string;
  title: string;
  courseName?: string;
  term?: string;
  finishedAt?: string;
  note?: string;
  file?: { name: string; type: string; bytes: Buffer };
};

function buildRequest(payload: Payload, token: string | null): Request {
  const form = new FormData();
  form.set("externalSystem", payload.externalSystem);
  form.set("externalId", payload.externalId);
  form.set("title", payload.title);
  if (payload.courseName) form.set("courseName", payload.courseName);
  if (payload.term) form.set("term", payload.term);
  if (payload.finishedAt) form.set("finishedAt", payload.finishedAt);
  if (payload.note) form.set("note", payload.note);
  if (payload.file) {
    form.set(
      "file",
      new File([new Uint8Array(payload.file.bytes)], payload.file.name, {
        type: payload.file.type,
      }),
    );
  }

  return new Request(ENDPOINT, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

async function callImport(payload: Payload, token: string | null = TOKEN) {
  const response = await POST(buildRequest(payload, token));
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body: body as Record<string, unknown> | null };
}

async function main() {
  const suffix = crypto.randomUUID();
  const system = "verify-teaching";
  const findings: Record<string, unknown> = {};
  const createdImportIds: string[] = [];
  const createdAchievementIds: string[] = [];
  const storagePaths: string[] = [];

  try {
    // ── 1. 令牌闸门三态 ──
    const noToken = await callImport({ externalSystem: system, externalId: `a-${suffix}`, title: "无令牌" }, null);
    assert(noToken.status === 401, `缺令牌应 401，实际 ${noToken.status}`);

    const badToken = await callImport(
      { externalSystem: system, externalId: `a-${suffix}`, title: "错令牌" },
      "definitely-not-the-token",
    );
    assert(badToken.status === 401, `错令牌应 401，实际 ${badToken.status}`);
    assert(
      JSON.stringify(badToken.body) === JSON.stringify({ error: "unauthorized" }),
      `拒绝响应泄漏了业务信息：${JSON.stringify(badToken.body)}`,
    );
    findings.tokenGate = true;

    // 被拒的请求一条记录都不该留下
    const afterDenied = await prisma.teachingImport.count({ where: { externalSystem: system } });
    assert(afterDenied === 0, `鉴权失败仍写入了 ${afterDenied} 条记录`);
    findings.deniedWritesNothing = true;

    // ── 2. 载荷校验 ──
    const badDate = await callImport({
      externalSystem: system,
      externalId: `bad-date-${suffix}`,
      title: "坏日期",
      finishedAt: "2026-02-31",
    });
    assert(badDate.status === 400, `不存在的日期应 400，实际 ${badDate.status}`);
    findings.rejectsImpossibleDate = true;

    // ── 3. 带附件的正常回流 ──
    const docx = Buffer.from(`fake docx ${suffix}`, "utf8");
    const externalId = `lesson-${suffix}`;
    const first = await callImport({
      externalSystem: system,
      externalId,
      title: "《数字媒体技术》第三章教案——含「引号」与破折号",
      courseName: "数字媒体技术",
      term: "2025-2026 第二学期",
      finishedAt: "2026-08-05",
      note: "第三章 图像处理",
      file: { name: "第三章教案.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: docx },
    });
    assert(first.status === 201, `首次回流应 201，实际 ${first.status} ${JSON.stringify(first.body)}`);
    assert(first.body?.created === true, "首次回流 created 应为 true");
    const importId = String(first.body?.id);
    createdImportIds.push(importId);

    const stored = await prisma.teachingImport.findUnique({
      where: { id: importId },
      include: { attachments: true },
    });
    assert(stored, "回流记录没落库");
    assert(stored.status === "RECEIVED", `状态应为 RECEIVED，实际 ${stored.status}`);
    assert(stored.attachments.length === 1, `应有 1 份附件，实际 ${stored.attachments.length}`);
    assert(stored.achievementId === null, "回流不得自动创建成果（第 1 条铁律）");
    // 学期要能单独取出来，不能只躺在 note 里——一门课教了几个学期是要分开看的
    assert(
      stored.term === "2025-2026 第二学期",
      `学期应单独落列，实际 ${JSON.stringify(stored.term)}`,
    );
    storagePaths.push(stored.attachments[0]!.storagePath);
    findings.storedWithAttachment = true;
    findings.termStoredSeparately = true;

    // 中文文件名与日期原样往返
    assert(stored.attachments[0]!.filename === "第三章教案.docx", "文件名往返不一致");
    assert(
      stored.finishedAt?.toISOString() === "2026-08-05T00:00:00.000Z",
      `纯日期口径不对：${stored.finishedAt?.toISOString()}`,
    );
    findings.dateOnlyUtc = true;

    // 磁盘上确实有这个文件，且字节一致
    const absolute = resolveStoragePath(stored.attachments[0]!.storagePath);
    const onDisk = await readFile(absolute);
    assert(onDisk.equals(docx), "落盘内容与上传内容不一致");
    assert(stored.attachments[0]!.storagePath.startsWith(teachingImportScope(importId)), "附件没进教案目录");
    findings.bytesOnDisk = true;

    // ── 4. payload 不含令牌 ──
    const payloadText = JSON.stringify(stored.payload);
    assert(!payloadText.includes(TOKEN), "payload 里出现了服务令牌明文");
    assert(!/authorization|bearer/i.test(payloadText), "payload 里出现了鉴权字段");
    findings.payloadHasNoToken = true;

    // ── 5. 重推即覆盖：同一外部 ID 再送一份新的 ──
    const stalePath = stored.attachments[0]!.storagePath;
    const newer = Buffer.from("PK 改好排版的那一版", "utf8");
    const second = await callImport({
      externalSystem: system,
      externalId,
      title: "改好排版的那一版",
      file: { name: "第三章教案-终稿.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: newer },
    });
    assert(second.status === 200, `重推应 200，实际 ${second.status}`);
    assert(second.body?.created === false, "重推 created 应为 false");
    assert(second.body?.replaced === true, "重推 replaced 应为 true");
    assert(String(second.body?.id) === importId, "重推返回了不同的记录");

    const afterRetry = await prisma.teachingImport.findUnique({
      where: { id: importId },
      include: { attachments: true },
    });
    assert(afterRetry?.attachments.length === 1, `覆盖后附件应仍是 1 份，实际 ${afterRetry?.attachments.length}`);
    assert(afterRetry?.title === "改好排版的那一版", `标题没被覆盖，仍是 ${afterRetry?.title}`);
    assert(
      afterRetry?.attachments[0]!.filename === "第三章教案-终稿.docx",
      `附件没被换掉，仍是 ${afterRetry?.attachments[0]!.filename}`,
    );
    storagePaths.push(afterRetry!.attachments[0]!.storagePath);
    assert(
      (await readFile(resolveStoragePath(afterRetry!.attachments[0]!.storagePath))).equals(newer),
      "新附件落盘内容不是这次送来的那份",
    );
    // 旧文件必须真的从磁盘上消失，否则每次重推都留一份孤儿
    const staleGone = await stat(resolveStoragePath(stalePath)).then(() => false).catch(() => true);
    assert(staleGone, "覆盖后旧附件文件还在磁盘上");

    const total = await prisma.teachingImport.count({ where: { externalSystem: system, externalId } });
    assert(total === 1, `幂等键没兜住，库里有 ${total} 条`);
    findings.replacedOnRepush = true;

    // ── 6. 并发重试也只建一条 ──
    const raceId = `race-${suffix}`;
    const raced = await Promise.all([
      callImport({ externalSystem: system, externalId: raceId, title: "并发 A" }),
      callImport({ externalSystem: system, externalId: raceId, title: "并发 B" }),
      callImport({ externalSystem: system, externalId: raceId, title: "并发 C" }),
    ]);
    const racedIds = new Set(raced.map((result) => String(result.body?.id)));
    assert(racedIds.size === 1, `并发重试建出了 ${racedIds.size} 条记录`);
    assert(
      raced.filter((result) => result.body?.created === true).length === 1,
      "并发重试里应恰好一次 created=true",
    );
    createdImportIds.push([...racedIds][0]!);
    findings.concurrentIdempotent = true;

    // ── 7. 引用为成果：附件归属迁移，全程满足 CHECK 约束 ──
    const adopted = await adoptTeachingImport(prisma, importId, {
      title: "《数字媒体技术》课程建设",
      type: "COURSE",
      year: 2026,
    });
    assert(adopted.status === "adopted", `引用应成功，实际 ${adopted.status}`);
    createdAchievementIds.push(adopted.achievementId);

    const afterAdopt = await prisma.teachingImport.findUnique({
      where: { id: importId },
      include: { attachments: true },
    });
    assert(afterAdopt?.status === "ADOPTED", "状态没转成 ADOPTED");
    assert(afterAdopt?.achievementId === adopted.achievementId, "没回填 achievementId");
    assert(afterAdopt?.attachments.length === 0, "附件还挂在回流记录上");

    const movedAttachments = await prisma.attachment.findMany({
      where: { achievementId: adopted.achievementId },
      select: { id: true, teachingImportId: true, achievementId: true, storagePath: true },
    });
    assert(movedAttachments.length === 1, `成果下应有 1 份附件，实际 ${movedAttachments.length}`);
    assert(movedAttachments[0]!.teachingImportId === null, "旧归属没清空");
    findings.ownershipMoved = true;

    // ── 8. 引用幂等：再点一次不建第二条成果 ──
    const again = await adoptTeachingImport(prisma, importId, {
      title: "不该被建出来",
      type: "COURSE",
      year: 2026,
    });
    assert(again.status === "already-adopted", `重复引用应幂等，实际 ${again.status}`);
    assert(again.achievementId === adopted.achievementId, "重复引用建了新成果");
    findings.adoptIdempotent = true;

    // ── 8b. 已引用为成果的记录拒绝覆盖 ──
    // 附件此刻挂在成果上，可能已经进了申报包。覆盖等于改台账
    const afterAdoptPush = await callImport({
      externalSystem: system,
      externalId,
      title: "又改了一版",
      file: { name: "又一版.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: docx },
    });
    assert(afterAdoptPush.status === 409, `已引用的记录重推应 409，实际 ${afterAdoptPush.status}`);
    assert(afterAdoptPush.body?.replaced === false, "409 时 replaced 应为 false");

    const untouched = await prisma.attachment.findMany({
      where: { achievementId: adopted.achievementId },
      select: { filename: true },
    });
    assert(untouched.length === 1, `成果下附件数被改动了：${untouched.length}`);
    assert(
      untouched[0]!.filename === "第三章教案-终稿.docx",
      `成果下的材料被覆盖成了 ${untouched[0]!.filename}`,
    );
    const stillAdopted = await prisma.teachingImport.findUnique({
      where: { id: importId },
      select: { status: true, title: true },
    });
    assert(stillAdopted?.status === "ADOPTED", `状态被 409 的请求改动了：${stillAdopted?.status}`);
    assert(stillAdopted?.title === "改好排版的那一版", "标题被 409 的请求改动了");
    findings.adoptedRejectsRepush = true;

    // ── 9. 四选一 CHECK 约束仍然生效 ──
    const [constraint] = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conname = 'Attachment_single_owner'
    `;
    assert(constraint?.def.includes("teachingImportId"), "CHECK 约束没扩展到四选一");
    findings.singleOwnerCheck = constraint.def;

    let rejected = false;
    try {
      await prisma.attachment.create({
        data: {
          teachingImportId: importId,
          achievementId: adopted.achievementId,
          kind: "TEACHING_PLAN",
          filename: "两个归属.docx",
          storagePath: `teaching-imports/${suffix}/两个归属.docx`,
          size: 1,
          mimeType: "application/octet-stream",
        },
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "同时挂两个归属竟然写进去了");
    findings.twoOwnersRejected = true;
  } finally {
    // 清理：附件文件、成果、回流记录
    for (const path of storagePaths) {
      await rm(resolveStoragePath(path), { force: true }).catch(() => {});
    }
    await prisma.attachment.deleteMany({
      where: { OR: [{ achievementId: { in: createdAchievementIds } }, { teachingImportId: { in: createdImportIds } }] },
    });
    await prisma.teachingImport.deleteMany({ where: { externalSystem: system } });
    await prisma.achievement.deleteMany({ where: { id: { in: createdAchievementIds } } });
    await rm(resolveStoragePath(`teaching-imports`), { recursive: true, force: true }).catch(() => {});
  }

  // ── 10. 零残留 ──
  const leftImports = await prisma.teachingImport.count({ where: { externalSystem: "verify-teaching" } });
  const leftAchievements = await prisma.achievement.count({
    where: { title: { in: ["《数字媒体技术》课程建设", "不该被建出来"] } },
  });
  const leftFiles = await stat(resolveStoragePath("teaching-imports")).then(() => 1).catch(() => 0);

  const rowsLeftBehind = { imports: leftImports, achievements: leftAchievements, dirs: leftFiles };
  assert(
    leftImports === 0 && leftAchievements === 0 && leftFiles === 0,
    `清理不干净：${JSON.stringify(rowsLeftBehind)}`,
  );

  console.log(JSON.stringify({ status: "pass", ...findings, rowsLeftBehind }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
