// Cloudflare Workers entry: `npx wrangler deploy` (see mcp/README.md).
import { handleHttp } from "./server.js";

export default {
  fetch(request) {
    return handleHttp(request);
  },
};
