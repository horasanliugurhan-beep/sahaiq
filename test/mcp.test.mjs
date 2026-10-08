import test from "node:test";
import assert from "node:assert/strict";
import { handleHttp, handleMessage, PROTOCOL_VERSIONS } from "../mcp/server.js";
import { TOOLS } from "../mcp/tools.js";
import { analyze } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { readFileSync } from "node:fs";
import { createLocalServer } from "../mcp/serve-local.mjs";
import { connect } from "node:net";

const demo = analyze(generateSampleRows());
const call = (name, args) => handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }).result;
const out = (name, args) => call(name, args).structuredContent;
const post = (body, headers = {}) =>
  handleHttp(new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

// --- contract ---------------------------------------------------------------

test("tool contract is stable: names, read-only annotations, strict schemas", () => {
  const { tools } = handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }).result;
  assert.deepEqual(tools.map((t) => t.name), ["get_kpis", "get_call_list", "get_customers", "get_customer", "get_segment_summary", "get_sales_timeseries"]);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.equal(t.annotations.openWorldHint, false, t.name);
    assert.equal(t.inputSchema.type, "object", t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    for (const [k, p] of Object.entries(t.inputSchema.properties)) {
      if (p.type === "integer") assert.ok(p.maximum <= 100, `${t.name}.${k} must be capped`);
      if (p.type === "string" && !p.enum) assert.ok(p.maxLength <= 40, `${t.name}.${k} must be length-capped`);
    }
  }
});

test("initialize negotiates a known protocol version and declares tools only", () => {
  const r = handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }).result;
  assert.equal(r.protocolVersion, "2025-06-18");
  assert.deepEqual(Object.keys(r.capabilities), ["tools"]);
  assert.match(r.instructions, /KURGUSAL/);
  const unknown = handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }).result;
  assert.equal(unknown.protocolVersion, PROTOCOL_VERSIONS[0]);
  // 2024-11-05 means the legacy HTTP+SSE transport, which we don't serve: never echo it.
  const legacy = handleMessage({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2024-11-05" } }).result;
  assert.equal(legacy.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.ok(!PROTOCOL_VERSIONS.includes("2024-11-05"));
});

test("JSON-RPC edge cases", () => {
  assert.equal(handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.deepEqual(handleMessage({ jsonrpc: "2.0", id: 3, method: "ping" }).result, {});
  assert.equal(handleMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" }).error.code, -32601);
  assert.equal(handleMessage({ id: 5, method: "ping" }).error.code, -32600);
  assert.equal(handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "drop_table" } }).error.code, -32602);
});

test("tool list and schemas match the committed contract exactly", () => {
  // Any change to names, descriptions, required fields, enums or limits must
  // update test/fixtures/mcp-tools.json in the same PR, on purpose.
  const { tools } = handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }).result;
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/mcp-tools.json", import.meta.url), "utf8"));
  assert.deepEqual(tools, fixture);
});

// --- numbers are the demo's numbers -------------------------------------------

test("KPIs equal the demo exactly", () => {
  const k = out("get_kpis");
  assert.equal(k.customers, 40);
  assert.equal(k.customers, demo.kpis.accounts);
  assert.equal(k.total.kurus, Math.round(demo.kpis.total * 100));
  assert.equal(k.callList.total, 29);
  assert.deepEqual(k.callList.byPriority, { yüksek: 17, orta: 6, düşük: 6 });
  assert.equal(k.paretoCustomers, demo.kpis.paretoCount);
  assert.equal(k.asOf, demo.asOf);
  assert.match(k.source, /kurgusal/);
});

test("call list keeps the demo order, reasons and priorities", () => {
  const all = out("get_call_list", { limit: 100 });
  assert.equal(all.items.length, demo.callList.length);
  all.items.forEach((x, i) => {
    assert.equal(x.rank, i + 1);
    assert.equal(x.customerId, demo.callList[i].customerId);
    assert.deepEqual(x.reasons, demo.callList[i].reasons.map((r) => r.reason));
  });
  const high = out("get_call_list", { priority: "yüksek", limit: 5 });
  assert.equal(high.matched, 17);
  assert.equal(high.items.length, 5);
  assert.ok(high.items.every((x) => x.priority === "yüksek"));
});

test("customer, segment and timeseries totals reconcile to the KPI total", () => {
  const totalK = out("get_kpis").total.kurus;
  const customers = out("get_customers", { limit: 100 });
  assert.equal(customers.items.reduce((s, c) => s + c.total.kurus, 0), totalK);
  assert.ok(customers.items.every((c) => c.name.startsWith("Kurgu ")));
  const seg = out("get_segment_summary");
  assert.equal(seg.segments.reduce((s, x) => s + x.total.kurus, 0), totalK);
  assert.equal(seg.segments.reduce((s, x) => s + x.customers, 0), 40);
  for (const g of ["week", "month"]) {
    const ts = out("get_sales_timeseries", { granularity: g });
    assert.equal(ts.points.reduce((s, p) => s + p.net.kurus, 0), totalK, g);
    assert.deepEqual(ts.points.map((p) => p.period), [...ts.points.map((p) => p.period)].sort(), g);
  }
  const one = out("get_customer", { id: "D016" });
  const series = out("get_sales_timeseries", { granularity: "month", customer_id: "D016" });
  assert.equal(series.points.reduce((s, p) => s + p.net.kurus, 0), one.customer.total.kurus);
});

test("sorting by change puts the steepest drops first and missing trends last", () => {
  const items = out("get_customers", { sort: "change_asc", limit: 100 }).items;
  const pcts = items.map((c) => c.trend.changePct);
  const known = pcts.filter((p) => p !== null);
  assert.deepEqual(known, [...known].sort((a, b) => a - b));
  assert.ok(pcts.indexOf(null) === -1 || pcts.slice(pcts.indexOf(null)).every((p) => p === null));
});

test("money text matches kuruş exactly", () => {
  const c = out("get_customer", { id: "D002" }).customer;
  const [lira, kr] = c.total.text.replace("₺", "").split(",");
  assert.equal(Number(lira.replace(/\./g, "")) * 100 + Number(kr), c.total.kurus);
});

// --- input safety ---------------------------------------------------------------

test("bad input is a tool error with a plain message, never a crash or a stack", () => {
  for (const [name, args] of [
    ["get_call_list", { limit: 1000 }],
    ["get_call_list", { limit: 0 }],
    ["get_call_list", { limit: 2.5 }],
    ["get_call_list", { priority: "acil" }],
    ["get_customers", { region: "x".repeat(500) }],
    ["get_customers", { segment: "vip" }],
    ["get_customers", { foo: 1 }],
    ["get_customer", {}],
    ["get_customer", { id: "YOK" }],
    ["get_sales_timeseries", { granularity: "day" }],
    ["get_sales_timeseries", { granularity: "week", customer_id: "YOK" }],
    ["get_kpis", ["array"]],
    ["get_kpis", JSON.parse('{"toString":1}')],
    ["get_kpis", JSON.parse('{"constructor":1}')],
    ["get_kpis", JSON.parse('{"__proto__":{"x":1}}')],
    ["get_kpis", JSON.parse('{"hasOwnProperty":1}')],
    ["get_call_list", JSON.parse('{"valueOf":1}')],
    ["get_kpis", null],
  ]) {
    const r = call(name, args);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.doesNotMatch(r.content[0].text, /at |\/home|\.js|Error:/, name);
  }
});

// --- HTTP transport ------------------------------------------------------------

test("HTTP: POST JSON works, everything else is refused", async () => {
  const r = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_kpis", arguments: {} } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.equal((await r.json()).result.structuredContent.customers, 40);

  assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.equal((await handleHttp(new Request("http://x/mcp"))).status, 405);
  assert.equal((await handleHttp(new Request("http://x/mcp", { method: "DELETE" }))).status, 405);
  assert.equal((await handleHttp(new Request("http://x/other", { method: "POST" }))).status, 404);
  assert.equal((await post("{not json")).status, 400);
  assert.equal((await post("{}", { "content-type": "text/plain" })).status, 415);
  assert.equal((await post(JSON.stringify({ x: "y".repeat(70 * 1024) }))).status, 413);
  // The limit is in bytes: 40k "ş" is ~40 KB of UTF-16 but ~80 KB of UTF-8.
  const multibyte = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { x: "ş".repeat(40000) } });
  assert.equal((await post(multibyte)).status, 413);
  // Chunked body without Content-Length is still capped while streaming.
  let pulled = 0;
  const endless = new ReadableStream({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(16 * 1024).fill(32));
      if (pulled > 1000) c.close();
    },
  });
  const chunked = await handleHttp(new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: endless, duplex: "half" }));
  assert.equal(chunked.status, 413);
  assert.ok(pulled < 10, `stopped reading early (pulled ${pulled} chunks)`);
  // Invalid UTF-8 is a parse error, not silently replaced.
  const badUtf8 = await handleHttp(new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([0x7b, 0xff, 0x7d]) }));
  assert.equal(badUtf8.status, 400);
  assert.equal((await post([])).status, 400);
  const batch = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }]);
  assert.equal((await batch.json()).length, 1);
});

test("tools are pure: repeated calls give identical results", () => {
  for (const t of TOOLS) {
    const args = t.name === "get_customer" ? { id: "D016" } : t.name === "get_sales_timeseries" ? { granularity: "month" } : {};
    assert.deepEqual(out(t.name, args), out(t.name, args), t.name);
  }
});

// --- origin, protocol version, local adapter --------------------------------

const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

test("Origin: absent is allowed (server-to-server), allowlisted is allowed, anything else is 403", async () => {
  assert.equal((await post(ping)).status, 200);
  assert.equal((await post(ping, { origin: "https://claude.ai" })).status, 200);
  for (const o of ["https://attacker.example", "null", "http://claude.ai", "https://claude.ai.evil.example", "https://claude.ai:8443"]) {
    assert.equal((await post(ping, { origin: o })).status, 403, o);
  }
  // Checked before anything else, including method.
  assert.equal((await handleHttp(new Request("http://x/mcp", { headers: { origin: "https://attacker.example" } }))).status, 403);
});

test("MCP-Protocol-Version header: supported or missing is fine, unknown is 400", async () => {
  assert.equal((await post(ping, { "mcp-protocol-version": "2025-06-18" })).status, 200);
  assert.equal((await post(ping)).status, 200);
  assert.equal((await post(ping, { "mcp-protocol-version": "1999-01-01" })).status, 400);
  assert.equal((await post(ping, { "mcp-protocol-version": "2024-11-05" })).status, 400);
  assert.equal((await post(ping, { "mcp-protocol-version": "" })).status, 400);
});

test("local server survives a client that disconnects mid-request", async () => {
  const server = createLocalServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    await new Promise((resolve) => {
      const s = connect(port, "127.0.0.1", () => {
        s.write("POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{\"a\":");
        setTimeout(() => { s.destroy(); resolve(); }, 50);
      });
      s.on("error", () => {});
    });
    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ping) });
    assert.equal(res.status, 200);
    // Oversized upload through the adapter is cut off, not buffered.
    const big = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "ş".repeat(40000) }) });
    assert.equal(big.status, 413);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

