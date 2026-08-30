import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveSettings } from '../src/config.ts'
import { placeholders, readSkill, renderSkill, skillBody } from '../src/skill.ts'

const SKILL_PATH = fileURLToPath(new URL('../skills/sql-optimize/SKILL.md', import.meta.url))
const TOOLS = resolveSettings().tools

test('skillBody 剥掉 frontmatter', () => {
  assert.equal(skillBody('---\nname: x\n---\n正文\n'), '正文')
  assert.equal(skillBody('没有 frontmatter'), '没有 frontmatter')
})

test('placeholders 去重并保持出现顺序', () => {
  assert.deepEqual(placeholders('{{tool:plan}} a {{tool:knowledge}} b {{tool:plan}}'), ['plan', 'knowledge'])
})

test('renderSkill 把占位符换成加了反引号的工具名', () => {
  assert.equal(renderSkill('用 {{tool:plan}} 取计划', TOOLS), `用 \`${TOOLS.plan}\` 取计划`)
})

test('renderSkill 遇到认不出的占位符直接抛', () => {
  assert.throws(() => renderSkill('{{tool:nosuch}}', TOOLS), /nosuch/)
})

test('readSkill 读不到文件时返回空串', () => {
  assert.equal(readSkill('/nonexistent/SKILL.md'), '')
})

// 防漂移：这是「提示词说调 A、台账查 B」的唯一自动化防线。SKILL.md 里点名的工具
// 必须全部来自 config，config 里配的工具也必须在正文里被点到——否则门禁会去查一个
// 模型从没被要求调用的工具。
test('SKILL.md 的占位符集合恰好等于配置里的工具键集合', () => {
  const used = placeholders(readSkill(SKILL_PATH)).sort()
  assert.deepEqual(used, Object.keys(TOOLS).sort())
})

test('SKILL.md 正文里没有写死的 mcp__ 工具名', () => {
  assert.equal(readSkill(SKILL_PATH).match(/mcp__[A-Za-z0-9_-]+/g), null)
})

test('SKILL.md 渲染后不残留任何占位符', () => {
  assert.equal(renderSkill(readSkill(SKILL_PATH), TOOLS).includes('{{tool:'), false)
})
