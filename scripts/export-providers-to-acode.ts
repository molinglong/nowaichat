/**
 * 把 aichatt 数据库里的自定义模型(CustomModel)导出为 ACode 的 provider 配置。
 * 运行:npx tsx scripts/export-providers-to-acode.ts
 * 密钥只写入 ~/.acode/v2/provider_config.json,不在 stdout 打印。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createDecipheriv, scryptSync } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// ---- 载入 .env(.env.local 优先,与 next 行为一致) ----
for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

// ---- 与 src/lib/crypto.ts 相同的解密(aes-256-gcm, iv+authTag+ct hex) ----
function decrypt(encrypted: string): string {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error("ENCRYPTION_KEY missing")
  const key = scryptSync(secret, "aichatt-salt", 32)
  const buf = Buffer.from(encrypted, "hex")
  const iv = buf.subarray(0, 16)
  const authTag = buf.subarray(16, 32)
  const ct = buf.subarray(32)
  const d = createDecipheriv("aes-256-gcm", key, iv)
  d.setAuthTag(authTag)
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8")
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

interface Prov {
  providerId: string
  providerName: string
  apiKey: string
  apiType: "anthropic-messages" | "openai-chat-completions" | "openai-responses"
  baseUrl: string
  models: string[]
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "relay"
}

const API_TYPE: Record<string, Prov["apiType"]> = {
  anthropic: "anthropic-messages",
  chat: "openai-chat-completions",
  responses: "openai-responses",
  auto: "openai-chat-completions",
}

async function main() {
  const rows = await prisma.customModel.findMany({ orderBy: { createdAt: "asc" } })
  const groups = new Map<string, Prov>()
  for (const r of rows) {
    if (!r.baseURL) continue
    const apiType = API_TYPE[r.protocol] ?? API_TYPE.auto
    const gid = `${r.baseURL}::${apiType}`
    let g = groups.get(gid)
    if (!g) {
      let apiKey = ""
      try {
        apiKey = r.apiKey ? decrypt(r.apiKey) : ""
      } catch {
        apiKey = ""
      }
      g = {
        providerId: slugify(r.baseURL.replace(/^https?:\/\//, "")) + "-" + apiType.replace(/^openai-|-completions$/g, "").replace("anthropic-messages", "anthropic"),
        providerName: r.name.replace(/@.*/, "").trim() || slugify(r.baseURL),
        apiKey,
        apiType,
        baseUrl: r.baseURL,
        models: [],
      }
      groups.set(gid, g)
    }
    if (!g.apiKey && r.apiKey) {
      try { g.apiKey = decrypt(r.apiKey) } catch { /* keep empty */ }
    }
    if (!g.models.includes(r.modelId)) g.models.push(r.modelId)
  }

  const providers = Array.from(groups.values()).filter((g) => g.models.length > 0)
  const providerRules = providers.map((p) => ({
    providerId: p.providerId,
    providerName: p.providerName,
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: p.apiKey },
      api: { type: p.apiType, baseUrl: p.baseUrl },
      personalModelIds: p.models,
      modelOrder: p.models,
    },
  }))
  const providerModelRules = providers.flatMap((p) =>
    p.models.map((m: string) => ({ modelId: m, config: { enabled: true }, providerId: p.providerId }))
  )
  const config = {
    schemaVersion: 1,
    config: {
      providerOrder: providers.map((p) => p.providerId),
      providerConfigRules: { providerRules },
      modelConfigRules: { providerModelRules, manualProviderModelRules: [] },
    },
  }
  const out = join(homedir(), ".acode", "v2", "provider_config.json")
  mkdirSync(join(homedir(), ".acode", "v2"), { recursive: true })
  if (existsSync(out)) {
    const bak = out + ".bak-" + new Date().toISOString().slice(0, 10)
    writeFileSync(bak, readFileSync(out, "utf8"))
    console.log("已备份原配置 ->", bak)
  }
  writeFileSync(out, JSON.stringify(config, null, 2))
  console.log(`已写入 ${out}`)
  for (const p of providers) {
    console.log(
      `  - ${p.providerId} (${p.apiType}) ${p.baseUrl} 模型 ${p.models.length} 个: ${p.models.join(", ")}` +
        (p.apiKey ? ` [key ${p.apiKey.slice(0, 6)}…已写入]` : " [无 key!]")
    )
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
