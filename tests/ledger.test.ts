import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSettings } from '../src/config.ts'
import type { Requirement } from '../src/config.ts'
import { createLedger, errorSummary, gate, noteSteer, record, steerText } from '../src/ledger.ts'

const REQUIREMENTS = resolveSettings().requirements
const PLAN = REQUIREMENTS.find(item => item.key === 'plan')!.tool
const KNOWLEDGE = REQUIREMENTS.find(item => item.key === 'knowledge')!.tool

test('record 累加 ok 与 err，并推进 lastAt', () => {
  const ledger = createLedger()
  record(ledger, PLAN, true)
  record(ledger, PLAN, true)
  record(ledger, PLAN, false, 'boom')
  const tally = ledger.tools[PLAN]!
  assert.equal(tally.ok, 2)
  assert.equal(tally.err, 1)
  assert.equal(tally.lastError, 'boom')
  assert.ok(tally.lastAt > 0)
})

test('record 只在失败时写 lastError，成功不清掉旧的', () => {
  const ledger = createLedger()
  record(ledger, PLAN, false, 'first failure')
  record(ledger, PLAN, true)
  assert.equal(ledger.tools[PLAN]!.lastError, 'first failure')
})

test('record 对畸形输入不抛异常', () => {
  const ledger = createLedger()
  assert.doesNotThrow(() => {
    record(null as never, PLAN, true)
    record(ledger, '', true)
    record(ledger, undefined as never, true)
    record(ledger, 42 as never, false, 'x')
    ledger.tools = null as never
    record(ledger, PLAN, true)
  })
  assert.equal(ledger.tools[PLAN]!.ok, 1)
})

test('errorSummary 折行并截断到上限', () => {
  const long = `line one\nline two ${'x'.repeat(500)}`
  const summary = errorSummary(long, 50)!
  assert.equal(summary.length, 51) // 50 + 省略号
  assert.ok(!summary.includes('\n'))
  assert.ok(summary.endsWith('…'))
})

test('errorSummary 认得 Error、{message} 与空值', () => {
  assert.equal(errorSummary(new Error('nope'), 200), 'nope')
  assert.equal(errorSummary({ message: 'denied by policy' }, 200), 'denied by policy')
  assert.equal(errorSummary(undefined, 200), undefined)
  assert.equal(errorSummary('   ', 200), undefined)
})

test('gate：硬软全部满足则 ok 且无缺失', () => {
  const ledger = createLedger()
  for (const requirement of REQUIREMENTS) record(ledger, requirement.tool, true)
  const verdict = gate(ledger, REQUIREMENTS)
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.missing, [])
})

test('gate：缺硬要求则不放行', () => {
  const ledger = createLedger()
  for (const requirement of REQUIREMENTS) {
    if (requirement.key !== 'plan') record(ledger, requirement.tool, true)
  }
  const verdict = gate(ledger, REQUIREMENTS)
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.missing.map(item => item.key), ['plan'])
})

test('gate：只缺软要求仍然放行，但缺失项照样列出来', () => {
  const ledger = createLedger()
  record(ledger, PLAN, true)
  const verdict = gate(ledger, REQUIREMENTS)
  assert.equal(verdict.ok, true)
  assert.ok(verdict.missing.length > 0)
  assert.ok(verdict.missing.every(item => !item.hard))
})

test('gate 区分「没调过」与「调了全失败」', () => {
  const ledger = createLedger()
  record(ledger, PLAN, false, 'connection refused')
  const verdict = gate(ledger, REQUIREMENTS)
  const plan = verdict.missing.find(item => item.key === 'plan')!
  assert.equal(plan.kind, 'all-failed')
  assert.equal(plan.errors, 1)
  assert.equal(plan.lastError, 'connection refused')
  const knowledge = verdict.missing.find(item => item.key === 'knowledge')!
  assert.equal(knowledge.kind, 'never-called')
  assert.equal(knowledge.errors, undefined)
})

test('gate：失败过但最终成功了算满足', () => {
  const ledger = createLedger()
  record(ledger, PLAN, false, 'timeout')
  record(ledger, PLAN, true)
  assert.equal(gate(ledger, REQUIREMENTS).ok, true)
})

test('steerText 用的是配置里的工具名，换名字就跟着换', () => {
  const custom: Requirement[] = [
    { key: 'plan', tool: 'mcp__other__explain', hard: true, reason: '理由' },
  ]
  const ledger = createLedger()
  const text = steerText(gate(ledger, custom).missing)
  assert.ok(text.includes('mcp__other__explain'))
  assert.ok(!text.includes(PLAN))
})

test('steerText 给出「等用户补信息就收尾」的出路', () => {
  const ledger = createLedger()
  const text = steerText(gate(ledger, REQUIREMENTS).missing)
  assert.ok(text.includes('结束本轮'))
  assert.ok(text.includes('不要凭空补一份诊断'))
})

test('steerText 把软要求单列成不阻塞的一段', () => {
  const ledger = createLedger()
  const text = steerText(gate(ledger, REQUIREMENTS).missing)
  const hardAt = text.indexOf('必须补：')
  const softAt = text.indexOf('顺带（不阻塞本轮输出）：')
  assert.ok(hardAt >= 0 && softAt > hardAt)
  assert.ok(text.slice(hardAt, softAt).includes(PLAN))
  assert.ok(text.slice(softAt).includes(KNOWLEDGE))
})

test('steerText 对「调了全失败」给的是降级出路，不是继续催', () => {
  const ledger = createLedger()
  record(ledger, PLAN, false, 'connection refused')
  const text = steerText(gate(ledger, REQUIREMENTS).missing)
  assert.ok(text.includes('待补证据'))
  assert.ok(text.includes('connection refused'))
})

test('noteSteer 按回合重置，额度用完返回 false', () => {
  const ledger = createLedger()
  assert.equal(noteSteer(ledger, 1, 1), true)
  assert.equal(noteSteer(ledger, 1, 1), false)
  assert.equal(noteSteer(ledger, 2, 1), true)
  assert.equal(ledger.steersInTurn, 1)
})

test('resolveSettings 拒绝非法的 maxSteers 与 errorPreviewChars', () => {
  assert.throws(() => resolveSettings({ maxSteers: -1 }), /maxSteers/)
  assert.throws(() => resolveSettings({ errorPreviewChars: 0 }), /errorPreviewChars/)
})
