# PixLoom - AI 商品图生成平台

通过 AI 技术为电商卖家快速生成高质量的商品展示图。

## 🚀 快速开始

### 环境要求

- Node.js 18+ (当前使用 v22.21.1)
- PostgreSQL 14+
- npm 或 yarn

### 本地开发

1. **克隆项目**
```bash
git clone <your-repo-url>
cd pixloom
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入必要的配置
```

4. **初始化数据库**
```bash
# 创建数据库
createdb pixloom

# 运行迁移
npm run db:push

# 或使用 migrate
npm run db:migrate
```

5. **启动开发服务器**
```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 📁 项目结构

```
pixloom/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # 认证相关页面
│   │   ├── (dashboard)/       # 用户控制台
│   │   ├── (marketing)/       # 营销页面
│   │   ├── api/               # API 路由
│   │   ├── layout.tsx         # 根布局
│   │   ├── page.tsx           # 首页
│   │   └── globals.css        # 全局样式
│   ├── components/            # React 组件
│   │   ├── ui/               # shadcn/ui 组件
│   │   ├── editor/           # 图片编辑器
│   │   └── generator/        # 生成器组件
│   ├── lib/                   # 工具库
│   │   ├── ai/               # AI 服务集成
│   │   ├── db.ts             # 数据库客户端
│   │   └── utils.ts          # 工具函数
│   ├── hooks/                 # React Hooks
│   ├── store/                 # 状态管理
│   └── types/                 # TypeScript 类型
├── prisma/
│   └── schema.prisma          # 数据库 Schema
├── public/                    # 静态资源
├── deploy/                    # 部署配置
│   ├── nginx.conf            # Nginx 配置
│   └── deploy.sh             # 部署脚本
├── docs/                      # 文档
│   └── project-plan.md       # 项目方案
├── .env.example              # 环境变量模板
├── ecosystem.config.js       # PM2 配置
├── next.config.js            # Next.js 配置
├── tailwind.config.ts        # TailwindCSS 配置
└── package.json
```

## 🛠️ 技术栈

- **前端**: Next.js 14, React 18, TailwindCSS, shadcn/ui
- **后端**: Next.js API Routes, Prisma ORM
- **数据库**: PostgreSQL
- **认证**: NextAuth.js
- **AI 服务**: OpenAI, Stability AI, Replicate
- **部署**: Hostinger VPS, Nginx, PM2

## 📝 可用脚本

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm start            # 启动生产服务器
npm run lint         # 运行 ESLint
npm run db:push      # 推送数据库 schema
npm run db:migrate   # 运行数据库迁移
npm run db:generate  # 生成 Prisma Client
npm run db:studio    # 打开 Prisma Studio
```

## 🚢 部署到 Hostinger VPS

### 1. 服务器准备

```bash
# SSH 连接到 VPS
ssh root@your-vps-ip

# 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 PM2
npm install -g pm2

# 安装 Nginx
sudo apt-get install nginx

# 安装 PostgreSQL
sudo apt-get install postgresql postgresql-contrib
```

### 2. 克隆项目

```bash
cd /var/www
git clone https://github.com/SuperlinDuck/pixloom.git pixloom
cd pixloom
```

### 3. 配置环境

```bash
# 复制环境变量
cp .env.example .env
nano .env  # 编辑配置

# 安装依赖
npm install

# 运行数据库迁移
npx prisma migrate deploy
npx prisma generate

# 构建应用
npm run build
```

### 4. 启动应用

```bash
# 使用 PM2 启动
pm2 start ecosystem.config.js

# 设置开机自启
pm2 startup
pm2 save
```

### 5. 配置 Nginx

```bash
# 复制 Nginx 配置
sudo cp deploy/nginx.conf /etc/nginx/sites-available/pixloom

# 修改域名
sudo nano /etc/nginx/sites-available/pixloom

# 启用站点
sudo ln -s /etc/nginx/sites-available/pixloom /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

### 6. 配置 SSL

```bash
# 安装 Certbot
sudo apt-get install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### 7. 自动部署

```bash
# 使用部署脚本
bash deploy/deploy.sh
```

## 🔐 环境变量

查看 `.env.example` 文件了解所需的环境变量。

关键配置：
- `DATABASE_URL`: PostgreSQL 连接字符串
- `NEXTAUTH_SECRET`: 认证密钥
- `OPENAI_API_KEY`: OpenAI API 密钥
- `AWS_*`: S3 存储配置

## 📊 监控

```bash
# 查看 PM2 状态
pm2 status

# 查看日志
pm2 logs pixloom

# 实时监控
pm2 monit

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 📞 联系方式

- 网站: [yourdomain.com](https://yourdomain.com)
- 邮箱: support@yourdomain.com

---

**版本**: v0.1.0  
**最后更新**: 2026-04-01
