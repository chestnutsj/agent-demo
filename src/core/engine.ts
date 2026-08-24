// The database-engine seam.
//
// SQL optimization is engine-shaped work: the plan format, the statements that
// describe a table, and the version facts that decide which rewrites are even
// available all differ per engine. This module is where that dimension lives,
// so adding PostgreSQL later is a dialect object plus a connection script —
// not a second copy of the walk.
//
// This version implements MySQL and nothing else. The other engines are listed
// anyway, for the same reason `planned` routes appear in the router: the model
// must be able to recognize "this is Oracle" and SAY the pack does not do it,
// rather than answering from general SQL folklore.

import type { TableReference } from './sql.js'
import { MYSQL_DIALECT } from './dialects/mysql.js'

/** One titled statement in an evidence walk. */
export interface EvidenceStep {
  readonly title: string
  readonly sql: string
}

/** Whether an engine has a dialect behind it in this version. */
export type EngineStatus = 'ready' | 'planned'

/** One database engine this pack knows about. */
export interface Engine {
  /** Stable id, and the value `DBA_ENGINE` takes. */
  readonly id: string
  readonly title: string
  readonly status: EngineStatus
}

/**
 * Everything engine-specific about collecting evidence for one statement.
 * One implementation today; the registry below is the extension point.
 */
export interface EvidenceDialect {
  readonly engine: string
  /** Script under `scripts/` that runs one statement against this engine. */
  readonly script: string
  /** Server and version facts, collected first — rewrites depend on them. */
  version(): EvidenceStep
  /** The plan for one statement, estimated or actually executed. */
  explain(statement: string, analyze: boolean): EvidenceStep
  /** Structure, indexes and size for one table the statement touches. */
  tableSteps(table: TableReference): EvidenceStep[]
}

/** The engines this pack knows, implemented or not. */
export const ENGINES: readonly Engine[] = [
  { id: 'mysql', title: 'MySQL', status: 'ready' },
  { id: 'postgresql', title: 'PostgreSQL', status: 'planned' },
  { id: 'oracle', title: 'Oracle', status: 'planned' },
  { id: 'oceanbase', title: 'OceanBase', status: 'planned' },
]

/** Dialects that exist. Keyed by engine id; adding one is adding an entry. */
const DIALECTS: Readonly<Record<string, EvidenceDialect>> = {
  [MYSQL_DIALECT.engine]: MYSQL_DIALECT,
}

/** The engine assumed when the deployment does not say otherwise. */
export const DEFAULT_ENGINE = 'mysql'

/** Engines with a dialect, for prompt text and error messages. */
export const READY_ENGINES: readonly Engine[] = ENGINES.filter(engine => engine.status === 'ready')

/**
 * The engine this process is pointed at. It is a DEPLOYMENT fact, not a model
 * choice: whoever starts the harness configured one connection, so letting the
 * model pass an engine per call would only invite it to describe a server that
 * is not the one on the other end of the socket.
 * @returns the value of `DBA_ENGINE`, or the default.
 */
export function selectedEngine(): string {
  const configured = process.env.DBA_ENGINE?.trim().toLowerCase()
  return configured === undefined || configured.length === 0 ? DEFAULT_ENGINE : configured
}

/**
 * Resolve the dialect for one engine.
 * @param engine - the engine id, defaulting to the configured one.
 * @returns the dialect to collect evidence with.
 * @throws when the engine has no dialect in this version, naming what is
 * implemented instead of failing obscurely.
 */
export function dialectFor(engine: string = selectedEngine()): EvidenceDialect {
  const dialect = DIALECTS[engine]
  if (dialect !== undefined) return dialect

  const known = ENGINES.find(candidate => candidate.id === engine)
  const ready = READY_ENGINES.map(candidate => candidate.title).join(' / ')
  throw new Error(
    known === undefined
      ? `DBA_ENGINE="${engine}" 不是已知的数据库类型。本版本只实现了 ${ready}。`
      : `${known.title} 的取证在本版本尚未实现——只实现了 ${ready}。`
      + '请如实告诉用户这一点，不要用通用 SQL 经验代替这个引擎的执行计划。',
  )
}
