import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { MCP_RAW_TOOL, MCP_SERVER } from './names.js'

const scriptPath = fileURLToPath(new URL('../scripts/mysql_query.sh', import.meta.url))

function runQuery(sql: string, database?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = database ? { ...process.env, MYSQL_DATABASE: database } : process.env
    const child = spawn('bash', [scriptPath, sql], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error: Error) => resolve({ code: -1, out: String(error) }))
    child.on('close', (code: number | null) =>
      resolve({ code: code ?? -1, out: code === 0 ? stdout : stderr || stdout }),
    )
  })
}

const server = new McpServer({ name: MCP_SERVER, version: '0.1.0' })

server.registerTool(
  MCP_RAW_TOOL,
  {
    description:
      '对 MySQL 执行一条 SQL 并返回结果表。用于取证：EXPLAIN FORMAT=JSON、SHOW CREATE TABLE、SHOW INDEX、SELECT VERSION()、information_schema 查询等。',
    inputSchema: {
      sql: z.string().describe('要执行的单条语句，如 EXPLAIN FORMAT=JSON SELECT ...'),
      database: z.string().optional().describe('可选的库名，省略则用连接自带的。'),
    },
  },
  async ({ sql, database }: { sql: string; database?: string }) => {
    const { code, out } = await runQuery(sql, database)
    if (code !== 0) {
      return { isError: true, content: [{ type: 'text' as const, text: out || `exit ${code}` }] }
    }
    return { content: [{ type: 'text' as const, text: out.trim() || '(no rows)' }] }
  },
)

await server.connect(new StdioServerTransport())
