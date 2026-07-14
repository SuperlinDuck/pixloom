# Pixloom GitHub Actions 自动部署手册

最后维护日期：2026-07-14

本文说明 Pixloom 官网如何在代码进入 `main` 后，通过 GitHub Actions 自动登录 Hostinger VPS、拉取代码、构建并使用 PM2 平滑重载。

## 一、部署流程

```text
开发分支提交
  -> Pull Request 合并到 main
  -> GitHub Actions 触发 Deploy Pixloom
  -> SSH 登录 deploy@69.62.86.160
  -> git pull --ff-only origin main
  -> pnpm install --frozen-lockfile
  -> pnpm run build
  -> pm2 reload --update-env
  -> 本机 3000 端口健康检查
```

工作流文件：`.github/workflows/deploy.yml`

触发条件：

- 有提交进入 `main`。
- 在 GitHub Actions 页面手动执行 `workflow_dispatch`。

推送开发分支或仅创建 Pull Request 不会部署。建议始终通过开发分支和 Pull Request 合并到 `main`，避免未审核代码直接进入生产环境。

## 二、SSH 密钥方向

自动部署涉及两套不同的 SSH 密钥，不要复用：

| 密钥 | 方向 | 用途 |
|---|---|---|
| `~/.ssh/pixloom_github` | VPS -> GitHub | deploy 用户从 GitHub 私有仓库拉取代码 |
| `~/.ssh/pixloom_actions` | GitHub Actions -> VPS | Actions 以 deploy 用户登录 VPS |

两者都只授予完成任务所需的最小权限。

## 三、创建 Actions 登录 VPS 的密钥

在管理员本机创建，不要在仓库中创建：

```bash
ssh-keygen -t ed25519 \
  -C "github-actions-pixloom" \
  -f ~/.ssh/pixloom_actions \
  -N ""
```

生成：

```text
~/.ssh/pixloom_actions       私钥，仅保存到 GitHub Secret
~/.ssh/pixloom_actions.pub   公钥，添加到 VPS
```

验证私钥格式：

```bash
ssh-keygen -y -f ~/.ssh/pixloom_actions >/dev/null
echo $?
```

返回 `0` 表示私钥可读取。

## 四、授权 deploy 用户登录

`~/.ssh/authorized_keys` 是文件，不是目录。已有该文件时，只追加新公钥，不要覆盖已有内容。

在本机查看公钥：

```bash
cat ~/.ssh/pixloom_actions.pub
```

在 VPS 上以 deploy 登录：

```bash
ssh deploy@69.62.86.160
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

将公钥完整追加为新的一行，例如：

```text
ssh-ed25519 AAAAC3... github-actions-pixloom
```

回到本机测试免密登录：

```bash
ssh -i ~/.ssh/pixloom_actions deploy@69.62.86.160
```

必须能够免密码登录后，再配置 GitHub Actions。

## 五、记录 VPS 主机密钥

GitHub Actions 应验证目标 VPS 的 SSH 主机密钥，避免连接到被冒充的服务器。

在 VPS 上以 root 查看 ED25519 指纹：

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

输出类似：

```text
256 SHA256:... root@srv1818909 (ED25519)
```

这是供人工核对的指纹，不是 `VPS_KNOWN_HOSTS` 的值。

生成 `known_hosts` 格式的一整行：

```bash
awk '{print "69.62.86.160 " $1 " " $2}' \
  /etc/ssh/ssh_host_ed25519_key.pub
```

输出格式：

```text
69.62.86.160 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...
```

重装 VPS 后主机密钥通常会变化，需要重新核对并更新 GitHub Secret。

## 六、配置 GitHub Actions Secrets

进入 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

分别创建：

| Name | Secret 内容 |
|---|---|
| `VPS_HOST` | `69.62.86.160` |
| `VPS_USER` | `deploy` |
| `VPS_KNOWN_HOSTS` | `69.62.86.160 ssh-ed25519 AAAA...` 完整一行 |
| `VPS_SSH_KEY` | `~/.ssh/pixloom_actions` 的完整多行私钥 |

`VPS_SSH_KEY` 必须包含首尾标记和全部中间内容：

```text
-----BEGIN OPENSSH PRIVATE KEY-----
多行私钥内容
-----END OPENSSH PRIVATE KEY-----
```

填写要求：

- 保留原始换行。
- 不加引号、缩进或 Markdown 围栏。
- 不要填入以 `ssh-ed25519` 开头的 `.pub` 公钥。
- 私钥不得发送到聊天、日志或提交到 Git。

如果本机已安装并登录 GitHub CLI，也可以避免手工复制：

```bash
gh secret set VPS_SSH_KEY < ~/.ssh/pixloom_actions
```

## 七、工作流说明

当前工作流使用以下关键配置：

```yaml
on:
  push:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: pixloom-production
  cancel-in-progress: false
```

同一时间只允许一个生产部署运行，新的部署不会取消正在进行的部署。

SSH 配置阶段：

```yaml
- name: Configure SSH
  env:
    VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
    VPS_KNOWN_HOSTS: ${{ secrets.VPS_KNOWN_HOSTS }}
  run: |
    install -m 700 -d ~/.ssh
    printf '%s\n' "$VPS_SSH_KEY" > ~/.ssh/pixloom_actions
    chmod 600 ~/.ssh/pixloom_actions
    printf '%s\n' "$VPS_KNOWN_HOSTS" > ~/.ssh/known_hosts
    chmod 600 ~/.ssh/known_hosts
```

VPS 部署阶段按顺序执行：

```bash
set -euo pipefail

cd /var/www/pixloom
git fetch origin main
git checkout main
git pull --ff-only origin main

pnpm install --frozen-lockfile
pnpm run build

pm2 reload ecosystem.config.js --update-env
pm2 save

curl --fail --silent --show-error \
  --retry 5 \
  --retry-delay 2 \
  http://127.0.0.1:3000/ >/dev/null
```

`set -euo pipefail` 会在拉取、安装或构建失败时立即停止，失败构建不会执行 PM2 reload。`git pull --ff-only` 防止 VPS 上产生非预期的合并提交。

健康检查访问应用本机端口，不经过公网 DNS 和 Nginx。根路径返回 3xx 语言跳转时仍视为服务可响应。

## 八、开发和上线流程

推荐从开发分支提交：

```bash
git switch -c ci/vps-auto-deploy
git add .github/workflows/deploy.yml
git commit -m "ci: add VPS automatic deployment"
git push -u origin ci/vps-auto-deploy
```

在 GitHub 创建 Pull Request：

```text
ci/vps-auto-deploy -> main
```

PR 合并进入 `main` 后，`Deploy Pixloom` 自动运行。查看：

```text
GitHub repository -> Actions -> Deploy Pixloom
```

## 九、环境变量处理

自动部署不会创建、覆盖或上传 `.env`。生产环境变量继续只保存在：

```text
/var/www/pixloom/.env
```

工作流中的：

```bash
pm2 reload ecosystem.config.js --update-env
```

会让普通服务端变量在重载时生效。修改 `NEXT_PUBLIC_*` 时，由于工作流始终执行 `pnpm run build`，合并到 `main` 后的自动部署会重新生成浏览器端产物。

手工修改 VPS `.env` 后，如果没有代码提交，不会自动触发 Actions；按主部署手册使用 deploy 手动 build/reload。

## 十、验证部署

GitHub Actions 成功后，以 deploy 登录 VPS：

```bash
pm2 status
pm2 logs pixloom --lines 100
curl -I http://127.0.0.1:3000
```

公网验证：

```bash
curl -IL --max-redirs 5 https://pixloom.io
curl -IL --max-redirs 5 https://www.pixloom.io
```

## 十一、常见问题

### Load key: error in libcrypto

原因通常是 `VPS_SSH_KEY` 格式损坏、换行丢失，或误填了公钥。

处理步骤：

1. 本机运行 `ssh-keygen -y -f ~/.ssh/pixloom_actions >/dev/null`，确认原私钥有效。
2. 重新创建 `VPS_SSH_KEY`。
3. 从 `-----BEGIN OPENSSH PRIVATE KEY-----` 到 `-----END OPENSSH PRIVATE KEY-----` 完整粘贴。
4. 保留所有换行，不添加引号或缩进。

### Permission denied (publickey,password)

先在本机验证：

```bash
ssh -i ~/.ssh/pixloom_actions deploy@69.62.86.160
```

如果不能免密登录，检查 VPS 的 `/home/deploy/.ssh/authorized_keys` 是否包含与该私钥匹配的公钥，以及目录和文件权限是否分别为 700、600。

### Host key verification failed

检查 `VPS_KNOWN_HOSTS` 是否为完整的：

```text
69.62.86.160 ssh-ed25519 AAAA...
```

不要把 `SHA256:...` 指纹填入该 Secret。VPS 重装后应重新获取主机公钥。

### pnpm: command not found 或 pm2: command not found

确认 Node.js、pnpm 和 PM2 已为 deploy 的非交互 SSH 环境提供，并测试：

```bash
ssh deploy@69.62.86.160 'node -v && pnpm -v && pm2 -v'
```

### git pull --ff-only 失败

VPS 生产目录不应直接修改受 Git 管理的文件。检查：

```bash
cd /var/www/pixloom
git status
git branch --show-current
```

保留 `.env`、日志和上传文件，但将源码修复提交到开发分支，再通过 PR 合并。

### 日志中的 deploy 被显示为星号

GitHub 会自动遮盖 Secret 值。因为 `VPS_USER` 的值是 `deploy`，日志中的普通单词 `deployment` 可能显示成 `***ment`。这不是部署错误。

## 十二、安全和维护

- 不要复用 `pixloom_github` 和 `pixloom_actions`。
- 不要授予 GitHub Deploy Key 写权限。
- 不要把 root 私钥交给 GitHub Actions；Actions 只以 deploy 登录。
- GitHub Secrets 不得写入工作流、仓库文件或日志。
- 离职、设备丢失或疑似泄露时，立即轮换对应 SSH 密钥。
- 重装 VPS 后更新 `VPS_KNOWN_HOSTS`。
- 定期检查 GitHub Actions 运行记录和 PM2 日志。
- 生产回滚优先在 Git 中回退到已验证提交，再由 Actions 重新部署。
