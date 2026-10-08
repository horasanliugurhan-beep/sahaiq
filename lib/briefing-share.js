// Serverless ways to hand a briefing on: open it in WhatsApp or save it as a file.
// The WhatsApp link carries the full text, so opening it transfers the briefing
// to WhatsApp's service. No message goes out by itself: the user picks the
// recipient and presses send. The UI must say so next to the button.
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
