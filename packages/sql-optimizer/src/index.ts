import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'dsh-sql-optimizer'

export const inject = { required: ['systemPrompt'], optional: ['tools'] }

export interface Config {
  subagentToolName?: string
  dbToolName?: string
  askToolName?: string
}

export const DEFAULTS = {
  subagentToolName: 'sql_optimizer',
  dbToolName: 'mcp__mysql__execute_sql',
  askToolName: 'ask_user_question',
} as const

export function evidenceText(dbTool: string, askTool: string, hasDb: boolean, hasAsk: boolean) {
  if (hasDb) {
    return `取证走 \`${dbTool}\`：EXPLAIN FORMAT=JSON、SHOW CREATE TABLE、SHOW INDEX、SELECT VERSION()。
该工具报错或某项证据它取不到时，${
      hasAsk
        ? `用 \`${askTool}\` 把需要执行的语句交给用户，请他贴回结果`
        : '在回答里原样列出需要执行的语句，请用户贴回结果'
    }。`
  }
  return `本部署没有挂数据库工具，取证只能靠用户提交：${
    hasAsk
      ? `用 \`${askTool}\` 把需要执行的语句交给用户，请他贴回结果`
      : '在回答里原样列出需要执行的语句，请用户贴回结果'
  }。不要凭语句文本猜一份"看起来像"的诊断。`
}

export function routingText(subagentTool: string, evidence: string): string {
  return `# SQL 优化的委派

单条 SQL 的优化交给 \`${subagentTool}\` 子 agent，不要在本会话里直接做。判据是请求聚焦在一条
具体语句上——"这条为什么慢"、"这条怎么优化"、"这个索引该怎么建"。服务器整体的参数调整、
容量规划、纯概念问答不属于这里。

子 agent 从空上下文开始，看不到本会话任何历史，所以提示词里必须自带：完整的原始语句、
库表名与数据规模、现象与目标、能不能改语句/加索引/停机这类约束。

拿回来的是一份优化报告：诊断、按代价排序的方案、每个方案的验证方式。中间步骤留在子 agent
自己的会话里。

## 证据从哪来

${evidence}`
}

export function apply(ctx: Context, config: Config = {}): void {
  const subagentTool = config.subagentToolName ?? DEFAULTS.subagentToolName
  const dbTool = config.dbToolName ?? DEFAULTS.dbToolName
  const askTool = config.askToolName ?? DEFAULTS.askToolName

  ctx.systemPrompt.section({
    name: 'sql-optimizer:delegation',
    order: 150,
    text: (assembly: AssembleContext) => {
      const has = (tool: string) => ctx.tools?.get(tool, assembly.scope) !== undefined
      return routingText(subagentTool, evidenceText(dbTool, askTool, has(dbTool), has(askTool)))
    },
  })
}
