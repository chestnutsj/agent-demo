# dsh-dba-agent

DeepSeek Harness 的 **SQL 优化能力包**。

这个项目**不是**一个新的 agent framework。agent loop、tool calling、context、
compaction、model adapter、session 全部由 harness 提供；这里只装领域相关的那部分，
并且这一版**只装一条路径**：拿到一条 SQL → 取证 → 读计划 → 给建议。

```
DeepSeek Harness  ────────────────────────────  runtime（80%）
        │  plugin loader
        ▼
dsh-dba-agent  ───────────────────────────────  专家能力包（20%）
        ├── router   两层分类 → 两个系统提示词段落（本包唯一的代码）
        ├── skill    方法 → 一个 SKILL.md，由内置 skill-filesystem 装载
        └── tool     执行 → 一个 MCP 工具 → 方言 → 脚本 → 数据库 CLI
```

这一版的重点是**框架**，不是领域内容：三张表撑起三个扩展点，每张都是**数据**，
每张都只填了一行真的实现。

| 表 | 位置 | 现在有什么 |
|---|---|---|
| 问题类目 | `src/router/routes.ts` | `sql-optimize` ready，其余三类 planned |
| 类目 playbook | `src/router/playbooks.ts` | 一条，键就是类目 id |
| 数据库引擎 | `src/core/engine.ts` | `mysql` 有方言，PG / Oracle / OB 只登记不实现 |

对外表面：**1 个注入的服务、2 次注册、1 个模型可见的工具。**

| | 数量 | 是什么 |
|---|---|---|
| `inject` | 1 | `systemPrompt` |
| 注册 | 2 | 两个提示词段落 |
| 模型可见工具 | 1 | `mcp__dba_sql__sql_evidence` |

## 一层交付：装上就是一台 SQL 优化专用机

以前是 bundle + 可选 preset 两层，现在合成一层：**装这个 bundle，会话选择器里就只剩
「SQL 优化模式」**——随附的 `标准 / PTC / 极简 / 创造` 全部消失。

```
dsh plugin add ./dba-agent
      ↓
cordis.patch.yml
      ├─ dba-agent          插件：技能 + 两级 router 段落
      ├─ dba-sql-mcp        MCP：一个取证工具
      ├─ agent-presets      ← disabled: true（停掉随附 roster）
      └─ dba-agent-presets  ← 换成本包的 roster：roots 只指 presets/
```

**为什么是"换掉"而不是"过滤"**：`ctx.agentPresets.list()` 每次调用都重扫根目录，
**没有 allow/deny 接缝**——没有事件、没有配置字段。唯一的杠杆是根目录集合，而
`apps/cli/src/profile-boot.ts` 会在**所有 patch 层之后**强制覆写名为 `agent-presets`
那一行的 `roots`，所以那一行永远收不窄。换一行就可以：同一个插件、自己的 id、自己的
roots，app 的强制覆写点名不到它。被停掉的行仍在组装列表里，强制覆写照样落在它身上——
落在一个不挂载任何东西的行上。这就是整个手法，也是它 `disabled` 而不是被删掉的原因。

两个附带效果，都是刻意的：

- **roots 用 `system` 信任**：UI 里这个 preset 只读，也没有"复制一份"的按钮（创作需要一个
  `user` 根，而这里一个都没有）。preset 就是一份组装——一台以"把 agent 关在一个工具面里"
  为目的的专用机，不该顺手递出这个工具面的编辑器。
- **`includeUserRoot: false`**：不扫 `$DSH_HOME/.agent-presets`。那是人（或 agent）自己写
  组装的地方，留着它等于给了一条把任意模式重新放回选择器的路。

⚠️ **历史会话打不开**：会话头记着它创建时的 preset id，resume 时拿这个 id 去 roster 解析。
用 `standard` 建过的会话在限制生效期间会报 `preset "standard" not found (available: dba)`——
这不是故障，是 roster 如实报告"这个 id 现在没人提供"。新建会话不受影响（走 `default: dba`）。
装这个 bundle 之前，先把旧会话清掉或者换一个干净的 profile。

**想要回普通模式**：`dsh plugin remove dsh-dba-agent`，或者把 `cordis.patch.yml` 末尾那两块
删掉——那样这个包就退回"多装一个模式"的形态，preset 需要另外拷进 `$DSH_HOME/.agent-presets`。

> ⚠️ 顺序有要求：本层必须排在插入 `agent-presets` 的 app bundle **之后**。随附的
> `dsh.profile.bundles` 顺序满足这一点（`dsh plugin add` 是追加）。万一排到了前面，patch 会
> 警告 `entry not found` 并跳过，选择器就会照常显示全部模式——`dsh --profile <name>
> --dump-config` 能看出到底哪一份生效。

## 安装

```sh
npm install                                   # 触发 prepare → tsc，编译出 lib/
dsh plugin --profile web add ./dba-agent      # 装 bundle
dsh --profile web --dump-config               # 校验：出现 "# == dsh-dba-agent" 层，
                                              # 且 agent-presets 那行是 disabled
dsh web                                       # 启动，新建会话时只剩「SQL 优化模式」
```

preset 不需要单独安装：roster 的 roots 直接指向包内的 `presets/`，所以
`dsh plugin add` / `remove` 就是它的装卸。

> 从源码跑就把 `dsh` 换成 `pnpm dsh`（在 harness 仓库根目录）。
> 连接参数在启动前 export：`MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` /
> `MYSQL_PASSWORD` / `MYSQL_DATABASE`，默认值在 `scripts/mysql_query.sh` 里。

卸载：`dsh plugin --profile web remove dsh-dba-agent`——随附的四个模式随之回来，
不用清理任何目录。

## 两层 Router

路由是**决策**，在这个 harness 里决策归模型、由提示词塑形。做成工具只会多一次往返，
模型拿到分类结果之后还是得自己动手。所以 router 是提示词段落，分两级注册：

```
apply(ctx)
 ├─ registerSkills(ctx)          sql-optimize 技能
 ├─ registerRouter(ctx)          dba:router               order 150
 │    ├─ 第一层：这是数据库工作吗（不是就别碰数据库工具）
 │    └─ 第二层：归到 ROUTES 里的哪一类
 │         ├─ sql-optimize   ready    ← 本版本唯一实现的类目
 │         ├─ diagnose       planned  → 明说未实现
 │         ├─ param-tuning   planned  → 明说未实现
 │         └─ schema-change  planned  → 明说未实现
 └─ registerRoutePlaybooks(ctx)  dba:route:sql-optimize   order 160
      └─ 该类目的固定流程：先取证 → 读计划 → 排建议 → 交付不执行
```

分类表在 `src/router/routes.ts`，是**数据**：加一个领域 = 加一项 + 一个 playbook 段落，
不写业务代码。一级只负责分类、二级才讲怎么做，这样加一个类目不用动分类器，分类器也能
短到模型真的会照着执行。

`status` 是这张表里最要紧的字段。标 `planned` 的类目**照样出现在提示词里**：模型必须
能认出"这是参数调整"，然后**说出这一类还没实现**。把它藏起来，模型只会用通用 MySQL 经验
凑一个没有证据支撑的答案——那正是这个包想消除的失败模式。

两个段落的文本都是**静态字符串**。段落本可以是按 assembly 求值的 provider，但这个包的
工具、技能和这个插件在同一个 bundle 层里一起安装，段落能点名的东西在编译期就定死了——
为此注入一个 `tools` 服务、在每次组装时去问一个只有一个答案的问题，是白买一份启动依赖。

## 提示词里没有的东西

默认会话开头有三段这个 agent 用不上的文字，都在 `cordis.patch.yml` 里关掉了：

| 段落 | order | 内容 | 开关 |
|---|---|---|---|
| `harness:identity` | -100 | "You are an AI agent powered by DeepSeek Harness." | `system-prompt` 行的 `includeHarnessIdentity: false` |
| `harness:source` | -99 | DSH checkout 在哪、怎么用它扩展 DSH | `web-runtime` 行的 `surfaceContext: false` |
| `app:web-surface` | -98 | Web GUI、"this page"、怎么重建前端 | 同上（一个开关管两段） |

三段都在把模型的注意力**引向 DSH 自己**——去看 checkout、去重建 web shell、去理解"这个页面"。
而这个 agent 没有 shell、没有文件系统工具，一件都做不到。留着的代价是每次请求都付这些
token，还诱导它去回答一个它打不开的代码库的问题。

两个都是官方暴露的配置项，所以这是**配置**不是压制。于是这个 preset 的提示词从
persona 直接进入 `dba:router`。

> ⚠️ patch 覆盖 `config` 是**整体替换**不是合并。所以 `web-runtime` 那块把
> `openBrowser` / `printUrl` / `trustedHosts` 原样抄了一遍——丢了它们浏览器不会自动打开、
> URL 也不再打印，看起来像启动器坏了而不像提示词变了。上游给这两行加新键，这里会**静默**
> 丢掉，这是覆盖 config 对象的固有代价。`tests/patch-wiring.test.js` 守着这几个键还在。
>
> 另一条路是给 preset 的 persona 设 `complete: true`（"suppresses every other section"），
> 但那样连我们自己的两个 router 段落也一起没了——`complete` 的语义是"这一段就是整个提示词"。

## 三个扩展点

框架的价值在于"加一样东西要改哪几行"是确定的，而且**改漏了会响亮失败**，不会静默降级。

### 加一个问题类目（比如「参数调整」）

1. `src/router/routes.ts` 里那一项改成 `status: 'ready'`，填上 `skill`；
2. `skills/<skill>/SKILL.md` 写方法；
3. `src/router/playbooks.ts` 里加一行 `'param-tuning': paramTuningPlaybook`。

漏了第 3 步，插件加载就抛 `route "param-tuning" is ready but has no playbook`；
漏了第 2 步，技能注册时抛（`SKILL_DIRECTORIES` 是从路由表**推导**的，不是另抄一份列表）。
反过来写了 playbook 却没把类目改成 ready，抛 `playbook "x" has no ready route`。

### 加一个数据库引擎（比如 PostgreSQL）

1. `src/core/dialects/postgresql.ts` 实现 `EvidenceDialect`——三个方法：
   `version()`、`explain(statement, analyze)`、`tableSteps(table)`；
2. `scripts/postgresql_query.sh` 照 `mysql_query.sh` 的约定写：退出码 3 + `DBA_OFFLINE:` 前缀；
3. `src/core/engine.ts` 里把该引擎的 `status` 改成 `ready`，在 `DIALECTS` 里注册。

**走查的顺序不用重写**：先版本、再计划、再逐表，那是引擎无关的部分，写在
`src/core/evidence.ts`；每个引擎只回答"这三个问题用什么语句问"。

引擎由部署决定，不由模型选：`DBA_ENGINE`（默认 `mysql`）。模型那边看到的工具名
`mcp__dba_sql__sql_evidence` **不带引擎**，所以换引擎不用重写任何提示词。配了一个还没实现的
引擎，工具会带着"只实现了 MySQL"的原因失败，而不是拿 MySQL 的语法去问 Oracle。

### 加一个工具

`src/tools/names.ts` 加名字 → `src/mcp/server.ts` 加 handler → 在 playbook 里点名。
提示词里出现的工具名必须都是本包提供的，这条有测试守着（`tests/plugin.test.js`）。

## 注册面：能不申请就不申请，能不写就不写

```ts
export const inject = ['systemPrompt'] as const
```

`inject` 里每一项都是 loader 必须**等待**的服务，所以只剩这一个——这个包只往它里面写。
去掉的两个各有原因：

- **`tools`** — 只用来 `ctx.tools.get()` 探测工具在当前 scope 里存不存在，外加一个
  `tools/result` 审计监听。两者都不是这条路径跑起来必需的。
- **`skills`** — 连同那 89 行的 SKILL.md 加载器一起删了，换成 `cordis.patch.yml` 里一行
  内置的 `@deepseek-ai/dsh-skill-filesystem`：

  ```yaml
  - id: dba-skills
    name: '@deepseek-ai/dsh-skill-filesystem'
    config:
      providerName: dba          # `filesystem` 是部署自己那行的名字
      includeDefaultRoots: false # 隔离提供方：只看本包的 skills/
      customSkillDirs: [ <本包>/skills ]
  ```

  它已经会解析 frontmatter、注册提供方、**watch 文件**——自己写一个只是更差的复制品，
  而且改一行 SKILL.md 还要重新编译。`includeDefaultRoots: false` 同样是刻意的：不捡
  `<dshHome>/skills` 里别人放的东西，一个以"结论可追溯"为卖点的 agent 不该吃没审过的方法。

  代价是那条"ready 类目必须有技能"的校验从加载期挪到了测试期——提供方遇到解析不了的
  目录是**警告并跳过**。`tests/plugin.test.js` 现在直接读 `skills/<name>/SKILL.md` 的
  frontmatter 核对，比原来更早发现。

`ctx.logger` 不在 `inject` 里：它是 cordis 基础上下文自带的。

`src/harness.ts` 只剩 26 行——一个 `PromptSection` 加一个 logger。手写结构化类型是因为这个包
用 `dsh plugin add` 装在 harness workspace 外，编译期解析不到 `@deepseek-ai/dsh-*`；要改成
直接 import 真类型，就得加一条指向本地 checkout 的 link 依赖，把仓库绑死在同级路径上。
形状对不上会在加载时响亮失败，不会静默降级。

> 那两个 router 段落**没有**内置插件可替代：`dsh-persona` 只注册固定的 `deployment:persona`
> （order 0），harness 里没有"任意 order + 任意文本"的通用段落插件。而且段落文本是从
> `ROUTES` / `ENGINES` 两张表推导、加载时还校验配对的——那正是这个包剩下的全部代码。

## 数据库访问：一个工具，不是 shell

```
skill (方法论)  →  模型调用  →  mcp__dba_sql__sql_evidence
                                      ↓  engine.ts 按 DBA_ENGINE 选方言
                                 mysql 方言  →  mysql_query.sh  →  mysql CLI
```

**preset 不组装任何 shell 工具，也不提供"随便执行一条 SQL"的入口**，这是整个包最要紧的
一个决定。

skill 本身不执行任何东西——它只是塞给模型的一段文字。所以"skill 跑脚本"实际意思是
"模型用 `bash` 工具跑脚本"，而一个握着 `bash` 的 agent 可以绕开脚本直达数据库
（`mysql -e "DROP …"`）。那样的话 `src/core/mysql.ts` 里的只读策略就只是个说法。

收到只剩一个工具之后，这件事更干净了：能到达服务器的语句只有两种——本包生成的
`SHOW CREATE TABLE` / `SHOW INDEX` / 一行 `information_schema` 查询，以及被优化的那条
语句本身，而它只会跟在 `EXPLAIN` 后面跑。"默认只读"于是是这个表面的**属性**，不是一句
关于行为的承诺。

代价是实打实的：这个 agent 不能 tail 慢日志、不能读 my.cnf、不能查磁盘、不能跑
mysqldump、也不能从工作区里翻出那条 SQL。每一项都该是一个刻意添加的工具，而不是
"给了 shell 顺手就有"。

### `sql_evidence`：一次调用，一整份证据

```
mcp__dba_sql__sql_evidence   { "sql": "SELECT ... FROM orders JOIN users ..." }
```

按 DBA 实际的顺序走一遍，返回四类信息（顺序是引擎无关的，语句由方言给）：

1. 服务器版本与 `sql_mode`——它决定了哪些改写在这台服务器上**根本不存在**（hash join、CTE、
   窗口函数、`EXPLAIN ANALYZE` 都是 8.0）；
2. `EXPLAIN FORMAT=JSON` 的完整计划；
3. 语句涉及的每张表（最多 4 张）的 `SHOW CREATE TABLE`；
4. 每张表的 `SHOW INDEX` 与 `table_rows` / `data_length` / `index_length`。

拆成"一个 explain 工具 + 一个查询工具"要四到十次往返，而在那个代价下最容易被跳过的
恰恰是决定答案的那一步——优化器当时到底有哪些选择。表名从语句文本里取
（`src/core/sql.ts`），取不出合法标识符就丢弃，绝不拼进 SQL。

`"analyze": true` 换成 `EXPLAIN ANALYZE`。它会**真正执行**被分析的语句，而只读策略只看得到
`EXPLAIN` 这个动词，所以 DML 在 `analyzeRefusal()` 这一层挡掉，而不是指望策略。

### 连不上库时：手动接力

脚本以退出码 `3` 和 `DBA_OFFLINE:` 前缀报告"根本连不到服务器"，走查探到之后**不再重试
剩下的步骤**，而是把整份证据包需要的语句一次渲染成 relay block：

```
DBA_OFFLINE: ERROR 2003 (HY000): Can't connect to MySQL server on '127.0.0.1:3306'

这台机器连不到数据库。请在能连到数据库的机器上执行下面的语句，并把输出贴回来。

--- 请执行 ---
-- 执行计划（EXPLAIN FORMAT=JSON）
EXPLAIN FORMAT=JSON SELECT ...;

-- `orders` 的建表语句
SHOW CREATE TABLE `orders`;
...
--- 结束 ---
```

技能和 router 段落里都写死了此时的行为：**不重试、不臆测**，转述语句、说明每条看什么、
等用户粘贴结果、再照常分析。没有直连的 SQL 优化 agent 依然有价值；只会报
"connection refused" 的没有。这是降级**模式**不是失败——所以工具把它渲染成**成功**结果；
渲染成错误会教模型去重试或者瞎猜。

同理，MCP 行是 `failOnStartupError: true`：这个 server 启动时不连任何东西，启动失败只
可能是装坏了（没编译、路径错、没有 node），那种情况必须响亮地失败。

### bundle 层只转发一个环境变量

MCP 子进程从 `scrubbedParentEnv()` 起步，它只丢弃匹配 `/KEY|PASSWORD|SECRET|TOKEN/i`
的名字和 `DSH_*`。所以 `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_DATABASE`
本来就会继承下去，`cordis.patch.yml` 里只需要显式转发 `MYSQL_PASSWORD` 一项；默认值属于
`scripts/mysql_query.sh`，不在 patch 里再抄一遍。

## 目录

```
dba-agent/
├── cordis.patch.yml          bundle 层：插件行 + MCP 行（一个工具）
├── presets/dba/
│   ├── agent.cordis.yml      「SQL 优化模式」组装：persona + 技能 + 问用户 + compaction
│   └── preset.yml            展示名与描述（roster 的 roots 直接指向这里）
├── scripts/
│   ├── mysql_query.sh        单条 SQL（连接处理与降级都在这里）
│   └── gen-local-patch.mjs   build 后生成本地调试 overlay（.gitignore）
├── skills/sql-optimize/      只讲方法论（由内置 skill-filesystem 装载与 watch）
├── tests/                    node:test，零新依赖
│   ├── plugin.test.js        注册面：inject 一项、类目↔playbook↔技能三方配对
│   ├── patch-wiring.test.js  patch 接线：关掉的段落、roster、本地 overlay
│   ├── engine.test.js        引擎接缝：未实现的引擎必须响亮失败
│   ├── sql.test.js           取表名、ANALYZE 门禁、离线接力
│   └── mcp.test.js           起 server 说协议：工具只有一个
└── src/
    ├── index.ts               插件入口：inject 两个服务，注册三样东西
    ├── harness.ts             这两个服务的结构化类型（不依赖 harness 包）
    ├── router/routes.ts       ① 二级分类表（ready / planned）
    ├── router/playbooks.ts    ② 类目 id → playbook 段落，加载时校验配对
    ├── router/section.ts      一级路由段落：是不是数据库工作 + 归哪一类 + 哪种库
    ├── router/sql-optimize.ts sql-optimize 那一条 playbook 的正文
    ├── core/engine.ts         ③ 引擎表 + 方言注册表 + DBA_ENGINE 解析
    ├── core/dialects/mysql.ts MySQL 方言：版本、EXPLAIN、逐表三条
    ├── core/evidence.ts       引擎无关：只读策略、走查顺序、一次探测即接力
    ├── core/sql.ts            语句文本分析：取表名、EXPLAIN ANALYZE 门禁
    ├── mcp/server.ts          MCP 传输层：一个工具，core 的薄壳
    ├── tools/names.ts         工具名常量（提示词与 server 共用，不带引擎）
    └── tools/README.md        原生 defineTool 迁移方案
```

## 本地调试

改一行代码就 `dsh plugin add` 重装一遍太慢。`npm run build` 会顺手生成一份
**本地调试 overlay**，用 `--patch` 挂上去就直接吃工作区里的 `lib/`：

```sh
npm run build                                            # 编译 + 生成 overlay
dsh --profile web --patch $PWD/cordis.patch.local.yml web
```

之后的循环就是：改代码 → `npm run build` → 重启。不再有安装步骤。

overlay 做的事是**停掉三行、插三行**：

```
- id: dba-agent            disabled: true   ┐ 装好的那份（没装就只警告一句
- id: dba-sql-mcp          disabled: true   │ "entry not found" 然后跳过，
- id: dba-agent-presets    disabled: true   ┘ 所以装没装都能用）
- id: agent-presets        disabled: true     随附 roster，同 cordis.patch.yml

- insert:
    - dba-agent-local          name: <工作区>/lib/index.js
    - dba-sql-mcp-local        args: [<工作区>/lib/mcp/server.js]
    - dba-agent-presets-local  roots: [<工作区>/presets]
```

**为什么是"停掉再插"而不是把装好的那行改指向本地**：patch 里的 `name` 是**断言**不是覆盖——
`applyEntryPatches` 把它从 overrides 里剔出去，只用来拒绝"这个 id 已经漂到别的插件上了"
的情况（`vendor/include/src/index.ts`）。一行的 specifier 在插入时就定死了，换文件就得换行。

**为什么是生成而不是签入**：entry 的 `name` 就是 loader 要 import 的 specifier，而 `!!js`
够不到它（Loader 只对 `config` 插值，见 harness 的 postmortem 0002）。所以路径只能是字面量
绝对路径，文件因此是机器相关的——`.gitignore` 里有它，生成器是 `scripts/gen-local-patch.mjs`。

> 校验方式和正式安装一样：`dsh --profile web --patch <文件> --dump-config`，
> 看到 `# == <你的 overlay 路径>` 那一层里三个 `-local` 行指向工作区就对了。

## 验证

```sh
npm run check        # build → 类型检查（含未使用检查）→ 32 个测试
npm test             # 只跑测试（需要先 npm run build）
```

测试用 node 内置的 `node:test`，**没有新增依赖**；`tests/mcp.test.js` 用的是已经在
`dependencies` 里的 MCP SDK 客户端，真的把 `lib/mcp/server.js` 起起来说一遍协议。

三个文件各自守着一件事：

| 文件 | 守什么 |
|---|---|
| `plugin.test.js` | `inject` 只有一项；只注册 2 个段落；段落文本是**静态字符串**；每个 ready 类目都有 playbook，且 `skills/<name>/SKILL.md` 真的存在、frontmatter 的 `name` 与路由表对得上、`description` 非空（provider 会静默跳过缺 description 的技能）；提示词里出现的工具名不能超出本包真正提供的那一个 |
| `patch-wiring.test.js` | 三段 harness 提示词的开关都在，`web-runtime` 的三个键没被整体替换弄丢；patch 里停掉了随附 roster；自己那行的 `default` 指向真实存在的 preset 目录；`presets` 在 `files` 里（否则安装后的根目录是空的，而随附模式已经被同一份 patch 停掉了）；本地 overlay 停全了该停的行、指向的文件真的存在、且没被签入 |
| `engine.test.js` | 只有一个引擎 ready 且其余仍对路由可见；`DBA_ENGINE` 归一化；已知但未实现的引擎报错要**点名实现了什么**；未知引擎不静默回落到 MySQL |
| `sql.test.js` | 表名提取（含派生表、注释、字符串字面量、不安全标识符）；`EXPLAIN ANALYZE` 只对 SELECT 放行；连不上时**只出一个** relay block 而不是每步一个 |
| `mcp.test.js` | 模型实际看到的表面：`tools/list` 只有 `sql_evidence`；OFFLINE 渲染成**成功**结果；analyze 打 DML 被拒 |

涉及数据库的用例把 `MYSQL_PORT` 指向一个关闭的端口，所以在有库、没库、甚至没装 mysql
客户端的机器上，结果都是确定的离线分支。**真库上的取证输出仍未验证**——那条路径要等有
可连实例时补一个端到端用例。

## 和同类产品的对照

参照过一份 BIC-agent 的说明。它是**内容重**的形态：一个总路由分发到十来个分支
（文档检索、SQL 合规、SQL 优化、SQL 生成，再加 A–E 五类问答模板），SQL 优化那一支
按数据库类型加载各自的 advisor（`mysql-sql-optimization-advisor` / `oracle-…` / `pg-…`），
底下压着一个知识图谱（`kb_graph.py` / `search_kg.py`）。

两处结构值得对齐，这一版对齐了：

- **二级路由按 db type 分方言**——就是上面的 `src/core/engine.ts`；
- **"版本差异必须标注"**——所以取证第一步就是 `SELECT VERSION()`，而不是让模型假设 8.0。

其余的**刻意没有搬**：24 类等价改写规则、14 项改写前检查、六段报告模板、参数默认值表、
A–E 输出模板。那些是**领域内容**，不是框架；而且其中相当一部分（知识图谱检索、案例库）
依赖这个包没有的检索后端。这一版要的是骨架立住、接缝清楚，内容后填。

## 下一步

完整清单在 [TODO.md](TODO.md)：按"填内容 → 补工具 → 加类目 → 加引擎"分了四档，
每条都标了要改哪几行、以及 BIC 那边的对应物。摘要：

1. **往框架里填内容** — 三个扩展点各自的第一块内容：`sql-optimize` 技能里补等价改写的
   前置条件（`NOT IN`→`NOT EXISTS` 要求关联列 NOT NULL 这一类）、固定的输出结构。
   这些都是改 `SKILL.md`，不动代码。
2. **实现「参数调整」或「运行时诊断」类目** — 按上面「加一个问题类目」三步走。缺的都是
   采集端：诊断要 processlist / `innodb_trx` / 锁等待，参数要 `SHOW GLOBAL STATUS` 前后采样。
   没有采集就只能报经验值，而经验值正是这个包不想给的东西。
3. **实现第二个引擎** — 按上面「加一个数据库引擎」三步走。第二个方言落地那天，才算真正
   证明这个接缝是对的。
4. **工具迁到原生 `defineTool`** — 见 `src/tools/README.md`。拿到参数校验、`output.render`
   与 `tools/pre-execute` 门禁，同时去掉一个子进程；`src/core/evidence.ts` 就是为这次迁移
   准备的，换的是壳不是逻辑。
5. **子 agent** — 等第二个类目 `ready` 之后才有意义。只有一个领域时，委派给自己只是多一
   层开销。
