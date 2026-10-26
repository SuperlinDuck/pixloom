# 自动发布与 Caddy 网关

更新日期：2026-10-26。

已实现单机静态应用自动发布。发布固定的源码版本及构建产物，上线、回滚、下线均由独立 Worker 的统一任务队列执行。应用创建和源码构建不会自动上线。

## 实际架构

```text
本机工作台 / SSH 隧道 → Next.js 本机 API → SQLite 发布记录 → Worker
                                                         ├─ 暂存并校验产物
                                                         ├─ 浏览器加载检查
                                                         └─ 事务切换线上指针

访问者 → Caddy :443 → 发布网关 127.0.0.1:4180
                       ├─ Host → published_sites → 固定发布记录
                       └─ 只读静态资源 → 持久化发布目录

Caddy 申请证书 → 本机 allow-domain 查询 → 仅批准当前已发布项目的域名
```

网关只提供已发布应用的 GET/HEAD 资源，不转发工作台，不提供源码、任务、数据库或宿主目录。Next.js 允许本机和明确配置的工作台来源，并拒绝跨站管理请求；工作台可使用 SSH 隧道或受认证保护的 HTTPS 入口。现已支持按用户授权的邀请内测工作台，完整配置见 [VPS 部署](vps-deployment.md)。

相比此前的软链接草案，当前使用 SQLite 的 `published_sites.releaseId` 作为唯一线上指针。文件先持久化并验证，再以同一事务更新指针、发布记录及任务状态，无需协调软链接和数据库。Caddy 不保存逐项目路由，网关按 Host 查询数据库；新项目无需重载 Caddy。

## 本机启用

在 `.env.local` 增加：

```dotenv
PIXLOOM_PUBLISH_ENABLED=1
PIXLOOM_PUBLISH_DOMAIN=apps.localhost
PIXLOOM_GATEWAY_PORT=4180
```

重启 `pnpm dev`，会同时启动 Web、Worker、发布网关。打开项目“发布”页，点击“发布 vN”。默认地址为 `http://<6位短ID>.apps.localhost:4180`。支持 localhost 子域名的浏览器可直接访问；命令行测试应请求 `127.0.0.1:4180` 并设置对应 Host。

发布页显示线上版本、稳定地址、状态和错误；成功的历史记录可“回滚到此次发布”，也可下线。下线不删除版本和产物，可重新发布。草稿和未保存编辑不会带入发布；发布期间沿用项目操作互斥。

手工版本原本仅检查编译，发布时新增受限浏览器加载检查；不补做完整功能测试。AI 行为验证仍只覆盖原有断言。发布就绪表示产物已验证且本机网关已切换；外部 DNS、端口和证书需在 VPS 配置后验收。

对外地址默认随机生成 6 位小写字母/数字前缀，例如 `k7m2q9.apps.pixloom.io`。首次发布可直接编辑“发布地址”并点击“发布 vN”，无需单独保存地址。发布前会弹出确认框，提示仅发布所选版本快照，不包含草稿修改；确认后才提交发布。发布后展示灰色线上链接，右侧的“修改地址”和“下线应用”使用灰色图标加文字，窄屏自动换行。点击“修改地址”打开弹窗，点击“更新地址”仅切换当前线上地址，无需重建或重新发布；弹窗提示原地址将停止访问，校验和请求错误显示在输入框下。取消地址编辑会丢弃未提交的修改，更新成功后弹窗自动关闭。前缀支持 1–63 位字母、数字和连字符，首尾必须是字母或数字；自动转小写并去掉首尾空格。后缀由 `PIXLOOM_PUBLISH_DOMAIN` 决定，此处不绑定外部独立域名。

`project_public_ids` 持久化当前前缀，内部项目 UUID 不变。所有项目共用唯一前缀空间，尚未发布和已下线项目也保留前缀；数据库唯一约束、写事务及随机冲突重试保证不重名。修改成功后原前缀释放，旧地址停止访问。发布任务期间禁止修改，过期的编辑请求返回 409；发布时设置前缀和创建任务在同一事务内完成。发布、回滚、下线及重启保留当前设置的前缀，回滚不会恢复历史域名。

旧数据库启动时自动放宽原 6 位前缀约束，已有地址不变。旧项目首次读取发布地址时自动补齐映射；历史发布记录保留原地址，当前线上地址以 `published_sites.domain` 为准。原 `p-<去掉连字符的UUID>` 域名仍作为同项目系统别名访问当前线上版本，该前缀格式禁止用户注册，下线同时停用别名。此前保留任意项目前缀的 Whistle 动态规则仍可直接使用。

## pixloom.io / Hostinger / VPS

### DNS

在实际 DNS 托管商增加：

| 类型 | 名称     | 内容          |
| ---- | -------- | ------------- |
| A    | `*.apps` | VPS 公网 IPv4 |

这使 `<6位短ID>.apps.pixloom.io` 自动解析到 VPS。域名可继续在 Hostinger 注册和托管；若 Nameservers 指向其他服务商，应在那里配置。不需修改根域名、邮件记录或现有主站。未提供 IPv6 时，应移除该子域冲突的 AAAA 记录。

### 运行配置

Web、Worker、发布网关在同一台 VPS、同一份代码目录下运行，共用配置：

```dotenv
PIXLOOM_DATA_DIR=/srv/pixloom/data
PIXLOOM_PUBLISH_ENABLED=1
PIXLOOM_PUBLISH_DOMAIN=apps.pixloom.io
PIXLOOM_GATEWAY_PORT=4180
PIXLOOM_PUBLISH_DIR=/srv/pixloom/published
PIXLOOM_PUBLISH_PORT=443
```

将数据和发布目录授权给运行 Pixloom 的系统用户。生产构建后同时运行 `pnpm start`、`pnpm worker`、`pnpm gateway`，使用进程管理器保持运行。三个进程必须指向同一个本机 SQLite 数据目录，不支持多机共享 SQLite。

网关绑定 `127.0.0.1:4180`，Web 绑定 `127.0.0.1:3000`。公网只开放 Caddy 的 TCP 80/443；数据库、Docker Socket、4180、3000 和 Caddy 管理端口不对公网开放。模型密钥不进入应用产物或 Caddy 配置。

工作台通过 SSH 隧道管理，例如在个人电脑执行 `ssh -L 3000:127.0.0.1:3000 用户@VPS地址`，再打开本机工作台；若开放邀请内测，配置 HTTPS AUTH_URL、管理员和 Google OAuth 后，Caddy 生成器会增加工作台到 3000 的代理，详见 [VPS 部署](vps-deployment.md)。

### Caddy 一次性接入

安装 Caddy 后，在代码目录执行：

```sh
pnpm --silent gateway:config > /tmp/pixloom-Caddyfile
caddy validate --config /tmp/pixloom-Caddyfile --adapter caddyfile
```

将生成内容合并到现有 Caddy 配置并校验、重载。已有主站应保留原站点块；Caddyfile 只能有一个全局选项块，应合并 `on_demand_tls`。全新 VPS 可将生成文件安装为 `/etc/caddy/Caddyfile` 后启动服务。Caddy 证书数据目录需持久化。

生成配置包括：

- HTTPS 入口使用 `tls on_demand`，按实际项目域名申请独立证书。
- `ask http://127.0.0.1:4180/_pixloom/allow-domain` 只批准当前在线且匹配发布域的项目；未知、未发布、已下线项目不批准新证书。
- 公网 `/_pixloom` 及其子路径返回 404，不代理内部健康与证书授权端点。
- HTTP 仅将配置的项目域后缀跳转到 HTTPS，其他 Host 返回 404。
- 转发到本机发布网关并保留 Host，网关再次检查精确域名与项目资源归属。

这里使用 DNS 通配记录及按项目申请的独立证书，不申请通配符证书，因此不需 Hostinger DNS API 密钥。首次 HTTPS 访问可能等待签发。下线停止服务器提供内容，但浏览器已缓存的文件无法远程撤回。

参考：[Hostinger A 记录](https://www.hostinger.com/support/4468886-how-to-manage-a-records-at-hostinger/)、[Caddy On-Demand TLS](https://caddyserver.com/docs/automatic-https#on-demand-tls)、[ask 配置](https://caddyserver.com/docs/caddyfile/options#on-demand-tls)。

## 状态、存储和恢复

`releases` 固定记录 `versionId/artifactId/sourceHash/templateId`，不随之后重建版本预览而变化。回滚新建发布记录，复用原始产物，不切换开发版本、不覆盖草稿。状态为 queued、staging、verifying、published、unpublished、failed、cancelled；历史 published 表示该次成功，当前线上状态由指针决定。

```text
PIXLOOM_PUBLISH_DIR/
└── <projectId>/artifacts/<artifactId>/
    ├── manifest.json    身份、文件大小与 SHA-256
    └── site/            原始构建资源
```

暂存目录带 release/attempt ID，完成后原子重命名；已有产物只复用、不覆盖。读取检查路径、类型、大小和 hash，拒绝符号链接。应用中的 `manifest.json` 位于 `site/`，与平台清单分离。失败或取消的暂存内容不公开；恢复时清理没有有效 attempt 的遗留暂存目录。

根入口读取当前发布；`/api/previews/<artifactId>/...` 只读取该项目曾成功发布的资源。保留历史资源，避免更新后已打开页面的动态模块失效。主入口不缓存，带产物 ID 的资源可长期缓存。下线后全部入口和资源请求返回 404。

Worker 接管后保留发布 ID、分配新 attempt，重新加载与验证；取消或失去租约的旧 attempt 不能切换指针。网关重启读取持久指针。发布前校验网关与 Worker 的数据库身份、目录摘要、域名和公开端口。网关离线/配置不一致、产物缺失/损坏、浏览器检查失败均保留原指针并记录错误。

备份时停止写入进程，同时备份数据库目录（含 WAL）和发布目录。文件丢失时网关返回错误，不回退读取宿主目录。当前不自动回收历史产物，发布目录需要磁盘监控和备份；原源码与产物继续受项目预算限制，发布目录额外保存一份已发布资源。

发布应用使用独立源，允许同源存储和请求，默认 CSP 将资源及网络限制到当前项目；没有预览 iframe 的 opaque-origin sandbox。业务后端、数据库、上传文件、外部 API 白名单、自定义域名和多机发布仍待实现。`apps.pixloom.io` 与工作台子域仍属于同一站点，未来平台认证 Cookie 应使用 host-only 作用域。

## 验证

```sh
pnpm test
pnpm typecheck
PIXLOOM_CADDY_BIN=/可信路径/caddy pnpm publish:verify
```

集成脚本使用临时数据库、目录与自建 Docker 容器，先校验生产 Caddy 配置，再启动仅监听本机临时端口的真实 Caddy，通过 HTTP 验证浏览器交互、动态模块、更新与历史资源、错误版本拒绝上线、回滚、开发版本独立、网关重启、下线及内部端点隔离。需要 Docker、Chromium/Chrome 和 Caddy；不调用模型，不修改现有项目、DNS 或公网服务，不申请公网证书。

2026-10-25 本机验收通过：81 项回归测试（另 6 项浏览器专项默认跳过）、类型检查、格式检查及独立目录生产构建；真实 Caddy 2.11.7 + Docker + Chrome 的上述完整发布链路通过。另在隔离生产工作台与真实 Worker 中点击发布、历史版本发布、回滚和下线，验证站点可访问、草稿/开发版本不变，以及 768/360/320px 布局。尚未连接真实 VPS，DNS、外部 HTTPS 可达性及公网证书签发待部署时验收。

## Cloud 版本发布

Cloud 版本先为绑定的生产项目执行添加式 schema 迁移、RLS 和函数部署，平台拥有的项目同时配置应用邮件认证的返回地址；用户自有项目的 Auth 设置保持原样，需要自行将预览与发布地址加入允许列表。函数名称按内容 hash 固定，避免新版本覆盖旧版本函数。

暂存产物中的 `pixloom-cloud.json` 切换到生产环境，持久预览和版本导出仍使用开发配置。发布网关只允许连接版本固定的生产端点。生产加载检查不允许写请求；登录、CRUD 等交互在开发环境验收。线上指针只在产物验证通过后切换，失败保留上一发布。

远程迁移和函数部署发生在指针切换之前，不能与 SQLite 形成原子事务；失败/取消时已经完成的添加式后端变更可能保留。代码回滚不会还原业务数据，破坏性迁移不在自动发布范围。配置与验收见 [Cloud 文档](cloud.md)。
