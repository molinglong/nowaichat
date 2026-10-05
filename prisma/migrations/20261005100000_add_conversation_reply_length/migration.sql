-- Conversation.replyLength: 回复长度档(minimal/short/standard/detailed)。
-- 把「篇幅」从风格预设的 verbosity 向量里拆成独立一根轴,支持「学者语气但只回三句」。
-- 可空:null 视为 standard,应用层不注入长度段落,存量会话行为不变。
-- IF NOT EXISTS 守卫:本地已手动执行或 db push 过的场景下 migrate deploy 可安全跳过。
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "replyLength" TEXT;
