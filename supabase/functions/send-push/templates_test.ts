import { assertEquals } from "@std/assert";
import { render } from "./templates.ts";

const ctx = { job: "Fix AC", worker: "Ahmed Khan", total: 2500 };

Deno.test("customer trail uses the agreed wording", () => {
  assertEquals(render("job_accepted", "resident", ctx), {
    title: "Your job is accepted by Ahmed Khan",
    body: "Tap to see details",
  });
  assertEquals(render("quote_received", "resident", ctx), {
    title: "Ahmed Khan quoted",
    body: "Ahmed Khan quoted 2,500 Rs",
  });
  assertEquals(render("job_started", "resident", ctx), {
    title: "Work started by Ahmed Khan",
    body: "Fix AC is started by Ahmed Khan",
  });
  assertEquals(render("job_completed", "resident", ctx), {
    title: "Work completed by Ahmed Khan",
    body: "Fix AC is completed by Ahmed Khan.",
  });
  assertEquals(
    render("rate_worker", "resident", ctx)?.title,
    "Rate your experience for Fix AC by Ahmed Khan",
  );
});

Deno.test("worker trail uses the agreed wording", () => {
  assertEquals(render("new_job", "worker", ctx), {
    title: "New Job Available",
    body: "Fix AC",
  });
  assertEquals(render("cash_awaiting_you", "worker", ctx), {
    title: "Your job Fix AC is completed",
    body: "Fix AC is completed by you. Collect cash and acknowledge.",
  });
});

Deno.test("quote without a known amount still reads well", () => {
  assertEquals(
    render("quote_received", "resident", { ...ctx, total: null })?.body,
    "Ahmed Khan sent a quote for Fix AC",
  );
});

Deno.test("types and roles without a template are not pushed", () => {
  assertEquals(render("new_sign_in", "resident", ctx), null);
  assertEquals(render("new_job", "resident", ctx), null);
  assertEquals(render("job_stuck", "admin", ctx), null);
});
