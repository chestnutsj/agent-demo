// dsh-dba-agent — the DBA expert capability pack.
//
// The harness owns the agent loop, tool calling, context, compaction, model
// adapters and sessions. This package owns only the DBA-specific 20%:
//
//   router      → two prompt levels: "is this database work, and which kind"
//                 (src/router/section.ts), then the playbook for the class
//                 that owns it (src/router/playbooks.ts)
//   skills      → how to do the work, as instructions rather than as code
//   tools       → one evidence tool, mounted by cordis.patch.yml as an MCP
//                 server, collecting through the engine's dialect
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
import { registerSkills } from './skills.js'

export const name = 'dsh-dba-agent'

/**
 * Services this pack registers into; the loader waits for both.
 *
 * Two, and every entry earns it: a declared injection is a startup dependency,
 * so injecting `tools` merely to ask whether a tool is visible — or to hang an
 * audit listener — would make the plugin wait on a registry it never writes to.
 */
export const inject = ['skills', 'systemPrompt'] as const

/**
 * Register this pack's contributions. Every registration is an effect owned by
 * the plugin fiber, so unloading — or an HMR reload — withdraws all of them.
 * @param ctx - the plugin context supplied by the loader.
 */
export function apply(ctx: PluginContext): void {
  registerSkills(ctx)
  registerRouter(ctx)
  registerRoutePlaybooks(ctx)
}
