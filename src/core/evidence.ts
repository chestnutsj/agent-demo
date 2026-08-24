// The evidence walk: policy, execution, and the order the questions are asked.
//
// Engine-NEUTRAL on purpose. What to ask a server is the dialect's business
// (`./dialects/mysql.ts`, selected through `./engine.ts`); this module owns
// the parts that do not change with the engine — the read-only policy, the
// one-probe-then-relay behaviour, and the rendering.
//
// Only `collectSqlEvidence` leaves the module, so every path to a database is
// composed here and a second transport cannot arrive with a weaker policy.
// The database access itself lives in `scripts/*.sh`, which shell out to a
// client: one place for connection handling, credential hygiene, and the
// OFFLINE relay. Nothing connects at startup — a call spawns a script.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dialectFor } from './engine.js'
import type { EvidenceStep } from './engine.js'
import { MAX_EVIDENCE_TABLES, analyzeRefusal, extractTables, normalizeStatement } from './sql.js'

/** Resolve a script that ships at the package root under `scripts/`. */
function scriptPath(name: string): string {
  // Built to lib/core/evidence.js, so the package root is two levels up.
  return fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url))
}

/**
 * Exit code the scripts use for OFFLINE: the server could not be reached, and
 * stdout carries a relay block naming the statements for a human to run
 * elsewhere. This is a degraded MODE, not a failure — a caller that renders it
 * as an error teaches the model to retry or to guess, and both are worse than
 * asking the operator for the output.
 */
const OFFLINE_EXIT_CODE = 3

/** The captured outcome of one script invocation. */
interface QueryResult {
  /** Process exit code; `-1` when the process could not be spawned at all. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Statements a read-only session may run without an explicit write opt-in. */
const READ_ONLY_VERBS = /^\s*(select|show|explain|desc|describe|analyze|with)\b/i

/**
 * Statements that are read-only in effect but whose verb is not in the list
 * above, because they only touch session state.
 */
const READ_ONLY_STATEMENTS = /^\s*(set\s+(session|@)|use\s)/i

/**
 * Whether writes are permitted for this process. Off by default: a DBA agent
 * pointed at production must not be one hallucinated `DELETE` away from an
 * incident, and the opt-in belongs to whoever launches the harness rather
 * than to the model.
 */
function writesAllowed(): boolean {
  return process.env.DBA_ALLOW_WRITE === '1'
}

/**
 * Check one statement against the read-only policy.
 * @param sql - the statement the caller wants to run.
 * @returns `undefined` when the statement may run, or the refusal reason.
 */
function policyRefusal(sql: string): string | undefined {
  if (writesAllowed()) return undefined
  if (READ_ONLY_VERBS.test(sql) || READ_ONLY_STATEMENTS.test(sql)) return undefined
  return '本会话为只读，仅允许 SELECT / SHOW / EXPLAIN / DESCRIBE / ANALYZE 语句。'
    + '确实需要执行写入语句时，请运维用 DBA_ALLOW_WRITE=1 重启 harness。'
}

/**
 * Run one SQL statement through the engine's script. Never rejects: a spawn
 * failure comes back as `code: -1` with the reason in `stderr`, so every
 * caller has one shape to render.
 * @param script - the script name under `scripts/`, from the dialect.
 * @param sql - the statement to execute.
 * @returns the captured exit code and streams.
 */
function runQuery(script: string, sql: string): Promise<QueryResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath(script), sql], { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error: Error) => resolve({ code: -1, stdout: '', stderr: String(error) }))
    child.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

// ── the SQL-optimization evidence walk ──────────────────────────────────────
//
// One call walks the questions a DBA walks, in order, and an unreachable
// server relays the WHOLE list once instead of failing per step. It lives here
// rather than in a script because choosing the follow-up statements means
// reading table names out of the statement, which bash does badly (`./sql.ts`).

/** Options for one evidence walk. */
export interface EvidenceOptions {
  /** Use `EXPLAIN ANALYZE`, which EXECUTES the statement, instead of a plan estimate. */
  readonly analyze?: boolean
  /** Most tables to collect schema, indexes and size for. */
  readonly maxTables?: number
  /** Engine to collect for; defaults to the one the deployment configured. */
  readonly engine?: string
}

/** The outcome of an evidence walk, rendered for the model. */
export interface EvidenceReport {
  /** The assembled report, or the relay block when the server is unreachable. */
  readonly text: string
  /** True when nothing ran because the server could not be reached. */
  readonly offline: boolean
}

/**
 * Build the statement list one SQL-optimization walk runs.
 *
 * The order is the engine-neutral part, and it is the part that matters:
 * version first (it decides which recommendations exist at all), then the
 * plan (it decides the answer), then the tables (they make the plan readable —
 * a full scan is only a finding once size and indexes say what the optimizer
 * had to choose from). Which statements express those questions is the
 * dialect's business.
 * @param sql - the statement being optimized.
 * @param options - analyze mode, the table cap, and the engine.
 * @returns the ordered steps, each safe to hand to `runQuery`.
 */
function sqlEvidencePlan(sql: string, options: EvidenceOptions = {}): EvidenceStep[] {
  const dialect = dialectFor(options.engine)
  const statement = normalizeStatement(sql)
  const steps: EvidenceStep[] = [
    dialect.version(),
    dialect.explain(statement, options.analyze === true),
  ]
  for (const table of extractTables(statement, options.maxTables ?? MAX_EVIDENCE_TABLES)) {
    steps.push(...dialect.tableSteps(table))
  }
  return steps
}

/**
 * Render the relay block for an unreachable server, in the same shape the
 * scripts print so the skills' relay instructions apply to it unchanged.
 * @param reason - the connection failure as the client reported it.
 * @param steps - every statement the walk would have run.
 * @returns the relay block to hand back as a successful result.
 */
function relayBlock(reason: string, steps: readonly EvidenceStep[]): string {
  const body = steps.map(step => `-- ${step.title}\n${step.sql}`).join('\n\n')
  return `DBA_OFFLINE: ${reason}\n\n`
    + '这台机器连不到数据库。请在能连到数据库的机器上执行下面的语句，并把输出贴回来。\n'
    + '不要重试，也不要凭 SQL 文本硬答——分析将从你贴回的结果继续。\n\n'
    + `--- 请执行 ---\n${body}\n--- 结束 ---`
}

/**
 * Collect the evidence one SQL-optimization answer must rest on: the server's
 * plan, plus the structure, indexes and size of every table the statement
 * touches.
 *
 * A step the server refuses (missing table, no privilege) is reported in place
 * and the walk continues — a partial pack still supports part of an answer.
 * Unreachable is different in kind: nothing is retried, and the caller gets the
 * whole statement list to run elsewhere.
 * @param sql - the statement to optimize.
 * @param options - analyze mode and the table cap.
 * @returns the rendered report and whether the server was reachable.
 */
export async function collectSqlEvidence(sql: string, options: EvidenceOptions = {}): Promise<EvidenceReport> {
  const statement = normalizeStatement(sql)
  if (statement.length === 0) throw new Error('需要一条 SQL 语句。')
  if (options.analyze === true) {
    const refusal = analyzeRefusal(statement)
    if (refusal !== undefined) throw new Error(refusal)
  }

  const dialect = dialectFor(options.engine)
  const steps = sqlEvidencePlan(statement, options)
  const sections: string[] = []
  for (const [index, step] of steps.entries()) {
    const refusal = policyRefusal(step.sql)
    if (refusal !== undefined) throw new Error(refusal)
    const { code, stdout, stderr } = await runQuery(dialect.script, step.sql)
    if (code === OFFLINE_EXIT_CODE) {
      const reason = /^DBA_OFFLINE:\s*(.*)$/m.exec(stdout)?.[1] ?? '连不到数据库'
      return { text: relayBlock(reason, steps), offline: true }
    }
    const body = code === 0
      ? stdout.trim() || '(无结果)'
      : `(不可用: ${(stderr || stdout).trim() || `退出码 ${code}`})`
    sections.push(`## ${index + 1}. ${step.title}\n${body}`)
  }
  return { text: sections.join('\n\n'), offline: false }
}
