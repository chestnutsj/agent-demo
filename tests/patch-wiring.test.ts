import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULTS } from '../src/config.ts'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

// 门禁按公开名 `mcp__<serverName>__<rawName>` 查工具。serverName 只在 preset 里定义，
// 改了 preset 而没改 DEFAULTS 的话，门禁会永远判「没调过」并把每个回合都顶回去——
// 这是最容易发生、也最难当场看出来的一种失配。
test('DEFAULTS 里的 mcp 工具名和 preset 的 serverName 对得上', () => {
  const preset = read('../presets/dba-mode/agent.cordis.yml')
  const serverName = /^\s*serverName:\s*(\S+)\s*$/m.exec(preset)?.[1]
  assert.ok(serverName !== undefined, 'preset 里找不到 serverName')
  const prefix = `mcp__${serverName}__`
  const mcpTools = [DEFAULTS.planToolName, DEFAULTS.knowledgeToolName, DEFAULTS.fullCheckToolName]
  for (const tool of mcpTools) {
    assert.ok(tool.startsWith(prefix), `${tool} 不在 ${prefix} 命名空间下`)
  }
})

// validator 不是 MCP 工具，是本地注册的原生工具（本分支还没有这个插件）。它带
// mcp__ 前缀就说明有人把它当成 toolbox 的工具了，那是另一回事。
test('validator 是原生工具名，不带 mcp__ 前缀', () => {
  assert.ok(!DEFAULTS.validatorToolName.startsWith('mcp__'))
})

test('cordis.patch.yml 装载本包插件，且不另抄一份工具名', () => {
  const patch = read('../cordis.patch.yml')
  assert.match(patch, /- id: dba-command\n\s+name: dsh-dba-agent/)
  assert.equal(patch.includes('planToolName'), false)
})
