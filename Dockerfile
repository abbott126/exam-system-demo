# 考试系统 v1.0 正式版 —— 容器镜像
# 构建：docker build -t exam-system:1.0 .
# 运行：推荐用 docker-compose.yml（docker compose up -d），或：
#       docker run -d --name exam-system -p 3000:3000 -v exam-data:/app/data exam-system:1.0
FROM node:22-alpine

# python3：Python 编程题判题需要；tzdata：时区数据（配合 TZ 环境变量）
RUN apk add --no-cache python3 tzdata

ENV TZ=Asia/Shanghai \
    PORT=3000

WORKDIR /app
COPY server.js ./
COPY public ./public

# 数据目录：db.json 存放在此，挂载数据卷后可跨容器重建持久化
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
