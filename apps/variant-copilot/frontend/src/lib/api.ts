/**
 * Calls to the backend's JSON endpoints.
 *
 * fetch() only rejects on network failure; an HTTP error (404, 500) resolves normally.
 * These helpers turn both into a thrown Error, so callers (TanStack Query) handle
 * failures in one place.
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await errorMessage(url, response));
  return (await response.json()) as T;
}

/** FastAPI errors: {"detail": "..."} (404, 409) or {"detail": [{msg}, ...]} (422). */
async function errorMessage(url: string, response: Response): Promise<string> {
  try {
    const { detail } = await response.json();
    if (Array.isArray(detail)) return detail.map((d: { msg: string }) => d.msg).join("; ");
    if (detail) return String(detail);
  } catch {
    // Not JSON (e.g. the Vite proxy's 500 when the backend is down).
  }
  return `${url} failed: HTTP ${response.status}`;
}

export function getJson<T>(url: string): Promise<T> {
  return request<T>(url);
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Shown when the backend does not answer (stopped, or still starting). */
export const BACKEND_DOWN = "Cannot reach the backend. Is it running on port 8000?";
