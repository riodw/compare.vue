const DEV = import.meta.env.DEV;

const PRIMARY = DEV ? "http://127.0.0.1:8000" : "https://www.compared.work";
const FALLBACK = DEV ? "https://www.compared.work" : "https://compare-django.onrender.com";
const TIMEOUT_MS = 500;

/**
 * Pings the primary hostname. If it doesn't respond within TIMEOUT_MS,
 * falls back to avoid waiting on a slow DNS or cold-start.
 * In dev: tries localhost first, falls back to compared.work.
 * In prod: tries compared.work first, falls back to render.
 */
export async function resolveApiBase(): Promise<string> {
  const primary = PRIMARY;
  const fallback = FALLBACK;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${primary}/graphql/`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{__typename}" }),
    });
    return new URL(res.url).origin;
  } catch {
    return fallback;
  } finally {
    clearTimeout(id);
  }
}
