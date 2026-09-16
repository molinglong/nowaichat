/**
 * 内置生图模型动态配置
 *
 * 增删模型只需要编辑这个文件，无需改动 image.ts 的分发逻辑。
 *
 * 添加新模型步骤：
 * 1. 在 BUILTIN_IMAGE_MODELS 数组里追加一项
 * 2. 如需新 provider 类型,在 image.ts 里新增分发函数并扩展 generateImage()
 *
 * 字段说明:
 *   id          全局唯一 ID,前端用此 ID 切换模型
 *   name        显示名称(中文友好)
 *   provider    服务商标识,匹配 ApiKey 表的 provider 字段
 *   modelId     实际传给 API 的模型名
 *   baseURL?    OpenAI 兼容 / Stability 端点需要,通义万相不需要
 *   adapter     调用适配器:
 *                 "qianwen"   通义千问/百炼异步任务
 *                 "openai"    OpenAI 官方 / OpenAI 兼容端点
 *                 "stability" Stability AI
 *   sizes       支持的尺寸列表(第一个为默认)
 *   supportsSize 多数模型固定支持,部分模型(如 DALL·E 2)不支持任意比例
 *   desc        简短描述,前端展示
 *   badge       角标,可为空
 */

export type ImageProvider = "qianwen" | "openai" | "stability"

export type ImageAdapter = "qianwen" | "qianwen-edit" | "openai" | "stability"

export interface BuiltinImageModel {
  id: string
  name: string
  provider: ImageProvider
  adapter: ImageAdapter
  modelId: string
  baseURL?: string
  sizes: string[]
  supportsSize: boolean
  desc: string
  badge?: string
  /** 是否支持二创(img2img / inpaint);二创模型不在主生成器中显示 */
  supportsEdit?: boolean
}

export const BUILTIN_IMAGE_MODELS: BuiltinImageModel[] = [
  {
    id: "builtin:wanx2.1-t2i-turbo",
    name: "通义万相 · 极速版",
    provider: "qianwen",
    adapter: "qianwen",
    modelId: "wanx2.1-t2i-turbo",
    sizes: ["1024*1024", "720*1280", "1280*720"],
    supportsSize: true,
    desc: "极速出图，性价比高",
    badge: "turbo",
  },
  {
    id: "builtin:wanx2.1-t2i-plus",
    name: "通义万相 · 高清版",
    provider: "qianwen",
    adapter: "qianwen",
    modelId: "wanx2.1-t2i-plus",
    sizes: ["1024*1024", "720*1280", "1280*720"],
    supportsSize: true,
    desc: "画质更精细，速度稍慢",
    badge: "plus",
  },
  {
    id: "builtin:dall-e-3",
    name: "DALL·E 3",
    provider: "openai",
    adapter: "openai",
    modelId: "dall-e-3",
    baseURL: "https://api.openai.com/v1",
    sizes: ["1024*1024", "1024x1792", "1792x1024"],
    supportsSize: true,
    desc: "OpenAI 最新图像生成",
    badge: "openai",
  },
  {
    id: "builtin:dall-e-2",
    name: "DALL·E 2",
    provider: "openai",
    adapter: "openai",
    modelId: "dall-e-2",
    baseURL: "https://api.openai.com/v1",
    sizes: ["256x256", "512x512", "1024*1024"],
    supportsSize: true,
    desc: "经典图像生成模型",
    badge: "openai",
  },
  {
    id: "builtin:stable-diffusion-xl",
    name: "Stable Diffusion XL",
    provider: "stability",
    adapter: "stability",
    modelId: "stable-diffusion-xl-1024-v1-0",
    sizes: ["1024*1024", "1152x896", "1216x832", "1344x768", "1536x640"],
    supportsSize: true,
    desc: "Stability AI 开源模型",
    badge: "stability",
  },
  {
    // 二次创作专用模型(千问 image-edit):支持以图生图 + 局部重绘 + 变体
    // 不在「主生成」下拉中显示,仅在预览标题栏的「二创」面板里出现
    id: "builtin:qwen-image-edit",
    name: "通义千问 · 图像编辑",
    provider: "qianwen",
    adapter: "qianwen-edit",
    modelId: "qwen-image-edit",
    sizes: ["1024*1024", "720*1280", "1280*720"],
    supportsSize: false,
    desc: "以图生图、局部重绘、生成变体",
    badge: "edit",
    supportsEdit: true,
  },
]

/** 通过 ID 查模型(内部使用) */
export function findBuiltinModel(id: string): BuiltinImageModel | undefined {
  return BUILTIN_IMAGE_MODELS.find((m) => m.id === id)
}
