"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteHonor } from "../../actions";

export function HonorDelete({
  honorId,
  classGroupId,
  title,
}: {
  honorId: string;
  classGroupId: string;
  title: string;
}) {
  const router = useRouter();

  return (
    <form
      action={async () => {
        await deleteHonor(honorId);
        // 回荣誉列表要带上班级，否则带两个班的老师会被送回默认班
        router.push(`/students/honors?class=${encodeURIComponent(classGroupId)}`);
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={(event) => {
          if (!confirm(`删除「${title}」？挂在上面的奖状文件会一并删除。`))
            event.preventDefault();
        }}
      >
        删除
      </Button>
    </form>
  );
}
