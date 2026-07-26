const BASE = import.meta.env.VITE_API_BASE || '';

async function safeFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data && data.success !== undefined) {
    if (!data.success) throw new Error(data.message || 'Request failed');
    const { success, ...rest } = data;
    const values = Object.values(rest);
    return (values.length === 1 ? values[0] : rest) as T;
  }
  return data as T;
}

export async function installPlugin(id: string): Promise<{ success: boolean; tools: any[] }> {
  return safeFetch(`/plugins/${id}/install`, { method: 'POST' });
}

export async function uninstallPlugin(id: string): Promise<{ success: boolean }> {
  return safeFetch(`/plugins/${id}/uninstall`, { method: 'POST' });
}

export async function startPlugin(id: string): Promise<{ success: boolean; tools: any[] }> {
  return safeFetch(`/plugins/${id}/start`, { method: 'POST' });
}

export async function stopPlugin(id: string): Promise<{ success: boolean }> {
  return safeFetch(`/plugins/${id}/stop`, { method: 'POST' });
}

export async function getInstalledPlugins(): Promise<any[]> {
  return safeFetch('/plugins/installed');
}

export async function configurePlugin(id: string, config: any): Promise<{ success: boolean }> {
  return safeFetch(`/plugins/${id}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function searchPlugins(query: string): Promise<any[]> {
  return safeFetch(`/plugins/search?q=${encodeURIComponent(query)}`);
}

export async function compressWithHeadroom(messages: any[], options?: any): Promise<any> {
  return safeFetch('/plugins/headroom/compress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, options }),
  });
}

export async function retrieveFromHeadroom(hash: string, query?: string): Promise<any> {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  return safeFetch(`/plugins/headroom/retrieve/${encodeURIComponent(hash)}${params}`);
}

export async function getHeadroomStats(): Promise<any> {
  return safeFetch('/plugins/headroom/stats');
}
