"use client";

import { useState } from "react";
import Link from "next/link";
import { Paperclip, Plus } from "lucide-react";
import { TeaCupArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { createHonor } from "../actions";
import { HonorForm } from "./honor-form";

export type HonorRow = {
  id: string;
  title: string;
  levelLabel: string;
  issuer: string | null;
  isCollective: boolean;
  memberNames: string[];
  dateLabel: string;
  attachmentCount: number;
};

export function HonorsPanel({
  classGroupId,
  students,
  rows,
}: {
  classGroupId: string;
  students: Array<{ id: string; name: string }>;
  rows: HonorRow[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {creating ? (
        <HonorForm
          action={createHonor.bind(null, classGroupId)}
          students={students}
          submitLabel="记录"
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            新增荣誉
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
          <TeaCupArt className="size-12 text-muted-foreground/60" />
          <p className="measure text-sm text-muted-foreground">
            班里同学的获奖、奖学金、集体荣誉都放这。平时随手记一条、拍张奖状，评优申报时一键导出汇总表和奖状包。
          </p>
        </div>
      ) : (
        <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/students/honors/${row.id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{row.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded border px-1.5 py-0.5">{row.levelLabel}</span>
                    <span>
                      {row.isCollective
                        ? "集体荣誉"
                        : row.memberNames.length > 0
                          ? row.memberNames.join("、")
                          : "未挂学生"}
                    </span>
                    {row.issuer ? <span>{row.issuer}</span> : null}
                    <span className="tabular-nums">{row.dateLabel}</span>
                  </p>
                </div>
                {row.attachmentCount > 0 ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                    <Paperclip className="size-3.5" aria-hidden />
                    {row.attachmentCount}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">缺奖状</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
