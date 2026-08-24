// Level one of the router: a system-prompt section, not a tool.
//
// Routing is a DECISION, and in this harness decisions belong to the model
// with the prompt shaping them — a "router tool" would only add a round trip
// whose output the model then has to act on anyway.
//
// This section does exactly two things, in order:
//
//   1. decide whether the request is database work at all;
//   2. if it is, put it in one of the second-level classes in ./routes.ts.
//
// It stops there. HOW a class is handled is the class's own playbook section
// (./sql-optimize.ts, the one class implemented so far), which renders after
// this one. Keeping the two levels apart is what lets a class ship without
// touching the classifier, and lets the classifier stay short enough that the
// model actually applies it.
//
// The text is STATIC. A section may be a provider evaluated per assembly, but
// this pack ships its tool and its skill in the same bundle layer as this
// plugin, so what the section can name is fixed at build time — resolving it
// per assembly would buy a `tools` injection and answer a question that has
// only one answer.

import { ENGINES, READY_ENGINES } from '../core/engine.js'
import type { PluginContext } from '../harness.js'
import { MCP_TOOL_PREFIX } from '../tools/names.js'
import { ROUTES } from './routes.js'
import type { Route } from './routes.js'

/** Renders after tool guidance (100-199) so it can refer to the tools by name. */
const ROUTER_SECTION_ORDER = 150

/**
 * Render one class as a bullet: what it covers, and what happens next.
 * @param route - the class to render.
 * @returns the markdown bullet.
 */
function routeLine(route: Route): string {
  const head = `- **${route.title}** — ${route.covers}。`
  if (route.status === 'planned') return `${head}**本版本未实现**：${route.note ?? ''}`
  return `${head}已实现：加载 \`${route.skill}\` 技能，按其中的流程走。`
}

/** The level-one router text. */
const ROUTER_TEXT = [
  '# 数据库问题路由',
  '',
  '收到请求先分两步，再动手。',
  '',
  '## 第一步：这是数据库工作吗',
  '',
  '不是——纯应用代码、纯系统运维、纯概念问答——就按普通请求处理，不要碰数据库工具。',
  '数据库相关的概念与文档问题也归这里：直接凭知识回答，不需要连服务器。',
  '',
  '是的话进第二步。',
  '',
  '## 第二步：归入哪一类',
  '',
  ...ROUTES.map(routeLine),
  '',
  '',
  '## 还有一个维度：数据库类型',
  '',
  `取证工具只实现了 ${READY_ENGINES.map(engine => engine.title).join(' / ')}。`
  + `${ENGINES.filter(engine => engine.status === 'planned').map(engine => engine.title).join(' / ')} 等`
  + '虽然认得，但没有对应的取证实现——遇到这些直说"这个数据库本版本还没实现"，',
  '不要用通用 SQL 经验代替那个引擎的执行计划：不同优化器对同一条语句的最优计划可能相反。',
  '',
  '一次只走一类。判不准就问用户，不要同时按两类做。',
  '标着**未实现**的类目：明确告诉用户这一类本版本还没做，说清楚缺的是什么',
  '（不是"我不知道"，而是"给这个答案需要 X，本包还没有 X"），不要用通用经验凑一个答案。',
  '',
  '## 三条共同规则',
  '',
  '1. **证据先于结论。** 每个结论都要有工具输出支撑。没有 `EXPLAIN` 就说"大概是少了索引"，',
  '   那是猜测，而递给 DBA 的猜测比不回答更糟。',
  `2. **只读。** 数据库访问只有 \`${MCP_TOOL_PREFIX}sql_evidence\` 这一个工具——这个 agent`,
  '   没有 shell，也没有"随便执行一条 SQL"的入口。被优化的语句只会跟在 `EXPLAIN` 后面跑，',
  '   其余语句都是本包生成的只读语句。要执行变更就把语句和影响交给运维。',
  '3. **连不上就接力。** 工具返回内容以 `DBA_OFFLINE:` 开头时，说明这台机器连不到服务器。',
  '   不要重试，也不要凭假设作答——把返回里列出的语句用代码块转述给用户，说明每条是用来',
  '   确认什么的，等用户把输出贴回来再继续分析。接力是受支持的工作模式，不是失败。',
].join('\n')

/**
 * Register the level-one router section.
 * @param ctx - the plugin context, with `systemPrompt` injected.
 */
export function registerRouter(ctx: PluginContext): void {
  ctx.systemPrompt.section({ name: 'dba:router', order: ROUTER_SECTION_ORDER, text: ROUTER_TEXT })
  ctx.logger.info(`registered the dba:router prompt section (${ROUTES.length} classes)`)
}
