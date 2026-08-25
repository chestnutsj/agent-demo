// dsh-dba-tool — Method 3 of 3: register a Tool directly.
//
// Unlike the MCP path (which runs a separate stdio server process), this plugin
// registers a native `mysql_query` tool straight into the shared tool catalog
// via `ctx.tools.register()` and runs scripts/mysql_query.sh IN-PROCESS.
//
// Built to lib/index.js; the build syncs the shared script to
// scripts/mysql_query.sh at the package root, so from lib/index.js it resolves
// as ../scripts/mysql_query.sh.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-dba-tool'
export const inject = ['tools'] as const

const scriptPath = fileURLToPath(new URL('../scripts/mysql_query.sh', import.meta.url))

/** Single-connection settings, loaded from the cordis `config:` block. */
interface DbaConfig {
  host?: string
  port?: number | string
  user?: string
  password?: string
  database?: string
}

/**
 * Map the config block onto MYSQL_* env overrides, emitting ONLY the fields
 * that were actually set. Unset fields are omitted so the ambient environment
 * (and then the script's own defaults) still apply — giving the priority
 * order: config > MYSQL_* env > script default.
 */
function toMysqlEnv(config: DbaConfig = {}): Record<string, string> {
  const env: Record<string, string> = {}
  if (config.host != null) env.MYSQL_HOST = String(config.host)
  if (config.port != null) env.MYSQL_PORT = String(config.port)
  if (config.user != null) env.MYSQL_USER = String(config.user)
  if (config.password != null) env.MYSQL_PASSWORD = String(config.password)
  if (config.database != null) env.MYSQL_DATABASE = String(config.database)
  return env
}

// The installed dsh-tools `ctx.tools.register()` expects the current
// ToolDefinition contract: a JSON-Schema `parameters`, an `output` projection
// ({ schema, render }) that turns one canonical value into model content, and
// an `execute` that returns that canonical value (throwing on failure). This is
// the subset we use, typed locally so the plugin needs no dsh-internal imports.
type ContentBlock = { type: 'text'; text: string }
interface ToolArgs { sql: string }
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: ToolArgs, value: string): ContentBlock[]
    presentationMeta?(args: ToolArgs, value: string): unknown
  }
  execute(args: ToolArgs, exec: unknown): Promise<string>
  timeoutMs?: number
}
interface PluginContext {
  tools: { register(tool: ToolDefinition): () => void }
  logger?: { info?(message: string): void }
}

interface QueryResult {
  code: number
  stdout: string
  stderr: string
}

/** Run one SQL statement through mysql_query.sh and capture its output. */
function runQuery(sql: string, envOverrides: Record<string, string> = {}): Promise<QueryResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath, sql], { env: { ...process.env, ...envOverrides } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error: Error) => resolve({ code: -1, stdout: '', stderr: String(error) }))
    child.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

export function apply(ctx: PluginContext, config: DbaConfig = {}): void {
  const envOverrides = toMysqlEnv(config)

  ctx.tools.register({
    name: 'mysql_query',
    description: '查询 MySQL 数据库。需要查看数据库、表、数据或服务器状态时使用',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The SQL to execute, e.g. "SELECT NOW();"' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
    output: {
      // The canonical value is the query's text output; render projects it to
      // model-facing content verbatim.
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: value }]
      },
    },
    async execute({ sql }) {
      const { code, stdout, stderr } = await runQuery(sql, envOverrides)
      if (code !== 0) {
        // Throw so the harness normalizes it into an error result.
        throw new Error(`mysql_query.sh exited with code ${code}\n${stderr || stdout || '(no output)'}`)
      }
      return stdout.trim() || '(no rows)'
    },
  })

  ctx.logger?.info?.('[dsh-dba-tool] registered tool "mysql_query"')
}
