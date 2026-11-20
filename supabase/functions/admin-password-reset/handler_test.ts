import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  cleanEmail,
  type ConfirmStatus,
  type Deps,
  devMailAllowed,
  handle,
  type RequestResult,
  turnstileSkipAllowed,
  verifyTurnstile,
} from "./handler.ts";

function fake(over: Partial<Deps> = {}, issued: RequestResult = { status: "sent", code: "482913", email: "staff@dha-works.example" }, confirmed: ConfirmStatus = "ok") {
  const calls = { human: [] as string[], issue: [] as string[], confirm: [] as string[][], mail: [] as string[][] };
  const deps: Deps = {
    verifyHuman: (t) => { calls.human.push(t); return Promise.resolve(true); },
    issue: (e) => { calls.issue.push(e); return Promise.resolve(issued); },
    confirm: (e, c, p) => { calls.confirm.push([e, c, p]); return Promise.resolve(confirmed); },
    sendMail: (to, subject, text) => { calls.mail.push([to, subject, text]); return Promise.resolve(true); },
    ...over,
  };
  return { deps, calls };
}
const post = (body: unknown, method = "POST") =>
  new Request("https://x/functions/v1/admin-password-reset", { method, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
const reqBody = (extra: Record<string, unknown> = {}) => ({ action: "request", email: "Staff@DHA-Works.example ", turnstile: "tok", ...extra });
const confBody = (extra: Record<string, unknown> = {}) => ({ action: "confirm", email: "staff@dha-works.example", code: "482913", password: "a long enough password", ...extra });

Deno.test("only POST is accepted", async () => {
  const { deps, calls } = fake();
  assertEquals((await handle(post(null, "GET"), deps)).status, 405);
  assertEquals(calls.issue.length + calls.confirm.length + calls.human.length, 0);
});

Deno.test("junk, oversized and malformed bodies are refused before anything runs", async () => {
  const { deps, calls } = fake();
  for (const b of ["", "not json", "[]", "null", "42", '"x"', "{}", JSON.stringify({ action: "request" }), JSON.stringify({ action: "other", email: "a@b.co" }), JSON.stringify({ action: "request", email: "no-at-sign" })]) {
    const s = (await handle(post(b), deps)).status;
    assert(s === 400, `${b.slice(0, 30)} -> ${s}`);
  }
  assertEquals((await handle(post("x".repeat(3000)), deps)).status, 413);
  assertEquals(calls.issue.length + calls.confirm.length + calls.human.length + calls.mail.length, 0);
});

Deno.test("request: no Turnstile token, a bad one or a failed check means no code is issued and nothing is mailed", async () => {
  for (const turnstile of [undefined, 5, null]) {
    const { deps, calls } = fake();
    assertEquals((await handle(post(reqBody({ turnstile })), deps)).status, 403);
    assertEquals(calls.issue.length + calls.mail.length, 0);
  }
  const { deps, calls } = fake({ verifyHuman: () => Promise.resolve(false) });
  assertEquals((await handle(post(reqBody()), deps)).status, 403);
  const { deps: d2, calls: c2 } = fake({ verifyHuman: () => Promise.reject(new Error("down")) });
  assertEquals((await handle(post(reqBody()), d2)).status, 403);
  assertEquals(calls.issue.length + c2.issue.length, 0);
});

Deno.test("request: the code is mailed only to the address the database returned, and never appears in the response", async () => {
  const { deps, calls } = fake({}, { status: "sent", code: "482913", email: "real-owner@dha-works.example" });
  const res = await handle(post(reqBody({ email: "attacker-typed@evil.example" })), deps);
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(JSON.parse(text), { status: "sent" });
  assertFalse(text.includes("482913"));
  assertEquals(calls.issue, ["attacker-typed@evil.example"]); // used only to find the account
  assertEquals(calls.mail.length, 1);
  assertEquals(calls.mail[0]![0], "real-owner@dha-works.example");
  assert(calls.mail[0]![2].includes("482913"));
});

Deno.test("request: not an admin, wait and limit are answered plainly and nothing is mailed", async () => {
  for (const status of ["not_admin", "wait", "limit"] as const) {
    const { deps, calls } = fake({}, { status });
    const res = await handle(post(reqBody()), deps);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { status });
    assertEquals(calls.mail.length, 0);
  }
});

Deno.test("request: a failed mail is reported and a database failure is a plain 500", async () => {
  const { deps } = fake({ sendMail: () => Promise.resolve(false) });
  const res = await handle(post(reqBody()), deps);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { status: "mail_failed" });
  const { deps: d2 } = fake({ issue: () => Promise.reject(new Error("db down")) });
  assertEquals((await handle(post(reqBody()), d2)).status, 500);
});

Deno.test("confirm: bad codes and passwords are refused before the database is called", async () => {
  const { deps, calls } = fake();
  for (const extra of [{ code: "12345" }, { code: "1234567" }, { code: "12345a" }, { code: 482913 }, { code: undefined }, { password: "" }, { password: 12 }, { password: "x".repeat(201) }, { password: undefined }]) {
    assertEquals((await handle(post(confBody(extra as Record<string, unknown>)), deps)).status, 400, JSON.stringify(extra));
  }
  assertEquals(calls.confirm.length, 0);
});

Deno.test("confirm: every database answer is passed on, spaces in the code are ignored, the password is not echoed", async () => {
  for (const status of ["ok", "wrong", "locked", "expired", "none", "weak"] as const) {
    const { deps, calls } = fake({}, undefined, status);
    const res = await handle(post(confBody({ code: "482 913" })), deps);
    assertEquals(res.status, 200);
    const text = await res.text();
    assertEquals(JSON.parse(text), { status });
    assertFalse(text.includes("a long enough password"));
    assertEquals(calls.confirm[0], ["staff@dha-works.example", "482913", "a long enough password"]);
    assertEquals(calls.human.length, 0); // confirm needs no Turnstile: the code is the proof
  }
});

Deno.test("confirm: an unknown answer or a database failure is a plain 500", async () => {
  const { deps } = fake({ confirm: () => Promise.resolve("hacked" as ConfirmStatus) });
  assertEquals((await handle(post(confBody()), deps)).status, 500);
  const { deps: d2 } = fake({ confirm: () => Promise.reject(new Error("db down")) });
  assertEquals((await handle(post(confBody()), d2)).status, 500);
});

Deno.test("cleanEmail trims and lower-cases, and refuses headers, spaces and long values", () => {
  assertEquals(cleanEmail("  Staff@DHA-Works.example "), "staff@dha-works.example");
  for (const bad of ["a@b", "a b@c.co", "a@b.co\r\nBcc: x@y.co", "<a@b.co>", 5, null, undefined, "a".repeat(250) + "@b.co"]) assertEquals(cleanEmail(bad), null);
});

Deno.test("Turnstile: skipped only with no secret on a local project; a hosted project without a secret fails closed", async () => {
  assert(turnstileSkipAllowed(undefined, "http://kong:8000"));
  assert(turnstileSkipAllowed(undefined, "http://127.0.0.1:55321"));
  assertFalse(turnstileSkipAllowed(undefined, "https://abc.supabase.co"));
  assertFalse(turnstileSkipAllowed(undefined, undefined));
  assertFalse(turnstileSkipAllowed("secret", "http://127.0.0.1:55321"));
  const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
  assertEquals(await verifyTurnstile({ fetch: never, secret: undefined, supabaseUrl: "https://abc.supabase.co" }, "tok"), false);
  assert(devMailAllowed("dev-log", "http://127.0.0.1:55321"));
  assertFalse(devMailAllowed("dev-log", "https://abc.supabase.co"));
  assertFalse(devMailAllowed(undefined, "http://127.0.0.1:55321"));
});

Deno.test("Turnstile: an empty token is refused when the check is on, and passes only on a local project without a secret", async () => {
  const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
  assertEquals(await verifyTurnstile({ fetch: never, secret: "s", supabaseUrl: "https://abc.supabase.co" }, ""), false);
  assertEquals(await verifyTurnstile({ fetch: never, secret: "s", supabaseUrl: "http://127.0.0.1:55321" }, ""), false);
  assertEquals(await verifyTurnstile({ fetch: never, secret: undefined, supabaseUrl: "http://127.0.0.1:55321" }, ""), true);
  assertEquals(await verifyTurnstile({ fetch: never, secret: undefined, supabaseUrl: "https://abc.supabase.co" }, ""), false);
  // the handler passes an empty token on to the checker (which decides)
  const { deps, calls } = fake();
  assertEquals((await handle(post(reqBody({ turnstile: "" })), deps)).status, 200);
  assertEquals(calls.human, [""]);
});

Deno.test("Turnstile: only an explicit success counts", async () => {
  const mk = (res: () => Promise<Response>) => ((() => res()) as unknown as typeof fetch);
  const d = (f: typeof fetch) => ({ fetch: f, secret: "s", supabaseUrl: "https://abc.supabase.co" });
  assert(await verifyTurnstile(d(mk(() => Promise.resolve(Response.json({ success: true })))), "t"));
  assertFalse(await verifyTurnstile(d(mk(() => Promise.resolve(Response.json({ success: false })))), "t"));
  assertFalse(await verifyTurnstile(d(mk(() => Promise.resolve(Response.json({ success: "true" })))), "t"));
  assertFalse(await verifyTurnstile(d(mk(() => Promise.resolve(Response.json({})))), "t"));
  assertFalse(await verifyTurnstile(d(mk(() => Promise.resolve(new Response("nope", { status: 500 })))), "t"));
  assertFalse(await verifyTurnstile(d(mk(() => Promise.resolve(new Response("not json", { status: 200 })))), "t"));
});
