# MongoDB 配置指南

项目已配置为使用 MongoDB 数据库。

## 🗄️ 数据库选项

### 选项 1: 本地 MongoDB

**安装 MongoDB (macOS):**
```bash
# 使用 Homebrew 安装
brew tap mongodb/brew
brew install mongodb-community@7.0

# 启动 MongoDB 服务
brew services start mongodb-community@7.0

# 验证安装
mongosh
```

**连接字符串:**
```env
DATABASE_URL="mongodb://localhost:27017/flashloom"
```

### 选项 2: MongoDB Atlas (推荐)

MongoDB Atlas 是官方的云数据库服务，提供免费套餐。

**步骤:**

1. **注册账号**
   - 访问 https://www.mongodb.com/cloud/atlas/register
   - 创建免费账号

2. **创建集群**
   - 选择 "Build a Database"
   - 选择 "Free" 套餐 (M0)
   - 选择离你最近的区域（如 AWS Singapore）
   - 点击 "Create"

3. **配置访问**
   - 创建数据库用户（用户名和密码）
   - 添加 IP 地址到白名单（开发环境可以使用 `0.0.0.0/0` 允许所有 IP）

4. **获取连接字符串**
   - 点击 "Connect"
   - 选择 "Connect your application"
   - 复制连接字符串
   - 替换 `<username>` 和 `<password>` 为你的数据库用户凭据

**连接字符串示例:**
```env
DATABASE_URL="mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/flashloom?retryWrites=true&w=majority"
```

### 选项 3: Docker

```bash
# 运行 MongoDB 容器
docker run --name flashloom-mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=flashloom \
  -d mongo:7.0

# 连接字符串
DATABASE_URL="mongodb://localhost:27017/flashloom"
```

## 🔧 配置项目

### 1. 设置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件
nano .env
```

在 `.env` 文件中设置 `DATABASE_URL`：
```env
DATABASE_URL="mongodb://localhost:27017/flashloom"
# 或使用 MongoDB Atlas
# DATABASE_URL="mongodb+srv://username:password@cluster.mongodb.net/flashloom?retryWrites=true&w=majority"
```

### 2. 生成 Prisma Client

```bash
npm run db:generate
```

### 3. 推送数据库 Schema

```bash
npm run db:push
```

## 📊 管理数据库

### 使用 Prisma Studio

```bash
npm run db:studio
```

访问 http://localhost:5555 可视化管理数据库。

### 使用 MongoDB Compass

MongoDB Compass 是官方的 GUI 工具。

**下载:**
https://www.mongodb.com/try/download/compass

**连接:**
使用你的 `DATABASE_URL` 连接字符串。

### 使用 mongosh (命令行)

```bash
# 连接到本地 MongoDB
mongosh

# 切换到数据库
use flashloom

# 查看集合
show collections

# 查询数据
db.User.find()
db.Image.find()
```

## 🔄 数据库迁移

MongoDB 使用 Prisma 的 `db push` 而不是 `migrate`：

```bash
# 开发环境：推送 schema 变更
npm run db:push

# 注意：MongoDB 不支持传统的迁移文件
# Prisma 会直接同步 schema 到数据库
```

## 📝 Schema 说明

项目使用的 MongoDB 特定配置：

- **ObjectId**: 所有 ID 字段使用 `@db.ObjectId`
- **_id 映射**: 使用 `@map("_id")` 映射到 MongoDB 的默认 ID 字段
- **自动生成**: 使用 `@default(auto())` 自动生成 ObjectId
- **无索引**: MongoDB 中移除了 `@@index`（MongoDB 会自动为关系字段创建索引）

## 🚨 常见问题

### Q: 连接超时
检查：
1. MongoDB 服务是否运行
2. 连接字符串是否正确
3. 如果使用 Atlas，IP 是否在白名单中

### Q: 认证失败
- 确认用户名和密码正确
- 确认数据库用户有正确的权限

### Q: Prisma Client 错误
```bash
# 重新生成 Prisma Client
npm run db:generate
```

## 🔒 安全建议

1. **不要提交 .env 文件到 Git**
2. **使用强密码**
3. **生产环境限制 IP 白名单**
4. **定期备份数据**
5. **使用环境变量存储敏感信息**

## 📚 相关资源

- [Prisma MongoDB 文档](https://www.prisma.io/docs/concepts/database-connectors/mongodb)
- [MongoDB Atlas 文档](https://www.mongodb.com/docs/atlas/)
- [MongoDB 教程](https://www.mongodb.com/docs/manual/tutorial/)

---

**配置完成后，运行 `npm run dev` 启动开发服务器！**
