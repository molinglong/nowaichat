-- 为 Message.content 添加 pg_trgm GIN 索引,以加速全文检索式模糊查询
-- (LIKE '%keyword%' / ILIKE '%keyword%' 也能命中此索引)。
-- 由 /api/conversations 的标题+消息联合搜索使用,解决千/万级消息下
-- Seq Scan 性能问题。
--
-- 同时为 Message.content / Message.reasoning 一起建索引,因为 SearchDialog
-- 渲染命中片段时,如果命中 reasoning 也需要高亮展示。

-- EnableExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
-- 注意: pg_trgm 的 GIN 索引支持 LIKE / ILIKE 任意位置通配查询,
--      比 B-tree 更适合"内容包含关键词"的搜索模式。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_content_trgm_idx"
  ON "Message" USING GIN (content gin_trgm_ops);
