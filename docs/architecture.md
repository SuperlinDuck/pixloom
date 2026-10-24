# Pixloom v0.3 架构

当前统一为 React/Vite 多文件项目。旧 HTML 生成、HTML 版本和 `srcDoc` 预览路径已移除。

## 数据与执行

```text
React 工作台
  ├── AI 对话 / 项目 / 草稿文件树 / 编辑器 / 差异 / 版本历史
  ├── Next.js API → SQLite v3（草稿、版本、任务、产物、备份）
  └── sandbox iframe → 不可变预览资源 → SQLite BLOB

独立 Worker → 领取统一操作 → 固定候选快照 → Docker 完整装载
                         → Vite build → 受限产物导出
                         → 基线与 attempt 校验 → 事务提交版本与资源
```

- `src/lib/store.ts`：v3 schema、事务、项目操作互斥、草稿 revision、任务 attempt、版本提交和 Worker 租约。
- `src/lib/workspace-files.ts`：完整文件集合校验、稳定 hash、批量写入/删除/重命名。
- `src/lib/diff.ts`：文件级及有预算上限的行级差异，长内容截断展示而不截断源码存储。
- `src/lib/ai/agent.ts`：统一模型工具循环、候选源码检查点、构建修复与持久预算。
- `src/lib/ai/provider.ts`：Gemini / Vertex Express 函数调用、GPT Responses 函数调用的原生会话适配。Gemini 完整保留签名 part；GPT 回传 reasoning 与 function_call_output，不使用服务端持久会话。
- `src/lib/ai/tools.ts`：共享工具定义与服务端参数验证；文件工具只操作受校验的候选快照。
- `src/lib/runner.ts`：生命周期操作、候选文件装载、固定构建、产物持久化、取消与超时。
- `src/lib/runtime/docker.ts`：Docker CLI 适配器，容器归属与资源约束；读取固定镜像摘要。
- `sandbox/control.cjs`：受限文件操作、完整替换源码、固定构建和有大小限制的产物导出。
- `src/components/workspace.tsx`：统一工作台；项目状态轮询不携带历史源码全文，也不覆盖未保存编辑。
- `src/middleware.ts`：本机访问边界；仅允许预览 GET 资源接收跨站请求。

## 状态约定

草稿可变，允许构建错误；当前版本是成功快照；查看历史只是前端选择。版本正文按需读取，项目轮询只传版本和草稿摘要。

任务入队捕获 `baseVersionId`、`expectedDraftRevision` 与候选文件；领取时分配 `attemptId`。构建期间禁止草稿写入和其他环境操作。提交事务同时验证任务状态、attempt、Worker 归属、当前版本和草稿 revision，然后一次性保存产物、版本、项目指针、草稿基线与任务完成状态。

恢复创建新版本，`parentVersionId` 指向操作前当前版本，`restoredFromVersionId` 指向恢复来源。旧历史不删除；被覆盖的持久草稿另存备份，可以载入草稿后重新构建。恢复有可复用产物时只需恢复权威源码与预览引用，容器执行副本在下一次启动或构建时从快照完整装载，不被当作事实来源。

## 预览

构建前分配 `artifactId`，Vite base 为 `/api/previews/:artifactId/`。固定控制程序导出 `dist` 资源，平台验证路径、数量和字节上限后，将资源与源码版本同事务保存。

预览不读取可覆盖的容器 `dist`；构建失败、取消、容器移除和 Worker 重启均不影响已存预览。恢复可以复用原版本相同模板摘要的产物；显式“重建此版本预览”会更新版本的缓存引用，不改变源码、版本号或当前指针。旧产物 URL 仍可读取。

所有资源响应沿用 CSP sandbox 和 CORS，iframe 不授予同源权限。源代码中的 `index.html` 是 Vite 入口，不是旧单文件生成模式。

## 持久化与恢复

数据库文件为 `.pixloom/pixloom-v3.db`，通过 `PIXLOOM_DATA_DIR` 修改目录。旧 `.pixloom/pixloom.db` 不迁移、不修改。`PRAGMA user_version=3` 标记新结构。

使用 WAL、busy timeout 和同步短事务，不在事务中执行 Docker、构建或模型请求。Worker 三秒续租，十五秒无心跳后可由新 Worker 接管。接管使 running 任务回到 queued 并清空旧 attempt，再从持久候选文件重新执行；已成功的任务不重新领取。当前仅承诺本机单 Worker，不具备多机资源 fencing。

## 范围

已实现模板、手工编辑与 Coding Agent 多文件版本闭环。Agent 复用候选文件、统一任务与提交协议；任务 kind/source 均标记 agent，模型、需求和预算存于 tasks.agent JSON 列。现有 v3 数据库自动添加可空 agent 列，无需清空数据库。失败候选源码通过终态任务接口按需读取，界面可载入编辑器后保存；不会自动覆盖草稿。Gemini 真实模型工具循环与人工浏览器交互验收已通过；GPT 仅完成模拟协议测试。自动浏览器验证已接入；HMR、独立预览域、认证、正式发布属于后续阶段。

完整接口与决策见 [实施方案](workspace-versions-plan.md)，运行与容器边界见 [Docker 执行环境](docker-runtime.md)。

## 工具循环与验收边界

每次模型响应被转换成统一的工具调用、文本和 token 用量；任务事件使用 model/tool/build/validation/ready/usage 类型，两种模型共用 UI 与版本产物。工具调用串行执行，每步及异步返回后检查取消信号与 attempt，编辑经过原有路径/大小校验并保存检查点。最终文本不能跳过构建，构建后若再修改源码必须重新验证，构建资源与最终候选 hash 一致才提交。

限制为 24 次模型请求、80 次工具调用、48,000 输出 tokens（单次最多 24,000）、累计 1 MiB 响应、单次 512 KiB、5 分钟执行时间、三次失败构建。检查点保留步骤、输出预算预留、用量、失败次数与开始时间。重启会创建新的原生模型会话，从当前候选文件重新读取；不持久化模型原始 reasoning、Gemini 签名或完整会话。调用中断但用量未知时保留预留预算。模型错误/额度/网络失败不自动重试，避免不确定的重复费用。

协议依据：[OpenAI 函数调用](https://developers.openai.com/api/docs/guides/function-calling)、[Gemini 签名与多步函数调用](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)。协议模拟测试与真实 Docker 夹具验证已通过；Gemini 3.5 Flash 已完成真实两轮工具调用、Docker 构建和人工浏览器功能验收，详见 [验证记录](coding-agent-verification.md)；自动行为反馈循环已接入；GPT 真实调用仍待验收。

Gemini 3 使用 `thinkingLevel: low`，将受限任务的时间和输出预算留给实际代码与工具调用；依据 [Gemini 思考配置](https://ai.google.dev/gemini-api/docs/thinking)。预览的 sandbox 会阻止原生表单提交及 localStorage 访问，生成指令要求使用显式按钮点击和键盘事件，并对存储异常回退内存；保持原有安全隔离不变。

## 自动浏览器验收

`src/lib/browser.ts` 在宿主使用独立无头 Chromium 验证尚未提交的构建产物；请求由 Playwright 拦截直接提供本次资源，不依赖运行中的 Web、不提前写入预览表。包装页面使用 sandbox iframe，产物复用正式 `runtimePreviewHeaders`。Service Worker、WebSocket、外部请求及主页面跳转受限。浏览器不继承模型密钥，不读取个人 profile，每次运行关闭并清理。

Agent 的 `build` 成功后执行加载检查；`browser_test` 接受严格验证的有界动作和断言，在最新候选 hash 上成功后才允许完成。源码变化使旧测试结果失效。页面错误、控制台错误、断言失败返回模型修复；环境故障直接报告任务失败。失败计数保存在 Agent JSON 中，重启不重置；取消/超时关闭浏览器且继续遵守提交时 attempt 与基线校验。测试只覆盖给定步骤，不能替代人工需求验收。手工构建/历史恢复不自动重测，沿用原有编译验证语义。
