// Structural types for the slice of the DSH plugin context this pack uses.
//
// This package is installed with `dsh plugin add`, so it is NOT part of the
// harness workspace and cannot resolve `@deepseek-ai/dsh-*` at compile time.
// Declaring the consumed surface structurally keeps `npm install` free of
// harness dependencies while still type-checking every call site:
//   ctx.skills       → @deepseek-ai/dsh-skill
//   ctx.systemPrompt → @deepseek-ai/dsh-system-prompt
//
// Two services, because two is what the pack uses. Every entry here is a
// service the loader must WAIT for (they are declared in `inject`), so an
// unused one is not free: it is a startup dependency bought for nothing, and
// a shape that drifts fails the load.

/** Origin bucket recorded on a skill contribution (prompt-visible metadata). */
export type SkillSource = 'runtime' | 'custom' | 'bundled' | (string & {})

/** Where a skill body resolves its relative resources from. */
export type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }

/** The `ctx.skills.register()` input. */
export interface SkillRegistration {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: SkillSource
  readonly content: string
  readonly path?: string
  readonly resourceBase?: SkillResourceBase
}

/** The `ctx.systemPrompt.section()` input. */
export interface PromptSection {
  readonly name: string
  /** Ascending concatenation order: -100 identity, 0 persona, 100-199 tool guidance. */
  readonly order: number
  readonly text: string
}

/** The subset of the plugin context this pack consumes. */
export interface PluginContext {
  skills: { register(skill: SkillRegistration): () => void }
  systemPrompt: { section(section: PromptSection): () => void }
  logger: { info(message: string, ...args: unknown[]): void }
}
