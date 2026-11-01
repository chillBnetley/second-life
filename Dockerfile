# 单容器部署：前端静态构建 + AI 代理（可选密钥）
# 用法：docker build -t second-life . && docker run -p 8080:8080 -p 8787:8787 -e DEEPSEEK_API_KEY=sk-xxx second-life
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_* 在构建时注入；密钥类不要写成 VITE_*
ARG VITE_AI_ENABLED=false
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ENV VITE_AI_ENABLED=$VITE_AI_ENABLED VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
EXPOSE 8080 8787
# AI 代理与静态服务同容器；不配 DEEPSEEK_API_KEY 时 AI 自动降级，游戏照常玩
CMD ["sh", "-c", "node server/proxy.mjs & node server/prod.mjs"]
