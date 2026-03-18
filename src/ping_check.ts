const PRIMARY = "https://www.compared.work";
// const FALLBACK = "https://147.182.211.216";
const FALLBACK = "https://compare-django.onrender.com";
const TIMEOUT_MS = 150;

/**
 * Pings the primary hostname. If it doesn't respond within TIMEOUT_MS,
 * falls back to the raw IP to avoid waiting on a slow DNS or cold-start.
 */
export async function resolveApiBase(): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PRIMARY}/graphql/`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{__typename}" }),
    });
    // Use the final URL after any redirects so Apollo POSTs go to the right place
    return new URL(res.url).origin;
  } catch {
    return FALLBACK;
  } finally {
    clearTimeout(id);
  }
}
