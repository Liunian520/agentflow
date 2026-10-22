## Cursor Cloud specific instructions

AgentFlow is one Vite/React app plus an Express API. App data lives in browser `localStorage` (`agentflow-data`). There is no database and no automated test script.

- Run the UI with `npm run dev` (http://localhost:5173) and the API with `npm run server` (http://localhost:3001, `GET /health`). Scripts are in `package.json`. Chat commands handled by the local intent parser (create an agent or workflow) do not need an LLM key. Settings health, LLM, SSH, MCP, and A2A need the API process.
- The API CORS allowlist in `server/index.ts` includes `localhost` and `127.0.0.1` on ports 5173–5176. A disallowed origin gets no `Access-Control-Allow-Origin` header. Vite does not proxy `/api`; the client uses `VITE_API_BASE` (default `http://localhost:3001/api`, see `.env.example`).
- The first visit is `/login` (“首次使用，请设置管理员账号”). Any username and a password of at least 6 characters creates the admin. The default chat mode is 编码, which shows 确认执行 before it creates an agent or workflow.
- `npm run lint` (oxlint) exits 0. It still prints existing `react-hooks` warnings. `npm run build` is the typecheck plus production bundle.
- CI uses Node 22 (`.github/workflows/deploy.yml`). `ssh2` is native; `npm install` needs a compiler if the prebuild is missing.
- To call a loopback or private LLM, MCP, or A2A URL, start the API with `ALLOW_PRIVATE_URLS=1` (`server/services/urlGuard.ts`). Extra browser origins can be added with `CORS_EXTRA_ORIGINS`. SFTP local paths under `/etc`, `/proc`, `/sys`, and similar system roots are rejected unless you are outside those prefixes.
