export const PROFILE_TABS = [
  { value: "profile", label: "基本信息" },
  { value: "documents", label: "常用文档" },
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number]["value"];

export function resolveProfileTab(value: string | string[] | undefined): ProfileTab {
  return value === "documents" ? "documents" : "profile";
}

type CategoryLike = { id: string; name: string; sortOrder: number };
type PersonalDocumentLike = { id: string; docCategoryId: string; uploadedAt: Date };

export function groupPersonalDocumentsByCategory<
  TCategory extends CategoryLike,
  TDocument extends PersonalDocumentLike,
>(categories: TCategory[], documents: TDocument[]) {
  return [...categories]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    .map((category) => ({
      category,
      items: documents
        .filter((document) => document.docCategoryId === category.id)
        .sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime()),
    }))
    .filter((group) => group.items.length > 0);
}

/** 文件名不进 URL，Route Handler 从附件记录中恢复 Content-Disposition 文件名。 */
export function attachmentDownloadHref(attachmentId: string, _filename?: string): string {
  return `/api/attachments/${attachmentId}?download=1`;
}
