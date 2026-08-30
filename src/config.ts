// 工具名的唯一来源。
//
// 门禁（ledger.gate）和提示词（skill.renderSkill 填的占位符）都从这里取名字。两边各自
// 写死会出现「提示词说调 A、台账查 B」的静默失配——换 MCP 服务器时只改配置，不动文案。

/** 需求项的稳定 id，同时是 SKILL.md 里 `{{tool:<key>}}` 占位符的名字。 */
export type ToolKey = 'plan' | 'knowledge' | 'fullCheck' | 'validator'

export interface Config {
  /** 取执行计划的工具名。唯一的硬要求。 */
  planToolName?: string
  /** 检索 SQL 优化规则/技巧的知识库工具名。软要求。 */
  knowledgeToolName?: string
  /** 输出前 SQL 合规检查工具名。软要求。 */
  fullCheckToolName?: string
  /** 提交改写候选的工具名。软要求——台账看不到报告里有没有改写，硬要求会误伤「本次无改写」。 */
  validatorToolName?: string
  /** 同一回合最多顶回去几次，默认 1。用完后放行并记 gate=bypassed。 */
  maxSteers?: number
  /** 错误摘要截断长度，默认 200。MCP 的错误信息可能把整条语句带进来。 */
  errorPreviewChars?: number
}

// TODO 待 http://moyu.local:5000/mcp/mysql-optimize 的 tools/list 确认。
// 前缀来自 presets/dba-mode/agent.cordis.yml 的 `serverName: mysql-optimize`：
// dsh-mcp-client 的公开名规则是 `mcp__<serverName>__<rawName>`，连字符属于合法字符、
// 不会被改写。名字对不上时门禁会永远判「没调过」，所以先只把 plan 设成硬要求。
export const DEFAULTS = {
  planToolName: 'mcp__mysql-optimize__get_query_plan',
  knowledgeToolName: 'mcp__mysql-optimize__search_sql_knowledge',
  fullCheckToolName: 'mcp__mysql-optimize__sql_full_check',
  validatorToolName: 'sql_equivalence_validator',
  maxSteers: 1,
  errorPreviewChars: 200,
} as const

/** 一条要求：某个工具至少成功返回过一次。 */
export interface Requirement {
  readonly key: ToolKey
  readonly tool: string
  /** true：不满足就在回合边界顶回去。false：不单独触发顶回，只附在已触发的那条消息里。 */
  readonly hard: boolean
  /** 缺这一项时对模型说的理由。 */
  readonly reason: string
}

/** 硬/软的划分。改这里等于改门禁强度，是全包唯一一处。 */
const HARD: ReadonlySet<ToolKey> = new Set<ToolKey>(['plan'])

const REASONS: Readonly<Record<ToolKey, string>> = {
  plan: '没有执行计划就下结论等于猜。先对原始语句取计划。',
  knowledge: '阶段三的策略链要基于检索结果，不是凭记忆。',
  fullCheck: '输出前的一票否决项：报告里出现的每一条 SQL 都要过合规检查。',
  validator: '有改写建议就要逐条提交；一条都没提交，说明要么没改写，要么跳过了阶段五。',
}

export interface Settings {
  /** key → 工具名，渲染 SKILL.md 占位符用。 */
  readonly tools: Readonly<Record<ToolKey, string>>
  readonly requirements: readonly Requirement[]
  readonly maxSteers: number
  readonly errorPreviewChars: number
}

/**
 * 把配置摊平成运行时用的形状。纯函数，不碰 dsh 运行时。
 * `tools` 和 `requirements` 是同一份名字的两个投影——这是「单一来源」落地的地方。
 */
export function resolveSettings(config: Config = {}): Settings {
  const tools: Record<ToolKey, string> = {
    plan: config.planToolName ?? DEFAULTS.planToolName,
    knowledge: config.knowledgeToolName ?? DEFAULTS.knowledgeToolName,
    fullCheck: config.fullCheckToolName ?? DEFAULTS.fullCheckToolName,
    validator: config.validatorToolName ?? DEFAULTS.validatorToolName,
  }
  const keys: ToolKey[] = ['plan', 'knowledge', 'fullCheck', 'validator']
  const requirements = keys.map((key): Requirement => ({
    key,
    tool: tools[key],
    hard: HARD.has(key),
    reason: REASONS[key],
  }))
  const maxSteers = config.maxSteers ?? DEFAULTS.maxSteers
  const errorPreviewChars = config.errorPreviewChars ?? DEFAULTS.errorPreviewChars
  if (!Number.isInteger(maxSteers) || maxSteers < 0) {
    throw new Error(`dsh-dba-agent: maxSteers 必须是非负整数，收到 ${String(config.maxSteers)}`)
  }
  if (!Number.isInteger(errorPreviewChars) || errorPreviewChars < 1) {
    throw new Error(`dsh-dba-agent: errorPreviewChars 必须是正整数，收到 ${String(config.errorPreviewChars)}`)
  }
  return { tools, requirements, maxSteers, errorPreviewChars }
}
