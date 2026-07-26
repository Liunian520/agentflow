import { useState, useCallback } from 'react';
import type { FileNode, FileChange } from '../components/chat/ProjectDirPanel';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  'coverage', 'out', '.idea', '.vscode',
]);
const MAX_FILES = 300;

async function buildFileTree(
  handle: any,
  relPath = '',
  depth = 0,
  budget: { n: number } = { n: 0 },
): Promise<FileNode[]> {
  if (depth > 5) return [];
  const nodes: FileNode[] = [];
  try {
    for await (const [name, entry] of (handle as any).entries()) {
      if (name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        if (IGNORE_DIRS.has(name)) continue;
        const children = depth < 3 ? await buildFileTree(entry, relPath ? `${relPath}/${name}` : name, depth + 1, budget) : [];
        nodes.push({ name, path: relPath ? `${relPath}/${name}` : name, isDir: true, children });
      } else {
        if (budget.n >= MAX_FILES) continue;
        budget.n += 1;
        nodes.push({ name, path: relPath ? `${relPath}/${name}` : name, isDir: false });
      }
    }
  } catch {
    /* ignore permission errors */
  }
  nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return nodes;
}

async function resolveFileHandle(dir: any, relPath: string): Promise<any> {
  const segs = relPath.split('/').filter(Boolean);
  let cur = dir;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = await cur.getDirectoryHandle(segs[i], { create: true });
  }
  return cur.getFileHandle(segs[segs.length - 1], { create: true });
}

export function useProjectDir() {
  const [projectDir, setProjectDir] = useState<{ handle: any; name: string } | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<FileChange[]>([]);

  const selectProjectDir = useCallback(async () => {
    try {
      setDirBusy(true);
      setDirError(null);
      const handle = await (window as any).showDirectoryPicker();
      try {
        await handle.requestPermission?.({ mode: 'readwrite' });
      } catch {
        /* already granted */
      }
      const tree = await buildFileTree(handle, '', 0, { n: 0 });
      setProjectDir({ handle, name: handle.name });
      setFileTree(tree);
      setSelectedFiles(new Set());
    } catch (e: any) {
      if (e?.name !== 'AbortError') setDirError(e?.message || '选择目录失败');
    } finally {
      setDirBusy(false);
    }
  }, []);

  const toggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  }, []);

  const readSelectedContext = useCallback(async (): Promise<string> => {
    if (!projectDir || selectedFiles.size === 0) return '';
    const parts: string[] = [];
    for (const path of selectedFiles) {
      try {
        const fileHandle = await resolveFileHandle(projectDir.handle, path);
        const file = await fileHandle.getFile();
        const content = await file.text();
        const ext = path.split('.').pop() || '';
        parts.push(`// 文件: ${path}\n\`\`\`${ext}\n${content}\n\`\`\``);
      } catch {
        /* skip unreadable */
      }
    }
    return parts.join('\n\n');
  }, [projectDir, selectedFiles]);

  const extractChanges = useCallback((text: string): FileChange[] => {
    const re = /```[\w-]*:\s*([^\n]+)\n([\s\S]*?)```/g;
    const out: FileChange[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const path = m[1].trim();
      const content = m[2];
      if (path && !out.find((c) => c.path === path)) {
        out.push({ path, content, status: 'pending' });
      }
    }
    return out;
  }, []);

  const applyChange = useCallback(async (c: FileChange) => {
    if (!projectDir) return;
    try {
      const fileHandle = await resolveFileHandle(projectDir.handle, c.path);
      const writable = await fileHandle.createWritable();
      await writable.write(c.content);
      await writable.close();
      setPendingChanges((prev) => prev.map((x) => (x.path === c.path ? { ...x, status: 'applied' } : x)));
    } catch (e: any) {
      setDirError(e?.message || '写回失败');
    }
  }, [projectDir]);

  const skipChange = useCallback((c: FileChange) => {
    setPendingChanges((prev) => prev.map((x) => (x.path === c.path ? { ...x, status: 'skipped' } : x)));
  }, []);

  const clearChanges = useCallback(() => setPendingChanges([]), []);

  const addPendingChanges = useCallback((changes: FileChange[]) => {
    setPendingChanges((prev) => [
      ...prev,
      ...changes.filter((e) => !prev.find((p) => p.path === e.path)),
    ]);
  }, []);

  return {
    projectDir,
    fileTree,
    selectedFiles,
    dirBusy,
    dirError,
    pendingChanges,
    setDirError,
    selectProjectDir,
    toggleFile,
    readSelectedContext,
    extractChanges,
    applyChange,
    skipChange,
    clearChanges,
    addPendingChanges,
  };
}
