// The DBA MySQL MCP stdio server — the ONLY path from the model to a database.
//
// It exposes ONE tool. The preset composes no shell and no general
// "run this SQL" tool, so the only statements that ever reach the server are
// the ones this pack generates (`SHOW CREATE TABLE`, `SHOW INDEX`, one
// `information_schema` row) plus the statement being optimized — and that one
// only ever runs behind `EXPLAIN`. "Read-only by default" is then a property
// of the surface rather than a promise about behaviour.
//
// The handler is a thin shell over `src/core/mysql.ts`, so moving to a native
// `defineTool` registration later swaps the transport, not the logic
// (src/tools/README.md).
//
// DSH's in-box MCP client surfaces the tool as `mcp__dba_sql__sql_evidence`;
// that name lives in src/tools/names.ts, shared with the prompt section that
// tells the model to call it. The name carries no engine — which dialect the
// walk uses is `DBA_ENGINE`, resolved in src/core/engine.ts.
//
// Built to lib/mcp/server.js.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { collectSqlEvidence } from '../core/evidence.js'
import { TOOL } from '../tools/names.js'

/** An MCP tool result carrying one text block. */
type TextResult = { isError?: boolean; content: { type: 'text'; text: string }[] }

/** Wrap text as a successful MCP result. */
function ok(text: string): TextResult {
  return { content: [{ type: 'text', text }] }
}

/** Wrap text as a failed MCP result. */
function fail(text: string): TextResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

const server = new McpServer({ name: 'dba-mysql', version: '0.1.0' })

server.tool(
  TOOL.evidence,
  'SQL 优化取证：一次拿到执行计划，以及语句涉及的每张表的建表语句、索引与规模。'
  + '在给出任何索引或改写建议之前调用它——绝不要凭 SQL 文本推断计划。',
  {
    sql: z.string().describe('要优化的语句，不要带前面的 EXPLAIN。'),
    analyze: z.boolean().optional().describe('用 EXPLAIN ANALYZE 取真实耗时。它会真正执行这条语句，仅对 SELECT 开放。'),
  },
  async ({ sql, analyze }: { sql: string; analyze?: boolean }) => {
    try {
      const report = await collectSqlEvidence(sql, { ...analyze === undefined ? {} : { analyze } })
      // OFFLINE is a successful result carrying a relay block: the caller is
      // being handed work to do, not an error to recover from. Rendering it as
      // an error would teach the model to retry or to guess, and both are
      // worse than asking the operator to run the statements elsewhere.
      return ok(report.text)
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
