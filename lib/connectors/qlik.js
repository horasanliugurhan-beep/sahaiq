// Server-side connector. Only explicitly allowed Qlik Cloud HTTPS origins.
export function qlikConfigFromEnv(env = process.env) {
  return { tenantUrl: (env.QLIK_TENANT_URL || "").trim().replace(/\/$/, ""), apiKey: env.QLIK_API_KEY || "", appId: env.QLIK_APP_ID || "" };
}
function qlikOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/" || !url.hostname.endsWith(".qlikcloud.com")) {
    throw new Error("Only Qlik Cloud HTTPS tenant origins are allowed.");
  }
  return url.origin;
}
function requestOptions(apiKey) {
  return { method: "GET", headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) };
}
export async function testQlikRest(config, fetchImpl = fetch) {
  const { tenantUrl, apiKey } = config;
  if (!tenantUrl || !apiKey) return { ok: false, status: 0, message: "Qlik connection is not configured." };
  try {
    const response = await fetchImpl(qlikOrigin(tenantUrl) + "/api/v1/users/me", requestOptions(apiKey));
    if (!response.ok) return { ok: false, status: response.status, message: "Qlik authentication check failed." };
    const user = await response.json();
    if (!user || typeof user.id !== "string" || !user.id) return { ok: false, status: 502, message: "Unexpected Qlik response." };
    // Identity details are not needed in a status response.
    return { ok: true, status: response.status };
  } catch { return { ok: false, status: 0, message: "Qlik request could not be completed." }; }
}
export async function getQlikApp(config, fetchImpl = fetch) {
  const { tenantUrl, apiKey, appId } = config;
  if (!tenantUrl || !apiKey || !appId) throw new Error("Qlik app metadata check is not configured.");
  const response = await fetchImpl(qlikOrigin(tenantUrl) + "/api/v1/apps/" + encodeURIComponent(appId), requestOptions(apiKey));
  if (!response.ok) throw new Error("Qlik app metadata check failed.");
  const payload = await response.json();
  // Qlik Apps REST returns metadata under attributes (legacy direct mocks are supported).
  const app = payload?.attributes ?? payload;
  if (!app || typeof app.id !== "string" || !app.id) throw new Error("Unexpected Qlik app response.");
  return app;
}
