"use client";

import { useState, useTransition } from "react";
import { setMenteeRecordProject } from "../actions";

const selectClass =
  "h-7 max-w-[13rem] rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60";

/**
 * 行内把一条记录挂到项目上 / 摘下来。
 *
 * **这个入口不能省**：`projectId` 是答辩季那张「一人一张的毕设指导记录表」
 * 唯一的筛选依据，而随手记下的那条（尤其从速记归类过来的）多半还没挂。
 * 只能在新建时选的话，那张表永远漏一半。
 *
 * 原生 `<select>` + 一改就提交：这是个订正动作，再加个「保存」按钮
 * 就变成两步了。失败时把选择弹回原值并显示原因——静默失败最糟。
 */
export function RecordProjectPicker({
  recordId,
  projectId,
  projects,
}: {
  recordId: string;
  projectId: string | null;
  projects: Array<{ id: string; title: string }>;
}) {
  const [value, setValue] = useState(projectId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (projects.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label="挂到哪个项目"
        className={selectClass}
        value={value}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const result = await setMenteeRecordProject(recordId, next);
            if (result.ok === false) {
              setValue(previous);
              setError(result.message ?? "没改成");
            }
          });
        }}
      >
        <option value="">不挂项目</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.title}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
