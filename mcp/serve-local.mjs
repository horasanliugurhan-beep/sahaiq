// Local run for development and tests: `npm run mcp:local` → http://127.0.0.1:8787/mcp
// The body is streamed into handleHttp (which enforces the byte limit), and a
// client that disconnects mid-request must never take the process down.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { handleHttp } from "./server.js";

export function createLocalServer() {
  return createServer(async (req, res) => {
    req.on("error", () => {}); // aborted uploads surface below as a failed read
    res.on("error", () => {});
    try {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? "half" : undefined,
      });
      const response = await handleHttp(request);
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (res.destroyed || res.writableEnded || req.destroyed) return;
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Bad request" } }));
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const port = Number(process.env.PORT || 8787);
  createLocalServer().listen(port, "127.0.0.1", () => console.log(`SahaIQ MCP: http://127.0.0.1:${port}/mcp`));
}
