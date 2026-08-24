// The level-two playbook registry.
//
// One entry per `ready` route in ./routes.ts, keyed by route id. This is the
// framework seam for "how is this class handled": adding a class is adding a
// route entry, a skill directory, and one entry here — no wiring code.
//
// The pairing is CHECKED at load rather than trusted: a `ready` route without
// a playbook would leave the model classified into a class nothing elaborates,
// and a playbook without a route would render text no classifier reaches.
// Both fail the plugin load instead of degrading a session quietly.

import type { PluginContext } from '../harness.js'
import { ROUTES } from './routes.js'
import { sqlOptimizePlaybook } from './sql-optimize.js'

/** Renders just after the level-one router, whose classes these elaborate. */
const PLAYBOOK_SECTION_ORDER = 160

/** Route id → the section text for that class. */
const PLAYBOOKS: Readonly<Record<string, () => string>> = {
  'sql-optimize': sqlOptimizePlaybook,
}

/**
 * Register one playbook section per implemented class.
 *
 * A class listed as `planned` contributes nothing on purpose: the classifier
 * tells the model to say it is unimplemented, and a playbook would contradict
 * that.
 * @param ctx - the plugin context, with `systemPrompt` injected.
 * @throws when routes and playbooks disagree about what is implemented.
 */
export function registerRoutePlaybooks(ctx: PluginContext): void {
  const ready = ROUTES.filter(route => route.status === 'ready').map(route => route.id)

  for (const id of ready) {
    if (PLAYBOOKS[id] === undefined) throw new Error(`route "${id}" is ready but has no playbook`)
  }
  for (const id of Object.keys(PLAYBOOKS)) {
    if (!ready.includes(id)) throw new Error(`playbook "${id}" has no ready route`)
  }

  for (const id of ready) {
    ctx.systemPrompt.section({
      name: `dba:route:${id}`,
      order: PLAYBOOK_SECTION_ORDER,
      text: PLAYBOOKS[id](),
    })
    ctx.logger.info(`registered the dba:route:${id} prompt section`)
  }
}
