/**
 * 导出 CustomModel 行(加密 blob 原样)供 VPS 侧搬运 + 输出本地 ENCRYPTION_KEY 哈希。
 * 运行:npx tsx scripts/dump-custom-models-for-vps.ts
 * 明文 key 不落盘、不输出。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { createHash, createDecipheriv, scryptSync } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

async function main() {
  const plain = process.env.PLAIN === "1"
  const rows = await prisma.customModel.findMany({ orderBy: { createdAt: "asc" } })
  const payload = rows.map((r) => ({
    modelId: r.modelId,
    name: r.name,
    baseURL: r.baseURL,
    protocol: r.protocol,
    apiKey: plain ? decryptLocal(r.apiKey) : r.apiKey,
    keyProvider: r.keyProvider,
    contextWindow: r.contextWindow,
    supportsVision: r.supportsVision,
    supportsFiles: r.supportsFiles,
    supportsReasoning: r.supportsReasoning,
  }))
  const out = join(tmpdir(), plain ? "cm-plain.json" : "cm-payload.json")
  writeFileSync(out, JSON.stringify(payload))
  console.log("rows:", rows.length)
  console.log("payload:", out)
  if (!plain) {
    console.log(
      "key-sha256:",
      createHash("sha256").update(process.env.ENCRYPTION_KEY ?? "").digest("hex")
    )
  }
  await prisma.$disconnect()
}

/** 与 src/lib/crypto.ts 同算法(本地 ENCRYPTION_KEY,aes-256-gcm: iv+authTag+ct hex) */
function decryptLocal(encrypted: string | null): string | null {
  if (!encrypted) return null
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error("ENCRYPTION_KEY missing")
  const key = scryptSync(secret, "aichatt-salt", 32)
  const buf = Buffer.from(encrypted, "hex")
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 16))
  d.setAuthTag(buf.subarray(16, 32))
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]).toString("utf8")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
