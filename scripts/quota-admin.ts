// 公共额度管理脚本（唯一管理员手动操作入口，不上界面）。
// 用法：npx tsx --env-file=.env scripts/quota-admin.ts [命令]
//   status                 默认。显示池状态与今日流水
//   refill <n>             充值：totalTokens += n
//   set <字段> <值>        直接改池字段（totalTokens/usedTokens/dailyRefillTokens/
//                          dayKey/perUserDailyTokens/ephemeralPerUserDailyTokens）
//   ledger <dayKey>        看某天（默认今天）按用户的流水聚合
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const dayKeyOf = (d = new Date()) =>
  new Date(d.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10)

async function status() {
  const pool = await prisma.quotaPool.findUnique({ where: { id: 'global' } })
  if (!pool) {
    console.log('QuotaPool 行不存在（迁移未跑或种子丢失）')
    return
  }
  const today = dayKeyOf()
  const agg = await prisma.quotaLedger.aggregate({
    where: { dayKey: today },
    _sum: { tokens: true },
    _count: true,
  })
  console.log(JSON.stringify(pool, null, 2))
  console.log(`\n今日(${today}) 流水: ${agg._sum.tokens ?? 0} tokens / ${agg._count} 笔`)
  console.log(`池剩余: ${pool.totalTokens - pool.usedTokens}`)
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmd || cmd === 'status') return status()
  if (cmd === 'refill') {
    const n = Number(args[0])
    if (!Number.isFinite(n) || n <= 0) throw new Error('refill 需要正整数参数')
    const r = await prisma.quotaPool.update({ where: { id: 'global' }, data: { totalTokens: { increment: n } } })
    console.log(`已充值 ${n}，totalTokens=${r.totalTokens}`)
    return
  }
  if (cmd === 'set') {
    const [field, value] = args
    const fields = ['totalTokens', 'usedTokens', 'dailyRefillTokens', 'dayKey', 'perUserDailyTokens', 'ephemeralPerUserDailyTokens'] as const
    if (!fields.includes(field as never)) throw new Error(`未知字段: ${field}（可选: ${fields.join(', ')}）`)
    const v = field === 'dayKey' ? value : Number(value)
    if (field !== 'dayKey' && !Number.isFinite(v)) throw new Error(`${field} 需要数字`)
    const r = await prisma.quotaPool.update({ where: { id: 'global' }, data: { [field]: v } })
    console.log(`已更新 ${field}=${v}，当前:`, JSON.stringify(r))
    return
  }
  if (cmd === 'ledger') {
    const day = args[0] ?? dayKeyOf()
    const rows = await prisma.quotaLedger.groupBy({
      by: ['userId'],
      where: { dayKey: day },
      _sum: { tokens: true },
      _count: true,
      orderBy: { _sum: { tokens: 'desc' } },
    })
    console.log(`${day} 按用户:`)
    for (const r of rows) console.log(`  ${r.userId}: ${r._sum.tokens ?? 0} tokens / ${r._count} 笔`)
    if (rows.length === 0) console.log('  （无记录）')
    return
  }
  throw new Error(`未知命令: ${cmd}`)
}

main()
  .catch((e) => {
    console.error('失败:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
