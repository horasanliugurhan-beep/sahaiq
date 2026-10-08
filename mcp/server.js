// Minimal, stateless MCP server over Streamable HTTP (JSON responses only).
// No dependency on purpose: it runs unchanged on Cloudflare Workers and Node,
// and the small surface is easy to audit. Only what a read-only tool server
// needs is implemented: initialize, ping, tools/list, tools/call.

import { callTool, listTools } from "./tools.js";

export const SERVER_INFO = { name: "sahaiq", title: "SahaIQ (kurgusal demo verisi)", version: "0.1.0" };
// Newest first. We answer with the client's version when we know it.
// Streamable HTTP only: 2024-11-05 used the older HTTP+SSE transport, which this
// server does not implement, so it is deliberately not offered.
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const MAX_BODY = 64 * 1024;
// Origin policy (MCP Streamable HTTP: servers must validate Origin; invalid → 403).
// Claude's connectors call from Anthropic's servers without an Origin header, so
// a missing Origin is allowed. A present Origin must be one of these exactly.
export const ALLOWED_ORIGINS = ["https://claude.ai", "https://claude.com"];

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

/** Reads the body up to `max` bytes; returns null (and cancels) beyond that. */
async function readLimited(request, max) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Web-standard fetch handler (Cloudflare Workers, Node 18+, tests). */
export async function handleHttp(request) {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") {
    return new Response("SahaIQ MCP sunucusu (kurgusal demo verisi). MCP uç noktası: /mcp\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (url.pathname !== "/mcp") return json({ error: "not found" }, 404);
  const origin = request.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.includes(origin)) return json(fail(null, -32600, "Origin not allowed"), 403);
  // Stateless server: no SSE stream to open and no session to delete.
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { allow: "POST" });
  // After initialize, clients send the negotiated version; an unknown one is a 400.
  // A missing header is allowed (the spec says to assume an older version).
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !PROTOCOL_VERSIONS.includes(version)) return json(fail(null, -32600, "Unsupported MCP-Protocol-Version"), 400);
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json(fail(null, -32700, "Content-Type must be application/json"), 415);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return json(fail(null, -32600, "Request too large"), 413);
  // Count bytes while streaming (chunked bodies have no Content-Length) and
  // stop reading as soon as the limit is passed.
  const bytes = await readLimited(request, MAX_BODY);
  if (bytes === null) return json(fail(null, -32600, "Request too large"), 413);

  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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
