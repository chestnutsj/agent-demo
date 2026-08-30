import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSettings } from '../src/config.ts'
import { apply } from '../src/index.ts'

const TOOLS = resolveSettings().tools

interface Captured {
  command: {
    name: string
    description: string
    input?: { hint: string }
    handler(invocation: unknown): { kind: string; text?: string }
  }
  section: { name: string; order: number; text(context: unknown): string }
  result(exec: unknown, result: unknown): void
  stopping(payload: unknown): void
  logs: string[]
}

/** 收集 apply() 注册的东西的假 ctx；不碰 dsh 运行时。 */
function harness(config = {}): Captured {
  const captured = { logs: [] as string[] } as Partial<Captured> & { logs: string[] }
  const ctx = {
    commands: { register: (definition: unknown) => { captured.command = definition as Captured['command'] } },
    systemPrompt: { section: (section: unknown) => { captured.section = section as Captured['section'] } },
    on: (event: string, listener: unknown) => {
      if (event === 'tools/result') captured.result = listener as Captured['result']
      else if (event === 'agent/turn-stopping') captured.stopping = listener as Captured['stopping']
    },
    logger: {
      info: (message: string) => captured.logs.push(message),
      debug: (message: string) => captured.logs.push(message),
    },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0], config)
  return captured as Captured
}

/** 假 Agent：记下收到的 followup / steer 消息。 */
function fakeAgent() {
  const followups: { text: string; kind: string }[] = []
  const steers: { text: string; kind: string; summary: string }[] = []
  const agent = {
    followup(message: { content: { text: string }[]; source: { kind: string } }) {
      followups.push({ text: message.content[0]!.text, kind: message.source.kind })
    },
    steer(message: { content: { text: string }[]; source: { kind: string; summary: string } }) {
      steers.push({ text: message.content[0]!.text, kind: message.source.kind, summary: message.source.summary })
    },
  }
  return { agent, followups, steers }
}

const ok = { isError: false }
const failed = { isError: true, error: 'connection refused' }

// input 一旦掉了，客户端菜单里选中命令就直接执行，用户没有地方写 SQL——正是这次要修的
// 那个行为，所以单独守一条。
test('注册的命令叫 sql-optimizer，并声明了自由输入提示', () => {
  const h = harness()
  assert.equal(h.command.name, 'sql-optimizer')
  assert.equal(typeof h.command.input?.hint, 'string')
  assert.ok((h.command.input?.hint ?? '').trim().length > 0)
})

test('流程正文走系统提示词分区：入册前为空，入册后是渲染过的正文', () => {
  const h = harness()
  const { agent } = fakeAgent()
  assert.equal(h.section.text({ agent }), '')
  h.command.handler({ agent, rawInput: '' })
  const text = h.section.text({ agent })
  assert.ok(text.includes(TOOLS.plan))
  assert.ok(!text.includes('{{tool:'))
})

test('装配上下文没有 agent（诊断装配）时分区为空', () => {
  const h = harness()
  const { agent } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  assert.equal(h.section.text({}), '')
})

test('分区只对入册过的 agent 生效', () => {
  const h = harness()
  const first = fakeAgent()
  const second = fakeAgent()
  h.command.handler({ agent: first.agent, rawInput: '' })
  assert.ok(h.section.text({ agent: first.agent }).includes(TOOLS.plan))
  assert.equal(h.section.text({ agent: second.agent }), '')
})

test('空参数只入册，不起回合', () => {
  const h = harness()
  const { agent, followups } = fakeAgent()
  const outcome = h.command.handler({ agent, rawInput: '' })
  assert.equal(outcome.kind, 'success')
  assert.deepEqual(followups, [])
})

test('命令后面的话原样作为 user 消息发进去，不夹带流程正文', () => {
  const h = harness()
  const { agent, followups } = fakeAgent()
  h.command.handler({ agent, rawInput: ' 优化这条SQL select 1;  ' })
  assert.equal(followups.length, 1)
  assert.equal(followups[0]!.kind, 'user')
  assert.equal(followups[0]!.text, '优化这条SQL select 1;')
  assert.ok(!followups[0]!.text.includes(TOOLS.plan))
})

test('没跑过命令的 agent 收尾时不被检查', () => {
  const h = harness()
  const { agent, steers } = fakeAgent()
  h.stopping({ agent, turn: 1 })
  assert.deepEqual(steers, [])
})

test('入册后缺执行计划 → 顶回去一次，消息带 plugin 来源', () => {
  const h = harness()
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.stopping({ agent, turn: 1 })
  assert.equal(steers.length, 1)
  assert.equal(steers[0]!.kind, 'plugin')
  assert.ok(steers[0]!.text.includes(TOOLS.plan))
  assert.ok(h.logs.some(line => line.includes('gate=steer')))
})

test('取过计划就放行，软要求缺失不阻塞', () => {
  const h = harness()
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.result({ name: TOOLS.plan, agent }, ok)
  h.stopping({ agent, turn: 1 })
  assert.deepEqual(steers, [])
})

test('计划工具调了但失败，仍然算缺，且文案给降级出路', () => {
  const h = harness()
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.result({ name: TOOLS.plan, agent }, failed)
  h.stopping({ agent, turn: 1 })
  assert.equal(steers.length, 1)
  assert.ok(steers[0]!.text.includes('待补证据'))
  assert.ok(steers[0]!.text.includes('connection refused'))
})

test('同一回合额度用完后放行并记 bypassed，新回合重新有额度', () => {
  const h = harness()
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.stopping({ agent, turn: 1 })
  h.stopping({ agent, turn: 1 })
  assert.equal(steers.length, 1)
  assert.ok(h.logs.some(line => line.includes('gate=bypassed')))
  h.stopping({ agent, turn: 2 })
  assert.equal(steers.length, 2)
})

test('maxSteers 可配置', () => {
  const h = harness({ maxSteers: 2 })
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.stopping({ agent, turn: 1 })
  h.stopping({ agent, turn: 1 })
  h.stopping({ agent, turn: 1 })
  assert.equal(steers.length, 2)
})

test('exec.agent 为 undefined 时不记账也不抛', () => {
  const h = harness()
  assert.doesNotThrow(() => { h.result({ name: TOOLS.plan }, ok) })
})

test('没被跟踪的工具不记账', () => {
  const h = harness()
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.result({ name: 'mcp__mysql-optimize__something_else', agent }, ok)
  h.stopping({ agent, turn: 1 })
  assert.equal(steers.length, 1)
})

test('两个 agent 的台账互不串账', () => {
  const h = harness()
  const first = fakeAgent()
  const second = fakeAgent()
  h.command.handler({ agent: first.agent, rawInput: '' })
  h.command.handler({ agent: second.agent, rawInput: '' })
  h.result({ name: TOOLS.plan, agent: first.agent }, ok)
  h.stopping({ agent: first.agent, turn: 1 })
  h.stopping({ agent: second.agent, turn: 1 })
  assert.deepEqual(first.steers, [])
  assert.equal(second.steers.length, 1)
})

test('再次执行命令会清零台账：第二条语句要重新取证', () => {
  const h = harness()
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.result({ name: TOOLS.plan, agent }, ok)
  h.stopping({ agent, turn: 1 })
  assert.deepEqual(steers, [])

  h.command.handler({ agent, rawInput: '' })
  h.stopping({ agent, turn: 2 })
  assert.equal(steers.length, 1)
})

test('工具名走 config，改了名字门禁跟着改', () => {
  const h = harness({ planToolName: 'mcp__other__explain' })
  const { agent, steers } = fakeAgent()
  h.command.handler({ agent, rawInput: '' })
  h.result({ name: TOOLS.plan, agent }, ok)
  h.stopping({ agent, turn: 1 })
  assert.equal(steers.length, 1)
  assert.ok(steers[0]!.text.includes('mcp__other__explain'))
})
