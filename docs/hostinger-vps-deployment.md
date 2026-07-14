# Pixloom 官网 Hostinger VPS 部署手册

最后维护日期：2026-07-14

本文用于从零部署 Pixloom 官网到 Hostinger VPS，并作为后续手动更新、配置变更、HTTPS 维护和排障的操作手册。GitHub Actions 自动部署另见 [Git 自动部署手册](./git-auto-deployment.md)，不在本文展开。

当前阶段仅部署官网，不启用数据库。

- 服务器系统：Ubuntu 24.04 LTS
- 域名：[pixloom.io](https://pixloom.io)
- VPS 公网 IPv4：`69.62.86.160`
- 应用目录：`/var/www/pixloom`
- 应用用户：`deploy`
- Node.js：22 LTS
- 包管理器：pnpm
- 进程管理：PM2
- 反向代理：Nginx
- 应用监听：`127.0.0.1:3000`

> 安全原则：root 只负责系统级操作（Certbot、Nginx、UFW 和系统软件）；deploy 负责 Git、pnpm、构建、PM2 和项目 `.env`。不要使用 root 运行 Next.js 或 PM2，也不要把 `.env`、私钥或 API Key 提交到 Git。

## 一、部署架构

```text
浏览器
  -> DNS（pixloom.io / www.pixloom.io）
  -> Hostinger 平台防火墙（22 / 80 / 443）
  -> Ubuntu UFW（22 / 80 / 443）
  -> Nginx（80 / 443）
  -> Next.js + PM2（127.0.0.1:3000）
```

当前官网版本不使用数据库。仓库可能仍保留 Prisma 依赖或 schema 文件，但部署流程不运行 `prisma generate`、`prisma db push` 或 `prisma migrate deploy`。

## 二、部署前准备

准备以下信息：

- Hostinger VPS 公网 IP 和 root 密码
- GitHub 私有仓库地址
- 域名 DNS 管理权限
- 生产环境变量及 API Key
- deploy 用户密码

本机代码在上线前应满足：

```bash
git status
pnpm install --frozen-lockfile
pnpm run build
```

确认 `main` 分支包含待上线代码。不要提交 `.env_prod`、`.env`、`.pnpm-store`、SSH 私钥或任何密钥文件。

## 三、初始化 Ubuntu

使用 root 登录：

```bash
ssh root@69.62.86.160
```

更新系统并安装基础软件：

```bash
apt update && apt upgrade -y
apt install -y nginx git curl build-essential ufw
timedatectl set-timezone Asia/Shanghai
```

安装 Node.js 22、pnpm 和 PM2：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt install -y nodejs
npm install -g pnpm@10 pm2

node -v
pnpm -v
pm2 -v
```

## 四、创建 deploy 用户和目录

使用 root 执行：

```bash
adduser deploy
mkdir -p /var/www/pixloom
chown deploy:deploy /var/www/pixloom
chmod 755 /var/www/pixloom
ls -ld /var/www/pixloom
```

期望所有者和用户组均为 `deploy`。不要使用 `chmod 777`。deploy 不必拥有完整 sudo 权限，系统软件、Nginx 和目录创建由 root 完成。

## 五、配置 GitHub 私有仓库访问

切换到 deploy：

```bash
su - deploy
```

生成 VPS 专用的 GitHub Deploy Key：

```bash
ssh-keygen -t ed25519 -C "pixloom-vps-github" -f ~/.ssh/pixloom_github -N ""
cat ~/.ssh/pixloom_github.pub
```

将公钥添加到 GitHub 仓库的 `Settings -> Deploy keys -> Add deploy key`，只授予读取权限，不勾选 `Allow write access`。

创建 `~/.ssh/config`：

```sshconfig
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/pixloom_github
    IdentitiesOnly yes
```

设置权限并测试：

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config ~/.ssh/pixloom_github
chmod 644 ~/.ssh/pixloom_github.pub
ssh -T git@github.com
```

拉取仓库：

```bash
git clone --branch main --single-branch git@github.com:OWNER/REPOSITORY.git /var/www/pixloom
cd /var/www/pixloom
```

## 六、统一使用 pnpm

项目同时出现 `package-lock.json` 和 `pnpm-lock.yaml` 时，以 `pnpm-lock.yaml` 为准。仓库应删除过期的 `package-lock.json`，并在本地、VPS、CI 中统一使用 pnpm。

```bash
cd /var/www/pixloom
pnpm install --frozen-lockfile
```

不要在生产部署中使用 `npm ci`。此前 `npm ci` 的 EUSAGE 错误是 `package.json` 与过期的 `package-lock.json` 不同步导致的。

## 七、配置生产环境变量

生产环境变量只保存在 VPS，由 deploy 用户维护。首次创建：

```bash
ssh deploy@69.62.86.160
cd /var/www/pixloom
cp .env.example .env
nano .env
chmod 600 .env
```

后续修改前先备份：

```bash
cd /var/www/pixloom
cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
nano .env
chmod 600 .env
```

示例结构：

```dotenv
NEXTAUTH_URL="https://pixloom.io"
NEXTAUTH_SECRET="替换为随机密钥"
NEXT_PUBLIC_APP_URL="https://pixloom.io"
NODE_ENV="production"

GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
VERTEX_AI_API_KEY=""
VERTEX_AI_IMAGE_MODEL="gemini-2.0-flash-preview-image-generation"

IMAGE_SERVER_URL=""
IMAGE_UPLOAD_TOKEN=""
```

生成 NextAuth 密钥：

```bash
openssl rand -base64 32
```

修改服务端变量后重新加载 PM2：

```bash
pm2 reload ecosystem.config.js --update-env
pm2 save
```

修改 `NEXT_PUBLIC_*` 后必须先重新构建，因为这些值会写入浏览器端产物：

```bash
pnpm run build
pm2 reload ecosystem.config.js --update-env
pm2 save
```

本项目不使用 Docker；修改 `.env` 后不要执行 `docker compose up`。普通服务端变量通过 PM2 reload 生效，`NEXT_PUBLIC_*` 则需要 build 后再 reload。

如果当前官网不启用登录或 AI 功能，可以暂不配置对应服务，但不得在页面公开依赖这些配置的入口。Google OAuth 启用后的回调地址为 `https://pixloom.io/api/auth/callback/google`。

## 八、构建官网

使用 deploy 执行：

```bash
cd /var/www/pixloom
pnpm install --frozen-lockfile
pnpm run build
```

当前版本没有数据库，不执行：

```text
npx prisma generate
npx prisma db push
npx prisma migrate deploy
```

构建必须完整通过类型检查。不要在 `next.config.js` 中设置 `typescript.ignoreBuildErrors`，因为这会隐藏整个项目的真实类型错误。

## 九、使用 PM2 启动

使用 deploy 执行：

```bash
cd /var/www/pixloom
mkdir -p logs public/uploads
pm2 start ecosystem.config.js
pm2 save
```

检查：

```bash
pm2 status
pm2 logs pixloom --lines 100
curl -I http://127.0.0.1:3000
```

首次正式上线配置开机启动：

```bash
pm2 startup systemd -u deploy --hp /home/deploy
```

PM2 会输出一条需要 root 权限执行的命令。完整执行该命令，然后以 deploy 再运行 `pm2 save`。

## 十、配置双层防火墙

### 10.1 Ubuntu UFW

使用 root 执行，并且必须先放行 SSH：

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow "Nginx Full"
ufw enable
ufw status verbose
```

期望允许 22、80、443，其余入站流量拒绝。不要开放 3000。

### 10.2 Hostinger 平台防火墙

入口：`hPanel -> VPS -> 当前服务器 -> Security -> Firewall`。

依次配置：

1. `Accept / TCP / 22 / Any`
2. `Accept / TCP / 80 / Any`
3. `Accept / TCP / 443 / Any`
4. `Drop / Any / Any / Any`

先添加允许规则，再激活防火墙组。激活后在另一个终端测试 SSH，确认新连接正常再关闭现有会话。

## 十一、配置 DNS

Hostinger DNS 建议记录：

```text
A      @      69.62.86.160
CNAME  www    pixloom.io
```

部署期间 TTL 建议 300 或 600 秒，稳定后可改为 3600 或 14400 秒。

- 删除或修改指向旧 IP `2.57.91.91` 的 A 记录。
- `www` 已有 CNAME 时，不要再创建同名 A 记录。
- 没有配置 VPS IPv6 时，删除指向旧服务器的冲突 AAAA 记录。

验证：

```bash
dig +short pixloom.io
dig +short www.pixloom.io
```

两者最终都应解析到 `69.62.86.160`。

## 十二、配置 Nginx

先确认应用可访问：

```bash
curl -I http://127.0.0.1:3000
```

使用 root 创建 `/etc/nginx/sites-available/pixloom`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name pixloom.io www.pixloom.io;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

启用并检查：

```bash
ln -s /etc/nginx/sites-available/pixloom /etc/nginx/sites-enabled/pixloom
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
curl -I http://pixloom.io
```

首次签发证书前，不要直接使用引用 `/etc/letsencrypt/live/...` 的 HTTPS 配置，否则证书文件尚不存在会导致 Nginx 检查失败。

## 十三、配置 HTTPS

HTTPS 属于系统级操作，使用 root 执行。开始前确认：

- Hostinger DNS 中 `A @` 指向 `69.62.86.160`，`CNAME www` 指向 `pixloom.io`。
- Hostinger 平台防火墙和 Ubuntu UFW 均已放行 TCP 443。
- Nginx 的 `server_name` 同时包含 `pixloom.io` 和 `www.pixloom.io`。
- DNS 中没有 CAA 记录也可以签发；只有存在限制性 CAA 时，才需确认允许 `letsencrypt.org`。

安装 Certbot 和 Nginx 插件：

```bash
ssh root@69.62.86.160
apt update
apt install -y certbot python3-certbot-nginx
certbot --version
```

签发证书：

```bash
certbot --nginx -d pixloom.io -d www.pixloom.io
```

按提示填写通知邮箱、同意服务条款，并选择自动将 HTTP 重定向到 HTTPS。签发完成后验证：

```bash
nginx -t
systemctl reload nginx
curl -I https://pixloom.io
curl -I https://www.pixloom.io
curl -I http://www.pixloom.io
```

预期结果：

- HTTPS 根路径可能返回 `307 Temporary Redirect` 并跳到 `/zh`，这是 Next.js 语言路由，属于正常行为。
- HTTP 应返回 `301 Moved Permanently`，并跳转到对应 HTTPS 地址。

检查完整跳转链：

```bash
curl -IL --max-redirs 5 https://pixloom.io
curl -IL --max-redirs 5 https://www.pixloom.io
curl -I http://pixloom.io
```

检查证书和自动续期：

```bash
certbot certificates
systemctl status certbot.timer
certbot renew --dry-run
```

`certbot.timer` 应显示 `enabled` 和 `active (waiting)`。如果未启用：

```bash
systemctl enable --now certbot.timer
```

## 十四、日常手动更新流程

代码合并到 main 后，使用 deploy 登录 VPS：

```bash
ssh deploy@69.62.86.160
cd /var/www/pixloom
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm run build
pm2 reload ecosystem.config.js --update-env
pm2 save
```

依赖没有变化时可以跳过 `pnpm install`。不要在 VPS 上直接修改受 Git 管理的源码；修复应在本地提交并推送，然后由 VPS 拉取。

## 十五、不同配置改动的处理

- 修改服务端 `.env`：使用 deploy 执行 `pm2 reload ecosystem.config.js --update-env`，然后 `pm2 save`。
- 修改 `NEXT_PUBLIC_*`：使用 deploy 先执行 `pnpm run build`，再 reload 和 save。
- 修改 `ecosystem.config.js`：使用 deploy reload 后执行 `pm2 save`。
- 修改 Nginx：使用 root 先执行 `nginx -t`，再执行 `systemctl reload nginx`。
- 修改依赖：提交 `pnpm-lock.yaml`，VPS 使用 deploy 执行 `pnpm install --frozen-lockfile`。
- 修改 HTTPS 证书或 Certbot：使用 root；不要使用 deploy，也不要用 root 运行 PM2。

## 十六、常见问题

### Permission denied: /var/www/pixloom

使用 root 创建目录并移交所有权：

```bash
mkdir -p /var/www/pixloom
chown deploy:deploy /var/www/pixloom
chmod 755 /var/www/pixloom
```

### deploy is not in the sudoers file

这不是应用故障。系统级操作改用 root。不要为了日常部署给 deploy 不必要的完整 sudo 权限。

### npm ci 报 EUSAGE

项目统一使用 pnpm：

```bash
pnpm install --frozen-lockfile
```

### 域名可以解析但打不开

按顺序检查：

```bash
pm2 status
curl -I http://127.0.0.1:3000
nginx -t
systemctl status nginx
ufw status verbose
tail -n 100 /var/log/nginx/error.log
pm2 logs pixloom --lines 100
```

### certbot: command not found

使用 root 同时安装 Certbot 和 Nginx 插件：

```bash
apt update
apt install -y certbot python3-certbot-nginx
```

只安装 `certbot` 而缺少 `python3-certbot-nginx` 时，`certbot --nginx` 无法自动修改 Nginx 配置。

### HTTPS 已生效但返回 307

如果 HTTPS 根路径返回 `307` 且 `location: /zh`，说明 TLS 已成功，响应来自 Next.js 的语言路由。使用 `curl -IL --max-redirs 5` 检查最终页面即可。

### certbot.timer 显示 active (waiting)

这是正常状态，表示 systemd 正在等待下一次自动续期检查。确认同时显示 `enabled`，并运行：

```bash
certbot renew --dry-run
```

### NextAuth Route 报 authOptions 不是合法导出

Next.js Route 文件只能导出规定字段。`authOptions` 应放在 `src/lib/auth-options.ts`，Route 文件只导出 `GET` 和 `POST`。

### PrismaClient 没有导出

当前官网不使用数据库，删除未使用的 `src/lib/db.ts`，不要全局忽略 TypeScript 错误。未来真正启用 Prisma 时，再恢复数据库配置并运行 `prisma generate`。

## 十七、备份与回滚

删除或重拉项目目录前，至少备份：

```text
/var/www/pixloom/.env
/var/www/pixloom/public/uploads
```

推荐先将旧目录改名为 `/var/www/pixloom-old`，验证新版本正常后再删除。代码回滚应优先在 Git 中回退到已验证提交，然后重新构建和 reload。

## 十八、上线验收清单

- [ ] main 分支构建通过
- [ ] PM2 中 pixloom 状态为 online
- [ ] `127.0.0.1:3000` 返回正常 HTTP 状态
- [ ] Hostinger 防火墙已激活
- [ ] UFW 仅开放 22、80、443
- [ ] `pixloom.io` 和 `www.pixloom.io` 均指向 VPS
- [ ] Nginx 配置检查通过
- [ ] HTTPS 证书有效且 HTTP 自动跳转 HTTPS
- [ ] `certbot.timer` 为 enabled、active (waiting)
- [ ] `certbot renew --dry-run` 成功
- [ ] PM2 startup 和 save 已完成
- [ ] `.env` 权限为 600 且未提交 Git
- [ ] 手机和桌面端首页访问正常
- [ ] Nginx、PM2 日志无持续错误

架构或部署方式变化后，应同步更新本文档和对应 Notion 手册。
