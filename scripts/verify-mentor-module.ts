import "dotenv/config";

import { dedupeRowsByName } from "../lib/bulk-import";
import { prisma } from "../lib/db";
import { dateOnly } from "../lib/date";
import {
  DEFAULT_MENTEE_RECORD_TYPE_NAMES,
  adoptMenteeProjectAsAchievement,
  getActiveMentees,
  getMenteeRecords,
  deleteMenteeWithSoloRecords,
  attachRecordToProject,
  getMenteeMilestonesBetween,
  getMenteeProjectDetail,
  getMenteeRoster,
  resolveMenteeBatch,
} from "../lib/queries/mentees";
import { upcomingMilestoneDeadlines } from "../lib/mentees";
import { parseBulkMentees } from "../lib/schemas/mentee";

/**
 * 学业导师模块的真实数据库验证：建临时批次 → 粘贴导入名单 → 写指导记录 →
 * 用页面同一套查询筛日期区间 → 速记转换指针 → 删批次看是否级联清空。
 *
 * 不经过 Server Action（它读请求里的会话 cookie，脚本里没有），
 * 验的是 schema、外键语义和 lib/queries/mentees.ts 的口径能不能在真库上跑通。
 * 批次名带随机串，不碰用户真实数据；跑完 finally 里删干净。
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const batchName = `verify-mentor-${suffix}`;

  // 粘贴解析：第三列是**班级**不是手机（导师学生跨班）
  const rows = parseBulkMentees(
    [
      `林知远-${suffix}\t2023010101\t数媒2301\t0519-86660001`,
      `苏明宇-${suffix}\t2023010102\t数媒2302`,
      `周彦-${suffix}`,
      // 整表重复粘贴是安全的：同名跳过
      `林知远-${suffix}\t2023010101\t数媒2301`,
    ].join("\n"),
  );
  assert(rows.length === 4, `应解析出 4 行，得到 ${rows.length}`);
  assert(rows[0].className === "数媒2301", "第三列应落在 className 上");

  const batch = await prisma.menteeBatch.create({
    data: { name: batchName, year: 2023 },
  });
  console.log(`临时批次 ${batchName} 已建`);
  // 引用为成果建出来的 Achievement 不随批次级联——断言中途失败时
  // 也得在 finally 里删掉，否则真库台账的「待核实」里会多一条垃圾
  const createdAchievementIds: string[] = [];

  try {
    // **用一次性名字，不补种真字典。** MenteeRecordType 是全局字典（name @unique），
    // 而 finally 只删批次——照默认名补种的话字典行会永远留在真库里，
    // 更糟的是把用户手工删过的类型复活。名字带 suffix，finally 里一并删
    await prisma.menteeRecordType.createMany({
      data: DEFAULT_MENTEE_RECORD_TYPE_NAMES.map((name) => ({
        name: `${name}-${suffix}`,
      })),
    });
    const guidanceType = await prisma.menteeRecordType.findUniqueOrThrow({
      where: { name: `毕设指导-${suffix}` },
    });

    // **用 Action 同一段去重逻辑，不另写一遍。** 脚本原来自带一个 seen 集合，
    // 于是断言照样通过，而真正的 bulkImportMentees 当时只对库里已有的去重、
    // 块内重复照插——门禁就这样看不见（2026-09-21 评审捡出）
    const fresh = dedupeRowsByName(rows, []);
    await prisma.mentee.createMany({
      data: fresh.map((row) => ({ ...row, batchId: batch.id })),
    });
    const roster = await getMenteeRoster(batch.id);
    assert(roster.length === 3, `同名跳过后应有 3 人，得到 ${roster.length}`);
    console.log(`导入并读回 ${roster.length} 人（重复的那行已跳过）`);

    const lin = roster.find((m) => m.name.startsWith("林知远"))!;
    const su = roster.find((m) => m.name.startsWith("苏明宇"))!;

    // 三条记录：两条点名、一条全批
    await prisma.menteeRecord.create({
      data: {
        batchId: batch.id,
        typeId: guidanceType.id,
        date: dateOnly(2026, 3, 10),
        content: "选题方向：非遗纹样生成，先看两篇综述",
        members: { create: [{ menteeId: lin.id }] },
      },
    });
    await prisma.menteeRecord.create({
      data: {
        batchId: batch.id,
        typeId: guidanceType.id,
        date: dateOnly(2026, 5, 20),
        content: "中期：交互部分卡住，改用现成组件库",
        members: { create: [{ menteeId: lin.id }, { menteeId: su.id }] },
      },
    });
    await prisma.menteeRecord.create({
      data: {
        batchId: batch.id,
        typeId: guidanceType.id,
        date: dateOnly(2026, 9, 1),
        content: "开学集体见面，讲这学期节奏",
      },
    });

    // 整批口径
    const all = await getMenteeRecords(batch.id);
    assert(all.length === 3, `整批应 3 条，得到 ${all.length}`);
    assert(all[0].members.length === 0, "最新那条应是全批（0 个成员）");

    // 按学生筛：林知远 2 条
    const byMentee = await getMenteeRecords(batch.id, { menteeId: lin.id });
    assert(byMentee.length === 2, `按学生筛应 2 条，得到 ${byMentee.length}`);

    // 按日期区间筛：春季学期只剩 3/10 那条
    const spring = await getMenteeRecords(batch.id, {
      from: dateOnly(2026, 2, 1),
      to: dateOnly(2026, 4, 30),
    });
    assert(spring.length === 1, `春季区间应 1 条，得到 ${spring.length}`);
    assert(spring[0].content.includes("非遗纹样"), "春季那条内容不对");
    console.log("筛选口径：整批 3 条 / 按学生 2 条 / 按区间 1 条");

    // 名单上的「最近一次指导」取的是最新那条
    const rosterAfter = await getMenteeRoster(batch.id);
    const linAfter = rosterAfter.find((m) => m.id === lin.id)!;
    assert(linAfter._count.recordMembers === 2, "林知远应挂 2 条记录");
    const lastDate = linAfter.recordMembers[0]?.record.date;
    assert(
      lastDate?.toISOString().startsWith("2026-05-20"),
      `最近一次指导应是 2026-05-20，得到 ${lastDate?.toISOString()}`,
    );

    // 毕业用 active=false，不删：记录还挂在名下
    await prisma.mentee.update({ where: { id: su.id }, data: { active: false } });
    const active = await getActiveMentees(batch.id);
    assert(active.length === 2, `停用一人后在带应剩 2 人，得到 ${active.length}`);
    assert(
      (await getMenteeRecords(batch.id, { menteeId: su.id })).length === 1,
      "毕业的学生记录不该跟着消失",
    );
    console.log("毕业走 active=false：在带 2 人，历史记录仍在");

    // 速记转换指针：@unique 把「同一条速记转两次」挡在数据库层
    const capture = await prisma.captureItem.create({
      data: { kind: "NOTE", title: `verify-mentor 速记 ${suffix}` },
    });
    const converted = await prisma.menteeRecord.create({
      data: {
        batchId: batch.id,
        typeId: guidanceType.id,
        date: dateOnly(2026, 9, 15),
        content: "速记归类过来的一条",
        members: { create: [{ menteeId: lin.id }] },
      },
    });
    await prisma.captureItem.update({
      where: { id: capture.id },
      data: { status: "CONVERTED", convertedMenteeRecordId: converted.id },
    });
    // **create 必须在 try 外面。** 放进去的话 update 抛 P2002 被 catch 接住，
    // 下面那句 delete 永远执行不到——真库里就多一条 INBOX 速记，
    // 而它会直接出现在首页收件箱里（2026-09-21 评审实测捡出 3 条残留）
    const other = await prisma.captureItem.create({
      data: { kind: "NOTE", title: `verify-mentor 速记2 ${suffix}` },
    });
    let blocked = false;
    try {
      await prisma.captureItem.update({
        where: { id: other.id },
        data: { convertedMenteeRecordId: converted.id },
      });
    } catch {
      blocked = true;
    }
    await prisma.captureItem.delete({ where: { id: other.id } });
    assert(blocked, "convertedMenteeRecordId 的 @unique 没挡住重复指向");
    console.log("速记转换指针唯一约束生效");

    // 删记录时速记不跟着删（SetNull），指针清空
    await prisma.menteeRecord.delete({ where: { id: converted.id } });
    const captureAfter = await prisma.captureItem.findUniqueOrThrow({
      where: { id: capture.id },
    });
    assert(
      captureAfter.convertedMenteeRecordId === null,
      "删记录后速记的指针应被置空而不是把速记一起删掉",
    );
    await prisma.captureItem.delete({ where: { id: capture.id } });

    // 字典是 Restrict：还有记录挂着就不许删类型
    let restricted = false;
    try {
      await prisma.menteeRecordType.delete({ where: { id: guidanceType.id } });
    } catch {
      restricted = true;
    }
    assert(restricted, "记录类型有记录挂着时应被 Restrict 拦下");
    console.log("记录类型 Restrict 生效");

    // 默认批次解析：未归档的按 year 倒序取第一个
    const resolved = await resolveMenteeBatch(undefined);
    assert(resolved != null, "应能解析出一个默认批次");
    // 参数指向不存在的批次时静默落回默认，不报错
    const fallback = await resolveMenteeBatch("no-such-batch-id");
    assert(fallback != null, "书签过期时应静默落回默认批次");
    console.log("批次解析：默认可取、坏参数静默落回");

    // ── 删学生：只提到他一人的记录要跟着删，和别人一起的要留下 ──
    // **这条必须在真库上验。** MenteeRecord 没有指向 Mentee 的外键，
    // 级联的只有成员连接表；光删学生的话那些记录会剩 0 个成员，
    // 而 0 成员在名单页和导出 xlsx 里都渲染成「全批」——
    // 一次一对一谈话就这样悄悄变成全批集体活动，不报错、事后也查不出来
    const soloRecord = await prisma.menteeRecord.create({
      data: {
        batchId: batch.id,
        typeId: guidanceType.id,
        date: dateOnly(2026, 5, 6),
        content: "只提到苏明宇一人",
        members: { create: [{ menteeId: su.id }] },
      },
    });
    const sharedRecord = await prisma.menteeRecord.create({
      data: {
        batchId: batch.id,
        typeId: guidanceType.id,
        date: dateOnly(2026, 5, 7),
        content: "苏明宇和林知远一起",
        members: { create: [{ menteeId: su.id }, { menteeId: lin.id }] },
      },
    });

    // 验的是数据语义这一层；鉴权在 Server Action 里，脚本没有会话
    const soloDeleted = await deleteMenteeWithSoloRecords(su.id);
    assert(soloDeleted === 1, `应连带删掉 1 条独属记录，实际 ${soloDeleted}`);

    const soloAfter = await prisma.menteeRecord.findUnique({
      where: { id: soloRecord.id },
    });
    assert(soloAfter === null, "只提到一人的记录应随该学生一起删掉");

    const sharedAfter = await prisma.menteeRecord.findUniqueOrThrow({
      where: { id: sharedRecord.id },
      include: { members: true },
    });
    assert(
      sharedAfter.members.length === 1 && sharedAfter.members[0].menteeId === lin.id,
      "和别人一起的记录应留下，且只剩另一位的成员行",
    );
    assert(
      sharedAfter.members.length > 0,
      "留下的记录不许变成 0 成员——那会被渲染成「全批」",
    );
    console.log("删学生：独属记录随之删除，共同记录留下且未变成「全批」");

    // ── M2：学生项目 ──
    // 用一次性类型名，理由同上面的记录类型：项目类型也是全局字典，
    // 原来 upsert「毕业设计」——用户删过的话，跑一次验证就把它复活了
    const kind = await prisma.menteeProjectKind.create({
      data: { name: `毕业设计-${suffix}` },
    });
    const project = await prisma.menteeProject.create({
      data: {
        batchId: batch.id,
        title: `verify-mentor 毕设 ${suffix}`,
        kindId: kind.id,
        schoolYear: "2025—2026 学年",
        members: { create: [{ menteeId: lin.id, orderIndex: 0 }] },
      },
    });

    // 节点：填了日期的进月历/倒计时，「五月底」那条留空
    await prisma.menteeProjectMilestone.createMany({
      data: [
        { projectId: project.id, label: "开题", date: dateOnly(2026, 3, 20) },
        { projectId: project.id, label: "中期检查", date: dateOnly(2026, 5, 8) },
        { projectId: project.id, label: "答辩", date: null, note: "五月底，具体日子没定" },
      ],
    });
    const dated = await getMenteeMilestonesBetween(
      dateOnly(2026, 1, 1),
      dateOnly(2026, 12, 31),
    );
    const mine = dated.filter((m) => m.project.id === project.id);
    assert(mine.length === 2, `只有填了日期的 2 条该进来，得到 ${mine.length}`);
    assert(
      mine.every((m) => m.date != null),
      "getMenteeMilestonesBetween 不该返回 date 为 null 的节点",
    );
    console.log(`节点：3 条里 ${mine.length} 条有精确日期，进月历`);

    // 合并口径：同一天同一个节点只占倒计时一个名额
    const merged = upcomingMilestoneDeadlines(
      [
        { id: "a", label: "答辩", date: dateOnly(2026, 6, 1), projectId: "p1", projectTitle: "甲", ownerName: "甲同学" },
        { id: "b", label: "答辩", date: dateOnly(2026, 6, 1), projectId: "p2", projectTitle: "乙", ownerName: "乙同学" },
      ],
      dateOnly(2026, 5, 1),
    );
    assert(merged.length === 1 && merged[0].count === 2, "同一天同一个节点应合并成一条");

    // 指导记录挂到项目上：一人一张的记录表就是按它筛的
    const guidance = await prisma.menteeRecord.findFirst({
      where: { batchId: batch.id, members: { some: { menteeId: lin.id } } },
      select: { id: true },
    });
    await prisma.menteeRecord.update({
      where: { id: guidance!.id },
      data: { projectId: project.id },
    });
    const detail = await getMenteeProjectDetail(project.id);
    assert(detail?.records.length === 1, "项目详情应带出 1 条指导记录");

    // 跨批次的项目不许挂：会让「这个项目的指导记录」混进别人那届的谈话
    const otherBatch = await prisma.menteeBatch.create({
      data: { name: `verify-mentor-other-${suffix}`, year: 2022 },
    });
    const otherProject = await prisma.menteeProject.create({
      data: { batchId: otherBatch.id, title: `别批次的题 ${suffix}`, kindId: kind.id },
    });
    const crossBatch = await attachRecordToProject(guidance!.id, otherProject.id);
    assert(crossBatch.ok === false, "挂到别批次的项目上应被拒绝");
    const stillMine = await prisma.menteeRecord.findUniqueOrThrow({
      where: { id: guidance!.id },
      select: { projectId: true },
    });
    assert(stillMine.projectId === project.id, "被拒绝后不该动原来的挂接");

    // 空串 = 从项目上摘下来，不是校验失败
    const detached = await attachRecordToProject(guidance!.id, "");
    assert(detached.ok === true, "空串应该是「摘下来」而不是校验失败");
    assert(
      (await prisma.menteeRecord.findUniqueOrThrow({
        where: { id: guidance!.id },
        select: { projectId: true },
      })).projectId === null,
      "摘下来之后 projectId 应为 null",
    );
    await attachRecordToProject(guidance!.id, project.id);
    await prisma.menteeBatch.delete({ where: { id: otherBatch.id } });
    console.log("记录挂项目：跨批次被拒、空串=摘下、原挂接不受影响");

    // 附件归属七选一：挂项目的行必须过 CHECK
    const attachment = await prisma.attachment.create({
      data: {
        menteeProjectId: project.id,
        filename: "开题报告.pdf",
        storagePath: `mentee-projects/${project.id}/verify-${suffix}.pdf`,
        size: 4,
        mimeType: "application/pdf",
      },
      select: { id: true },
    });
    console.log("附件挂学生项目：CHECK 放行");

    // 反向：同时挂两个归属必须被 CHECK 当场拒绝
    let rejected = false;
    try {
      await prisma.attachment.create({
        data: {
          menteeProjectId: project.id,
          docCategoryId: null,
          projectId: null,
          filename: "双归属.pdf",
          storagePath: `mentee-projects/${project.id}/bad-${suffix}.pdf`,
          size: 4,
          mimeType: "application/pdf",
        },
        select: { id: true },
      });
      // 只挂一个归属是合法的，上面这条会成功——真正要验的是两个归属
      const twoOwners = await prisma.$executeRawUnsafe(
        `UPDATE "Attachment" SET "docCategoryId" = (SELECT id FROM "DocCategory" LIMIT 1) WHERE id = $1`,
        attachment.id,
      );
      void twoOwners;
    } catch {
      rejected = true;
    }
    assert(rejected, "同时挂两个归属应被 Attachment_single_owner 拒绝");
    console.log("双归属被 CHECK 拒绝");

    // ─── M3：引用为成果 ───────────────────────────────────────────
    const adoptable = await prisma.menteeProject.create({
      data: {
        batchId: batch.id,
        title: `验证用优秀毕设 ${suffix}`,
        kindId: kind.id,
        outcomeText: "获评校级优秀毕业设计",
      },
      select: { id: true },
    });
    const [certificate, evidence] = await Promise.all(
      (["CERTIFICATE", "PROCESS_EVIDENCE"] as const).map((attachmentKind) =>
        prisma.attachment.create({
          data: {
            menteeProjectId: adoptable.id,
            kind: attachmentKind,
            filename: `${attachmentKind}.pdf`,
            storagePath: `mentee-projects/${adoptable.id}/verify-${attachmentKind}-${suffix}.pdf`,
            size: 4,
            mimeType: "application/pdf",
          },
          select: { id: true },
        }),
      ),
    );

    const adopted = await adoptMenteeProjectAsAchievement(adoptable.id);
    assert(adopted.status === "adopted", `应引用成功，得到 ${adopted.status}`);
    createdAchievementIds.push(adopted.achievementId);

    const achievement = await prisma.achievement.findUniqueOrThrow({
      where: { id: adopted.achievementId },
      select: {
        type: true,
        title: true,
        isVerified: true,
        level: true,
        year: true,
        perfCategoryId: true,
        promotionCategoryId: true,
        usableFor: true,
      },
    });
    assert(achievement.type === "STUDENT_ACHIEVEMENT", "成果类型应是「指导学生」");
    assert(!achievement.isVerified, "引用出来的成果应落进「待核实」");
    assert(
      achievement.level === "UNRATED" &&
        achievement.year === null &&
        achievement.perfCategoryId === null &&
        achievement.promotionCategoryId === null &&
        achievement.usableFor.length === 0,
      "级别、年度、绩效小类、职称指标、用途一概不该预填",
    );
    assert(
      achievement.title.endsWith("：获评校级优秀毕业设计"),
      `标题应拿结项原文拼，得到「${achievement.title}」`,
    );

    // 证书跟着成果走、过程证据留下——且都还过得了单归属 CHECK
    const [movedCertificate, keptEvidence] = await Promise.all(
      [certificate.id, evidence.id].map((id) =>
        prisma.attachment.findUniqueOrThrow({
          where: { id },
          select: { menteeProjectId: true, achievementId: true },
        }),
      ),
    );
    assert(
      movedCertificate.achievementId === adopted.achievementId &&
        movedCertificate.menteeProjectId === null,
      "证书应改挂到成果上",
    );
    assert(
      keptEvidence.menteeProjectId === adoptable.id && keptEvidence.achievementId === null,
      "过程证据应留在项目上",
    );

    const again = await adoptMenteeProjectAsAchievement(adoptable.id);
    assert(
      again.status === "already-adopted" && again.achievementId === adopted.achievementId,
      "重复引用应拿回同一条成果，不建第二条",
    );

    const bare = await prisma.menteeProject.create({
      data: { batchId: batch.id, title: `没结项的题 ${suffix}`, kindId: kind.id },
      select: { id: true },
    });
    assert(
      (await adoptMenteeProjectAsAchievement(bare.id)).status === "no-outcome",
      "没填结项情况不该建成果",
    );

    // 台账那条删掉后项目指针置空（SetNull），证书随成果一起没了
    await prisma.achievement.delete({ where: { id: adopted.achievementId } });
    createdAchievementIds.length = 0;
    const afterDelete = await prisma.menteeProject.findUniqueOrThrow({
      where: { id: adoptable.id },
      select: { achievementId: true },
    });
    assert(afterDelete.achievementId === null, "删掉成果后项目的 achievementId 应置空");
    console.log("引用为成果：待核实、不预填口径、只搬证书、幂等、没结项不建");

    // 删项目：材料级联删，指导记录留下（SetNull）
    await prisma.menteeProject.delete({ where: { id: project.id } });
    const orphanAttachments = await prisma.attachment.count({
      where: { menteeProjectId: project.id },
    });
    assert(orphanAttachments === 0, "删项目后材料应级联清空");
    const keptRecord = await prisma.menteeRecord.findUnique({
      where: { id: guidance!.id },
      select: { projectId: true },
    });
    assert(keptRecord != null, "删项目不该把指导记录一起删掉");
    assert(keptRecord!.projectId === null, "删项目后记录的 projectId 应被置空");
    console.log("删项目：材料级联清空，指导记录留下且指针置空");

  } finally {
    if (createdAchievementIds.length > 0) {
      await prisma.achievement.deleteMany({ where: { id: { in: createdAchievementIds } } });
    }
    await prisma.menteeBatch.delete({ where: { id: batch.id } });
    await prisma.menteeRecordType.deleteMany({
      where: { name: { endsWith: `-${suffix}` } },
    });
    // 批次删了项目才没了，Restrict 的类型要排在它后面删
    await prisma.menteeProjectKind.deleteMany({
      where: { name: { endsWith: `-${suffix}` } },
    });
    const [mentees, records] = await Promise.all([
      prisma.mentee.count({ where: { batchId: batch.id } }),
      prisma.menteeRecord.count({ where: { batchId: batch.id } }),
    ]);
    assert(mentees === 0 && records === 0, `删批次后仍剩 ${mentees} 人 / ${records} 条记录`);
    console.log("临时批次已删，名单与记录级联清空");
  }

  console.log("verify:mentor-module 通过");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
