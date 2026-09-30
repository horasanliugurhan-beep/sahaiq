import { createHash, timingSafeEqual } from "node:crypto";
import { qlikConfigFromEnv, testQlikRest, getQlikApp } from "../connectors/qlik.js";

const hash = text => createHash("sha256").update(text).digest();
const respond = (body, status) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

// Disabled by default. This only checks metadata, not business data or API-key scopes.
export async function handleQlikStatus(request, env = process.env, fetchImpl = fetch) {
  if (env.SAHAIQ_ENABLE_QLIK_CHECK !== "true") return respond({ mode: "observer", state: "connection_required", message: "Qlik check is disabled." }, 503);
  const expected = env.SAHAIQ_STATUS_TOKEN || "";
  const supplied = request.headers.get("authorization") || "";
  if (expected.length < 32 || supplied.length > 512 || !supplied.startsWith("Bearer ") || !timingSafeEqual(hash(supplied.slice(7)), hash(expected))) {
    return respond({ mode: "observer", state: "unauthorized" }, 401);
  }
  const config = qlikConfigFromEnv(env);
  const checks = { authentication: "not_checked", app_access: "not_checked", business_data: "not_verified", read_only_permissions: "not_verified" };
  const checkedAt = new Date().toISOString();
  if (!config.tenantUrl || !config.apiKey || !config.appId) return respond({ mode: "observer", state: "connection_required", checkedAt, checks }, 503);
  const connection = await testQlikRest(config, fetchImpl);
  checks.authentication = connection.ok ? "passed" : "failed";
  if (!connection.ok) return respond({ mode: "observer", state: "connection_failed", checkedAt, checks }, 502);
  try { await getQlikApp(config, fetchImpl); checks.app_access = "passed"; }
  catch { checks.app_access = "failed"; return respond({ mode: "observer", state: "connection_failed", checkedAt, checks }, 502); }
  return respond({ mode: "observer", state: "metadata_only", checkedAt, checks,
    message: "Authentication and app metadata checked. No customer, debt, order or shipment records verified." }, 200);
}
