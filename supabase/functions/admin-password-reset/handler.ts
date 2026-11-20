// Admin "Forgot password?" (migration 0068). Public entrance: the person is not signed in, so the gateway JWT check
// is OFF (verify_jwt = false) and this handler does its own checks.
//
// Security model:
//  * Step "request": the Cloudflare Turnstile token is verified here (not only in the portal), so calling this function
//    directly does not skip the bot check. The database then decides (admin_reset_issue): only an active admin gets a
//    code, one code a minute and five an hour per account. The code is mailed only to the address on the account (the
//    address in the request is used to find the account, never as the destination). The response never contains the code.
//  * Step "confirm": the code, the email and the new password go straight to admin_reset_confirm. Five wrong tries lock
//    the code and ten an hour lock the account's reset. The body is size limited and every field is checked.
//  * Nothing is logged here: no code, no password, no address.

export type RequestResult =
  | { status: "sent"; code: string; email: string }
  | { status: "not_admin" | "wait" | "limit" };
export type ConfirmStatus = "ok" | "wrong" | "locked" | "expired" | "none" | "weak";

export interface Deps {
  verifyHuman(token: string): Promise<boolean>;
  issue(email: string): Promise<RequestResult>;
  confirm(email: string, code: string, password: string): Promise<ConfirmStatus>;
  sendMail(to: string, subject: string, text: string): Promise<boolean>;
}

const MAX_BODY_BYTES = 2048;
const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const CODE = /^[0-9]{6}$/;
const CONFIRM_STATUSES = new Set<string>(["ok", "wrong", "locked", "expired", "none", "weak"]);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "body too large" });
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad request" });
  }

  const email = cleanEmail(body.email);
  if (!email) return json(400, { error: "bad request" });

  if (body.action === "request") {
    // An empty token is passed on: the checker refuses it when Turnstile is on and accepts it only on a local project without a secret.
    const token = body.turnstile;
    if (typeof token !== "string" || token.length > 2048) return json(403, { error: "security check failed" });
    const human = await deps.verifyHuman(token).catch(() => false);
    if (!human) return json(403, { error: "security check failed" });

    const issued = await deps.issue(email).catch((): null => null);
    if (!issued) return json(500, { error: "internal error" });
    if (issued.status !== "sent") return json(200, { status: issued.status });
    const sent = await deps.sendMail(
      issued.email,
      "Your DHA Works password reset code",
      `Your DHA Works admin password reset code is ${issued.code}.\n\nIt works for 10 minutes. If you did not ask to reset your password, ignore this email: your password has not been changed. Never share this code with anyone.`,
    ).catch(() => false);
    if (!sent) return json(502, { status: "mail_failed" });
    return json(200, { status: "sent" });
  }

  if (body.action === "confirm") {
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    const password = body.password;
    if (!CODE.test(code)) return json(400, { error: "bad request" });
    if (typeof password !== "string" || password.length === 0 || password.length > 200) return json(400, { error: "bad request" });
    const status = await deps.confirm(email, code, password).catch((): null => null);
    if (!status || !CONFIRM_STATUSES.has(status)) return json(500, { error: "internal error" });
    return json(200, { status });
  }

  return json(400, { error: "bad request" });
}

/** Local development only: skip the Turnstile check when no secret is set AND the project URL is local. */
export function turnstileSkipAllowed(secret: string | undefined, supabaseUrl: string | undefined): boolean {
  if (secret) return false;
  if (!supabaseUrl) return false;
  try {
    const host = new URL(supabaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "kong" || host === "host.docker.internal" || host.endsWith(".internal");
  } catch {
    return false;
  }
}

/** Local development only: print the mail instead of sending it (same rule as admin-2fa). */
export function devMailAllowed(mode: string | undefined, supabaseUrl: string | undefined): boolean {
  return mode === "dev-log" && turnstileSkipAllowed(undefined, supabaseUrl);
}

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Anything that is not an explicit success from Cloudflare counts as a failure. */
export async function verifyTurnstile(
  deps: { fetch: typeof fetch; secret: string | undefined; supabaseUrl: string | undefined },
  token: string,
): Promise<boolean> {
  if (turnstileSkipAllowed(deps.secret, deps.supabaseUrl)) return true;
  if (!deps.secret || token.length === 0) return false; // hosted project without a secret, or no token: closed
  const res = await deps.fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: deps.secret, response: token }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return false;
  const j = await res.json().catch(() => null);
  return j !== null && typeof j === "object" && (j as { success?: unknown }).success === true;
}
