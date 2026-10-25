# GitHub Actions 自动部署

生产默认分支为 main。当前功能分支的普通 push 不部署；PR 执行 CI。合并到 main 后，Deploy Pixloom 调用同一套 CI，全部成功才使用现有 SSH secrets 部署该次提交。手动 workflow_dispatch 也只允许选择 main，不提供跳过检查的入口。

本流程的代码、工作流和故障回滚均可在本地验证；目标 VPS 的 systemd、真实域名和凭证需在一次性准备后验收。以下安装步骤需由运维在目标机器执行；普通功能分支 push 不会执行这些线上操作。

## 工作流

`.github/workflows/ci.yml` 是 PR 和部署共用的可复用工作流，执行测试、类型/格式检查、生产构建、Chromium 邀请流程及 Docker 运行环境验证。`.github/workflows/deploy.yml` 仅在 main push 或手动 main 运行；部署 job 依赖整个 checks job 成功。

部署包来自经过检查的 `github.sha`，通过 `git archive` 生成，只包含跟踪的源码。SSH 严格核对 known_hosts，传输 SHA-256 摘要，VPS 验证摘要后拒绝路径穿越、链接、特殊文件、运行数据和密钥文件。VPS 无需再登录 GitHub，也不会执行 git pull 到正在运行的目录。

复用已有 Repository Secrets：

| 名称            | 用途                      |
| --------------- | ------------------------- |
| VPS_HOST        | VPS 地址                  |
| VPS_USER        | SSH 部署用户              |
| VPS_SSH_KEY     | 部署 SSH 私钥             |
| VPS_KNOWN_HOSTS | 已核验的 SSH 主机公钥记录 |

可选 Repository Variable `VPS_SSH_PORT`，默认 22。非标准端口的 known_hosts 应含对应 `[host]:port` 条目。Google、模型、Cloud 和数据库密钥只存 VPS 的 `/etc/pixloom/pixloom.env`，不传给 Actions。

## 一次性从旧 PM2 部署迁移

以本节为首次自动部署的执行顺序。引用 `vps-deployment.md` 时只补充基础环境、DNS、凭证和验收配置；不要同时执行那里的手动启动服务步骤，也不要提前创建 `/srv/pixloom/app` 普通目录。以下服务器命令在 VPS 上执行。

旧工作流的目录为 `/var/www/pixloom`，通过 PM2 集群运行一个 Next 服务；新工作流使用单机 SQLite、一个 Worker、一个 Web、一个 Gateway 和 systemd。不能直接套用旧的 PM2 reload。

1. 备份旧目录中的配置、数据库和上传文件，保留旧代码及 PM2 配置。新版不自动导入已经移除的旧 HTML 项目数据。不要把旧目录的数据与新版空库混合复制。
2. 按 [VPS 部署](vps-deployment.md) 安装 Node.js 24、pnpm、Docker Engine、Caddy、Python 3、curl 和 flock（util-linux），创建 pixloom 用户和配置密钥。自动部署仅支持本机 Docker Engine 默认 context，固定 Web 3000、Gateway 4180、数据 `/srv/pixloom/data`、发布 `/srv/pixloom/published`；HTTPS 使用标准 443。
3. 把包含本套部署脚本的代码放在 pixloom 用户可读写的独立准备目录，例如 `/srv/pixloom/bootstrap`。首次合并前应使用 `codex/atoms-platform` 分支或对应提交，尚未更新的 main 不包含这些脚本。准备目录及其依赖安装位置需归 pixloom 所有，父目录也需允许该用户访问。可以在旧 Git checkout 旁创建独立 worktree，保持线上 main checkout 不变；也可以上传源码包。以 pixloom 用户安装依赖，使用有权限的运维用户安装 Chromium 系统依赖 `pnpm exec playwright install-deps chromium`。浏览器文件由每次部署以 pixloom 用户下载。
4. 在该准备目录安装控制器、服务配置和根目录：

```sh
sudo install -d -m 755 /srv/pixloom/releases /usr/local/libexec/pixloom /var/lib/pixloom
sudo install -d -m 700 /srv/pixloom/backups
sudo install -d -o pixloom -g pixloom -m 700 /srv/pixloom/data /srv/pixloom/published
# incoming 应归现有 VPS_USER 所有，以下示例使用 root；非 root 时改成实际 SSH 用户。
sudo install -d -o root -g root -m 700 /srv/pixloom/incoming
sudo install -d -o root -g pixloom -m 750 /etc/pixloom
sudo install -o root -g root -m 755 deploy/deploy.sh /usr/local/sbin/pixloom-deploy
sudo install -o root -g root -m 644 deploy/deploy.mjs deploy/retire-worker.mjs deploy/archive.py /usr/local/libexec/pixloom/
sudo install -o root -g root -m 700 deploy/backup.sh /etc/pixloom/backup.sh
sudo install -m 644 deploy/pixloom-*.service deploy/pixloom-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

控制器、retire-worker.mjs 和 archive.py 必须 root 所有，不能由服务用户改写。以后改动这些控制器文件时，需在部署前重新执行对应 install 命令；普通应用代码、systemd 单元和定时备份脚本由控制器随版本更新。

5. 配置 `/etc/pixloom/pixloom.env`（root:pixloom 0640）。使用原来的模型/Cloud 加密密钥保护已有资源；管理员邮箱、OAuth 和 HTTPS 来源必须真实配置。不要把密钥写入 Git 或源码包。
6. 在准备目录生成含维护页的新 Caddy 配置，并与现有站点合并，校验后重载。下面通过 systemd 注入与正式服务相同的配置，不使用 shell source 解释密钥文件：

```sh
sudo systemd-run --quiet --wait --pipe --collect --uid=pixloom --gid=pixloom \
  --property=WorkingDirectory=/srv/pixloom/bootstrap \
  --property=EnvironmentFile=/etc/pixloom/pixloom.env \
  --setenv=NODE_ENV=production --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/bin/env pnpm --silent gateway:config > /tmp/pixloom-Caddyfile
caddy validate --config /tmp/pixloom-Caddyfile --adapter caddyfile
```

新配置在工作台和发布/Cloud 两个入口都检查 `/var/lib/pixloom/maintenance`，存在时直接返回 503，阻止业务请求写入；本机 upstream 健康接口仍可使用。控制器切换前会实际请求 Caddy 验证 503。保留其他网站的配置和唯一全局块，不自动覆盖整份 Caddyfile。若旧代理占用 80/443，先规划 Pixloom 的入口迁移，不能让两个代理争抢端口。

7. 在选定维护窗口，由原 PM2 所属用户执行 `pm2 stop pixloom` 和 `pm2 save`，停止旧应用开机恢复。首次迁移时 `/srv/pixloom/app` 应不存在，控制器会创建指向 release 的符号链接。可先创建维护标记让用户看到 503：

```sh
sudo install -m 644 /dev/null /var/lib/pixloom/maintenance
```

8. 若 VPS_USER 非 root，只为可信部署用户配置无密码执行 `/usr/local/sbin/pixloom-deploy` 的 sudo 权限，并把 incoming 目录交给该用户。该权限允许发布可执行代码，应按服务器管理员权限保护。root SSH 用户不使用 sudo。
9. 首次准备完成并确认维护窗口后，再经人工确认把包含新工作流的分支合入 main；合并会自动启动新 Deploy Pixloom。**新工作流进入 main 之前，不要手动运行 main 上的同名工作流，它仍是旧 PM2 部署。** 只有新工作流已经在 main 上时，后续才能通过手动运行重试。首次成功后，三个服务和备份/监测 timer 自动开机启用。当前功能分支的普通 push 不会触发部署。

如果已经按旧版指南把新版应用作为普通目录放在 `/srv/pixloom/app`，先在维护窗口停止三个服务，将整个目录移到 `/srv/pixloom/releases/bootstrap-日期`，再建立 app 符号链接。确认没有运行任务且旧版可正常启动后再运行自动部署。控制器会拒绝直接覆盖普通 checkout。

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
