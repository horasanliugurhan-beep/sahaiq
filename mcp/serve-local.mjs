// Local run for development and tests: `npm run mcp:local` → http://127.0.0.1:8787/mcp
import { createServer } from "node:http";
import { handleHttp } from "./server.js";

const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const response = await handleHttp(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`SahaIQ MCP: http://127.0.0.1:${port}/mcp`));
