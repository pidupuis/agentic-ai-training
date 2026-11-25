/**
 * GET a JSON endpoint of the backend.
 *
 * fetch() only rejects on network failure; an HTTP error (404, 500) resolves normally.
 * This helper turns both into a thrown Error, so callers handle failures in one place.
 */
export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Shown when the backend does not answer (stopped, or still starting). */
export const BACKEND_DOWN = "Cannot reach the backend. Is it running on port 8000?";
