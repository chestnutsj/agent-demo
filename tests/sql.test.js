// Statement analysis and the evidence walk.
//
// The offline cases point MYSQL_PORT at a closed port, so they assert the
// relay path on any machine — with or without a reachable server, with or
// without a mysql client installed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeRefusal, extractTables, normalizeStatement } from '../lib/core/sql.js'
import { collectSqlEvidence } from '../lib/core/evidence.js'

process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'

test('reads table names out of a statement', () => {
  const sql = "SELECT * FROM orders o JOIN `shop`.`users` u ON u.id = o.user_id WHERE o.note > 'x FROM evil'"
  assert.deepEqual(extractTables(sql).map(t => t.quoted), ['`orders`', '`shop`.`users`'])
})

test('ignores derived tables, comments and string literals', () => {
  const sql = 'select a.* from (select * from t1) a join t2 on a.id = t2.id -- from commented_table'
  assert.deepEqual(extractTables(sql).map(t => t.table), ['t1', 't2'])
})

test('caps the table list', () => {
  const sql = 'SELECT 1 FROM a JOIN b JOIN c JOIN d JOIN e JOIN f'
  assert.equal(extractTables(sql).length, 4)
})

test('drops references it cannot quote safely', () => {
  // A name carrying a quote character would end the quoting it is spliced
  // into, so it never reaches a statement.
  assert.deepEqual(extractTables("SELECT 1 FROM `we'ird`"), [])
})

test('refuses EXPLAIN ANALYZE on anything that is not a SELECT', () => {
  assert.equal(analyzeRefusal('SELECT 1'), undefined)
  assert.equal(analyzeRefusal('WITH x AS (SELECT 1) SELECT * FROM x'), undefined)
  // EXPLAIN ANALYZE EXECUTES what it explains; the read-only policy only sees
  // the EXPLAIN verb, so this gate is what stands between it and the data.
  assert.match(analyzeRefusal('DELETE FROM t'), /只对 SELECT 开放/)
  assert.match(analyzeRefusal('UPDATE t SET a = 1'), /只对 SELECT 开放/)
})

test('normalizes a statement for interpolation', () => {
  assert.equal(normalizeStatement('  SELECT 1 ;  '), 'SELECT 1')
})

test('an unreachable server relays the whole walk once', async () => {
  const report = await collectSqlEvidence('SELECT * FROM orders WHERE user_id = 7')

  assert.equal(report.offline, true)
  assert.match(report.text, /^DBA_OFFLINE: /)
  assert.match(report.text, /--- 请执行 ---[\s\S]*--- 结束 ---/)
  // Version, then the plan, then three statements for the one table.
  assert.match(report.text, /SELECT VERSION\(\)/)
  assert.match(report.text, /EXPLAIN FORMAT=JSON SELECT \* FROM orders/)
  assert.ok(
    report.text.indexOf('SELECT VERSION()') < report.text.indexOf('EXPLAIN FORMAT=JSON'),
    'version comes first: it decides which rewrites exist on this server',
  )
  assert.match(report.text, /SHOW CREATE TABLE `orders`;/)
  assert.match(report.text, /SHOW INDEX FROM `orders`;/)
  assert.match(report.text, /information_schema\.tables/)
  assert.equal(report.text.match(/DBA_OFFLINE/g).length, 1, 'one relay block, not one per step')
})

test('rejects an empty statement and an analyzed DML', async () => {
  await assert.rejects(() => collectSqlEvidence('   ;  '), /需要一条 SQL 语句/)
  await assert.rejects(
    () => collectSqlEvidence('DELETE FROM orders', { analyze: true }),
    /只对 SELECT 开放/,
  )
})
