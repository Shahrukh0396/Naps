/**
 * API client stub for Phase 3 integration.
 * Phase 1 uses mocks in src/mocks/routes.ts.
 * Phase 2 will stand up a local Express server with the same shapes.
 */
export const API_BASE_URL =
  // Android emulator → host machine; iOS simulator can use localhost
  // Override later via react-native-config / env.
  'http://localhost:8787';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
