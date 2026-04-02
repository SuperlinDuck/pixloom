# 快速开始指南

## 📦 已完成的初始化

项目已成功初始化，包含以下内容：

### ✅ 已创建的文件和配置

- **核心配置**
  - `package.json` - 项目依赖和脚本
  - `tsconfig.json` - TypeScript 配置
  - `next.config.js` - Next.js 配置（启用 standalone 模式）
  - `tailwind.config.ts` - TailwindCSS 配置
  - `components.json` - shadcn/ui 配置

- **数据库**
  - `prisma/schema.prisma` - 数据库 Schema（用户、项目、图片等模型）
  - Prisma Client 已生成

- **应用代码**
  - `src/app/layout.tsx` - 根布局
  - `src/app/page.tsx` - 首页
  - `src/app/globals.css` - 全局样式
  - `src/lib/db.ts` - 数据库客户端
  - `src/lib/utils.ts` - 工具函数

- **部署配置**
  - `ecosystem.config.js` - PM2 配置
  - `deploy/nginx.conf` - Nginx 配置
  - `deploy/deploy.sh` - 部署脚本
  - `.github/workflows/deploy.yml` - CI/CD 配置

- **文档**
  - `README.md` - 项目文档
  - `docs/project-plan.md` - 完整项目方案
  - `.env.example` - 环境变量模板

## 🚀 下一步操作

### 1. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，至少需要配置：
```env
DATABASE_URL="postgresql://user:password@localhost:5432/flashloom"
NEXTAUTH_SECRET="your-secret-key"
```

生成 NEXTAUTH_SECRET：
```bash
openssl rand -base64 32
```

### 2. 设置数据库

如果你还没有 PostgreSQL 数据库：

**macOS (使用 Homebrew):**
```bash
brew install postgresql@14
brew services start postgresql@14
createdb flashloom
```

**或使用 Docker:**
```bash
docker run --name flashloom-db \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=flashloom \
  -p 5432:5432 \
  -d postgres:14
```

### 3. 初始化数据库

```bash
npm run db:push
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000 查看应用！

## 📝 可用命令

```bash
npm run dev          # 启动开发服务器 (http://localhost:3000)
npm run build        # 构建生产版本
npm start            # 启动生产服务器
npm run lint         # 运行 ESLint 检查

# 数据库相关
npm run db:push      # 推送 schema 到数据库（开发环境）
npm run db:migrate   # 创建和运行迁移（生产环境）
npm run db:generate  # 生成 Prisma Client
npm run db:studio    # 打开 Prisma Studio 可视化管理数据库
```

## 🎨 添加 UI 组件

项目已配置 shadcn/ui，可以按需添加组件：

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add input
npx shadcn-ui@latest add dialog
```

## 📂 项目结构说明

```
flashloom/
├── src/
│   ├── app/              # Next.js 页面和路由
│   ├── components/       # React 组件
│   │   └── ui/          # shadcn/ui 组件（按需添加）
│   ├── lib/             # 工具库
│   ├── hooks/           # 自定义 Hooks
│   ├── store/           # 状态管理
│   └── types/           # TypeScript 类型
├── prisma/              # 数据库
├── public/              # 静态资源
└── deploy/              # 部署配置
```

## 🔧 开发建议

### 1. 安装推荐的 VS Code 扩展
- ESLint
- Prettier
- Prisma
- Tailwind CSS IntelliSense

### 2. 数据库开发流程
```bash
# 1. 修改 prisma/schema.prisma
# 2. 推送到数据库
npm run db:push

# 或创建迁移（推荐用于生产）
npm run db:migrate
```

### 3. 查看数据库
```bash
npm run db:studio
# 在浏览器打开 http://localhost:5555
```

## 🐛 常见问题

### Q: 端口 3000 已被占用
```bash
# 查找占用端口的进程
lsof -ti:3000

# 杀死进程
kill -9 $(lsof -ti:3000)

# 或使用其他端口
PORT=3001 npm run dev
```

### Q: 数据库连接失败
检查：
1. PostgreSQL 是否运行
2. `.env` 中的 `DATABASE_URL` 是否正确
3. 数据库是否已创建

### Q: Prisma Client 错误
```bash
# 重新生成 Prisma Client
npm run db:generate
```

## 📚 下一步开发

1. **用户认证** - 集成 NextAuth.js
2. **AI 服务** - 接入 OpenAI/Stability AI
3. **文件上传** - 配置 S3/R2 存储
4. **UI 组件** - 添加更多 shadcn/ui 组件
5. **API 路由** - 创建图片生成 API

查看 `docs/project-plan.md` 了解完整的开发计划。

## 🚢 部署到生产环境

准备好部署时，查看 `README.md` 中的部署指南。

---

**当前状态**: ✅ 项目初始化完成，可以开始开发！
