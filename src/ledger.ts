// 工具调用台账与终点判定。全是纯函数，不 import 任何 dsh 运行时——接线在 index.ts。

import type { Requirement, ToolKey } from './config.ts'

/** 一个工具在一个 agent 身上的调用记录。不存参数原文，只存计数与错误摘要。 */
export interface ToolTally {
  /** isError === false 的次数。 */
  ok: number
  /** isError === true 的次数。被 pre-execute 拒掉的调用也走完流水线，同样计在这里。 */
  err: number
  /** 最后一次调用的时刻（Date.now()），用于诊断顺序问题。 */
  lastAt: number
  /** 最后一次失败的错误摘要，已折行并截断。 */
  lastError?: string
}

/** 一个 agent 的台账。 */
export interface Ledger {
  /** 工具名 → 记录。工具名是注册表里的公开名（含 mcp__ 前缀）。 */
  tools: Record<string, ToolTally>
  /** 是否属于本流程。只有 /sql-optimizer 命令会置 true。 */
  enrolled: boolean
  /** 本回合已经顶回去几次。 */
  steersInTurn: number
  /** steersInTurn 归属的回合号；回合变了就归零。 */
  steerTurn: number
}

export function createLedger(): Ledger {
  return { tools: Object.create(null) as Record<string, ToolTally>, enrolled: false, steersInTurn: 0, steerTurn: -1 }
}

/**
 * 把任意错误值压成一行摘要。
 *
 * 折行是必要的：MCP 的错误信息经常是多行的，直接塞进 steer 会刷屏；截断是必要的：
 * 它可能把整条语句带进来。两者都做完还是有可能残留业务字面量，所以这个摘要只进
 * 模型消息与日志，不进任何持久化。
 */
export function errorSummary(value: unknown, cap: number): string | undefined {
  let text: string
  try {
    if (value === undefined || value === null) return undefined
    if (typeof value === 'string') text = value
    else if (value instanceof Error) text = value.message
    else if (typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
      text = (value as { message: string }).message
    } else text = JSON.stringify(value) ?? String(value)
  } catch {
    return undefined
  }
  const folded = text.replace(/\s+/g, ' ').trim()
  if (folded === '') return undefined
  return folded.length <= cap ? folded : `${folded.slice(0, cap)}…`
}

/**
 * 记一次调用。
 *
 * 这个函数不允许抛异常：它跑在 `tools/result` 的 emit 监听器里，那里的异常会被运行时
 * 隔离吞掉，一旦抛了就是「记账静默失效、门禁却照常判缺」。所以入参一律防御性处理。
 */
export function record(ledger: Ledger, toolName: unknown, ok: boolean, error?: string): void {
  if (ledger === null || typeof ledger !== 'object') return
  if (typeof toolName !== 'string' || toolName === '') return
  if (ledger.tools === null || typeof ledger.tools !== 'object') ledger.tools = Object.create(null) as Record<string, ToolTally>
  const tally = ledger.tools[toolName] ?? { ok: 0, err: 0, lastAt: 0 }
  if (ok) tally.ok += 1
  else {
    tally.err += 1
    if (error !== undefined) tally.lastError = error
  }
  tally.lastAt = Date.now()
  ledger.tools[toolName] = tally
}

/** 缺失的两种成因，文案完全不同：一种是催他去调，一种是叫他走降级路径。 */
export type MissingKind = 'never-called' | 'all-failed'

export interface Missing {
  readonly key: ToolKey
  readonly tool: string
  readonly kind: MissingKind
  readonly hard: boolean
  readonly reason: string
  readonly errors?: number
  readonly lastError?: string
}

export interface Verdict {
  /** 只看硬要求。软要求缺失不影响放行，但仍然列在 missing 里。 */
  readonly ok: boolean
  readonly missing: readonly Missing[]
}

/** 台账 + 要求 → 判定。`ok > 0` 即满足，失败过但最终成功了不算缺。 */
export function gate(ledger: Ledger, requirements: readonly Requirement[]): Verdict {
  const missing: Missing[] = []
  for (const requirement of requirements) {
    const tally = ledger.tools[requirement.tool]
    if (tally !== undefined && tally.ok > 0) continue
    const errors = tally?.err ?? 0
    missing.push({
      key: requirement.key,
      tool: requirement.tool,
      kind: errors > 0 ? 'all-failed' : 'never-called',
      hard: requirement.hard,
      reason: requirement.reason,
      ...(errors > 0 ? { errors } : {}),
      ...(tally?.lastError !== undefined ? { lastError: tally.lastError } : {}),
    })
  }
  return { ok: !missing.some(item => item.hard), missing }
}

/** 一条缺失渲染成一行。 */
function missingLine(item: Missing): string {
  if (item.kind === 'never-called') return `- \`${item.tool}\`：还没调过。${item.reason}`
  const tail = item.lastError === undefined ? '' : `最后一次：${item.lastError}`
  return `- \`${item.tool}\`：调了 ${String(item.errors)} 次都失败了。${tail}`
    + '按流程把它写进「待补证据」那一节，不要凭语句文本编一份诊断。'
}

/**
 * 顶回去时对模型说的话。
 *
 * 软要求不会单独触发顶回（gate 的 ok 只看硬要求），但硬要求已经把这一轮顶回来了，
 * 顺带把软的一起说完，省一个来回。
 *
 * 最后一段是必须的：本流程跨多个回合，模型停下来向用户要 SQL 原文是合法的收尾，
 * 不给它这条出路就会逼出一份没有证据的诊断——那正是门禁想防的东西。
 */
export function steerText(missing: readonly Missing[]): string {
  const hard = missing.filter(item => item.hard)
  const soft = missing.filter(item => !item.hard)
  const parts = ['SQL 优化流程的证据还不齐，先补齐再给结论。', '', '必须补：', ...hard.map(missingLine)]
  if (soft.length > 0) {
    parts.push('', '顺带（不阻塞本轮输出）：', ...soft.map(missingLine))
  }
  parts.push(
    '',
    '如果你正在等用户补充信息（例如还没拿到 SQL 原文或库表名），直接说明缺什么并结束本轮，'
    + '不要凭空补一份诊断。',
  )
  return parts.join('\n')
}

/**
 * 登记一次顶回，返回是否允许。
 *
 * 计数按回合重置：本流程跨多个回合，按会话累计会在第二个回合就用光额度。
 * 额度用完返回 false——模型不配合时不能无限顶，调用方放行并记 gate=bypassed。
 */
export function noteSteer(ledger: Ledger, turn: number, maxSteers: number): boolean {
  if (ledger.steerTurn !== turn) {
    ledger.steerTurn = turn
    ledger.steersInTurn = 0
  }
  if (ledger.steersInTurn >= maxSteers) return false
  ledger.steersInTurn += 1
  return true
}
