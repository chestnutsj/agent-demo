// dsh-dba-agent — the DBA expert capability pack.
//
// The harness owns the agent loop, tool calling, context, compaction, model
// adapters and sessions. This package owns only the DBA-specific 20%:
//
//   router      → two prompt levels: "is this database work, and which kind"
//                 (src/router/section.ts), then the playbook for the class
//                 that owns it (src/router/sql-optimize.ts)
//   skills      → how to do the work, as instructions rather than as code
//   tools       → one MySQL tool, mounted by cordis.patch.yml as an MCP server
//
// This version implements ONE route, SQL optimization. Everything the pack
// registers serves it; the other classes are listed in the route table as
// unimplemented so the model says so instead of improvising.
//
// Built to lib/index.js.

import type { PluginContext } from './harness.js'
import { registerRouter } from './router/section.js'
import { registerRoutePlaybooks } from './router/sql-optimize.js'
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
