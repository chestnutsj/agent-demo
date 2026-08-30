// dsh-dba-agent 插件：注册 /sql-optimizer 命令，并给它配一道证据门禁。
//
// 命令执行时给这个 agent 开一本台账；SQL 优化流程（skills/sql-optimize/SKILL.md 的正文，
// 工具名占位符已按 config 渲染）随即以系统提示词分区的形式对该 agent 生效，正文不进对话
// 历史。命令后面跟的那句话是用户自己敲的，原样作为 user 消息发进去起一个回合。此后每次
// 工具返回都记一笔；回合收尾时（agent/turn-stopping）检查硬要求是否都成功返回过，没有就
// steer 顶回去再跑一步。
//
// 为什么流程走 systemPrompt.section 而不是 systemPrompt.context：后者的产物是一条 user 角色
// 的快照消息，等于把整篇流程塞进对话历史；section 只进系统提示词，模型看得见、历史里没有。
//
// 为什么终点检查挂在 turn-stopping 而不是 pre-execute：本流程的终点是「模型输出报告
// 并结束回合」，不是一次工具调用，pre-execute 根本拦不到它。
//
// 为什么入册只认命令：这个分支没有子 agent，命令的 invocation.agent 就是要检查的那个
// agent，比按工具调用反推准确，也覆盖「一次工具都没调就收尾」——恰恰最该拦的情况。
//
// 不 import 任何 @deepseek-ai 包：安装到 profile 的 node_modules 后，那些包在本包的解析
// 链上不一定可达（与本仓库其他 packages 的约定一致）。dsh 的 createUserMessage 等价于
// deepFreeze({...input, role:'user', id: crypto.randomUUID()})，这里直接复制其产物，
// 相关最小类型也在本文件内声明。

import { fileURLToPath } from 'node:url'
import { resolveSettings } from './config.ts'
import type { Config, Settings } from './config.ts'
import { createLedger, errorSummary, gate, noteSteer, record, steerText } from './ledger.ts'
import type { Ledger } from './ledger.ts'
import { readSkill, renderSkill } from './skill.ts'

export const name = 'dsh-dba-agent'
export const inject = ['commands', 'systemPrompt'] as const

export type { Config } from './config.ts'

const SKILL_PATH = fileURLToPath(new URL('../skills/sql-optimize/SKILL.md', import.meta.url))

// 分区排序：dsh 的约定是 -100 harness 身份、0 部署 persona、100–199 工具指引。流程排在
// persona 之后、工具指引之前——它是对 persona 的展开，不是对某个工具的用法说明。
const SECTION_ORDER = 50

/** 消息来源：插件自己说的话（门禁顶回去那条），或用户在命令后面敲的原话。 */
type MessageSource =
  | { kind: 'plugin'; plugin: string; form: 'notice'; summary: string }
  | { kind: 'user' }

/** 注入用的 user 消息，形状与 dsh createUserMessage 的产物一致。 */
interface InjectedMessage {
  id: string
  role: 'user'
  content: { type: 'text'; text: string }[]
  source: MessageSource
}

/** 命令处理结果（UI 文本，不进模型历史）。 */
interface CommandResult {
  kind: 'success' | 'error'
  text?: string
}

/** 本插件用到的 Agent 子集。台账用它本身做 WeakMap 的键。 */
interface AgentLike {
  followup(message: InjectedMessage): void
  steer(message: InjectedMessage): void
}

/** 命令处理器拿到的调用上下文（仅用到的子集）。 */
interface CommandInvocation {
  agent: AgentLike
  rawInput: string
}

interface CommandDefinition {
  name: string
  description: string
  /** 自由输入提示。声明了它，客户端才会把命令的参数交回给用户敲。 */
  input?: { hint: string }
  handler(invocation: CommandInvocation): CommandResult
}

/** tools/result 的第一个参数（仅用到的子集）。 */
interface ToolExecutionLike {
  name: string
  agent?: AgentLike
}

/** tools/result 的第二个参数（仅用到的子集）。 */
interface ToolResultLike {
  isError: boolean
  error?: unknown
}

interface TurnStopping {
  agent: AgentLike
  turn: number
}

/** 一次系统提示词装配的上下文（仅用到的子集）。诊断装配没有 agent。 */
interface AssembleContextLike {
  agent?: AgentLike
}

/** 一段系统提示词分区（仅用到的子集）。 */
interface PromptSectionLike {
  name: string
  order: number
  text(context: AssembleContextLike): string
}

/** 本插件用到的 DSH 插件上下文子集。 */
interface PluginContext {
  commands: { register(definition: CommandDefinition): unknown }
  systemPrompt: { section(section: PromptSectionLike): unknown }
  on(event: 'tools/result', listener: (exec: ToolExecutionLike, result: ToolResultLike) => void): unknown
  on(event: 'agent/turn-stopping', listener: (payload: TurnStopping) => void): unknown
  logger?: { info?(message: string): void; debug?(message: string): void }
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

/**
 * 复制 dsh createUserMessage 的产物：一条 user 角色、plugin 来源的消息。
 * source.kind 必须是 'plugin'——不打标签的消息在派生历史里会渲染成用户提问。
 */
function pluginUserMessage(text: string, summary: string): InjectedMessage {
  return deepFreeze({
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'notice', summary },
  })
}

/** 用户在命令后面敲的原话。来源标 user，因为那确实是用户说的。 */
function userMessage(text: string): InjectedMessage {
  return deepFreeze({
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/** 日志里只出现工具名，不出现 SQL——台账本来也不存参数。 */
function missingNames(items: readonly { tool: string }[]): string {
  return items.map(item => item.tool).join(',')
}

export function apply(ctx: PluginContext, config: Config = {}): void {
  const settings: Settings = resolveSettings(config)
  const tracked = new Set(settings.requirements.map(requirement => requirement.tool))
  // 加载时就渲染：占位符对不上配置要在 profile 起来的那一刻炸，而不是等用户敲命令。
  const skill = renderSkill(readSkill(SKILL_PATH), settings.tools)

  const ledgers = new WeakMap<AgentLike, Ledger>()

  // 流程正文只对入册过的 agent 生效，每次装配重新求值。ledgers 只增不删（再次执行命令是
  // 换一本新台账，不是销号），所以分区一旦生效就不会中途闪断。
  ctx.systemPrompt.section({
    name: 'dba:sql-optimize',
    order: SECTION_ORDER,
    text: context => (context.agent !== undefined && ledgers.has(context.agent) ? skill : ''),
  })

  ctx.commands.register({
    name: 'sql-optimizer',
    description: '优化一条 MySQL SQL：取证执行计划与表统计 → 定位瓶颈 → 按代价给出改写与索引建议 → 交回可执行变更',
    // 声明 input 是「选中命令后还能接着打字」的开关：没有 input 的命令在客户端菜单里选中
    // 即执行，用户没有地方写 SQL。
    input: { hint: '<要优化的 SQL 或诉求>' },
    handler: (invocation: CommandInvocation): CommandResult => {
      if (skill === '') {
        return { kind: 'success', text: 'SQL 优化流程尚未配置（skills/sql-optimize/SKILL.md 正文为空）。' }
      }
      // 每次执行都换一本新台账：新一轮优化要新一份证据，否则第二条语句会被第一条的
      // 计划记录直接放行。
      const ledger = createLedger()
      ledger.enrolled = true
      ledgers.set(invocation.agent, ledger)
      ctx.logger?.debug?.(`[${name}] enrolled via command, required=${missingNames(settings.requirements.filter(r => r.hard))}`)
      const request = invocation.rawInput.trim()
      // 空参数只入册、不起回合：流程分区这时已经对该 agent 生效，用户下一条普通消息照样
      // 归门禁管，没必要先空转一个回合。
      if (request === '') return { kind: 'success', text: '已进入 SQL 优化流程，把要优化的 SQL 发过来。' }
      invocation.agent.followup(userMessage(request))
      return { kind: 'success', text: '已进入 SQL 优化流程。' }
    },
  })

  // 记账挂在 tools/result 而不是 post-execute：post-execute 那时后面的监听器还能把成功
  // 改成 block，记下的「成功」不算数。tools/result 拿到的是冻结后的最终结果。
  ctx.on('tools/result', (exec, result) => {
    const agent = exec?.agent
    if (agent === undefined) return
    const ledger = ledgers.get(agent)
    if (ledger === undefined) return
    if (!tracked.has(exec.name)) return
    const ok = result?.isError === false
    record(ledger, exec.name, ok, ok ? undefined : errorSummary(result?.error, settings.errorPreviewChars))
  })

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const ledger = ledgers.get(agent)
    if (ledger?.enrolled !== true) return
    const verdict = gate(ledger, settings.requirements)
    if (verdict.ok) return
    if (!noteSteer(ledger, turn, settings.maxSteers)) {
      ctx.logger?.info?.(`[${name}] gate=bypassed turn=${String(turn)} missing=${missingNames(verdict.missing)}`)
      return
    }
    ctx.logger?.info?.(
      `[${name}] gate=steer turn=${String(turn)} n=${String(ledger.steersInTurn)} missing=${missingNames(verdict.missing)}`,
    )
    agent.steer(pluginUserMessage(steerText(verdict.missing), `缺证据 ×${String(verdict.missing.filter(m => m.hard).length)}`))
  })
}
