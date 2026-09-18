/**
 * 记忆模块统一出口。
 *
 * 五模块划分（对齐 NextChat fork 验证过的架构）：
 *   store      — Prisma 读写集中层
 *   parser     — LLM 提取结果的宽容解析
 *   extractor  — 调用 LLM 提取记忆的完整流程
 *   dedupe     — 矛盾替换与去重
 *   relevance  — 注入相关性打分
 *   prompt     — 系统提示词格式化
 *   import-parser — 用户粘贴文本导入解析（独立功能）
 *
 * 对外 API 与拆分前保持一致，调用方无需感知内部结构。
 */

export { getCategoryLabel, buildMemorySystemPrompt } from "./prompt"
export { getRelevantMemories, toBigrams } from "./relevance"
export { saveExtractedMemories } from "./dedupe"
export { extractAndSaveMemories } from "./extractor"
export { parseMemoryArray, VALID_CATEGORIES, type ExtractedMemoryItem } from "./parser"
export {
  listAllMemoryFacts,
  listAllMemoryContents,
  createAutoMemory,
  deleteMemoriesByIds,
} from "./store"
