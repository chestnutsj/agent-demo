// SKILL.md 的读取与渲染。纯函数，接线在 index.ts。

import { readFileSync } from 'node:fs'
import type { ToolKey } from './config.ts'

/** 占位符语法：`{{tool:plan}}`。key 只允许字母，避免和正文里的花括号混淆。 */
const PLACEHOLDER = /\{\{tool:([A-Za-z]+)\}\}/g

/** 剥掉 YAML frontmatter，返回正文（可能为空）。 */
export function skillBody(raw: string): string {
  const frontmatter = raw.match(/^---\n[\s\S]*?\n---\n?/)
  return (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim()
}

/** 正文里出现过的占位符 key，去重、保持出现顺序。 */
export function placeholders(text: string): string[] {
  const seen: string[] = []
  for (const match of text.matchAll(PLACEHOLDER)) {
    const key = match[1]
    if (key !== undefined && !seen.includes(key)) seen.push(key)
  }
  return seen
}

/**
 * 把占位符换成配置里的工具名。
 *
 * 认不出的 key 直接抛：那意味着 SKILL.md 点了一个 config 里不存在的工具，模型会被
 * 指使去调一个不存在的名字，而门禁又查不到它——正是「提示词说调 A、台账查 B」的
 * 那种失配。这个异常发生在插件加载时，不是运行时，profile 起不来比静默错更好。
 */
export function renderSkill(text: string, tools: Readonly<Record<ToolKey, string>>): string {
  return text.replace(PLACEHOLDER, (_match, key: string) => {
    const tool = (tools as Record<string, string | undefined>)[key]
    if (tool === undefined) {
      throw new Error(
        `dsh-dba-agent: SKILL.md 里的占位符 {{tool:${key}}} 在配置里没有对应的工具名`
        + `（已知：${Object.keys(tools).join(', ')}）`,
      )
    }
    return `\`${tool}\``
  })
}

/** 读文件并剥 frontmatter。文件读不到时返回空串，由调用方决定怎么报。 */
export function readSkill(path: string): string {
  try {
    return skillBody(readFileSync(path, 'utf8'))
  } catch {
    return ''
  }
}
