# Docker 执行环境（v0.3 基础）

此阶段实现固定 React/Vite 模板的执行环境，独立于原有 HTML 聊天生成模式。模板是手写示例，不会被标记为 AI 生成。

## 本地使用

1. 安装并启动 Docker Desktop（Mac 选择 Apple Silicon 或 Intel 对应版本）。
2. 在仓库根目录运行：

```sh
pnpm sandbox:doctor
pnpm sandbox:prepare
pnpm sandbox:verify
pnpm dev
```

首次 doctor 可能提示缺少镜像，随后执行 prepare 即可。prepare 会从官方 Node 镜像构建 `pixloom-runtime:react-v1`，并通过锁文件安装固定依赖；不读取 `.env.local` 作为构建上下文。构建上下文仅为 `sandbox/`，其 `.dockerignore` 排除依赖目录和本地配置。

如果 CLI 不在 PATH 中，会自动检查 Docker Desktop 常见安装路径。其他位置可在 `.env.local` 设置 `PIXLOOM_DOCKER_BIN` 指向可信的 Docker CLI，修改后重启 Web 与 Worker。Web、Worker 和 CLI 应使用同一个 Docker context。

打开一个项目，切换到「环境」页：

- **创建 React 环境**：创建独立容器，写入固定模板。
- **构建预览**：在容器中执行固定 Vite 构建；成功后切换「React 预览」。
- **源码**：选择文件、修改并保存，然后重新构建预览。
- **操作日志**：查看构建输出、失败信息或读取容器服务日志。
- **停止 / 启动**：停止容器会释放临时文件系统；重新启动时从数据库恢复源码，需重新构建。
- **移除**：删除容器、释放资源，数据库中的已保存源码仍保留，可以重新创建环境。
- **取消操作**：停止当前操作；若操作已进入容器执行，会尝试停止容器，防止只终止 CLI 却留下构建进程。

源码保存与构建通过独立 Worker 排队执行，关闭页面后继续运行。每项目最多一个环境操作，全局最多保留三个环境。Docker 不可用、镜像未准备或 Worker 离线时，界面显示明确原因。

## Runtime 接口

`src/lib/runtime/types.ts` 定义 `ProjectRuntime`，`docker.ts` 实现 Docker CLI 适配器：

- 容器创建、状态、启动、停止、移除。
- 文件列表、读取、搜索、写入。
- 固定 `build` 命令、日志读取、构建结果预览。
- Docker 健康检查与镜像准备。

宿主机通过无 shell 的子进程参数调用 Docker；文件内容通过 stdin 传递。容器操作仅调用镜像内固定的 `control.cjs`，不提供任意宿主机或容器 Shell API。所有容器操作同时验证项目 UUID 和管理标签，不会停止或删除其他容器。

## 资源与文件边界

每个容器使用：

- 非 root 用户 `1000:1000`、只读根文件系统。
- `cap-drop=ALL`、`no-new-privileges`、128 个进程上限。
- 1 CPU、512 MiB 内存，禁用额外 swap。
- `/workspace` 64 MiB tmpfs、`/tmp` 16 MiB tmpfs。
- `network=none`，不发布端口，不挂载宿主目录或 Docker Socket。
- 有限轮转日志；构建子进程最多运行 90 秒，环境操作总时限 150 秒。

模型 Key 不进入容器。项目运行时不安装依赖、不访问外网；固定依赖仅在准备镜像时安装。依赖和 Vite 配置位于只读镜像路径，编辑接口只允许 `index.html` 和 `src/` 下的指定文本源码。每文件最多 128 KiB、最多 64 个文件、源码总计最多 1 MiB，拒绝路径穿越、隐藏文件与符号链接。

这些措施用于本机受控原型，不等于面向陌生用户执行任意代码的完整安全边界。

## 预览如何工作

容器内固定 Node 静态服务监听自身 loopback 的 4173 端口。它只读取 `/workspace/dist` 下的构建产物；不对宿主机发布端口。

```text
工作台中的 sandbox iframe
  → /api/runtime-preview/<随机令牌>/...
  → Docker exec 固定控制程序
  → 容器内部 loopback 静态服务
  → HTML / JS / CSS 构建资源
```

预览响应包含 CSP sandbox，iframe 仅允许脚本，不授予同源、外部网络、表单提交、弹窗或宿主页面访问权限。由于 ES Modules 在 opaque origin 中加载，预览资源提供 CORS；其他平台 API 仍拒绝跨站请求。随机令牌只标识对应项目环境，本版本仍仅限本机使用，不是公开 SaaS 的认证替代。

这是**构建产物预览**，尚未实现 Vite 开发服务器、WebSocket 或 HMR。当前每个资源经过一次 Docker exec，适合验证执行链路；后续可以替换为专用预览网关。

## 持久化与恢复

SQLite 新增 `runtime_workspaces` 与 `runtime_jobs`，旧项目数据不需要重建。容器内文件使用临时文件系统，持久源码保存在 SQLite 中。Worker 重启会重新排队中断操作，创建操作可接管先前创建的本项目容器；构建可重试，失败不会被标为预览就绪。

源码保存后会将已构建状态失效，避免继续展示过时的产物。构建失败或取消后，需修复并重新构建。此阶段尚无 Docker 源码的历史版本；原有 HTML 版本恢复不会改变 Docker 源码，下一阶段将统一多文件快照与版本流程。

## 验证

`pnpm sandbox:verify` 创建随机 ID 的测试容器，验证：创建、源码读取与修改、构建成功、预览 HTML 和资源、错误源码构建失败、停止、源码恢复和重新构建。无论成功或失败，都尝试清理这个测试容器，不操作用户项目容器。

`pnpm test` 覆盖文件边界、容器归属与启动参数、操作中断、任务恢复、状态和源码持久化；GitHub Actions 另设 Docker 实机验证任务。

2026-10-24 已在本机 Docker Engine 29.9.2 上通过容器验证。浏览器已验证工作台创建与构建、源码编辑保存，以及隔离预览中 React 计数器的按钮交互。

## 接口

| 方法 | 路径                                         | 用途                                                  |
| ---- | -------------------------------------------- | ----------------------------------------------------- |
| GET  | `/api/projects/:id/runtime`                  | 环境快照、最近操作、Docker 与 Worker 状态             |
| POST | `/api/projects/:id/runtime`                  | `action: create/start/build/stop/remove/write/cancel` |
| GET  | `/api/projects/:id/runtime?files=1`          | 容器中的源码文件列表                                  |
| GET  | `/api/projects/:id/runtime?file=src/App.jsx` | 容器中的源码内容                                      |
| GET  | `/api/projects/:id/runtime?search=useState`  | 有上限的文本搜索                                      |
| GET  | `/api/projects/:id/runtime?logs=1`           | 容器服务日志                                          |
| GET  | `/api/runtime-preview/:token/...`            | 隔离预览资源，仅预览就绪时可读                        |

## 官方参考

- [Docker 容器运行参数](https://docs.docker.com/reference/cli/docker/container/run/)
- [Docker 资源限制](https://docs.docker.com/engine/containers/resource_constraints/)
- [Vite 服务配置](https://vite.dev/config/server-options)
