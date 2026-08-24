// Level two of the router, for the `sql-optimize` class.
//
// The classifier (./section.ts) only names the class; this section is what the
// class MEANS in practice — the fixed order of work, and the entry point for
// it. It is the one class implemented in this version, so it is the one
// playbook registered.
//
// Method vs. flow: the deep material (how to read a plan, which rewrites, what
// an index costs) is the `sql-optimize` SKILL, loaded on demand. What sits in
// the prompt unconditionally is only the part that must not be skipped — get
// the server's plan BEFORE saying anything about indexes. A model that answers
// from the SQL text alone has already produced the wrong answer, and no amount
// of later skill content undoes it.

import { READY_ENGINES } from '../core/engine.js'
import { TOOL, modelFacing } from '../tools/names.js'
import { routeById } from './routes.js'

/** The class this playbook implements. */
const ROUTE_ID = 'sql-optimize'

/**
 * Build the playbook text for the SQL-optimization class.
 * @returns the section text.
 * @throws when the route table has no entry for this class.
 */
export function sqlOptimizePlaybook(): string {
  const route = routeById(ROUTE_ID)
  if (route === undefined) throw new Error(`route "${ROUTE_ID}" is missing from ROUTES`)
  const engines = READY_ENGINES.map(engine => engine.title).join(' / ')

  return [
    `# ${route.title}流程`,
    '',
    '被归到「SQL 优化」的请求按这个顺序走，不要跳步。',
    '',
    '1. **先明确对象。** 哪一条语句、跑在哪种数据库上、慢到什么程度、是偶发还是每次。',
    '   用户只给了现象没给语句时，先要语句——没有语句就没有计划，没有计划就没有优化。',
    `   本版本的取证只实现了 ${engines}；其他数据库直说未实现，不要用通用 SQL 经验代答。`,
    '2. **取证。** 在说出任何一句关于索引的话之前，先拿到服务器的真实计划和真实表统计信息。',
    '   ```',
    `   ${modelFacing(TOOL.evidence)}   { "sql": "<不带 EXPLAIN 的语句>" }`,
    '   ```',
    '   一次返回：服务器版本、`EXPLAIN FORMAT=JSON` 的计划，以及语句涉及的每张表的建表语句、',
    '   索引、规模。版本先看：它决定了哪些改写在这台服务器上根本不存在。',
    '   需要实际耗时而不是估算时加 `"analyze": true`——它会真正执行这条语句，重查询先跟用户确认。',
    `3. **读计划。** 加载 \`${route.skill}\` 技能，按其中的读法逐项对照：\`access_type\`、`,
    '   扫描行数与返回行数的比值、`used_key_parts`、`filesort` 与 `temporary table`。',
    '4. **给建议，按代价从低到高排。** 先改写，再索引，最后改结构。',
    '   每条建议都要指明它对应计划里的哪一处；说不出"因为计划里 X，所以做 Y"，就是证据还不够。',
    '   每个提议的索引都要同时说明代价：写放大、空间、以及它可能让优化器改选更差的计划。',
    '5. **交付，不执行。** 这个 agent 执行不了 `CREATE INDEX` / `ALTER TABLE`，也不该去执行。',
    '   交回可直接执行的语句、预估影响（锁表时长、是否 online DDL）和回滚方式，由运维执行。',
    '   改写类建议可以自己验证：改写后再取一次证，把两份计划摆在一起对比。',
  ].join('\n')
}
