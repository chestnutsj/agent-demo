// The registration surface: what apply() asks for, and what it contributes.
//
// This is the assertion that keeps the pack minimal. `inject` names services
// the loader must WAIT for, so an entry added without a matching registration
// is a startup dependency bought for nothing — the test fails on it rather
// than leaving it to review.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply, inject, name } from '../lib/index.js'
import { ROUTES } from '../lib/router/routes.js'

/**
 * Run the plugin against a recording context.
 * @returns the sections it registered.
 */
function register() {
  const sections = []
  apply({
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    logger: { info: () => {} },
  })
  return sections
}

test('injects only the service it writes to', () => {
  // Skills come from the built-in filesystem provider mounted in
  // cordis.patch.yml, so this code writes to exactly one registry.
  assert.deepEqual([...inject], ['systemPrompt'])
  assert.equal(name, 'dsh-dba-agent')
})

test('registers two ordered prompt sections and nothing else', () => {
  const sections = register()
  assert.deepEqual(sections.map(s => s.name), ['dba:router', 'dba:route:sql-optimize'])
  assert.deepEqual(sections.map(s => s.order), [150, 160])
})

test('section text is static, not a per-assembly provider', () => {
  for (const section of register()) {
    assert.equal(typeof section.text, 'string')
    assert.ok(section.text.length > 0)
  }
})

test('the router classifies first and names every class', () => {
  const [router, playbook] = register()

  assert.match(router.text, /第一步：这是数据库工作吗/)
  assert.match(router.text, /第二步：归入哪一类/)
  for (const route of ROUTES) {
    assert.ok(router.text.includes(route.title), `router omits the class ${route.title}`)
  }
  // Exactly one class is implemented; the rest must be advertised as absent so
  // the model says so instead of answering from general MySQL folklore.
  const planned = ROUTES.filter(route => route.status === 'planned')
  assert.equal(router.text.match(/\*\*本版本未实现\*\*/g).length, planned.length)

  assert.match(playbook.text, /mcp__dba_sql__sql_evidence/)
})

test('the prompt names no tool the pack does not ship', () => {
  const named = new Set()
  for (const section of register()) {
    for (const match of section.text.matchAll(/mcp__dba_sql__(\w+)/g)) named.add(match[1])
  }
  assert.deepEqual([...named], ['sql_evidence'])
})

test('every implemented class has a playbook and a skill on disk', () => {
  const ready = ROUTES.filter(route => route.status === 'ready')
  const playbooks = register()
    .filter(section => section.name.startsWith('dba:route:'))
    .map(section => section.name.slice('dba:route:'.length))
  assert.deepEqual(playbooks, ready.map(route => route.id))

  // Skill loading moved to `dsh-skill-filesystem`, which WARNS AND SKIPS a
  // directory it cannot parse. So the pairing that used to fail the plugin
  // load is checked here instead: a ready class whose method is missing or
  // misnamed would otherwise reach a session as a route pointing at nothing.
  for (const route of ready) {
    assert.ok(route.skill !== undefined, `route "${route.id}" is ready but names no skill`)
    const path = fileURLToPath(new URL(`../skills/${route.skill}/SKILL.md`, import.meta.url))
    assert.ok(existsSync(path), `skills/${route.skill}/SKILL.md is missing`)

    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
    assert.match(frontmatter, new RegExp(`^name:\\s*${route.skill}\\s*$`, 'm'), 'skill name must match the route')
    assert.match(frontmatter, /^description:\s*\S/m, 'the provider drops a skill with no description')
  }
})

test('the router names the engine dimension, not just the question classes', () => {
  const [router] = register()
  assert.match(router.text, /数据库类型/)
  assert.match(router.text, /MySQL/)
  assert.match(router.text, /PostgreSQL/)
})
