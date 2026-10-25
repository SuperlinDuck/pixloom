# Pixloom Cloud 与自有 Supabase

更新日期：2026-10-25。

本文记录保留兼容的 v1 独立后端和 OAuth 自有模式。新应用默认使用已接入的共享资源池，配置和实际边界见 [共享池运行说明](cloud-shared.md)。下文的每应用两个 Supabase 项目仅适用于独立模式，不能用作共享池配置说明。

## 产品决策

工程实现由一个全栈 Engineer Agent 统一完成。按需加入研究、代码探索和审查助手，不默认拆分前端与后端编码 Agent。现有草稿、候选快照、不可变版本、任务预算及取消保护继续作为基础。

后端提供两种同等支持的模式：

- **Pixloom Cloud（默认）**：平台在自己的 Supabase 组织中分配项目，普通用户无需注册或连接 Supabase。需要平台管理员配置管理凭证、组织、地区和资源上限。
- **自有 Supabase（可选）**：用户通过 OAuth 授权，在有权限的项目中选择开发和生产资源。平台保存加密管理凭证，不要求把密钥粘贴到对话或生成源码中。

纯静态应用不创建云资源。请求需要持久数据或登录时，Engineer 可以启用已配置的默认 Cloud；用户也可在“云后端”面板明确启用。未配置平台资源时如实提示，不把内存数据当作云存储。

## 首版实现范围（代码已接入）

1. 两种模式共用项目绑定、状态、资源准备、公开配置、表结构及后端部署接口。
2. 内置模式通过 Supabase Management API 创建开发和生产项目；创建前持久化资源预留，错误或中断后先核对已有资源，防止重复创建。资源创建可能产生上游费用，受平台配置的项目上限限制。
3. 自有模式实现一次性 state、PKCE、浏览器绑定及加密 access/refresh token；选择两个不同且不与其他 Pixloom 项目重复绑定的 Supabase 项目。运行中的任务不能切换绑定。
4. Agent 使用结构化 schema 定义创建用户所属的数据表，平台生成添加式迁移与 RLS，禁止模型通过此工具执行任意管理 SQL。后端定义保存在源码快照中；开发数据与生产数据分离。
5. 提供平台生成的轻量客户端，支持应用用户登录、CRUD、存储与函数调用。公开配置与管理凭证分离，管理凭证不进入沙箱、模型上下文、日志、交付包或浏览器。
6. 预览与浏览器验证仅放行该版本绑定的开发后端 HTTPS 端点；静态应用保留无网络预览。构建容器仍无网络。应用登录以邮件/密码为首版范围，OAuth 应用登录后续增加。
7. 发布先准备生产 schema 和后端，再为独立发布产物注入生产公开配置；保留上一线上指针直至验证通过。版本恢复与代码回滚不会恢复业务数据。
8. 回归覆盖两种模式、OAuth、凭证加密与脱敏、重复创建/重启/取消、项目归属、迁移/RLS、预览网络、生产配置、失败保留和历史发布。

验收场景：创建带登录的待办应用，完成用户隔离、CRUD 与刷新后重新读取，再增加分类并发布；分别使用内置与自有模式验证。确定性上游夹具用于常规测试；真实上游验收需要可用平台配置或 OAuth 应用，不以模拟通过替代真实验收。

## 模块与数据

`src/lib/cloud/` 负责配置、加密、Supabase API、OAuth、项目绑定、资源状态、schema 与应用客户端。`/api/projects/:id/cloud` 提供工作台入口；`/api/cloud/supabase/*` 负责账号授权和项目发现。Worker 执行耗时的资源准备操作；Engineer 工具复用同一实现。

SQLite 继续保存 Pixloom 控制状态与源码。应用的用户和业务数据位于对应 Supabase 资源，不进入平台工作空间数据库。Cloud 绑定与公开端点随构建产物固定，禁止历史产物在项目切换后静默连接其他后端。

OAuth token 在服务端使用独立的 32 字节加密密钥保护；平台管理 token 由服务端环境配置提供。OAuth 授权范围可能覆盖用户组织内多个项目，Pixloom 的业务层只允许访问已选择资源。应用使用 publishable key 和用户令牌，权限由 grants 与 RLS 共同约束。

## 运维边界

- 默认模式的资源和费用由平台管理；自有模式的资源和费用由用户管理。
- 开发与生产使用不同项目；不自动复制生产业务数据到开发环境。同一应用的各源码版本共享开发数据库，历史预览不等于历史数据快照。
- 首版自动迁移支持新增受控表及列。删除、改类型、放宽权限和其他破坏性迁移不自动执行。
- 远程资源操作不能与 SQLite 事务形成原子提交。保留操作记录与不确定状态，恢复时先查询；取消不能保证撤回已经发出的远程请求。
- 下线只停止发布入口，不自动删除数据库、用户或文件。启用后不支持切换提供方或替换资源；预留与已创建资源不自动释放。
- 平台仍为本机单账号工作空间；这次集成不等于完成公开多租户控制面。

## 配置与使用

Web 与 Worker 共用以下服务端变量，示例见仓库根目录 `.env.example`：

| 配置                                                            | 用途                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `PIXLOOM_CLOUD_ENCRYPTION_KEY`                                  | 64 位十六进制（32 字节）加密密钥，可用 `openssl rand -hex 32` 生成；必须持久保存 |
| `PIXLOOM_SUPABASE_ACCESS_TOKEN`                                 | 平台组织的 Management API token，仅内置模式使用                                  |
| `PIXLOOM_SUPABASE_ORGANIZATION`                                 | 平台拥有的组织 slug                                                              |
| `PIXLOOM_SUPABASE_REGION`                                       | `apac`（默认）、`americas` 或 `emea`                                             |
| `PIXLOOM_CLOUD_MAX_PROJECTS`                                    | 本安装最多预留的托管项目数，默认 6；每个应用占用 2 个                            |
| `PIXLOOM_SUPABASE_CLIENT_ID` / `PIXLOOM_SUPABASE_CLIENT_SECRET` | 自有模式的 Supabase OAuth App 凭证                                               |
| `PIXLOOM_AUTH_URL`                                              | 工作台准确来源，用于 OAuth 回调与开发认证返回地址                                |

Supabase OAuth 回调为 `<PIXLOOM_AUTH_URL>/api/cloud/supabase/callback`。在 OAuth App 中配置项目读取、数据库读取/迁移写入、API key/secret 读取和 Edge Functions 写入等实际需要的权限；账号授权后仍需在 Pixloom 选择开发与生产项目。OAuth scope 可能覆盖整个所选组织，不能把本地项目选择器当作上游授权范围。

项目“云后端”页显示模式、准备状态和资源。内置模式无需终端用户连接账号；自有模式提供授权与项目选择。资源未就绪时可继续准备；明确被上游拒绝的创建请求允许重试，网络超时或未确认响应只先查询已创建资源，不盲目重发。

平台配置有效后，Engineer 可按需求调用 `cloud_enable`。schema 示例：

```json
{
  "tables": [
    { "name": "todos", "columns": [{ "name": "title", "type": "text" }] }
  ],
  "buckets": ["uploads"]
}
```

保存为 `src/pixloom-schema.json`。表自动包含 `id`、`owner_id`、`created_at`，可定义 text/integer/numeric/boolean/timestamptz/jsonb 列；用户私有数据通过 grants 与 RLS 控制。`buckets` 可省略，提供私有、按用户目录隔离的文件存储。`src/pixloom-cloud.js` 提供登录、CRUD、文件上传下载和函数调用，不额外安装 npm 依赖。

服务端函数为 `src/backend/functions/<name>.js`，导出默认异步 handler，接收 `(request, context)`，返回 Response 或 JSON；平台包装层先校验应用用户身份，首版只接受经过认证的 POST 请求。调用使用 `cloud.invoke(name, body)`。函数名按内容 hash 固定，旧版本不会被新函数覆盖。通用公网 webhook 和任意服务器进程不在首版范围。

注册默认需要邮件确认。平台拥有的项目自动设置开发返回地址，发布时设置生产地址；用户自有项目不自动更改 Auth 配置，需自行将 `<工作台来源>/api/previews/**` 和实际发布站点加入 Auth 的允许返回地址。预览处于 opaque-origin iframe，登录会话可能只能保存在内存，刷新后需重新登录；数据库记录不会因此清空。

`cloud_test_account` 在开发环境创建临时已确认账号供浏览器验收；测试凭证只进入该次模型工具上下文，不写源码或日志/回复。结束后删除账号及其测试数据，上传文件通过 Storage API 清理；失败保留清理记录并在面板提示，Worker 启动时重试。它不创建生产测试用户，不使用真实用户登录信息。

## 验证与当前限制

```sh
pnpm test                  # 确定性 API/流程回归，默认不启动浏览器或 Docker
pnpm cloud:verify          # 两种模式的真实浏览器客户端；上游使用夹具
pnpm cloud:verify-runtime  # 两种模式的 Engineer 工具循环 + 真实 Docker/Vite/浏览器
pnpm cloud:verify-db       # 独立 PostgreSQL 17 容器：实际执行迁移与权限验证
pnpm typecheck
pnpm build
```

PostgreSQL 验证用最小 Auth/Storage 表结构模拟 Supabase 的数据库契约，校验实际 SQL、伪造 owner 拒绝、既有宽松存储策略下的用户隔离、增量迁移保留数据和旧代码回滚不删列。它不替代托管 Supabase 的整体服务验收。

2026-10-25 本机验收：完整回归 135 项通过（包含两种模式的 Docker/Vite/浏览器生成、错误 schema 反馈修复与临时账号清理）；另通过实际 PostgreSQL 迁移/RLS/存储权限验证、桌面与 360px 窄屏面板检查、静态 Agent 两轮生成及独立 ZIP 交付回归。生产构建、类型与格式检查通过。

本次没有配置真实 Supabase 管理凭证或 OAuth App，因此真实资源创建、人工 OAuth 同意、上游邮件送达和 Edge Function 云端执行仍待配置后验收。常规验收不调用真实模型，也不创建计费云资源。独立构建可设置 `PIXLOOM_NEXT_DIST_DIR=.next-cloud-verify`，使用项目内专用目录，避免覆盖正在开发的 `.next`；验收后移除 Next 自动添加的临时 TypeScript include 项。

## 后续阶段

资源用量与套餐计费、备份恢复面板、自有资源迁出、应用 Google 登录、独立域开发预览/HMR、通用 Node 服务部署、只读子 Agent 与产品角色协作。按真实使用反馈逐步增加。

## 官方依据

- [Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms)：平台组织下的资源分配与管理。
- [Supabase OAuth Integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)：用户自有资源授权。
- [API keys](https://supabase.com/docs/guides/getting-started/api-keys)：公开与服务端密钥边界。
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)：应用数据授权。
- [Atoms Agent 工作方式](https://help.atoms.dev/en/articles/12129548-working-with-agents)、[Lovable 子 Agent](https://lovable.dev/blog/subagents-in-lovable)：工程角色与辅助协作依据，不能推断为已公开完整内部架构。
