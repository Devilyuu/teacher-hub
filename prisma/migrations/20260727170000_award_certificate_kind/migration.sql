-- AlterEnum
-- 台账里「获奖证书」是最常见的支撑材料，但原枚举只有 CERTIFICATE（结题证书）。
-- 用后者装获奖证书，界面上会把「省赛二等奖证书」显示成「结题证书」，是错的。
ALTER TYPE "AttachmentKind" ADD VALUE IF NOT EXISTS 'AWARD_CERTIFICATE' AFTER 'CERTIFICATE';
