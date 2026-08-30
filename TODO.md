# TODO

v2 重写后未闭环的事项，按建议处理顺序排列。做完一项删一项。

## 1. `sql_equivalence_validator` 原生工具还没实现

- `skills/sql-optimize/SKILL.md` 阶段五让模型调 `{{tool:validator}}`，由 `src/config.ts`
  的 `DEFAULTS.validatorToolName` 渲染成 `sql_equivalence_validator`。
- 本分支还没有注册这个原生工具的插件。模型会去调一个不存在的名字，报错后按降级路径写
  「待补证据」；门禁把 validator 列为软要求，不会死锁，但每次带改写的优化都会白费一次
  调用加一段降级文案。
- 两条路，二选一：
  - 短期：从 SKILL.md 阶段五摘掉 `{{tool:validator}}` 那段，并从 `src/config.ts` 的
    `ToolKey` / `DEFAULTS` / `REASONS` 里删掉 validator。`tests/skill.test.ts` 有
    「占位符集合恰好等于配置键集合」的守卫，两边必须一起改。
  - 长期：实现等价性校验器并注册为原生工具，SKILL.md 与 config.ts 不用动。

## 2. 外部 MCP 工具名未验证（config.ts 的 TODO 仍挂着）

- `DEFAULTS` 里三个 `mcp__mysql-optimize__*` 名字待
  `http://moyu.local:5000/mcp/mysql-optimize` 的 tools/list 确认（2026-08-30 从本机探测
  `moyu.local` 不可达，确认仍欠着）。
- 名字对不上时门禁永远判「没调过」、每回合顶回直到额度用完——最难当场看出来的失配。
  确认后删掉 `src/config.ts` 里的 TODO 注释。
- 一并确认该 server 的工具面全部只读（只允许 EXPLAIN / SHOW / information_schema）：
  v1 的「只读是工具面的结构属性」在 v2 已不存在，persona 里「你只读」只是提示词约束。

## 4. persona 未引导 `/sql-optimizer`

- 门禁入册只认命令（`src/index.ts` 顶部的注释解释了为什么），但 persona 没提这个命令，
  门禁覆盖面等于命令使用率。在 persona 的工作方式里加一句：优化语句前先执行
  `/sql-optimizer`。

## 5. SKILL.md 与门禁对 fullCheck 的说法矛盾

- SKILL.md 说合规检查「一票否决、没过就不输出」，`src/config.ts` 里它是软要求（不阻塞；
  台账看不到报告内容，硬要求会误伤「本次无改写」）。
- 在 SKILL.md 那条后面补一句「门禁层面此项仅提醒、不阻塞输出」，避免模型反复自我检查
  却拿不到门禁反馈。

