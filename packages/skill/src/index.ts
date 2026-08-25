// dsh-dba-skill — Method 1 of 3: a SKILL, loaded by dsh's own filesystem
// provider.
//
// The skill body lives as a plain SKILL.md under skills/mysql-query/ and is
// discovered by `@deepseek-ai/dsh-skill-filesystem` (pointed at this bundle's
// skills/ dir via the patch's customSkillDirs). dsh parses and validates it —
// so this plugin does NOT call ctx.skills.register() at all.
//
// This plugin's ONLY job is environment injection for the shell the model runs:
//   - MYSQL_* connection settings from the cordis `config:` block, and
//   - QUERY_SH: the absolute path of the bundled mysql_query.sh, which the
//     static SKILL.md references as "$QUERY_SH" (the model's shell has no idea
//     where the installed bundle lives; we do, via import.meta.url).
// Both are written into this process's env; the model's Bash tool inherits them.
//
// Built to lib/index.js; the build syncs the shared script to
// scripts/mysql_query.sh, so from lib/index.js it resolves as
// ../scripts/mysql_query.sh.

import { fileURLToPath } from 'node:url'

export const name = 'dsh-dba-skill'

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

/** The subset of the DSH plugin context this plugin actually uses. */
interface PluginContext {
  logger?: { info?(message: string): void }
}

export function apply(_ctx: PluginContext, config: DbaConfig = {}): void {
  // Bridge connection settings into this process's env; the model's Bash tool
  // inherits them as a child. Only set fields the config actually provides, so
  // unset ones fall back to any ambient MYSQL_* the operator exported.
  Object.assign(process.env, toMysqlEnv(config))

  // Expose the bundled script's absolute path as $QUERY_SH for the static
  // SKILL.md to call. Resolved from our own location so it works both from the
  // repo (temp launch) and the installed bundle (dsh plugin add).
  const scriptPath = fileURLToPath(new URL('../scripts/mysql_query.sh', import.meta.url))
  process.env.QUERY_SH = scriptPath

  _ctx.logger?.info?.(`[dsh-dba-skill] injected env; QUERY_SH=${scriptPath}`)
}
