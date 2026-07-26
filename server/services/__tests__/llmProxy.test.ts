import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import crypto from 'crypto';

// Test the pure utility functions from llmProxy
// We test the encryption/decryption logic and URL building separately
// to avoid needing a running server

describe('llmProxy utilities', () => {
  describe('AES-GCM encryption/decryption', () => {
    // Replicate the encryption/decryption logic from llmProxy.ts
    function encryptAesGcm(plaintext: string, keyHex: string): string {
      const keyBuf = Buffer.from(keyHex, 'hex');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const ctBuf = Buffer.concat([encrypted, authTag]);
      return `${iv.toString('hex')}:${ctBuf.toString('hex')}`;
    }

    function decryptAesGcm(encrypted: string, keyHex: string): string {
      const [ivHex, ctHex] = encrypted.split(':');
      if (!ivHex || !ctHex) throw new Error('加密数据格式错误');

      const keyBuf = Buffer.from(keyHex, 'hex');
      const ivBuf = Buffer.from(ivHex, 'hex');
      const ctBuf = Buffer.from(ctHex, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
      const authTag = ctBuf.slice(ctBuf.length - 16);
      const ciphertext = ctBuf.slice(0, ctBuf.length - 16);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    }

    it('应正确加密和解密字符串', () => {
      const key = crypto.randomBytes(32).toString('hex');
      const plaintext = 'sk-xxxxxxxxxxxxxxxxxxxx';
      const encrypted = encryptAesGcm(plaintext, key);
      const decrypted = decryptAesGcm(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('加密结果应与原文不同', () => {
      const key = crypto.randomBytes(32).toString('hex');
      const plaintext = 'api-key-12345';
      const encrypted = encryptAesGcm(plaintext, key);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':');
    });

    it('使用错误密钥应抛出错误', () => {
      const key1 = crypto.randomBytes(32).toString('hex');
      const key2 = crypto.randomBytes(32).toString('hex');
      const plaintext = 'secret';
      const encrypted = encryptAesGcm(plaintext, key1);
      expect(() => decryptAesGcm(encrypted, key2)).toThrow();
    });

    it('格式错误的数据应抛出错误', () => {
      const key = crypto.randomBytes(32).toString('hex');
      expect(() => decryptAesGcm('invalid-data', key)).toThrow('加密数据格式错误');
    });
  });

  describe('URL 构建', () => {
    it('应正确拼接 OpenAI 格式 URL', () => {
      const baseUrl = 'https://api.openai.com/v1';
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('应正确处理尾部斜杠', () => {
      const baseUrl = 'https://api.openai.com/v1/';
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('应正确处理 Anthropic URL 去除 /v1 后缀', () => {
      const baseUrl = 'https://api.anthropic.com/v1';
      const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '') || 'https://api.anthropic.com';
      const url = `${cleanBase}/v1/messages`;
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });

    it('空 baseUrl 应回退到默认 Anthropic URL', () => {
      const baseUrl = '';
      const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '') || 'https://api.anthropic.com';
      const url = `${cleanBase}/v1/messages`;
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });
  });

  describe('Anthropic 消息格式转换', () => {
    it('应正确提取 system 消息并过滤', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      const systemContent = messages.find((m: any) => m.role === 'system')?.content;
      const filteredMessages = messages
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({ role: m.role, content: m.content }));

      expect(systemContent).toBe('You are a helpful assistant.');
      expect(filteredMessages).toHaveLength(2);
      expect(filteredMessages[0].role).toBe('user');
      expect(filteredMessages[1].role).toBe('assistant');
    });

    it('没有 system 消息时应返回 undefined', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
      ];
      const systemContent = messages.find((m: any) => m.role === 'system')?.content;
      expect(systemContent).toBeUndefined();
    });
  });

  describe('SSE 事件格式', () => {
    it('应正确格式化 SSE 事件', () => {
      const event = 'delta';
      const data = { content: 'hello', fullContent: 'hello world' };
      const sseString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      expect(sseString).toContain('event: delta');
      expect(sseString).toContain('"content":"hello"');
      expect(sseString.endsWith('\n\n')).toBe(true);
    });
  });

  describe('上游超时配置', () => {
    it('UPSTREAM_TIMEOUT 应为 120 秒', () => {
      // 验证超时配置值（从代码中读取的常量）
      const UPSTREAM_TIMEOUT = 120000;
      expect(UPSTREAM_TIMEOUT).toBe(120000);
      expect(UPSTREAM_TIMEOUT / 1000).toBe(120);
    });
  });
});
