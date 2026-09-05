# 青禾 · 学员考勤系统

基于 SolidJS、Vite、TypeScript、UnoCSS、Fastify、Zod、Kysely 和 PostgreSQL 的学员考勤系统。PostgreSQL 是唯一业务事实源；登录会话、考勤和审计均落库，不依赖 Redis。

## 本地启动

需要 Node.js 22.12+、pnpm 10，以及安装了 `btree_gist` 的 PostgreSQL 17。项目使用 WSL Docker 中的 PostgreSQL，Windows 通过映射端口直接连接。

```powershell
pnpm.cmd install
Copy-Item .env.example .env
# 在 .env 中填写数据库密码
pnpm.cmd db:migrate
pnpm.cmd dev
```

已有配置好的 `.env` 时，不要用示例覆盖它。访问 **http://localhost:5173**；API 监听 `127.0.0.1:3000`，Vite 代理 `/api`。必须使用与 `APP_ORIGIN` 一致的网址，写操作会校验浏览器请求来源。

当前开发连接：数据库 `agenda`，用户 `app_user`，主机 `127.0.0.1`，端口 `5432`。对应 WSL Debian 中的 `local-postgres` 容器。密码仅配置在忽略提交的 `.env` 中。

| 账号             | 初始密码    | 说明                                             |
| ---------------- | ----------- | ------------------------------------------------ |
| `mkmAdmin`       | `mkmAdmin`  | 唯一管理员；可修改密码，不能删除、禁用或更改身份 |
| 管理员创建的教师 | `Admin@123` | 第一次登录必须修改密码                           |

初始化只创建管理员，不插入演示校区、教师或学员。重复执行迁移不会重置管理员密码。

### 重置开发数据库

```powershell
pnpm.cmd db:reset
```

该命令会**删除 `agenda` 中现有的全部 public 业务表、业务函数、业务枚举与迁移记录，然后初始化新结构**。它校验连接目标和服务器返回的数据库名称都为 `agenda`，保留数据库本身及扩展所属对象。正常启动、迁移和测试都不会触发这个命令。

## 使用流程

1. 管理员依次创建校区、课程、教师账号和学员档案。
2. 创建班级，选择课程和校区；进入班级详情，分别分配班主任、任课老师，添加学员。
3. 创建考勤时段，填写北京时间的起止时间。名单按照**上课开始时**有效的分班关系计算。
4. 教师第一次登录修改密码，然后重新登录；管理员和教师均需等到下课后才能进入考勤处理。
5. 在考勤页逐人点击“出勤”或“缺勤”即时保存。已保存的状态可以更正；版本冲突时先刷新，核实后再提交。
6. 在报表页按日期、校区、课程、班级查询汇总和明细，导出 CSV；在每周预警页查看本周尚未出勤的学员。

分班变更从当前数据库时间生效，退班保留历史。新加入的学员不会被追加到过去已经开始的时段中。已有考勤的时段锁定时间和所属班级；已有排课的班级锁定所属校区、课程。

教师账号通过禁用停用；校区、课程、班级和学员通过归档停用。归档学员会结束其当前分班；归档班级前须先处理未结束的排课。归档校区、课程前须先归档下属班级。历史数据保留，已结束时段仍可由具备权限的人补录和更正。

## 业务口径与数据保证

- 应到名单使用 `class_enrollments` 的 `[joined_at, left_at)` 历史区间；同一学员可同时在多个班级就读。
- 考勤状态只有 `present` 和 `absent`。未录入表示没有记录，不是第三种数据库考勤状态，也不会默认计作缺勤。
- 时段采用 `[starts_at, ends_at)`。同一学员在**不同班级**的重叠时段不能同时出勤，首尾相接允许。同班时段重叠不额外禁止。
- `btree_gist` 排斥约束在数据库层保证跨班冲突规则，并覆盖并发提交。数据库触发器填充考勤所属班级、区间及操作者。
- 录入权限以当前账号状态、当前班级教师关联和数据库 `now()` 判断。班级教师变更后，旧教师立即失去该班级的查询与操作权限。
- 每次考勤写入在事务中锁定时段、校验版本并生成审计；失败事务不留下考勤或审计。相同版本重复提交相同状态不产生额外日志。
- 审计记录包含操作者姓名快照、学员姓名快照、前后状态、版本和时间。数据库拒绝对审计执行 UPDATE、DELETE 和 TRUNCATE；应用不提供这些接口。
- 报表仅统计已结束时段，按开始时间所属的北京时间日期归属；出勤率为实到人次／应到人次。应到为零时显示“—”。汇总中的人数按学员去重，人次按学员与时段计算。
- 周预警为**当前自然周**，北京时间周一零点到下周一零点。出勤按上课开始时间归周，补录时间不影响归属。
- 当前未归档学员在任意班级当周出现一次 `present`，即解除所有校区的周预警。校区及教师权限只筛选候选名单；其他校区的具体班级、教师和考勤明细不会因此暴露。
- 未分班学员进入管理员的全部校区周预警名单，不进入教师或单校区名单。周预警实时查询，不单独存表。

## 项目结构

```text
apps/api/src/
  db/               数据库类型、迁移、约束与触发器
  auth.ts           会话认证、改密、数据库登录限流
  catalog.ts        基础资料、分班与教师分配
  attendance.ts     考勤时段与逐人考勤
  reports.ts        汇总、明细、周预警、CSV 和审计查询
apps/web/src/       中文前端、桌面与手机布局
packages/shared/   Zod 输入契约及共享业务类型
scripts/           数据库管理与测试服务
tests/             数据库集成测试、Playwright 浏览器测试
```

## 验证

测试连接与开发库分离。`TEST_DATABASE_URL` 的数据库名称必须以 `agenda_test_` 开头，当前使用 `agenda_test_qinghe`。已有同名数据库必须属于此项目；迁移遇到未知旧迁移会停止，不会自动清空。

```powershell
pnpm.cmd db:test:prepare
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd browser:install
pnpm.cmd test:e2e
pnpm.cmd format:check
```

测试库初始化账号使用默认管理员密码。集成测试通过独立命名的测试资料验证权限、并发冲突、时间边界、历史关系、审计及报表；测试数据保留在测试库，便于排查，不清理开发库。

浏览器安装到项目的 `.cache/ms-playwright` 中。E2E 启动仅连接测试库的独立服务 `127.0.0.1:4173`，使用已构建的前端，验证完整业务流程及手机布局。浏览器测试会在测试库中将新建且尚无考勤的时段调整为已结束，以模拟下课，不修改分班历史。更新前端后需重新 `pnpm.cmd build` 再运行 E2E。

HTML 测试报告位于 `playwright-report/`，失败追踪与截图位于 `test-results/`。

## 构建与运行

服务器部署使用根目录 [compose.yaml](compose.yaml)，包含 PostgreSQL、迁移、前后端、Nginx 和 Let's Encrypt 自动申请／续期。域名从 `.env` 读取，配置步骤和备份命令见 [Docker 部署说明](docs/deployment.md)。

本地检查生产构建：

```powershell
pnpm.cmd build
$env:APP_ORIGIN='http://localhost:3000'
pnpm.cmd start
```

访问 **http://localhost:3000**。Fastify 同时提供构建后的前端、SPA 深层路由和 API。

正式部署时配置 `NODE_ENV=production`、`APP_ORIGIN=https://你的域名`、数据库连接，并在 HTTPS 反向代理后运行。生产模式的会话 Cookie 启用 Secure。服务器需要安装工作区依赖、保留 `apps/web/dist` 和后端构建产物；发布前执行数据库迁移。

健康检查为 `GET /api/health`；Fastify 输出 JSON 请求日志及服务端错误，认证 Cookie 不记录。会话固定有效期 12 小时；改密、管理员重置密码或禁用账号会撤销旧会话。密码使用 Argon2id；登录尝试计数和过期时间保存在 PostgreSQL。

## API

接口契约、查询参数和错误码见 [docs/api.md](docs/api.md)。所有写接口使用 JSON，必须携带与 `APP_ORIGIN` 完全一致的 `Origin` 请求头。会话通过 `agenda_session` Cookie 传递；请求体不接受操作者或角色伪造字段。
