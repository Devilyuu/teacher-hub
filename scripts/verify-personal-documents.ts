import "dotenv/config";
import { prisma } from "../lib/db";
import {
  CATEGORY_FK,
  classifyCategoryRestrictError,
  classifyOwnerCheckError,
  OWNER_CHECK,
} from "../lib/verification/personal-documents";

const ROLLBACK = new Error("VERIFY_PERSONAL_DOCUMENTS_ROLLBACK");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const OWNER_CASES = [
  { bits: "000", project: false, achievement: false, category: false, accepted: false },
  { bits: "001", project: false, achievement: false, category: true, accepted: true },
  { bits: "010", project: false, achievement: true, category: false, accepted: true },
  { bits: "011", project: false, achievement: true, category: true, accepted: false },
  { bits: "100", project: true, achievement: false, category: false, accepted: true },
  { bits: "101", project: true, achievement: false, category: true, accepted: false },
  { bits: "110", project: true, achievement: true, category: false, accepted: false },
  { bits: "111", project: true, achievement: true, category: true, accepted: false },
] as const;

type OwnerBits = (typeof OWNER_CASES)[number]["bits"];
type Rejection = ReturnType<typeof classifyOwnerCheckError>;
type CombinationFinding =
  | { expected: "accepted"; result: "accepted"; ownerCount: 1 }
  | { expected: "rejected"; result: "rejected"; rejection: Rejection };

type SchemaState = {
  docCategoryTable: boolean;
  singleOwnerDefinition: string | null;
  categoryDeleteRestrict: boolean;
};

type Findings = {
  ownerCombinations: Record<OwnerBits, CombinationFinding>;
  categoryDelete: ReturnType<typeof classifyCategoryRestrictError>;
};

async function main() {
  const [schema] = await prisma.$queryRaw<SchemaState[]>`
    SELECT
      to_regclass('"DocCategory"') IS NOT NULL AS "docCategoryTable",
      (
        SELECT pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE conname = ${OWNER_CHECK}
          AND conrelid = '"Attachment"'::regclass
      ) AS "singleOwnerDefinition",
      COALESCE(
        (
          SELECT confdeltype = 'r'
          FROM pg_constraint
          WHERE conname = ${CATEGORY_FK}
            AND conrelid = '"Attachment"'::regclass
        ),
        false
      ) AS "categoryDeleteRestrict"
  `;

  assert(schema?.docCategoryTable, "DocCategory 表不存在");
  assert(schema.singleOwnerDefinition, `${OWNER_CHECK} 不存在`);
  assert(schema.categoryDeleteRestrict, `${CATEGORY_FK} 不是 ON DELETE RESTRICT`);

  const suffix = crypto.randomUUID();
  const fixtures = {
    projectId: `verify-personal-project-${suffix}`,
    achievementId: `verify-personal-achievement-${suffix}`,
    categoryId: `verify-personal-category-${suffix}`,
    attachments: Object.fromEntries(
      OWNER_CASES.map(({ bits }) => [
        bits,
        {
          id: `verify-personal-attachment-${bits}-${suffix}`,
          storagePath: `verify-personal-documents/${suffix}/${bits}`,
        },
      ]),
    ) as Record<OwnerBits, { id: string; storagePath: string }>,
  };

  let findings: Findings | undefined;

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.project.create({
          data: { id: fixtures.projectId, title: `个人文档归属验证课题 ${suffix}` },
        });
        await tx.achievement.create({
          data: {
            id: fixtures.achievementId,
            type: "OTHER",
            title: `个人文档归属验证成果 ${suffix}`,
            tags: [],
            usableFor: [],
          },
        });
        await tx.docCategory.create({
          data: { id: fixtures.categoryId, name: `个人文档归属验证分类 ${suffix}` },
        });

        async function rejectedAtSavepoint(
          savepoint: string,
          operation: () => Promise<unknown>,
          classify: (error: unknown) => Rejection,
        ) {
          await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
          let error: unknown;
          try {
            await operation();
          } catch (caught) {
            error = caught;
          }
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
          assert(error, `${savepoint} 的违规操作被数据库错误接受`);
          return classify(error);
        }

        const ownerCombinations = {} as Record<OwnerBits, CombinationFinding>;
        for (const ownerCase of OWNER_CASES) {
          const fixture = fixtures.attachments[ownerCase.bits];
          const data = {
            id: fixture.id,
            projectId: ownerCase.project ? fixtures.projectId : null,
            achievementId: ownerCase.achievement ? fixtures.achievementId : null,
            docCategoryId: ownerCase.category ? fixtures.categoryId : null,
            filename: `${ownerCase.bits}.pdf`,
            storagePath: fixture.storagePath,
            size: 1,
            mimeType: "application/pdf",
          };

          if (ownerCase.accepted) {
            const created = await tx.attachment.create({
              data,
              select: { projectId: true, achievementId: true, docCategoryId: true },
            });
            const ownerCount = [created.projectId, created.achievementId, created.docCategoryId].filter(
              (owner) => owner != null,
            ).length;
            assert(ownerCount === 1, `${ownerCase.bits} 写入后不是恰好一个 owner`);
            assert(
              created.projectId === data.projectId &&
                created.achievementId === data.achievementId &&
                created.docCategoryId === data.docCategoryId,
              `${ownerCase.bits} 写入后的 owner 字段与输入不一致`,
            );
            ownerCombinations[ownerCase.bits] = {
              expected: "accepted",
              result: "accepted",
              ownerCount: 1,
            };
          } else {
            const rejection = await rejectedAtSavepoint(
              `verify_personal_owner_${ownerCase.bits}`,
              () => tx.attachment.create({ data }),
              classifyOwnerCheckError,
            );
            ownerCombinations[ownerCase.bits] = {
              expected: "rejected",
              result: "rejected",
              rejection,
            };
          }
        }

        const acceptedBits = OWNER_CASES.filter(({ accepted }) => accepted).map(({ bits }) => bits);
        assert(
          acceptedBits.join(",") === "001,010,100",
          `合法 owner 组合定义错误：${acceptedBits.join(",")}`,
        );

        const categoryDelete = await rejectedAtSavepoint(
          "verify_personal_category_restrict",
          () => tx.docCategory.delete({ where: { id: fixtures.categoryId } }),
          classifyCategoryRestrictError,
        );
        const categoryStillExists = await tx.docCategory.findUnique({
          where: { id: fixtures.categoryId },
          select: { id: true },
        });
        assert(categoryStillExists?.id === fixtures.categoryId, "RESTRICT 失败后分类没有保留");

        findings = { ownerCombinations, categoryDelete };
        throw ROLLBACK;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  assert(findings, "个人文档真实库验证没有跑完");

  const [projectLeft, achievementLeft, categoryLeft] = await Promise.all([
    prisma.project.findUnique({ where: { id: fixtures.projectId }, select: { id: true } }),
    prisma.achievement.findUnique({ where: { id: fixtures.achievementId }, select: { id: true } }),
    prisma.docCategory.findUnique({ where: { id: fixtures.categoryId }, select: { id: true } }),
  ]);
  const attachmentIdsLeft = (
    await Promise.all(
      OWNER_CASES.map(({ bits }) =>
        prisma.attachment.findUnique({
          where: { id: fixtures.attachments[bits].id },
          select: { id: true },
        }),
      ),
    )
  ).flatMap((attachment) => (attachment ? [attachment.id] : []));
  const attachmentStoragePathsLeft = (
    await Promise.all(
      OWNER_CASES.map(({ bits }) =>
        prisma.attachment.findUnique({
          where: { storagePath: fixtures.attachments[bits].storagePath },
          select: { storagePath: true },
        }),
      ),
    )
  ).flatMap((attachment) => (attachment ? [attachment.storagePath] : []));

  const fixtureRowsLeftBehind = {
    projects: projectLeft ? [projectLeft.id] : [],
    achievements: achievementLeft ? [achievementLeft.id] : [],
    docCategories: categoryLeft ? [categoryLeft.id] : [],
    attachmentIds: attachmentIdsLeft,
    attachmentStoragePaths: attachmentStoragePathsLeft,
  };
  for (const [fixtureType, leftovers] of Object.entries(fixtureRowsLeftBehind)) {
    assert(leftovers.length === 0, `事务回滚失败，${fixtureType} 仍有 fixture：${leftovers.join(",")}`);
  }

  console.log(JSON.stringify({ status: "pass", schema, ...findings, fixtureRowsLeftBehind }));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
