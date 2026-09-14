-- 数据迁移：把 tags 里明确表示「用途」的值搬进 usableFor。
--
-- 背景：存量 19 条成果的 tags 来自 Obsidian 的「可用于」列，那一列里两种东西混在
-- 一起——既有"职称评审""课题结题"这类**用途**，也有"AI教育方向""数字媒体方向"
-- 这类**主题**。用途要能筛选、要稳定，不能留在自由文本里。
--
-- **只搬这两个语义无歧义的值。** "论文写作""科研成果""课程建设""学生指导"
-- 到底是用途还是主题，从字面判断不了，交给人工，不由迁移脚本替他决定。
-- 原 tags 一个不删——判断错了还能回去看原文。

UPDATE "Achievement"
SET "usableFor" = array_append("usableFor", 'PROMOTION'::"AchievementUsage")
WHERE '职称评审' = ANY (tags)
  AND NOT ('PROMOTION'::"AchievementUsage" = ANY ("usableFor"));

UPDATE "Achievement"
SET "usableFor" = array_append("usableFor", 'PROJECT_CLOSING'::"AchievementUsage")
WHERE '课题结题' = ANY (tags)
  AND NOT ('PROJECT_CLOSING'::"AchievementUsage" = ANY ("usableFor"));

-- 已挂接到结题要求项上的成果，用途里必然包含"结题挂接"——这是事实不是判断
UPDATE "Achievement" a
SET "usableFor" = array_append(a."usableFor", 'PROJECT_CLOSING'::"AchievementUsage")
WHERE EXISTS (SELECT 1 FROM "RequirementLink" l WHERE l."achievementId" = a.id)
  AND NOT ('PROJECT_CLOSING'::"AchievementUsage" = ANY (a."usableFor"));
