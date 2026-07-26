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

export const memoryApi = {
  // Factual memory
  getFactualMemories: () => safeFetch('/memory/factual'),
  addFactualMemory: (data: any) => safeFetch('/memory/factual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  accessFactualMemory: (id: string) => safeFetch(`/memory/factual/${id}/access`, { method: 'PUT' }),

  // Execution traces
  getTraces: () => safeFetch('/memory/traces'),
  addTrace: (data: any) => safeFetch('/memory/traces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  getRecentTraces: async (limit: number) => {
    const traces = await safeFetch('/memory/traces');
    return traces.slice(0, limit);
  },

  // Reflections
  getReflections: () => safeFetch('/memory/reflections'),
  addReflection: (data: any) => safeFetch('/memory/reflections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  // Router records
  getRouterRecords: () => safeFetch('/memory/router-records'),
  addRouterRecord: (data: any) => safeFetch('/memory/router-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
};
