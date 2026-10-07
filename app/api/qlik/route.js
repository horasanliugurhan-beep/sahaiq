import { handleQlikStatus } from "../../../lib/security/qlik-status.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return handleQlikStatus(request); }
