-- Add streaming flag to Message table (A 流式恢复)
-- 生成开始即落 streaming=true 的 assistant 草稿行,流式过程中定期快照已生成文本;
-- onFinish 更新为最终内容并置 false;加载端点对超时草稿行兜底 finalize。

-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "streaming" BOOLEAN NOT NULL DEFAULT false;
