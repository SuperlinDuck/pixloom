# Atoms 调研（Notion 文档快照）

- 来源：[Atoms 调研](https://app.notion.com/p/Atoms-403858c68e9380c197abeb758a7be485)
- 来源路径：AI Workspace / Vibe coding
- 来源最后编辑时间：2026-10-24T04:39:08.389Z（UTC）
- 同步日期：2026-10-24
- 用途：为 Pixloom 后续产品设计、Agent 编排、Sandbox、部署和实施任务提供研究上下文。

> 以下完整保留 Notion 正文。文中的架构推测、成本估算与建议属于研究材料，不表示 Pixloom 已实现或已经确定采用；当前实现与后续路线见 [Pixloom 架构](architecture.md)。原文中未展开的引用占位（如“+1”“Help Center”）按原样保留，未补造来源。

---

> <b>研究性质</b>：产品能力以官方资料为依据；Agent 编排、Sandbox 细节及竞品架构推断并非 Atoms 已公开的内部实现。部署建议面向 MVP，正式商用需额外进行安全与容量验证。

## 阅读导航

- <b>第一部分｜产品研究</b>：定位、Multi-Agent、Coding Agent、Cloud、Visual Editor、Race Mode 与竞品对比
- <b>第二部分｜Agent 部署架构</b>：服务端与 Sandbox 两种方案、竞品实践、混合架构建议
- <b>第三部分｜基础设施与部署</b>：Vercel 与 VPS、Docker、资源容量
- <b>第四部分｜落地准备与实施路线</b>：采购清单、安全、成本、开发顺序

---

# 第一部分｜Atoms 产品与技术研究

核心结论：Atoms 是一个以 Multi-Agent 为核心、面向非技术用户的 AI 全栈应用生成平台。 它不仅负责生成代码，还把需求分析、产品设计、应用开发、数据库、部署、SEO、广告投放整合成一条完整工作流。

从技术角度看，它更像是 MetaGPT + Lovable/Bolt + 云端应用托管 + AI 增长工具 的组合。

需要区分两类信息：

- 官方确认的能力：来自 Atoms 文档和产品页面。
- 推测的实现方式：根据公开交互流程和常见 Agent 工程架构进行逆向分析。官方并未公开完整的内部技术架构。

#### Atoms 的产品定位

![](https://images.openai.com/static-rsc-4/xeEkfqtivXDV_bAqqIlqB3hPn_TlR1sdDdE46syzJraMPPGitXlpapVFfT0Cp6FPPOS7kc6zlwavWmtsTBqPYnPoCMQtzTuORtK_ZiSdn648bK2Qb3ekPrTSoUR9TE9el9uZ_cWxmFS0MPLr--bw2xIyWBBgwe6aJgKqRA3cyZ4?purpose=inline)

Atoms 希望让用户通过自然语言完成：

用户提出产品想法

例如：创建一个带登录、支付和后台管理的 SaaS

Multi-Agent 团队

需求研究 → PRD → 架构设计 → 编码实现

可运行的全栈应用

前端 + 后端 + 数据库 + 登录 + 支付

部署发布

预览、版本管理、域名、GitHub 同步

产品增长

SEO、Google Ads、数据分析

与传统 AI Coding 工具相比，Atoms 的区别是：它把交付目标从代码扩展为可以上线运营的产品。

官方明确支持 SaaS、内部工具、AI 应用、落地页、电商网站等场景。

#### Multi-Agent 架构：最值得研究的部分

Atoms 官方展示了 8 个专业 Agent。

| Agent | 职责 | 对应工程能力 |
| --- | --- | --- |
| Mike — Team Leader | 统筹任务、协调 Agent、请求审批 | Orchestrator |
| Emma — Product Manager | 需求分析、产品规格 | PRD 生成 |
| Bob — Architect | 技术架构设计 | 技术方案生成 |
| Alex — Engineer | 全栈开发、修复问题 | Coding Agent |
| Iris — Deep Researcher | 市场与竞品研究 | Deep Research |
| Sarah — SEO Specialist | SEO 内容和优化 | SEO 工具链 |
| Adrian — Ads Specialist | Google Ads 创建和优化 | 广告平台集成 |
| David — Data Analyst | 数据分析与机会发现 | 数据分析 Agent |

#### 两种 Agent 工作模式

官方文档明确描述了两种模式：

Single-Agent Mode

关闭 Team Mode 后，由 Alex 独立处理任务。适合局部代码修改、UI 调整和 Bug 修复。

Team Mode

开启后，由 Mike 负责协调多个专业 Agent，适合复杂的产品生成任务。

这意味着它并不是所有请求都强制经过多 Agent 流程，而是根据任务复杂度选择不同执行路径。

#### 任务执行与人工审批

官方交互流程中有几个非常关键的组件：

- Working Process：显示 Agent 当前执行步骤。
- Question Card：Agent 向用户收集缺失信息。
- Plan Card：等待用户批准或拒绝执行方案。
- Version Card：执行完成后生成可预览的应用版本。

其中 Plan Card 必须经过用户批准才能继续执行，说明 Atoms 至少在部分任务中使用了 Human-in-the-Loop（HITL）机制。

这也为推测它的内部任务状态机提供了重要依据。

#### 推测它的 Agent 编排是如何实现的

根据官方工作流，我认为 Atoms 最可能采用的是 Supervisor + Plan-and-Execute + Sub-Agent Delegation 的混合架构，而不是所有 Agent 之间自由通信。

用户请求

Task Router

普通任务 → Alex；复杂任务 → Mike

Mike / Supervisor

需求理解、任务规划、Agent 调度、结果汇总

Iris

市场研究

Emma

产品需求

Bob

架构设计

Alex

代码实现

Validation & HITL

测试、审批、失败重试

Version / Publish

#### 任务拆解

例如用户输入：

> 帮我开发一个支持 Google 登录和 Stripe 订阅的 SaaS。

Mike 可能将任务转换为：

```txt
{
  "goal": "Build a subscription SaaS",
  "tasks": [
    {
      "id": "t1",
      "agent": "Emma",
      "action": "generate_prd"
    },
    {
      "id": "t2",
      "agent": "Bob",
      "action": "design_architecture",
      "depends_on": ["t1"]
    },
    {
      "id": "t3",
      "agent": "Alex",
      "action": "implement_app",
      "depends_on": ["t2"]
    },
    {
      "id": "t4",
      "agent": "Alex",
      "action": "test_and_fix",
      "depends_on": ["t3"]
    }
  ]
}
```

这只是用于解释的假设数据结构，并不是 Atoms 公开的真实协议。

我倾向于认为它会维护一个可持久化的任务 DAG 或任务状态图。原因是它支持审批暂停、Agent 交接、任务排队和执行恢复。

尤其值得注意的是，2026 年 4 月的官方 Changelog 明确提到新增了将开发任务委派给专业 Sub-Agent 的能力，并强化了规划、委派、实现和验证流程。这比单纯的营销介绍更有技术参考价值。

#### Agent 之间如何传递上下文

我认为合理的设计不是把整个对话历史传给所有 Agent，而是传递结构化任务产物：

| 上游 Agent | 交接内容 | 下游 Agent |
| --- | --- | --- |
| Iris | 市场研究报告 | Emma |
| Emma | PRD、功能列表、验收标准 | Bob |
| Bob | 技术架构、数据模型、接口规范 | Alex |
| Alex | 代码、测试结果、构建状态 | Mike |
| Mike | 完成情况、版本信息 | 用户 |

一种可行实现是：

- 全局共享 Project Context，包含项目目标、用户约束和文件引用。
- 每个 Agent 拥有独立的工作上下文和工具权限。
- Agent 完成任务后输出结构化 Artifact。
- Supervisor 根据 Artifact 更新任务状态并决定下一步。
- 长任务使用 Checkpoint 保存状态，避免中断后重新执行。

这样可以减少 Token 消耗，也能降低不同 Agent 之间的上下文污染。

#### Coding Agent：如何真正生成一个应用

这是 Atoms 的第二个技术核心。

官方确认它能够创建前后端应用、执行开发任务、预览应用，并在 Terminal 发生错误时辅助修复。其更新日志还提到 Sandbox 启动、App Launcher、构建验证等机制。

Help Center

由此推测，其 Coding Agent 的执行流程可能是：

生成或选择项目模板

创建隔离开发环境

读写项目文件

安装依赖、运行命令

启动开发服务器

获取构建日志与预览结果

验证失败则修复代码

生成应用版本

#### Sandbox 可能如何设计

一种比较合理的技术实现：

```txt
User Request
     |
Agent Runtime
     |
Sandbox Manager
     |
Container / MicroVM
     |
/workspace/project
     |
Node.js + Package Manager
     |
Development Server
     |
Preview Gateway
     |
Browser App Viewer
```

其中几个关键组件：

Sandbox Manager

负责创建、唤醒、休眠和销毁隔离环境。不同用户的代码和进程应相互隔离。

Terminal Executor

向 Agent 提供 <code>exec_command</code> 一类的工具，允许安装依赖、运行测试、启动服务、读取日志。

Preview Gateway

将 Sandbox 内的开发服务器映射到用户可访问的预览 URL，并通过鉴权保护私有项目。

File System Tools

提供文件读取、搜索、编辑、差异比较和版本快照能力。

需要强调：官方更新日志确实出现了 Sandbox、Terminal、Preview 等概念，但没有确认其底层采用 Docker、Kubernetes、Firecracker 还是其他隔离方案。

#### 自动验证与修复

这是一个非常值得关注的能力。

官方更新日志提到了真实页面验证、登录与支付流程检查、Preview 截图和错误反馈的改进。

这表明 Atoms 不只是运行 <code>npm run build</code>，还在建设面向用户行为的验证流程。

推测可能分为三层：

| 层级 | 验证内容 | 可能使用的工具 |
| --- | --- | --- |
| 静态验证 | TS、Lint、构建错误 | TypeScript、构建工具 |
| 运行验证 | 服务是否启动、API 是否可用 | Terminal、HTTP 请求 |
| 交互验证 | 页面、按钮、登录、支付流程 | 浏览器自动化、截图分析 |

第三层尤其重要。一个应用能成功编译，不代表用户可以完成真实业务流程。

#### Atoms Cloud：它如何实现全栈生成

Atoms 不只是生成前端代码。

官方的 Atoms Cloud 包含：

- Database：结构化数据。
- Authentication：用户认证。
- App Storage：文件存储。
- Keys：密钥和凭证管理。
- AI：模型库和模型调用统计。

官方还提到可以连接 Supabase、Stripe、GitHub 等外部服务。

+1

#### 可能的实现方案

Atoms 很可能采用了 平台托管能力 + 外部 BaaS 集成 的组合模式。

例如：

```txt
Generated App
    |
    +-- Frontend
    |
    +-- Backend / Edge Functions
    |
    +-- Database
    |
    +-- Authentication
    |
    +-- Object Storage
    |
    +-- Stripe
    |
    +-- AI Model Gateway
```

这种架构有一个明显优势：

Coding Agent 不必从零实现每一项基础设施，而是调用平台预置能力和集成工具。

比如创建一个用户系统，Agent 可以先生成数据库 Schema，再接入认证服务、生成前端登录页、配置环境变量，最后测试完整流程。

相比让 Agent 自行搭建所有服务，这种方式通常更容易控制生成质量和部署成本。

#### Visual Editor：可视化编辑如何与代码同步

Atoms 还提供可视化编辑器，支持在生成应用后直接选择页面元素并修改布局。2026 年 6 月的更新日志提到多选和 Sandbox 启动体验优化。

Help Center

我认为这里可能有两条技术路线：

方案 A：DOM 定位 + 源码映射

1. 在 Preview 中点击元素。
2. 识别 DOM 节点及其组件来源。
3. 关联到源码文件、组件和位置。
4. 将修改意图传递给 Coding Agent。
5. 更新源码并触发 HMR。

方案 B：DOM 操作 + 代码回写

1. 用户直接调整样式。
2. 前端即时修改 DOM 或 CSS。
3. 收集编辑操作。
4. 将操作转换为源码补丁。
5. 保存到项目版本。

Atoms 的实际方案尚未确认，但对于代码生成平台，源码映射是实现稳定可视化编辑的重要工程问题。

#### 模型选择与 Race Mode

Atoms 还有一个值得研究的功能：Race Mode。

官方介绍称，它可以让同一个 Prompt 在多个模型上运行，再从候选结果中选择更好的版本。官方更新日志中将其称为 BON（Best-of-N）或 Race Mode。

可能的架构：

```txt
                 User Prompt
                      |
                Race Controller
                 /     |     \
             Model A Model B Model C
                 \     |     /
              Candidate Results
                      |
              Evaluate / Compare
                      |
                Select Result
```

它可以有两种实现策略：

- 并行生成：多个模型分别生成候选代码或方案，用户进行比较。
- 自动评估：根据构建结果、测试、截图或模型评分选出最优候选。

目前能够确认多模型候选生成和选择的产品能力，但无法确认是否存在完全自动化的评估器。

另外，官方更新日志提到了自动模型选择实验，以及对 Gemini、DeepSeek、GLM 等模型的支持。说明它并非完全依赖单一模型供应商。

#### 如果从零实现一个类似 Atoms 的系统

结合前面的分析，我会将它拆成六个核心服务。

| 服务 | 职责 | 推荐技术方案 |
| --- | --- | --- |
| Agent Orchestrator | 任务拆解、Agent 调度、HITL | LangGraph |
| Coding Runtime | 代码生成、工具调用、错误修复 | 自定义 ReAct Agent |
| Sandbox Service | 隔离执行环境 | Docker / Kubernetes |
| Workspace Service | 文件、代码版本、项目状态 | Git + 对象存储 |
| Preview & Deploy | 预览、构建、发布 | 反向代理 + 部署服务 |
| Cloud Integrations | 数据库、登录、支付 | Supabase + Stripe |

#### 推荐的执行状态机

实际工程中还需要增加任务超时、最大重试次数、Checkpoint、幂等性控制和人工接管机制，避免无限修复循环。

#### 和其他 AI Coding 产品相比

| 维度 | Atoms | Lovable / Bolt | Cursor / Claude Code |
| --- | --- | --- | --- |
| 目标用户 | 创业者、非技术用户 | 产品创建者 | 开发者 |
| Multi-Agent | 明确的专业角色团队 | 主要围绕应用构建 | 更灵活的开发 Agent |
| 需求规划 | 内置产品与架构角色 | 以需求驱动开发为主 | 开发者主导 |
| 全栈开发 | 支持 | 支持 | 支持 |
| 部署 | 集成 | 集成 | 依赖项目环境 |
| SEO / Ads | 专业 Agent | 非核心能力 | 非核心能力 |
| 核心差异 | 从想法到运营增长 | 快速创建应用 | 开发效率与代码控制 |

这是产品定位层面的对比，并非统一测试条件下的能力排名。

#### 我认为最值得借鉴的三个设计

1\. Supervisor + 专业 Sub-Agent

不是让所有 Agent 一直参与，而是根据任务动态选择执行模式。复杂任务经过规划和委派，简单任务直接交给 Engineer，兼顾质量、延迟和成本。

2\. 生成 → 验证 → 修复的闭环

Coding Agent 的核心竞争力不只是生成代码，而是能够在真实运行环境中发现问题，并自动修复直到满足验收标准。

3\. Agent Runtime 与应用基础设施深度集成

通过预置数据库、认证、支付、部署等能力，将复杂的基础设施操作封装成 Agent 可以调用的工具，而不是让模型每次从零生成所有实现。

还有一个值得注意的细节：Atoms 的更新日志显示，2025 年就开始优化增量开发的 Token 消耗，曾报告平均减少约 56%。这意味着它也在持续解决长上下文、重复读代码和增量编辑成本的问题。

Help Center

#### 研究总结

从公开资料看，Atoms 的技术核心并不是某一个特别的 Agent 算法，而是以下几个系统的组合：

Multi-Agent 编排 + Coding Agent + Sandbox + 自动验证 + 全栈基础设施 + 产品发布与增长。

如果从 AI Agent 工程的角度继续深入，我认为最有研究价值的两个问题是：

1. Mike 如何将复杂需求拆成任务，并决定何时委派给哪个 Sub-Agent？ 这涉及 Supervisor、任务 DAG、上下文隔离、HITL 和执行恢复。
2. Alex 如何在 Sandbox 中实现稳定的代码生成、运行、验证与修复？ 这涉及工具体系、文件编辑策略、环境管理、浏览器自动化和长任务可靠性。

目前的研究主要基于官方文档与更新日志，还不是源码级逆向。要确定内部真实架构，下一步最有价值的是分析其公开的 [MetaGPT 开源项目](https://github.com/FoundationAgents/MetaGPT?utm_source=chatgpt.com) 与 Atoms 的关系，并进一步研究 Atoms 的实际 Agent 执行轨迹、工具调用和任务状态流转。

---

# 第二部分｜Agent Runtime 的部署架构

我查了 OpenHands、Claude Code、E2B、Daytona、Cloudflare Sandboxes 的官方架构文档。

我的建议是：采用混合架构——Agent 编排放在服务端，Coding Agent 的执行环境放在 Sandbox 内。

但这里有一个重要区别：Agent 的推理循环（Agent Loop）和工具执行（Tool Execution）不一定要运行在同一个地方。

主流产品实际上有两种路线，而且都合理。

#### 竞品是怎么实现的？

| 产品 / 框架 | Agent Loop 在哪里 | 代码执行在哪里 |
| --- | --- | --- |
| OpenHands V0 | 服务端 | Docker Sandbox |
| OpenHands V1 | Sandbox 内的 Agent Server | 同一个 Sandbox |
| Claude Code Cloud | 云端隔离环境 | 云端隔离环境 |
| Claude Managed Agents | Anthropic 服务端 | 云端或自托管 Sandbox |
| E2B | 开发者自行决定 | E2B MicroVM |
| Daytona | 开发者自行决定 | Daytona Sandbox |
| Cloudflare Coding Agents | Sandbox 内 | 同一个 Sandbox |

来源：

GitHub

+6

其中 OpenHands 特别值得研究，因为它的 V0 和 V1 恰好代表了两种不同架构。

#### 方案 A：Agent 在服务端，Sandbox 只执行工具

这是 OpenHands V0 和 Claude Managed Agents 自托管 Sandbox 所体现的模式。

服务端 — Control Plane

Agent Runtime

LLM 调用、ReAct 循环、上下文管理、工具选择

Orchestrator

任务调度、Checkpoint、审批、重试

Tool Call / Tool Result（HTTP / RPC）

Sandbox — Execution Plane

Shell

File System

Browser

Dev Server

Sandbox 不负责 Agent 推理，只执行经过授权的工具操作

例如 Coding Agent 决定执行：

```txt
const result = await sandbox.execute({
  command: "npm run build",
  cwd: "/workspace",
});
```

执行流程是：

1. 服务端 Agent 调用 LLM。
2. LLM 返回工具调用 <code>execute_command</code>。
3. Agent 将请求发送到 Sandbox。
4. Sandbox 执行命令并返回结果。
5. Agent 将结果传给 LLM，继续推理。

优点： Agent 状态集中管理，模型 API Key 不需要进入 Sandbox，方便控制成本、审计和任务恢复。

缺点： 工具调用需要跨进程通信。如果 Agent 大量读取文件、搜索代码，每次调用都有 RPC 开销。

OpenHands V0 的官方架构文档就展示了 Agent 后端通过 REST API 与 Sandbox 内的 Action Executor 通信。

GitHub

#### 方案 B：Agent Loop 和工具都在 Sandbox 内

这是 OpenHands V1、Claude Code Cloud 更接近的模式。

服务端 — Control Plane

用户认证、任务创建、Sandbox 管理、消息转发

Sandbox — Agent Runtime

Coding Agent

Agent Loop、上下文、工具调度

Shell

File System

Browser

Dev Server

Agent 直接操作 Sandbox 内的本地文件和进程

LLM API / Model Gateway

模型推理仍然可以在外部云端完成

这种架构的特点是：

- Agent 可以直接读取本地文件。
- Shell、Git、文件搜索不需要远程 RPC。
- 不同项目的 Agent 上下文天然隔离。
- 每个 Sandbox 可以独立安装语言环境、工具和依赖。
- Sandbox 销毁时，Agent 进程也会结束。

OpenHands V1 官方文档明确指出，Docker Sandbox 本身运行的就是 Agent Server。

GitHub

Cloudflare 的 Coding Agents 指南也明确采用在 Sandbox 中运行 Claude Code、Codex 或 OpenCode 的模式，并通过外部网关保护模型凭证。

Cloudflare Sandboxes docs

#### 针对你要做的 Atoms 类产品，我推荐混合架构

我会采用下面的设计：

Hostinger VPS — 服务端

Next.js API + Agent Orchestrator

Supervisor、任务拆解、HITL、任务队列

Model Gateway + 数据库

API Key、用量统计、Checkpoint、项目状态

任务分发 / 状态事件 / 模型代理

Sandbox 执行层

Project A

Coding Agent

Shell · Files · Browser · Preview

Project B

Coding Agent

Shell · Files · Browser · Preview

#### 为什么这样设计？

Supervisor 放在服务端。

因为它负责跨项目和跨 Agent 的编排，必须能够管理任务生命周期，不能随着某个 Sandbox 的销毁而消失。

例如：

```txt
Supervisor
    |
    +-- Research Agent
    |
    +-- Product Agent
    |
    +-- Architect Agent
    |
    +-- Coding Agent → Sandbox A
    |
    +-- Coding Agent → Sandbox B
```

Coding Agent 放在 Sandbox 内。

因为它需要频繁操作项目文件、运行命令、安装依赖、读取错误日志。放在 Sandbox 内可以减少通信成本，也更容易复用 Claude Code、OpenCode 等现成的 Coding Agent。

模型凭证放在服务端。

即使 Coding Agent 在 Sandbox 内，也不建议把真实 LLM API Key 直接注入不可信执行环境。可以让 Coding Agent 通过 Model Gateway 调用模型，由服务端完成鉴权、密钥注入、用量统计和限额控制。

#### 需要注意一个关键的安全问题

Agent 和用户生成的代码放在同一个 Sandbox，虽然开发方便，但存在风险：

如果用户生成的代码能够访问 Agent 进程的环境变量、内存、文件或本地服务，就可能窃取模型凭证、会话令牌，甚至通过 Agent 的权限访问其他资源。

所以有两种落地选择：

| 场景 | 推荐 |
| --- | --- |
| 自己使用的 Demo | Coding Agent 与项目代码运行在同一个 Sandbox |
| 公开 SaaS，执行不可信代码 | Agent Runtime 与用户代码执行环境进一步隔离 |

对于公开 SaaS，第二种方式更稳妥。可以让 Coding Agent 位于受保护的 Worker 中，通过 RPC 操作独立 Sandbox，而不是与用户代码共享全部权限。

#### 最后怎么选？

我的建议分两个阶段。

MVP 阶段：

直接用一台 Hostinger VPS，部署 Supervisor、数据库和任务队列，再用 Docker 启动 Coding Agent Sandbox。先把生成、构建、预览的闭环跑通。

正式 SaaS 阶段：

将控制平面与执行平面分离，尤其把不可信代码执行放到更强隔离的 Sandbox 中。届时可以考虑 E2B、Daytona，或者自建 MicroVM。

如果你准备自己开发 Agent Runtime，我建议优先研究 OpenHands V1 的 Agent Server 架构。它的实现方式和你要做的产品非常接近，而且是开源的：

- [OpenHands GitHub](https://github.com/OpenHands/OpenHands?utm_source=chatgpt.com)
- [OpenHands V1 Sandbox 设计](https://github.com/OpenHands/docs/blob/main/openhands/usage/advanced/custom-sandbox-guide.mdx?utm_source=chatgpt.com)
- [Daytona Control Plane / Compute Plane 架构](https://www.daytona.io/docs/en/architecture/?utm_source=chatgpt.com)

最关键的架构决策其实不是 Agent 放哪里，而是：Agent 的推理状态、工具执行权限和项目运行环境，是否必须绑定在一起。 我建议从第一天就在代码层面把这三者抽象开，即使最初全部部署在同一台 VPS 上。

---

# 第三部分｜Vercel、VPS 与 Docker 部署

可以，但要区分 Vercel 和 Hostinger VPS。如果你想实现类似 Atoms 的 AI 全栈应用生成平台，包括 Multi-Agent、Coding Agent、Sandbox、实时预览，我更推荐 一台 Hostinger VPS 起步，Vercel 作为可选的前端部署平台。

#### 两种方案对比

| 能力 | Vercel | Hostinger VPS |
| --- | --- | --- |
| Next.js 前端 |  |  |
| Agent API |  |  |
| 长时间 Agent 任务 | 需要外部任务执行器 |  |
| 多 Agent 并发 | 受函数运行限制 | 受机器资源限制 |
| Docker Sandbox | 不能直接运行 Docker 守护进程 |  |
| 用户代码执行 | 需要外部 Sandbox 服务 | 可自行搭建隔离环境 |
| 实时预览服务 | 需要外部运行环境 |  |
| 数据库 | 外部托管 | 可以自己部署 |
| Redis / 任务队列 | 外部托管 | 可以自己部署 |
| 部署维护 | 简单 | 需要自己运维 |

关键区别：Vercel 适合部署 Web 应用和 API，但不适合直接承担任意用户代码的持久化执行环境。

Vercel 也可以结合 Sandbox 产品或外部容器平台完成这些能力，但就不再是单纯的一个 Vercel 服务。

#### 推荐方案：一台 Hostinger VPS

如果是 MVP，我建议采用下面的架构：

用户浏览器

聊天、任务进度、代码编辑、应用预览

Hostinger VPS

单机部署

Next.js

Web UI + API + SSE

Agent Worker

Supervisor / Coding Agent

Redis

任务队列与状态

PostgreSQL

用户、项目、任务

Docker Manager

Sandbox 生命周期

Sandbox Containers

Project A

Project B

Project C

每个项目独立运行 Node.js、开发服务器和文件系统

外部 LLM API

OpenRouter / Gemini / Claude

这套架构可以全部通过 Docker Compose 部署在一台机器上。

例如：

```txt
docker-compose.yml
├── web              # Next.js
├── agent-worker     # Agent Runtime
├── redis            # 任务队列
├── postgres         # 数据库
├── sandbox-manager  # 容器管理
└── traefik          # 反向代理
```

注意：Sandbox Manager 必须限制容器权限，不能直接把 Docker Socket 暴露给用户代码。对于不可信代码，还需要考虑容器逃逸、网络隔离、资源配额等安全问题。普通 Docker 容器不等于强安全隔离。

#### 一台 VPS 能支持多少个 Agent？

这里要区分 Agent 并发 和 Sandbox 并发。

Agent 调用云端 LLM API 时，主要消耗网络和少量内存，通常不是最大的瓶颈。

真正消耗资源的是 Sandbox，例如：

- 安装 npm 依赖。
- 执行 Next.js 构建。
- 启动多个开发服务器。
- 运行 Playwright 浏览器。
- 执行用户生成的代码。

以一台 4 vCPU、8GB RAM 的 VPS 为例：

| 负载 | 粗略估计 |
| --- | --- |
| Agent API 请求 | 数十个等待模型响应的任务 |
| 活跃 Next.js Sandbox | 约 2–4 个轻量项目 |
| 同时执行 Next.js Build | 建议先限制为 1 个 |
| Playwright 浏览器验证 | 建议限制 1–2 个 |

这些只是初始容量规划估计，不是性能测试结果。实际取决于项目大小、内存限制、浏览器数量及模型调用模式。

#### 如果只做 MVP，我会进一步简化

你甚至不需要一开始就部署完整的 Multi-Agent 系统。

第一阶段：

- 一个 Next.js 应用。
- 一个 Coding Agent Worker。
- PostgreSQL 保存任务状态。
- Docker Sandbox 执行生成代码。
- SSE 推送执行过程。
- 外部 LLM API。

等有真实用户后，再引入 Redis、任务队列、Supervisor 和多 Agent。

这样可以避免一开始把大量时间花在基础设施上。

#### 我会怎么选择

只是做 Demo，不需要执行用户代码

选 Vercel。部署简单，适合验证需求、聊天和静态页面生成。

要做真正的 AI Coding 平台

选 Hostinger VPS。能够自己管理 Agent Worker、Sandbox、文件系统和预览服务。

后续准备面向大量真实用户

将 Web 部署在 Vercel，Agent Worker 和 Sandbox 放在独立计算环境，数据库使用托管服务。

我的建议是：先用一台 4 vCPU / 8GB VPS 做技术验证，如果需要并行运行多个 Next.js Sandbox，再考虑升级到 8 vCPU / 16GB 或增加独立 Sandbox 节点。

不过有一个问题会直接影响技术选型：

你想做的是 Atoms 那种「用户输入需求 → AI 生成完整项目 → 在线运行预览」的平台，还是只想实现它的「Multi-Agent 协作系统」？

前者最大的难点是 Sandbox 和应用部署，后者一台普通 VPS 就能比较轻松地起步。

## Docker 部署与费用

Docker 直接安装在你的 Hostinger VPS 上就可以，不需要额外购买。

Docker Engine 和 Docker Compose 都是免费使用的（Linux 服务器上的 Docker Engine 不需要购买 Docker Desktop 订阅）。

架构大概是：

```txt
Hostinger VPS（Ubuntu）
│
├── Docker Engine（免费安装）
│   │
│   ├── Container 1：Next.js
│   ├── Container 2：Agent Worker
│   ├── Container 3：PostgreSQL
│   ├── Container 4：Redis
│   │
│   └── Sandbox Containers
│       ├── 用户项目 A
│       ├── 用户项目 B
│       └── 用户项目 C
│
└── Caddy / Traefik（反向代理）
```

#### 如何安装？

购买 Hostinger 的 KVM VPS（推荐 Ubuntu 24.04） 后，通过 SSH 登录服务器，执行：

```txt
**安装 Docker**
curl -fsSL https://get.docker.com | sh

**验证**
docker --version
docker compose version
```

生产环境建议按照 Docker 官方文档配置软件源安装，方便管理版本和更新。

#### 需要注意的地方

- Docker 容器共享 VPS 的 CPU、内存和磁盘，并不是每个容器都有独立服务器资源。
- 你可以创建很多容器，但同时运行的数量受 VPS 配置限制。
- 如果是 4 vCPU / 8GB 内存的 VPS，建议先控制在 2–4 个轻量 Sandbox 并发，并根据实际内存占用调整。
- Docker 本身免费，但 VPS 资源、额外存储和网络流量仍可能产生费用。

所以你现在只需要购买一台 Hostinger VPS，就可以在上面安装 Docker，运行 Next.js、Agent、数据库以及用户项目 Sandbox。

唯一要特别注意的是：如果你准备允许陌生用户执行 AI 生成的任意代码，普通 Docker 容器的隔离强度可能不够，需要进一步强化安全隔离。

---

# 第四部分｜准备清单、成本与实施路线

需要。如果你打算用 一台 Hostinger VPS 搭建类似 Atoms 的 AI 应用生成平台，除了服务器，还需要准备域名、模型 API、数据库、Sandbox 运行环境等。

不过大部分都可以直接部署在 VPS 上，不需要额外购买服务。

#### 需要准备的东西

部署准备清单

0/10 已完成

- [ ] Hostinger VPS

初期需要

推荐 Ubuntu 24.04，MVP 从 4 vCPU / 8GB 内存起步

- [ ] 域名

初期需要

例如 [app.example.com](http://app.example.com)、[preview.example.com](http://preview.example.com)，配置 DNS

- [ ] LLM API Key

初期需要

OpenRouter、Claude 或 Gemini，按 Token 使用量付费

- [ ] Docker + Docker Compose

初期需要

部署 Web、Agent Worker、数据库及 Sandbox

- [ ] PostgreSQL

初期需要

存储用户、项目、任务、消息及版本元数据

- [ ] HTTPS / 反向代理

初期需要

Caddy 或 Traefik，支持 HTTPS、SSE 和预览路由

- [ ] 对象存储

按需增加

用于保存代码快照、图片和构建产物，初期可用 VPS 磁盘

- [ ] Redis + BullMQ

按需增加

长任务队列、并发限制、任务恢复，初期可先用数据库队列

- [ ] 登录认证

按需增加

Auth.js 或其他认证方案，公开测试前建议接入

- [ ] 监控与备份

按需增加

错误日志、磁盘监控、数据库备份，正式开放前必备

#### 还有几个容易忽略的技术准备

#### 1. Sandbox 隔离

这是整个系统最需要重视的地方。因为 Agent 会执行生成的代码，而代码可能不安全。

至少需要实现：

- 每个项目独立工作目录和运行环境。
- CPU、内存、磁盘、执行时间限制。
- 限制容器权限、文件系统访问和网络访问。
- Sandbox 自动休眠、超时清理。
- 禁止用户代码访问宿主机密钥、数据库和 Docker Socket。

如果准备公开给陌生用户使用，建议采用 gVisor、MicroVM 或专门的 Sandbox 服务，不能仅依赖普通 Docker 容器作为安全边界。

#### 2. 预览域名和 HTTPS

例如你购买了 <code>example.com</code>，可以设计为：

| 域名 | 用途 |
| --- | --- |
| <code>app.example.com</code> | 平台前端 |
| <code>api.example.com</code> | Agent API |
| <code>*.preview.example.com</code> | 每个项目的实时预览 |

预览域名需要配置通配符 DNS 和 HTTPS 证书，并通过反向代理转发到对应 Sandbox。预览内容还需要鉴权、隔离 Cookie，防止不同项目之间相互访问。

#### 3. Agent 长任务可靠性

生成一个完整应用可能持续数分钟甚至更长，不能依赖一次 HTTP 请求执行到底。

建议：

```txt
用户提交任务
      ↓
API 创建任务记录
      ↓
Worker 异步执行 Agent
      ↓
持久化 Checkpoint / 执行日志
      ↓
SSE 实时推送进度
      ↓
Sandbox 执行和验证
      ↓
保存结果和版本
```

这样用户关闭浏览器后，任务也可以继续执行。

#### 成本大概多少？

以下是用于规划的粗略月度预算，不是 Hostinger 或模型供应商的实时报价。

| 项目 | 预估月成本 |
| --- | --- |
| VPS（4 vCPU / 8GB） | \$10–30 |
| 域名（按年费折算） | \$1–2 |
| HTTPS 证书 | 免费 |
| PostgreSQL / Redis | 自部署免费 |
| Docker / Caddy | 免费 |
| LLM API | \$20–100+ |
| 备份与存储 | \$0–10 |
| 合计 | 约 \$31–142+ |

实际最大的可变成本通常是 LLM Token、构建计算和 Sandbox 并发量。

#### 建议的开发顺序

阶段一：基础环境

VPS、域名、Docker、Next.js、PostgreSQL、HTTPS。

阶段二：Coding Agent

实现文件读写、Shell 工具、模型调用、任务持久化和流式输出。

阶段三：Sandbox + Preview

自动创建项目环境、安装依赖、启动开发服务器、提供在线预览。

阶段四：Multi-Agent

引入 Supervisor、任务拆解、Sub-Agent、HITL、自动验证与修复。

如果是你自己做技术验证，我建议先不要买太多服务。 一台 VPS、一个域名、一个模型 API Key，就足够开始搭建核心原型；其余组件尽量自部署。

另外还需要区分两个功能：在线预览和正式发布用户生成的应用。前者可以直接通过 Sandbox 实现，后者还涉及持久化部署、数据库隔离、自定义域名、资源计费等额外基础设施，复杂度会明显增加。

你准备做的是 自己使用的技术 Demo，还是打算 开放给其他用户注册使用的 SaaS 产品？这会直接决定是否需要一开始就引入更强的 Sandbox 隔离和计费体系。
