// The registration surface: what apply() asks for, and what it contributes.
//
// This is the assertion that keeps the pack minimal. `inject` names services
// the loader must WAIT for, so an entry added without a matching registration
// is a startup dependency bought for nothing — the test fails on it rather
// than leaving it to review.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../lib/index.js'

/**
 * Run the plugin against a recording context.
 * @returns the skills and sections it registered.
 */
function register() {
  const skills = []
  const sections = []
  apply({
    skills: { register: (skill) => { skills.push(skill); return () => {} } },
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    logger: { info: () => {} },
  })
  return { skills, sections }
}

test('injects only the services it writes to', () => {
  assert.deepEqual([...inject], ['skills', 'systemPrompt'])
  assert.equal(name, 'dsh-dba-agent')
})

test('registers one skill and two ordered prompt sections', () => {
  const { skills, sections } = register()

  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'sql-optimize')
  assert.ok(skills[0].description.length > 0, 'routing depends on the description')

  assert.deepEqual(sections.map(s => s.name), ['dba:router', 'dba:route:sql-optimize'])
  assert.deepEqual(sections.map(s => s.order), [150, 160])
})

test('section text is static, not a per-assembly provider', () => {
  for (const section of register().sections) {
    assert.equal(typeof section.text, 'string')
    assert.ok(section.text.length > 0)
  }
})

test('the router classifies first and names every class', () => {
  const [router, playbook] = register().sections

  assert.match(router.text, /第一步：这是数据库工作吗/)
  assert.match(router.text, /第二步：归入哪一类/)
  for (const title of ['SQL 优化', '运行时诊断', '参数调整', '结构变更']) {
    assert.ok(router.text.includes(title), `router omits the class ${title}`)
  }
  // Exactly one class is implemented; the rest must be advertised as absent so
  // the model says so instead of answering from general MySQL folklore.
  assert.equal(router.text.match(/\*\*本版本未实现\*\*/g).length, 3)

  assert.match(playbook.text, /mcp__dba_sql__sql_evidence/)
  assert.match(playbook.text, /先取证|取证。/)
})

test('the prompt names no tool the pack does not ship', () => {
  const named = new Set()
  for (const section of register().sections) {
    for (const match of section.text.matchAll(/mcp__dba_sql__(\w+)/g)) named.add(match[1])
  }
  assert.deepEqual([...named], ['sql_evidence'])
})

test('every implemented class has both a skill and a playbook', () => {
  // The registry checks this at load; asserting it here names the failure.
  const { skills, sections } = register()
  const playbooks = sections
    .filter(section => section.name.startsWith('dba:route:'))
    .map(section => section.name.slice('dba:route:'.length))

  assert.deepEqual(playbooks, ['sql-optimize'])
  assert.deepEqual(skills.map(skill => skill.name), playbooks)
})

test('the router names the engine dimension, not just the question classes', () => {
  const [router] = register().sections
  assert.match(router.text, /数据库类型/)
  assert.match(router.text, /MySQL/)
  assert.match(router.text, /PostgreSQL/)
})
