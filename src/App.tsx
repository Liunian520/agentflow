import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { WorkflowEditorPage } from './pages/WorkflowEditorPage';
import { AgentsPage } from './pages/AgentsPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { PluginMarketPage } from './pages/PluginMarketPage';
import { SettingsPage } from './pages/SettingsPage';
import { HostsPage } from './pages/HostsPage';
import { ChatWorkspacePage } from './pages/ChatWorkspacePage';
import { LoginPage } from './pages/LoginPage';
import { useStore } from './store/useStore';
import { connectMcpServer } from './api/llmApi';
import { applyTheme } from './lib/theme';
import { workflowApi } from './api/workflowApi';
import { agentApi } from './api/agentApi';
import { channelApi } from './api/channelApi';
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

// 应用启动时从后端加载核心数据
// 后端连接异常时保留本地持久化数据，不覆盖为空
function useDataInit() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const loadFromBackend = async <T,>(apiCall: () => Promise<T>, field: 'workflows' | 'agents' | 'channels') => {
      try {
        const data = await apiCall();
        // 仅在后端成功返回数据时覆盖本地（避免后端异常返回空数组清空本地数据）
        if (Array.isArray(data) && data.length > 0) {
          useStore.setState({ [field]: data } as any);
        }
      } catch (err) {
        // 后端连接失败：静默保留本地数据
        console.warn(`[DataInit] ${field} 从后端加载失败，保留本地数据:`, err);
      }
    };

    Promise.all([
      loadFromBackend(() => workflowApi.list(), 'workflows'),
      loadFromBackend(() => agentApi.list(), 'agents'),
      loadFromBackend(() => channelApi.list(), 'channels'),
    ]).then(() => {
      console.log('[DataInit] Core data sync completed');
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
  useDataInit();
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
          <Route path="/market" element={<PluginMarketPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/hosts" element={<HostsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
