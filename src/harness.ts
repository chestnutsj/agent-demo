// Structural types for the slice of the DSH plugin context this pack uses.
//
// This package is installed with `dsh plugin add`, so it is NOT part of the
// harness workspace and cannot resolve `@deepseek-ai/dsh-*` at compile time.
// Declaring the consumed surface structurally keeps `npm install` free of
// harness dependencies while still type-checking every call site:
//   ctx.systemPrompt → @deepseek-ai/dsh-system-prompt
//
// ONE service, because one is what the pack writes to. Every entry here is a
// service the loader must WAIT for (it is declared in `inject`), so an unused
// one is not free: it is a startup dependency bought for nothing, and a shape
// that drifts fails the load.

/** The `ctx.systemPrompt.section()` input. */
export interface PromptSection {
  readonly name: string
  /** Ascending concatenation order: -100 identity, 0 persona, 100-199 tool guidance. */
  readonly order: number
  readonly text: string
}

/** The subset of the plugin context this pack consumes. */
export interface PluginContext {
  systemPrompt: { section(section: PromptSection): () => void }
  logger: { info(message: string, ...args: unknown[]): void }
}
