import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { nanoid } from "nanoid"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/crypto"
import {
  BUILTIN_IMAGE_MODELS,
  type BuiltinImageModel,
  type ImageProvider,
  type ImageAdapter,
} from "./image-models.config"

// 兼容旧调用方
export const BUILTIN_MODELS = BUILTIN_IMAGE_MODELS

export type BuiltinModelId = string
export type { BuiltinImageModel, ImageProvider }

export function getBuiltinModel(id: string): BuiltinImageModel | undefined {
  return BUILTIN_IMAGE_MODELS.find((m) => m.id === id)
}

export const IMG_MARKER_REGEX = /\[IMG:([^\]]+)\]/g

const MAX_WAIT_MS = 45_000
const POLL_INTERVAL_MS = 2_000
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// 统一返回类型
export interface GenerationResult {
  url: string
  model: string
  width: number
  height: number
}

/** 根据 modelId 判断 provider 类型 */
function getProviderType(modelId: string): "builtin" | "custom" {
  return modelId.startsWith("builtin:") ? "builtin" : "custom"
}

// ─── 通义万相 (qianwen) ────────────────────────────────────────────────────────
async function generateWanx(
  prompt: string,
  apiKey: string,
  modelId: string,
  size?: string
): Promise<GenerationResult> {
  const BASE = "https://dashscope.aliyuncs.com/api/v1"
  const selectedSize = size || "1024*1024"
  const [width, height] = selectedSize.split("*").map(Number)

  const createRes = await fetch(`${BASE}/services/aigc/text2image/image-synthesis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: modelId,
      input: { prompt: prompt.slice(0, 500) },
      parameters: { size: selectedSize, n: 1 },
    }),
  })

  const createJson = (await createRes.json().catch(() => ({}))) as {
    output?: { task_id?: string; message?: string }
    message?: string
  }
  const taskId = createJson.output?.task_id
  if (!createRes.ok || !taskId) {
    const msg = createJson.output?.message || createJson.message || `HTTP ${createRes.status}`
    throw new Error(`创建图片任务失败: ${msg}`)
  }

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const pollRes = await fetch(`${BASE}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const pollJson = (await pollRes.json().catch(() => ({}))) as {
      output?: { task_status?: string; results?: { url?: string }[]; message?: string; code?: string }
    }
    const status = pollJson.output?.task_status
    if (status === "SUCCEEDED") {
      const url = pollJson.output?.results?.[0]?.url
      if (!url) throw new Error("图片生成成功,但未返回图片链接")
      const saved = await downloadAndSave(url)
      return { url: saved, model: modelId, width, height }
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(`图片生成失败: ${pollJson.output?.message || pollJson.output?.code || "未知原因"}`)
    }
  }
  throw new Error("图片生成超时,请稍后重试")
}

// ─── OpenAI 兼容端点 (DALL-E / SDXL / 自定义) ─────────────────────────────────
async function generateOpenAICompatible(
  prompt: string,
  apiKey: string,
  modelId: string,
  baseURL: string,
  size?: string
): Promise<GenerationResult> {
  // 统一格式: size → width x height
  const sizeMap: Record<string, { width: number; height: number }> = {
    "1024*1024": { width: 1024, height: 1024 },
    "720*1280": { width: 720, height: 1280 },
    "1280*720": { width: 1280, height: 720 },
    "1024x1024": { width: 1024, height: 1024 },
    "1024x1792": { width: 1024, height: 1792 },
    "1792x1024": { width: 1792, height: 1024 },
    "256x256": { width: 256, height: 256 },
    "512x512": { width: 512, height: 512 },
    "1152x896": { width: 1152, height: 896 },
    "1216x832": { width: 1216, height: 832 },
    "1344x768": { width: 1344, height: 768 },
    "1536x640": { width: 1536, height: 640 },
  }
  const sizeKey = size || "1024*1024"
  const { width, height } = sizeMap[sizeKey] ?? { width: 1024, height: 1024 }

  // DALL-E / gpt-image-* 用 size 字段；SDXL / Stable Diffusion 等用 width/height
  const isDalle = modelId.startsWith("dall-e")
  const isGptImage = modelId.startsWith("gpt-image")
  const useSize = isDalle || isGptImage
  const endpoint = baseURL.replace(/\/$/, "") + "/images/generations"

  const body: Record<string, unknown> = {
    model: modelId,
    prompt: prompt.slice(0, 4000),
    n: 1,
  }

  if (useSize) {
    // DALL-E / gpt-image: 用 size 字段
    body.size = sizeKey.replace("*", "x")
  } else {
    // SDXL / Stable Diffusion 等: 用 width/height
    body.width = width
    body.height = height
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json().catch(() => ({}))) as {
    data?: { url?: string; b64_json?: string }[]
    error?: { message?: string }
  }
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `HTTP ${res.status}`)
  }
  const item = json.data?.[0]
  if (!item) throw new Error("图片生成成功但无返回数据")

  if (item.url) {
    const saved = await downloadAndSave(item.url)
    return { url: saved, model: modelId, width, height }
  }
  if (item.b64_json) {
    const saved = await saveBase64(item.b64_json)
    return { url: saved, model: modelId, width, height }
  }
  throw new Error("图片生成成功但无 URL 或 base64 数据")
}

// ─── Gemini 原生端点 + 参考图 ─────────────────────────────────────────────────
async function generateGeminiWithReference(
  prompt: string,
  apiKey: string,
  modelId: string,
  baseURL: string,
  referenceImageDataUrl: string,
  size?: string
): Promise<GenerationResult> {
  // size → Gemini aspectRatio
  const sizeMap: Record<string, string> = {
    "1024*1024": "1:1",
    "720*1280": "9:16",
    "1280*720": "16:9",
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "256x256": "1:1",
    "512x512": "1:1",
    "1152x896": "9:16",
    "1216x832": "19:13",
    "1344x768": "7:4",
    "1536x640": "12:5",
  }
  const aspectRatio = sizeMap[size || "1024*1024"] || "1:1"

  // base64 → data URL
  const mimeMatch = referenceImageDataUrl.match(/^data:([^;]+);/)
  const mime = mimeMatch ? mimeMatch[1] : "image/png"
  const base64Data = referenceImageDataUrl.replace(/^data:[^;]+;base64,/, "")

  // 构建 Gemini generateContent 请求体(带图片)
  const endpoint =
    baseURL.replace(/\/$/, "") +
    "/models/" +
    modelId +
    ":generateContent?key=" +
    apiKey

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt.slice(0, 4000) },
          {
            inline_data: {
              mime_type: mime,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      aspectRatio,
    },
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json().catch(() => ({}))) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }>
      }
    }>
    error?: { message?: string }
  }

  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `HTTP ${res.status}`)
  }

  const parts = json.candidates?.[0]?.content?.parts ?? []
  let imageBase64: string | null = null
  let width = 1024
  let height = 1024

  for (const part of parts) {
    if (part.inlineData?.data) {
      imageBase64 = part.inlineData.data
      // 从 mime 类型和 aspectRatio 反推尺寸
      const isJpeg = part.inlineData.mimeType?.includes("jpeg") || part.inlineData.mimeType?.includes("jpg")
      const isPng = part.inlineData.mimeType?.includes("png")
      if (isJpeg) {
        // 假设 jpeg 是 16:9
        width = 1792; height = 1008
      } else if (isPng) {
        // PNG 1:1
        width = 1024; height = 1024
      } else {
        width = 1024; height = 1024
      }
      break
    }
  }

  if (!imageBase64) {
    // Gemini 有时候返回纯文本,说明不支持该尺寸或模型
    throw new Error(
      "Gemini 返回了文本而非图片,请尝试切换尺寸或确认模型支持图像生成"
    )
  }

  const saved = await saveBase64(imageBase64)
  return { url: saved, model: modelId, width, height }
}

// ─── OpenAI 兼容端点 + 参考图 ─────────────────────────────────────────────────
async function generateOpenAIWithReference(
  prompt: string,
  apiKey: string,
  modelId: string,
  baseURL: string,
  referenceImageDataUrl: string,
  size?: string
): Promise<GenerationResult> {
  const sizeMap: Record<string, { width: number; height: number }> = {
    "1024*1024": { width: 1024, height: 1024 },
    "720*1280": { width: 720, height: 1280 },
    "1280*720": { width: 1280, height: 720 },
    "1024x1024": { width: 1024, height: 1024 },
    "1024x1792": { width: 1024, height: 1792 },
    "1792x1024": { width: 1792, height: 1024 },
    "256x256": { width: 256, height: 256 },
    "512x512": { width: 512, height: 512 },
    "1152x896": { width: 1152, height: 896 },
    "1216x832": { width: 1216, height: 832 },
    "1344x768": { width: 1344, height: 768 },
    "1536x640": { width: 1536, height: 640 },
  }
  const sizeKey = size || "1024*1024"
  const { width, height } = sizeMap[sizeKey] ?? { width: 1024, height: 1024 }

  const isDalle = modelId.startsWith("dall-e")
  const isGptImage = modelId.startsWith("gpt-image")
  const useSize = isDalle || isGptImage
  const endpoint = baseURL.replace(/\/$/, "") + "/images/generations"

  const body: Record<string, unknown> = {
    model: modelId,
    images: [referenceImageDataUrl],
    prompt: prompt.slice(0, 4000),
    n: 1,
  }

  if (useSize) {
    body.size = sizeKey.replace("*", "x")
  } else {
    body.width = width
    body.height = height
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json().catch(() => ({}))) as {
    data?: { url?: string; b64_json?: string }[]
    error?: { message?: string }
  }
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `HTTP ${res.status}`)
  }
  const item = json.data?.[0]
  if (!item) throw new Error("图片生成成功但无返回数据")

  if (item.url) {
    const saved = await downloadAndSave(item.url)
    return { url: saved, model: modelId, width, height }
  }
  if (item.b64_json) {
    const saved = await saveBase64(item.b64_json)
    return { url: saved, model: modelId, width, height }
  }
  throw new Error("图片生成成功但无 URL 或 base64 数据")
}

// ─── Stability AI ──────────────────────────────────────────────────────────────
async function generateStability(
  prompt: string,
  apiKey: string,
  modelId: string,
  size?: string
): Promise<GenerationResult> {
  const sizeMap: Record<string, { width: number; height: number }> = {
    "1024x1024": { width: 1024, height: 1024 },
    "1152x896": { width: 1152, height: 896 },
    "1216x832": { width: 1216, height: 832 },
    "1344x768": { width: 1344, height: 768 },
    "1536x640": { width: 1536, height: 640 },
  }
  const sizeKey = size || "1024x1024"
  const { width, height } = sizeMap[sizeKey] ?? { width: 1024, height: 1024 }

  const res = await fetch("https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: JSON.stringify({
      text_prompts: [{ text: prompt.slice(0, 4000) }],
      cfg_scale: 7,
      height,
      width,
      samples: 1,
      steps: 30,
    }),
  })

  const json = (await res.json().catch(() => ({}))) as {
    artifacts?: { base64?: string; finishReason?: string }[]
    error?: { message?: string }
  }
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `HTTP ${res.status}`)
  }
  const artifact = json.artifacts?.[0]
  if (!artifact?.base64) throw new Error("图片生成失败或无返回")
  const saved = await saveBase64(artifact.base64)
  return { url: saved, model: modelId, width, height }
}

// ─── 统一入口 ─────────────────────────────────────────────────────────────────

/**
 * 根据 modelId 加载模型配置，解析 API Key，然后按 adapter 分发。
 *
 * 内置模型配置来自 image-models.config.ts,新增模型无需改动本函数。
 * 自定义模型按 baseURL 自动选择 adapter。
 */
export async function generateImage(
  userId: string,
  modelId: string,
  prompt: string,
  size?: string
): Promise<GenerationResult> {
  const providerType = getProviderType(modelId)

  let apiKey: string | undefined
  let actualModelId: string
  let baseURL: string | undefined
  let adapter: ImageAdapter
  let providerKey: string

  if (providerType === "builtin") {
    const builtin = getBuiltinModel(modelId)
    if (!builtin) throw new Error(`未知的内置模型: ${modelId}`)
    actualModelId = builtin.modelId
    baseURL = builtin.baseURL
    adapter = builtin.adapter
    providerKey = builtin.provider

    apiKey = await resolveProviderKey(userId, providerKey)
    if (!apiKey) throw new Error(`未配置 ${providerKey} API Key，请先在设置中配置`)
  } else {
    // custom: 从数据库加载用户自定义模型配置
    // custom:xxxx 里的 xxxx 是 ImageModel 表的主键 id
    const dbId = modelId.startsWith("custom:") ? modelId.slice(7) : modelId
    const customModel = await prisma.imageModel.findFirst({
      where: { id: dbId, userId },
    })
    if (!customModel) throw new Error(`未找到自定义模型配置: ${modelId}`)

    actualModelId = customModel.modelId
    baseURL = customModel.baseURL

    // 解析 API Key
    if (customModel.apiKeySource === "own" && customModel.apiKey) {
      apiKey = decrypt(customModel.apiKey)
    } else if (customModel.keyProvider) {
      apiKey = await resolveProviderKey(userId, customModel.keyProvider)
    }
    if (!apiKey) throw new Error("未找到有效的 API Key，请检查模型配置")

    // 自定义模型按 baseURL 自动选 adapter
    if (baseURL.toLowerCase().includes("stability")) {
      adapter = "stability"
    } else {
      adapter = "openai"
    }
    providerKey = customModel.keyProvider ?? "custom"
  }

  // 按 adapter 分发(查表式,新增 adapter 只需加一条)
  return dispatchAdapter({
    adapter,
    prompt,
    apiKey,
    actualModelId,
    baseURL,
    size,
    providerKey,
  })
}

/** 查 Key:数据库优先,环境变量兜底 */
async function resolveProviderKey(
  userId: string,
  provider: string
): Promise<string | undefined> {
  const keyRec = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  if (keyRec) return decrypt(keyRec.encryptedKey)
  const envMap: Record<string, string | undefined> = {
    qianwen: process.env.API_KEY_DASHSCOPE,
    openai: process.env.OPENAI_API_KEY,
    stability: process.env.STABILITY_API_KEY,
  }
  return envMap[provider] || undefined
}

/** adapter 路由表 —— 新增 provider 时只需在这里加一项 */
async function dispatchAdapter(args: {
  adapter: ImageAdapter
  prompt: string
  apiKey: string
  actualModelId: string
  baseURL?: string
  size?: string
  providerKey: string
}): Promise<GenerationResult> {
  const { adapter, prompt, apiKey, actualModelId, baseURL, size } = args

  switch (adapter) {
    case "qianwen":
      return generateWanx(prompt, apiKey, actualModelId, size)
    case "qianwen-edit":
      throw new Error("qianwen-edit adapter 仅用于二创流程,请走 editImage()")
    case "openai": {
      if (!baseURL) throw new Error("OpenAI 兼容端点缺少 baseURL")
      return generateOpenAICompatible(prompt, apiKey, actualModelId, baseURL, size)
    }
    case "stability":
      return generateStability(prompt, apiKey, actualModelId, size)
    default: {
      const _exhaustive: never = adapter
      throw new Error(`不支持的生图 adapter: ${String(_exhaustive)}`)
    }
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
async function downloadAndSave(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载生成图片失败: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const name = `gen-${nanoid(12)}.png`
  const uploadDir = path.join(process.cwd(), "public", "uploads")
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, name), buffer)
  return `/uploads/${name}`
}

async function saveBase64(b64: string): Promise<string> {
  const buffer = Buffer.from(b64, "base64")
  const name = `gen-${nanoid(12)}.png`
  const uploadDir = path.join(process.cwd(), "public", "uploads")
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, name), buffer)
  return `/uploads/${name}`
}

/** 读取本地 /uploads/xxx.png 转 data URL,用于二创时 base_image 上传 */
async function readLocalAsDataUrl(relUrl: string): Promise<string> {
  // relUrl 形如 /uploads/xxx.png
  const clean = relUrl.startsWith("/") ? relUrl.slice(1) : relUrl
  const filePath = path.join(process.cwd(), "public", clean)
  const fs = await import("fs/promises")
  const buf = await fs.readFile(filePath)
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png"
  return `data:${mime};base64,${buf.toString("base64")}`
}

// ─── 二创 (img2img / inpaint / variations) ────────────────────────────────────

export type EditType = "edit" | "inpaint" | "variation"

export interface EditInput {
  userId: string
  /** 原图的相对 URL,形如 /uploads/xxx.png */
  sourceUrl: string
  /** 原图宽高,用于 mask 归一化坐标还原 */
  sourceWidth: number
  sourceHeight: number
  /** 编辑提示词(img2img/inpaint 时必填,variation 时可空) */
  prompt?: string
  editType: EditType
  /** inpaint 用:归一化坐标 {x,y,w,h},0~1 */
  maskRect?: { x: number; y: number; w: number; h: number }
  /** 生成数量,variation 时可一次出多张 */
  n?: number
  /** 使用的模型 id,默认 builtin:qwen-image-edit */
  modelId?: string
}

/** 检测后端模型是否原生支持二创(以图生图/局部重绘) */
export function isNativeEditModel(modelId: string | undefined): boolean {
  if (!modelId) return false
  const builtin = getBuiltinModel(modelId)
  return !!builtin?.supportsEdit
}

/**
 * 解析 multimodal-generation 返回的图片 URL:
 *  - 已经是 http(s):// → 直接返回
 *  - oss:// → 用百炼的 getPolicy 拿到可访问的 http URL
 * 部分情况下百炼会直接给临时公网 URL,这里做兜底。
 */
async function resolveDashScopeUrl(url: string, apiKey: string): Promise<string | null> {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith("oss://")) {
    // 百炼提供了一个 endpoints 接口,可从 oss:// 拿到可访问 URL
    const endpoint = `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation/oss-resolve?url=${encodeURIComponent(url)}`
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { url?: string }
      if (json.url) return json.url
    }
    // 兜底:OSS 公网规则 {bucket}.oss-cn-beijing.aliyuncs.com/{key}
    const key = url.slice("oss://".length)
    return `https://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com/${key}`
  }
  return null
}

/**
 * 百炼 OSS 临时文件上传:把本地图片推到百炼临时存储,拿到 oss:// 临时 URL。
 * 供 image2image / multimodal 等只接受 oss:// URL 的接口使用。
 * 步骤:
 *   1) GET /api/v1/uploads?action=getPolicy&model=xxx → 拿到 upload_host + policy
 *   2) POST {upload_host} (multipart/form-data) 上传文件
 *   3) 拼接 oss:// + key 作为 base_image
 */
async function uploadToDashScopeOss(
  fileBuffer: Buffer,
  fileName: string,
  apiKey: string,
  modelName: string
): Promise<string> {
  const policyUrl = `https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(modelName)}`
  console.log(`[OSS] 1) 获取凭证, URL=${policyUrl}`)

  const policyRes = await fetch(policyUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  console.log(`[OSS] 2) 凭证响应状态=${policyRes.status}`)

  if (!policyRes.ok) {
    const text = await policyRes.text()
    throw new Error(`获取 OSS 上传凭证失败: HTTP ${policyRes.status} ${text.slice(0, 300)}`)
  }
  const policyJson = (await policyRes.json().catch(() => ({}))) as {
    data?: {
      upload_host?: string
      upload_dir?: string
      policy?: string
      signature?: string
      oss_access_key_id?: string
      x_oss_object_acl?: string
      x_oss_forbid_overwrite?: string
    }
    message?: string
  }
  console.log(`[OSS] 3) policyJson=${JSON.stringify(policyJson)}`)

  const data = policyJson.data
  if (!data?.upload_host || !data.upload_dir || !data.policy || !data.signature || !data.oss_access_key_id) {
    throw new Error(`OSS 凭证响应不完整: ${policyJson.message || JSON.stringify(policyJson)}`)
  }
  const key = `${data.upload_dir}/${fileName}`
  console.log(`[OSS] 4) upload_host=${data.upload_host}, key=${key}`)

  const form = new FormData()
  form.append("OSSAccessKeyId", data.oss_access_key_id)
  form.append("policy", data.policy)
  form.append("Signature", data.signature)
  form.append("key", key)
  if (data.x_oss_object_acl) form.append("x-oss-object-acl", data.x_oss_object_acl)
  if (data.x_oss_forbid_overwrite) form.append("x-oss-forbid-overwrite", data.x_oss_forbid_overwrite)
  // file 字段必须放最后
  form.append(
    "file",
    new Blob([new Uint8Array(fileBuffer)]),
    fileName
  )
  console.log(`[OSS] 5) 开始上传, 文件大小=${fileBuffer.length} bytes`)

  const uploadRes = await fetch(data.upload_host, { method: "POST", body: form })
  const uploadText = await uploadRes.text().catch(() => "")
  console.log(`[OSS] 6) 上传响应状态=${uploadRes.status}, body=${uploadText.slice(0, 200)}`)

  if (!uploadRes.ok) {
    throw new Error(`上传到百炼 OSS 失败: HTTP ${uploadRes.status} ${uploadText.slice(0, 200)}`)
  }

  const ossUrl = `oss://${key}`
  console.log(`[OSS] 7) 上传成功, ossUrl=${ossUrl}`)
  return ossUrl
}

/**
 * 调用千问 image-edit 接口做二创。
 *  - edit       参考整张图 + 提示词 → 新图(img2img)
 *  - inpaint    参考整张图 + mask 区域 + 提示词 → 新图(局部重绘)
 *  - variation  参考整张图 → 自动生成 n 张变体(无 prompt)
 *
 * 强制走 qwen-image-edit(当前唯一稳定的二创适配器),即使上游选了其它模型也会在此处降级。
 */
async function generateQwenEdit(input: EditInput): Promise<GenerationResult[]> {
  const {
    userId,
    sourceUrl,
    prompt,
    editType,
    maskRect,
    n = 1,
  } = input

  // 二创强制走 qwen-image-edit,屏蔽用户传入的 modelId
  const EDIT_MODEL_ID = "builtin:qwen-image-edit"
  const builtin = getBuiltinModel(EDIT_MODEL_ID)
  if (!builtin) throw new Error("未配置 qwen-image-edit 模型")
  const apiKey = await resolveProviderKey(userId, builtin.provider)
  if (!apiKey) throw new Error(`未配置 ${builtin.provider} API Key，请先在设置中配置`)

  // 1) 上传本地 PNG 到百炼 OSS,拿到 oss:// 临时 URL
  //    multimodal-generation 接口支持 oss:// 和公网 URL,这里先拿 oss:// 然后让百炼解析
  const cleanRel = sourceUrl.startsWith("/") ? sourceUrl.slice(1) : sourceUrl
  const filePath = path.join(process.cwd(), "public", cleanRel)
  const fs = await import("fs/promises")
  const buf = await fs.readFile(filePath)
  const ext = path.extname(filePath).slice(1).toLowerCase() || "png"
  const safeName = `base-${nanoid(10)}.${ext}`
  const ossUrl = await uploadToDashScopeOss(buf, safeName, apiKey, builtin.modelId)
  // multimodal-generation 接口需要标准 http(s) URL,因此下载百炼返回的可访问 URL
  // 但 multimodal-generation 同时也接受 oss:// 协议(需 X-DashScope-OssResourceResolve header)
  // 为安全起见,我们直接传 oss:// + header
  const baseImage = ossUrl

  // 2) 构建 messages(新接口格式)
  //    content 数组:1~3 张图 + 1 个 text
  const content: Array<Record<string, string>> = [{ image: baseImage }]
  if (editType !== "variation") {
    content.push({ text: (prompt || "").slice(0, 1300) })
  } else {
    content.push({ text: "生成该图的风格变体,保持构图和主体,调整细节" })
  }

  const parameters: Record<string, unknown> = {
    n,
    size: "1024*1024",
    prompt_extend: false,
    watermark: false,
  }
  // 局部重绘:inpaint 场景下原接口用 mask 字段,新 multimodal 接口对应参数为 mask
  if (editType === "inpaint" && maskRect) {
    parameters.mask = `${maskRect.x},${maskRect.y},${maskRect.w},${maskRect.h}`
  }

  console.log(`[QwenEdit] 调用 multimodal-generation, model=${builtin.modelId}, content=${JSON.stringify(content)}, params=${JSON.stringify(parameters)}`)
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
  // multimodal-generation 是同步接口:直接返回结果,不需要异步任务 + 轮询
  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-OssResourceResolve": "enable",
    },
    body: JSON.stringify({
      model: builtin.modelId,
      input: { messages: [{ role: "user", content }] },
      parameters,
    }),
  })

  const createJson = (await createRes.json().catch(() => ({}))) as {
    output?: {
      choices?: Array<{
        message?: {
          content?: Array<{ image?: string }>
        }
      }>
      message?: string
    }
    message?: string
  }
  console.log(`[QwenEdit] multimodal-generation 响应: ok=${createRes.ok}, json=${JSON.stringify(createJson)}`)
  if (!createRes.ok) {
    const msg = createJson.output?.message || createJson.message || `HTTP ${createRes.status}`
    throw new Error(`创建二创任务失败: ${msg}`)
  }

  // 同步响应:从 output.choices[0].message.content 提取 oss:// URL
  const imageContents = createJson.output?.choices?.[0]?.message?.content ?? []
  const ossUrls = imageContents
    .map((c) => c.image)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
  if (ossUrls.length === 0) {
    throw new Error("二创生成成功,但未返回图片")
  }

  // 下载每张 oss:// 图片到本地
  const saved: GenerationResult[] = []
  for (const ossOrHttpUrl of ossUrls) {
    const httpUrl = await resolveDashScopeUrl(ossOrHttpUrl, apiKey)
    if (!httpUrl) continue
    const localUrl = await downloadAndSave(httpUrl)
    saved.push({
      url: localUrl,
      model: builtin.modelId,
      width: input.sourceWidth,
      height: input.sourceHeight,
    })
  }
  if (saved.length === 0) throw new Error("二创生成成功,但下载图片失败")
  return saved
}

/** 对外暴露的统一二创入口 */
export async function editImage(input: EditInput): Promise<GenerationResult[]> {
  return generateQwenEdit(input)
}

/**
 * 文生图 + 参考图:
 *  - 内置 supportsEdit 模型:走 qwen-image-edit(阿里 multimodal 接口)
 *  - 自定义模型(gpt-image-*, gemini-* 等):走 OpenAI images 格式
 *  - 调用方传 modelId,这里根据是 builtin 还是 custom 分发
 */
export interface ReferenceImageInput {
  userId: string
  /** 工作台顶栏下拉当前选中的模型 id */
  modelId: string
  /** 参考图的相对 URL,形如 /uploads/xxx.png */
  referenceImageUrl: string
  /** 用户提示词 */
  prompt: string
  /** 生图尺寸 */
  size?: string
}

/** 检查给定 modelId 是否支持图生图(参考图上传) */
export function supportsReferenceImage(modelId: string): boolean {
  const builtin = getBuiltinModel(modelId)
  if (builtin) return !!builtin.supportsEdit
  // 自定义模型(gpt-image-*, gemini-* 等中转站):中转站若支持 OpenAI images 格式即可用
  return true
}

export async function generateImageWithReference(
  input: ReferenceImageInput
): Promise<GenerationResult> {
  const { userId, modelId, referenceImageUrl, prompt, size } = input

  // 读取参考图(自定义模型和内置模型共用)
  let refWidth = 1024
  let refHeight = 1024
  let refDataUrl = ""
  try {
    const cleanRel = referenceImageUrl.startsWith("/")
      ? referenceImageUrl.slice(1)
      : referenceImageUrl
    const filePath = path.join(process.cwd(), "public", cleanRel)
    const fs = await import("fs/promises")
    const buf = await fs.readFile(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase() || "png"
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : "image/png"
    refDataUrl = `data:${mime};base64,${buf.toString("base64")}`
    try {
      const sharpMod = (await import("sharp")).default as ((input: Buffer) => {
        metadata: () => Promise<{ width?: number; height?: number }>
      }) | null
      if (typeof sharpMod === "function") {
        const meta = await sharpMod(buf).metadata()
        if (meta.width) refWidth = meta.width
        if (meta.height) refHeight = meta.height
      }
    } catch {
      // 没装 sharp,沿用 1024x1024 兜底
    }
  } catch {
    // 参考图读取失败时让下游报错
  }

  // 判断是内置还是自定义模型
  const builtin = getBuiltinModel(modelId)
  if (builtin && builtin.supportsEdit) {
    // 内置 supportsEdit 模型:走阿里 qwen-image-edit
    const results = await generateQwenEdit({
      userId,
      sourceUrl: referenceImageUrl,
      sourceWidth: refWidth,
      sourceHeight: refHeight,
      prompt,
      editType: "edit",
      n: 1,
      modelId: builtin.id,
    })
    if (results.length === 0) throw new Error("参考图生图失败,未返回图片")
    return results[0]
  }

  // 自定义模型:走 OpenAI 兼容 images 格式
  // 复用 generateImage 的自定义模型 Key 解析逻辑
  const dbId = modelId.startsWith("custom:") ? modelId.slice(7) : modelId
  const customModel = await prisma.imageModel.findFirst({
    where: { id: dbId, userId },
  })
  if (!customModel) throw new Error(`未找到自定义模型配置: ${modelId}`)

  let apiKey: string
  if (customModel.apiKeySource === "own" && customModel.apiKey) {
    apiKey = decrypt(customModel.apiKey)
  } else if (customModel.keyProvider) {
    const resolved = await resolveProviderKey(userId, customModel.keyProvider)
    if (!resolved) throw new Error("未找到有效的 API Key，请检查模型配置")
    apiKey = resolved
  } else {
    throw new Error("未找到有效的 API Key，请检查模型配置")
  }

  // 自定义模型:根据 modelId 前缀判断走哪个适配器
  const isGemini = customModel.modelId.startsWith("gemini-")
  if (isGemini) {
    // Gemini 原生 generateContent 端点
    const result = await generateGeminiWithReference(
      prompt,
      apiKey,
      customModel.modelId,
      customModel.baseURL,
      refDataUrl,
      size
    )
    return result
  }

  // OpenAI / DALL-E 等兼容格式
  const result = await generateOpenAIWithReference(
    prompt,
    apiKey,
    customModel.modelId,
    customModel.baseURL,
    refDataUrl,
    size
  )
  return result
}

/** 从文本中提取所有 [IMG:...] 标记内的提示词 */
export function extractImagePrompts(text: string): string[] {
  const prompts: string[] = []
  const re = new RegExp(IMG_MARKER_REGEX.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const p = m[1].trim()
    if (p) prompts.push(p)
  }
  return prompts
}
