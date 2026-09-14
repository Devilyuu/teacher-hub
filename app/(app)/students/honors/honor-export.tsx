import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 荣誉的两个导出：汇总表（xlsx）和奖状包（zip）。
 * 原生 form POST，浏览器自己处理下载和文件名——
 * 不走 fetch 就没有「307 跟随重定向拿到登录页 HTML」那个坑。
 */
export function HonorExport({
  classGroupId,
  honorCount,
  certificateCount,
}: {
  classGroupId: string;
  honorCount: number;
  certificateCount: number;
}) {
  return (
    <>
      <form action="/api/export/student-honors" method="post">
        <input type="hidden" name="classGroupId" value={classGroupId} />
        <Button type="submit" size="sm" variant="secondary" disabled={honorCount === 0}>
          <Download className="size-3.5" aria-hidden />
          汇总表
        </Button>
      </form>
      <form action="/api/export/student-honor-zip" method="post">
        <input type="hidden" name="classGroupId" value={classGroupId} />
        <Button type="submit" size="sm" variant="secondary" disabled={certificateCount === 0}>
          <Download className="size-3.5" aria-hidden />
          奖状包
        </Button>
      </form>
    </>
  );
}
