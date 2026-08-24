// Loading DBA skills from disk and registering them into `ctx.skills`.
//
// Skill bodies are authored as ordinary SKILL.md files under `skills/` at the
// package root so they can be edited without touching TypeScript. Registration
// happens at load time; the returned disposer is owned by the plugin fiber, so
// unloading the plugin withdraws the skill.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PluginContext, SkillRegistration } from './harness.js'
import { ROUTES } from './router/routes.js'

/** A parsed SKILL.md: its `key: value` frontmatter plus the markdown body. */
interface ParsedSkill {
  readonly attrs: Readonly<Record<string, string>>
  readonly body: string
}

/**
 * Split a SKILL.md into frontmatter attributes and body. Deliberately minimal:
 * the frontmatter these skills carry is flat `key: value` lines, and pulling a
 * YAML parser in for that would add a runtime dependency the pack does not
 * otherwise need.
 * @param text - the raw file contents.
 * @returns the parsed attributes and the trimmed body.
 */
function parseFrontmatter(text: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return { attrs: {}, body: text.trim() }

  const attrs: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '')
    if (key.length > 0) attrs[key] = value
  }
  return { attrs, body: match[2].trim() }
}

/**
 * Read one skill directory into a registration.
 *
 * The bodies carry METHODOLOGY and name the tools that execute it; they do not
 * carry commands, because this pack's agent has no shell to run them with.
 * That split is why nothing is templated into a body here — an earlier version
 * injected absolute script paths for the model to run, which is exactly the
 * bypass around the read-only policy that composing no shell tool removes.
 * @param dirName - the directory under `skills/` holding the SKILL.md.
 * @returns the registration to hand to `ctx.skills.register()`.
 */
function loadSkill(dirName: string): SkillRegistration {
  const dir = fileURLToPath(new URL(`../skills/${dirName}/`, import.meta.url))
  const path = `${dir}SKILL.md`
  const { attrs, body } = parseFrontmatter(readFileSync(path, 'utf8'))
  const name = attrs.name ?? dirName
  if (attrs.description === undefined || attrs.description.length === 0) {
    throw new Error(`skill "${name}" has no description in its frontmatter; routing depends on it`)
  }
  return {
    name,
    description: attrs.description,
    ...attrs['when-to-use'] !== undefined ? { whenToUse: attrs['when-to-use'] } : {},
    source: 'custom',
    content: body,
    path,
    resourceBase: { kind: 'directory', path: dir },
  }
}

/**
 * The skill directories this pack ships — DERIVED from the route table, one
 * per `ready` class. Deriving rather than listing removes a drift source: a
 * class cannot be marked ready with its method left unregistered. A `planned`
 * class names no skill on purpose — the router tells the model to say the
 * class is unimplemented, and a skill would contradict that.
 */
export const SKILL_DIRECTORIES: readonly string[] = ROUTES
  .filter(route => route.status === 'ready')
  .map((route) => {
    if (route.skill === undefined) throw new Error(`route "${route.id}" is ready but names no skill`)
    return route.skill
  })

/**
 * Register every shipped skill into the shared catalog.
 * @param ctx - the plugin context, with `skills` injected.
 */
export function registerSkills(ctx: PluginContext): void {
  for (const dirName of SKILL_DIRECTORIES) {
    const skill = loadSkill(dirName)
    ctx.skills.register(skill)
    ctx.logger.info(`registered skill "${skill.name}"`)
  }
}
