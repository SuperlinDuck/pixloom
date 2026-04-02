#!/bin/bash

set -e

echo "🚀 开始部署 FlashLoom..."

APP_DIR="/var/www/flashloom"
BRANCH="main"

cd $APP_DIR

echo "📥 拉取最新代码..."
git pull origin $BRANCH

echo "📦 安装依赖..."
npm install --production=false

echo "🗄️  运行数据库迁移..."
npx prisma migrate deploy
npx prisma generate

echo "🔨 构建应用..."
npm run build

echo "♻️  重启 PM2..."
pm2 restart flashloom

echo "✅ 部署完成！"
echo "📊 查看日志: pm2 logs flashloom"
echo "📈 查看状态: pm2 status"
