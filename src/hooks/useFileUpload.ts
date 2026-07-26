import { useState, useRef, useCallback, useMemo } from 'react';
import { generateId } from '../lib/utils';
import type { ChatMessage, FileAttachment } from '../types';

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|markdown|txt|py|php|html?|css|scss|sass|less|yml|yaml|env|toml|ini|sh|bash|sql|go|java|kt|rb|rs|vue|svelte|xml|csv|log|lock|gitignore|dockerfile)$/i;

export type UploadedFile = FileAttachment;

export function useFileUpload(activeMessages: ChatMessage[]) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showRefPicker, setShowRefPicker] = useState(false);
  const [refSelection, setRefSelection] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 从对话历史收集所有附件
  const conversationAttachments = useMemo(() => {
    const map = new Map<string, FileAttachment>();
    activeMessages.forEach((m) =>
      (m.attachments || []).forEach((a) => {
        if (!map.has(a.id)) map.set(a.id, a);
      })
    );
    return Array.from(map.values());
  }, [activeMessages]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    files.forEach((file) => {
      const id = generateId();
      const isText = file.type.startsWith('text/') || TEXT_EXT.test(file.name);
      if (isText) {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedFiles((prev) => [
            ...prev,
            { id, name: file.name, size: file.size, type: file.type || 'text/plain', kind: 'text', content: String(reader.result || '') },
          ]);
        };
        reader.readAsText(file);
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedFiles((prev) => [
            ...prev,
            { id, name: file.name, size: file.size, type: file.type, kind: 'image', preview: String(reader.result || '') },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setUploadedFiles((prev) => [
          ...prev,
          { id, name: file.name, size: file.size, type: file.type || 'application/octet-stream', kind: 'other' },
        ]);
      }
    });
  }, []);

  const removeUploadedFile = useCallback((id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const readUploadedContext = useCallback((): string | null => {
    if (uploadedFiles.length === 0) return null;
    const parts = uploadedFiles.map((f) => {
      if (f.kind === 'text' && f.content != null) {
        const body = f.content.length > 20000 ? f.content.slice(0, 20000) + '\n…(已截断)' : f.content;
        return `【上传文件：${f.name}】\n\`\`\`\n${body}\n\`\`\``;
      }
      if (f.kind === 'image') return `【上传图片：${f.name}，${(f.size / 1024).toFixed(1)}KB】(如模型支持视觉输入可参考)`;
      return `【上传文件：${f.name}，${(f.size / 1024).toFixed(1)}KB，类型 ${f.type}】`;
    });
    return parts.join('\n\n');
  }, [uploadedFiles]);

  /** 返回所有图片附件的 dataURL，供视觉模型直接消费（不丢失图像信息） */
  const getImageAttachments = useCallback((): Array<{ id: string; name: string; dataUrl: string; mimeType: string }> => {
    return uploadedFiles
      .filter((f) => f.kind === 'image' && f.preview)
      .map((f) => ({ id: f.id, name: f.name, dataUrl: f.preview!, mimeType: f.type || 'image/png' }));
  }, [uploadedFiles]);

  /** 判断当前是否包含图片附件 */
  const hasImages = useCallback((): boolean => {
    return uploadedFiles.some((f) => f.kind === 'image' && f.preview);
  }, [uploadedFiles]);

  const confirmRefAttachments = useCallback(() => {
    const picked = conversationAttachments.filter((a) => refSelection.includes(a.id));
    setUploadedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.id));
      return [...prev, ...picked.filter((p) => !existing.has(p.id))];
    });
    setRefSelection([]);
    setShowRefPicker(false);
    setShowAttachMenu(false);
  }, [conversationAttachments, refSelection]);

  const clearUploadedFiles = useCallback(() => setUploadedFiles([]), []);

  return {
    uploadedFiles,
    showAttachMenu,
    showRefPicker,
    refSelection,
    fileInputRef,
    conversationAttachments,
    setShowAttachMenu,
    setShowRefPicker,
    setRefSelection,
    handleFileSelect,
    removeUploadedFile,
    readUploadedContext,
    getImageAttachments,
    hasImages,
    confirmRefAttachments,
    clearUploadedFiles,
  };
}
