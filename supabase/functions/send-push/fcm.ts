// Firebase Cloud Messaging HTTP v1 sender, authenticated with a service account.
import { importPKCS8, SignJWT } from "jose";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface FcmMessage {
  title: string;
  body: string;
  /** String values only (FCM requirement). */
  data: Record<string, string>;
}

/** ok = delivered to FCM; dead = token will never work again (delete it); retry = transient; error = anything else. */
export type SendResult = "ok" | "dead" | "retry" | "error";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Android channel the apps create at startup. */
export const ANDROID_CHANNEL_ID = "job_updates";

let cached: { token: string; expiresAt: number } | null = null;

export function parseServiceAccount(
  raw: string | undefined,
): ServiceAccount | null {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) return cached.token;

  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`google oauth failed: ${res.status}`);
  const json = await res.json();
  cached = {
    token: json.access_token,
    expiresAt: now + Number(json.expires_in ?? 3600),
  };
  return cached.token;
}

export async function send(
  sa: ServiceAccount,
  deviceToken: string,
  msg: FcmMessage,
): Promise<SendResult> {
  const auth = await accessToken(sa);
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: msg.title, body: msg.body },
          data: msg.data,
          android: {
            priority: "HIGH",
            notification: { channel_id: ANDROID_CHANNEL_ID },
          },
          apns: { payload: { aps: { sound: "default" } } },
        },
      }),
    },
  );
  if (res.ok) return "ok";
  if (res.status === 429 || res.status >= 500) return "retry";

  const text = await res.text();
  // UNREGISTERED (404), a malformed token (400) or a token from another Firebase project
  // (SENDER_ID_MISMATCH, 403) never start working again.
  if (
    res.status === 404 || text.includes("UNREGISTERED") ||
    text.includes("SENDER_ID_MISMATCH")
  ) return "dead";
  if (res.status === 400 && text.toLowerCase().includes("registration token")) {
    return "dead";
  }
  return "error";
}
