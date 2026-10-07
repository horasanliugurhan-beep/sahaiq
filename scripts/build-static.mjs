// Builds the static demo into ./out. Server-only API routes cannot be
// statically exported, so app/api is moved aside for the build and restored after.
import { existsSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";

const api = "app/api";
const parked = ".api-parked";
const moved = existsSync(api);
if (moved) renameSync(api, parked);
let code = 1;
try {
  const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", env: { ...process.env, STATIC_EXPORT: "1" }, shell: process.platform === "win32" });
  code = r.status ?? 1;
} finally {
  if (moved) renameSync(parked, api);
}
process.exit(code);
