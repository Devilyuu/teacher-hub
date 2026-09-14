/**
 * 课题标题的统一显示口径：简称有值时优先，否则回落到全称。
 *
 * 纯结题报告已改为课题材料，不再由课题预填 Achievement；
 * 本文件只保留仍由课题详情页消费的显示名逻辑。
 */
export function projectDisplayName(project: {
  title: string;
  shortTitle: string | null;
}): string {
  return project.shortTitle?.trim() || project.title.trim();
}
