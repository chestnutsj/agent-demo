---
name: mysql-query
description: 查询 MySQL 数据库。需要查看数据库、表、数据或服务器状态时使用。
---

# MySQL 查询

用 Bash 工具运行本插件自带的脚本来执行一条 SQL(脚本绝对路径已由插件在加载时注入):

```sh
bash "{{QUERY_SH}}" "SELECT NOW();"
```

连接信息由插件配置(cordis `config:` 块)注入,未配置的字段回落到
`MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`
环境变量,再回落到脚本默认值。你无需关心具体连接参数,直接执行上面的命令即可。

优先使用只读语句(SELECT / SHOW)。执行修改类语句前先与用户确认。
