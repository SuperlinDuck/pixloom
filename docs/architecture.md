# Pixloom v0.2 架构

## 数据与执行

```text
React 工作台
  ├── Next.js API → SQLite（项目、任务、事件、版本、Worker 租约）
  └── 轮询项目/任务状态 → sandbox iframe 预览

独立 Worker → 领取任务 → ModelProvider → Gemini / GPT
                      → JSON 解析 → HTML/JS 静态检查
                      → 检查失败最多修复一次
                      → 原子保存版本与任务完成状态
```

- `src/lib/store.ts`：持久化边界，事务保护任务创建、领取、完成和恢复版本。每项目最多一个活跃任务。SQL 参数绑定。
- `src/lib/ai/provider.ts`：统一 `ModelProvider`，共享 `{summary, html}` 输出格式，分别适配 Gemini generateContent 与 GPT Responses。API Key 不进入浏览器或请求 URL，供应商错误正文不持久化。
- `src/lib/runner.ts`：读取当前版本和最近六条成功需求，调用模型、检查输出、修复、取消和超时。
- `scripts/worker.ts`：独立执行循环，每三秒续租；15 秒无心跳视为离线。新 Worker 获得租约后重新排队中断任务。当前仅支持本机单 Worker，不适合分布式调度。
- `src/lib/artifact.ts`：parse5 规范化 HTML，Acorn 检查脚本与事件语法，拒绝外部资源引用与嵌入容器。不在服务器执行生成代码。
- `src/lib/preview.ts`：在所有生成内容前插入限制性 CSP；iframe 仅允许脚本，不授予同源权限。模型必须使用内存状态。
- `src/components/workspace.tsx`：项目、聊天、代码、预览、历史与导出。状态每 1.5–3 秒轮询；切换项目时丢弃旧请求结果。

SQLite 使用 WAL 与 busy timeout，写入采用同步短事务；不会将网络调用放入事务。保存版本和任务完成状态在同一事务中，失败和取消都保留此前的当前版本。恢复历史版本只改变当前指针，不删除任何版本；下次生成会以恢复后的代码为基线。

## Docker 执行环境

已新增固定 React/Vite 模板的执行平面，详见 [Docker 执行环境](docker-runtime.md)。`runtime_jobs` 由现有 Worker 处理，`runtime_workspaces` 保存独立的当前源码快照；不改变 HTML 聊天生成与版本结构。容器无网络、无宿主目录挂载，构建预览经固定控制程序读取。

## 范围与下一步

1. Docker Sandbox 基础已实现：文件接口、固定构建命令、资源限制、生命周期与构建产物预览。当前浏览器单文件模式继续保留。
2. 增加 React/Vite 固定模板与文件树，生成多文件补丁、真实构建，并加入浏览器验证。将一次结构化生成演进为有预算限制的工具调用循环。
3. 在公开使用前补齐认证、项目归属、调用额度、存储限额、预览域名隔离及日志审计。多机部署时切换 PostgreSQL 与任务队列，加入任务租约及完整 fencing。
4. 拆分规划与实现角色，保存 PRD/方案等产物，并引入人工方案审批。复杂任务走团队模式，简单修改仍直接交给 Coding Agent。
5. 最后添加应用后端能力、正式发布、独立应用配置和自定义域名。

## API

| 方法       | 路径                                    | 用途                                                    |
| ---------- | --------------------------------------- | ------------------------------------------------------- |
| GET / POST | `/api/projects`                         | 列表 / 创建，`example: true` 创建内置示例               |
| GET        | `/api/projects/:id`                     | 项目、任务、事件和完整历史版本                          |
| POST       | `/api/projects/:id/tasks`               | `{prompt, provider}` 创建异步任务，服务端选择已配置模型 |
| POST       | `/api/tasks/:id`                        | 取消任务                                                |
| POST       | `/api/projects/:id/versions/:versionId` | 恢复当前版本指针                                        |
| GET        | `/api/status`                           | 模型名称、是否已配置、Worker 在线状态，不包含密钥       |

所有 POST 使用 JSON；模型输入最大 12000 字符、请求最大 32KB、模型生成 HTML 最大 300000 字符。模型超时 180 秒，最多两次生成（原始一次、静态验证修复一次）。API 仅供本机单用户使用。
