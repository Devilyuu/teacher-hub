import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sessionGuard } from "@/lib/server-auth";
import { canPreviewInline, readUpload } from "@/lib/storage";

/**
 * 附件下载 / 预览。
 *
 * **这里必须自己再验一次登录**，不能只靠 proxy.ts：
 * 那个 matcher 为了放行静态资源，排除了所有以 .png/.jpg/.svg 等结尾的路径。
 * 现在的 URL 形如 /api/attachments/<id> 不带扩展名所以是被保护的，
 * 但这层依赖太脆——将来谁把文件名加进 URL（/api/attachments/x/见刊页.png）
 * 就会绕过鉴权，把真实履历材料暴露出去。
 *
 * 也正因如此，URL 里**不放原始文件名**，文件名通过 Content-Disposition 还原。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const attachment = await prisma.attachment.findUnique({ where: { id: (await params).id } });
  if (!attachment) {
    return new NextResponse("附件不存在", { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readUpload(attachment.storagePath);
  } catch (error) {
    // 库里有记录但磁盘上没文件，多半是手工删过或迁移丢了。
    // 说清楚是哪种情况，别笼统报 500
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new NextResponse("文件已从磁盘丢失，请重新上传", { status: 410 });
    }
    throw error;
  }

  // ?download=1 强制下载；否则 PDF 与图片内联预览，Office 文档只能下载
  const forceDownload = request.nextUrl.searchParams.get("download") === "1";
  const inline = !forceDownload && canPreviewInline(attachment.mimeType);

  // RFC 5987：中文文件名必须走 filename*，否则浏览器拿到乱码
  const encodedName = encodeURIComponent(attachment.filename);
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": disposition,
      // 别让浏览器猜类型——猜成 text/html 就等于给了个同源脚本执行点
      "X-Content-Type-Options": "nosniff",
      // 私密材料，不进任何中间缓存
      "Cache-Control": "private, no-store",
    },
  });
}
