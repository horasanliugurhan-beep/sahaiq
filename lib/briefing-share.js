// Serverless ways to send a briefing: open it in WhatsApp or save it as a file.
// Nothing is sent by SahaIQ itself; the user picks the recipient in WhatsApp.
// Every target is re-validated here, so a stale "verified" badge can never
// authorize sending an altered text.

import { validateBriefingText } from "./briefing.js";

export function shareTargets(text, b) {
  const check = validateBriefingText(text, b);
  if (!check.ok) return { ok: false, unknown: check.unknown };
  return {
    ok: true,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    fileName: `sahaiq-brifing-${b.asOf || "tarihsiz"}.txt`,
  };
}
