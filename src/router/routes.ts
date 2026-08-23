// The DBA routing table — the second level of routing, as data.
//
// Level one is "is this database work at all"; level two is "which kind".
// Both levels are prompt text (see ./section.ts for why routing is not a
// tool), but the CLASSES live here so that adding a domain is one entry plus
// its playbook, and so that what this pack can and cannot do is stated in one
// place rather than implied by which files happen to exist.
//
// `status` is the load-bearing field. A class that is `planned` is advertised
// anyway, on purpose: the model must be able to recognize "this is parameter
// tuning" and then SAY the pack does not do it yet. Hiding the class instead
// would leave the model to improvise an answer out of general MySQL folklore,
// which is the failure mode this whole pack exists to prevent.

/** Whether a class has a real implementation behind it in this version. */
export type RouteStatus = 'ready' | 'planned'

/** One second-level class of database work. */
export interface Route {
  /** Stable id; a `ready` route's playbook section is named `dba:route:<id>`. */
  readonly id: string
  /** Model-facing name of the class. */
  readonly title: string
  /** What belongs to this class. */
  readonly covers: string
  readonly status: RouteStatus
  /** The skill carrying this class's method, when it is `ready`. */
  readonly skill?: string
  /** What to tell the user when the class is `planned`. */
  readonly note?: string
}

/** The second-level classes, in the order the router presents them. */
export const ROUTES: readonly Route[] = [
  {
    id: 'sql-optimize',
    title: 'SQL 优化',
    covers: '一条具体语句慢、要改写、要加索引、要读执行计划',
    status: 'ready',
    skill: 'sql-optimize',
  },
  {
    id: 'diagnose',
    title: '运行时诊断',
    covers: '查询卡住、锁等待、连接打满、复制延迟、崩溃恢复',
    status: 'planned',
    note: '诊断要从服务器现场取证（processlist、innodb_trx、锁等待、元数据锁），'
      + '本包这一版只装了 SQL 优化的取证工具。直说这个类目还没实现。',
  },
  {
    id: 'param-tuning',
    title: '参数调整',
    covers: 'buffer pool 大小、连接数、超时、刷盘策略、复制并行度这类服务器变量的取值',
    status: 'planned',
    note: '定这些值要有基线和压测数据，本包还没有采集它们的工具。'
      + '直说这个类目还没实现，可以解释某个参数的含义与权衡，但不要报出具体取值。',
  },
  {
    id: 'schema-change',
    title: '结构变更',
    covers: 'DDL、分区、归档、字段类型变更、大表重建',
    status: 'planned',
    note: '变更要有影响评估（锁表时长、是否 online DDL、回滚路径），本包还没有校验它们的工具。'
      + '直说这个类目还没实现。索引类的变更建议属于「SQL 优化」，走那条路。',
  },
]

/**
 * Look one class up by id.
 * @param id - the route id.
 * @returns the route, or `undefined` when no class carries that id.
 */
export function routeById(id: string): Route | undefined {
  return ROUTES.find(route => route.id === id)
}
