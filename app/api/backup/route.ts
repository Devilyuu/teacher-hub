import { verifyPasscode } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { buildBackupMeta, streamBackup } from "@/lib/backup/export";
import { backupFileName } from "@/lib/backup/serialize";
import { isSameOrigin } from "@/lib/export/request";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 全库 JSON 备份（增量 3.8，规格 §7.8；设计见
 * `docs/superpowers/specs/2026-08-05-full-database-json-backup-design.md`）。
 *
 * `POST /api/backup` → application/json 字节流
 *
 * **只开 POST，不开 GET。** 规格原话：这个接口一次 GET 就能拿走全部真实履历，
 * 是全系统最高价值的目标。GET 会被浏览器预取、进历史、进 Referer，
 * 而口令必须在请求体里——这两件事必须一起成立。
 *
 * 三道闸门依次是：会话 → 同源 → 二次口令。**二次口令是叠加的，不是替代**：
 * 少了会话闸门，没登录的人也能直接爆破这个端点。
 */

/** 固定实体标识。备份没有实体可指，但保留字段位置以免破坏时间轴查询 */
const BACKUP_ENTITY_ID = "full-json";

export async function POST(request: Request) {
  // 公开端点，自己验会话——「入口只在登录后的设置页上」不构成安全边界
  const denied = await sessionGuard();
  if (denied) return denied;

  const requestUrl = new URL(request.url);
  if (!isSameOrigin(requestUrl, request.headers.get("origin"))) {
    return Response.json({ error: "拒绝跨站备份请求" }, { status: 403 });
  }

  const form = await request.formData();
  const passcode = form.get("passcode");

  let accepted = false;
  try {
    accepted = typeof passcode === "string" && verifyPasscode(passcode);
  } catch {
    // verifyPasscode 在缺 APP_PASSCODE 时抛错。这属于服务端配置问题，
    // 但对调用方仍然只能是「口令不对」——不泄漏服务端配没配口令
    accepted = false;
  }

  if (!accepted) {
    // 失败留痕（规格 §7.8）。**只记时间，不记输入值**——
    // 把猜错的口令存进数据库，等于给下一个拿到备份的人一份字典
    await logActivity("Backup", BACKUP_ENTITY_ID, "backup.passcode_failed", {
      at: new Date().toISOString(),
    });
    return Response.json({ error: "口令不正确" }, { status: 401 });
  }

  const meta = await buildBackupMeta();
  const totalRows = Object.values(meta.tableCounts).reduce((sum, count) => sum + count, 0);

  // 先记审计再出流。**反过来不行**：流一旦开始写就没有事务可言，
  // 中途失败时记录已经发出去了。取舍与材料 ZIP 一致——
  // 「记了但下载失败」好过「下载了但没记」，前者看日志能对上
  await logActivity("Backup", BACKUP_ENTITY_ID, "backup.download", {
    at: meta.generatedAt,
    schemaMigration: meta.schemaMigration,
    totalRows,
    tableCounts: meta.tableCounts,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamBackup(meta)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (error) {
        // 让连接以错误收场。浏览器会把它当成下载失败，
        // 而不是留下一个看着完整、实际截断或与 meta 不符的 JSON
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // 不设 Content-Length：流式生成时总长度要写完才知道，
      // 设错比不设更糟——浏览器会按错误的长度截断
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        backupFileName(new Date()),
      )}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
