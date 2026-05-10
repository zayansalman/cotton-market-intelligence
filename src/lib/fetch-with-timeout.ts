/**
 * Framework-neutral fetch wrapper with an explicit timeout.
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 15_000, ...fetchInit } = init;
  return fetch(url, {
    ...fetchInit,
    signal: AbortSignal.timeout(timeout),
  });
}
