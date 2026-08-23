// Statement inspection for the SQL-optimization route.
//
// Everything here is TEXT analysis, deliberately: it decides which follow-up
// statements to run (schema, indexes, size for the tables a query touches),
// never what a plan looks like. The plan always comes from the server — the
// whole point of this route is that a recommendation made from SQL text alone
// is a guess, and a guess handed to a DBA is worse than no answer.

/** Longest table list the evidence walk will collect, to bound its output. */
export const MAX_EVIDENCE_TABLES = 4

/** Table references: the object after FROM / JOIN / UPDATE / INTO. */
const TABLE_REFERENCE = /\b(?:from|join|update|into)\s+((?:`[^`]+`|[A-Za-z_$][\w$]*)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z_$][\w$]*))?)/gi

/** Comment forms stripped before scanning, so commented-out SQL is not read. */
const COMMENTS = /\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*/g

/** Single- and double-quoted literals, blanked so their contents never parse. */
const STRING_LITERALS = /'(?:\\.|''|[^'])*'|"(?:\\.|""|[^"])*"/g

/** Words that follow FROM/JOIN/INTO without naming a table. */
const NOT_A_TABLE = new Set(['dual', 'select', 'lateral', 'unnest', 'json_table', 'values'])

/** Unquoted identifier shape; anything else is not interpolated. */
const PLAIN_IDENTIFIER = /^[\w$]+$/

/**
 * Backtick-quoted identifier contents that can be re-quoted safely. MySQL
 * permits spaces and punctuation there, so the test is not "looks like a
 * name" but "cannot end the quoting": no backtick, no quote, no backslash.
 */
const QUOTABLE_IDENTIFIER = /^[^`'"\\]+$/

/** Statements `EXPLAIN ANALYZE` may run: it EXECUTES the statement it explains. */
const ANALYZABLE = /^\s*(?:select|with|\()/i

/** One table named by a statement, split into its optional schema qualifier. */
export interface TableReference {
  /** Schema part when the reference was qualified, else `undefined`. */
  readonly schema?: string
  readonly table: string
  /** Backtick-quoted form safe to interpolate into a statement. */
  readonly quoted: string
}

/**
 * Strip a statement down to its executable text: no comments, no trailing
 * semicolon, no surrounding whitespace.
 * @param sql - the statement as the caller supplied it.
 * @returns the normalized statement.
 */
export function normalizeStatement(sql: string): string {
  return sql.trim().replace(/;\s*$/, '').trim()
}

/**
 * Blank out the parts of a statement that must not be scanned for identifiers.
 * String contents are replaced rather than deleted so offsets stay usable.
 * @param sql - the statement to mask.
 * @returns the statement with comments and literal contents removed.
 */
function mask(sql: string): string {
  return sql.replace(COMMENTS, ' ').replace(STRING_LITERALS, "''")
}

/**
 * Unquote one identifier part and reject anything that is not a plain name.
 * A reference this cannot validate is dropped rather than interpolated: these
 * names are read out of model-supplied text and go straight into `SHOW CREATE
 * TABLE`, so "looks like an identifier" is the entry condition, not a hint.
 * @param part - one dot-separated part of a table reference.
 * @returns the bare name, or `undefined` when it is not a plain identifier.
 */
function bareName(part: string): string | undefined {
  const trimmed = part.trim()
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length > 2) {
    const inner = trimmed.slice(1, -1)
    return QUOTABLE_IDENTIFIER.test(inner) ? inner : undefined
  }
  return PLAIN_IDENTIFIER.test(trimmed) ? trimmed : undefined
}

/**
 * List the tables a statement reads or writes, in first-appearance order.
 *
 * Regex-level, and it does not need to be more: a missed table costs one
 * `SHOW CREATE TABLE` in the evidence pack, while the plan — the part that
 * decides the answer — is always the server's. Derived tables and subqueries
 * open with `(` and therefore never match, which is the desired outcome.
 * @param sql - the statement to scan.
 * @param limit - most tables to return.
 * @returns the distinct table references, capped at `limit`.
 */
export function extractTables(sql: string, limit: number = MAX_EVIDENCE_TABLES): TableReference[] {
  const seen = new Map<string, TableReference>()
  for (const match of mask(sql).matchAll(TABLE_REFERENCE)) {
    const parts = match[1].split('.').map(bareName)
    if (parts.some(part => part === undefined)) continue
    const names = parts as string[]
    const table = names[names.length - 1]
    const schema = names.length > 1 ? names[0] : undefined
    if (NOT_A_TABLE.has(table.toLowerCase())) continue
    const key = `${schema ?? ''}.${table}`
    if (seen.has(key)) continue
    seen.set(key, {
      ...schema !== undefined ? { schema } : {},
      table,
      quoted: names.map(name => `\`${name}\``).join('.'),
    })
    if (seen.size >= limit) break
  }
  return [...seen.values()]
}

/**
 * Check a statement against what `EXPLAIN ANALYZE` may be pointed at.
 *
 * `EXPLAIN ANALYZE` RUNS the statement to collect actual timings. On a SELECT
 * that costs time; on a DML statement it costs data. The read-only policy in
 * `./mysql.js` sees only the `EXPLAIN` verb and would let
 * `EXPLAIN ANALYZE DELETE …` through, so the refusal belongs here.
 * @param sql - the statement the caller wants timed.
 * @returns `undefined` when it may be analyzed, or the refusal reason.
 */
export function analyzeRefusal(sql: string): string | undefined {
  if (ANALYZABLE.test(sql)) return undefined
  return 'EXPLAIN ANALYZE 会真正执行被分析的语句，因此只对 SELECT 开放。'
    + '要看这条语句的计划，请去掉 analyze，用 EXPLAIN FORMAT=JSON。'
}
