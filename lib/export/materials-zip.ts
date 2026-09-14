/**
 * 课题材料 ZIP 的条目规划（规格 7.4）。
 *
 * 纯函数：决定「哪些附件进包、在包里叫什么名」。真正读盘和打包在
 * app/api/export/project-materials/route.ts 和 lib/zip.ts。
 */
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";
import type { AttachmentKind } from "@/lib/generated/prisma/enums";

/**
 * Windows 上不能出现在文件名里的字符，外加两种路径分隔符和控制字符。
 * **空格和连字符不在此列**——它们在文件名里完全合法，换掉只会让名字变丑。
 */
const ILLEGAL_CHARS = /[<>:"|?*\\\/]/g;

/**
 * 控制字符按**码位**筛掉，不写成正则里的转义范围。
 *
 * 写成 /[\x00-\x1f]/ 看着更短，但那串转义在编辑器、diff 和各种工具之间
 * 传一圈很容易被还原成真的控制字节存进源码——那时代码看起来还是对的，
 * 却已经不是你写的那个正则了。码位比较没有这个风险。
 */
function stripControlChars(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code >= 0x20 && code !== 0x7f) return char;
      // 制表、换行、回车换成空格再交给下面的空白折叠——直接删掉会把
      // "报告	终稿" 粘成 "报告终稿"，那是两个词而不是一个
      return code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d
        ? " "
        : "";
    })
    .join("");
}

/** 单个条目名的字符上限。留出解压目录的余量，避免撞 Windows 的路径长度限制 */
const MAX_ENTRY_CHARS = 110;

/**
 * 把一段文本清理成能安全落在任何文件系统上的文件名片段。
 *
 * **不保留任何路径结构**：`/` 和 `\` 一律换成 `_`，所以调用方拼出来的名字
 * 天然是单层的，不可能穿越出解压目录。
 */
export function sanitizeZipSegment(raw: string): string {
  const cleaned = stripControlChars(raw)
    .replace(ILLEGAL_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    // Windows 不允许文件名以点或空格结尾，末尾的点还会被静默吃掉
    .replace(/[. ]+$/, "")
    .replace(/^[. ]+/, "");

  if (cleaned === "") return "未命名";
  return cleaned;
}

function splitExtension(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  // 开头的点不是扩展名分隔符（.gitignore 整个都是名字）
  if (dot <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}

/** 截断到上限，扩展名必须留着——丢了扩展名，双击就打不开了 */
function truncateEntry(name: string): string {
  if (name.length <= MAX_ENTRY_CHARS) return name;
  const { base, ext } = splitExtension(name);
  const room = Math.max(1, MAX_ENTRY_CHARS - ext.length);
  return `${base.slice(0, room)}${ext}`;
}

export type MaterialAttachment = {
  id: string;
  code: string | null;
  kind: AttachmentKind;
  filename: string;
  storagePath: string;
  size: number;
  uploadedAt: Date;
};

/** 附件从哪条路进的包。同一份只会出现一次，取先到的那条 */
export type MaterialSourceKind = "PROJECT" | "ACHIEVEMENT";

export type PlannedEntry = {
  attachmentId: string;
  storagePath: string;
  /** 包内文件名，已清理并去重 */
  name: string;
  /**
   * 包内文件名的编号段（`1-1_结题报告_报告.docx` 里的 `1-1`）。
   * 结题清单 Word 直接引这个号，**不自己再编一套**——清单上写着「材料 1-2」、
   * 解开 ZIP 却找不到对应文件，那份清单就废了（增量 3.2）。
   */
  no: string;
  kind: AttachmentKind;
  /** 用户上传时的原始文件名，清单里按它显示 */
  filename: string;
  size: number;
  uploadedAt: Date;
  source: MaterialSourceKind;
};

export type MaterialZipPlan = {
  entries: PlannedEntry[];
  /** 勾选了但不在本课题可打包范围内的 id。界面要如实说，不能假装打进去了 */
  unknownSelectedIds: string[];
  totalBytes: number;
};

/**
 * 规划 ZIP 内容。
 *
 * 两条来源各取一次再**按 attachment id 去重**（规格 6.4）：课题级材料，
 * 以及经 `RequirementLink → Achievement → attachments` 到达的成果级证据。
 * 不去重的话，一份既是课题材料又被成果引用的 PDF 会进包两次，
 * 评审看到两个同名文件会以为交重了。
 *
 * 命名 = 编号 + 类型 + 原始文件名（规格 7.4）。没有编号的用运行序号补上——
 * 编号在申报表、材料目录、ZIP 里必须一致，缺编号时至少保证包内有稳定次序。
 *
 * **`编号_类型_` 这个前缀不是装饰**，它顺带挡掉了 Windows 保留设备名：
 * 用户存了个叫 `CON.pdf` 的材料，直接用原名写进包，解压到 Windows 上会当场失败
 * （`CON`/`AUX`/`COM1` 这类名字创建不出来）。前缀段永远非空（清理为空时兜底成
 * 「未命名」），所以条目名的主干永远不可能正好等于某个保留名。
 * 改命名规则时这条要一起想，单测锁住了它。
 *
 * @param selectedIds 勾选下载时给 id 列表；全部下载给 null。
 */
export function buildMaterialZipPlan(input: {
  projectMaterials: MaterialAttachment[];
  achievementEvidence: MaterialAttachment[];
  selectedIds: string[] | null;
}): MaterialZipPlan {
  const { projectMaterials, achievementEvidence, selectedIds } = input;

  const seen = new Set<string>();
  const candidates: Array<{ attachment: MaterialAttachment; source: MaterialSourceKind }> = [];

  // 课题材料在前、成果证据在后：包里从上往下就是「课题自己交的」→「成果佐证的」
  for (const attachment of projectMaterials) {
    if (seen.has(attachment.id)) continue;
    seen.add(attachment.id);
    candidates.push({ attachment, source: "PROJECT" });
  }
  for (const attachment of achievementEvidence) {
    if (seen.has(attachment.id)) continue;
    seen.add(attachment.id);
    candidates.push({ attachment, source: "ACHIEVEMENT" });
  }

  const selected = selectedIds == null ? null : new Set(selectedIds);
  const unknownSelectedIds = selectedIds == null ? [] : selectedIds.filter((id) => !seen.has(id));

  const used = new Map<string, number>();
  const entries: PlannedEntry[] = [];
  let totalBytes = 0;

  candidates.forEach(({ attachment, source }, index) => {
    if (selected && !selected.has(attachment.id)) return;

    // 序号按**全部候选**的位置算，不按本次勾选的位置。
    // 这样同一份材料无论整包下载还是单勾下载，编号都一样，
    // 两次下载的文件放进同一个目录不会互相覆盖，也对得上材料目录
    const prefix = sanitizeZipSegment(attachment.code ?? String(index + 1).padStart(2, "0"));
    const kind = sanitizeZipSegment(ATTACHMENT_KIND_LABELS[attachment.kind]);
    const filename = sanitizeZipSegment(attachment.filename);

    let name = truncateEntry(`${prefix}_${kind}_${filename}`);

    // 重名加 (2)(3)。加在扩展名前面，双击还能打开
    const collisions = used.get(name) ?? 0;
    used.set(name, collisions + 1);
    if (collisions > 0) {
      const { base, ext } = splitExtension(name);
      name = `${base}(${collisions + 1})${ext}`;
    }

    entries.push({
      attachmentId: attachment.id,
      storagePath: attachment.storagePath,
      name,
      no: prefix,
      kind: attachment.kind,
      filename: attachment.filename,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt,
      source,
    });
    totalBytes += attachment.size;
  });

  return { entries, unknownSelectedIds, totalBytes };
}
