# Pixloom

用自然语言构建、预览和迭代应用。当前版本是**本地单用户原型**：Gemini 优先，支持切换使用 Responses API 的 GPT 模型。

## 启动

需要 **Node.js 22.13+（推荐 Node.js 24）**、pnpm。SQLite 使用 Node 内置模块，无需单独安装数据库。

```sh
pnpm install
cp .env.example .env.local
# 编辑 .env.local，配置 GEMINI_API_KEY 或现有的 VERTEX_AI_API_KEY
pnpm dev
```

打开 http://127.0.0.1:3000 。`pnpm dev` 同时启动 Web 和独立 Worker。没有 Key 时可以点击「体验交互示例」，使用明确标注为非 AI 生成的番茄钟。

```dotenv
# Gemini Developer API
GEMINI_API_KEY=...
# 或使用原仓库的 Vertex Express Key
# VERTEX_AI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```

模型必须支持文本生成和 JSON 结构化输出。原来的图片生成模型不能用于代码生成。如果同时设置两个 Gemini Key，优先使用 `GEMINI_API_KEY`。模型名称可按账号权限调整。配置变更后重启 Web 和 Worker。

切换 GPT：配置以下变量后，在输入框底部选择 GPT。这里接入的是 **Responses API**；只支持 Chat Completions 的代理服务不能直接使用。

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

## 已实现

- 创建项目、保存聊天需求、后台异步生成，离开页面后任务继续执行。
- Gemini Developer / Vertex Express 两种入口；独立 GPT 适配器，共用结果格式。
- 当前版本代码 + 最近成功需求作为连续修改的上下文。
- HTML 结构、内联脚本与事件处理器的 JavaScript 语法检查；失败时最多修复一次。
- 隔离 iframe 预览、桌面/手机尺寸、只读代码查看、HTML 导出。
- 成功版本自动保存、预览历史版本、恢复并从该版本继续修改。
- 任务取消、3 分钟超时、Worker 状态、Token 使用记录（成功任务）。
- SQLite WAL 持久化、单 Worker 租约、重启后重新排队中断任务。
- 响应式工作台、中文界面、配置提示和可交互内置示例。

项目、任务、事件和完整版本保存在 `.pixloom/pixloom.db`。可通过 `PIXLOOM_DATA_DIR` 改变目录；Web 和 Worker 必须指向相同目录。备份前停止两个进程，再复制整个目录（包含可能存在的 WAL 文件）。

## 当前边界

生成物是**单个自包含的 HTML/CSS/JavaScript 应用**，暂不执行 Shell、不安装 npm 依赖，不支持 React 工程、真实后端、登录、支付、外部 API 或本地存储。iframe 使用 `sandbox="allow-scripts"`，不授予同源、弹窗和导航权限；CSP 禁止网络、表单提交和外部资源。静态检查不等于浏览器行为测试，CSS 和业务逻辑仍可能需要继续迭代。导出 HTML 在独立浏览器打开时不再受工作台 iframe 边界保护。

这是本地原型，Web 默认绑定 `127.0.0.1`，API 拒绝非本机 Host 与跨站请求。尚未实现用户认证、租户隔离、调用额度、磁盘配额或公开部署；请勿直接通过反向代理开放访问。原有商品图业务、OAuth 骨架、MongoDB schema 和旧的自动部署流程已移除。

Worker 重启时，中断任务会重新调用模型；这是至少一次执行，可能重复产生模型费用。取消会阻止保存迟到结果，并中止本地请求，无法保证供应商不再计费。首次发布模型返回完整结果后再显示预览，进度通过轮询同步；尚未实现 Token 流式输出。

## 开发与验证

```sh
pnpm dev:web     # 单独启动 Web
pnpm worker      # 单独启动 Worker
pnpm test        # 任务生命周期、版本、验证器和模型适配器测试
pnpm typecheck
pnpm build
# 本地生产模式需要同时运行以下两个进程：
pnpm start
pnpm worker
```

## 后续任务上下文

- [Atoms 调研原文快照](docs/atoms-research.md)：产品能力、Agent 编排、Sandbox、基础设施与实施路线的研究依据。
- [Pixloom 当前架构与后续路线](docs/architecture.md)：仓库当前已实现的能力、边界和下一步。
- [下一步实施计划](docs/roadmap.md)：React 项目生成、Docker 执行环境及后续里程碑的实现顺序和验收标准。

开始后续开发任务时，建议先阅读这两份文档，并以用户最新要求和实际代码为准。
