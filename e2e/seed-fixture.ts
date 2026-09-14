import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
const runId = process.env.E2E_RUN_ID;
if (!connectionString || !runId) throw new Error("E2E fixture requires runner-generated configuration");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const year = Number(process.env.E2E_YEAR ?? new Date().getFullYear());

async function main() {
  const category = await prisma.perfCategory.upsert({
    where: { year_majorCategory_minorCategory: { year, majorCategory: "E2E", minorCategory: `browser-${runId}` } },
    update: { isActive: true },
    create: {
      year,
      majorCategory: "E2E",
      minorCategory: `browser-${runId}`,
      collegeRule: "E2E fixture only",
      sortOrder: 999999,
    },
  });
  console.log(JSON.stringify({ perfCategoryId: category.id, year }));
}

main().finally(() => prisma.$disconnect());
