import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { WorkflowEditorPage } from './pages/WorkflowEditorPage';
import { AgentsPage } from './pages/AgentsPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { SettingsPage } from './pages/SettingsPage';
import { HostsPage } from './pages/HostsPage';
import { ChatWorkspacePage } from './pages/ChatWorkspacePage';
import { LoginPage } from './pages/LoginPage';
import { useStore } from './store/useStore';
import { connectMcpServer } from './api/llmApi';
import { applyTheme } from './lib/theme';
import type { JSX } from 'react';

// 应用启动时应用持久化的主题（明/暗/跟随系统），确保刷新后主题不丢失
function useThemeInit() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
}

// 应用启动时静默重连已启用的 MCP 服务器：后端会话存于内存，刷新/冷启动后会丢失，
// 必须重新握手，否则工具执行会静默失败。
function useMcpAutoReconnect() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const mcps = useStore.getState().mcps || [];
    mcps
      .filter((m) => m.enabled)
      .forEach(async (server) => {
        const res = await connectMcpServer({
          id: server.id,
          name: server.name,
          transport: server.transport,
          url: server.url,
          fsDir: server.fsDir,
          headers: server.headers,
          enabled: server.enabled,
        });
        if (res.success) {
          useStore.getState().updateMCP(server.id, {
            status: 'connected',
            tools: res.tools || [],
            lastError: undefined,
          });
        } else {
          useStore.getState().updateMCP(server.id, {
            status: 'error',
            lastError: res.error,
          });
        }
      });
  }, []);
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const currentUser = useStore((s) => s.currentUser);
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

function App() {
  useMcpAutoReconnect();
  useThemeInit();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/workspace" replace />} />
          <Route path="/workspace" element={<ChatWorkspacePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/workflow/:id" element={<WorkflowEditorPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/hosts" element={<HostsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
