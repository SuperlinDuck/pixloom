# VPS 部署操作指南（GitHub Actions）

首次部署只按本文件的第 1–9 步顺序操作。VPS 初始化默认使用 root 登录；需要切换账号的命令已写明。`vps-deployment.md` 是上线后的运维参考，不需要同时执行另一套安装流程。

生产默认分支为 main。当前功能分支的普通 push 不部署；PR 执行 CI。合并到 main 后，Deploy Pixloom 调用同一套 CI，全部成功才使用现有 SSH secrets 部署该次提交。手动 workflow_dispatch 也只允许选择 main，不提供跳过检查的入口。

本流程的代码、工作流和故障回滚均可在本地验证；目标 VPS 的 systemd、真实域名和凭证需在一次性准备后验收。以下安装步骤需由运维在目标机器执行；普通功能分支 push 不会执行这些线上操作。

## 工作流

`.github/workflows/ci.yml` 是 PR 和部署共用的可复用工作流，执行测试、类型/格式检查、生产构建、Chromium 邀请流程及 Docker 运行环境验证。`.github/workflows/deploy.yml` 仅在 main push 或手动 main 运行；部署 job 依赖整个 checks job 成功。

CI 安装 Chromium 后，如果 runner 启用了 AppArmor 的非特权 user namespace 限制，会为 runner 缓存中的 Playwright 无头 Chromium 加载专用路径规则，并在构建前以 `chromiumSandbox: true` 实际启动浏览器验证。该规则只配置当前 runner；VPS 的 AppArmor 规则需要在 VPS 单独配置。

部署包来自经过检查的 `github.sha`，通过 `git archive` 生成，只包含跟踪的源码。SSH 严格核对 known_hosts，传输 SHA-256 摘要，VPS 验证摘要后拒绝路径穿越、链接、特殊文件、运行数据和密钥文件。VPS 无需再登录 GitHub，也不会执行 git pull 到正在运行的目录。

复用已有 Repository Secrets：

| 名称            | 用途                       |
| --------------- | -------------------------- |
| VPS_HOST        | VPS 地址                   |
| VPS_USER        | 复用现有 SSH 用户 `deploy` |
| VPS_SSH_KEY     | 部署 SSH 私钥              |
| VPS_KNOWN_HOSTS | 已核验的 SSH 主机公钥记录  |

可选 Repository Variable `VPS_SSH_PORT`，默认 22。非标准端口的 known_hosts 应含对应 `[host]:port` 条目。Google、模型、Cloud 和数据库密钥只存 VPS 的 `/etc/pixloom/pixloom.env`，不传给 Actions。

本指南复用现有 `deploy` 账号、SSH 密钥和 `VPS_USER=deploy`，另建 `pixloom` 服务账号：

| 账号      | 用途与权限                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `deploy`  | Actions 通过 SSH 登录，写入 `/srv/pixloom/incoming`，通过指定 sudo 命令调用部署控制器。                       |
| `pixloom` | 安装依赖、构建应用，运行 Web、Worker、Gateway，持有应用数据和 Docker 访问权限。无需配置 SSH 登录或免密 sudo。 |
| `root`    | 持有部署控制器、服务配置和备份，通过控制器完成服务切换及回滚。                                                |

不要把服务中的 `User=pixloom` 改成 `deploy`，也不要递归把 `/srv/pixloom` 全部交给 `deploy`。账号分开可避免应用进程直接使用部署账号的 SSH 文件和 sudo 权限；服务账号仍具有 Docker 控制权，需要作为高权限账号保护。首次安装需要 root 或已有管理权限的运维账号，下文给 `deploy` 的单条 sudo 授权只用于后续自动发布。

## 首次部署：按顺序执行

### 1. 备份旧站并检查基础环境（VPS，root）

旧应用在 `/var/www/pixloom`，由 PM2 运行。先备份旧目录的配置、数据库、上传文件和 PM2 配置，保留旧代码。此时先保持旧应用运行。新版不自动导入已移除的旧 HTML 项目数据，不要把旧目录的数据与新版空库混合复制。

服务器需使用 systemd，并安装 Node.js 24、pnpm 11.25.0、Docker Engine、Caddy、Python 3、curl、tar、flock（util-linux）及 sudo。先执行检查；缺失的软件需按服务器发行版安装后再继续：

```sh
node --version
pnpm --version
docker info
docker context show
caddy version
python3 --version
command -v curl tar flock sudo runuser visudo
systemctl is-active docker
id deploy
```

Node.js 必须为 24，Docker 使用本机默认 context。node、pnpm、docker 应能从 `/usr/local/bin:/usr/bin:/bin` 找到；只装在 root 的 nvm 目录中不适用。不要更改仍在运行的旧站依赖；如果升级 Node.js 会影响旧 PM2 服务，请纳入维护窗口处理。

新部署固定 Web 3000、Gateway 4180、数据 `/srv/pixloom/data`、发布 `/srv/pixloom/published`，HTTPS 使用标准 443。服务资源上限为 Web 2 GiB、Worker 3 GiB/2 CPU、Gateway 1 GiB；构建阶段另有资源上限，需根据机器容量评估。这些是限制值，不是最低配置承诺。

### 2. 创建服务账号和目录（VPS，root）

保留已有 deploy，单独创建 pixloom；如果 pixloom 已存在，跳过 useradd 并核对其 HOME 是 `/srv/pixloom`。

```sh
useradd --system --user-group --create-home --home-dir /srv/pixloom --shell /bin/bash pixloom
usermod -aG docker pixloom
# deploy 需要穿过父目录；私有子目录仍保持独立权限。
chmod 755 /srv/pixloom
install -d -o root -g root -m 755 /srv/pixloom/releases /usr/local/libexec/pixloom /var/lib/pixloom
install -d -o root -g root -m 700 /srv/pixloom/backups
install -d -o pixloom -g pixloom -m 700 /srv/pixloom/data /srv/pixloom/published /srv/pixloom/bootstrap
install -d -o deploy -g "$(id -gn deploy)" -m 700 /srv/pixloom/incoming
install -d -o root -g pixloom -m 750 /etc/pixloom
```

首次迁移不要创建 `/srv/pixloom/app` 普通目录，也不要提前启动新服务；app 链接由首次自动部署创建。

### 3. 首次获取部署脚本并安装依赖（VPS，root）

这一步只做一次初始化：把控制器脚本、服务配置、环境模板和生成 Caddy 配置所需的代码放到 bootstrap。Actions 随后会自动上传正式 release、构建和启动应用；它当前需要调用第 4 步安装的 `/usr/local/sbin/pixloom-deploy`，因此不能省略控制器的首次安装。bootstrap 本身不会成为线上版本。

**优先复用服务器旧仓库，不需要从电脑手动上传。** 旧流程使用 `/var/www/pixloom`，如果该仓库仍在，并且原部署用户 deploy 仍可访问 GitHub，在 VPS root 终端执行：

```sh
runuser -u deploy -- git -C /var/www/pixloom fetch origin codex/atoms-platform:refs/remotes/origin/codex/atoms-platform
runuser -u deploy -- git -C /var/www/pixloom archive --format=tar refs/remotes/origin/codex/atoms-platform > /root/pixloom-bootstrap.tar
```

这只更新 Git 引用并导出功能分支源码，不 checkout、不 pull，也不改变旧站的工作目录文件。若旧仓库属于别的账号，使用那个账号获取代码；不要改用 root 给旧仓库新增 GitHub 密钥或全局关闭 Git 所有权检查。任一命令失败时先停止，不要解包不完整的源码包。

仅当旧仓库已删除或服务器不能访问 GitHub 时，才使用下面的备用方式：在自己的电脑、当前项目目录打包上传。将 VPS_IP 替换为实际地址；SSH 不是 22 端口时给 scp 增加 `-P 端口`。

```sh
# 本机执行。先确认处于 codex/atoms-platform，且所需修改均已提交。
git branch --show-current
git status --short
git archive --format=tar --output=/tmp/pixloom-bootstrap.tar HEAD
scp /tmp/pixloom-bootstrap.tar root@VPS_IP:/root/pixloom-bootstrap.tar
```

以上两种方式任选一种。源码包准备好后，在 VPS 的 root 终端继续执行：

```sh
tar --extract --file=/root/pixloom-bootstrap.tar --directory=/srv/pixloom/bootstrap --no-same-owner --no-same-permissions
chown -R pixloom:pixloom /srv/pixloom/bootstrap
cd /srv/pixloom/bootstrap
runuser -u pixloom -- env HOME=/srv/pixloom PATH=/usr/local/bin:/usr/bin:/bin pnpm install --frozen-lockfile --prod=false
# 只安装浏览器系统依赖时使用 root；浏览器文件下载由服务账号完成。
pnpm exec playwright install-deps chromium
runuser -u pixloom -- env HOME=/srv/pixloom PATH=/usr/local/bin:/usr/bin:/bin pnpm exec playwright install chromium
```

bootstrap 是独立准备目录，不会替代旧站 checkout。备用上传方式中，root SSH 不可用时可先通过现有 deploy 上传，再由管理员复制源码包到 `/root/pixloom-bootstrap.tar` 后解包。不要上传开发 `.env.local`、node_modules 或运行中的 SQLite。首次准备完成后，日常发布直接合并 main 触发 Actions，无需重复获取 bootstrap 或手动上传应用代码；只有控制器自身更新时，仍需按第 4 步由管理员更新安装。

### 4. 安装控制器并授权 deploy（VPS，root）

```sh
cd /srv/pixloom/bootstrap
install -o root -g root -m 755 deploy/deploy.sh /usr/local/sbin/pixloom-deploy
install -o root -g root -m 644 deploy/deploy.mjs deploy/retire-worker.mjs deploy/archive.py /usr/local/libexec/pixloom/
install -o root -g root -m 700 deploy/backup.sh /etc/pixloom/backup.sh
install -o root -g root -m 644 deploy/pixloom-*.service deploy/pixloom-*.timer /etc/systemd/system/
systemctl daemon-reload
visudo -f /etc/sudoers.d/pixloom-deploy
```

在编辑器中写入并保存：

```sudoers
deploy ALL=(root) NOPASSWD: /usr/local/sbin/pixloom-deploy
```

然后验证文件权限和授权：

```sh
chown root:root /etc/sudoers.d/pixloom-deploy
chmod 440 /etc/sudoers.d/pixloom-deploy
visudo -c
runuser -u deploy -- sudo -n -l /usr/local/sbin/pixloom-deploy
```

deploy 无需为自动发布新增 `NOPASSWD: ALL` 或 Docker 组权限。发布代码的权限仍须按服务器管理员权限保护。若已有其他 sudo 授权，新增此规则不会收回旧权限。实际 SSH 用户名不同时，同时替换 VPS_USER、incoming 所有者和 sudoers 中的 deploy。

控制器、retire-worker.mjs 和 archive.py 必须 root 所有，不能由服务账号改写。以后这些控制器文件有改动，需在部署前由管理员重新执行对应 install 命令；应用代码、systemd 单元和备份脚本由控制器随版本更新。

### 5. 配置生产密钥、域名和 Google 登录（VPS root + DNS/Google 控制台）

配置 DNS：工作台 `pixloom.io`、Cloud `cloud.pixloom.io`、发布通配 `*.apps.pixloom.io` 的 A 记录指向 VPS。实际域名不同就统一替换；没有 IPv6 服务时删除冲突 AAAA。公网开放 80/443，SSH 保持可访问；3000、4180、Docker 和 Caddy 2019 不对公网开放。

在 VPS 创建配置文件；已有文件时保留，不覆盖原加密密钥：

```sh
if [ ! -e /etc/pixloom/pixloom.env ]; then
  install -o root -g pixloom -m 640 /srv/pixloom/bootstrap/.env.example /etc/pixloom/pixloom.env
fi
```

使用编辑器修改 `/etc/pixloom/pixloom.env`。它由 systemd 读取，不要写 `export`，不要用 shell source 执行。至少把以下配置改为真实值；从示例复制的同名开发配置应直接修改，不要重复追加：

```dotenv
NODE_ENV=production
PIXLOOM_AUTH_URL=https://pixloom.io
PIXLOOM_ADMIN_EMAILS=your-google-email@example.com
PIXLOOM_GOOGLE_CLIENT_ID=填写真实客户端ID
PIXLOOM_GOOGLE_CLIENT_SECRET=填写真实客户端密钥
PIXLOOM_DATA_DIR=/srv/pixloom/data
PIXLOOM_PUBLISH_DIR=/srv/pixloom/published
PIXLOOM_PUBLISH_ENABLED=1
PIXLOOM_PUBLISH_DOMAIN=apps.pixloom.io
PIXLOOM_PUBLISH_PORT=443
PIXLOOM_GATEWAY_PORT=4180
PIXLOOM_CLOUD_RUNTIME_URL=https://cloud.pixloom.io
```

按准备使用的模型填写 GEMINI_API_KEY / VERTEX_AI_API_KEY 或 OPENAI_API_KEY，以及对应模型名称。保留原模型和 Cloud 配置中仍需使用的密钥。Cloud 需要 `PIXLOOM_CLOUD_ENCRYPTION_KEY`；全新安装可用 `openssl rand -hex 32` 生成，已有资源必须使用原值。使用内置 Cloud 时，补齐示例中的 Supabase 开发池和生产池配置；开发池配置完整后启用，生产池在发布 Cloud 应用时需要。更详细的 Cloud 池初始化参见 [Cloud 配置](cloud-shared.md)，未准备好时先验证基础工作台功能。

Google Web OAuth 客户端回调填写 `https://pixloom.io/api/auth/callback/google`，测试状态下添加需要登录的测试邮箱；管理员邮箱必须与已验证 Google 账号一致。可选的自有 Supabase OAuth 回调为 `https://pixloom.io/api/cloud/supabase/callback`。

```sh
chown root:pixloom /etc/pixloom/pixloom.env
chmod 640 /etc/pixloom/pixloom.env
```

生产缺少登录、HTTPS 来源、管理员和绝对数据目录会拒绝启动。Google、模型、Cloud 密钥只保存在 VPS，不提交 Git，也不放进 Actions 的源码包。Cloud 公开地址变更后需要重新构建应用，历史产物仍保留原地址。

### 6. 预检并配置 Caddy（VPS，root）

先以服务账号、注入正式环境运行预检；此步骤检查配置、Docker 权限和 Chromium sandbox，不启动新站：

```sh
systemd-run --quiet --wait --pipe --collect --uid=pixloom --gid=pixloom \
  --property=SupplementaryGroups=docker \
  --property=WorkingDirectory=/srv/pixloom/bootstrap \
  --property=EnvironmentFile=/etc/pixloom/pixloom.env \
  --setenv=NODE_ENV=production --setenv=HOME=/srv/pixloom \
  --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/bin/env node --import tsx scripts/deploy-state.ts preflight
```

成功后生成 Caddy 配置：

```sh
systemd-run --quiet --wait --pipe --collect --uid=pixloom --gid=pixloom \
  --property=WorkingDirectory=/srv/pixloom/bootstrap \
  --property=EnvironmentFile=/etc/pixloom/pixloom.env \
  --setenv=NODE_ENV=production --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/bin/env pnpm --silent gateway:config > /tmp/pixloom-Caddyfile
caddy validate --config /tmp/pixloom-Caddyfile --adapter caddyfile
```

查看 `/tmp/pixloom-Caddyfile`。如果 Caddy 已托管其他站点，将生成内容合并进 `/etc/caddy/Caddyfile`，保留其他站点和唯一的全局块；如果仅托管 Pixloom，备份旧文件后可用生成内容替换。暂时先不要重载，等第 8 步进入维护窗口再切换入口。

生成配置在工作台和发布/Cloud 入口都检查 `/var/lib/pixloom/maintenance`，存在时返回 503。本机 upstream 健康接口不受影响。若 nginx 等旧代理占用 80/443，先确定如何保留其他网站并迁移入口；两个代理不能同时占用端口。不要在访问日志中记录完整预览 `_grant/<token>` URL。Caddy 证书通常位于 `/var/lib/caddy`，需持久化并单独备份。

### 7. 核对 GitHub 部署设置（GitHub 网页）

仓库 Settings → Secrets and variables → Actions：确认前述四个 Secret 仍然有效，尤其 `VPS_USER=deploy`。VPS SSH 端口不是 22 时，配置 Variable `VPS_SSH_PORT` 并核对对应 known_hosts。已有密钥可以复用，无需为 pixloom 配置 SSH 登录。

此时不要触发 main 上的 Deploy Pixloom，也不要合并。**新工作流进入 main 前，同名工作流仍是旧 PM2 部署。**

### 8. 进入维护窗口并首次发布（VPS + GitHub）

先在 VPS 的 root 终端设置维护页，验证合并后的 Caddy 配置：

```sh
install -m 644 /dev/null /var/lib/pixloom/maintenance
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

按第 6 步的入口迁移安排切换到 Caddy，然后执行 `systemctl enable --now caddy` 和 `systemctl reload caddy`。确认工作台 HTTPS 返回 503，其他站点可正常访问。若启用 Caddy 失败，先修复入口，不继续发布。

切换到**原 PM2 所属账号**停止旧应用。如果原账号确为 deploy，在 root 终端执行：

```sh
runuser -l deploy
# 以下在 deploy 的登录 shell 执行；确保 pm2 来自原来的安装环境。
pm2 stop pixloom
pm2 save
exit
```

退出后回到 root。若原 PM2 由别的用户管理，切换到那个用户执行；不要用 root 新建一套 PM2 状态。确认旧站不再占用 3000。

首次部署时 `/srv/pixloom/app` 应不存在。若已经按旧版指南把新版放在 app 普通目录，先停止相关服务，将整个目录保存到 releases 下，并建立指向它的 app 链接；确认其可恢复后再部署，控制器拒绝直接覆盖普通 checkout。

上述准备全部完成后，再经人工确认将包含新工作流的功能分支合入 main。合并自动触发 Deploy Pixloom；等待 checks 和 deploy 都成功。此步骤由你确认执行，当前功能分支的普通 push 不部署。后续重试可在新工作流的 main 上手动运行。

首次成功后，控制器自动创建 app 链接、启用三个服务及备份/监测 timer，并移除维护页。无需手动 build、启动 Worker 或执行另一套服务安装步骤。

### 9. 发布后验收（VPS root + 浏览器）

```sh
cat /srv/pixloom/last-deploy.json
systemctl is-active pixloom-web
systemctl is-active pixloom-worker
systemctl is-active pixloom-gateway
systemctl list-timers pixloom-backup.timer pixloom-monitor.timer
curl --fail https://pixloom.io/api/health
journalctl -u pixloom-web -u pixloom-worker -u pixloom-gateway -n 100
```

实际域名不同时替换 curl 地址。last-deploy.json 应为 live。逐项完成验收：

- 管理员 Google 登录，创建项目并用真实模型完成一次生成，预览、编辑和导出正常。
- 创建邀请码，使用第二个 Google 账号兑换，确认两个账号不能读写对方的项目；检查额度扣减和到期限制。
- 预览模块、样式、动态导入正常，退出后旧凭证失效；容器空闲回收后，已保存预览仍可访问，再次构建可重建环境。
- 发布、回滚、下线正常；若启用 Cloud，额外验证 Supabase 登录、邮件、数据、Storage 和开发/生产隔离。
- 验证备份及异地取回恢复、告警出口，并在维护窗口验证 VPS 重启后服务恢复。

创建邀请码时仍在 root 终端执行下列命令，它会自动以 pixloom 操作正式数据库：

```sh
cd /srv/pixloom/app
runuser -u pixloom -- env HOME=/srv/pixloom PATH=/usr/local/bin:/usr/bin:/bin \
  PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin invite:create \
  --label=首批内测 --credits=2000000 --days=30 --uses=1 --expiresDays=7
```

邀请码明文只输出一次，请保存后交给受邀用户。日常额度、用户管理和备份说明见 [上线后运维参考](vps-deployment.md)，这部分无需在首次安装时逐条执行。真实 VPS 验收不能由本地测试替代。

## 每次部署顺序

1. 在 `/srv/pixloom/releases/<SHA>-<run_id>-<attempt>` 解包，以 pixloom 用户安装锁定依赖（含构建依赖）、Chromium，检查生产配置、浏览器沙箱并构建。构建阶段不注入服务端密钥；配置预检才读取服务器 env。
2. 构建独立 `pixloom-runtime:deploy-<SHA>` 镜像，保留当前镜像的 rollback 标签。此时不改运行中的 `pixloom-runtime:react-v2` 标签。
3. 创建维护标记并验证 Caddy 返回 503。Worker 继续心跳，暂停领取任务及上游清理。等待当前任务排空，最多约五分半；超时退出并保留旧版运行。
4. 停止 Web、Worker、Gateway 三个 SQLite 写入者，冷备 data、published、配置密钥、服务单元和旧镜像/代码指针到 `/srv/pixloom/backups/deploy-<release>`。部署和定时备份共享 flock，不能并行修改维护状态；部署最多等待已有备份十分钟。
5. 备份成功后才迁移 SQLite、移除本实例旧执行容器、清除已停止进程的 Worker 租约、切换默认模板镜像及 app 符号链接，安装服务单元并启动三个进程。
6. 检查三个服务、Worker 同提交号心跳、SQLite 完整性、Docker 镜像和 Web/Gateway 返回的精确 release SHA。维护标记仍在，Worker 不会执行任务，外部业务请求继续返回 503。
7. 全部通过后才清除维护标记，开放流量及任务。启用备份、监测定时器。模型/Google/Supabase 的真实功能验收仍按 VPS 放行清单执行，不自动发起付费模型或真实业务操作。

构建失败不会停止旧服务。切换失败会在维护页保护下恢复代码、SQLite（含 WAL）、发布目录、服务配置、备份脚本和镜像；旧版恢复健康后才开放流量，并让 Actions 标红。首次部署没有旧版本、或回滚也失败时，保持维护页与停止状态，等待人工检查。

**开放流量后不会自动回滚数据库。** 新写入可能已发生；此时失败须保留数据并人工处理，不能把已有用户数据恢复成旧快照。

## 故障检查与保留

```sh
sudo cat /srv/pixloom/last-deploy.json
sudo journalctl -u pixloom-web -u pixloom-worker -u pixloom-gateway -n 200
sudo ls /srv/pixloom/backups
readlink -f /srv/pixloom/app
```

last-deploy.json 区分 live、rolled-back、failed-first-deploy、rollback-failed，并记录快照和旧代码位置。失败的新数据库目录保留为 `data.failed-*`，发布目录同理。release、备份和镜像不自动清理，应在确认恢复演练和保留期限后由管理员清理，禁止全局 Docker prune。

SSH 断线、进程被强制杀死或机器断电时，维护文件会保留。先检查控制器/临时构建任务是否仍在运行，再依据 metadata.json、last-deploy.json 恢复一致的代码、数据和镜像；不要直接删除维护文件。若首次部署失败，确认服务已停止、初始数据已恢复，移除指向失败版本的 app 链接后可保留维护标记重跑新的 workflow attempt。不要覆盖或删除失败 release。

这里的冷备只覆盖 VPS；Supabase 身份、业务数据和 Storage 仍需独立备份。服务端配置和备份含真实凭证，必须异地加密保存。自动部署不会改写 Google/Cloud 密钥，也不覆盖 Caddy 的其他站点。
