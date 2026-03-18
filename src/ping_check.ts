const PRIMARY = "https://compare-django.onrender.com";
const FALLBACK = "http://147.182.211.216";
const TIMEOUT_MS = 150;

/**
 * Pings the primary hostname. If it doesn't respond within TIMEOUT_MS,
 * falls back to the raw IP to avoid waiting on a slow DNS or cold-start.
 */
export async function resolveApiBase(): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(`${PRIMARY}/graphql/`, {
      method: "HEAD",
      signal: controller.signal,
    });
    return PRIMARY;
  } catch {
    return FALLBACK;
  } finally {
    clearTimeout(id);
  }
}
