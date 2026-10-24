# Pixloom

本地 React/Vite 多文件工作空间：编辑源码、构建预览、查看差异并恢复历史版本。当前为 **v0.3 本地单用户原型**，已接入 Gemini / GPT Coding Agent 工具循环。

## 启动

需要 Node.js 22.13+（推荐 Node.js 24）、pnpm、Docker Desktop。

```sh
pnpm install
cp .env.example .env.local
pnpm sandbox:prepare
pnpm browser:install
pnpm dev
```

打开 http://127.0.0.1:3000 。`pnpm dev` 同时启动 Web 与独立 Worker。无需模型 Key 即可使用模板、源码编辑和版本管理；使用 AI 生成需配置 Gemini 或 GPT 密钥，并重启 Web 与 Worker。

首页直接描述应用需求并发送，后台自动创建项目并启动 AI 生成；无需先命名或构建空模板。项目名称从首条需求截取，可在顶部修改。首次生成通过构建与行为验证后保存为 v1。

也可以从首页的“创建空白项目”进入源码编辑。此入口会让 Worker 构建固定模板并保存 v1；Worker 离线时仅保存模板草稿，准备好环境后可手动构建。

## Google 登录

侧边栏底部提供“使用 Google 登录”；登录后显示头像、姓名、邮箱和退出按钮。使用 Google 官方认证库验证登录信息，登录凭证保存在 HttpOnly Cookie，会话七天到期，退出后立即撤销服务端会话。

1. 在 [Google Cloud Console](https://console.cloud.google.com/auth/clients) 创建 **Web 应用**类型的 OAuth 客户端，配置授权同意屏幕；应用处于测试状态时，添加自己的邮箱作为测试用户。
2. 添加授权重定向 URI：`http://127.0.0.1:3000/api/auth/callback/google`。
3. 在 `.env.local` 填写 `PIXLOOM_GOOGLE_CLIENT_ID`、`PIXLOOM_GOOGLE_CLIENT_SECRET` 和 `PIXLOOM_AUTH_URL=http://127.0.0.1:3000`，重启 Web。使用其他本机地址或端口时，同步修改应用地址及 Google 回调地址；不要混用 `localhost` 与 `127.0.0.1`。使用 Whistle 代理 `https://pixloom.io` 时，`PIXLOOM_AUTH_URL` 只填 `https://pixloom.io`，Google 回调填写 `https://pixloom.io/api/auth/callback/google`；不要把回调路径填入 `PIXLOOM_AUTH_URL`，也不要混用带 `www` 和不带 `www` 的域名。

首次成功登录的 Google 账号绑定整个现有工作空间，后续其他账号不能登录。这里仍是本机单工作空间，不提供多用户租户隔离。完全未配置凭证时沿用本机访客模式；填写任意凭证后，项目、源码、任务、版本、导出和发布操作都要求登录，配置不完整时拒绝访问。不可变预览资源仍可通过随机产物 ID 读取，以兼容隔离 iframe；预览链接不应视作私有资源。工作台允许本机 Host 和 `PIXLOOM_AUTH_URL` 明确配置的来源，支持 Whistle 在 HTTPS 域名与本机 HTTP 服务之间转发；仍不能直接作为公网多用户平台部署。

认证流程遵循 [Google OpenID Connect 服务端流程](https://developers.google.com/identity/openid-connect/openid-connect)，校验一次性 state、PKCE、nonce、签名、受众和到期时间，仅请求姓名、邮箱和头像，不保存 Google access token / refresh token。

## 工作流程

1. 在源码页选择文件并编辑，支持新增、删除和重命名。多个文件的修改可一起保存。
2. **保存草稿**持久化源码，不产生版本。未保存编辑只在当前页面，离开时会提示。
3. **构建并保存版本**先保存编辑，再执行固定 Vite 构建。通过后创建不可变源码快照及预览；失败时保留错误草稿和上一可用版本。
4. 在**差异**页查看草稿与当前版本，或历史版本与其父版本/当前版本的逐行差异。
5. 打开**版本历史**查看快照；查看历史不会切换当前版本。
6. **恢复为新版本**会保留历史并创建新的版本。例如恢复 v1 得到 v3，后续修改基于 v3。被覆盖的已保存草稿在历史面板的备份区可找回。
7. **环境**页管理容器。停止、移除容器不会删除源码、版本及已保存的预览。
8. 右上角**导出交付包**下载当前查看版本的 ZIP，包含源码、独立静态站点、版本清单及运行说明。查看历史时导出该历史版本，不包含草稿修改；无需 Worker 或容器在线。详见 [交付链路](docs/delivery.md)。
9. **发布**页支持上线指定版本、回滚历史发布及下线。Worker 校验持久化产物后切换线上指针，独立网关按项目域名提供站点，Caddy 负责公网 HTTPS。配置见 [自动发布](docs/publishing.md)。

版本预览绑定持久化构建产物，不受下一次构建失败影响。可以重新构建某个版本的预览，不增加源码版本；要求模板镜像摘要与该版本一致。历史版本恢复可直接复用其原有产物，不必调用模型或重新构建。

## 云后端：两种模式

项目的“云后端”页默认选择 **Pixloom Cloud**：平台按需分配开发与生产两个 Supabase 项目，普通用户无需连接 Supabase。也可选择 **自有 Supabase**，通过 OAuth 授权后绑定两个不同的项目。纯静态应用不会分配云资源；尚未配置时显示明确提示。

平台管理员按 `.env.example` 配置 `PIXLOOM_CLOUD_ENCRYPTION_KEY`（`openssl rand -hex 32`）、`PIXLOOM_SUPABASE_ACCESS_TOKEN`、`PIXLOOM_SUPABASE_ORGANIZATION` 和资源上限；自有模式另需 `PIXLOOM_SUPABASE_CLIENT_ID` 与 `PIXLOOM_SUPABASE_CLIENT_SECRET`，OAuth 回调为 `<工作台来源>/api/cloud/supabase/callback`。Web 与 Worker 使用相同配置。配置平台管理凭证即允许 Agent 在需求需要时、或用户明确启用时分配资源，可能产生 Supabase 费用；每个应用占用两个项目，受 `PIXLOOM_CLOUD_MAX_PROJECTS` 限制。

一个 Engineer 统一生成前端与后端定义。`cloud_enable` 安装应用客户端，`src/pixloom-schema.json` 定义用户所属数据表和私有存储桶，`src/backend/functions/<name>.js` 定义经过登录校验的服务端函数。构建自动部署开发结构与函数，发布部署生产结构与函数。迁移仅增加表/列，RLS 隔离用户数据；不自动删除数据或回滚数据库。

浏览器只连接该版本绑定的后端。受限预览中的登录会话可能仅保留在内存，刷新后需要重新登录，但已保存的数据库记录仍存在。注册默认要求邮件确认；Agent 可创建临时开发测试账号验证登录后操作，结束时清理，日志脱敏。管理凭证不会发给模型或进入源码。详情、OAuth 权限、真实验收边界见 [Cloud 文档](docs/cloud.md)。

## AI 生成与继续修改

首页选择模型并输入“创建待办应用”，发送后进入对话与预览；完成后可继续输入“增加分类筛选”。对话显示完整需求和完成说明，执行详情默认折叠。每次请求基于已保存草稿与当前版本；提交前会先保存本页源码编辑。历史浏览模式下不能发起生成。模型未配置或 Worker 离线时会保留输入并提示，不创建空项目。

Agent 可以列出、读取和搜索候选源码，完整写入、精确编辑或删除文件，运行固定构建并读取错误。每次成功构建后自动检查预览加载、页面异常与控制台错误；Agent 还必须通过 `browser_test` 操作和断言所请求功能，才能创建 AI 版本。浏览器失败会反馈给 Agent 修复，源码变化后须重新验证。失败或取消时保留原草稿、版本和预览，候选源码保存在任务中，可点击“载入候选源码”检查、保存并继续修改。

每个任务最多 24 次模型请求、80 次工具调用、48,000 输出 tokens（包含模型报告的推理用量），单次最多 24,000 tokens、累计 1 MiB 模型响应、5 分钟总执行时间，以及三次失败构建和三次失败浏览器验证（各两轮修复）。步骤、用量、候选源码、失败计数与开始时间持久化；重启从候选源码开始新模型会话，沿用剩余预算。被中断的在途请求保留输出预算预留，避免重启绕过上限。用量以模型实际返回为准，不是账单核对。

受限预览禁用原生表单提交与同源存储。生成指令要求通过 `type="button"` / `onClick` 处理应用操作，并在 localStorage 不可用时回退内存；纯前端内存数据不保证刷新后保留；已连接 Cloud 的业务数据由数据库持久保存。

平台密钥仅用于服务端模型请求，**候选源码和需求会发往所选模型服务，可能产生费用**；容器内没有密钥、网络和任意 Shell 工具。Gemini Developer / Vertex Express 共用函数协议；GPT 使用 Responses API，第三方兼容地址必须支持函数调用与 Responses 格式。

```sh
pnpm agent:doctor --provider=gemini          # 只检查本地配置，不发网络请求
pnpm agent:doctor --provider=gemini --probe  # 真实连通检查，可能产生费用
pnpm agent:verify                          # 模型夹具 + Docker + Chromium 两轮行为验证，不调用模型
pnpm agent:verify --live --provider=gemini  # 真实模型 + Docker，两轮生成，可能产生费用
# 可加 --output-dir=/绝对路径 保存本次生成源码、构建产物和任务事件供人工验收。
```

验证脚本使用独立临时数据库与自建测试容器，结束后清理；不修改已有项目。缺少密钥、模型不可用、权限、额度/限流与网络失败均提供明确提示，不记录上游错误正文或密钥。GPT 目前通过模拟协议测试；Gemini 3.5 Flash 已于 2026-10-24 完成两轮真实工具循环与浏览器交互验收，见 [验证记录](docs/coding-agent-verification.md)。

## 自动浏览器验证

AI 任务优先使用 Playwright Chromium，先执行 `pnpm browser:install`；未安装时自动尝试本机 Google Chrome。也可在 `.env.local` 设置 `PIXLOOM_BROWSER_CHANNEL=chrome`，使用已安装的 Google Chrome；仍启动独立临时 profile，不读取个人浏览器数据。环境不可用时任务明确失败，不跳过验证保存版本。安装后需重启 Worker。

候选构建产物仅在验证进程中提供，尚未发布为当前版本。浏览器使用与正式预览相同的 iframe sandbox 和 CSP；请求拦截只提供本次产物，不连接工作台、其他项目或外部网络。每次调用启动全新浏览器，测试结束或任务取消后关闭；浏览器进程不继承模型凭证。当前在宿主运行无头浏览器，不提供容器级浏览器资源配额。

`browser_test` 支持有界的点击、输入、选择、按键、勾选与内容/数量/可见性/值断言，禁止任意 JavaScript、URL 跳转和 Shell。每次最多 30 步、25 秒执行时间（启动另限 10 秒）；必须包含断言。步骤、完成数量及错误写入任务事件，工作台显示生成、构建、验证和保存阶段。测试从空白内存状态开始；重启后沿用失败次数，但对候选产物重新构建与验证。

## 数据与版本边界

新结构使用 `.pixloom/pixloom-v3.db`，包含草稿、版本、任务、构建资源和草稿备份。通过 `PIXLOOM_DATA_DIR` 修改数据目录；Web、Worker 和脚本必须指向同一目录。

**旧单文件 HTML 模式已移除，不迁移旧数据和接口。** 原来的 `.pixloom/pixloom.db` 不会被自动删除或修改。SQLite 备份前应停止 Web 与 Worker，再复制整个数据目录（包含可能存在的 WAL 文件）。

首版沿用固定 JSX/JS 模板与镜像内依赖，只允许 `index.html` 和 `src/` 下白名单源码，不支持修改 npm 依赖、构建配置、隐藏文件或任意 Shell。单文件 128 KiB、最多 64 个文件、源码合计 1 MiB；构建资源单个 2 MiB、合计 8 MiB、最多 128 个；项目源码快照和产物等受 128 MiB 存储预算限制，超限明确报错，不自动删除版本。

同项目的构建、恢复和环境操作统一串行；草稿保存使用 revision 冲突检查。取消和重启会阻止旧 attempt 提交结果；中断的运行任务由新 Worker 从持久候选源码重跑，结果提交保持幂等。当前是本机单 Worker 调度，不支持多机执行。

## 验证

```sh
pnpm test              # 工具协议、生成/修复/预算、文件与版本边界、取消/重启、API
pnpm browser:verify    # 真实 Chromium：交互断言、页面错误、CSP、隔离与取消
pnpm cloud:verify      # 确定性上游 + 真实 Chromium：两种模式的应用客户端
pnpm cloud:verify-runtime # 确定性模型与上游 + 真实 Docker/Vite/浏览器完整生成
pnpm cloud:verify-db   # 独立 PostgreSQL 测试容器：迁移、RLS、存储权限与数据保留
pnpm typecheck
pnpm build
pnpm sandbox:doctor
pnpm sandbox:verify    # Docker 资源隔离、文件读写、构建与预览
pnpm workspace:verify  # 临时数据库 + Docker：v1/v2、失败保留、恢复 v3、继续 v4
pnpm delivery:verify   # 临时数据库 + Docker + ZIP 解包 + 独立静态站点浏览器交互
pnpm publish:verify    # 临时数据库 + Docker + 真实 Caddy + 发布/更新/失败保留/回滚/下线
```

容器验证脚本仅操作自己创建的测试容器，并在结束时清理；工作空间、Agent、交付和发布验证使用并清理独立临时数据库。交付验证还需要 Python 3。发布验证还需 Caddy（可设置 `PIXLOOM_CADDY_BIN`）。生产模式同时运行 `pnpm start`、`pnpm worker`；启用发布后还需 `pnpm gateway` 和公网入口 Caddy。

## 当前限制与下一步

已提供对话生成入口和模板/手工编辑闭环。当前工具循环完成确定性回归、Docker 验证和 Gemini 两轮真实生成及浏览器交互验收；自动浏览器反馈修复循环已接入；GPT 真实调用尚未验收。

预览使用受限 sandbox iframe 与 CSP，静态版本禁止外部网络，Cloud 版本仅允许绑定后端；均禁止原生表单提交、弹窗及访问工作台。手工构建仅验证编译；AI 任务的浏览器测试只覆盖给定断言，不保证所有需求均正确。已实现单机静态自动发布与 Caddy 接入；已增加双模式 Supabase 后端集成；尚无 HMR、GitHub 同步、多分支、通用应用服务器托管和多用户租户授权。

Web 默认绑定 `127.0.0.1`，API 只接受本机 Host 并拒绝跨站平台请求；仅预览 GET 资源允许 opaque-origin iframe 加载。当前工作台保持本机/SSH 隧道访问，Caddy 只公开独立发布网关，不反向代理工作台。

- [Pixloom Cloud 与自有 Supabase](docs/cloud.md)
- [下一步实施计划](docs/roadmap.md)
- [多文件工作空间与版本方案](docs/workspace-versions-plan.md)
- [当前架构](docs/architecture.md)
- [交付链路与版本导出](docs/delivery.md)
- [自动发布与 Caddy 网关](docs/publishing.md)
- [Docker 执行环境](docs/docker-runtime.md)
- [Atoms 调研](docs/atoms-research.md)
