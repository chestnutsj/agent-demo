import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULTS, apply } from '../packages/sql-optimizer/src/index.js'
import { MCP_RAW_TOOL, MCP_SERVER, SQL_TOOL } from '../packages/mysql-mcp/src/names.js'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const mcpPatch = read('../packages/mysql-mcp/cordis.patch.yml')
const optPatch = read('../packages/sql-optimizer/cordis.patch.yml')

function fakeContext(tools: string[]) {
  let text = ''
  const ctx = {
    tools: { get: (n: string) => (tools.includes(n) ? {} : undefined) },
    systemPrompt: {
      section: (s: { text: (a: unknown) => string }) => {
        text = s.text({})
      },
    },
  } as unknown as Context
  return { ctx, read: () => text }
}

it('MCP 装了就让子 agent 走它取证', () => {
  const { ctx, read } = fakeContext([DEFAULTS.dbToolName, DEFAULTS.askToolName])
  apply(ctx)
  expect(read()).toContain(DEFAULTS.dbToolName)
  expect(read()).toContain('EXPLAIN FORMAT=JSON')
})

it('MCP 没装就退到 ask_user_question 让用户提交数据', () => {
  const { ctx, read } = fakeContext([DEFAULTS.askToolName])
  apply(ctx)
  expect(read()).not.toContain(DEFAULTS.dbToolName)
  expect(read()).toContain(DEFAULTS.askToolName)
  expect(read()).toContain('没有挂数据库工具')
})

it('两个都没有就把语句写进回答里', () => {
  const { ctx, read } = fakeContext([])
  apply(ctx)
  expect(read()).toContain('在回答里原样列出')
})

it('模型看到的工具名由 serverName 与服务器暴露的名字拼成', () => {
  expect(SQL_TOOL).toBe(`mcp__${MCP_SERVER}__${MCP_RAW_TOOL}`)
  expect(mcpPatch).toMatch(new RegExp(`^ {8}serverName: ${MCP_SERVER}$`, 'm'))
  expect(optPatch).toMatch(new RegExp(`^ {8}dbToolName: ${SQL_TOOL}$`, 'm'))
})

it('两个包各自独立：子 agent 的 patch 不提 MCP 服务器，反之亦然', () => {
  expect(optPatch).not.toContain('dsh-mcp-client')
  expect(mcpPatch).not.toContain('tool-subagent')
  expect(optPatch).toMatch(/^ {8}toolName: sql_optimizer$/m)
  expect(optPatch).toMatch(/^ {8}provider: spawn$/m)
  expect(optPatch).toMatch(/name: '@deepseek-ai\/dsh-tool-ask-user'/)
})

it('persona 不写死数据库工具存在', () => {
  const persona = /^ {8}persona: \|\n((?: {10}.*\n|\n)+)/m.exec(optPatch)?.[1] ?? ''
  expect(persona.length).toBeGreaterThan(400)
  expect(persona).not.toContain(SQL_TOOL)
  expect(persona).not.toMatch(/\{\{|\}\}/)
})
