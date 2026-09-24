# ---------- 构建阶段：Node 编译静态站点 ----------
FROM node:22-alpine AS builder
WORKDIR /app

# 优先拷贝依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

# 代码测试与类型检查 + 生产构建
RUN npm run build

# ---------- 运行阶段：Nginx 纯静态托管 ----------
FROM nginx:1.27-alpine AS runtime

# 静态产物
COPY --from=builder /app/dist /usr/share/nginx/html
# 站点与健康检查配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 容器内健康检查：探活 /healthz
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/healthz | grep -qx ok || exit 1

EXPOSE 80
