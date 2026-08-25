// 方法4:代码注册 skill(ctx.skills.register)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-dba-skill-code'
export const inject = ['skills'] as const

interface DbaConfig {
  host?: string
  port?: number | string
  user?: string
  password?: string
  database?: string
}

function toMysqlEnv(config: DbaConfig = {}): Record<string, string> {
  const env: Record<string, string> = {}
  if (config.host != null) env.MYSQL_HOST = String(config.host)
  if (config.port != null) env.MYSQL_PORT = String(config.port)
  if (config.user != null) env.MYSQL_USER = String(config.user)
  if (config.password != null) env.MYSQL_PASSWORD = String(config.password)
  if (config.database != null) env.MYSQL_DATABASE = String(config.database)
  return env
}

interface SkillRegistration {
  name: string
  description: string
  source: string // dsh-skill 校验必需
  content: string
}
interface PluginContext {
  skills: { register(skill: SkillRegistration): () => void }
  logger?: { info?(message: string): void }
}

export function apply(ctx: PluginContext, config: DbaConfig = {}): void {
  Object.assign(process.env, toMysqlEnv(config))

  const skillPath = fileURLToPath(new URL('../skills/mysql-query/SKILL.md', import.meta.url))
  const scriptPath = fileURLToPath(new URL('../scripts/mysql_query.sh', import.meta.url))
  const raw = readFileSync(skillPath, 'utf8')
  const { attrs, body } = parseFrontmatter(raw)
  const content = body.replaceAll('{{QUERY_SH}}', scriptPath)

  ctx.skills.register({
    name: attrs.name ?? 'mysql-query',
    description: attrs.description ?? '',
    source: skillPath,
    content,
  })

  ctx.logger?.info?.(`[dsh-dba-skill-code] registered skill "${attrs.name ?? 'mysql-query'}"`)
}

function parseFrontmatter(text: string): { attrs: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return { attrs: {}, body: text.trim() }

  const attrs: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '')
    if (key.length > 0) attrs[key] = value
  }
  return { attrs, body: match[2].trim() }
}
