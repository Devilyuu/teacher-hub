import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { StudentTabs } from "@/components/student-tabs";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { formatFileSize } from "@/lib/format";
import { isModuleEnabled } from "@/lib/module-settings";
import { getHonorDetail } from "@/lib/queries/students";
import { updateHonor } from "../../actions";
import { HonorForm } from "../honor-form";
import { HonorAttachments } from "./honor-attachments";
import { HonorDelete } from "./honor-delete";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "荣誉详情" };

export default async function HonorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isModuleEnabled("advisor"))) {
    return <ModuleDisabledNotice moduleKey="advisor" />;
  }

  const honor = await getHonorDetail((await params).id);
  if (!honor) notFound();

  const students = await prisma.student.findMany({
    where: { classGroupId: honor.classGroupId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <StudentTabs />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">{honor.title}</h1>
          <p className="measure text-muted-foreground">{honor.classGroup.name}</p>
        </div>
        <HonorDelete honorId={honor.id} title={honor.title} />
      </header>

      <HonorForm
        action={updateHonor.bind(null, honor.id)}
        students={students}
        submitLabel="保存"
        dataVersion={honor.updatedAt.toISOString()}
        defaults={{
          title: honor.title,
          level: honor.level,
          issuer: honor.issuer,
          awardedAt: honor.awardedAt ? formatDateOnly(honor.awardedAt) : null,
          dateText: honor.dateText,
          note: honor.note,
          isCollective: honor.isCollective,
          memberIds: honor.members.map((member) => member.student.id),
        }}
      />

      <HonorAttachments
        honorId={honor.id}
        rows={honor.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          sizeText: formatFileSize(attachment.size),
        }))}
      />
    </div>
  );
}
