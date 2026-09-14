/**
 * 枚举的中文映射集中在这里（CLAUDE.md 代码约定）。
 * 数据库存英文枚举值，界面一律显示中文，任何组件都不许自己写死中文字符串。
 *
 * 用 satisfies Record<Enum, string> 锁死完整性：schema 里新增枚举值而这里
 * 忘了补，`npm run typecheck` 会直接报错。
 */
import type {
  AchievementStatus,
  AchievementType,
  AchievementUsage,
  AttachmentKind,
  DatePrecision,
  DeclareNature,
  FundingType,
  Level,
  ProjectCategory,
  ProjectRole,
  ProjectStatus,
  TaskSource,
  TaskPriority,
  TaskStatus,
  MeetingType,
  AgendaStatus,
  RecurringFreq,
  RecordingStatus,
  CompetitionStatus,
  CompetitionAward,
} from "@/lib/generated/prisma/enums";

export const LEVEL_LABELS = {
  NATIONAL: "国家级",
  PROVINCIAL: "省级",
  MUNICIPAL: "市级",
  DISTRICT: "区级",
  BUREAU: "局级",
  SCHOOL: "校级",
  COLLEGE: "学院级",
  INDUSTRY: "行业级",
  // **不叫「待确认」。** 那个词已经归成果的核实状态徽章了
  // （`isVerified` 为假时显示「待确认」）。同一行里「类型/级别」写着待确认、
  // 旁边徽章也写着待确认，说的却是两件毫不相干的事
  UNRATED: "未定级",
} satisfies Record<Level, string>;

/** 申报性质。学校表把它当每条记录的属性，不单设大类 */
export const DECLARE_NATURE_LABELS = {
  PROCESS: "过程性工作",
  RESULT: "成果性工作",
} satisfies Record<DeclareNature, string>;

/**
 * 成果的用途。三个正交维度里的第三个——和学校口径分类、AchievementType
 * 各管各的，不互推（CLAUDE.md 第 11 条）。
 */
export const ACHIEVEMENT_USAGE_LABELS = {
  PERFORMANCE: "绩效",
  PROMOTION: "职称",
  PROJECT_CLOSING: "结题挂接",
} satisfies Record<AchievementUsage, string>;

export const PROJECT_CATEGORY_LABELS = {
  RESEARCH: "科研",
  TEACHING_REFORM: "教改",
  EDU_RESEARCH: "教研",
  OTHER: "其他",
} satisfies Record<ProjectCategory, string>;

/** 纵向 / 横向。与 category 正交——横向项目同样可以是科研 */
export const FUNDING_TYPE_LABELS = {
  VERTICAL: "纵向",
  HORIZONTAL: "横向",
} satisfies Record<FundingType, string>;

/** 分段列表的标题用得着的更完整说法 */
export const FUNDING_TYPE_SECTION_LABELS = {
  VERTICAL: "纵向课题",
  HORIZONTAL: "横向项目",
} satisfies Record<FundingType, string>;

export const PROJECT_ROLE_LABELS = {
  LEAD: "主持",
  CO_LEAD: "第一参与",
  MEMBER: "参与",
} satisfies Record<ProjectRole, string>;

/**
 * 角色 + 排名合成一句话，如「参与 3/6」「主持 1/6」「参与 第3」。
 * 两者本来就在回答同一个问题——我在这个课题里是什么位置——
 * 所以合成一列显示，不单独占表格宽度。
 */
export function formatRoleWithRank(
  role: ProjectRole,
  ownerOrder: number | null,
  memberCount: number | null,
): string {
  const label = PROJECT_ROLE_LABELS[role];
  if (ownerOrder == null) {
    // 只知道总人数意义不大，不显示
    return label;
  }
  return memberCount == null ? `${label} 第${ownerOrder}` : `${label} ${ownerOrder}/${memberCount}`;
}

/** 顺序即下拉顺序，按流程排：申报 → 出结果 → 执行 → 结束 */
export const PROJECT_STATUS_LABELS = {
  DRAFT: "拟申报",
  APPLYING: "申报中",
  REJECTED: "未获立项",
  ONGOING: "在研",
  CLOSING: "结题准备",
  CLOSED: "已结题",
  TERMINATED: "已终止",
} satisfies Record<ProjectStatus, string>;

export const ACHIEVEMENT_TYPE_LABELS = {
  PAPER: "论文",
  REPORT: "研究报告",
  TEXTBOOK: "教材",
  CASE: "案例",
  PATENT: "专利",
  SOFTWARE_COPYRIGHT: "软件著作权",
  AWARD: "获奖",
  COURSE: "课程",
  STUDENT_ACHIEVEMENT: "指导学生",
  MEDIA_REPORT: "媒体报道",
  FUNDING_RECEIPT: "到账经费",
  TRAINING: "培训讲座",
  SOCIAL_SERVICE: "社会服务",
  OTHER: "其他",
} satisfies Record<AchievementType, string>;

/**
 * 成果页「类型」筛选的标签。成果页是 Project + Achievement 的联合视图，
 * 表格「类型」列给课题印的就是「课题」，筛选条必须用同一套字。
 * 这里刻意不 import lib/outcomes——它只是 AchievementType 前面多一档。
 */
export const OUTCOME_TYPE_LABELS = {
  PROJECT: "课题",
  ...ACHIEVEMENT_TYPE_LABELS,
} satisfies Record<"PROJECT" | AchievementType, string>;

export const ACHIEVEMENT_STATUS_LABELS = {
  PLANNED: "选题",
  TITLED: "拟题定稿",
  WRITING: "写作中",
  DRAFTED: "初稿完成",
  CHECKING: "查重检测",
  SUBMITTED: "已投稿",
  UNDER_REVIEW: "外审中",
  REVISING: "修回中",
  ACCEPTED: "已录用",
  PUBLISHED: "已见刊",
  INDEXED: "已收录",
  REJECTED: "退稿",
  SHELVED: "暂缓",
} satisfies Record<AchievementStatus, string>;

/**
 * 非论文类成果（专利、获奖等）能用的状态。
 * 论文与研究报告走完整生命周期，其余类型前端只放出这几档（prd-ledger 2.1）。
 */
export const SIMPLE_ACHIEVEMENT_STATUSES: AchievementStatus[] = [
  "PLANNED",
  "WRITING",
  "DRAFTED",
  "ACCEPTED",
  "PUBLISHED",
];

/** 走完整论文生命周期的成果类型 */
export const FULL_LIFECYCLE_TYPES: AchievementType[] = ["PAPER", "REPORT"];

export function statusesForAchievementType(type: AchievementType): AchievementStatus[] {
  if (FULL_LIFECYCLE_TYPES.includes(type)) {
    return Object.keys(ACHIEVEMENT_STATUS_LABELS) as AchievementStatus[];
  }
  return SIMPLE_ACHIEVEMENT_STATUSES;
}

/**
 * 非论文类的状态文案。
 *
 * **只过滤档位是不够的。** 获奖、培训、经费到账这些复用了论文的枚举值，
 * 但「选题」「写作中」「初稿完成」「已见刊」这套说法套在
 * 「第四届全省高校网络教育优秀作品推选活动一等奖」上，五个词没一个说得通。
 * 枚举值不动（那是数据），换的是显示文案。
 */
export const SIMPLE_ACHIEVEMENT_STATUS_LABELS: Partial<Record<AchievementStatus, string>> = {
  PLANNED: "计划中",
  WRITING: "进行中",
  DRAFTED: "已提交",
  ACCEPTED: "已确认",
  PUBLISHED: "已完成",
};

/**
 * 按成果类型取状态文案。**显示状态的地方一律走这里**，
 * 否则列表里写「已见刊」、编辑页写「已完成」，比不改还乱。
 *
 * 非论文类若存着简版之外的状态（存量导入留下的 `SHELVED`、`REJECTED` 等），
 * 回退到完整文案——**不能显示成空白**，那会让人以为数据丢了。
 */
export function achievementStatusLabel(
  status: AchievementStatus,
  type: AchievementType,
): string {
  if (FULL_LIFECYCLE_TYPES.includes(type)) return ACHIEVEMENT_STATUS_LABELS[status];
  return SIMPLE_ACHIEVEMENT_STATUS_LABELS[status] ?? ACHIEVEMENT_STATUS_LABELS[status];
}

/**
 * 日期精度只影响渲染方式，不改变存储。
 * 见 CLAUDE.md 第 8 条：不许把模糊日期硬转成精确日期。
 */
export const DATE_PRECISION_LABELS = {
  DAY: "精确到日",
  MONTH: "精确到月",
  YEAR: "精确到年",
  RANGE: "时间区间",
  // 同上：这里说的是「日期说不准」，和核实状态无关
  UNKNOWN: "无法确定",
} satisfies Record<DatePrecision, string>;

/** 附件类型。顺序即界面上的分组顺序，大致按课题生命周期排 */
/**
 * **这里的顺序就是材料分组的顺序**（规格 7.4：按申报文件、过程证据、参考资料、
 * 结题材料等类别分组）。`ATTACHMENT_KIND_OPTIONS` 直接由它派生，上传下拉和课题
 * 详情的材料分组用的是同一份顺序，改这里两处一起变。
 *
 * 排法跟着课题生命周期走：申报 → 过程 → 结题 → 成果证据 → 参考与教学 → 其他。
 * 参考资料和教案放在后面不是因为不重要，而是它们贯穿整个周期、不属于某个阶段，
 * 插在中间会把"这个课题走到哪一步了"这条线打断。
 */
export const ATTACHMENT_KIND_LABELS = {
  PROPOSAL: "申报书",
  APPROVAL: "立项通知",
  CONTRACT: "合同",
  MIDTERM: "中期检查材料",
  PROCESS_EVIDENCE: "过程证据",
  CHECK_REPORT: "查重报告",
  FINAL_REPORT: "结题报告",
  // 「证书」是泛指：结题证书、软著登记证书、聘任证书都归这里。
  // 获奖证书单列，因为台账里它最多，混在一起看不出哪些是奖
  CERTIFICATE: "证书",
  AWARD_CERTIFICATE: "获奖证书",
  ACCEPTANCE: "录用通知",
  PUBLICATION: "见刊页",
  INDEX_PROOF: "收录证明",
  REFERENCE: "研究参考",
  TEACHING_PLAN: "教案",
  OTHER: "其他",
} satisfies Record<AttachmentKind, string>;

/** 健康度配色的中文说明，见 lib/gap.ts 的 ProjectHealth */
export const HEALTH_LABELS = {
  GREY: "已结束",
  BLUE: "申报中",
  GREEN: "已齐备",
  YELLOW: "有缺口",
  ORANGE: "临近截止",
  RED: "紧急",
  UNSET: "未录要求",
} as const;

/**
 * 状态与健康度**说的是不是同一句话**。
 *
 * 两者维度不同——状态是流程位置，健康度是结题要求的齐备程度——但文案会撞车：
 * `APPLYING` 和 `BLUE` 现在都叫「申报中」。课题表把状态文字和健康度徽章上下
 * 叠着放，申报中的课题那一格就把同一个词印了两遍。
 *
 * 重合时只留徽章：它带语义色，比灰字更好扫，信息一点没少。
 *
 * **判据是文案不是枚举对照表。** 写死一张 `APPLYING → BLUE` 的表，等哪天
 * 有人改了任一侧的措辞，表就悄悄失效、界面又开始印两遍而没人发现。
 */
export function isHealthLabelRedundant(
  status: ProjectStatus,
  health: keyof typeof HEALTH_LABELS,
): boolean {
  return PROJECT_STATUS_LABELS[status] === HEALTH_LABELS[health];
}

// ─── 日常（Phase 3）────────────────────────────────────────────────────

/** 任务来源。上级布置的和自己想起来的，处理优先级完全不同 */
export const TASK_SOURCE_LABELS = {
  SUPERIOR: "上级布置",
  MEETING: "例会派发",
  SELF: "自我待办",
} satisfies Record<TaskSource, string>;

export const TASK_PRIORITY_LABELS = {
  HIGH: "高",
  NORMAL: "中",
  LOW: "低",
} satisfies Record<TaskPriority, string>;

export const TASK_STATUS_LABELS = {
  TODO: "待办",
  DOING: "进行中",
  DONE: "已完成",
} satisfies Record<TaskStatus, string>;

/** 沿用早期日常原型的措辞——「系部例会」比「例会」准确 */
export const MEETING_TYPE_LABELS = {
  REGULAR: "系部例会",
  TOPIC: "专项研讨",
  TEMP: "临时会议",
} satisfies Record<MeetingType, string>;

export const AGENDA_STATUS_LABELS = {
  PENDING: "待排期",
  SCHEDULED: "已排入",
} satisfies Record<AgendaStatus, string>;

export const RECORDING_STATUS_LABELS = {
  UPLOADING: "上传中",
  UPLOADED: "等待转写",
  TRANSCRIBING: "转写中",
  TRANSCRIBED: "转写完成",
  DRAFT_READY: "草稿待确认",
  CONFIRMED: "已确认",
  DELETE_PENDING: "等待删除音频",
  AUDIO_DELETED: "音频已删除",
  FAILED: "转写失败",
} satisfies Record<RecordingStatus, string>;

export const RECURRING_FREQ_LABELS = {
  WEEKLY: "每周",
  MONTHLY: "每月",
} satisfies Record<RecurringFreq, string>;

/** 周期规则里的「星期几」。1=周一 … 7=周日 */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};

/**
 * 参赛走到哪一步。**不含结果**——获奖看 COMPETITION_AWARD_LABELS，
 * 两个字段各说一件事（见 schema 里 CompetitionEntry 的注释）
 */
export const COMPETITION_STATUS_LABELS = {
  PLANNED: "打算参加",
  REGISTERED: "已报名",
  TRAINING: "集训中",
  COMPETED: "已比赛",
  WITHDRAWN: "已放弃",
} satisfies Record<CompetitionStatus, string>;

/**
 * 奖项等级。**「未获奖」是一个事实不是空值**：参赛了没获奖要能记下来，
 * 和「还没出结果」（award 为 null）是两回事
 */
export const COMPETITION_AWARD_LABELS = {
  FIRST: "一等奖",
  SECOND: "二等奖",
  THIRD: "三等奖",
  EXCELLENT: "优胜奖",
  OTHER: "其他奖项",
  NONE: "未获奖",
} satisfies Record<CompetitionAward, string>;
