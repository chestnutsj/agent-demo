// dsh-dba-agent — the DBA expert capability pack.
//
// The harness owns the agent loop, tool calling, context, compaction, model
// adapters and sessions. This package owns only the DBA-specific 20%:
//
//   router      → two prompt levels: "is this database work, and which kind"
//                 (src/router/section.ts), then the playbook for the class
//                 that owns it (src/router/playbooks.ts)
//   tools       → one evidence tool, mounted by cordis.patch.yml as an MCP
//                 server, collecting through the engine's dialect
//
// The METHOD is a SKILL.md under `skills/`, but no code here loads it:
// cordis.patch.yml mounts `@deepseek-ai/dsh-skill-filesystem` against this
// package's `skills/` directory. That built-in already parses frontmatter,
// registers the provider and watches the files — an in-package loader would
// be a worse copy that also needs a rebuild to pick up an edit.
//
// Three tables carry the extension points, and each one is DATA:
//   src/router/routes.ts    the classes (SQL 优化 / 参数调整 / …)
//   src/router/playbooks.ts route id → its level-two section
//   src/core/engine.ts      the database engines and their dialects
//
// This version implements ONE class (SQL optimization) on ONE engine (MySQL).
// Everything else is listed as `planned` so the model says so instead of
// improvising an answer the pack cannot support with evidence.
//
// Built to lib/index.js.

import type { PluginContext } from './harness.js'
import { registerRouter } from './router/section.js'
import { registerRoutePlaybooks } from './router/playbooks.js'

export const name = 'dsh-dba-agent'

/**
 * The one service this pack registers into.
 *
 * A declared injection is a startup dependency the loader must wait for, so
 * the list is exactly what this code writes to. `skills` left it when skill
 * loading moved to the built-in filesystem provider; `tools` never belonged —
 * asking whether a tool is visible, or hanging an audit listener, is not
 * writing to that registry.
 */
export const inject = ['systemPrompt'] as const

/**
 * Register this pack's contributions. Every registration is an effect owned by
 * the plugin fiber, so unloading — or an HMR reload — withdraws all of them.
 * @param ctx - the plugin context supplied by the loader.
 */
export function apply(ctx: PluginContext): void {
  registerRouter(ctx)
  registerRoutePlaybooks(ctx)
}
