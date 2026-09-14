import type { ProfileTab } from "@/lib/personal-documents";
import { prisma } from "@/lib/db";

export async function loadProfilePageData(tab: ProfileTab) {
  if (tab === "profile") {
    return { tab, profile: await prisma.profile.findFirst() } as const;
  }

  const [categories, attachments] = await Promise.all([
    prisma.docCategory.findMany({
      select: { id: true, name: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.attachment.findMany({
      where: { docCategoryId: { not: null }, projectId: null, achievementId: null },
      select: {
        id: true,
        docCategoryId: true,
        filename: true,
        size: true,
        note: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: "desc" },
    }),
  ]);

  return { tab, categories, attachments } as const;
}
