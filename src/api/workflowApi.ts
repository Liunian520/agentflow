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

export const workflowApi = {
  list: () => safeFetch('/workflows'),
  create: (data: any) => safeFetch('/workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  update: (id: string, data: any) => safeFetch(`/workflows/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  delete: (id: string) => safeFetch(`/workflows/${id}`, { method: 'DELETE' }),
};
