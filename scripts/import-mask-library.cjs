/**
 * 一次性导入脚本：NextChat 社区面具库 -> aichatt 内置面具库
 *
 * 输入：D:\项目表1\ai面板\next-chat\public\masks.json（cn 分组）
 * 输出：src/lib/ai/builtin-masks-library.ts（BUILTIN_MASK_LIBRARY）
 *
 * 转换规则：
 *   - context 中 role=system 的内容合并为 systemPrompt
 *   - 无 system 时，若首条 user 内容较长（≥30 字），提升为 systemPrompt
 *   - 其余 user/assistant 按序转为 fewShot（上限 8 条）
 *   - avatar 从 Unicode codepoint 串（如 "1f5bc-fe0f"）还原为 emoji 字符
 *   - description 取 systemPrompt 第一句（截 36 字）
 *   - id 取 context 首条 id 前缀，slug 化并加 lib- 前缀
 *
 * 过滤规则：
 *   - 排除接入外部生图 URL 的面具（与本项目生图体系冲突）
 *   - 排除与现有内置面具同名的条目、库内互相重复的条目
 *   - 排除缺少有效人格指令（systemPrompt < 20 字）的条目
 *
 * 用法：node scripts/import-mask-library.cjs（幂等，重复运行覆盖输出）
 */
const fs = require('fs')
const path = require('path')

const SRC = 'D:\\项目表1\\ai面板\\next-chat\\public\\masks.json'
const OUT = path.join(__dirname, '..', 'src', 'lib', 'ai', 'builtin-masks-library.ts')
const BUILTIN_TS = path.join(__dirname, '..', 'src', 'lib', 'ai', 'builtin-masks.ts')

/** codepoint 串 -> emoji 字符（"1f5bc-fe0f" -> 🖼️） */
function decodeAvatar(raw) {
  try {
    return String(raw || '')
      .split('-')
      .filter(Boolean)
      .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
      .join('')
  } catch {
    return '🎭'
  }
}

/** 取人格指令的第一句作为一句话定位 */
function firstSentence(text) {
  if (!text) return ''
  const clean = String(text)
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>#]/g, '')
    .trim()
  const first = clean.split(/[。！？!?；;\n]/)[0] || ''
  return first.length > 36 ? first.slice(0, 36) + '…' : first
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** 从现有 builtin-masks.ts 提取已占用的名字与 id，避免冲突 */
function extractExisting(source) {
  const names = new Set()
  const ids = new Set()
  const nameRe = /name:\s*'([^']+)'/g
  const idRe = /id:\s*'([^']+)'/g
  let m
  while ((m = nameRe.exec(source))) names.add(m[1])
  while ((m = idRe.exec(source))) ids.add(m[1])
  return { names, ids }
}

function main() {
  const json = JSON.parse(fs.readFileSync(SRC, 'utf8'))
  const list = Array.isArray(json.cn) ? json.cn : []
  const builtinSource = fs.readFileSync(BUILTIN_TS, 'utf8')
  const { names: existingNames, ids: existingIds } = extractExisting(builtinSource)

  const stats = { total: list.length, kept: 0, dupName: 0, dupId: 0, imageGen: 0, thinPrompt: 0, badShape: 0 }
  const seenNames = new Set()
  const seenIds = new Set()
  const out = []

  for (const item of list) {
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const ctx = Array.isArray(item.context) ? item.context : []
    if (!name || ctx.length === 0) { stats.badShape++; continue }

    if (existingNames.has(name) || seenNames.has(name)) { stats.dupName++; continue }

    // 排除依赖外部生图服务的面具（pollinations 等），与本项目生图体系冲突
    const joined = ctx.map((c) => String(c.content || '')).join('\n')
    if (/pollinations|image\.pollinations/i.test(joined) || /文生图|生图|画图|绘画/.test(name)) {
      stats.imageGen++
      continue
    }

    const systems = ctx.filter((c) => c.role === 'system' && c.content).map((c) => c.content.trim())
    let turns = ctx.filter((c) => (c.role === 'user' || c.role === 'assistant') && c.content)
    let systemPrompt = systems.join('\n\n')

    // 规范化：无 system 且首条 user 是长指令 -> 提升为 systemPrompt
    if (!systemPrompt && turns.length && turns[0].role === 'user' && turns[0].content.trim().length >= 30) {
      systemPrompt = turns[0].content.trim()
      turns = turns.slice(1)
    }

    if (systemPrompt.length < 20) { stats.thinPrompt++; continue }

    // id：优先用 context 首条 id 前缀（如 "writer-0" -> "lib-writer"）
    const rawId = String((ctx[0] && ctx[0].id) || '').replace(/-\d+$/, '')
    let base = slugify(rawId)
    if (!base) base = 'mask'
    let id = `lib-${base}`
    let n = 2
    while (existingIds.has(id) || seenIds.has(id)) {
      id = `lib-${base}-${n++}`
    }

    const fewShot = turns.slice(0, 8).map((t) => ({ role: t.role, content: String(t.content).trim() }))
    const description = firstSentence(systemPrompt) || '来自 NextChat 社区面具库'

    out.push({
      id,
      name,
      avatar: decodeAvatar(item.avatar),
      description,
      systemPrompt,
      fewShot,
    })

    seenNames.add(name)
    seenIds.add(id)
    stats.kept++
  }

  // 生成 TS 文件：content 用 JSON.stringify 保证字符串字面量安全（含反引号/${} 时不破）
  const blocks = out.map((m) =>
    [
      '  {',
      `    id: ${JSON.stringify(m.id)},`,
      `    name: ${JSON.stringify(m.name)},`,
      `    avatar: ${JSON.stringify(m.avatar)},`,
      `    description: ${JSON.stringify(m.description)},`,
      `    systemPrompt: ${JSON.stringify(m.systemPrompt)},`,
      `    fewShot: ${JSON.stringify(m.fewShot, null, 2).split('\n').join('\n    ')},`,
      '  },',
    ].join('\n')
  )

  const header = `/**
 * NextChat 社区面具库导入（cn 分组，共 ${out.length} 个）。
 *
 * 由 scripts/import-mask-library.cjs 生成，请勿手工编辑；
 * 调整过滤/转换规则后重跑脚本即可。
 * 与 ./builtin-masks.ts 的精选内置面具同为只读人格包，
 * 经 getBuiltinMask 合并查找、MaskPickerMenu「面具库」分组展示。
 */

import type { BuiltinMask } from './builtin-masks'

export const BUILTIN_MASK_LIBRARY: readonly BuiltinMask[] = [
`

  fs.writeFileSync(OUT, header + blocks.join('\n') + '\n]\n', 'utf8')

  console.log('[import-mask-library] 统计:', JSON.stringify(stats, null, 2))
  console.log('[import-mask-library] 输出:', OUT, `(${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`)
}

main()
