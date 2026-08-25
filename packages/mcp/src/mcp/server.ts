// dsh-dba-mcp — Method 2 of 3: an MCP stdio server.
//
// Exposes a single tool, `mysql_query`, that runs the bundled
// scripts/mysql_query.sh helper (which shells out to the `mysql` client). DSH's
// in-box MCP client launches this over stdio and surfaces the tool to the model
// as `mcp__dba_mysql__mysql_query`.
//
// Built to lib/mcp/server.js; the build syncs the shared script to
// scripts/mysql_query.sh at the package root, so from lib/mcp/server.js it
// resolves as ../../scripts/mysql_query.sh.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const scriptPath = fileURLToPath(new URL('../../scripts/mysql_query.sh', import.meta.url))

interface QueryResult {
  code: number
  stdout: string
  stderr: string
}

/** Run one SQL statement through mysql_query.sh and capture its output. */
function runQuery(sql: string): Promise<QueryResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath, sql], { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error: Error) => resolve({ code: -1, stdout: '', stderr: String(error) }))
    child.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

const server = new McpServer({ name: 'dba-mysql', version: '0.1.0' })

server.registerTool(
  'mysql_query',
  {
    description: '查询 MySQL 数据库。需要查看数据库、表、数据或服务器状态时使用',
    inputSchema: { sql: z.string().describe('The SQL to execute, e.g. "SELECT NOW();"') },
  },
  async ({ sql }: { sql: string }) => {
    const { code, stdout, stderr } = await runQuery(sql)
    if (code !== 0) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `mysql_query.sh exited with code ${code}\n${stderr || stdout || '(no output)'}` }],
      }
    }
    return { content: [{ type: 'text' as const, text: stdout.trim() || '(no rows)' }] }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
