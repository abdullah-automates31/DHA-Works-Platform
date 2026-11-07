// send-push: delivers public.notifications rows as push notifications (FCM) to the recipient's devices.
//
// Called by the database (private.post_push, from the notifications insert trigger and the retry cron) with
// {"ids": [...]} and the shared x-push-secret header. Each row is claimed by setting push_sent_at, so a row is
// pushed at most once even when the trigger and the retry overlap. Logs counts only: never tokens or text.
//
// The header is checked against Vault push_webhook_secret (public.push_webhook_secret_matches, service role only).
// Function secret: FIREBASE_SERVICE_ACCOUNT (the Firebase service account JSON key).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from "@supabase/supabase-js";
import { parseServiceAccount, send, type SendResult } from "./fcm.ts";
import { isRole, render } from "./templates.ts";

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  job_id: string | null;
  payload: Record<string, unknown> | null;
}

// The customer and worker apps register raw FCM tokens. An Expo token (an older worker design) is skipped,
// never deleted, so switching formats can never wipe a device.
const EXPO_TOKEN = /^Expo(nent)?PushToken\[/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const text = (
  v: unknown,
): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const header = req.headers.get("x-push-secret") ?? "";
  const { data: authorized } = header
    ? await db.rpc("push_webhook_secret_matches", { p_secret: header })
    : { data: false };
  if (authorized !== true) return json({ error: "unauthorized" }, 401);

  const input = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(input?.ids)
    ? [
      ...new Set<string>(input.ids.filter((id: unknown) =>
        typeof id === "string" && UUID.test(id)
      )),
    ].slice(0, MAX_IDS)
    : [];
  if (ids.length === 0) return json({ claimed: 0 });

  const sa = parseServiceAccount(Deno.env.get("FIREBASE_SERVICE_ACCOUNT"));
  if (!sa) {
    // Leave the rows unclaimed so the retry sends them once the key is configured.
    console.error("send-push: FIREBASE_SERVICE_ACCOUNT is missing or invalid");
    return json({ error: "push not configured" }, 503);
  }

  // Claim: only rows nobody has handled yet. Concurrent calls cannot claim the same row twice.
  const { data: claimed, error: claimError } = await db
    .from("notifications")
    .update({ push_sent_at: new Date().toISOString() })
    .in("id", ids)
    .is("push_sent_at", null)
    .select("id, user_id, type, job_id, payload");
  if (claimError) {
    console.error("send-push: claim failed", claimError.code);
    return json({ error: "claim failed" }, 500);
  }
  const rows = (claimed ?? []) as NotificationRow[];
  if (rows.length === 0) return json({ claimed: 0 });

  // Context in a few batched reads.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const jobIds = [
    ...new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x)),
  ];
  const quoteIds = [
    ...new Set(
      rows.map((r) => text(r.payload?.quote_id)).filter((x): x is string =>
        !!x && UUID.test(x)
      ),
    ),
  ];

  const [recipients, jobs, quotes, tokens] = await Promise.all([
    db.from("profiles").select("id, role, account_status").in("id", userIds),
    jobIds.length
      ? db.from("jobs").select("id, title, accepted_worker_id").in("id", jobIds)
      : { data: [] },
    quoteIds.length
      ? db.from("quotes").select("id, worker_id, total").in("id", quoteIds)
      : { data: [] },
    db.from("device_tokens").select("user_id, push_token").in(
      "user_id",
      userIds,
    ),
  ]);

  for (const result of [recipients, jobs, quotes, tokens]) {
    if ("error" in result && result.error) {
      // Unreadable context would send nothing: hand the rows back to the retry instead of losing them.
      console.error("send-push: context read failed", result.error.code);
      await db.from("notifications").update({ push_sent_at: null }).in(
        "id",
        rows.map((r) => r.id),
      );
      return json({ error: "context read failed" }, 500);
    }
  }

  // Suspended accounts get no push.
  const roleOf = new Map<string, string>(
    (recipients.data ?? []).filter((p) => p.account_status === "active").map((
      p,
    ) => [p.id, String(p.role)]),
  );
  const jobOf = new Map((jobs.data ?? []).map((j) => [j.id, j]));
  const quoteOf = new Map((quotes.data ?? []).map((q) => [q.id, q]));
  const tokensOf = new Map<string, string[]>();
  for (
    const t of (tokens.data ?? []).filter((t) => !EXPO_TOKEN.test(t.push_token))
  ) tokensOf.set(t.user_id, [...(tokensOf.get(t.user_id) ?? []), t.push_token]);

  // Worker names: the quote's worker for quote_received, otherwise the job's accepted worker.
  const workerIdFor = (r: NotificationRow): string | null => {
    const quoteId = text(r.payload?.quote_id);
    const quote = quoteId ? quoteOf.get(quoteId) : undefined;
    return quote?.worker_id ??
      (r.job_id ? jobOf.get(r.job_id)?.accepted_worker_id ?? null : null);
  };
  const workerIds = [
    ...new Set(rows.map(workerIdFor).filter((x): x is string => !!x)),
  ];
  const workers = workerIds.length
    ? await db.from("profiles").select("id, full_name").in("id", workerIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = new Map(
    (workers.data ?? []).map((p) => [p.id, text(p.full_name)]),
  );

  let sent = 0, failed = 0, skipped = 0;
  const deadTokens: { user_id: string; push_token: string }[] = [];
  const release: string[] = [];

  await Promise.all(rows.map(async (row) => {
    const role = roleOf.get(row.user_id) ?? "";
    const deviceTokens = tokensOf.get(row.user_id) ?? [];
    if (!isRole(role) || deviceTokens.length === 0) {
      skipped++;
      return;
    }
    const job = row.job_id ? jobOf.get(row.job_id) : undefined;
    const quoteId = text(row.payload?.quote_id);
    const workerId = workerIdFor(row);
    const message = render(row.type, role, {
      job: text(row.payload?.title) ?? text(job?.title) ?? "your job",
      worker: (workerId ? nameOf.get(workerId) : null) ??
        (role === "resident" ? "Your worker" : "The worker"),
      total: quoteId ? quoteOf.get(quoteId)?.total ?? null : null,
    });
    if (!message) {
      skipped++;
      return;
    }

    const data: Record<string, string> = {
      type: row.type,
      notification_id: row.id,
    };
    if (row.job_id) data.job_id = row.job_id;

    const results: SendResult[] = await Promise.all(
      deviceTokens.map((token) =>
        send(sa, token, { ...message, data }).catch((): SendResult => "retry")
          .then((result) => {
            if (result === "dead") {
              deadTokens.push({ user_id: row.user_id, push_token: token });
            }
            return result;
          })
      ),
    );
    if (results.includes("ok")) sent++;
    else {
      failed++;
      // Nothing delivered and at least one failure was transient: let the retry cron try again.
      if (results.includes("retry")) release.push(row.id);
    }
  }));

  for (const dead of deadTokens) {
    await db.from("device_tokens").delete().eq("user_id", dead.user_id).eq(
      "push_token",
      dead.push_token,
    );
  }
  if (release.length) {
    await db.from("notifications").update({ push_sent_at: null }).in(
      "id",
      release,
    );
  }

  const summary = {
    claimed: rows.length,
    sent,
    failed,
    skipped,
    removedTokens: deadTokens.length,
    retried: release.length,
  };
  console.log("send-push", JSON.stringify(summary));
  return json(summary);
});
