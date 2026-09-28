/**
 * verify-gate / project-check 纯函数快速验证(无测试框架,断言式自检)。
 * 运行:npx tsx scripts/verify-gate.test.ts —— 退出码非 0 即有失败。
 * 覆盖:isCheckCommandAllowed 白名单/黑名单边界、analyzeTurnForGate 门判定全路径。
 */
import { isCheckCommandAllowed, CHECK_ALLOWLIST_HINT } from '../src/lib/ai/project-check-tool'
import {
  analyzeTurnForGate,
  buildVerifyGateMessage,
  isVerifyGateMessage,
  VERIFY_GATE_TAG,
  type GateMessageLike,
} from '../src/lib/ai/verify-gate'

let failed = 0
function t(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`  FAIL ${name}`)
  }
}

console.log('isCheckCommandAllowed:')
t('tsc --noEmit 放行', isCheckCommandAllowed('tsc --noEmit'))
t('npx --no-install tsc --noEmit 放行', isCheckCommandAllowed('npx --no-install tsc --noEmit'))
t('eslint . 放行', isCheckCommandAllowed('eslint .'))
t('vitest run 放行', isCheckCommandAllowed('vitest run'))
t('pytest -q 放行', isCheckCommandAllowed('pytest -q'))
t('cargo check 放行', isCheckCommandAllowed('cargo check'))
t('go vet ./... 放行(go 递归通配不算路径逃逸)', isCheckCommandAllowed('go vet ./...'))
t('node --test 放行', isCheckCommandAllowed('node --test'))
t('rstest run 放行', isCheckCommandAllowed('rstest run'))
t('npx tsc 拒绝(无 --no-install,可能联网下载)', !isCheckCommandAllowed('npx tsc --noEmit'))
t('npm install 拒绝(装包=任意 postinstall)', !isCheckCommandAllowed('npm install'))
t('tsc && rm -rf / 拒绝(语句分隔+rm)', !isCheckCommandAllowed('tsc --noEmit && rm -rf /'))
t('管道拒绝', !isCheckCommandAllowed('tsc --noEmit | tee log'))
t('重定向拒绝', !isCheckCommandAllowed('tsc --noEmit > out.txt'))
t('绝对路径拒绝', !isCheckCommandAllowed('tsc C:\\proj\\tsconfig.json'))
t('.. 逃逸拒绝', !isCheckCommandAllowed('tsc ../../etc/tsconfig.json'))
t('node 裸跑拒绝(任意代码执行)', !isCheckCommandAllowed('node evil.js'))
t('cargo build 拒绝(非 check)', !isCheckCommandAllowed('cargo build'))
t('go test 拒绝(v1 仅 vet)', !isCheckCommandAllowed('go test ./...'))
t('空命令拒绝', !isCheckCommandAllowed(''))
t('超长命令拒绝', !isCheckCommandAllowed(`tsc ${'a'.repeat(600)}`))
t('git status 拒绝(不在检查白名单,归 exec 管)', !isCheckCommandAllowed('git status'))

type GatePart = NonNullable<GateMessageLike['parts']>[number]
const user = (id: string): GateMessageLike => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: '帮我改 a.ts' }],
})
const asst = (id: string, parts: GatePart[]): GateMessageLike => ({ id, role: 'assistant', parts })
const lf = (action: string, path: string, ok = true) => ({
  type: 'tool-local_file',
  state: 'output-available',
  input: { action, path },
  output: { ok, action },
})
const check = (code: number) => ({
  type: 'tool-project_check',
  state: 'output-available',
  input: { command: 'tsc --noEmit' },
  output: { ok: code === 0, exitCode: code },
})
const gateMsg = {
  id: 'g1',
  role: 'user',
  parts: [{ type: 'text', text: buildVerifyGateMessage(['a.ts']) }],
}

console.log('analyzeTurnForGate:')
t(
  '有写无验收 → gate',
  analyzeTurnForGate([user('u1'), asst('a1', [lf('create', 'a.ts'), { type: 'text', text: '完成了' }])])
    .shouldGate === true
)
t(
  '写+查绿 → 不 gate',
  analyzeTurnForGate([
    user('u1'),
    asst('a1', [lf('edit', 'a.ts'), check(0), { type: 'text', text: '搞定' }]),
  ]).shouldGate === false
)
t(
  '写+查红 → gate',
  analyzeTurnForGate([
    user('u1'),
    asst('a1', [lf('edit', 'a.ts'), check(2), { type: 'text', text: '搞定' }]),
  ]).shouldGate === true
)
t(
  '查绿后又有新写 → gate 且只列新写入',
  (() => {
    const v = analyzeTurnForGate([
      user('u1'),
      asst('a1', [lf('edit', 'a.ts'), check(0), lf('edit', 'b.ts'), { type: 'text', text: 'x' }]),
    ])
    return v.shouldGate && v.unverifiedWrites.includes('b.ts') && !v.unverifiedWrites.includes('a.ts')
  })()
)
t(
  'denied 写 → 不 gate',
  analyzeTurnForGate([
    user('u1'),
    asst('a1', [lf('create', 'a.ts', false), { type: 'text', text: 'x' }]),
  ]).shouldGate === false
)
t(
  'delete 不算写(v1 边界)',
  analyzeTurnForGate([user('u1'), asst('a1', [lf('delete', 'a.ts'), { type: 'text', text: 'x' }])])
    .shouldGate === false
)
t(
  'code_edit 不算写(产出待审查 Diff,未落盘)',
  analyzeTurnForGate([
    user('u1'),
    asst('a1', [
      {
        type: 'tool-code_edit',
        state: 'output-available',
        input: { docId: 'd1' },
        output: { ok: true, status: 'pending-review' },
      },
      { type: 'text', text: '请在编辑器审查' },
    ]),
  ]).shouldGate === false
)
t(
  '新回合不追溯旧写入',
  analyzeTurnForGate([
    user('u1'),
    asst('a1', [lf('create', 'a.ts'), { type: 'text', text: 'done' }]),
    user('u2'),
    asst('a2', [{ type: 'text', text: '你好' }]),
  ]).shouldGate === false
)
t(
  '门消息不算回合边界(打回后旧写入仍被追踪)',
  (() => {
    const v = analyzeTurnForGate([
      user('u1'),
      asst('a1', [lf('create', 'a.ts'), { type: 'text', text: 'done' }]),
      gateMsg,
      asst('a2', [{ type: 'text', text: '好的,我说明一下' }]),
    ])
    return v.shouldGate && v.unverifiedWrites.includes('a.ts')
  })()
)
t(
  '悬空 tool-call(未回填)不算已验收写',
  analyzeTurnForGate([
    user('u1'),
    asst('a1', [
      { type: 'tool-local_file', state: 'input-available', input: { action: 'create', path: 'a.ts' } },
      { type: 'text', text: 'x' },
    ]),
  ]).shouldGate === false
)
t(
  '无真实用户消息(历史回放) → 不 gate',
  analyzeTurnForGate([asst('a1', [lf('create', 'a.ts')])]).shouldGate === false
)
t(
  '写+查绿+再写+再查绿 → 不 gate',
  analyzeTurnForGate([
    user('u1'),
    asst('a1', [lf('edit', 'a.ts'), check(0), lf('edit', 'b.ts'), check(0), { type: 'text', text: 'ok' }]),
  ]).shouldGate === false
)

console.log('misc:')
t('门消息可识别', isVerifyGateMessage(gateMsg))
t('普通用户消息非门消息', !isVerifyGateMessage(user('u1')))
t(
  '打回消息含标签与文件清单',
  buildVerifyGateMessage(['a.ts']).startsWith(VERIFY_GATE_TAG) &&
    buildVerifyGateMessage(['a.ts']).includes('a.ts')
)
console.log(`  白名单摘要: ${CHECK_ALLOWLIST_HINT}`)

if (failed > 0) {
  console.error(`\n${failed} 个断言失败`)
  process.exit(1)
}
console.log('\n全部通过')
