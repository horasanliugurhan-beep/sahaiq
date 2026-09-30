import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
export function buildPilot() {
  const sources = ["lib/import/csv.js", "lib/import/schema.js", "lib/observer.js"];
  const core = sources.map(path => readFileSync(new URL(path, root), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")).join("\n");
  const ui = readFileSync(new URL("lib/pilot-ui.js", root), "utf8");
  return readFileSync(new URL("templates/pilot.html", root), "utf8")
    .replace("/*__SAHAIQ_CORE__*/", () => core.replace(/<\/script/gi, "<\\/script"))
    .replace("/*__SAHAIQ_UI__*/", () => ui.replace(/<\/script/gi, "<\\/script"));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(new URL("public/", root), { recursive: true });
  writeFileSync(new URL("public/pilot.html", root), buildPilot());
}
