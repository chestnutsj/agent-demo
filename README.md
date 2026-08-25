# dsh-dba-plugins


| 包名 | 方式 | 说明 |
| --- | --- | --- |
| `dsh-dba-skill` | Skill | 模型用 Bash 工具直接跑脚本 |
| `dsh-dba-mcp` | MCP | 独立 stdio server 暴露 `mysql_query` 工具 |
| `dsh-dba-tool` | Tool | 插件进程内 `ctx.tools.register()` 注册原生工具 |

pnpm workspace 结构:三个子包在 `packages/*`,共用根目录的 `scripts/mysql_query.sh`。

## 打包(生成三个安装包)

```sh
pnpm install            # 安装依赖
npm run pack:all        # 编译 + 打包,dist/ 下生成三个 .tgz

# 或单独打某一个:
npm run build           # 先编译(pnpm -r build)
npm run pack:skill      # → dist/dsh-dba-skill-0.1.0.tgz
npm run pack:mcp        # → dist/dsh-dba-mcp-0.1.0.tgz
npm run pack:tool       # → dist/dsh-dba-tool-0.1.0.tgz
```

## 安装到 dsh

三选一,按需装其中一个包(能力相同,别重复装):

```sh
dsh plugin --profile demo add ./dist/dsh-dba-skill-0.1.0.tgz   # 方式一:Skill
# dsh plugin --profile demo add ./dist/dsh-dba-mcp-0.1.0.tgz   # 方式二:MCP
# dsh plugin --profile demo add ./dist/dsh-dba-tool-0.1.0.tgz  # 方式三:Tool

dsh --profile demo --dump-config     # 校验:出现对应的 bundle 层
dsh --profile demo                   # 启动
```

## 设置数据库连接(三选一)

连接信息取值优先级:**config > `MYSQL_*` 环境变量 > 脚本默认值**。三种设置途径任选,
未设置的字段自动向下回落,互不冲突。

### 方式 3:外部 `--patch` 叠加(推荐,密码不入打包产物)

连接值与 bundle 解耦,最适合放密码等敏感信息。bundle 仍需先 `add`(负责模块解析),
`--patch` 只在启动时叠加一层配置:

```sh
# 1) 先装 bundle(一次)
dsh plugin --profile demo add ./dist/dsh-dba-tool-0.1.0.tgz

# 2) 启动时叠加外部连接配置
dsh --profile demo --patch ./conn.yml
```

`conn.yml`(`id` 需与包内 `cordis.patch.yml` 对齐:skill=`dba-skill`,tool=`dba-tool`,
mcp=`dba-mysql-mcp`):

```yaml
- insert:
    - id: dba-tool
      name: dsh-dba-tool
      config:
        host: 192.168.1.10
        port: 3306
        user: readonly
        password: 'xxxx'
        database: appdb
```

> 注意:`--patch` 仅贡献配置、不改变 loader 的模块解析路径(所以第 1 步不能省)。
> 同 id 的 `config` 是合并还是整体替换,建议用 `dsh --profile demo --patch ./conn.yml --dump-config` 实测确认。

### 方式 2:改包内 `config:` 块(连接值随包走)

编辑对应包的 `cordis.patch.yml` 里 `config:` 块(取消注释并填值),重新打包安装。
`cordis.patch.yml` 是 YAML 不参与编译,只有首次的 `apply(ctx, config)` 逻辑需 `npm run build` 一次;
之后调值可直接改已安装副本 `$DSH_HOME/profiles/node_modules/<bundle>/cordis.patch.yml` 并重启。

### 方式 1:环境变量(最简单)

```sh
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=root MYSQL_PASSWORD='' MYSQL_DATABASE=mysql
dsh --profile demo
```

