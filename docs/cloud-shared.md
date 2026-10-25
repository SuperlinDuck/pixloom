# Pixloom Cloud：共享 Supabase 资源池

默认 Cloud 已改为共享池。管理员预先配置最多两个 Supabase 项目：开发池和生产池。多个应用复用物理项目，每个应用环境拥有独立 PostgreSQL schema、登录角色、成员授权、记录与文件额度。共享池不会调用 Supabase Management API 创建项目或自动升级套餐。

创建静态应用不分配后端；`cloud_enable` 仅分配开发环境；首次发布才在生产池分配环境。相同应用后续修改、构建和发布复用原环境，添加式迁移保留业务数据。已有 v1 独立绑定和用户 OAuth 自有后端继续使用原资源，不能原地切换或合并。

## 配置

1. 在 Supabase 预先创建一个专用开发项目、一个专用生产项目。两个项目必须不同；开发时可以暂不配置生产池。已有空项目可以用作池，已经绑定独立应用的项目不能复用为池。
2. 在每个项目的 **Connect** 中复制 **Direct connection** 或 **Session pooler** 的 PostgreSQL 连接字符串，填入创建项目时的 Database password。密码中的特殊字符需要 URL 编码。IPv4 VPS 通常使用 Session pooler，端口 5432；不使用 Transaction pooler 的 6543 端口。数据库管理用户需要创建 schema/表/登录角色的权限。
3. 在项目的 **Settings → API Keys** 读取 publishable key 和 secret key；也支持已有的 anon / service_role key。它们只保存在平台服务端。
4. 将以下配置写入 `.env.local`；Web、Worker、独立网关共用同一个数据目录、加密密钥和池配置：

```dotenv
PIXLOOM_CLOUD_ENCRYPTION_KEY=<保留原有64位十六进制密钥>
PIXLOOM_CLOUD_RUNTIME_URL=http://127.0.0.1:4180
PIXLOOM_CLOUD_DEV_PROJECT_REF=<开发项目ref>
PIXLOOM_CLOUD_DEV_DATABASE_URL=<开发池PostgreSQL连接字符串>
PIXLOOM_CLOUD_DEV_PUBLISHABLE_KEY=<开发池publishable或anon key>
PIXLOOM_CLOUD_DEV_SECRET_KEY=<开发池secret或service_role key>
PIXLOOM_CLOUD_PROD_PROJECT_REF=<生产项目ref>
PIXLOOM_CLOUD_PROD_DATABASE_URL=<生产池PostgreSQL连接字符串>
PIXLOOM_CLOUD_PROD_PUBLISHABLE_KEY=<生产池publishable或anon key>
PIXLOOM_CLOUD_PROD_SECRET_KEY=<生产池secret或service_role key>
PIXLOOM_CLOUD_MAX_APPS=30
PIXLOOM_CLOUD_LEGACY_PROVISIONING=0
```

项目 ref 是 Dashboard 地址 `/dashboard/project/<ref>` 中的字符串。共享模式不需要 `PIXLOOM_SUPABASE_ACCESS_TOKEN`、组织标识和 `PIXLOOM_CLOUD_MAX_PROJECTS`；这些旧配置仅用于兼容独立托管资源。

重启 `pnpm dev`，在应用「云后端」启用 Pixloom Cloud，或让 Engineer 生成需要登录/持久化的应用。网关随 `pnpm dev` 启动；生产分别运行 Web、Worker 和 `pnpm gateway`。池初始化、应用角色和受控结构由 Worker 按需创建，失败后使用相同环境 ID 重试，不新建物理项目。

## VPS 网关

将 `PIXLOOM_CLOUD_RUNTIME_URL` 配置为独立 HTTPS 来源，例如 `https://cloud.pixloom.io`，DNS 指向 VPS。现有 Caddy 配置会为该主机允许签发证书并转发到网关。先运行 `pnpm gateway:config` 查看配置；只有 `/cloud/v2/...` 提供应用业务 API，工作台管理 API 不在此网关。

本机运行允许 `http://127.0.0.1:<端口>` 或 `http://localhost:<端口>`。HTTPS 工作台和公网发布应使用 HTTPS 网关，不能使用客户端无法访问的 VPS 回环地址。修改网关来源后需重新构建应用；旧导出或历史产物仍依赖其固定的网关地址。

## 身份与权限

- 同一池共用一套 Supabase Auth 账号体系，界面说明“使用 Pixloom Cloud 账号登录”。应用成员和数据权限分别维护，开发池与生产池账号体系相互独立。
- 用户在新应用输入正确邮箱/密码登录后才加入该应用；注册请求不会仅凭邮箱创建成员关系。默认需邮件验证；验证完成后返回原应用登录，也可使用 `cloud.verifyOtp(email,token)` 验证邮件验证码。邮件模板、发送额度和 SMTP 在 Supabase 池项目中统一配置。
- 网关返回仅用于当前应用、环境和绑定代次的随机会话；Supabase access/refresh token 加密保存在平台 SQLite，不发送给应用。新版客户端通过可信预览入口或发布站点固定保持登录 7 天，从登录成功时计算，不因使用或续期顺延。刷新和正常重开浏览器自动恢复；退出立即撤销当前浏览器、当前应用环境的会话及全部短期访问凭证，其他应用、环境和设备不受影响。旧客户端保留原一小时内存会话行为。
- 数据经有限 Gateway 操作进入数据库。每个应用使用独立非 owner 登录角色，没有创建表、绕过 RLS、读取私有成员表或访问其他应用 schema 的权限。事务设置可信用户上下文，强制 owner RLS；提交/回滚清除上下文。
- schema 不加入 Supabase Data API 的 exposed schemas，PUBLIC/anon/authenticated 不具备访问权限。不要手工对应用 schema 授予公开权限。
- 文件位于私有 `pixloom-cloud-v2` 桶，实际路径包含完整环境 ID、用户 ID 和逻辑桶名。下载经网关授权，客户端不能自行指定其他环境或用户的对象键。
- 共享池暂不支持自定义服务端函数。相关源码或 `cloud.invoke` 会明确报错；需要此能力时，为新应用选择独立自有后端。

持久登录由平台的 host-only HttpOnly Cookie 恢复；HTTPS 使用 Secure，SameSite=Lax，最长 604800 秒，与工作台 Google 登录分开。应用只获得 5 分钟访问凭证，网关逐次核对持久会话和成员权限。Supabase refresh token 由服务端通过 SQLite 租约串行轮换，网络故障不清除登录；确认的认证失效会撤销会话。退出与恢复/登录并发时通过会话撤销和版本检查防止会话复活。

工作台 iframe 和 `/preview/:artifactId` 可信外层页面通过绑定窗口、随机通道标识和 MessageChannel 提供有限认证操作。沙箱保持 `allow-scripts`，opaque frame 不直接使用平台 Cookie。发布网关在应用自己的域名提供 `/__pixloom/auth/*` 同源认证入口，不依赖第三方 Cookie。Cloud 配置中的 `authMode: persistent-v1` 启用新客户端逻辑。

退出遇到断网时，本地只记录不含凭证的待退出标记；重连先执行撤销，再允许恢复，服务端确认前不报告退出成功。浏览器阻止本地存储时无法保证跨浏览器重启保存离线标记，应在联网时完成退出。

迁移仅增加平台 SQLite 会话表，不改变应用数据库。已有应用需要通过 `cloud_enable` 更新平台客户端后构建新版本，已有产物保持不可变。原始 `/api/previews/.../index.html` 直接打开时不提供持久登录，独立预览改用 `/preview/:artifactId`。

应用侧继续使用 `cloud.signUp/signIn/signOut/getUser/select/insert/update/remove/upload/download`。查询支持 `select`、单字段 `order`、`limit`、`offset`，以及字段上的 `eq/neq/gt/gte/lt/lte/is.null` 过滤；不接受任意 SQL 或 PostgREST 表达式。新增 `cloud.removeFile`。浏览器预览仅放行绑定应用环境的 Cloud 路径。

## 配额与容量

默认每池最多 30 个应用环境；每应用环境最多 10,000 条记录、10 MiB 逻辑记录字节、10 MiB 文件、500 个文件及 1,000 个成员。单记录最多 64 KiB，单文件最多 2 MiB，查询单页最多 200 条且响应最多 2 MiB。

`PIXLOOM_CLOUD_MAX_APPS` 是平台预留上限，不是免费套餐保证支持的应用数量。实际物理空间、索引、CPU、Auth/邮件和出站用量仍受 Supabase 套餐限制。记录数/逻辑字节通过数据库触发器原子核销；文件在外部操作前预留额度，不确定结果保留预留，可重试相同路径或删除。

默认池容量预算为 500 MiB。达到 70% 时容量检查给出预警，85% 时拒绝新环境、扩展结构和写入；删除仍可进行。此预算按整个 PostgreSQL 数据库计算，包含平台开销，不能等同账单用量。Pro 用户可根据实际磁盘预算调整 `PIXLOOM_CLOUD_POOL_MAX_BYTES`，不自动扩容。连接数、每应用每分钟请求数可配置；每应用最多四个并发请求，认证每来源每分钟最多十次。网关不信任客户端转发的 IP，反向代理场景会保守共用上游地址限流。

每应用的行/字节/文件额度在环境创建时固定，环境注册表保存在池内；修改 `.env` 不会静默改写已有环境额度。需要调整时由管理员核对使用量后更新注册表。`cloud:pool doctor` 可检查整个池容量：

```sh
pnpm cloud:pool doctor <应用ID> development
```

## 应用备份、恢复与删除

先确保该应用没有运行任务。导出包括后端定义、记录、成员 ID 和文件内容/校验值，不包含密码、会话、池密钥或共享身份的凭证。备份文件包含真实业务数据，以 0600 权限创建且不会覆盖已有文件，须妥善保存：

```sh
pnpm cloud:pool export <应用ID> development /绝对路径/app-backup.json
pnpm cloud:pool restore <尚未启用后端的新应用ID> development /绝对路径/app-backup.json
```

恢复创建全新空间，只允许原身份池和相同环境，不覆盖原应用，不自动复制开发数据到生产。恢复后原用户可登录新应用读取数据；代码和版本仍需单独恢复/导入并构建。恢复失败时新环境保持禁用，原环境保留；可核对后删除失败目标。此首版不自动切换旧应用的绑定，也不提供跨池身份迁移。

删除先运行下面命令查看待确认的应用环境 ID，再用输出的确切 ID 确认。删除不可恢复，仅清理该环境 schema/角色、成员关系、会话和文件，保留共享 Supabase 项目与其他应用、共享身份：

```sh
pnpm cloud:pool delete <应用ID> development
pnpm cloud:pool delete <应用ID> development --confirm <环境ID>
```

SQLite 工作空间和加密密钥仍需另行备份。单应用备份不是池整体备份的替代；真实上线前需在自己的 Supabase 项目完成独立恢复演练。

## 验证

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm cloud:verify-shared
```

共享验收启动独立 PostgreSQL 17 容器、真实 Docker/Vite 构建和 Chromium；模型、Supabase Auth/Storage 使用确定性夹具，不调用真实 Supabase 或付费模型。覆盖同名表隔离、真实登录角色、owner RLS、应用成员/会话边界、开发/生产隔离、并发额度、文件与未确认操作、临时身份清理、添加式迁移、恢复/删除、两应用生成发布及失败保留。真实 Supabase Session pooler/邮件/Storage 和 VPS HTTPS 仍需使用实际凭证验收。
