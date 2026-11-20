// Entry point: wires the handler to Supabase (service role, server-side only) and Brevo for the email.
// Secrets (set with `supabase secrets set`, never committed): ADMIN_MAIL_API_KEY and ADMIN_MAIL_FROM (the same ones
// admin-2fa uses), TURNSTILE_SECRET_KEY (the Cloudflare Turnstile secret). Local only: ADMIN_MAIL_MODE=dev-log.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
import { createClient } from "@supabase/supabase-js";
import { type ConfirmStatus, devMailAllowed, handle, type RequestResult, verifyTurnstile } from "./handler.ts";
import { sendViaBrevo } from "./mail.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) =>
  handle(req, {
    verifyHuman: (token) =>
      verifyTurnstile({ fetch, secret: Deno.env.get("TURNSTILE_SECRET_KEY"), supabaseUrl: Deno.env.get("SUPABASE_URL") }, token),
    async issue(email): Promise<RequestResult> {
      const { data, error } = await db.rpc("admin_reset_issue", { p_email: email });
      if (error || data === null || typeof data !== "object") throw new Error("issue failed");
      const d = data as { status?: string; code?: string; email?: string };
      if (d.status === "sent" && typeof d.code === "string" && typeof d.email === "string") {
        return { status: "sent", code: d.code, email: d.email };
      }
      if (d.status === "not_admin" || d.status === "wait" || d.status === "limit") return { status: d.status };
      throw new Error("unexpected answer");
    },
    async confirm(email, code, password): Promise<ConfirmStatus> {
      const { data, error } = await db.rpc("admin_reset_confirm", { p_email: email, p_code: code, p_password: password });
      if (error || typeof data !== "string") throw new Error("confirm failed");
      return data as ConfirmStatus;
    },
    sendMail(to, subject, text) {
      if (devMailAllowed(Deno.env.get("ADMIN_MAIL_MODE"), Deno.env.get("SUPABASE_URL"))) {
        console.log(`[admin-password-reset dev] to=${to} ${text.split("\n")[0]}`); // local only, see devMailAllowed
        return Promise.resolve(true);
      }
      return sendViaBrevo(
        { fetch, apiKey: Deno.env.get("ADMIN_MAIL_API_KEY"), from: Deno.env.get("ADMIN_MAIL_FROM") },
        to,
        subject,
        text,
      );
    },
  })
);
