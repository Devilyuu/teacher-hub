/**
 * 演示数据种子 —— 截图 / 录屏专用，**全部人物、单位、课题、成果均为虚构**。
 *
 * 和 `prisma/seed.ts` 的关系：那份是真实数据的起点，纪律是「没有来源的字段
 * 一律不写」；这份正好相反，它的存在意义就是把每个界面填满，好让截图里
 * 六种健康度、双口径分类、模糊日期、缺口、逾期任务全都出现。
 *
 * ⚠️ 两份数据绝不能混。所以这个脚本有一道硬护栏：
 * **DATABASE_URL 的库名不含 "demo" 就拒绝运行**，并且开跑前会清空全库。
 * 想改护栏之前先想清楚：真实履历被 TRUNCATE 掉是不可逆的。
 *
 * 用法见 docs/demo-data.md。
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { dateOnly } from "../lib/date";

// ─── 护栏 ────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("缺少环境变量 DATABASE_URL");
}

if (process.env.NODE_ENV === "production") {
  throw new Error("演示种子不得在 NODE_ENV=production 下运行");
}

/**
 * 库名必须含 "demo"。这是唯一拦在「清空真实履历」前面的东西，
 * 不要为了图省事加 --force 之类的旁路。
 */
function assertDemoDatabase(url: string): string {
  let dbName: string;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL 不是合法的连接串，无法判断库名，已中止");
  }

  if (!/demo/i.test(dbName)) {
    console.error("");
    console.error("  ✗ 拒绝运行：目标库名是 " + JSON.stringify(dbName) + "，不含 “demo”。");
    console.error("");
    console.error("    这个脚本会 TRUNCATE 全库。它只允许对着演示库跑。");
    console.error("    正确做法是先建一个独立的演示库，再指着它运行：");
    console.error("");
    console.error("      npm run demo:create-db     # 建 keticompass_demo");
    console.error("      npm run demo:reset         # 迁移 + 灌演示数据");
    console.error("");
    console.error("    详见 docs/demo-data.md。");
    console.error("");
    process.exit(1);
  }

  return dbName;
}

const databaseName = assertDemoDatabase(connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ─── 演示上传目录 ────────────────────────────────────────────────────
//
// 附件本体要落盘才能在界面上下载。写进真实的 data/uploads 会和真材料混在
// 一起，所以要求 UPLOAD_ROOT 单独指向一个含 demo 的目录；没指就跳过落盘，
// 只是「材料」少几行，不影响其余界面。

function resolveDemoUploadRoot(): string | null {
  const raw = process.env.UPLOAD_ROOT?.trim();
  if (!raw) return null;
  if (!/demo/i.test(raw)) return null;
  return resolve(raw);
}

const demoUploadRoot = resolveDemoUploadRoot();

/** 最小合法 PDF。内容是占位文字，只为让下载和大小显示有真东西可拿。 */
function buildDemoPdf(caption: string): Buffer {
  const text = `DEMO FILE - teacher-desk sample attachment`;
  const stream = `BT /F1 14 Tf 60 720 Td (${text}) Tj 0 -28 Td (${caption.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

let writtenFileCount = 0;

/** 落盘一份演示附件，返回 storagePath 与字节数；未配置演示上传根时返回 null。 */
async function writeDemoFile(storagePath: string, caption: string) {
  if (!demoUploadRoot) return null;
  const absolute = resolve(demoUploadRoot, storagePath);
  await mkdir(dirname(absolute), { recursive: true });
  const bytes = buildDemoPdf(caption);
  await writeFile(absolute, bytes);
  writtenFileCount += 1;
  return { storagePath, size: bytes.byteLength };
}

// ─── 清库 ────────────────────────────────────────────────────────────

async function truncateAll() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) {
    throw new Error("演示库里一张业务表都没有，先跑 prisma migrate deploy");
  }
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  return rows.length;
}

// ─── 时间锚点 ────────────────────────────────────────────────────────
//
// 演示数据的健康度和「今天要处理」都相对今天计算，所以一律用偏移量而不是
// 硬编码日期——不然放两周再截图，红的就全变灰了。

const TODAY = new Date();

function offsetDate(days: number): Date {
  const base = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days);
  return dateOnly(base.getFullYear(), base.getMonth() + 1, base.getDate());
}

/** 带时刻的时间戳（会议用），偏移天数 + 当天时分 */
function offsetDateTime(days: number, hour: number, minute = 0): Date {
  const base = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days);
  base.setHours(hour, minute, 0, 0);
  return base;
}

const YEAR = TODAY.getFullYear();

// ─── 字典与档案 ──────────────────────────────────────────────────────

async function seedDictionaries() {
  await prisma.profile.create({
    data: {
      name: "方启明",
      unit: "明湖职业技术学院",
      department: "数字艺术学院",
      title: "教研室主任",
      currentTitle: "讲师",
      currentTitleSince: dateOnly(YEAR - 7, 9, 1),
      phone: "138****0000",
      email: "demo@example.com",
    },
  });

  const sourceNames = [
    "明湖职业技术学院",
    "明州市社会科学界联合会",
    "明州市科学技术局",
    "明州市教育局",
    "省教育科学规划领导小组办公室",
    "明州恒新智能装备有限公司",
  ];
  const sources = new Map<string, string>();
  for (const [index, name] of sourceNames.entries()) {
    const row = await prisma.projectSource.create({
      data: { name, sortOrder: (index + 1) * 10 },
    });
    sources.set(name, row.id);
  }

  const docCategories = new Map<string, string>();
  for (const [index, name] of ["人才培养方案", "课程标准", "申报参考", "制度文件", "其他"].entries()) {
    const row = await prisma.docCategory.create({ data: { name, sortOrder: (index + 1) * 10 } });
    docCategories.set(name, row.id);
  }

  const teacherNames = ["方启明", "陈立", "周雨桐", "赵行舟", "孙敏", "吴博文", "郑楠", "林嘉禾"];
  const teachers = new Map<string, string>();
  for (const name of teacherNames) {
    const row = await prisma.teacher.create({ data: { name, active: name !== "郑楠" } });
    teachers.set(name, row.id);
  }

  return { sources, docCategories, teachers };
}

// ─── 绩效口径分类（二级学院分钱用）─────────────────────────────────
//
// 六列分级规则原样照抄「学校 Excel」的写法——演示数据也保持这个形态，
// 因为界面存在的意义之一就是把这些没法机器解析的原文原样摆给人看。

type PerfSeed = {
  major: string;
  minor: string;
  base?: string;
  national?: string;
  provincial?: string;
  city?: string;
  school?: string;
  college?: string;
  remark?: string;
  isTeam?: boolean;
};

const PERF_CATEGORIES: PerfSeed[] = [
  { major: "教科研项目", minor: "纵向科研项目立项", base: "3/项", national: "30/项", provincial: "15/项", city: "8/项", school: "3/项", remark: "基本分与级别分相加；未获立项只计基本分" },
  { major: "教科研项目", minor: "纵向科研项目结题", base: "2/项", national: "20/项", provincial: "10/项", city: "5/项", school: "2/项", remark: "以结题证书落款日期所在年度申报" },
  { major: "教科研项目", minor: "教改项目立项", base: "3/项", provincial: "12/项", city: "6/项", school: "3/项", remark: "教改与科研分列，不重复计分" },
  { major: "教科研项目", minor: "横向技术服务到账经费", base: "0.5/万元（上限10分）", remark: "以财务到账凭证为准，按实际到账金额计" },
  { major: "论文著作", minor: "学术论文发表", national: "12/篇", provincial: "6/篇", city: "3/篇", remark: "第一作者或通讯作者；SCI/EI 收录另按附加分" },
  { major: "论文著作", minor: "编写教材", national: "15/部", provincial: "8/部", school: "4/部", remark: "主编按全额，副主编 0.6，参编按字数折算" },
  { major: "论文著作", minor: "专著出版", national: "20/部", remark: "须为独著或第一著者，正式书号" },
  { major: "教学竞赛与获奖", minor: "教师教学能力比赛", national: "25/项（一等）", provincial: "12/项（一等）", city: "6/项", school: "3/项", isTeam: true, remark: "团队项目，负责人 0.5、成员均分" },
  { major: "教学竞赛与获奖", minor: "课程思政教学竞赛", provincial: "10/项", city: "5/项", school: "2/项" },
  { major: "教学竞赛与获奖", minor: "微课与信息化教学比赛", provincial: "8/项", city: "4/项", school: "2/项" },
  { major: "指导学生", minor: "指导学生学科竞赛获奖", national: "15/项", provincial: "8/项", city: "4/项", school: "2/项", remark: "同一赛事只计最高奖项" },
  { major: "指导学生", minor: "指导学生创新创业项目", national: "12/项", provincial: "6/项", school: "2/项" },
  { major: "指导学生", minor: "指导毕业设计获优秀", school: "1/人（上限5分）" },
  { major: "知识产权", minor: "发明专利授权", base: "20/件", remark: "第一发明人；申请受理不计分" },
  { major: "知识产权", minor: "实用新型专利授权", base: "5/件", remark: "个人申报，软资产上限10分" },
  { major: "知识产权", minor: "软件著作权登记", base: "3/件", remark: "个人申报，软资产上限10分" },
  { major: "课程与资源建设", minor: "精品在线开放课程", national: "25/门", provincial: "12/门", school: "5/门", isTeam: true },
  { major: "课程与资源建设", minor: "课程标准修订", school: "1/门", college: "0.5/门", remark: "以学院教学工作委员会审定通过为准" },
  { major: "课程与资源建设", minor: "活页式（工作手册式）教材开发", provincial: "10/部", school: "4/部" },
  { major: "社会服务与培训", minor: "面向企业开展技术培训", base: "10/次", remark: "须有培训协议与签到表" },
  { major: "社会服务与培训", minor: "社区公益讲座", base: "3/次", remark: "上限 9 分" },
  { major: "社会服务与培训", minor: "参与行业标准制定", national: "20/项", provincial: "10/项（市级）、5/项（市辖区级）" },
  { major: "荣誉表彰", minor: "优秀教师 / 师德标兵", national: "20/次", provincial: "10/次", city: "5/次", school: "2/次" },
  { major: "荣誉表彰", minor: "优秀共产党员 / 先进工作者", city: "3/次", school: "1/次" },
  { major: "教学质量", minor: "年度教学质量考核优秀", school: "5/次", remark: "学院分配名额，按教学督导评价排序确定" },
  { major: "教学质量", minor: "督导随堂评课优秀", college: "1/次（上限4分）" },
  { major: "职称附加分", minor: "职称附加分", base: "按人事处认定结果计", remark: "与职称量化表分属两套口径，不互相换算" },
  {
    major: "其他有价值工作（自定义）",
    minor: "由个人申报、经学院教科研工作委员会集体认定后赋分的未列入上述条目的工作",
    base: "1—5/项",
    remark: "每年度累计不超过 10 分，需提交书面说明与佐证材料",
  },
];

async function seedPerfCategories() {
  const map = new Map<string, string>();
  for (const [index, item] of PERF_CATEGORIES.entries()) {
    const row = await prisma.perfCategory.create({
      data: {
        year: YEAR,
        majorCategory: item.major,
        minorCategory: item.minor,
        baseRule: item.base ?? null,
        nationalRule: item.national ?? null,
        provincialRule: item.provincial ?? null,
        cityRule: item.city ?? null,
        schoolRule: item.school ?? null,
        collegeRule: item.college ?? null,
        remark: item.remark ?? null,
        isTeam: item.isTeam ?? false,
        isDepartmentAssigned: item.minor === "年度教学质量考核优秀",
        sortOrder: (index + 1) * 10,
      },
    });
    map.set(item.minor, row.id);
  }
  return map;
}

// ─── 职称口径指标（人事处评职称用）─────────────────────────────────

type PromotionSeed = {
  code: string;
  major: string;
  majorCap: number;
  minor: string;
  rule: string;
  cap?: number;
  capGroup?: string;
  capNote?: string;
  remark?: string;
  appliesTo?: ("TEACHER" | "LAB" | "IDEOLOGY" | "EDU_ADMIN")[];
};

const ALL_SERIES = ["TEACHER", "LAB", "IDEOLOGY", "EDU_ADMIN"] as const;

const PROMOTION_CATEGORIES: PromotionSeed[] = [
  { code: "1.1", major: "师德师风与出勤", majorCap: 10, minor: "年度师德考核", rule: "考核合格计 6 分，优秀每次加 2 分", cap: 8 },
  { code: "1.2", major: "师德师风与出勤", majorCap: 10, minor: "出勤与工作量达标", rule: "任现职以来每学年达标计 0.5 分", cap: 2 },
  { code: "2.1", major: "教学工作", majorCap: 40, minor: "课堂教学工作量", rule: "达到学院规定基本工作量计 10 分，超额部分每 100 学时加 1 分", cap: 16, capNote: "由基本分 10 与超额上限 6 相加得出" },
  { code: "2.2", major: "教学工作", majorCap: 40, minor: "教学质量考核", rule: "年度考核优秀每次 2 分，良好每次 1 分", cap: 8 },
  { code: "2.3", major: "教学工作", majorCap: 40, minor: "教学竞赛获奖", rule: "国家级一等 8 分、二等 6 分；省级一等 5 分、二等 3 分；校级 1 分", cap: 3, capGroup: "2.3+2.4" },
  { code: "2.4", major: "教学工作", majorCap: 40, minor: "指导青年教师", rule: "完整带教一轮计 1 分", cap: 3, capGroup: "2.3+2.4", remark: "与 2.3 合并上限 3 分" },
  { code: "2.5", major: "教学工作", majorCap: 40, minor: "课程建设", rule: "国家级在线开放课程每门 8 分，省级 5 分，校级 2 分", cap: 10 },
  { code: "3.1", major: "育人工作", majorCap: 24, minor: "班主任 / 辅导员工作", rule: "每完整学年计 2 分", cap: 8 },
  { code: "3.2", major: "育人工作", majorCap: 24, minor: "指导学生竞赛获奖", rule: "国家级每项 5 分，省级 3 分，市级 1 分（排名系数见说明）", cap: 10 },
  { code: "3.3", major: "育人工作", majorCap: 24, minor: "第二课堂与社团指导", rule: "每学年计 1 分", cap: 3 },
  { code: "4.1", major: "教研教改", majorCap: 25, minor: "教改课题", rule: "省级每项 5 分，市级 3 分，校级 1 分", cap: 10, capGroup: "4.1+4.2" },
  { code: "4.2", major: "教研教改", majorCap: 25, minor: "教研论文", rule: "核心期刊每篇 4 分，一般期刊 2 分", cap: 10, capGroup: "4.1+4.2", remark: "与 4.1 合并上限 10 分" },
  { code: "4.3", major: "教研教改", majorCap: 25, minor: "教材编写", rule: "国家规划教材主编 8 分，省级 5 分，校本教材 2 分", cap: 8 },
  { code: "4.4", major: "教研教改", majorCap: 25, minor: "教学成果奖", rule: "国家级 15 分，省级 10 分，校级 3 分", cap: 15 },
  { code: "4.5", major: "教研教改", majorCap: 25, minor: "专业建设", rule: "牵头国家级专业群 8 分，省级 5 分", cap: 9, capGroup: "4.5+4.6" },
  { code: "4.6", major: "教研教改", majorCap: 25, minor: "实训基地建设", rule: "省级及以上每项 4 分", cap: 9, capGroup: "4.5+4.6", remark: "与 4.5 合并上限 9 分" },
  { code: "5.1", major: "科研成果及业绩", majorCap: 50, minor: "学术论文", rule: "SCI/EI 每篇 8 分，中文核心 5 分，一般期刊 2 分（第一作者或通讯作者）", cap: 20 },
  { code: "5.2", major: "科研成果及业绩", majorCap: 50, minor: "纵向课题", rule: "国家级每项 8 分，省部级 5 分，市厅级 2.5 分，校级 1 分", cap: 18, remark: "按项赋分，立项与结题不重复计算" },
  { code: "5.3", major: "科研成果及业绩", majorCap: 50, minor: "横向项目和知识产权", rule: "到账经费每 10 万元 0.8 分，上限 8 分；发明专利每件 4 分，实用新型 1 分，软著 0.5 分", cap: 12 },
  { code: "5.4", major: "科研成果及业绩", majorCap: 50, minor: "学术专著", rule: "独著 10 分，第一著者 6 分", cap: 10 },
  { code: "5.5", major: "科研成果及业绩", majorCap: 50, minor: "科研获奖", rule: "省部级科技进步奖三等及以上每项 8 分，市厅级 3 分", cap: 10 },
  { code: "6.1", major: "社会服务", majorCap: 20, minor: "技术服务与培训", rule: "承担企业培训每场 0.5 分，横向技术服务按到账另计", cap: 6 },
  { code: "6.2", major: "社会服务", majorCap: 20, minor: "行业组织兼职", rule: "国家级学会理事及以上 3 分，省级 2 分", cap: 5 },
  {
    code: "6.3",
    major: "社会服务",
    majorCap: 20,
    minor: "文件起草",
    rule: "牵头起草校级及以上政策文件每份 1 分",
    cap: 2,
    appliesTo: ["IDEOLOGY", "EDU_ADMIN"],
    remark: "教师系列、实验系列不适用，故两系列总分各少 2 分",
  },
];

async function seedPromotionCategories() {
  await prisma.promotionRuleset.create({
    data: {
      year: YEAR,
      source: `明湖职业技术学院《专业技术职务评聘业绩量化考核赋分细则（${YEAR}年修订）》附件1、附件2`,
      generalNotes: [
        "所有成果均为任现职以来到申报年度上一年的 12 月 31 日取得。",
        "同一成果适合多个项目时仅按一个项目计算，不重复赋分。",
        "排名系数：第一 1、第二 0.5、第三 0.4、第四 0.3、第五 0.2、第六及以后 0.1。",
        "课题按项赋分，立项与结题不各算一次。",
        "论文以见刊为准，录用通知不计分。",
        "获奖以正式颁发的获奖证书落款日期为准。",
        "横向项目以财务到账凭证为准，合同金额不作为赋分依据。",
        "各一级指标封顶后，超出部分不计入总分。",
        "2.3 与 2.4、4.1 与 4.2、4.5 与 4.6 分别合并封顶。",
        "对赋分有异议的，由人事处会同教务处、科研处联合认定。",
      ],
      teacherTotal: 167,
      labTotal: 162,
      ideologyTotal: 169,
      eduAdminTotal: 157,
    },
  });

  const map = new Map<string, string>();
  for (const [index, item] of PROMOTION_CATEGORIES.entries()) {
    const row = await prisma.promotionCategory.create({
      data: {
        year: YEAR,
        code: item.code,
        majorIndicator: item.major,
        majorCap: item.majorCap,
        minorIndicator: item.minor,
        scoringRule: item.rule,
        remark: item.remark ?? null,
        cap: item.cap ?? null,
        capGroup: item.capGroup ?? item.code,
        capNote: item.capNote ?? null,
        appliesTo: item.appliesTo ?? [...ALL_SERIES],
        sortOrder: (index + 1) * 10,
      },
    });
    map.set(item.code, row.id);
  }
  return map;
}

// ─── 课题 ────────────────────────────────────────────────────────────
//
// 九个课题刻意把 lib/gap.ts 的七种健康度全部覆盖到，好让看板截图上
// 六个语义色一次出齐（GREY 出现两次：已结题与未获立项）：
//
//   RED    在研 + 有缺口 + 结题倒计时 ≤ 30 天
//   ORANGE 在研 + 有缺口 + 31–90 天
//   YELLOW 在研 + 有缺口 + > 90 天
//   GREEN  在研 + 要求全部人工勾了达标
//   BLUE   申报中 + 申报截止 > 30 天
//   UNSET  在研但一条要求都没录（缺口恒为 0，但不能叫「已齐备」）
//   GREY   已结题 / 已终止 / 未获立项

type RequirementSeed = {
  allowedTypes: (
    | "PAPER"
    | "REPORT"
    | "TEXTBOOK"
    | "CASE"
    | "PATENT"
    | "SOFTWARE_COPYRIGHT"
    | "AWARD"
    | "COURSE"
    | "FUNDING_RECEIPT"
  )[];
  requiredCount: number;
  rawText: string;
  /** 能机器校验的部分。无法结构化的一律进 extra 数组（第 2 条铁律） */
  constraints?: { [key: string]: string | number | boolean | string[] };
  dueOffset?: number;
};

type ProjectSeed = {
  key: string;
  title: string;
  shortTitle: string;
  code?: string;
  level: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL" | "DISTRICT" | "SCHOOL" | "INDUSTRY" | "UNRATED";
  category: "RESEARCH" | "TEACHING_REFORM" | "EDU_RESEARCH" | "OTHER";
  fundingType: "VERTICAL" | "HORIZONTAL";
  sourceName: string;
  hostUnit?: string;
  role?: "LEAD" | "CO_LEAD" | "MEMBER";
  status: "DRAFT" | "APPLYING" | "REJECTED" | "ONGOING" | "CLOSING" | "CLOSED" | "TERMINATED";
  ownerOrder?: number;
  memberCount?: number;
  applyDeadlineOffset?: number;
  startOffset?: number;
  endOffset?: number;
  closingOffset?: number;
  fundingTotal?: number;
  fundingReceived?: number;
  promotionCode?: string;
  promotionScore?: number;
  researchContent?: string;
  note?: string;
  members?: { name: string; unit?: string; role?: string; isExternal?: boolean }[];
  requirements?: RequirementSeed[];
};

const PROJECTS: ProjectSeed[] = [
  {
    key: "P1",
    title: "中小制造企业数字化品牌传播的现状与对策研究",
    shortTitle: "中小企业品牌传播",
    code: "MZRK2026-118",
    level: "MUNICIPAL",
    category: "RESEARCH",
    fundingType: "VERTICAL",
    sourceName: "明州市科学技术局",
    hostUnit: "明湖职业技术学院 数字艺术学院",
    status: "ONGOING",
    ownerOrder: 1,
    memberCount: 5,
    startOffset: -186,
    endOffset: 138,
    closingOffset: 24, // → RED
    fundingTotal: 30000,
    promotionCode: "5.2",
    promotionScore: 2,
    researchContent:
      "调研本地 30 家以上中小制造企业的品牌传播现状，归纳短视频、公众号与展会三类渠道的投入产出，提出可操作的改进建议。",
    members: [
      { name: "方启明", unit: "明湖职业技术学院", role: "主持人" },
      { name: "陈立", unit: "明湖职业技术学院", role: "第一参与人" },
      { name: "周雨桐", unit: "明湖职业技术学院", role: "参与人" },
      { name: "郭岩", unit: "明州恒新智能装备有限公司", role: "企业顾问", isExternal: true },
      { name: "孙敏", unit: "明湖职业技术学院", role: "参与人" },
    ],
    requirements: [
      {
        allowedTypes: ["REPORT"],
        requiredCount: 1,
        rawText:
          "结题时提交研究报告 1 份，正文不少于 1.2 万字，须附不少于 30 家企业的问卷或访谈数据。报告提交前完成查重，重复率不超过 25%。",
        constraints: {
          maxDupRate: 25,
          minWordCount: 12000,
          extra: ["须附不少于 30 家企业的问卷或访谈数据"],
        },
        dueOffset: 24,
      },
      {
        allowedTypes: ["PAPER"],
        requiredCount: 1,
        rawText: "在市级及以上公开出版的学术期刊上发表与本课题相关的研究论文 1 篇，本人须为第一作者或通讯作者，并标注本项目编号。",
        constraints: { minLevel: "MUNICIPAL", authorPosition: 1, extra: ["须标注项目编号 MZRK2026-118"] },
      },
      {
        allowedTypes: ["CASE"],
        requiredCount: 1,
        rawText: "提交企业应用案例 1 项，须附合作企业盖章的应用证明，说明成果在企业实际生产经营中的使用情况与成效。",
        constraints: { extra: ["须附合作企业盖章的应用证明"] },
      },
    ],
  },
  {
    key: "P2",
    title: "电子信息类专业“岗课赛证”融通人才培养模式的改革与实践",
    shortTitle: "岗课赛证融通改革",
    code: "JG2025-0642",
    level: "PROVINCIAL",
    category: "TEACHING_REFORM",
    fundingType: "VERTICAL",
    sourceName: "省教育科学规划领导小组办公室",
    hostUnit: "明湖职业技术学院",
    status: "ONGOING",
    ownerOrder: 2,
    memberCount: 7,
    startOffset: -440,
    endOffset: 288,
    closingOffset: 76, // → ORANGE
    fundingTotal: 50000,
    promotionCode: "4.1",
    promotionScore: 5,
    researchContent:
      "以数字媒体技术专业群为试点，重构课程体系，把行业岗位标准、技能竞赛赛项与 1+X 证书要求映射进课程模块，形成可推广的融通方案。",
    members: [
      { name: "陈立", unit: "明湖职业技术学院", role: "主持人" },
      { name: "方启明", unit: "明湖职业技术学院", role: "第一参与人" },
      { name: "赵行舟", unit: "明湖职业技术学院", role: "参与人" },
      { name: "林嘉禾", unit: "明湖职业技术学院", role: "参与人" },
    ],
    requirements: [
      {
        allowedTypes: ["REPORT"],
        requiredCount: 1,
        rawText: "提交教改研究总报告 1 份，须包含改革方案、实施过程、成效数据与推广情况四个部分。",
        dueOffset: 76,
      },
      {
        allowedTypes: ["PAPER"],
        requiredCount: 2,
        rawText: "公开发表教改论文 2 篇，其中至少 1 篇发表于中文核心期刊，本人须为第一作者。",
        constraints: { authorPosition: 1, extra: ["其中至少 1 篇须为中文核心期刊"] },
      },
      {
        allowedTypes: ["COURSE", "TEXTBOOK"],
        requiredCount: 1,
        rawText: "建成校级及以上在线开放课程 1 门，或出版配套活页式教材 1 部（两者任选其一）。",
      },
      {
        allowedTypes: ["AWARD"],
        requiredCount: 1,
        rawText: "课题组成员在省级及以上教学能力比赛或课程思政竞赛中获奖 1 项。",
        constraints: { minLevel: "PROVINCIAL" },
      },
    ],
  },
  {
    key: "P3",
    title: "面向产业数字化转型的高职数字媒体人才能力图谱构建研究",
    shortTitle: "数字媒体人才能力图谱",
    code: "2026JYKT0731",
    level: "PROVINCIAL",
    category: "RESEARCH",
    fundingType: "VERTICAL",
    sourceName: "省教育科学规划领导小组办公室",
    hostUnit: "明湖职业技术学院 数字艺术学院",
    status: "ONGOING",
    ownerOrder: 1,
    memberCount: 6,
    startOffset: -87,
    endOffset: 643,
    closingOffset: 594, // → YELLOW
    fundingTotal: 80000,
    promotionCode: "5.2",
    promotionScore: 4,
    researchContent:
      "通过岗位调研与招聘文本分析，构建覆盖内容生产、交互设计、数据素养三个维度的能力图谱，并给出与课程体系的对照表。",
    members: [
      { name: "方启明", unit: "明湖职业技术学院", role: "主持人" },
      { name: "吴博文", unit: "明湖职业技术学院", role: "第一参与人" },
      { name: "孙敏", unit: "明湖职业技术学院", role: "参与人" },
    ],
    requirements: [
      {
        allowedTypes: ["REPORT"],
        requiredCount: 1,
        rawText: "提交研究总报告 1 份，字数不少于 3 万字，须附调研问卷原始数据与访谈记录。",
        constraints: { minWordCount: 30000, extra: ["须附调研问卷原始数据与访谈记录"] },
      },
      {
        allowedTypes: ["PAPER"],
        requiredCount: 2,
        rawText: "在省级及以上学术期刊公开发表论文 2 篇，须标注省教育科学规划课题编号。",
        constraints: { minLevel: "PROVINCIAL", extra: ["须标注课题编号 2026JYKT0731"] },
      },
      {
        allowedTypes: ["SOFTWARE_COPYRIGHT"],
        requiredCount: 1,
        rawText: "开发能力图谱可视化查询工具 1 套并取得软件著作权登记证书。",
      },
      {
        allowedTypes: ["CASE"],
        requiredCount: 1,
        rawText: "形成不少于 1 个专业的能力图谱应用案例，须有试点院校或企业出具的应用证明。",
      },
    ],
  },
  {
    key: "P4",
    title: "混合式教学背景下《三维动画设计》课程形成性评价体系建设",
    shortTitle: "三维动画形成性评价",
    code: "MHJY2025-31",
    level: "SCHOOL",
    category: "EDU_RESEARCH",
    fundingType: "VERTICAL",
    sourceName: "明湖职业技术学院",
    hostUnit: "明湖职业技术学院 数字艺术学院",
    status: "ONGOING",
    ownerOrder: 1,
    memberCount: 3,
    startOffset: -349,
    endOffset: 127,
    closingOffset: 127, // 要求全达标 → GREEN
    fundingTotal: 5000,
    promotionCode: "4.1",
    promotionScore: 1,
    researchContent: "把课堂过程性表现、阶段作品与自评互评纳入评分，替代原来一次期末大作业定成绩的做法。",
    members: [
      { name: "方启明", unit: "明湖职业技术学院", role: "主持人" },
      { name: "周雨桐", unit: "明湖职业技术学院", role: "参与人" },
    ],
    requirements: [
      {
        allowedTypes: ["REPORT"],
        requiredCount: 1,
        rawText: "提交结题报告 1 份，须附形成性评价量规表与两个学期的实施数据对比。",
      },
      {
        allowedTypes: ["PAPER"],
        requiredCount: 1,
        rawText: "公开发表教研论文 1 篇。",
      },
    ],
  },
  {
    key: "P5",
    title: "恒新智能装备产品数字孪生展示系统视觉设计与交互开发",
    shortTitle: "数字孪生展示系统",
    code: "HX-2026-007",
    level: "INDUSTRY",
    category: "RESEARCH",
    fundingType: "HORIZONTAL",
    sourceName: "明州恒新智能装备有限公司",
    hostUnit: "明湖职业技术学院 数字艺术学院",
    status: "ONGOING",
    ownerOrder: 1,
    memberCount: 4,
    startOffset: -153,
    endOffset: 212,
    closingOffset: 66, // → ORANGE
    fundingTotal: 200000,
    fundingReceived: 100000,
    promotionCode: "5.3",
    promotionScore: 8,
    researchContent:
      "为甲方三条主力产品线建设数字孪生展示系统的视觉与交互部分，交付可在展厅大屏与移动端运行的完整前端。",
    note: "合同约定研发经费共计人民币贰拾万元整，分两期支付；首期已到账 10 万元。",
    members: [
      { name: "方启明", unit: "明湖职业技术学院", role: "项目负责人" },
      { name: "吴博文", unit: "明湖职业技术学院", role: "技术负责人" },
      { name: "郭岩", unit: "明州恒新智能装备有限公司", role: "甲方对接人", isExternal: true },
      { name: "何蔚", unit: "明州恒新智能装备有限公司", role: "甲方技术", isExternal: true },
    ],
    requirements: [
      {
        // 到账经费只对横向课题开放（lib/requirement-types.ts）
        allowedTypes: ["FUNDING_RECEIPT"],
        requiredCount: 2,
        rawText:
          "合同第四条：研发经费共计人民币贰拾万元整（￥200,000.00），分两期支付。合同签订后 10 个工作日内支付首期款 10 万元；系统通过甲方验收后 30 日内支付尾款 10 万元。",
        constraints: { extra: ["以财务到账凭证为准，合同金额不作为验收依据"] },
        dueOffset: 66,
      },
      {
        allowedTypes: ["SOFTWARE_COPYRIGHT"],
        requiredCount: 1,
        rawText: "交付成果须取得软件著作权登记证书 1 项，著作权人为乙方。",
      },
      {
        allowedTypes: ["REPORT"],
        requiredCount: 1,
        rawText: "提交项目技术总结报告 1 份，含系统架构说明、接口文档与运维交接清单。",
      },
    ],
  },
  {
    key: "P6",
    title: "职业院校学分银行建设中的学习成果认定机制研究",
    shortTitle: "学分银行成果认定",
    level: "PROVINCIAL",
    category: "EDU_RESEARCH",
    fundingType: "VERTICAL",
    sourceName: "省教育科学规划领导小组办公室",
    hostUnit: "明湖职业技术学院",
    status: "APPLYING",
    ownerOrder: 1,
    memberCount: 5,
    applyDeadlineOffset: 64, // → BLUE
    researchContent: "梳理学分银行中非学历学习成果的认定标准与转换流程，形成一份可在二级学院试行的认定细则。",
    note: "申报书已完成第三稿，等待学院科研处汇总盖章。",
  },
  {
    key: "P7",
    title: "区域文创产业数字化传播效能评估指标体系研究",
    shortTitle: "文创传播效能评估",
    code: "MSKL2026-0234",
    level: "MUNICIPAL",
    category: "RESEARCH",
    fundingType: "VERTICAL",
    sourceName: "明州市社会科学界联合会",
    hostUnit: "明湖职业技术学院 数字艺术学院",
    status: "ONGOING",
    ownerOrder: 1,
    memberCount: 4,
    startOffset: -38,
    endOffset: 692,
    fundingTotal: 10000,
    // 一条要求都不录 → UNSET
    note: "立项通知只写了「结题要求见任务书」，任务书还没发下来，故暂无要求项。",
  },
  {
    key: "P8",
    title: "短视频创作赋能乡村文旅品牌传播的实践研究",
    shortTitle: "短视频赋能乡村文旅",
    code: "MSKL2024-0189",
    level: "MUNICIPAL",
    category: "RESEARCH",
    fundingType: "VERTICAL",
    sourceName: "明州市社会科学界联合会",
    hostUnit: "明湖职业技术学院 数字艺术学院",
    status: "CLOSED",
    ownerOrder: 1,
    memberCount: 5,
    startOffset: -862,
    endOffset: -227,
    closingOffset: -240,
    fundingTotal: 20000,
    promotionCode: "5.2",
    promotionScore: 2,
    note: "已结题，结题证书编号 MSKL结字〔2025〕第 073 号。该成果次年获校级突出成果奖励。",
    members: [
      { name: "方启明", unit: "明湖职业技术学院", role: "主持人" },
      { name: "周雨桐", unit: "明湖职业技术学院", role: "第一参与人" },
    ],
    requirements: [
      {
        allowedTypes: ["REPORT"],
        requiredCount: 1,
        rawText: "提交研究报告 1 份，字数不少于 1 万字。",
        constraints: { minWordCount: 10000 },
      },
      {
        allowedTypes: ["PAPER"],
        requiredCount: 1,
        rawText: "公开发表相关论文 1 篇。",
      },
    ],
  },
  {
    key: "P9",
    title: "职业院校数字艺术专业群产教融合共同体建设机制研究",
    shortTitle: "产教融合共同体机制",
    level: "PROVINCIAL",
    category: "EDU_RESEARCH",
    fundingType: "VERTICAL",
    sourceName: "省教育科学规划领导小组办公室",
    hostUnit: "明湖职业技术学院",
    status: "REJECTED",
    ownerOrder: 1,
    memberCount: 6,
    applyDeadlineOffset: -153,
    note: "未获立项。绩效上仍计基本分 3 分——「未获立项」与「立项后终止」不是一回事，分值也不同。",
  },
];

async function seedProjects(
  sources: Map<string, string>,
  promotions: Map<string, string>,
) {
  const projects = new Map<string, { id: string; requirementIds: string[] }>();

  for (const seed of PROJECTS) {
    const project = await prisma.project.create({
      data: {
        title: seed.title,
        shortTitle: seed.shortTitle,
        code: seed.code ?? null,
        level: seed.level,
        category: seed.category,
        fundingType: seed.fundingType,
        sourceId: sources.get(seed.sourceName) ?? null,
        hostUnit: seed.hostUnit ?? null,
        role: seed.role ?? "LEAD",
        status: seed.status,
        ownerOrder: seed.ownerOrder ?? null,
        memberCount: seed.memberCount ?? null,
        applyDeadline: seed.applyDeadlineOffset != null ? offsetDate(seed.applyDeadlineOffset) : null,
        startDate: seed.startOffset != null ? offsetDate(seed.startOffset) : null,
        endDate: seed.endOffset != null ? offsetDate(seed.endOffset) : null,
        closingDeadline: seed.closingOffset != null ? offsetDate(seed.closingOffset) : null,
        fundingTotal: seed.fundingTotal ?? null,
        fundingReceived: seed.fundingReceived ?? null,
        promotionCategoryId: seed.promotionCode ? (promotions.get(seed.promotionCode) ?? null) : null,
        promotionScore: seed.promotionScore ?? null,
        researchContent: seed.researchContent ?? null,
        note: seed.note ?? null,
        members: seed.members
          ? {
              create: seed.members.map((m, index) => ({
                name: m.name,
                unit: m.unit ?? null,
                role: m.role ?? null,
                isExternal: m.isExternal ?? false,
                sortOrder: index * 10,
              })),
            }
          : undefined,
      },
    });

    const requirementIds: string[] = [];
    for (const [index, req] of (seed.requirements ?? []).entries()) {
      const row = await prisma.requirement.create({
        data: {
          projectId: project.id,
          allowedTypes: req.allowedTypes,
          requiredCount: req.requiredCount,
          rawText: req.rawText,
          constraints: req.constraints ?? {},
          dueDate: req.dueOffset != null ? offsetDate(req.dueOffset) : null,
          sortOrder: index * 10,
        },
      });
      requirementIds.push(row.id);
    }

    projects.set(seed.key, { id: project.id, requirementIds });
  }

  return projects;
}

// ─── 成果 ────────────────────────────────────────────────────────────
//
// 刻意让四个正交维度各自散开（CLAUDE.md 第 11 条）：
//   · 有绩效分类没职称指标的（培训、讲座、媒体报道）——职称口径下用不上
//   · 有职称指标没绩效分类的
//   · datePrecision 五档全出现，好让「2024年下半年」这类原文在界面上现形
//   · isVerified=false 的若干条，撑起「待核实」那个 tab

type AchievementSeed = {
  key: string;
  type:
    | "PAPER" | "REPORT" | "TEXTBOOK" | "CASE" | "PATENT" | "SOFTWARE_COPYRIGHT" | "AWARD"
    | "COURSE" | "STUDENT_ACHIEVEMENT" | "MEDIA_REPORT" | "FUNDING_RECEIPT" | "TRAINING"
    | "SOCIAL_SERVICE" | "OTHER";
  title: string;
  status:
    | "PLANNED" | "TITLED" | "WRITING" | "DRAFTED" | "CHECKING" | "SUBMITTED" | "UNDER_REVIEW"
    | "REVISING" | "ACCEPTED" | "PUBLISHED" | "INDEXED" | "REJECTED" | "SHELVED";
  level?: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL" | "DISTRICT" | "SCHOOL" | "COLLEGE" | "INDUSTRY" | "UNRATED";
  authorPosition?: number;
  ownerRole?: string;
  journalName?: string;
  journalLevel?: "NATIONAL" | "PROVINCIAL" | "MUNICIPAL" | "SCHOOL";
  indexedBy?: string;
  wordCount?: number;
  /** 见刊 / 授权 / 获奖日，相对今天的偏移 */
  publishedOffset?: number;
  completedOffset?: number;
  dateText?: string;
  datePrecision?: "DAY" | "MONTH" | "YEAR" | "RANGE" | "UNKNOWN";
  tags?: string[];
  perfMinor?: string;
  promotionCode?: string;
  promotionScore?: number;
  baseScore?: number;
  perfScore?: number;
  declaredScore?: number;
  year?: number;
  declareNature?: "PROCESS" | "RESULT";
  stage?: string;
  usableFor?: ("PERFORMANCE" | "PROMOTION" | "PROJECT_CLOSING")[];
  isVerified?: boolean;
  isTeamProject?: boolean;
  teamNote?: string;
  evidenceRef?: string;
  note?: string;
};

const ACHIEVEMENTS: AchievementSeed[] = [
  // ── 论文 ──
  {
    key: "A1", type: "PAPER", status: "PUBLISHED",
    title: "中小制造企业短视频品牌传播策略研究",
    level: "PROVINCIAL", authorPosition: 1, ownerRole: "第一作者",
    journalName: "职业技术教育研究", journalLevel: "PROVINCIAL", indexedBy: "CNKI",
    publishedOffset: -52, datePrecision: "DAY",
    tags: ["AI教育方向", "产教融合"], perfMinor: "学术论文发表", promotionCode: "5.1",
    promotionScore: 2, baseScore: 6, perfScore: 6, declaredScore: 6, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A2", type: "PAPER", status: "PUBLISHED",
    title: "“岗课赛证”融通视角下数字媒体专业课程体系的重构路径",
    level: "NATIONAL", authorPosition: 1, ownerRole: "第一作者",
    journalName: "中国职业技术教育", journalLevel: "NATIONAL", indexedBy: "中文核心",
    publishedOffset: -118, datePrecision: "DAY",
    tags: ["课程建设", "产教融合"], perfMinor: "学术论文发表", promotionCode: "4.2",
    promotionScore: 4, baseScore: 12, perfScore: 12, declaredScore: 12, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A3", type: "PAPER", status: "PUBLISHED",
    title: "产业数字化转型背景下高职数字媒体人才能力结构研究",
    level: "PROVINCIAL", authorPosition: 1, ownerRole: "通讯作者",
    journalName: "现代职业教育", journalLevel: "PROVINCIAL", indexedBy: "CNKI",
    publishedOffset: -24, datePrecision: "DAY",
    tags: ["数字媒体方向"], perfMinor: "学术论文发表", promotionCode: "5.1",
    promotionScore: 2, baseScore: 6, perfScore: 6, declaredScore: 6, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A4", type: "PAPER", status: "PUBLISHED",
    title: "混合式教学中形成性评价的实施困境与改进策略",
    level: "PROVINCIAL", authorPosition: 1, ownerRole: "第一作者",
    journalName: "教育教学论坛", journalLevel: "PROVINCIAL",
    publishedOffset: -201, datePrecision: "DAY",
    tags: ["课程建设"], perfMinor: "学术论文发表", promotionCode: "4.2",
    promotionScore: 2, baseScore: 6, perfScore: 6, declaredScore: 6, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A5", type: "PAPER", status: "PUBLISHED",
    title: "短视频赋能乡村文旅品牌传播的实践路径与效能评估",
    level: "MUNICIPAL", authorPosition: 1, ownerRole: "第一作者",
    journalName: "明州职业技术学院学报", journalLevel: "MUNICIPAL",
    dateText: `${YEAR - 1}年下半年`, datePrecision: "MONTH", publishedOffset: -318,
    tags: ["数字媒体方向"], perfMinor: "学术论文发表", promotionCode: "5.1",
    promotionScore: 1, baseScore: 3, perfScore: 3, declaredScore: 3, year: YEAR - 1,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A6", type: "PAPER", status: "ACCEPTED",
    title: "数字孪生技术在职业教育实训场景中的应用综述",
    level: "PROVINCIAL", authorPosition: 1, ownerRole: "第一作者",
    journalName: "工业技术与职业教育", journalLevel: "PROVINCIAL",
    completedOffset: -33, dateText: "已收到录用通知，尚未安排刊期", datePrecision: "UNKNOWN",
    tags: ["数字媒体方向"], declareNature: "PROCESS", stage: "已录用待见刊", year: YEAR,
    usableFor: ["PROJECT_CLOSING"], isVerified: true,
    note: "录用通知已归档；按学校口径，论文以见刊为准，本条暂不申报绩效。",
  },
  {
    key: "A7", type: "PAPER", status: "UNDER_REVIEW",
    title: "专业基础课项目化改造的三个误区",
    level: "UNRATED", authorPosition: 1, ownerRole: "第一作者",
    journalName: "职业技术教育", journalLevel: "NATIONAL",
    completedOffset: -19, datePrecision: "UNKNOWN",
    tags: ["课程改革"], declareNature: "PROCESS", stage: "外审中", year: YEAR,
    isVerified: true,
  },
  {
    key: "A8", type: "PAPER", status: "REVISING",
    title: "AIGC 工具介入设计基础课程的教学实验研究",
    level: "UNRATED", authorPosition: 1, ownerRole: "第一作者",
    journalName: "装饰", journalLevel: "NATIONAL", indexedBy: "中文核心",
    completedOffset: -61, datePrecision: "UNKNOWN",
    tags: ["AI教育方向", "课程建设"], declareNature: "PROCESS", stage: "修回中（第二轮）", year: YEAR,
    isVerified: true, note: "审稿意见要求补充对照班数据，已重新采集。",
  },
  {
    key: "A9", type: "PAPER", status: "SUBMITTED",
    title: "面向产教融合的双师型教师能力评价指标构建",
    level: "UNRATED", authorPosition: 2, ownerRole: "第二作者",
    journalName: "教育与职业", journalLevel: "NATIONAL",
    completedOffset: -12, datePrecision: "UNKNOWN",
    tags: ["产教融合"], declareNature: "PROCESS", stage: "已投稿", year: YEAR,
    isVerified: false,
  },
  {
    key: "A10", type: "PAPER", status: "WRITING",
    title: "职业院校专业群建设中的资源配置逻辑",
    level: "UNRATED", ownerRole: "第一作者",
    datePrecision: "UNKNOWN", tags: ["产教融合"],
    declareNature: "PROCESS", stage: "写作中（约完成六成）", year: YEAR, isVerified: false,
  },
  {
    key: "A11", type: "PAPER", status: "PLANNED",
    title: "生成式AI背景下设计类专业人才培养的再定位",
    level: "UNRATED", datePrecision: "UNKNOWN", tags: ["AI教育方向"],
    declareNature: "PROCESS", stage: "选题", year: YEAR, isVerified: false,
  },
  {
    key: "A12", type: "PAPER", status: "REJECTED",
    title: "短视频平台算法推荐对乡村形象建构的影响",
    level: "UNRATED", authorPosition: 1, journalName: "新闻界", journalLevel: "NATIONAL",
    completedOffset: -140, datePrecision: "MONTH", dateText: `${YEAR}年三月`,
    tags: ["数字媒体方向"], declareNature: "PROCESS", stage: "已退稿，拟改投", isVerified: false,
  },

  // ── 研究报告 ──
  {
    key: "A13", type: "REPORT", status: "PUBLISHED",
    title: "短视频赋能乡村文旅品牌传播研究结题报告",
    level: "MUNICIPAL", ownerRole: "执笔人", wordCount: 13200,
    publishedOffset: -240, datePrecision: "DAY",
    tags: ["数字媒体方向"], perfMinor: "纵向科研项目结题",
    baseScore: 2, perfScore: 5, declaredScore: 5, year: YEAR - 1,
    usableFor: ["PERFORMANCE", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A14", type: "REPORT", status: "PUBLISHED",
    title: "明州市智能制造产业人才需求调研报告",
    level: "MUNICIPAL", ownerRole: "负责人", wordCount: 24800,
    dateText: `${YEAR}年上半年`, datePrecision: "MONTH", publishedOffset: -96,
    tags: ["产教融合"], perfMinor: "参与行业标准制定", promotionCode: "6.1",
    promotionScore: 1, perfScore: 5, declaredScore: 5, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: false,
    note: "市工信局采纳情况证明尚未开具，待核实后再确定级别。",
  },
  {
    key: "A15", type: "REPORT", status: "PUBLISHED",
    title: "数字艺术学院专业建设年度自评报告",
    level: "COLLEGE", ownerRole: "执笔人", wordCount: 9600,
    dateText: `${YEAR - 1}年`, datePrecision: "YEAR",
    tags: ["专业建设"],
    // 绩效小类和职称指标都空着：这条既没归类也没核实，正是「待核实」队列的典型
    year: YEAR - 1, usableFor: [], isVerified: false,
  },

  // ── 教材 ──
  {
    key: "A16", type: "TEXTBOOK", status: "PUBLISHED",
    title: "《三维动画设计与制作》（活页式教材）",
    level: "PROVINCIAL", ownerRole: "主编",
    publishedOffset: -76, datePrecision: "DAY",
    tags: ["课程建设"], perfMinor: "活页式（工作手册式）教材开发", promotionCode: "4.3",
    promotionScore: 5, perfScore: 10, declaredScore: 10, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
    evidenceRef: "ISBN 978-7-xxxx-xxxx-x 版权页扫描件",
  },
  {
    key: "A17", type: "TEXTBOOK", status: "PUBLISHED",
    title: "《数字媒体创意设计基础》",
    level: "SCHOOL", ownerRole: "参编（第三，撰写第 4—6 章）",
    dateText: `${YEAR - 2}年—${YEAR - 1}年`, datePrecision: "RANGE",
    tags: ["课程建设"], perfMinor: "编写教材",
    perfScore: 1.6, declaredScore: 1.6, year: YEAR - 1,
    usableFor: ["PERFORMANCE"], isVerified: true,
    note: "参编按字数折算，非主编不计职称分。",
  },

  // ── 知识产权 ──
  {
    key: "A18", type: "PATENT", status: "PUBLISHED",
    title: "一种基于多视角融合的产品展示装置（实用新型）",
    level: "NATIONAL", authorPosition: 1, ownerRole: "第一发明人",
    publishedOffset: -44, datePrecision: "DAY",
    tags: ["数字媒体方向"], perfMinor: "实用新型专利授权", promotionCode: "5.3",
    promotionScore: 1, perfScore: 5, declaredScore: 5, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
    evidenceRef: "专利证书 ZL2026 2 XXXXXXX.X",
  },
  {
    key: "A19", type: "PATENT", status: "UNDER_REVIEW",
    title: "一种面向工业产品的智能配图方法（发明专利）",
    level: "UNRATED", authorPosition: 1, ownerRole: "第一发明人",
    completedOffset: -88, datePrecision: "UNKNOWN",
    tags: ["AI教育方向"], declareNature: "PROCESS", stage: "已受理，实质审查中",
    year: YEAR, isVerified: false, note: "申请受理不计分，授权后再申报。",
  },
  {
    key: "A20", type: "SOFTWARE_COPYRIGHT", status: "PUBLISHED",
    title: "数字媒体人才能力图谱可视化查询系统 V1.0",
    level: "NATIONAL", ownerRole: "第一著作权人",
    publishedOffset: -8, datePrecision: "DAY",
    tags: ["数字媒体方向"], perfMinor: "软件著作权登记", promotionCode: "5.3",
    promotionScore: 0.5, perfScore: 3, declaredScore: 3, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A21", type: "SOFTWARE_COPYRIGHT", status: "PUBLISHED",
    title: "恒新产品数字孪生展示系统前端 V1.0",
    level: "NATIONAL", ownerRole: "第一著作权人",
    publishedOffset: -37, datePrecision: "DAY",
    tags: ["产教融合"], perfMinor: "软件著作权登记", promotionCode: "5.3",
    promotionScore: 0.5, perfScore: 3, declaredScore: 3, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
  },
  {
    key: "A22", type: "SOFTWARE_COPYRIGHT", status: "PUBLISHED",
    title: "课程形成性评价数据采集工具 V1.0",
    level: "NATIONAL", ownerRole: "第一著作权人",
    dateText: `${YEAR - 1}年`, datePrecision: "YEAR",
    tags: ["课程建设"], perfMinor: "软件著作权登记",
    perfScore: 3, declaredScore: 3, year: YEAR - 1,
    usableFor: ["PERFORMANCE"], isVerified: true,
  },

  // ── 到账经费 ──
  {
    key: "A23", type: "FUNDING_RECEIPT", status: "PUBLISHED",
    title: "恒新智能装备横向项目首期研发经费到账（10 万元）",
    level: "INDUSTRY", ownerRole: "项目负责人",
    publishedOffset: -131, datePrecision: "DAY",
    tags: ["产教融合"], perfMinor: "横向技术服务到账经费", promotionCode: "5.3",
    promotionScore: 0.8, perfScore: 5, declaredScore: 5, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
    evidenceRef: "财务到账凭证 JZ-2026-0388",
  },

  // ── 获奖 ──
  {
    key: "A24", type: "AWARD", status: "PUBLISHED",
    title: "省职业院校教师教学能力比赛 三等奖",
    level: "PROVINCIAL", ownerRole: "团队第二",
    publishedOffset: -164, datePrecision: "DAY",
    tags: ["课程建设"], perfMinor: "教师教学能力比赛", promotionCode: "2.3",
    promotionScore: 1.5, perfScore: 12, declaredScore: 6, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
    isTeamProject: true, teamNote: "四人团队，负责人陈立计 0.5，其余三人均分剩余 0.5。",
  },
  {
    key: "A25", type: "AWARD", status: "PUBLISHED",
    title: "校级课程思政教学竞赛 一等奖",
    level: "SCHOOL", ownerRole: "第一完成人",
    publishedOffset: -71, datePrecision: "DAY",
    tags: ["课程建设"], perfMinor: "课程思政教学竞赛", promotionCode: "2.3",
    promotionScore: 1, perfScore: 2, declaredScore: 2, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
  },
  {
    key: "A26", type: "AWARD", status: "PUBLISHED",
    title: "明州市高校微课教学比赛 三等奖",
    level: "MUNICIPAL", ownerRole: "第一完成人",
    dateText: `${YEAR - 1}年十一月`, datePrecision: "MONTH", publishedOffset: -281,
    perfMinor: "微课与信息化教学比赛",
    perfScore: 4, declaredScore: 4, year: YEAR - 1,
    usableFor: ["PERFORMANCE"], isVerified: false,
    note: "获奖证书原件在学院存档，需补扫描件。",
  },
  {
    key: "A27", type: "AWARD", status: "PUBLISHED",
    title: "明湖职业技术学院优秀教师",
    level: "SCHOOL", ownerRole: "本人",
    publishedOffset: -222, datePrecision: "DAY",
    perfMinor: "优秀教师 / 师德标兵", promotionCode: "1.1",
    promotionScore: 2, perfScore: 2, declaredScore: 2, year: YEAR - 1,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
  },
  {
    key: "A28", type: "AWARD", status: "PUBLISHED",
    title: "年度教学质量考核优秀",
    level: "SCHOOL", ownerRole: "本人",
    dateText: `${YEAR - 1}年度`, datePrecision: "YEAR",
    perfMinor: "年度教学质量考核优秀", promotionCode: "2.2",
    promotionScore: 2, perfScore: 5, declaredScore: 5, year: YEAR - 1,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
    note: "学院分配名额，按教学督导评价排序确定。",
  },
  {
    key: "A29", type: "AWARD", status: "PUBLISHED",
    title: "省高等教育教学成果奖 二等奖（第五完成人）",
    level: "PROVINCIAL", authorPosition: 5, ownerRole: "第五完成人",
    dateText: `${YEAR - 2}年`, datePrecision: "YEAR",
    tags: ["产教融合"], perfMinor: "教师教学能力比赛", promotionCode: "4.4",
    promotionScore: 2, perfScore: 12, declaredScore: 2.4, year: YEAR - 2,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
    isTeamProject: true, teamNote: "排名第五，按说明第 3 条排名系数 0.2 折算。",
  },

  // ── 指导学生 ──
  {
    key: "A30", type: "STUDENT_ACHIEVEMENT", status: "PUBLISHED",
    title: "指导学生获全国职业院校技能大赛（移动应用开发赛项）三等奖",
    level: "NATIONAL", ownerRole: "指导教师（第一）",
    publishedOffset: -58, datePrecision: "DAY",
    tags: ["数字媒体方向"], perfMinor: "指导学生学科竞赛获奖", promotionCode: "3.2",
    promotionScore: 5, perfScore: 15, declaredScore: 15, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
  },
  {
    key: "A31", type: "STUDENT_ACHIEVEMENT", status: "PUBLISHED",
    title: "指导学生获省“互联网+”大学生创新创业大赛 银奖",
    level: "PROVINCIAL", ownerRole: "指导教师（第二）",
    publishedOffset: -102, datePrecision: "DAY",
    perfMinor: "指导学生创新创业项目", promotionCode: "3.2",
    promotionScore: 1.5, perfScore: 6, declaredScore: 3, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
  },
  {
    key: "A32", type: "STUDENT_ACHIEVEMENT", status: "PUBLISHED",
    title: "指导学生获省级数字媒体作品大赛 一等奖",
    level: "PROVINCIAL", ownerRole: "指导教师（第一）",
    dateText: `${YEAR}年五月`, datePrecision: "MONTH", publishedOffset: -95,
    perfMinor: "指导学生学科竞赛获奖", promotionCode: "3.2",
    promotionScore: 3, perfScore: 8, declaredScore: 8, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
  },
  {
    key: "A33", type: "STUDENT_ACHIEVEMENT", status: "PUBLISHED",
    title: "指导毕业设计获校级优秀（3 人）",
    level: "SCHOOL", ownerRole: "指导教师",
    dateText: `${YEAR - 1}—${YEAR}学年`, datePrecision: "RANGE",
    perfMinor: "指导毕业设计获优秀",
    perfScore: 3, declaredScore: 3, year: YEAR,
    usableFor: ["PERFORMANCE"], isVerified: false,
  },

  // ── 课程与资源 ──
  {
    key: "A34", type: "COURSE", status: "PUBLISHED",
    title: "《三维动画设计》校级在线开放课程",
    level: "SCHOOL", ownerRole: "课程负责人",
    publishedOffset: -190, datePrecision: "DAY",
    tags: ["课程建设"], perfMinor: "精品在线开放课程", promotionCode: "2.5",
    promotionScore: 2, perfScore: 5, declaredScore: 5, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"], isVerified: true,
    isTeamProject: true, teamNote: "三人团队，负责人计 0.5。",
  },
  {
    key: "A35", type: "COURSE", status: "PUBLISHED",
    title: "《数字影像创作》课程标准修订",
    level: "COLLEGE", ownerRole: "执笔人",
    dateText: `${YEAR}年上半年`, datePrecision: "MONTH", publishedOffset: -120,
    tags: ["课程建设"], perfMinor: "课程标准修订",
    perfScore: 1, declaredScore: 1, year: YEAR,
    usableFor: ["PERFORMANCE"], isVerified: true,
  },

  // ── 培训与社会服务：多数只进绩效，职称口径用不上 ──
  {
    key: "A36", type: "TRAINING", status: "PUBLISHED",
    title: "面向明州恒新智能装备的产品可视化技术培训（2 场）",
    level: "INDUSTRY", ownerRole: "主讲",
    publishedOffset: -66, datePrecision: "DAY",
    tags: ["产教融合"], perfMinor: "面向企业开展技术培训", promotionCode: "6.1",
    promotionScore: 1, perfScore: 20, declaredScore: 20, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
    evidenceRef: "培训协议 + 两场签到表",
  },
  {
    key: "A37", type: "TRAINING", status: "PUBLISHED",
    title: "明州市中小学班主任工作能力提升专题讲座",
    level: "MUNICIPAL", ownerRole: "主讲",
    publishedOffset: -145, datePrecision: "DAY",
    perfMinor: "面向企业开展技术培训",
    perfScore: 10, declaredScore: 10, year: YEAR,
    usableFor: ["PERFORMANCE"], isVerified: true,
  },
  {
    key: "A38", type: "TRAINING", status: "PUBLISHED",
    title: "社区“银发数字生活”公益讲座（3 次）",
    level: "DISTRICT", ownerRole: "主讲",
    dateText: "记不清具体月份，约在上半年", datePrecision: "UNKNOWN",
    perfMinor: "社区公益讲座",
    perfScore: 9, declaredScore: 9, year: YEAR,
    usableFor: ["PERFORMANCE"], isVerified: false,
  },
  {
    key: "A39", type: "SOCIAL_SERVICE", status: "PUBLISHED",
    title: "参与制定明州市《智能制造产业服务规范》地方标准",
    level: "MUNICIPAL", authorPosition: 4, ownerRole: "起草组成员",
    publishedOffset: -83, datePrecision: "DAY",
    tags: ["产教融合"], perfMinor: "参与行业标准制定", promotionCode: "6.2",
    promotionScore: 2, perfScore: 10, declaredScore: 3, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: true,
  },
  {
    key: "A40", type: "SOCIAL_SERVICE", status: "PUBLISHED",
    title: "受聘明州市职业教育教学指导委员会委员",
    level: "MUNICIPAL", ownerRole: "委员",
    dateText: `${YEAR - 1}年—${YEAR + 2}年（聘期）`, datePrecision: "RANGE",
    perfMinor: "优秀共产党员 / 先进工作者", promotionCode: "6.2",
    promotionScore: 1, perfScore: 3, declaredScore: 3, year: YEAR,
    usableFor: ["PERFORMANCE", "PROMOTION"], isVerified: false,
    note: "聘书已收到，绩效小类归属待与科研处确认。",
  },

  // ── 其他 ──
  {
    key: "A41", type: "MEDIA_REPORT", status: "PUBLISHED",
    title: "《明州日报》报道学院产教融合实践",
    level: "MUNICIPAL", ownerRole: "被报道人之一",
    publishedOffset: -29, datePrecision: "DAY",
    tags: ["产教融合"], perfMinor: "其他有价值工作（自定义）",
    perfScore: 2, declaredScore: 2, year: YEAR,
    usableFor: ["PERFORMANCE"], isVerified: true,
  },
  {
    key: "A42", type: "OTHER", status: "PUBLISHED",
    title: "牵头起草《数字艺术专业群建设三年行动方案》",
    level: "COLLEGE", ownerRole: "牵头人",
    dateText: `${YEAR}年第二季度`, datePrecision: "MONTH", publishedOffset: -110,
    tags: ["专业建设"], perfMinor: "其他有价值工作（自定义）",
    perfScore: 5, declaredScore: 5, year: YEAR,
    usableFor: ["PERFORMANCE"], isVerified: false,
  },
];

async function seedAchievements(
  perfs: Map<string, string>,
  promotions: Map<string, string>,
) {
  const map = new Map<string, string>();
  for (const seed of ACHIEVEMENTS) {
    const row = await prisma.achievement.create({
      data: {
        type: seed.type,
        title: seed.title,
        status: seed.status,
        level: seed.level ?? "UNRATED",
        authorPosition: seed.authorPosition ?? null,
        ownerRole: seed.ownerRole ?? null,
        journalName: seed.journalName ?? null,
        journalLevel: seed.journalLevel ?? null,
        indexedBy: seed.indexedBy ?? null,
        wordCount: seed.wordCount ?? null,
        completedAt: seed.completedOffset != null ? offsetDate(seed.completedOffset) : null,
        publishedAt: seed.publishedOffset != null ? offsetDate(seed.publishedOffset) : null,
        dateText: seed.dateText ?? null,
        datePrecision: seed.datePrecision ?? (seed.publishedOffset != null ? "DAY" : "UNKNOWN"),
        tags: seed.tags ?? [],
        evidenceRef: seed.evidenceRef ?? null,
        externalRef: `demo:${seed.key}`,
        isVerified: seed.isVerified ?? false,
        note: seed.note ?? null,
        perfCategoryId: seed.perfMinor ? (perfs.get(seed.perfMinor) ?? null) : null,
        promotionCategoryId: seed.promotionCode ? (promotions.get(seed.promotionCode) ?? null) : null,
        promotionScore: seed.promotionScore ?? null,
        year: seed.year ?? null,
        declareNature: seed.declareNature ?? "RESULT",
        stage: seed.stage ?? null,
        baseScore: seed.baseScore ?? null,
        perfScore: seed.perfScore ?? null,
        declaredScore: seed.declaredScore ?? null,
        isTeamProject: seed.isTeamProject ?? false,
        teamNote: seed.teamNote ?? null,
        usableFor: seed.usableFor ?? [],
      },
    });
    map.set(seed.key, row.id);
  }
  return map;
}

// ─── 挂接 ────────────────────────────────────────────────────────────
//
// isQualified 全部是「人工勾过」的语义（第 1 条铁律：系统永远不自动判定）。
// 故意留了几条挂上但没勾的——那正是界面要表达的「挂接 ≠ 达标」。

type LinkSeed = {
  project: string;
  /** 要求项在该课题内的序号 */
  index: number;
  achievement: string;
  qualified: boolean;
  qualifyNote?: string;
};

const LINKS: LinkSeed[] = [
  { project: "P1", index: 1, achievement: "A1", qualified: true, qualifyNote: "已见刊，标注了项目编号，符合“市级及以上、第一作者”。" },
  { project: "P2", index: 1, achievement: "A2", qualified: true, qualifyNote: "中文核心，满足“至少 1 篇核心”的要求。" },
  { project: "P2", index: 2, achievement: "A16", qualified: false },
  { project: "P2", index: 3, achievement: "A24", qualified: true, qualifyNote: "省级二等奖，证书已归档。" },
  { project: "P3", index: 1, achievement: "A3", qualified: true, qualifyNote: "已见刊并标注课题编号，还差 1 篇。" },
  { project: "P3", index: 2, achievement: "A20", qualified: false, qualifyNote: "证书已下发，但系统功能尚未按验收口径补齐，暂不勾达标。" },
  { project: "P4", index: 1, achievement: "A4", qualified: true },
  { project: "P5", index: 0, achievement: "A23", qualified: true, qualifyNote: "首期 10 万元到账凭证已归档；尾款待验收后支付。" },
  { project: "P5", index: 1, achievement: "A21", qualified: true },
  { project: "P8", index: 0, achievement: "A13", qualified: true },
  { project: "P8", index: 1, achievement: "A5", qualified: true },
  // 挂上但不勾：录用通知不等于见刊
  { project: "P3", index: 1, achievement: "A6", qualified: false, qualifyNote: "仅录用，尚未见刊，按结题口径不能计入。" },
];

async function seedLinks(
  projects: Map<string, { id: string; requirementIds: string[] }>,
  achievements: Map<string, string>,
) {
  let count = 0;
  for (const link of LINKS) {
    const project = projects.get(link.project);
    const achievementId = achievements.get(link.achievement);
    const requirementId = project?.requirementIds[link.index];
    if (!project || !achievementId || !requirementId) continue;

    await prisma.requirementLink.create({
      data: {
        requirementId,
        achievementId,
        isQualified: link.qualified,
        qualifiedAt: link.qualified ? offsetDate(-14) : null,
        qualifyNote: link.qualifyNote ?? null,
      },
    });
    count += 1;
  }
  return count;
}

// ─── 附件 ────────────────────────────────────────────────────────────
//
// 归属四选一由数据库 CHECK 锁死，这里每条只给一个归属字段。

type AttachmentSeed = {
  key: string;
  owner:
    | { kind: "project"; project: string }
    | { kind: "achievement"; achievement: string }
    | { kind: "doc"; category: string };
  attachmentKind:
    | "PROPOSAL" | "APPROVAL" | "CONTRACT" | "MIDTERM" | "FINAL_REPORT" | "CERTIFICATE"
    | "AWARD_CERTIFICATE" | "ACCEPTANCE" | "PUBLICATION" | "INDEX_PROOF" | "CHECK_REPORT"
    | "REFERENCE" | "PROCESS_EVIDENCE" | "TEACHING_PLAN" | "OTHER";
  filename: string;
  code?: string;
  note?: string;
  uploadedOffset: number;
};

const ATTACHMENTS: AttachmentSeed[] = [
  // 课题材料
  { key: "F1", owner: { kind: "project", project: "P1" }, attachmentKind: "APPROVAL", filename: "明州市软科学项目立项通知.pdf", code: "1-1", uploadedOffset: -180 },
  { key: "F2", owner: { kind: "project", project: "P1" }, attachmentKind: "PROPOSAL", filename: "项目申报书（终稿）.pdf", code: "1-2", uploadedOffset: -195 },
  { key: "F3", owner: { kind: "project", project: "P1" }, attachmentKind: "FINAL_REPORT", filename: "研究报告（送审稿）.pdf", code: "1-3", note: "1.7 万字，实证部分占 56%", uploadedOffset: -9 },
  { key: "F4", owner: { kind: "project", project: "P1" }, attachmentKind: "CHECK_REPORT", filename: "研究报告查重报告（重复率12.4%）.pdf", code: "1-4", uploadedOffset: -8 },
  { key: "F5", owner: { kind: "project", project: "P1" }, attachmentKind: "PROCESS_EVIDENCE", filename: "企业调研照片与访谈记录.pdf", code: "1-5", uploadedOffset: -120 },
  { key: "F6", owner: { kind: "project", project: "P2" }, attachmentKind: "APPROVAL", filename: "省教改课题立项文件.pdf", code: "2-1", uploadedOffset: -430 },
  { key: "F7", owner: { kind: "project", project: "P2" }, attachmentKind: "MIDTERM", filename: "中期检查报告及专家意见.pdf", code: "2-2", uploadedOffset: -150 },
  { key: "F8", owner: { kind: "project", project: "P4" }, attachmentKind: "FINAL_REPORT", filename: "形成性评价体系结题报告.pdf", code: "4-1", uploadedOffset: -21 },
  { key: "F9", owner: { kind: "project", project: "P4" }, attachmentKind: "PROCESS_EVIDENCE", filename: "两学期实施数据对比表.pdf", code: "4-2", uploadedOffset: -21 },
  { key: "F10", owner: { kind: "project", project: "P5" }, attachmentKind: "CONTRACT", filename: "恒新智能装备技术开发合同（盖章）.pdf", code: "5-1", uploadedOffset: -152 },
  { key: "F11", owner: { kind: "project", project: "P5" }, attachmentKind: "OTHER", filename: "首期研发经费到账凭证.pdf", code: "5-2", uploadedOffset: -130 },
  { key: "F12", owner: { kind: "project", project: "P8" }, attachmentKind: "CERTIFICATE", filename: "结题证书（MSKL结字〔2025〕073号）.pdf", code: "8-1", uploadedOffset: -235 },
  { key: "F13", owner: { kind: "project", project: "P8" }, attachmentKind: "FINAL_REPORT", filename: "结题研究报告（定稿）.pdf", code: "8-2", uploadedOffset: -241 },

  // 成果材料
  { key: "F14", owner: { kind: "achievement", achievement: "A1" }, attachmentKind: "PUBLICATION", filename: "论文见刊页扫描件.pdf", uploadedOffset: -50 },
  { key: "F15", owner: { kind: "achievement", achievement: "A2" }, attachmentKind: "PUBLICATION", filename: "中国职业技术教育见刊页.pdf", uploadedOffset: -115 },
  { key: "F16", owner: { kind: "achievement", achievement: "A6" }, attachmentKind: "ACCEPTANCE", filename: "录用通知.pdf", uploadedOffset: -32 },
  { key: "F17", owner: { kind: "achievement", achievement: "A16" }, attachmentKind: "OTHER", filename: "教材版权页与目录.pdf", uploadedOffset: -74 },
  { key: "F18", owner: { kind: "achievement", achievement: "A18" }, attachmentKind: "CERTIFICATE", filename: "实用新型专利证书.pdf", uploadedOffset: -42 },
  { key: "F19", owner: { kind: "achievement", achievement: "A21" }, attachmentKind: "CERTIFICATE", filename: "软件著作权登记证书.pdf", uploadedOffset: -35 },
  { key: "F20", owner: { kind: "achievement", achievement: "A24" }, attachmentKind: "AWARD_CERTIFICATE", filename: "省教学能力比赛获奖证书.pdf", uploadedOffset: -160 },
  { key: "F21", owner: { kind: "achievement", achievement: "A30" }, attachmentKind: "AWARD_CERTIFICATE", filename: "全国技能大赛指导教师证书.pdf", uploadedOffset: -55 },
  { key: "F22", owner: { kind: "achievement", achievement: "A23" }, attachmentKind: "OTHER", filename: "财务到账凭证JZ-2026-0388.pdf", uploadedOffset: -129 },

  // 个人常用文档
  { key: "F23", owner: { kind: "doc", category: "人才培养方案" }, attachmentKind: "REFERENCE", filename: "数字媒体技术专业人才培养方案.pdf", uploadedOffset: -300 },
  { key: "F24", owner: { kind: "doc", category: "人才培养方案" }, attachmentKind: "REFERENCE", filename: "动漫制作技术专业人才培养方案.pdf", uploadedOffset: -299 },
  { key: "F25", owner: { kind: "doc", category: "课程标准" }, attachmentKind: "REFERENCE", filename: "三维动画设计课程标准.pdf", uploadedOffset: -210 },
  { key: "F26", owner: { kind: "doc", category: "申报参考" }, attachmentKind: "REFERENCE", filename: "往年省教改课题优秀申报书样例.pdf", uploadedOffset: -260 },
  { key: "F27", owner: { kind: "doc", category: "制度文件" }, attachmentKind: "REFERENCE", filename: "业绩量化考核赋分细则（修订版）.pdf", uploadedOffset: -190 },
];

async function seedAttachments(
  projects: Map<string, { id: string; requirementIds: string[] }>,
  achievements: Map<string, string>,
  docCategories: Map<string, string>,
) {
  const map = new Map<string, string>();

  for (const seed of ATTACHMENTS) {
    const storagePath = `demo/${seed.key}.pdf`;
    const written = await writeDemoFile(storagePath, seed.filename);

    const owner = seed.owner;
    const row = await prisma.attachment.create({
      data: {
        projectId: owner.kind === "project" ? (projects.get(owner.project)?.id ?? null) : null,
        achievementId: owner.kind === "achievement" ? (achievements.get(owner.achievement) ?? null) : null,
        docCategoryId: owner.kind === "doc" ? (docCategories.get(owner.category) ?? null) : null,
        kind: seed.attachmentKind,
        code: seed.code ?? null,
        filename: seed.filename,
        storagePath,
        size: written?.size ?? 1024,
        mimeType: "application/pdf",
        note: seed.note ?? null,
        uploadedAt: offsetDateTime(seed.uploadedOffset, 10, 30),
      },
    });
    map.set(seed.key, row.id);
  }

  return map;
}

/**
 * 课题材料 → 结题要求项的关联（增量 3.1）。
 *
 * 这是 lib/gap.ts 的**第二条达标来源**：P1 的研究报告和 P4 的结题报告都不是
 * Achievement，它们是课题过程产出，走材料这条路达标。关联入口只有结题清单一处。
 */
async function seedRequirementMaterials(
  projects: Map<string, { id: string; requirementIds: string[] }>,
  attachments: Map<string, string>,
) {
  const rows: { project: string; index: number; file: string; qualified: boolean; note?: string; qualifyNote?: string }[] = [
    { project: "P1", index: 0, file: "F3", qualified: true, note: "正文即本条要求的研究报告", qualifyNote: "1.7 万字达标，实证篇幅 56% 达标。" },
    { project: "P1", index: 0, file: "F4", qualified: false, note: "查重报告，佐证重复率 12.4% < 25%" },
    { project: "P4", index: 0, file: "F8", qualified: true, qualifyNote: "含量规表与两学期数据对比，符合要求。" },
    { project: "P4", index: 0, file: "F9", qualified: false, note: "实施数据附件" },
    { project: "P8", index: 0, file: "F13", qualified: false, note: "结题报告定稿（成果侧已挂接并勾达标）" },
  ];

  let count = 0;
  for (const row of rows) {
    const requirementId = projects.get(row.project)?.requirementIds[row.index];
    const attachmentId = attachments.get(row.file);
    if (!requirementId || !attachmentId) continue;

    await prisma.requirementAttachment.create({
      data: {
        requirementId,
        attachmentId,
        note: row.note ?? null,
        isQualified: row.qualified,
        qualifiedAt: row.qualified ? offsetDate(-7) : null,
        qualifyNote: row.qualifyNote ?? null,
      },
    });
    count += 1;
  }
  return count;
}

// ─── 课题绩效事实与学校奖励 ──────────────────────────────────────────
//
// 课题的立项 / 到账 / 结题走 ProjectPerformanceEvent，**不派生成果副本**
// （CLAUDE.md 第 11 条）。线上绩效库把立项和结题各记一条「成果」，那是绩效
// 口径的记法；职称口径下一个课题只有一行，挂在 Project 自己身上。

async function seedPerformanceEvents(
  projects: Map<string, { id: string; requirementIds: string[] }>,
  perfs: Map<string, string>,
) {
  const rows: {
    project: string;
    kind: "APPLY" | "APPROVED" | "FUNDING" | "CLOSEOUT" | "OTHER";
    year: number;
    offset?: number;
    dateText?: string;
    precision?: "DAY" | "MONTH" | "YEAR" | "RANGE" | "UNKNOWN";
    perfMinor?: string;
    base?: number;
    perf?: number;
    declared?: number;
    verified?: boolean;
    note?: string;
  }[] = [
    { project: "P1", kind: "APPROVED", year: YEAR, offset: -186, precision: "DAY", perfMinor: "纵向科研项目立项", base: 3, perf: 8, declared: 11, verified: true, note: "市级纵向立项：基本分 3 + 级别分 8。" },
    { project: "P2", kind: "APPROVED", year: YEAR - 1, offset: -440, precision: "DAY", perfMinor: "教改项目立项", base: 3, perf: 12, declared: 15, verified: true },
    { project: "P3", kind: "APPROVED", year: YEAR, offset: -87, precision: "DAY", perfMinor: "纵向科研项目立项", base: 3, perf: 15, declared: 18, verified: true },
    { project: "P4", kind: "APPROVED", year: YEAR - 1, offset: -349, precision: "DAY", perfMinor: "教改项目立项", base: 3, perf: 3, declared: 6, verified: true },
    { project: "P5", kind: "FUNDING", year: YEAR, offset: -131, precision: "DAY", perfMinor: "横向技术服务到账经费", perf: 5, declared: 5, verified: true, note: "首期到账 10 万元 × 0.5 分/万元 = 5 分。" },
    { project: "P7", kind: "APPROVED", year: YEAR, offset: -38, precision: "DAY", perfMinor: "纵向科研项目立项", base: 3, perf: 8, declared: 11, verified: false, note: "立项文件已下发，绩效小类待与科研处核对。" },
    { project: "P8", kind: "CLOSEOUT", year: YEAR - 1, offset: -240, precision: "DAY", perfMinor: "纵向科研项目结题", base: 2, perf: 5, declared: 7, verified: true },
    { project: "P9", kind: "APPLY", year: YEAR, dateText: `${YEAR}年三月`, precision: "MONTH", offset: -153, perfMinor: "纵向科研项目立项", base: 3, declared: 3, verified: true, note: "未获立项，只计基本分 3——与「立项后终止」不是一回事。" },
  ];

  let count = 0;
  for (const row of rows) {
    const projectId = projects.get(row.project)?.id;
    if (!projectId) continue;
    await prisma.projectPerformanceEvent.create({
      data: {
        projectId,
        kind: row.kind,
        year: row.year,
        occurredAt: row.offset != null ? offsetDate(row.offset) : null,
        dateText: row.dateText ?? null,
        datePrecision: row.precision ?? "UNKNOWN",
        perfCategoryId: row.perfMinor ? (perfs.get(row.perfMinor) ?? null) : null,
        baseScore: row.base ?? null,
        perfScore: row.perf ?? null,
        declaredScore: row.declared ?? null,
        isVerified: row.verified ?? false,
        note: row.note ?? null,
        externalRef: `demo:${row.project}:${row.kind}`,
      },
    });
    count += 1;
  }
  return count;
}

/**
 * 学校突出成果奖励。被奖励对象从次年起永久排除二级学院绩效，**但不影响职称**，
 * 也不向该课题的产出级联。
 */
async function seedSchoolRewards(
  projects: Map<string, { id: string; requirementIds: string[] }>,
  achievements: Map<string, string>,
) {
  const p8 = projects.get("P8")?.id;
  if (p8) {
    await prisma.schoolRewardDecision.create({
      data: {
        projectId: p8,
        approvedAt: offsetDate(-198),
        batch: `${YEAR - 1}年度第二批`,
        domain: "SOCIAL_SERVICE",
        awardItem: "服务地方经济社会发展突出成果奖",
        awardLevel: "三等",
        awardAmountYuan: 5000,
        evidenceRef: "校发〔2025〕47号 审定通过名单",
        note: "自次年起该课题永久排除二级学院绩效，职称口径不受影响。",
      },
    });
  }

  const a30 = achievements.get("A30");
  if (a30) {
    await prisma.schoolRewardDecision.create({
      data: {
        achievementId: a30,
        approvedAt: offsetDate(-40),
        batch: `${YEAR}年度第一批`,
        domain: "TEACHING",
        awardItem: "指导学生技能竞赛突出贡献奖",
        awardLevel: "二等",
        awardAmountYuan: 8000,
        evidenceRef: `校发〔${YEAR}〕19号`,
      },
    });
  }
}

// ─── 日常：任务 ──────────────────────────────────────────────────────
//
// 刻意让「逾期 3 条、今日到期 2 条」——首页的实心强调卡因此落在「逾期」
// 而不是第一格（lib/home-stats.ts 的 emphasizedStat，有单测）。

async function seedTasks(projects: Map<string, { id: string; requirementIds: string[] }>) {
  const rows: {
    title: string;
    due?: number;
    priority?: "HIGH" | "NORMAL" | "LOW";
    status?: "TODO" | "DOING" | "DONE";
    source?: "SUPERIOR" | "MEETING" | "SELF";
    project?: string;
    tags?: string[];
    note?: string;
    completedOffset?: number;
  }[] = [
    // 逾期 3 条
    { title: "把软科学课题研究报告的实证章节补到 50% 以上", due: -6, priority: "HIGH", status: "DOING", source: "SELF", project: "P1", tags: ["结题"], note: "查重已过，差实证篇幅这一项。" },
    { title: "催恒新公司出具首期验收意见", due: -3, priority: "HIGH", status: "TODO", source: "SELF", project: "P5", tags: ["横向"] },
    { title: "提交数字媒体专业人才培养方案修订意见", due: -1, priority: "NORMAL", status: "TODO", source: "SUPERIOR", tags: ["教务"] },

    // 今日到期 2 条
    { title: "确认省教改课题中期检查材料是否需补交", due: 0, priority: "HIGH", status: "TODO", source: "SUPERIOR", project: "P2", tags: ["结题"] },
    { title: "回复学报编辑部关于论文格式的修改意见", due: 0, priority: "NORMAL", status: "DOING", source: "SELF" },

    // 高优先级但未到期
    { title: "整理职称申报材料清单，逐项核对任现职以来的成果", due: 12, priority: "HIGH", status: "TODO", source: "SELF", tags: ["职称"] },
    { title: "完成学分银行课题申报书终稿", due: 20, priority: "HIGH", status: "TODO", source: "SELF", project: "P6", tags: ["申报"] },

    // 本周内
    { title: "拟定下学期数字艺术学院教研活动安排", due: 2, source: "SUPERIOR", tags: ["教务"] },
    { title: "审核三位青年教师的听课记录", due: 3, source: "SUPERIOR" },
    { title: "联系印刷厂确认活页式教材第二次印刷数量", due: 4, priority: "LOW" },
    { title: "整理企业调研访谈录音，转成文字稿", due: 5, project: "P1", tags: ["结题"] },
    { title: "报送本学期教学质量分析报告", due: 6, source: "SUPERIOR", tags: ["教务"] },

    // 更远
    { title: "准备能力图谱课题的第一次专家论证会材料", due: 18, project: "P3" },
    { title: "撰写《职业院校专业群建设中的资源配置逻辑》初稿", due: 25, source: "SELF" },
    { title: "落实实训室设备采购申请的三家比价", due: 30, source: "SUPERIOR" },
    { title: "组织学生参加省数字媒体作品大赛报名", due: 33, tags: ["竞赛"] },
    { title: "更新个人 Obsidian 课题笔记与本系统的对应关系", due: 40, priority: "LOW", source: "SELF" },
    { title: "完成数字孪生展示系统的运维交接文档", due: 48, project: "P5" },
    { title: "申报下一年度校级教研课题", due: 62, source: "SELF" },
    { title: "整理三年来的社会服务证明材料", due: 75, priority: "LOW", tags: ["职称"] },

    // 无截止日（只会出现在日常列表里，不进首页——正是「记了等于丢了」那条设计的反例）
    { title: "想办法把学院公众号的选题做成固定栏目", priority: "LOW", source: "SELF" },
    { title: "读完《学习科学与课堂设计》并做笔记", priority: "LOW", source: "SELF" },

    // 已完成。前两条刻意落在最近两天，好让首页「本周完成 N 项」不是 0
    { title: "提交软科学课题查重报告", due: -2, status: "DONE", project: "P1", completedOffset: -1 },
    { title: "整理省教改课题中期检查的成效数据", due: -3, status: "DONE", project: "P2", completedOffset: -2 },
    { title: "完成省教学能力比赛材料上报", due: -20, status: "DONE", completedOffset: -21 },
    { title: "签订恒新智能装备技术开发合同", due: -152, status: "DONE", project: "P5", completedOffset: -152 },
    { title: "上传实用新型专利证书扫描件", due: -42, status: "DONE", completedOffset: -42 },
    { title: "完成本学期第一轮随堂听课", due: -30, status: "DONE", source: "SUPERIOR", completedOffset: -29 },
  ];

  const created: { id: string; title: string }[] = [];
  for (const row of rows) {
    const task = await prisma.task.create({
      data: {
        title: row.title,
        source: row.source ?? "SELF",
        priority: row.priority ?? "NORMAL",
        status: row.status ?? "TODO",
        dueDate: row.due != null ? offsetDate(row.due) : null,
        relatedProjectId: row.project ? (projects.get(row.project)?.id ?? null) : null,
        note: row.note ?? null,
        tags: row.tags ?? [],
        createdAt: offsetDateTime(row.due != null && row.due < 0 ? row.due - 10 : -14, 9),
        completedAt: row.completedOffset != null ? offsetDateTime(row.completedOffset, 16) : null,
      },
    });
    created.push({ id: task.id, title: task.title });
  }
  return created;
}

// ─── 日常：会议与议题 ────────────────────────────────────────────────

async function seedMeetings() {
  const past = await prisma.meeting.create({
    data: {
      title: "数字艺术学院第 8 次系部例会",
      meetingTime: offsetDateTime(-2, 9, 30),
      type: "REGULAR",
      agenda: [
        { text: "上周任务完成情况通报" },
        { text: "省教改课题中期检查材料分工" },
        { text: "下学期教研活动安排讨论" },
      ],
      minutes: [
        "一、上周任务完成情况",
        "教学能力比赛材料已按期上报；软科学课题查重报告已提交，重复率 12.4%。",
        "",
        "二、省教改课题中期检查",
        "中期检查报告主体由陈立牵头，方启明补充成效数据部分，8 月底前完成初稿。",
        "会上确认：成果佐证按“一条要求一个文件夹”整理，避免交材料时临时翻找。",
        "",
        "三、下学期教研活动",
        "拟定每月一次专题教研，主题分别为课程思政、AIGC 工具应用、毕业设计规范。",
      ].join("\n"),
      resolutions: [
        { text: "8 月底前完成省教改课题中期检查报告初稿", assignee: "陈立" },
        { text: "补充中期检查的成效数据部分", assignee: "方启明" },
        { text: "拟定下学期教研活动安排", assignee: "方启明" },
      ],
      createdAt: offsetDateTime(-9, 15),
    },
  });

  const meetings = [past];

  // 偏移刻意压在 ±3 天内，这样不论哪天灌数据，「本周会议」都不会只剩一场
  const upcoming: { title: string; offset: number; hour: number; minute?: number; type: "REGULAR" | "TOPIC" | "TEMP"; agenda: string[] }[] = [
    {
      title: "校企合作实训基地建设推进会",
      offset: 1, hour: 15, type: "TOPIC",
      agenda: ["实训基地二期场地方案", "设备采购清单确认", "企业师资进课堂排期"],
    },
    {
      title: "数字艺术专业群建设专题研讨会",
      offset: 2, hour: 14, type: "TOPIC",
      agenda: ["专业群建设三年行动方案第三稿讨论", "校企共建实训基地推进情况", "产业学院申报可行性"],
    },
    {
      title: `${YEAR}级人才培养方案论证会`,
      offset: 4, hour: 10, type: "TOPIC",
      agenda: ["数字媒体技术专业方案论证", "动漫制作技术专业方案论证", "企业专家意见汇总"],
    },
    {
      title: "数字艺术学院第 9 次系部例会",
      offset: 5, hour: 9, minute: 30, type: "REGULAR",
      agenda: ["本周任务通报", "职称申报材料准备进度", "实训室设备采购比价"],
    },
    {
      title: "关于软科学课题结题材料的临时碰头会",
      offset: 9, hour: 16, type: "TEMP",
      agenda: ["研究报告实证篇幅补充方案", "企业应用证明的开具流程"],
    },
  ];

  for (const item of upcoming) {
    const meeting = await prisma.meeting.create({
      data: {
        title: item.title,
        meetingTime: offsetDateTime(item.offset, item.hour, item.minute ?? 0),
        type: item.type,
        agenda: item.agenda.map((text) => ({ text })),
        resolutions: [],
        createdAt: offsetDateTime(-5, 11),
      },
    });
    meetings.push(meeting);
  }

  const older: { title: string; offset: number; type: "REGULAR" | "TOPIC" | "TEMP" }[] = [
    { title: "数字艺术学院第 7 次系部例会", offset: -16, type: "REGULAR" },
    { title: "期末教学工作总结会", offset: -30, type: "TOPIC" },
    { title: "毕业设计答辩工作布置会", offset: -51, type: "TOPIC" },
  ];
  for (const item of older) {
    const meeting = await prisma.meeting.create({
      data: {
        title: item.title,
        meetingTime: offsetDateTime(item.offset, 9, 30),
        type: item.type,
        agenda: [{ text: "例行议题" }],
        minutes: "（纪要已归档，此处略）",
        resolutions: [],
        createdAt: offsetDateTime(item.offset - 3, 10),
      },
    });
    meetings.push(meeting);
  }

  // 议题池：攒着，等下次会议拉进议程
  const pending = [
    "实训室排课与开放时间冲突，需要统一口径",
    "青年教师听课记录的归档方式还没定",
    "毕业设计选题与企业真实项目对接的比例能否提高",
    "学院公众号内容更新频率偏低",
    "职称申报材料的院内预审时间点",
  ];
  for (const content of pending) {
    await prisma.agendaItem.create({
      data: { content, status: "PENDING", createdAt: offsetDateTime(-7, 14) },
    });
  }
  await prisma.agendaItem.create({
    data: {
      content: "产业学院申报可行性",
      status: "SCHEDULED",
      meetingId: meetings[1]?.id ?? null,
      createdAt: offsetDateTime(-6, 14),
    },
  });

  return meetings;
}

// ─── 日常：轮派 ──────────────────────────────────────────────────────

async function seedDuties(teachers: Map<string, string>) {
  const types = new Map<string, string>();
  for (const item of [
    { name: "监考", note: "期中期末考试监考安排" },
    { name: "校级会议", note: "代表学院参加的校级例会" },
    { name: "学院值班", note: "假期与晚间值班" },
    { name: "教学质量优秀", note: "名额分配，不是活——轮派同时管活和名额" },
    { name: "企业走访", note: "校企合作单位定期走访" },
  ]) {
    const row = await prisma.dutyType.create({ data: item });
    types.set(item.name, row.id);
  }

  const records: { type: string; offset: number; title: string; people: string[]; note?: string }[] = [
    { type: "监考", offset: -58, title: "期末考试监考 第1场", people: ["方启明", "陈立"] },
    { type: "监考", offset: -56, title: "期末考试监考 第2场", people: ["周雨桐", "赵行舟"] },
    { type: "监考", offset: -54, title: "期末考试监考 第3场", people: ["孙敏", "吴博文"] },
    { type: "监考", offset: -52, title: "期末考试监考 第4场", people: ["林嘉禾", "方启明"] },
    { type: "校级会议", offset: -44, title: "校教学工作例会", people: ["方启明"] },
    { type: "校级会议", offset: -30, title: "校科研工作推进会", people: ["陈立"] },
    { type: "校级会议", offset: -16, title: "校教学工作例会", people: ["周雨桐"] },
    { type: "校级会议", offset: -2, title: "校安全工作会议", people: ["赵行舟"] },
    { type: "校级会议", offset: 12, title: "校教学工作例会", people: ["孙敏"], note: "按名单下一轮到孙敏" },
    { type: "学院值班", offset: -9, title: "暑期值班（第三周）", people: ["吴博文"] },
    { type: "学院值班", offset: -2, title: "暑期值班（第四周）", people: ["林嘉禾"] },
    { type: "学院值班", offset: 5, title: "暑期值班（第五周）", people: ["方启明"] },
    { type: "学院值班", offset: 12, title: "开学准备周值班", people: ["陈立"] },
    { type: "教学质量优秀", offset: -222, title: `${YEAR - 1}年度教学质量优秀名额`, people: ["方启明", "周雨桐"], note: "学院 2 个名额，按督导评价排序确定。" },
    { type: "企业走访", offset: -66, title: "走访明州恒新智能装备有限公司", people: ["方启明", "吴博文"] },
    { type: "企业走访", offset: 19, title: "走访本地文创企业（3 家）", people: ["陈立", "孙敏"] },
  ];

  let count = 0;
  for (const record of records) {
    const dutyTypeId = types.get(record.type);
    if (!dutyTypeId) continue;
    const ids = record.people
      .map((name) => teachers.get(name))
      .filter((id): id is string => Boolean(id))
      .map((teacherId) => ({ teacherId }));

    await prisma.dutyRecord.create({
      data: {
        dutyTypeId,
        date: offsetDate(record.offset),
        title: record.title,
        note: record.note ?? null,
        participants: { create: ids },
      },
    });
    count += 1;
  }
  return count;
}

// ─── 收件箱（速记）───────────────────────────────────────────────────

async function seedCaptures(convertedTaskId: string | null) {
  const inbox: { title: string; kind: "TASK" | "ACHIEVEMENT" | "NOTE"; content?: string; offset: number }[] = [
    { title: "王老师说市教育局下月可能有个职业启蒙教育的课题", kind: "NOTE", content: "找他要一下往年的申报通知看看口径", offset: -1 },
    { title: "论文《项目化教学在专业基础课中的应用》审稿意见要补对照班数据", kind: "TASK", offset: -1 },
    { title: "去年那个微课比赛的证书好像一直没扫描", kind: "ACHIEVEMENT", content: "在学院档案柜第三格", offset: -2 },
    { title: "恒新那边提了个新需求：展厅大屏要支持竖屏", kind: "NOTE", offset: -3 },
    { title: "问一下人事处，横向到账的排名系数怎么算", kind: "TASK", offset: -4 },
    { title: "学生小李的作品可以推去参加省赛", kind: "NOTE", content: "作品名《旧巷》，三维场景", offset: -6 },
  ];

  for (const item of inbox) {
    await prisma.captureItem.create({
      data: {
        kind: item.kind,
        status: "INBOX",
        title: item.title,
        content: item.content ?? null,
        createdAt: offsetDateTime(item.offset, 20, 15),
      },
    });
  }

  await prisma.captureItem.create({
    data: {
      kind: "TASK",
      status: "SNOOZED",
      title: "整理这三年的听课记录，评职称可能要用",
      snoozedUntil: offsetDate(21),
      createdAt: offsetDateTime(-12, 22),
      handledAt: offsetDateTime(-11, 8),
    },
  });

  if (convertedTaskId) {
    await prisma.captureItem.create({
      data: {
        kind: "TASK",
        status: "CONVERTED",
        title: "催恒新出验收意见",
        convertedTaskId,
        createdAt: offsetDateTime(-8, 19),
        handledAt: offsetDateTime(-7, 9),
      },
    });
  }
}

// ─── 课表 ────────────────────────────────────────────────────────────
//
// 开学日钉在「两周前的周一」：今天永远落在第 3 教学周，首页问候带和本周课表都有东西可画。
// 五个工作日每天至少一段课，周几截图都不会是空的。

async function seedTimetable() {
  const mondayOffset = -((TODAY.getDay() + 6) % 7);
  const startDate = offsetDate(mondayOffset - 14);
  const autumn = TODAY.getMonth() >= 7 || TODAY.getMonth() === 0;
  const schoolYear = TODAY.getMonth() >= 7 ? YEAR : YEAR - 1;
  const semester = await prisma.semester.create({
    data: { name: `${schoolYear}-${schoolYear + 1}-${autumn ? 1 : 2}`, startDate },
  });

  const weeks = Array.from({ length: 18 }, (_, index) => index + 1);
  const slots: [number, number, number, string, string, string][] = [
    [1, 1, 4, "三维动画设计", "数字媒体技术2401", "实训楼 302"],
    [2, 5, 8, "数字影像创作", "数字媒体技术2402", "实训楼 305"],
    [3, 1, 2, "设计素描", "数字媒体技术2501", "教学楼 A205"],
    [3, 5, 6, "三维动画设计", "数字媒体技术2401", "实训楼 302"],
    [4, 3, 4, "数字影像创作", "数字媒体技术2402", "实训楼 305"],
    [5, 1, 4, "专业基础课项目化实训", "数字媒体技术2501", "实训楼 308"],
  ];
  await prisma.timetableSlot.createMany({
    data: slots.map(([weekday, periodStart, periodEnd, courseName, className, location]) => ({
      semesterId: semester.id,
      weekday,
      periodStart,
      periodEnd,
      weeks,
      weeksText: "1-18周",
      courseName,
      className,
      location,
    })),
  });
  return slots.length;
}

// ─── 指导参赛 ────────────────────────────────────────────────────────
//
// 一条完整的晋级路径（校赛 → 省赛 → 国赛，国赛那条已引用为成果 A30），
// 一条已引用的双创获奖（A31），外加两条还没出结果的：报名截止会进首页倒计时。

async function seedCompetitions(teachers: Map<string, string>, achievements: Map<string, string>) {
  const dict = new Map<string, string>();
  for (const item of [
    { name: "全国职业院校技能大赛", organizer: "教育部等", level: "NATIONAL" as const },
    { name: "省“互联网+”大学生创新创业大赛", organizer: "省教育厅", level: "PROVINCIAL" as const },
    { name: "省大学生数字媒体作品大赛", organizer: "省高校计算机教育研究会", level: "PROVINCIAL" as const },
  ]) {
    const row = await prisma.competition.create({ data: item });
    dict.set(item.name, row.id);
  }

  type EntrySeed = {
    competition: string;
    track?: string;
    year: number;
    level: "NATIONAL" | "PROVINCIAL" | "SCHOOL";
    status: "PLANNED" | "REGISTERED" | "TRAINING" | "COMPETED";
    registerOffset?: number;
    competeOffset?: number;
    award?: "FIRST" | "SECOND" | "THIRD";
    awardTitle?: string;
    awardOffset?: number;
    myOrder: number;
    achievement?: string;
    members: string[];
    coaches: string[];
    note?: string;
  };
  const entries: EntrySeed[] = [
    {
      competition: "全国职业院校技能大赛", track: "移动应用开发赛项", year: YEAR, level: "SCHOOL",
      status: "COMPETED", competeOffset: -160, award: "FIRST", awardTitle: "校赛一等奖", awardOffset: -155,
      myOrder: 1, members: ["张晓雯", "李子航", "王一鸣"], coaches: ["陈立"],
    },
    {
      competition: "全国职业院校技能大赛", track: "移动应用开发赛项", year: YEAR, level: "PROVINCIAL",
      status: "COMPETED", competeOffset: -110, award: "FIRST", awardTitle: "省赛一等奖", awardOffset: -104,
      myOrder: 1, members: ["张晓雯", "李子航", "王一鸣"], coaches: ["陈立"],
      note: "省赛一等奖第二名，获得国赛资格。",
    },
    {
      competition: "全国职业院校技能大赛", track: "移动应用开发赛项", year: YEAR, level: "NATIONAL",
      status: "COMPETED", competeOffset: -62, award: "THIRD", awardTitle: "三等奖", awardOffset: -58,
      myOrder: 1, achievement: "A30", members: ["张晓雯", "李子航", "王一鸣"], coaches: ["陈立"],
    },
    {
      competition: "省“互联网+”大学生创新创业大赛", track: "职教赛道", year: YEAR, level: "PROVINCIAL",
      status: "COMPETED", competeOffset: -108, award: "SECOND", awardTitle: "银奖", awardOffset: -102,
      myOrder: 2, achievement: "A31", members: ["刘思远", "陈可欣", "黄子涵", "何雨萱"], coaches: ["吴博文"],
    },
    {
      competition: "省大学生数字媒体作品大赛", track: "动画与短片", year: YEAR, level: "PROVINCIAL",
      status: "PLANNED", registerOffset: 33, myOrder: 1, members: ["李想"], coaches: [],
      note: "作品《旧巷》，三维场景。比赛日期等报名通知。",
    },
    {
      competition: "全国职业院校技能大赛", track: "移动应用开发赛项", year: YEAR + 1, level: "SCHOOL",
      status: "TRAINING", registerOffset: 12, myOrder: 1, members: ["刘思远", "陈可欣"], coaches: ["陈立", "孙敏"],
      note: "新一届校赛集训，每周二、四晚上。",
    },
  ];

  for (const entry of entries) {
    const competitionId = dict.get(entry.competition);
    if (!competitionId) continue;
    await prisma.competitionEntry.create({
      data: {
        competitionId,
        track: entry.track ?? null,
        year: entry.year,
        level: entry.level,
        status: entry.status,
        registerDeadline: entry.registerOffset == null ? null : offsetDate(entry.registerOffset),
        competeAt: entry.competeOffset == null ? null : offsetDate(entry.competeOffset),
        competeDatePrecision: entry.competeOffset == null ? "UNKNOWN" : "DAY",
        award: entry.award ?? null,
        awardTitle: entry.awardTitle ?? null,
        awardedAt: entry.awardOffset == null ? null : offsetDate(entry.awardOffset),
        awardDatePrecision: entry.awardOffset == null ? "UNKNOWN" : "DAY",
        myOrder: entry.myOrder,
        note: entry.note ?? null,
        achievementId: entry.achievement ? (achievements.get(entry.achievement) ?? null) : null,
        members: { create: entry.members.map((name, orderIndex) => ({ name, orderIndex })) },
        coaches: {
          create: entry.coaches
            .map((name) => teachers.get(name))
            .filter((teacherId): teacherId is string => Boolean(teacherId))
            .map((teacherId, orderIndex) => ({ teacherId, orderIndex })),
        },
      },
    });
  }
  return entries.length;
}

// ─── 周期任务规则、活动日志、导出记录 ────────────────────────────────

async function seedRecurringRules(projects: Map<string, { id: string; requirementIds: string[] }>) {
  await prisma.recurringRule.create({
    data: {
      title: "每周教学检查与听课记录汇总",
      freq: "WEEKLY",
      day: 1,
      source: "SUPERIOR",
      priority: "NORMAL",
      createdAt: offsetDateTime(-120, 9),
    },
  });
  await prisma.recurringRule.create({
    data: {
      title: "月度课题进展小结",
      freq: "MONTHLY",
      day: 25,
      source: "SELF",
      priority: "LOW",
      relatedProjectId: projects.get("P3")?.id ?? null,
      createdAt: offsetDateTime(-90, 9),
    },
  });
}

async function seedActivityLog(
  projects: Map<string, { id: string; requirementIds: string[] }>,
  achievements: Map<string, string>,
) {
  const rows: { type: string; id: string | undefined; action: string; detail?: unknown; offset: number }[] = [
    { type: "Project", id: projects.get("P1")?.id, action: "创建课题", detail: { title: "中小制造企业数字化品牌传播的现状与对策研究" }, offset: -186 },
    { type: "Project", id: projects.get("P1")?.id, action: "新增结题要求项", detail: { count: 3 }, offset: -184 },
    { type: "Project", id: projects.get("P1")?.id, action: "修改课题信息", offset: -40 },
    { type: "Project", id: projects.get("P3")?.id, action: "创建课题", detail: { title: "面向产业数字化转型的高职数字媒体人才能力图谱构建研究" }, offset: -87 },
    { type: "Project", id: projects.get("P5")?.id, action: "修改课题信息", detail: { field: "fundingReceived" }, offset: -131 },
    { type: "Achievement", id: achievements.get("A1"), action: "创建成果", detail: { title: "中小制造企业短视频品牌传播策略研究" }, offset: -60 },
    { type: "Achievement", id: achievements.get("A1"), action: "状态变更", detail: { from: "ACCEPTED", to: "PUBLISHED" }, offset: -52 },
    { type: "Achievement", id: achievements.get("A8"), action: "状态变更", detail: { from: "UNDER_REVIEW", to: "REVISING" }, offset: -18 },
    { type: "Achievement", id: achievements.get("A20"), action: "创建成果", offset: -8 },
    { type: "Achievement", id: achievements.get("A12"), action: "状态变更", detail: { from: "UNDER_REVIEW", to: "REJECTED" }, offset: -140 },
  ];

  for (const row of rows) {
    if (!row.id) continue;
    await prisma.activityLog.create({
      data: {
        entityType: row.type,
        entityId: row.id,
        action: row.action,
        detail: (row.detail ?? undefined) as never,
        createdAt: offsetDateTime(row.offset, 11),
      },
    });
  }
}

async function seedExportRuns(projects: Map<string, { id: string; requirementIds: string[] }>) {
  await prisma.exportRun.create({
    data: {
      kind: "PERF_DECLARATION",
      year: YEAR - 1,
      options: { year: YEAR - 1, includeUnverified: false },
      includedCount: 14,
      issueSummary: { unverified: 3, missingCategory: 1 },
      snapshot: { note: "演示数据，快照略" },
      createdAt: offsetDateTime(-205, 15),
    },
  });
  await prisma.exportRun.create({
    data: {
      kind: "PROJECT_CLOSEOUT",
      projectId: projects.get("P8")?.id ?? null,
      options: { includeMaterials: true },
      includedCount: 2,
      issueSummary: {},
      snapshot: { note: "演示数据，快照略" },
      createdAt: offsetDateTime(-238, 16),
    },
  });
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log(`  演示库：${databaseName}`);
  console.log(`  上传根：${demoUploadRoot ?? "未配置（跳过附件落盘，材料仍会建记录）"}`);
  console.log("");

  const truncated = await truncateAll();
  console.log(`  已清空 ${truncated} 张表`);

  const { sources, docCategories, teachers } = await seedDictionaries();
  const perfs = await seedPerfCategories();
  const promotions = await seedPromotionCategories();
  const projects = await seedProjects(sources, promotions);
  const achievements = await seedAchievements(perfs, promotions);
  const linkCount = await seedLinks(projects, achievements);
  const attachments = await seedAttachments(projects, achievements, docCategories);
  const materialCount = await seedRequirementMaterials(projects, attachments);
  const eventCount = await seedPerformanceEvents(projects, perfs);
  await seedSchoolRewards(projects, achievements);
  const tasks = await seedTasks(projects);
  const meetings = await seedMeetings();
  const dutyCount = await seedDuties(teachers);
  await seedCaptures(tasks.find((t) => t.title.includes("催恒新"))?.id ?? null);
  await seedRecurringRules(projects);
  await seedActivityLog(projects, achievements);
  await seedExportRuns(projects);
  const slotCount = await seedTimetable();
  const competitionCount = await seedCompetitions(teachers, achievements);

  console.log("");
  console.log("  写入完成：");
  console.log(`    课题        ${projects.size} 个（六种健康度全覆盖）`);
  console.log(`    成果        ${achievements.size} 条`);
  console.log(`    挂接        ${linkCount} 条`);
  console.log(`    绩效大小类  ${perfs.size} 条 · 职称二级指标 ${promotions.size} 条`);
  console.log(`    课题绩效事实 ${eventCount} 条`);
  console.log(`    附件        ${attachments.size} 份（材料关联 ${materialCount} 条）`);
  console.log(`    任务        ${tasks.length} 条 · 会议 ${meetings.length} 场 · 轮派 ${dutyCount} 条`);
  console.log(`    教师        ${teachers.size} 人 · 立项来源 ${sources.size} 家`);
  console.log(`    课表        ${slotCount} 段（今天在第 3 教学周）· 参赛记录 ${competitionCount} 条`);
  if (demoUploadRoot) {
    console.log(`    实际落盘    ${writtenFileCount} 个 PDF → ${demoUploadRoot}`);
  }
  console.log("");
  console.log("  全部人物、单位、课题、成果均为虚构，可放心截图。");
  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
