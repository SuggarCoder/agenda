# Docker Compose 与 HTTPS 部署

在一台安装了 Docker Engine 和 Compose v2+ 的 Linux 服务器上执行。WSL Docker 也可用于构建及本地验证；正式签发证书需要公网能访问服务器的 80 端口。

## 首次部署

```sh
git clone https://github.com/SuggarCoder/agenda.git
cd agenda
cp deploy/.env.example .env
# 编辑 .env，填写 DOMAIN、LETSENCRYPT_EMAIL、POSTGRES_PASSWORD
docker compose up -d --build
docker compose logs -f migrate certbot nginx
```

已有本地开发 `.env` 时保留原内容，并追加 `deploy/.env.example` 中的部署变量。Compose 显式向后端传递容器数据库参数，不使用本地开发的 `DATABASE_URL`、`HOST`、`PORT` 或 `APP_ORIGIN`；生产来源自动设为 `https://${DOMAIN}`。

- `DOMAIN`：例如 `attendance.example.com`，不带协议、端口、路径或通配符。先将 DNS A 记录指向服务器公网 IPv4；若配置 AAAA，也必须能正确访问该服务器。
- `LETSENCRYPT_EMAIL`：用于注册 ACME 账号的有效邮箱。
- `POSTGRES_PASSWORD`：用 `openssl rand -hex 32` 生成。包含 `$`、`#` 等字符时，按示例使用单引号。密码会由程序进行 URL 编码。
- `POSTGRES_DB`、`POSTGRES_USER`：默认均为 `agenda`。
- `HTTP_PORT`、`HTTPS_PORT`：生产默认 80、443。服务器防火墙和云安全组需放行公网 TCP 80、443。非默认端口主要供本地验证使用；公开 HTTPS 地址和 HTTP-01 验证仍使用标准端口。

证书申请成功后 30 秒内启用 `https://你的域名`，HTTP 自动跳转 HTTPS。首次申请完成前，仅开放 ACME 验证与健康检查，其他 HTTP 请求返回 503。首次登录管理员为 `mkmAdmin` / `mkmAdmin`，上线后修改密码。

## 服务与持久化

| 服务       | 职责                                                   |
| ---------- | ------------------------------------------------------ |
| `postgres` | PostgreSQL 17；业务、登录会话、限流、审计的唯一事实源  |
| `migrate`  | 数据库健康后执行幂等迁移，成功后退出；失败阻止后端启动 |
| `backend`  | Fastify 生产构建；Argon2 原生依赖在 Linux 镜像内安装   |
| `frontend` | Nginx 托管 SolidJS 静态产物，支持 SPA 深层路径         |
| `nginx`    | 公网 80/443、TLS、ACME webroot 和前后端代理            |
| `certbot`  | 自动首次申请证书与定期续期                             |

只有网关映射宿主端口。PostgreSQL、前端及 API 在内部网络通信；Nginx 和 Certbot 另接可访问公网的网络。Nginx 覆盖转发头，API 仅信任直接代理这一跳，保留客户端 IP 用于数据库登录限流。

三个命名卷分别保存数据库 `postgres_data`、证书及 ACME 账号 `letsencrypt`、挑战文件 `acme_webroot`。Compose 使用独立数据库卷，不连接或重置本地 WSL 的现有 `local-postgres`。迁移只初始化新库或升级结构，不会重置管理员密码、删除现有业务数据。

## 自动续期与重载

Certbot 每 12 小时执行一次 `renew`，由 Certbot 根据证书续期窗口判断是否续期，不假定证书固定有效期。首次申请失败每 5 分钟重试；续期失败每小时重试并输出日志。Nginx 每 30 秒检查证书与私钥的内容摘要，发现更新后先 `nginx -t`，再平滑重载。运行中的请求由旧 worker 完成，不需要重启整个服务。

该方式采用 [Certbot webroot 和自动续期](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)，无需挂载 Docker socket，也无需宿主机 cron。端口 80 的 ACME 路径在启用 HTTPS 后仍保持可访问。

在正式域名配置完成后，用下面的命令验证续期。先暂停循环服务，避免同时占用 Certbot 的锁；测试只用 staging CA，不替换生产证书。

```sh
docker compose stop certbot
docker compose run --rm --no-deps --entrypoint certbot certbot renew --dry-run
docker compose up -d certbot
```

检查运行状态与证书：

```sh
docker compose ps -a
docker compose logs --tail=100 certbot nginx backend
docker compose exec nginx nginx -t
docker compose run --rm --no-deps --entrypoint certbot certbot certificates
```

Nginx 的 HTTP 健康检查用于首次签发的启动依赖，并不代表公网 HTTPS 证书已就绪；通过浏览器检查域名的 HTTPS 地址及 Certbot 日志确认首次签发结果。

## 更新与备份

```sh
git pull --ff-only
docker compose build
# 在切换版本前备份 PostgreSQL，然后先迁移，失败时不更新服务。
docker compose run --rm migrate
docker compose up -d
```

备份示例（备份文件保存到仓库外）：

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ../agenda-backup.dump
```

同时备份 `letsencrypt` 卷以保留私钥与账号。`docker compose down` 保留数据卷；`down -v` 会删除数据库和证书，正常更新不要使用。已有数据卷的数据库用户名/密码不会随 `.env` 自动变更，改密需先在 PostgreSQL 中完成，再同步配置并重建后端服务。

## 本地部署链路验证

```sh
sh scripts/smoke-compose.sh
```

该脚本在唯一命名的 Compose 测试项目中运行，使用随机密码、独立数据库卷、本地自签名证书和 18080/18443 端口；验证迁移、HTTP 引导、ACME 路径、HTTPS 前后端、登录 Cookie 和证书自动重载。不会调用 Let's Encrypt 或操作业务库。结束后自动清理它创建的测试容器及测试卷。需要 `docker`、`curl`、`openssl`，测试端口需空闲。

公开 CA 签发与真实续期必须在域名已解析且公网端口开放后验证。本地自签名测试只验证部署与重载机制，不能证明域名验证一定成功。
