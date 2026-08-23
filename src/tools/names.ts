// The model-facing name of this pack's one database tool.
//
// The BASE name is what a native `defineTool` registration will use (see
// ./README.md); the prefixed form is what the MCP transport produces today.
// The playbook section and the MCP server both need it, and they must not
// drift: a prompt naming a tool that is not registered sends the model at
// nothing.

/** Prefix DSH's in-box MCP client adds to a server's tool names. */
export const MCP_TOOL_PREFIX = 'mcp__dba_mysql__'

/** Base tool names, as the model will see them once the tools are native. */
export const TOOL = {
  /**
   * The SQL-optimization route's only entry point. There is deliberately no
   * general "run this statement" tool: every statement that reaches the
   * server is one this pack generated, plus the one being optimized — and
   * that one only ever runs under EXPLAIN.
   */
  evidence: 'sql_evidence',
} as const

/**
 * Render a base tool name as the model currently sees it.
 * @param base - the base name, from {@link TOOL}.
 * @returns the prefixed, model-facing name.
 */
export function modelFacing(base: string): string {
  return `${MCP_TOOL_PREFIX}${base}`
}
