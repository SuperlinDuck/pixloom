# Pixloom

React/Vite 多文件工作空间：编辑源码、构建预览、查看差异并恢复历史版本。支持本地开发与单机 VPS 邀请内测，已接入 Gemini / GPT Coding Agent 工具循环。首次生产部署只按 [VPS 部署操作指南](docs/continuous-deployment.md) 执行。

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

用户登录后兑换邀请码开通体验，项目、源码、任务、版本、导出、发布和 Cloud 管理按用户授权，自有 Supabase 连接也按用户隔离。`PIXLOOM_ADMIN_EMAILS` 指定管理员，旧本地账号和项目迁移给原管理员；本地未指定时首个账号为管理员。只有本地开发可在完全未配置凭证时使用访客模式，生产缺失登录配置时拒绝启动。私有预览通过所有者授权和十五分钟资源凭证兼容 opaque iframe，可信外层自动续期；退出或停用后凭证失效。公开发布站点及其应用登录独立于工作台账号。工作台允许本机 Host 和 `PIXLOOM_AUTH_URL` 明确配置的来源。邀请码、额度和上线验收见 [部署文档](docs/vps-deployment.md)。

认证流程遵循 [Google OpenID Connect 服务端流程](https://developers.google.com/identity/openid-connect/openid-connect)，校验一次性 state、PKCE、nonce、签名、受众和到期时间，仅请求姓名、邮箱和头像，不保存 Google access token / refresh token。

## 工作流程

工作台首页为 `/`，项目使用数据库中的 UUID 定位：`/projects/:id` 为预览，追加 `/code`、`/runtime`、`/cloud`、`/publish` 分别进入代码、环境、云后端和发布。代码页保存按钮左侧的“查看差异”会打开对比弹窗，`/diff` 链接也会进入代码并打开此弹窗。代码页操作栏的“导出”支持下载所选版本的交付包。右上角的“版本历史”按钮打开构建快照与草稿备份列表，选择快照后可预览页面并查看对应版本的代码；`/history` 链接也会打开此列表。历史版本使用 `/projects/:id/versions/:versionId`，也可追加视图路径。链接支持直接打开、刷新和浏览器前进后退；同一项目内切换保留未保存编辑，离开项目时提示确认。首页固定显示新对话，不再根据浏览器缓存自动打开项目。

1. 在代码页选择文件并编辑，支持新增、删除和重命名。多个文件的修改可一起保存。
2. **保存草稿**持久化源码，不产生版本。未保存编辑只在当前页面，离开时会提示。
3. **构建并保存版本**先保存编辑，再执行固定 Vite 构建。通过后创建不可变源码快照及预览；失败时保留错误草稿和上一可用版本。
4. 在代码页点击**查看差异**，查看草稿与当前版本，或历史版本与其父版本/当前版本的逐行差异。
5. 打开**版本历史**查看快照；查看历史不会切换当前版本。
6. **恢复为新版本**会保留历史并创建新的版本。例如恢复 v1 得到 v3，后续修改基于 v3。被覆盖的已保存草稿在历史面板的备份区可找回。
7. **环境**页管理容器。停止、移除容器不会删除源码、版本及已保存的预览。
8. 右上角**导出交付包**下载当前查看版本的 ZIP，包含源码、独立静态站点、版本清单及运行说明。查看历史时导出该历史版本，不包含草稿修改；无需 Worker 或容器在线。详见 [交付链路](docs/delivery.md)。
9. **发布**页支持上线指定版本、回滚历史发布及下线。Worker 校验持久化产物后切换线上指针，独立网关按项目域名提供站点，Caddy 负责公网 HTTPS。配置见 [自动发布](docs/publishing.md)。

独立预览使用 `/preview/:artifactId` 可信外层页面，在其中运行沙箱产物并恢复应用登录；`/api/previews/...` 继续作为原始资源地址。已有应用需通过 `cloud_enable` 更新平台 Cloud 客户端并构建新版本以启用持久登录，旧产物保持不可变。

版本预览绑定持久化构建产物，不受下一次构建失败影响。可以重新构建某个版本的预览，不增加源码版本；要求模板镜像摘要与该版本一致。历史版本恢复可直接复用其原有产物，不必调用模型或重新构建。

## 云后端：共享资源池与自有 Supabase

默认 **Pixloom Cloud** 使用平台预配置的 Supabase 开发池与生产池，多个应用共用两个物理项目。应用之间使用独立 schema、运行角色、成员授权和额度；纯静态应用不分配后端，开发环境按需启用，生产环境首次发布才分配。无需为每个应用新建两个 Supabase 项目，也不自动创建付费资源。

管理员按 [.env.example](.env.example) 配置 `PIXLOOM_CLOUD_ENCRYPTION_KEY`、`PIXLOOM_CLOUD_RUNTIME_URL` 和 `PIXLOOM_CLOUD_DEV_*` / `PIXLOOM_CLOUD_PROD_*`。开发池配置完整即可开发；生产池可稍后配置。详细步骤见 [共享池配置与运维](docs/cloud-shared.md)。共享模式无需 Management API Token、组织标识和旧的 `PIXLOOM_CLOUD_MAX_PROJECTS`；应用数量取决于池总容量和平台配额。

Engineer 使用同一套 `cloud_enable`、`cloud_schema`、`cloud_test_account` 工具。`src/pixloom-schema.json` 定义用户所属的数据表和逻辑私有存储桶；构建同步开发结构，发布同步生产结构；迁移只添加表/列，代码回滚不回滚业务数据。同一环境池共用身份提供方，应用成员和数据分别授权；登录界面文案由应用自行设计。新版客户端通过可信预览入口和发布站点固定保持登录 7 天，刷新和正常重开浏览器自动恢复；主动退出会在服务端立即撤销。Supabase 凭证加密保存在服务端，应用仅持有内存中的短期访问凭证。共享模式暂不支持自定义服务端函数，需要此能力可为新应用选择 **自有 Supabase**。

自有模式通过 OAuth 绑定两个独立项目，需另配 `PIXLOOM_SUPABASE_CLIENT_ID`、`PIXLOOM_SUPABASE_CLIENT_SECRET`；回调为 `<工作台来源>/api/cloud/supabase/callback`。已有 v1 独立托管资源继续使用原绑定，不自动合并、删除或接管。兼容配置见 [独立后端文档](docs/cloud.md)，后续设计见 [Cloud v2](docs/cloud-v2.md)。

共享池通过独立网关提供有限登录、CRUD 和文件接口；凭证不进入模型、源码、构建容器或浏览器。VPS 使用独立 HTTPS 网关来源，Web/Worker/网关共用池配置与数据目录。管理员可按应用导出、恢复到新空间及确认删除；真实生产使用前须完成自己的备份恢复和上游服务验收。

## AI 生成与继续修改

首页输入“创建待办应用”，发送后进入对话与预览；完成后可继续输入“增加分类筛选”。新对话页和详情页暂不显示模型选择，创建、继续对话与失败重试统一使用服务端配置的 Gemini 模型。对话显示完整需求和完成说明，执行详情默认折叠。每次请求基于已保存草稿与当前版本；提交前会先保存本页源码编辑。历史浏览模式下不能发起生成。模型未配置或 Worker 离线时会保留输入并提示，不创建空项目。

工作台任务运行时每轮完成后等待 5 秒再更新进度，空闲对话等待 30 秒；项目列表、服务状态和发布状态通常等待 60 秒，Worker 离线时状态检查缩短到 15 秒，发布期间发布状态等待 5 秒。主要轮询在页面隐藏或断网时暂停，恢复后立即更新；读取请求 15 秒超时，失败后逐步退避到最多 60 秒，切换对话取消旧页面读取。项目详情只读取草稿元数据和任务摘要，不读取、解析候选源码快照。

每次生成和 Worker 重启创建模型会话时，都会从数据库恢复同项目此前的用户需求、任务状态、错误和完成回复，始终完整保留最初需求；近期对话最多 12 轮、24,000 字符，超限明确标记省略，不受界面仅显示最近 30 个任务的限制。“继续生成”与重试仍围绕原目标执行，后续明确修改优先。历史模型回复仅供参考，不作为功能或测试通过的证明。失败任务的候选源码仍不会自动覆盖草稿，新任务会结合历史需求核实并继续完成。

Agent 可以列出、读取和搜索候选源码，完整写入、精确编辑或删除文件，运行固定构建并读取错误。每次成功构建后自动检查预览加载、页面异常与控制台错误；Agent 可通过 `browser_test` 操作和断言所请求功能。自动测试仅供参考：页面异常、断言或选择器错误、浏览器环境不可用均保留告警，不阻止构建成功的候选保存为 AI 版本并更新预览。源码变化后会重新构建，旧功能测试结果不会被当作新源码的通过证明。完成回复会显示测试失败、跳过或尚未进行功能测试的提示。失败或取消时保留原草稿、版本和预览，候选源码保存在任务中。失败消息提供“重试”，使用原需求和模型、基于当前草稿创建新任务；重试不会清空输入框中尚未发送的内容。回复和错误信息可通过“复制”按钮复制，对话中不展示候选源码载入入口。

每个任务最多 200 轮模型调用（含自动摘要）、400 次工具调用、20 分钟总执行时间，以及三次失败构建（两轮修复）。每次模型请求独立限制为最多 24,000 输出 tokens（包含模型报告的推理用量）、512 KiB 响应。自动浏览器验证累计失败三次后跳过后续测试，不阻塞版本保存。不设置单任务累计输入、输出 token 或响应大小上限，累计用量仅用于统计和用户积分结算。每次发送前按完整请求的 UTF-8 字节数保守估算输入，预留单次输出空间及 25% 上下文余量；接近上限时用所选模型生成摘要，再从原始需求、当前候选文件清单及摘要创建新会话。摘要调用计入轮数、用量统计和用户额度，不清零已消费用量。步骤、用量、候选源码、摘要、失败计数与开始时间持久化；重启从候选源码开始新模型会话，沿用剩余轮数、执行时限和已有摘要。Gemini 3.8 Flash 和 GPT-4.1 mini 内置官方上下文窗口；其他模型须先按官方容量配置 `GEMINI_CONTEXT_WINDOW_TOKENS` 或 `OPENAI_CONTEXT_WINDOW_TOKENS`；未配置容量时拒绝发起请求。原始需求和必要上下文本身超过安全预算时会明确报错。被中断且结果未知的请求保留个人积分预留，避免重复消费可用余额；这些预留不减少后续请求的单次输出上限。用户额度另由持久账本控制：每次实际模型尝试（含重试）先预留预算，收到有效 usage 后结算，不确定结果保留预留供管理员核对。个人余额不会因重启重置，不设置平台每日总额度限制。用量不是供应商账单核对。

一轮模型请求默认最多等待 180 秒，包括请求资源排队、限流冷却、自动重试和完整响应读取。`PIXLOOM_MODEL_REQUEST_TIMEOUT_MS` 可配置为 1000–600000 毫秒；总任务仍受 20 分钟上限约束。超过 30 秒会在任务执行详情提示当前等待阶段，短时错误重试会显示 HTTP 状态和等待秒数。超过本轮时限立即停止等待并报告错误，不自动重发结果未知的超时请求；已发出请求的未确认用量仍保留预留。

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

AI 任务优先使用 Playwright Chromium，先执行 `pnpm browser:install`；未安装时自动尝试本机 Google Chrome。也可在 `.env.local` 设置 `PIXLOOM_BROWSER_CHANNEL=chrome`，使用已安装的 Google Chrome；仍启动独立临时 profile，不读取个人浏览器数据。生成任务在浏览器环境不可用时记录告警，仍可保存构建成功的版本。安装后需重启 Worker。

候选构建产物仅在验证进程中提供，尚未发布为当前版本。浏览器使用与正式预览相同的 iframe sandbox 和 CSP；请求拦截只提供本次产物，不连接工作台、其他项目或外部网络。每次调用启动全新浏览器，测试结束或任务取消后关闭；浏览器进程不继承模型凭证。当前在宿主运行无头浏览器，生产 systemd Worker cgroup 同时限制 Chromium 子进程资源。

`browser_test` 支持有界的点击、输入、选择、按键、勾选与内容/数量/可见性/值断言，禁止任意 JavaScript、URL 跳转和 Shell。每次最多 30 步，普通页面 25 秒、Cloud 应用 60 秒执行时间（启动另限 10 秒）；必须包含断言。共享 Cloud 使用与工作台相同的可信认证消息通道，每轮仍使用独立浏览器环境。步骤、完成数量及错误写入任务事件，工作台显示生成、构建、验证和保存阶段。测试从空白内存状态开始；重启后沿用失败次数，对候选产物重新构建；未达到三次失败时继续执行加载检查，达到上限则跳过。

点击步骤的 `value` 可填写完整元素文字，在 CSS 选择器结果中按文字筛选（区分大小写、归一化空白）；留空时仅使用选择器。重复按钮可用 `selector: "button"` 和 `value: "保存并同步到云端"` 定位。单元素操作与断言仍须唯一匹配，重复下拉框应限定弹窗等容器或使用唯一 id；`:nth-of-type(1)` 是各父元素内的索引，不能保证页面唯一。多匹配错误会提示 Agent 一起检查剩余步骤中的同类选择器。

## 数据与版本边界

新结构使用 `.pixloom/pixloom-v3.db`，包含草稿、版本、任务、构建资源和草稿备份。通过 `PIXLOOM_DATA_DIR` 修改数据目录；Web、Worker 和脚本必须指向同一目录。

**旧单文件 HTML 模式已移除，不迁移旧数据和接口。** 原来的 `.pixloom/pixloom.db` 不会被自动删除或修改。SQLite 冷备前应停止 Web、Worker 和 Gateway，再复制整个数据目录（包含可能存在的 WAL 文件）。网关也会写入 Cloud 会话；发布目录、配置密钥和 Supabase 数据需分别覆盖。

首版沿用固定 JSX/JS 模板与镜像内依赖，只允许 `index.html` 和 `src/` 下白名单源码，不支持修改 npm 依赖、构建配置、隐藏文件或任意 Shell。单文件 128 KiB、最多 64 个文件、源码合计 1 MiB；构建资源单个 2 MiB、合计 8 MiB、最多 128 个；项目源码快照和产物等受 128 MiB 存储预算限制，超限明确报错，不自动删除版本。

单 Worker 默认同时执行 3 个任务，每位用户同时执行 1 个，按用户最近领取顺序公平轮转；同项目的构建、恢复和环境操作统一串行。`PIXLOOM_WORKER_CONCURRENCY` 调整任务并发，实际不超过 `PIXLOOM_MAX_RUNTIME_CONTAINERS`。构建和浏览器验证默认各并发 1 个，可分别设置 `PIXLOOM_BUILD_CONCURRENCY`、`PIXLOOM_BROWSER_CONCURRENCY`；模型请求（含标题、摘要）默认并发 3 个，由 `PIXLOOM_MODEL_CONCURRENCY` 控制，同 API 来源的短时 429 共用冷却。排队任务显示等待原因和前方等待的用户数；取消后立即停止等待资源，但任务清理完成才释放执行名额。

草稿保存使用 revision 冲突检查。取消和重启会阻止旧 attempt 提交结果；中断的运行任务由新 Worker 从持久候选源码重跑，结果提交保持幂等。当前是本机单 Worker 内并发，不支持多进程或多机执行。

## 验证

```sh
pnpm test              # 工具协议、生成/修复/预算、文件与版本边界、取消/重启、API
pnpm browser:verify    # 真实 Chromium：交互断言、页面错误、CSP、隔离与取消
pnpm cloud:verify      # 确定性上游 + 真实 Chromium：两种模式的应用客户端
pnpm cloud:verify-runtime # 确定性模型与上游 + 真实 Docker/Vite/浏览器完整生成
pnpm cloud:verify-shared # 独立 PostgreSQL + Docker/Vite + Chromium：共享池隔离、两应用生成发布、恢复/删除
pnpm cloud:verify-db   # 独立 PostgreSQL 测试容器：迁移、RLS、存储权限与数据保留
pnpm invite:verify    # 先 build：独立 Web + Chromium，邀请码/租户/私有预览，不调用真实上游
pnpm admin:verify     # 先 build：独立 Web + Chromium，后台权限/邀请管理/用户用量/历史对话
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

预览使用受限 sandbox iframe 与 CSP，静态版本禁止外部网络，Cloud 版本仅允许绑定后端；均禁止原生表单提交、弹窗及访问工作台。手工构建仅验证编译；AI 任务的浏览器测试只覆盖给定断言，不保证所有需求均正确。已实现单机静态自动发布与 Caddy 接入；已增加双模式 Supabase 后端集成；尚无 HMR、GitHub 同步、多分支和通用应用服务器托管；当前租户授权以项目所有者为单位，不含团队协作。

Web 默认绑定 `127.0.0.1`，API 允许本机及明确配置的工作台来源，并拒绝跨站管理请求；受限预览以短期资源凭证兼容 opaque iframe。生产由 Caddy 公开 HTTPS 工作台与独立应用网关，内部端口不对外开放。Worker 定期回收空闲容器，已有静态预览不受影响。

- [VPS 部署操作指南（首次部署、Actions、旧 PM2 迁移）](docs/continuous-deployment.md)
- [上线后运维参考（邀请码、额度、备份）](docs/vps-deployment.md)
- [共享池配置与运维](docs/cloud-shared.md)
- [独立后端与自有 Supabase](docs/cloud.md)
- [下一步实施计划](docs/roadmap.md)
- [多文件工作空间与版本方案](docs/workspace-versions-plan.md)
- [当前架构](docs/architecture.md)
- [交付链路与版本导出](docs/delivery.md)
- [自动发布与 Caddy 网关](docs/publishing.md)
- [Docker 执行环境](docs/docker-runtime.md)
- [Atoms 调研](docs/atoms-research.md)
