import { Router } from 'express';
import {
  installPlugin,
  uninstallPlugin,
  startPlugin,
  stopPlugin,
  getInstalledPlugins,
  configurePlugin,
  callToolByPluginId,
} from '../services/pluginService';

const router = Router();

// 安装插件
router.post('/install', async (req, res) => {
  try {
    const { packageName, version } = req.body;
    if (!packageName) {
      return res.status(400).json({ success: false, error: '缺少 packageName' });
    }
    const result = await installPlugin(packageName, { version });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 卸载插件
router.post('/uninstall', async (req, res) => {
  try {
    const { packageName } = req.body;
    if (!packageName) {
      return res.status(400).json({ success: false, error: '缺少 packageName' });
    }
    const result = await uninstallPlugin(packageName);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 启动插件
router.post('/start', async (req, res) => {
  try {
    const { id, packageName, args } = req.body;
    if (!id || !packageName) {
      return res.status(400).json({ success: false, error: '缺少 id 或 packageName' });
    }
    const result = await startPlugin(id, packageName, args);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 停止插件
router.post('/stop', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: '缺少 id' });
    }
    const result = await stopPlugin(id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 获取已安装列表
router.get('/installed', async (_req, res) => {
  try {
    const plugins = await getInstalledPlugins();
    res.json({ success: true, plugins });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 配置插件
router.post('/configure', async (req, res) => {
  try {
    const { id, config } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: '缺少 id' });
    }
    const result = await configurePlugin(id, config || {});
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 调用插件工具
router.post('/call', async (req, res) => {
  try {
    const { pluginId, toolName, args } = req.body;
    if (!pluginId || !toolName) {
      return res.status(400).json({ success: false, error: '缺少 pluginId 或 toolName' });
    }
    const result = await callToolByPluginId(pluginId, toolName, args);
    res.json({ success: !result.error, ...result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
