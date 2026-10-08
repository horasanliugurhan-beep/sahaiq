// Minimal, stateless MCP server over Streamable HTTP (JSON responses only).
// No dependency on purpose: it runs unchanged on Cloudflare Workers and Node,
// and the small surface is easy to audit. Only what a read-only tool server
// needs is implemented: initialize, ping, tools/list, tools/call.

import { callTool, listTools } from "./tools.js";

export const SERVER_INFO = { name: "sahaiq", title: "SahaIQ (kurgusal demo verisi)", version: "0.1.0" };
// Newest first. We answer with the client's version when we know it.
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 64 * 1024;

const INSTRUCTIONS =
  "SahaIQ, saha satış ekipleri için öncelik ve satış analitiği hesaplar. Bu sunucu yalnızca KURGUSAL demo verisi verir; " +
  "firma adları 'Kurgu' ile başlar ve gerçek değildir. Rakamları yeniden hesaplama veya tahmin etme; araçların döndürdüğü " +
  "değerleri kullan ve panellerde veri tarihini (asOf) ile kaynağı göster. Para alanlarında 'kurus' tamsayıdır, 'text' gösterim içindir.";

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Handles one JSON-RPC message. Returns a response object, or null for notifications. */
export function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(msg?.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // e.g. notifications/initialized: nothing to do (stateless)
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return ok(msg.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: listTools() });
    case "tools/call": {
      if (typeof params.name !== "string") return fail(msg.id, -32602, "Invalid params: name");
      const result = callTool(params.name, params.arguments);
      if (!result) return fail(msg.id, -32602, `Unknown tool: ${params.name}`);
      return ok(msg.id, result);
    }
    default:
      return fail(msg.id, -32601, "Method not found");
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });

/** Web-standard fetch handler (Cloudflare Workers, Node 18+, tests). */
export async function handleHttp(request) {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") {
    return new Response("SahaIQ MCP sunucusu (kurgusal demo verisi). MCP uç noktası: /mcp\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (url.pathname !== "/mcp") return json({ error: "not found" }, 404);
  // Stateless server: no SSE stream to open and no session to delete.
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { allow: "POST" });
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json(fail(null, -32700, "Content-Type must be application/json"), 415);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return json(fail(null, -32600, "Request too large"), 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return json(fail(null, -32600, "Request too large"), 413);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return json(fail(null, -32700, "Parse error"), 400);
  }
  if (Array.isArray(payload)) {
    if (!payload.length || payload.length > 20) return json(fail(null, -32600, "Invalid batch"), 400);
    const responses = payload.map(handleMessage).filter(Boolean);
    return responses.length ? json(responses) : new Response(null, { status: 202 });
  }
  const response = handleMessage(payload);
  return response ? json(response) : new Response(null, { status: 202 });
}
