# TODO

框架已经立住：三张表（问题类目 / 类目 playbook / 数据库引擎），每张填了一行真实现。
这份清单是**往框架里填什么**，按"当前这条路走通 → 补第二个类目 → 补第二个引擎"排序。

参照对象是一份 BIC-agent 的能力说明。它是内容重的形态：十来个分支 + 每种数据库一个
advisor + 一套知识图谱后端。下面每条都标了对应关系，以及**在我们这边要改哪几行**。

现状：

| 维度 | ready | planned |
|---|---|---|
| 问题类目 | `sql-optimize` | `diagnose` / `param-tuning` / `schema-change` |
| 数据库引擎 | `mysql` | `postgresql` / `oracle` / `oceanbase` |
| 模型可见工具 | `sql_evidence` | 见下面「工具清单」 |

---

## P0 · 让唯一这条路真的够用

这三条都不需要新工具，只改 `skills/sql-optimize/SKILL.md`，是性价比最高的一批。

### 1. 等价改写的前置条件清单

**问题**：现在技能里"改写查询"只给了四个例子（函数包裹索引列、隐式转换、`OR` 拆
`UNION ALL`、大 `OFFSET`），**没有一条说改写可能改变结果**。推荐一个语义不等价的改写，
是这个 agent 能犯的最严重的错——比给不出建议糟得多。

**做什么**：一张紧凑的对照表，每行一个改写、它的前置条件、不满足时的后果。至少覆盖：

| 改写 | 前置条件 | 不满足的后果 |
|---|---|---|
| `NOT IN` → `NOT EXISTS` | 两侧关联列都 NOT NULL | `NOT IN` 遇 NULL 返回空集 |
| `UNION` → `UNION ALL` | 分支间无重叠，或业务接受重复 | 保留重复行 |
| `JOIN` → `EXISTS` | 右表至多一行匹配 | JOIN 会复制行 |
| `LEFT JOIN` 条件从 `ON` 移到 `WHERE` | 不依赖补 NULL 行 | 外连接退化成内连接 |
| 标量子查询 → `LEFT JOIN` | 连接键唯一 | 标量多行报错，JOIN 静默复制 |
| `COUNT(col)` → `COUNT(*)` | col NOT NULL | `COUNT(col)` 不计 NULL |
| `HAVING` → `WHERE` | 条件不含聚合函数 | 聚合前后过滤语义不同 |
| 删内层 `DISTINCT` | 不改变外层重复行倍数 | 行数变化 |

**对应 BIC**：`mysql-sql-optimization-advisor` 的 14 项强制检查清单。它靠 `search_kg.py`
从知识图谱里取规则；我们没有那个后端，所以**写死在技能里**——这些前置条件是 SQL 语义，
不随实例变化，不需要检索。

**改哪**：`skills/sql-optimize/SKILL.md` 第 3 节。

### 2. 版本门槛表

**问题**：取证第一步已经拿到 `VERSION()`，但技能里没告诉模型**拿它干什么**。

**做什么**：一张"这个建议至少要什么版本"的表——hash join / CTE / 窗口函数 /
`EXPLAIN ANALYZE` / 不可见索引 / 函数索引 / `SKIP LOCKED` 各自的下限，5.7 与 8.0 的
`optimizer_switch` 差异。给 5.7 的服务器提 8.0 才有的改写，是错答案不是次优答案。

**对应 BIC**：`mysql-sql-optimization-advisor` 禁止项第 3 条"5.7/8.0 差异必须标注"。

**改哪**：`skills/sql-optimize/SKILL.md`，新增一节。

### 3. 固定输出结构

**问题**：现在只规定了"按代价排序、指明计划依据"，没规定形状，两次回答不可比。

**做什么**：四段——语句与特征 / 计划里的问题（附严重度）/ 建议（优先级 + 预期 + 代价）
/ 验证方式。BIC 用的是六段，多出来的两段（等价性验证 SQL 附录、参考资料）在我们这边
一段并入验证、一段没有来源可引，去掉。

**改哪**：`skills/sql-optimize/SKILL.md` 第 4 节。

---

## P1 · 补齐 SQL 优化这一类目缺的工具

这三个工具都属于**已 ready 的类目**，装上就能用，不需要动路由表。

### 4. `column_stats` — 列区分度采样

**为什么**：建索引的第一问是"这列值得建吗"。`SHOW INDEX` 的 `Cardinality` 只覆盖**已有**
索引的列；对一个还没有索引的候选列，现在只能猜。

**形状**：`{ table, columns[] }` → 每列的 `COUNT(DISTINCT col)`、NULL 比例、
`COUNT(DISTINCT col)/COUNT(*)`，大表自动带 `LIMIT` 采样并注明是采样值。

**改哪**：`src/core/dialects/mysql.ts` 加语句、`src/tools/names.ts` 加名字、
`src/mcp/server.ts` 加 handler、playbook 里点名。

### 5. `index_usage` — 现有索引的使用情况

**为什么**：提议加索引之前先看现有的有没有人用。同一份数据还能反过来回答"哪些索引可以
删"——冗余索引的写放大是真实成本，而这个包现在只会往上加。

**形状**：无参 → `performance_schema.table_io_waits_summary_by_index_usage` 里该库的
索引读写次数，加 `sys.schema_unused_indexes`（若可用）。instrument 没开就报"不可用"，
按现有走查的规矩继续。

### 6. `sql_equivalence_check` — 改写的等价性验证

**为什么**：P0 第 1 条给的是**判断依据**，这个给的是**实证**。改写建议里说"等价"，
最好能在真实数据上验一次。

**形状**：`{ original, rewritten, limit }` → 生成双向差集（8.0.31+ 用 `EXCEPT`，更早用
`NOT EXISTS`）并执行，返回两侧独有的行数与样例。**只读**，两条都必须是 SELECT。
返回里要写死一句话：结果为空只说明当前数据一致，不代表所有实例上等价。

**对应 BIC**：12 种等价性验证模式的可执行版本。

**风险**：会跑两遍原查询，重查询很贵。所以默认带 `LIMIT`，并要求调用前跟用户确认——
和 `analyze: true` 一样的处理。

---

## P2 · 第二个类目

按 README「加一个问题类目」三步走：路由表改 `status` + 写 `SKILL.md` + `playbooks.ts`
加一行。缺的都是**采集端**。

### 7. `sql-check` 类目（新增） + `sql_syntax_check` 工具

**做什么**：BIC 把"SQL 能不能跑"和"SQL 跑得快不快"分成两个分支，这个切分是对的：
现在用户拿一条语法不对的 SQL 来，我们会直接去 EXPLAIN，然后把服务器的语法报错原样丢
回去，而不是告诉他哪里不对。

**工具**：`PREPARE stmt FROM '<sql>'` + `DEALLOCATE PREPARE` —— **校验语法与对象存在性
但不执行**，正好落在只读策略里。

**注意**：这是新增一个类目，路由表要加一项，和「SQL 优化」的边界要写清楚
（能不能跑 → sql-check；跑得快不快 → sql-optimize）。

### 8. `diagnose` 类目 + `runtime_evidence` 工具

**做什么**：这是被砍掉的 `mysql_locks` 的正式版本，形状对齐 `sql_evidence`——一次调用
一份证据包，带 `topic` 参数：

- `locks`：processlist（非 Sleep）→ `innodb_trx` → `data_lock_waits` → PENDING 元数据锁；
- `replication`：`SHOW REPLICA STATUS` 的关键字段（8.0.22 之前是 `SHOW SLAVE STATUS`，
  版本判断已经有了）；
- `connections`：`Threads_connected` / `max_connections` / 按 user+host 聚合。

顺序不能颠倒：先"谁在等"，再"谁持有"，最后才谈处置。

### 9. `param-tuning` 类目 + `status_delta` 工具

**做什么**：这一类目现在明说未实现，因为**报参数值必须有基线**。缺的就是基线采集：

- `status_delta`：两次 `SHOW GLOBAL STATUS` 间隔 N 秒取差值 → QPS、命中率、
  临时表落盘率、锁等待率。这是"现在到底忙不忙"的唯一可信来源；
- `wait_events`：`performance_schema` 的等待事件汇总（BIC 有 `wait_event_info.py`，
  但那是查知识库，我们要的是查实例）；
- 宿主机规格（内存 / CPU / 磁盘）**拿不到**——没有 shell。要么让用户提供，要么单独加
  一个受控工具。这是这个类目最大的未决问题，先在技能里要求用户给。

### 10. `schema-change` 类目 + `ddl_impact` 工具

**做什么**：表大小、外键、触发器、当前版本对 `ALGORITHM=INPLACE` / `INSTANT` 的支持，
拼成一份"这条 DDL 会锁多久、能不能 online、怎么回滚"的评估。索引类变更仍归 SQL 优化。

---

## P3 · 第二个引擎

按 README「加一个数据库引擎」三步走。PostgreSQL 最合适先做：

- `src/core/dialects/postgresql.ts`：`version()` → `SELECT version()`；
  `explain()` → `EXPLAIN (FORMAT JSON, ANALYZE …)`；`tableSteps()` → `pg_indexes` +
  `pg_stats` + `pg_class.reltuples`；
- `scripts/postgresql_query.sh`：`psql`，退出码 3 + `DBA_OFFLINE:` 前缀的约定照抄；
- `src/core/engine.ts` 里 `status: 'ready'` + `DIALECTS` 注册。

**走查顺序不用重写**——那是引擎无关的部分。第二个方言落地那天，才算真的证明这个接缝对。

技能怎么办：`sql-optimize` 的 SKILL.md 现在通篇是 MySQL 的读法。要么按引擎拆技能
（`sql-optimize-mysql` / `sql-optimize-postgresql`，路由表的 `skill` 字段改成按引擎取），
要么技能里分节。**这个决定等第二个引擎真要落地时再做**，现在定属于过早。

---

## 工具清单

| 工具 | 类目 | 状态 | 依赖 | BIC 的对应物 |
|---|---|---|---|---|
| `sql_evidence` | sql-optimize | ✅ 已实现 | — | advisor 里的 EXPLAIN + 元数据步骤 |
| `column_stats` | sql-optimize | P1 | — | （无，BIC 靠知识库给经验） |
| `index_usage` | sql-optimize | P1 | performance_schema | （无） |
| `sql_equivalence_check` | sql-optimize | P1 | 8.0.31+ 更好写 | 12 种等价性验证模式 |
| `sql_syntax_check` | sql-check（新） | P2 | — | `sql_full_check.py` |
| `runtime_evidence` | diagnose | P2 | performance_schema | （A/B/D 类各自的取数命令） |
| `status_delta` | param-tuning | P2 | — | （无，BIC 不采实时基线） |
| `wait_events` | param-tuning | P2 | performance_schema | `wait_event_info.py`（但它查库、我们查实例） |
| `ddl_impact` | schema-change | P2 | — | （无） |
| 宿主机规格 | param-tuning | ❓未决 | 需要 shell 或受控工具 | （无） |

### 明确不做的

| BIC 的能力 | 为什么不做 |
|---|---|
| `kb_graph.py` / `search_kg.py` / `kg_deep_diagnose.py` | 依赖一整套知识图谱后端（Neo4j + 图谱数据）。没有那份数据，做出来的是空壳 |
| `doc_retrieve.py`（官方文档原文） | 同上，需要文档语料库。真要做就是接 harness 的 `retriever`，属于另一个项目 |
| `sql-query-generator`（需求 → SQL） | 方向相反的能力，和"优化已有 SQL"不共享任何工具 |
| A–E 五类输出模板 | 那是问答形态的产品决策，不是数据库能力。我们的类目表已经承担了分类职责 |
| 案例库 / 故障模型库 | 同知识图谱，需要数据 |

**一句话**：BIC 的价值一半在知识图谱里。没有那份数据的情况下，能对齐的只有它的**结构**
（按 db type 分方言、版本差异必标注、能不能跑与快不快分开），以及那些**不依赖检索的
SQL 语义规则**（等价改写的前置条件）——这两类正是上面 P0 和 P2 第 7 条。
