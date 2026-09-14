/**
 * 全库 JSON 备份的表清单（设计见
 * `docs/superpowers/specs/2026-08-05-full-database-json-backup-design.md`）。
 *
 * **这份清单是 fail-closed 的**：`tables.test.ts` 拿它和 `prisma/schema.prisma`
 * 里的 `model` 逐个比对，多一张少一张都红。
 *
 * 为什么值得为一份清单写门禁：漏掉一张表**不会报错，只会让备份少一块**。
 * 用户下载、看见文件在、放心了——直到真要搬迁那天才发现某张表从来没进去过。
 * 备份的失败模式是沉默的，只能靠机制堵，不能靠记性。
 */

export type BackupTable = {
  /** Prisma 模型名，与 schema.prisma 里的 `model X` 一致 */
  model: string;
  /** Prisma Client 上的属性名（模型名首字母小写） */
  delegate: string;
  /** 是否进备份。**改成 false 必须在 reason 里写清代价** */
  include: boolean;
  reason: string;
  /**
   * cursor 分页用的主键字段名，**省略即 `id`**。
   *
   * 不是每张表的主键都叫 `id`——`PromotionRuleset` 的主键是 `year`。
   * 按 `id` 排序会让 Prisma 直接抛 `Unknown argument`，整份备份取不出来。
   * `tables.test.ts` 会拿 schema 里的 `@id` 逐个核对这个值
   */
  cursorField?: string;
};

/** 取某张表的游标字段，省略时用 `id` */
export function cursorFieldOf(table: BackupTable): string {
  return table.cursorField ?? "id";
}

/**
 * 按 `schema.prisma` 里的出现顺序排，方便两边对照着看。
 *
 * 目前**全部 `include: true`，一个例外都没有**：口令、会话密钥和云服务凭证
 * 全在环境变量里，会话是 HMAC 签名的 cookie、无服务端存储，所以规格 §7.8
 * 那条「不含口令/密钥/会话」在当前 schema 下自动成立。
 */
export const BACKUP_TABLES: readonly BackupTable[] = [
  // ── 课题域 ──
  {
    model: "Project",
    delegate: "project",
    include: true,
    reason: "课题唯一真相来源",
  },
  {
    model: "ProjectSource",
    delegate: "projectSource",
    include: true,
    reason: "立项来源字典",
  },
  {
    model: "Requirement",
    delegate: "requirement",
    include: true,
    reason: "结题要求项，rawText 是原文真相",
  },

  // ── 成果域 ──
  {
    model: "Achievement",
    delegate: "achievement",
    include: true,
    reason: "论文、专利、教材等实际产出",
  },
  {
    model: "PerfCategory",
    delegate: "perfCategory",
    include: true,
    reason: "绩效口径分类表（带年度）",
  },
  {
    model: "ProjectPerformanceEvent",
    delegate: "projectPerformanceEvent",
    include: true,
    reason: "课题的立项/结题/到账等绩效事实",
  },
  {
    model: "SchoolRewardDecision",
    delegate: "schoolRewardDecision",
    include: true,
    reason: "学校审定通过的奖励，触发永久绩效排除",
  },
  {
    model: "PromotionCategory",
    delegate: "promotionCategory",
    include: true,
    reason: "职称口径指标表",
  },
  {
    model: "PromotionRuleset",
    delegate: "promotionRuleset",
    include: true,
    reason: "职称量化表的年度版本头",
    // 全库唯一一张主键不叫 id 的表：`year Int @id`
    cursorField: "year",
  },

  // ── 支撑层 ──
  {
    model: "DocCategory",
    delegate: "docCategory",
    include: true,
    reason: "个人常用文档分类字典",
  },
  {
    model: "Attachment",
    delegate: "attachment",
    include: true,
    reason:
      "附件元数据。**原件不在 JSON 里**，走 scripts/backup.sh；storagePath 是两者对上号的唯一线索",
  },
  {
    model: "TeachingImport",
    delegate: "teachingImport",
    include: true,
    reason:
      "备课系统回流的教案。用户确认前不进成果台账，但它本身是业务事实，搬迁时不能丢",
  },
  {
    model: "RequirementAttachment",
    delegate: "requirementAttachment",
    include: true,
    reason: "课题材料 ↔ 结题要求项的关联与人工达标标记",
  },
  {
    model: "RequirementLink",
    delegate: "requirementLink",
    include: true,
    reason: "成果 ↔ 结题要求项的挂接与人工达标标记",
  },
  { model: "Member", delegate: "member", include: true, reason: "课题组成员" },
  {
    model: "Profile",
    delegate: "profile",
    include: true,
    reason: "本人档案。phone/email 是本人信息，搬迁必需",
  },
  {
    model: "Semester",
    delegate: "semester",
    include: true,
    reason: "学期字典，首页教学周的推算锚点",
  },
  {
    model: "TimetableSlot",
    delegate: "timetableSlot",
    include: true,
    reason: "课表条目，从教务系统导入；重导可再生，但导出文件不一定还留着",
  },
  {
    model: "ModuleSetting",
    delegate: "moduleSetting",
    include: true,
    reason: "功能模块开关。搬迁后界面该长什么样也是配置事实",
    // 主键是模块键名，不叫 id（同 PromotionRuleset 的情况）
    cursorField: "key",
  },
  {
    model: "ActivityLog",
    delegate: "activityLog",
    include: true,
    reason: "全站操作日志，详情页时间轴由它渲染",
  },

  // ── 日常 ──
  { model: "Task", delegate: "task", include: true, reason: "任务" },
  {
    model: "Meeting",
    delegate: "meeting",
    include: true,
    reason: "会议与正式纪要、决议",
  },
  {
    model: "MeetingRecording",
    delegate: "meetingRecording",
    include: true,
    reason:
      "转写稿与纪要草稿。providerTaskId 是腾讯云任务 ID，不是凭证，且是「这条转写从哪来」的事实",
  },
  {
    model: "AgendaItem",
    delegate: "agendaItem",
    include: true,
    reason: "议题池",
  },
  {
    model: "RecurringRule",
    delegate: "recurringRule",
    include: true,
    reason: "周期任务规则",
  },
  { model: "Teacher", delegate: "teacher", include: true, reason: "教师字典" },
  {
    model: "DutyType",
    delegate: "dutyType",
    include: true,
    reason: "轮派类型字典",
  },
  {
    model: "DutyRecord",
    delegate: "dutyRecord",
    include: true,
    reason: "轮派记录",
  },
  {
    model: "DutyParticipant",
    delegate: "dutyParticipant",
    include: true,
    reason: "轮派 ↔ 参与教师连接。2026-09-12 从隐式 m2m 改显式，就是为了能进这份清单",
  },
  // ── 班主任（学生工作）──
  {
    model: "ClassGroup",
    delegate: "classGroup",
    include: true,
    reason: "班级",
  },
  {
    model: "Student",
    delegate: "student",
    include: true,
    reason: "学生卡片（通讯录 + 宿舍 + 备注）。个人域敏感数据，搬迁必需",
  },
  {
    model: "StudentRelation",
    delegate: "studentRelation",
    include: true,
    reason: "学生矛盾关系。敏感，但正是搬迁时最不能丢的工作痕迹",
  },
  {
    model: "RosterChecklist",
    delegate: "rosterChecklist",
    include: true,
    reason: "勾名单收缴项",
  },
  {
    model: "RosterCheckmark",
    delegate: "rosterCheckmark",
    include: true,
    reason: "勾名单的勾。有行 = 已交，少了这张表所有收缴都变成没人交过",
  },
  {
    model: "StudentHonor",
    delegate: "studentHonor",
    include: true,
    reason: "学生/班级荣誉，评优申报的原料",
  },
  {
    model: "StudentHonorMember",
    delegate: "studentHonorMember",
    include: true,
    reason: "荣誉 ↔ 学生连接。显式建模就是为了能进这份清单",
  },
  {
    model: "StudentRecordType",
    delegate: "studentRecordType",
    include: true,
    reason: "学生记录类型字典",
  },
  {
    model: "StudentRecord",
    delegate: "studentRecord",
    include: true,
    reason: "谈话/班会/事件记录流水",
  },
  {
    model: "StudentRecordMember",
    delegate: "studentRecordMember",
    include: true,
    reason: "记录 ↔ 学生连接",
  },

  // ── 指导参赛 ──
  {
    model: "Competition",
    delegate: "competition",
    include: true,
    reason: "赛事字典",
  },
  {
    model: "CompetitionEntry",
    delegate: "competitionEntry",
    include: true,
    reason: "一次参赛（赛段级），含报名截止与获奖结果",
  },
  {
    model: "CompetitionMember",
    delegate: "competitionMember",
    include: true,
    reason: "参赛学生名单。姓名是文本，学生关联可空",
  },
  {
    model: "CompetitionCoach",
    delegate: "competitionCoach",
    include: true,
    reason: "合作指导教师连接。显式建模就是为了能进这份清单",
  },

  {
    model: "CaptureItem",
    delegate: "captureItem",
    include: true,
    reason: "速记（首页收件箱）",
  },

  // ── 导出审计 ──
  {
    model: "ExportRun",
    delegate: "exportRun",
    include: true,
    reason: "导出运行记录，含行快照",
  },
] as const;

/** 实际要写进 JSON 的表 */
export const INCLUDED_BACKUP_TABLES = BACKUP_TABLES.filter(
  (table) => table.include,
);

/**
 * 字段名命中这些词就必须在 `SENSITIVE_FIELD_EXEMPTIONS` 里显式豁免，否则门禁红。
 *
 * 今天 schema 里一个都没有命中，但**这个结论有保质期**——将来谁往库里加一个
 * `webhookSecret`，备份会默默把它一起送出门。
 */
export const SENSITIVE_FIELD_PATTERN =
  /passcode|secret|token|password|credential/i;

/**
 * 命中 `SENSITIVE_FIELD_PATTERN` 但确认可以导出的字段，写成 `模型.字段`。
 *
 * **加条目等于做一次安全决定**，理由必须写在值里。
 */
export const SENSITIVE_FIELD_EXEMPTIONS: Readonly<Record<string, string>> = {};
