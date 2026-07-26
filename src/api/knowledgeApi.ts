const API_BASE = import.meta.env.VITE_API_BASE || '';

async function safeFetch(url: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${url}`, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data && data.success !== undefined) {
    if (!data.success) throw new Error(data.message || 'Request failed');
    const { success, ...rest } = data;
    const values = Object.values(rest);
    return values.length === 1 ? values[0] : rest;
  }
  return data;
}

export const knowledgeApi = {
  list: () => safeFetch('/knowledge'),
  create: (data: any) => safeFetch('/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  search: (embedding: number[], topK?: number) => safeFetch('/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embedding, topK }),
  }),
  delete: (id: string) => safeFetch(`/knowledge/${id}`, { method: 'DELETE' }),
};
