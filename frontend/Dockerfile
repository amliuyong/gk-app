# 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 运行阶段
FROM node:18-alpine AS runner

WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 从构建阶段复制必要文件
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static

# 复制 standalone 目录
COPY --from=builder /app/.next/standalone ./

# 复制启动脚本
COPY ./start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["/app/start.sh"] 