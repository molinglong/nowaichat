/**
 * 面具共享类型 + 输入校验 schema（client/server 通用，无 server 依赖）。
 *
 * maskId 引用规则：
 * - 内置面具：裸 id（'translator' 等，见 builtin-masks.ts）
 * - 用户面具：'user:<cuid>' 前缀 + Mask 表主键
 */
import { z } from 'zod'

export const USER_MASK_PREFIX = 'user:'

export interface MaskFewShotTurn {
  role: 'user' | 'assistant'
  content: string
}

/** 前端 DTO（masks API 返回 / 表单提交形状） */
export interface MaskDTO {
  /** 完整引用 user:<cuid>，可直接用作 maskId */
  id: string
  /** 裸 cuid，PATCH/DELETE 路径参数用 */
  rowId: string
  name: string
  avatar: string
  description: string
  systemPrompt: string
  fewShot: MaskFewShotTurn[]
  stylePreset: string | null
  updatedAt: string
}

const fewShotTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
})

/** 创建/更新面具的输入校验（表单全量提交） */
export const maskInputSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(30, '名称最多 30 字'),
  avatar: z.string().min(1, '头像不能为空').max(4, '头像最多 2 个字符'),
  description: z.string().trim().max(50, '描述最多 50 字'),
  systemPrompt: z.string().trim().min(1, '人格指令不能为空').max(8000, '人格指令最多 8000 字'),
  fewShot: z.array(fewShotTurnSchema).max(8).optional(),
  stylePreset: z.string().max(20).nullable().optional(),
})
