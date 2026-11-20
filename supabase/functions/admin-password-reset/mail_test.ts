import { assert, assertEquals, assertFalse } from "@std/assert";
import { BREVO_URL, parseSender, sendViaBrevo } from "./mail.ts";

Deno.test("sender: plain address, named address, quotes, and refusals", () => {
  assertEquals(parseSender("staff@dha-works.example"), { email: "staff@dha-works.example" });
  assertEquals(parseSender("DHA Works <staff@dha-works.example>"), { email: "staff@dha-works.example", name: "DHA Works" });
  assertEquals(parseSender('"DHA Works" <staff@dha-works.example>'), { email: "staff@dha-works.example", name: "DHA Works" });
  for (const bad of [undefined, "", "  ", "not an email", "a@b", "<a@b.co", "x <>", "a@b.co, c@d.co", "a@b.co\nBcc: evil@x.co", "a b@c.de", "x".repeat(300) + "@a.bc"]) {
    assertEquals(parseSender(bad), null, String(bad));
  }
});

function fakeFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status }));
  }) as unknown as typeof fetch;
  return { f, calls };
}

Deno.test("a send goes to Brevo's v3 endpoint with the api-key header and the code in the text body", async () => {
  const { f, calls } = fakeFetch(201);
  const ok = await sendViaBrevo({ fetch: f, apiKey: "xkeysib-test", from: "DHA Works <staff@dha-works.example>" }, "admin@dha-works.example", "Your DHA Works admin code", "code is 123456.");
  assert(ok);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]!.url, BREVO_URL);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assertEquals(headers["api-key"], "xkeysib-test");
  assertFalse("authorization" in headers);
  const body = JSON.parse(calls[0]!.init.body as string);
  assertEquals(body.sender, { email: "staff@dha-works.example", name: "DHA Works" });
  assertEquals(body.to, [{ email: "admin@dha-works.example" }]);
  assertEquals(body.textContent, "code is 123456.");
});

Deno.test("no key, a bad sender, a bad recipient or a header-injection subject send nothing", async () => {
  for (const [apiKey, from, to, subject] of [
    [undefined, "a@b.co", "c@d.co", "s"],
    ["", "a@b.co", "c@d.co", "s"],
    ["k", undefined, "c@d.co", "s"],
    ["k", "nope", "c@d.co", "s"],
    ["k", "a@b.co", "not an email", "s"],
    ["k", "a@b.co", "c@d.co", "s\nBcc: x@y.co"],
  ] as const) {
    const { f, calls } = fakeFetch(201);
    assertFalse(await sendViaBrevo({ fetch: f, apiKey, from }, to, subject, "t"));
    assertEquals(calls.length, 0, `${apiKey} ${from} ${to}`);
  }
});

Deno.test("a Brevo refusal or a network failure is reported as not sent", async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const { f } = fakeFetch(status);
    assertFalse(await sendViaBrevo({ fetch: f, apiKey: "k", from: "a@b.co" }, "c@d.co", "s", "t"), String(status));
  }
  const boom = (() => Promise.reject(new Error("network"))) as unknown as typeof fetch;
  let threw = false;
  try {
    await sendViaBrevo({ fetch: boom, apiKey: "k", from: "a@b.co" }, "c@d.co", "s", "t");
  } catch {
    threw = true;
  }
  assert(threw, "the caller (handler) turns a throw into a 502");
});
