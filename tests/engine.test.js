// The database-engine seam.
//
// This version ships one dialect. The tests assert the SEAM, not MySQL: that
// an engine resolves, that an unimplemented one fails with a message naming
// what is implemented, and that the walk's ORDER is the engine-neutral part.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ENGINE, ENGINES, READY_ENGINES, dialectFor, selectedEngine } from '../lib/core/engine.js'
import { collectSqlEvidence } from '../lib/core/evidence.js'

test('exactly one engine is implemented, and the rest are advertised as absent', () => {
  assert.deepEqual(READY_ENGINES.map(e => e.id), ['mysql'])
  assert.ok(ENGINES.length > READY_ENGINES.length, 'planned engines must stay visible to the router')
  assert.equal(DEFAULT_ENGINE, 'mysql')
})

test('the engine is a deployment fact, read from the environment', () => {
  const previous = process.env.DBA_ENGINE
  try {
    delete process.env.DBA_ENGINE
    assert.equal(selectedEngine(), 'mysql')
    process.env.DBA_ENGINE = 'PostgreSQL'
    assert.equal(selectedEngine(), 'postgresql', 'case and spacing are normalized')
  } finally {
    if (previous === undefined) delete process.env.DBA_ENGINE
    else process.env.DBA_ENGINE = previous
  }
})

test('a known but unimplemented engine fails loudly, naming what is implemented', () => {
  assert.throws(() => dialectFor('postgresql'), /PostgreSQL 的取证在本版本尚未实现[\s\S]*MySQL/)
})

test('an unknown engine is refused as unknown, not silently defaulted', () => {
  assert.throws(() => dialectFor('redis'), /不是已知的数据库类型/)
})

test('the dialect supplies every statement the walk asks for', () => {
  const dialect = dialectFor('mysql')
  const table = { table: 'orders', quoted: '`orders`' }

  assert.match(dialect.version().sql, /^SELECT VERSION\(\)/)
  assert.match(dialect.explain('SELECT 1', false).sql, /^EXPLAIN FORMAT=JSON /)
  assert.match(dialect.explain('SELECT 1', true).sql, /^EXPLAIN ANALYZE /)
  assert.equal(dialect.tableSteps(table).length, 3)
  assert.ok(dialect.script.endsWith('.sh'))
})

test('the walk refuses to run against an engine it has no dialect for', async () => {
  await assert.rejects(
    () => collectSqlEvidence('SELECT 1', { engine: 'oracle' }),
    /尚未实现/,
  )
})
