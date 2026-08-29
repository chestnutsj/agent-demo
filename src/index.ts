// dsh-dba-agent 插件：注册 /sql-optimizer 命令。执行时把 SQL 优化流程的 skill
// （skills/sql-optimize/SKILL.md 的正文）一次性注入当前会话。
//
// 不 import 任何 @deepseek-ai 包：安装到 profile 的 node_modules 后，那些包在本包的解析
// 链上不一定可达（与本仓库其他 packages 的约定一致）。dsh 的 createUserMessage 等价于
// deepFreeze({...input, role:'user', id: crypto.randomUUID()})，这里直接复制其产物，
// 相关最小类型也在本文件内声明。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-dba-agent'
export const inject = ['commands'] as const

const SKILL_PATH = fileURLToPath(new URL('../skills/sql-optimize/SKILL.md', import.meta.url))

/** 注入用的 user 消息，形状与 dsh createUserMessage 的产物一致。 */
interface InjectedMessage {
  id: string
  role: 'user'
  content: { type: 'text'; text: string }[]
  source: { kind: 'plugin'; plugin: string; form: 'notice'; summary: string }
}

/** 命令处理结果（UI 文本，不进模型历史）。 */
interface CommandResult {
  kind: 'success' | 'error'
  text?: string
}

/** 命令处理器拿到的调用上下文（仅用到的子集）。 */
interface CommandInvocation {
  agent: { followup(message: InjectedMessage): void }
  rawInput: string
}

interface CommandDefinition {
  name: string
  description: string
  handler(invocation: CommandInvocation): CommandResult
}

/** 本插件用到的 DSH 插件上下文子集。 */
interface PluginContext {
  commands: { register(definition: CommandDefinition): unknown }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

/** 复制 dsh createUserMessage 的产物：一条 user 角色、plugin 来源的消息。 */
function pluginUserMessage(text: string): InjectedMessage {
  return deepFreeze({
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'notice', summary: 'SQL 优化流程' },
  })
}

/** 读 SKILL.md，剥掉 YAML frontmatter，返回正文（可能为空）。 */
function readSkillBody(): string {
  let raw: string
  try {
    raw = readFileSync(SKILL_PATH, 'utf8')
  } catch {
    return ''
  }
  const fm = raw.match(/^---\n[\s\S]*?\n---\n?/)
  return (fm ? raw.slice(fm[0].length) : raw).trim()
}

export function apply(ctx: PluginContext): void {
  ctx.commands.register({
    name: 'sql-optimizer',
    description: '优化一条 MySQL SQL：取证执行计划与表统计 → 定位瓶颈 → 按代价给出改写与索引建议 → 交回可执行变更',
    handler: (invocation: CommandInvocation): CommandResult => {
      const body = readSkillBody()
      if (body === '') {
        return { kind: 'success', text: 'SQL 优化流程尚未配置（skills/sql-optimize/SKILL.md 正文为空）。' }
      }
      invocation.agent.followup(pluginUserMessage(body))
      return { kind: 'success', text: '已加载 SQL 优化流程。' }
    },
  })
}
