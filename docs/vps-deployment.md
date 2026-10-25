# VPS 上线后运维参考

首次部署和旧 PM2 迁移请只按 [VPS 部署操作指南](continuous-deployment.md) 的第 1–9 步执行。本文件不再提供第二套安装、构建或启动服务流程，仅供上线后管理用户、额度、容器和备份时查阅。

管理 systemd、备份和日志使用 root；操作应用数据库使用 pixloom。下方 `pnpm admin` 命令默认在 `/srv/pixloom/app`、以 pixloom 身份执行。若当前是 root，可先执行：

```sh
runuser -l pixloom
cd /srv/pixloom/app
export PATH=/usr/local/bin:/usr/bin:/bin
```

完成数据库操作后执行 `exit` 回到 root，再管理 systemd。不要以 root 运行 Web、Worker、依赖安装或构建。

## 1. 迁移、邀请和额度

第一次打开旧数据库时添加用户、项目归属及账本等表。原 `auth_account` 迁移为管理员，旧会话和无主项目归其所有；没有旧账号的本地项目只会被指定管理员认领。全新生产库不允许“首个访问者自动成为管理员”；只有配置的已验证 Google 邮箱获得管理员身份。旧表保留作迁移审计。数据库有新增列，回滚旧代码必须恢复匹配的升级前备份。

管理员 Google 登录后，可从侧边栏「管理后台」进入 `/admin`，生成和禁用邀请码、查看用户积分与 Token 用量，以及按用户和项目分页查看已保存的全部对话（需求、回复、任务状态与错误）。页面和所有管理接口均要求当前账号已激活、角色为管理员且邮箱仍在 `PIXLOOM_ADMIN_EMAILS` 中；移出名单即失去后台访问权限，本地默认首账号管理员也需要显式配置邮箱。后台邀请码的赠送额度以积分输入，1 积分 = 1,000 额度单位，默认 2,000 积分；明文生成后请立即复制，历史列表不提供找回。

CLI 继续作为服务器运维入口，保留额度调整、用户停用等命令。以下只操作数据库的命令可显式指定目录：

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

## 2. 预览与环境回收

预览为用户私有：项目所有者通过工作台获取十五分钟资源凭证，opaque iframe 用它加载模块、CSS 和图片；可信外层每五分钟续期同一凭证，不重载应用。退出、会话失效、用户停用、体验到期立即阻止资源请求。长时间后台停留导致凭证过期时，点击“重新加载预览”。此凭证是短期 bearer，不能当作公开分享链接。发布站点仍公开，应用自己的 Cloud 登录独立于平台账号。

Worker 每三十秒扫描，执行环境默认空闲五分钟后移除；达到容器容量时优先回收最旧空闲环境。判断依据是最后执行活动，后台网页轮询不会延长容器寿命；活跃任务不会被回收。下次生成/构建自动重建，权威源码、版本、持久预览和发布站点不受影响。

新容器带数据目录作用域标签，只枚举该实例的遗留环境，避免误删其他部署或验证容器。升级前已有、且没有数据库记录的旧容器需要管理员检查后单独清理；不要全局 docker prune。

## 3. 备份、监测与升级

```sh
sudo systemctl enable --now pixloom-backup.timer pixloom-monitor.timer
sudo systemctl start pixloom-backup.service
sudo journalctl -u pixloom-monitor.service -n 100
sudo journalctl -u pixloom-worker -f
```

备份每天北京时间 03:30 执行，随机延迟五分钟内。脚本停止 Web、Worker 和 Gateway 后打包数据、发布目录及配置密钥，随后检查三个服务恢复就绪再开放流量，因此存在短暂维护窗口。备份与自动部署共享互斥锁，维护标记已存在时会跳过，保留故障现场。备份在 `/srv/pixloom/backups`，权限受 umask 0077 限制；包含真实业务数据及凭证，必须加密复制到异地，并另设保留/清理策略。脚本不自动删除备份。

恢复演练：先解包到独立目录，检查数据库 `PRAGMA integrity_check`，以隔离端口/数据目录启动匹配代码，验证项目、版本、会话、预览与发布。正式恢复须先停止三个服务，保留故障现场，再还原数据/发布目录和原加密密钥、修复属主后启动。SQLite 冷备不是 Supabase 数据备份：按 `cloud-shared.md` 导出业务记录/文件，并单独保护池身份及整体备份；Caddy 证书、部署代码版本和锁文件也需保留。发布历史重建依赖原模板镜像摘要，升级前用 `docker image save` 保存对应模板镜像以便恢复。

每五分钟的 ops 检查覆盖配置、SQLite、磁盘、内存、Web/Gateway、Worker 心跳、Docker 镜像、队列积压、每日预算及超过十五分钟的待核对用量。异常返回非零并写入 journald。需要把失败单元和公网 HTTPS 探活接入自己的告警系统；此仓库不配置外部收件人或通知凭证。journald 配置日志大小和保留时间，Docker 已使用有限 local 日志。

日常发布继续走 main 的 GitHub Actions，由控制器构建、排空队列、冷备并切换服务，具体顺序和失败恢复见 [部署操作指南](continuous-deployment.md)。不要在 app 目录 git pull、直接构建或并行启动第二个 Worker。开放流量后的故障不能自动恢复旧数据库，避免丢失新增用户数据。

## 4. 放行检查

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
