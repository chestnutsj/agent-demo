# `src/tools/` — the native tool layer (not yet wired)

Stage one ships the pack's single tool as an **MCP server**
(`src/mcp/server.ts`), because it is the shortest path to a working demo and
the tool stays reusable from other MCP hosts. The intended end state is a
**native `defineTool` registration** on `ctx.tools`, and this directory is
where it will live. `src/tools/names.ts` already holds the base name both
transports use.

`src/core/mysql.ts` exists so that migration is a shell swap rather than a
rewrite: it holds the statement policy and the execution path, and knows
nothing about either transport.

## What the native layer buys

| | MCP | native `defineTool` |
|---|---|---|
| Argument validation | zod, inside the server | derived from `parameters`, at the registry boundary |
| Model-facing rendering | one text block | `output.render` over a canonical value |
| Policy | inside the tool body | `tools/pre-execute` gate + monotonic `ctx.tools.guard()` |
| Tool names | `mcp__dba_mysql__sql_evidence` | `sql_evidence` |
| Process boundary | a child process per server | in-process |

Going native also drops the child process and the `tools` injection this pack
currently does not need: today the plugin registers prompt text naming a tool
the MCP row mounts beside it, and the two are kept in step by shipping in one
bundle layer rather than by a runtime lookup.

## The shape to write

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'
import { collectSqlEvidence } from '../core/mysql.js'
import { TOOL } from './names.js'

export const sqlEvidence = defineTool({
  name: TOOL.evidence,
  description: 'Collect the plan and table facts one SQL statement needs.',
  parameters: {
    sql: { type: 'string', required: true, description: 'The statement to optimize.' },
    analyze: { type: 'boolean', description: 'Use EXPLAIN ANALYZE (executes it; SELECT only).' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  // The policy and the walk stay in src/core/mysql.ts; only the shell changes.
  async execute(args) {
    return (await collectSqlEvidence(args.sql, { analyze: args.analyze })).text
  },
})
```

Doing this requires the package to resolve `@deepseek-ai/dsh-tools` at compile
time, which it currently avoids on purpose (see `src/harness.ts`). Either add
it as a real dependency once the harness packages are published, or extend the
structural declarations the same way `src/harness.ts` already does for
`skills` and `systemPrompt` — and add `tools` to `inject` at the same time,
since that is the point at which the plugin actually writes to that registry.

Reference: `deepseek-harness/docs/cookbook/adding-a-tool.zh.md`.
