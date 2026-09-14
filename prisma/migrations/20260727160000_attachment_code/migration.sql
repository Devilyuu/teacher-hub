-- AlterTable
-- 材料编号。年度申报包要求申报表、材料目录、ZIP 里的编号一致（prd-support 5）。
-- 线上绩效库里形如 1-1，导入时原样带过来。
-- 不设唯一约束：跨年度会重号，而且手工上传的附件本来就没有编号。
ALTER TABLE "Attachment" ADD COLUMN "code" TEXT;
