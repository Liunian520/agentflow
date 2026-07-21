# 部署指南

## 架构说明

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────┐
│  前端 (Vite)    │      │   后端 (Node.js)  │      │  远程主机    │
│  Cloudflare/    │ ──── │  Render/VPS     │ ──── │  (SSH 目标) │
│  Vercel/Netlify │      │  Express + ssh2  │      │             │
└─────────────────┘      └──────────────────┘      └─────────────┘
```

- **前端**：静态站点，可部署到 Cloudflare Pages / Vercel / Netlify（免费）
- **后端**：Node.js 服务，需要部署到 Render.com / VPS（ssh2 依赖原生模块，不支持 Serverless）

---

## 方案一：Render.com（推荐，免费）

### 1. Fork/推送代码到 GitHub

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/你的用户名/agentflow.git
git push -u origin main
```

### 2. 在 Render 创建后端服务

1. 访问 [render.com](https://render.com)，用 GitHub 登录
2. Dashboard → New → Blueprint
3. 选择你的 GitHub 仓库，Render 会自动识别 `render.yaml`
4. 点击 Apply，等待部署完成

或者手动创建：
- New → Web Service
- 选择仓库
- **Name**: `agentflow-server`
- **Runtime**: Node
- **Build Command**: `npm install`
- **Start Command**: `npm run server`
- **Plan**: Free
- 添加环境变量：`NODE_ENV = production`

### 3. 获取后端地址

部署完成后，Render 会给你一个域名：
```
https://agentflow-server.onrender.com
```

### 4. 部署前端

#### Cloudflare Pages（推荐）

```bash
# 1. 安装 wrangler
npm install -g wrangler

# 2. 登录
wrangler login

# 3. 配置后端地址
cp .env.example .env.production
# 编辑 .env.production：
# VITE_API_BASE=https://agentflow-server.onrender.com/api

# 4. 构建并部署
npm run deploy
```

#### Vercel

```bash
npm install -g vercel

# 配置环境变量
vercel env add VITE_API_BASE production
# 输入: https://agentflow-server.onrender.com/api

# 部署
vercel --prod
```

#### Netlify

```bash
npm install -g netlify-cli

# 配置环境变量
netlify env:set VITE_API_BASE https://agentflow-server.onrender.com/api

# 部署
netlify deploy --prod --dir=dist
```

---

## 方案二：自有服务器（VPS / 云服务器）

### 后端部署

```bash
# 1. 克隆代码
git clone <repo> && cd agentflow

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env：
# SERVER_PORT=3001

# 4. 启动服务（开发）
npm run server

# 5. 生产环境用 PM2 守护
npm install -g pm2
pm2 start server/index.ts --name agentflow-server --interpreter tsx
pm2 save
pm2 startup
```

### 前端部署

构建后将 `dist` 目录部署到任意静态托管：

```bash
npm run build
# dist 目录即生产包
```

---

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_API_BASE` | 后端 API 地址（前端用） | `http://localhost:3001/api` |
| `PORT` / `SERVER_PORT` | 后端服务端口 | `3001` |
| `NODE_ENV` | 运行环境 | `development` |

---

## 注意事项

1. **Render Free 限制**：15分钟无请求休眠，冷启动 10-30 秒。可每 5 分钟 Ping 一次 `/health` 保持活跃
2. **CORS**：后端已配置允许常见前端域名，如需添加自定义域名，修改 `server/index.ts` 中的 `allowedOrigins`
3. **HTTPS**：生产环境必须使用 HTTPS，否则浏览器会阻止 API 请求
4. **SSH 私钥**：私钥内容目前存储在前端 localStorage，生产环境建议使用密码认证

---

## 保持 Render 服务活跃（可选）

添加一个定时请求防止休眠：

```bash
# 每 5 分钟 Ping 一次
curl -s https://agentflow-server.onrender.com/health
```

或用 UptimeRobot 等免费服务监控 `/health` 接口。
