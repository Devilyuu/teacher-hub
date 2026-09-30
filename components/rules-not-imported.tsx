import Link from "next/link";

const RULES = {
  promotion: { name: "职称量化表", table: "promotion" },
  perf: { name: "绩效对照表", table: "perf" },
} as const;

/**
 * 分类表还没导入时，下拉框位置上的那句话。课题表单、成果表单三处共用。
 *
 * 原来说「导入是部署时的一步，找维护这套系统的人做一次就好」——那时只有命令行能导。
 * 现在设置页就能粘贴表格导入（2026-09-27），直接给个链接过去。
 *
 * 校验永远不阻止保存（第 3 条铁律），所以这里只说明、不拦。
 */
export function RulesNotImported({ table }: { table: keyof typeof RULES }) {
  const rule = RULES[table];
  return (
    <p className="measure text-xs text-muted-foreground">
      还没导入{rule.name}，这里暂时没有选项。先照常保存，
      <Link
        href={`/settings/rules?table=${rule.table}`}
        className="text-foreground underline underline-offset-4"
      >
        去导入
      </Link>
      （把学校的表格复制粘贴进来即可），导入后再回来补。
    </p>
  );
}
