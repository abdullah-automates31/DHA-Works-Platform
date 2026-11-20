// Copy of ../admin-2fa/mail.ts (each Edge Function is bundled on its own). Keep the two in step.
// Sends the admin code through Brevo's transactional email API (https://developers.brevo.com, POST /v3/smtp/email).
// Pure apart from the injected fetch, so it is unit tested without a network. Secrets: ADMIN_MAIL_API_KEY (a Brevo
// v3 API key, not an SMTP key) and ADMIN_MAIL_FROM (a sender that is verified in Brevo: "name@example.com" or
// "DHA Works <name@example.com>").

export const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

export type Sender = { email: string; name?: string };

/** "DHA Works <a@b.co>" or "a@b.co" into {email, name}. Anything else is refused (null), never guessed at. */
export function parseSender(value: string | undefined): Sender | null {
  const v = (value ?? "").trim();
  if (!v || v.length > 200) return null;
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(v);
  const email = (m ? m[2]! : v).trim();
  if (!EMAIL.test(email) || email.length > 254) return null;
  const name = m ? m[1]!.replace(/^"|"$/g, "").trim() : "";
  if (/[\r\n]/.test(name)) return null;
  return name ? { email, name: name.slice(0, 80) } : { email };
}

export async function sendViaBrevo(
  deps: { fetch: typeof fetch; apiKey: string | undefined; from: string | undefined },
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  const sender = parseSender(deps.from);
  // Fail closed: no key, no valid sender or a malformed recipient means no code goes out.
  if (!deps.apiKey || !sender || !EMAIL.test(to) || /[\r\n]/.test(subject)) return false;
  const res = await deps.fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": deps.apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.status === 201 || res.status === 200;
}
