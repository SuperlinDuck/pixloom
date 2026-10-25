# VPS 邀请内测部署与运维

适用于单机 Linux、SQLite、一个串行 Worker 的小规模内测。代码具备邀请、项目隔离、用量账本、容器回收和生产检查；真实 VPS、Google、模型和 Supabase 的最终验收需要在目标机器执行。不要复制本机的 node_modules、.next 或正在写入的 SQLite。

自动部署、现有 PM2 迁移及 GitHub Secrets 配置见 [GitHub Actions 自动部署](continuous-deployment.md)。启用自动部署时 app 是版本目录的符号链接，首次准备不能提前启动缺少 app 链接的三个服务。

## 1. 安装与目录

安装 Node.js 24、package.json 声明的 pnpm、Docker Engine 和 Caddy。复用现有 `deploy` 作为 SSH 部署账号，另建 `pixloom` 运行服务，无需为 pixloom 配置 SSH 登录或免密 sudo。以下示例约定代码在 `/srv/pixloom/app`，服务用户 pixloom 的 HOME 为 `/srv/pixloom`。systemd 的 PATH 使用 `/usr/local/bin:/usr/bin:/bin`，需确认 node、pnpm 位于其中。按 VPS 实际内存调整服务资源限制，给系统、Docker 容器和 Caddy 留出空间。首次安装使用 root 或已有管理权限的运维账号。

```sh
sudo useradd --system --create-home --home-dir /srv/pixloom --shell /bin/bash pixloom
sudo usermod -aG docker pixloom
# deploy 需要穿过父目录才能访问自己的 incoming；私有子目录仍保持 0700。
sudo chmod 755 /srv/pixloom
sudo install -d -o pixloom -g pixloom -m 700 /srv/pixloom/data /srv/pixloom/published
sudo install -d -o root -g pixloom -m 750 /etc/pixloom
```

自动部署时，deploy 只写入 incoming，由 root 控制器创建 release、切换 app 链接，并以 pixloom 安装依赖和构建；上传目录和指定命令的 sudo 授权按 [自动部署文档](continuous-deployment.md) 配置。手动部署时，以 pixloom 在代码目录安装依赖和构建。不要把 systemd 的 User/Group 替换成 deploy，也不要递归改变整棵 `/srv/pixloom` 的所有权。当前环境查询接口也需要 Docker，所以 Web 和 Worker 都有 Docker 组权限。Docker 控制权属于受信任控制面，不能把 Socket 挂入生成应用或暴露到公网。

## 2. 域名与凭证

DNS 增加工作台 `pixloom.io`、Cloud `cloud.pixloom.io`、发布通配 `*.apps.pixloom.io` 的 A 记录。没有 IPv6 服务时不要保留冲突 AAAA。公网开放 80/443，SSH 使用密钥并限制来源；3000、4180、Docker、Caddy 2019 仅在本机使用。

把 `.env.example` 中需要的配置放入 `/etc/pixloom/pixloom.env`，权限 `root:pixloom 0640`。systemd 会注入这些变量；手动运行命令时也必须指向同样的数据目录和配置，不能误用仓库自己的 `.env.local`。生产部署不要携带开发 `.env.local`。

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

再配置所用模型、`PIXLOOM_CLOUD_ENCRYPTION_KEY` 和 Supabase 开发/生产池；完整变量说明见 `.env.example`。凭证不要使用 `NEXT_PUBLIC_` 前缀。Google 的 Web OAuth 回调为 `https://pixloom.io/api/auth/callback/google`，测试状态下添加受邀测试邮箱。自有 Supabase 回调为 `https://pixloom.io/api/cloud/supabase/callback`。

HTTPS 平台会话使用 `__Host-` Cookie，防止发布子域设置同名 Domain Cookie。升级前的 HTTPS 平台登录需重新进行。

生产缺少 Google 凭证、HTTPS 来源、管理员或绝对数据/发布目录时，`pnpm start/worker/gateway` 拒绝启动。不要用 `next start` 绕过启动检查。Cloud 网关必须是浏览器可访问的 HTTPS 来源；变更地址后需要重新构建应用，历史产物保留原地址。

## 3. 构建与服务

以服务用户安装 Chromium，确保缓存位于该用户 HOME；Linux 系统依赖安装可能需要 sudo。浏览器必须能在该非 root 用户下启用 sandbox，不要改为 `--no-sandbox`。

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm sandbox:prepare
pnpm test
pnpm typecheck
pnpm build
```

systemd 文件包含 Web 2 GiB、Worker 3 GiB/2 CPU、Gateway 1 GiB 的资源上限，Worker 的 Chromium 子进程计入 Worker cgroup。构建容器另有 1 CPU、512 MiB、128 进程上限，不计入 Worker cgroup。按实际内存预算调整，不把这些上限视为机器容量建议。

```sh
sudo install -o root -g root -m 700 deploy/backup.sh /etc/pixloom/backup.sh
sudo install -m 644 deploy/pixloom-*.service deploy/pixloom-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pixloom-web pixloom-worker pixloom-gateway
```

不要同时启动第二个 Worker，也不要在生产目录运行 watch 开发进程。

## 4. Caddy

在注入生产配置的环境中生成配置：

```sh
pnpm --silent gateway:config > /tmp/pixloom-Caddyfile
caddy validate --config /tmp/pixloom-Caddyfile --adapter caddyfile
```

输出包含 HTTPS 工作台到 3000、发布/Cloud 到 4180、Cloud HTTP 跳转、发布按需证书白名单。首次部署安装为 `/etc/caddy/Caddyfile`；已有站点时合并唯一的全局配置块，保留原站点，校验后重载。

Caddy 默认保留工作台 Host。不要让公网直接连接 upstream，不信任来自任意客户端的转发头。不要记录完整预览 `_grant/<token>` URL；如启用访问日志，先配置路径脱敏。证书目录通常在 `/var/lib/caddy`，应持久化并纳入独立备份。

## 5. 迁移、邀请和额度

第一次打开旧数据库时添加用户、项目归属及账本等表。原 `auth_account` 迁移为管理员，旧会话和无主项目归其所有；没有旧账号的本地项目只会被指定管理员认领。全新生产库不允许“首个访问者自动成为管理员”；只有配置的已验证 Google 邮箱获得管理员身份。旧表保留作迁移审计。数据库有新增列，回滚旧代码必须恢复匹配的升级前备份。

CLI 是服务器运维入口，不通过浏览器开放。以下只操作数据库的命令可显式指定目录：

```sh
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin users
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin invite:create --label=首批内测 --credits=2000000 --days=30 --uses=1 --expiresDays=7
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin invites
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin usage 用户ID
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin credits:add 用户ID 1000000
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin access:extend 用户ID 7
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin user:disable 用户ID
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin ai:pause
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin ai:resume
```

使用有数据目录读写权限的用户执行。邀请码明文只在创建时输出，数据库仅保存 SHA-256 摘要；管理员把它交给受邀者，受邀者 Google 登录后在侧边栏兑换。默认一码一人、七天内兑换，兑换后体验三十天。禁用码使用 `invite:disable 邀请ID`。停用用户会撤销平台会话并取消活跃任务，不删除项目或已发布站点；下线公开站点需单独操作。

额度是平台计量单位，不是货币或账单。默认每输入 token 扣 1、每输出 token 扣 4，包含报告的推理输出；可用 `PIXLOOM_MODEL_WEIGHTS` 按 provider:model 配置整数权重。邀请码默认 2,000,000 单位，管理员默认 1,000,000,000，平台每日默认 20,000,000（UTC 日界），管理员同样受平台预算约束。上线前按真实任务校准体验额度。

每次 HTTP 模型尝试先预留完整请求 UTF-8 字节数作为保守输入上界，以及允许的最大输出；返回有效 usage 后结算。HTTP 明确拒绝的请求释放预留；网络中断、超时、响应损坏、未报告 usage 的调用保留预留。重试逐次预留，失败/取消不免除已发生用量；任务和每日预算同样计算未确认预留。用量可能和供应商账单有差异。

```sh
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin ledger
PIXLOOM_DATA_DIR=/srv/pixloom/data pnpm admin ledger:settle 记录ID 实际输入tokens 实际输出tokens
```

仅在任务终结并与供应商核对后人工结算未确认记录；确认无计费可填 `0 0`。原调用权重保存在账本中，后续调整权重不改变旧记录。`ai:pause` 持久化暂停并取消 AI 任务；`PIXLOOM_AI_ENABLED=0` 则在环境层强制暂停，CLI resume 不覆盖环境限制。

用户额度耗尽后仍可查看、编辑、构建和导出已有项目；体验过期或账号停用则禁止工作空间访问。每人最多十项目、两活跃任务、每小时三十任务、三个上线应用，平台队列最多三十任务。源码/产物遵循原项目 128 MiB 限制，另有账号 512 MiB、平台逻辑存储 10 GiB 和磁盘最低空闲 512 MiB；平台逻辑预算保守地为产物计算双份，预留发布副本空间，不等同物理磁盘精确用量。

## 6. 预览与环境回收

预览为用户私有：项目所有者通过工作台获取十五分钟资源凭证，opaque iframe 用它加载模块、CSS 和图片；可信外层每五分钟续期同一凭证，不重载应用。退出、会话失效、用户停用、体验到期立即阻止资源请求。长时间后台停留导致凭证过期时，点击“重新加载预览”。此凭证是短期 bearer，不能当作公开分享链接。发布站点仍公开，应用自己的 Cloud 登录独立于平台账号。

Worker 每三十秒扫描，执行环境默认空闲五分钟后移除；达到容器容量时优先回收最旧空闲环境。判断依据是最后执行活动，后台网页轮询不会延长容器寿命；活跃任务不会被回收。下次生成/构建自动重建，权威源码、版本、持久预览和发布站点不受影响。

新容器带数据目录作用域标签，只枚举该实例的遗留环境，避免误删其他部署或验证容器。升级前已有、且没有数据库记录的旧容器需要管理员检查后单独清理；不要全局 docker prune。

## 7. 备份、监测与升级

```sh
sudo systemctl enable --now pixloom-backup.timer pixloom-monitor.timer
sudo systemctl start pixloom-backup.service
sudo journalctl -u pixloom-monitor.service -n 100
sudo journalctl -u pixloom-worker -f
```

备份每天北京时间 03:30 执行，随机延迟五分钟内。脚本停止 Web、Worker 和 Gateway 后打包数据、发布目录及配置密钥，随后检查三个服务恢复就绪再开放流量，因此存在短暂维护窗口。备份与自动部署共享互斥锁，维护标记已存在时会跳过，保留故障现场。备份在 `/srv/pixloom/backups`，权限受 umask 0077 限制；包含真实业务数据及凭证，必须加密复制到异地，并另设保留/清理策略。脚本不自动删除备份。

恢复演练：先解包到独立目录，检查数据库 `PRAGMA integrity_check`，以隔离端口/数据目录启动匹配代码，验证项目、版本、会话、预览与发布。正式恢复须先停止三个服务，保留故障现场，再还原数据/发布目录和原加密密钥、修复属主后启动。SQLite 冷备不是 Supabase 数据备份：按 `cloud-shared.md` 导出业务记录/文件，并单独保护池身份及整体备份；Caddy 证书、部署代码版本和锁文件也需保留。发布历史重建依赖原模板镜像摘要，升级前用 `docker image save` 保存对应模板镜像以便恢复。

每五分钟的 ops 检查覆盖配置、SQLite、磁盘、内存、Web/Gateway、Worker 心跳、Docker 镜像、队列积压、每日预算及超过十五分钟的待核对用量。异常返回非零并写入 journald。需要把失败单元和公网 HTTPS 探活接入自己的告警系统；此仓库不配置外部收件人或通知凭证。journald 配置日志大小和保留时间，Docker 已使用有限 local 日志。

升级顺序：暂停 AI/排空队列 → 冷备 → 保留旧代码/镜像 → 新代码安装/测试/构建 → 重启三个服务 → 冒烟验收 → 恢复 AI。构建失败不切换运行版本，回滚恢复匹配代码和数据库快照，避免把新增数据静默丢弃。

## 8. 放行检查

- 两个真实 Google 账号：未激活受限、邀请码只能按配置核销、互相不能读写项目/任务/版本/导出/Cloud。
- 小额邀请码：模型成功、自动修复、失败、取消和 Worker 重启均正确结算或保留预留；额度耗尽仍可读取/导出。
- 真 Chromium：私有预览的模块、样式、动态导入、Cloud 登录与退出；未登录和另一用户拿旧产物 ID 不能读取。
- 容器空闲后移除，已保存预览继续工作，再次修改能重建；达到容量可释放旧环境。
- 真实模型完整生成、发布、回滚、下线；公网 DNS、HTTPS 与 Caddy 重启后证书仍可用。
- 真实 Supabase Session pooler、邮件、Auth、Storage，开发/生产和应用数据隔离。
- VPS 重启后服务恢复；执行一次异地备份取回与隔离恢复演练；确认告警出口可达。

这些目标机器验收不能由本地夹具测试代替。

## 本地实现验证

`pnpm test`、`pnpm typecheck`、独立输出目录的 `pnpm build`；真实 Docker 工作空间验证、真实 Caddy 发布/回滚验证及 Chromium 回归已通过。新增 `pnpm invite:verify` 在已构建的 Web 上使用独立端口、临时数据库及虚拟登录，覆盖侧边栏兑换、用户隔离、私有预览 CSS/模块/动态导入/交互和退出撤销；不调用真实 Google、模型或 Supabase。自定义构建目录时，构建和验证都传同一个 `PIXLOOM_NEXT_DIST_DIR`。Linux systemd、真实 OAuth/上游服务和异地恢复仍需执行放行检查。
