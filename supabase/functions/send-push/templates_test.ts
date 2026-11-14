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
  assertEquals(render("quote_revised", "resident", ctx), {
    title: "Ahmed Khan updated the quote",
    body: "New price 2,500 Rs. Check the price and visit time for Fix AC.",
  });
  assertEquals(render("quote_revised", "worker", ctx), null);
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

Deno.test("report tracking notices are generic and never name the other person or the punishment", () => {
  for (const role of ["resident", "worker"]) {
    assertEquals(render("report_received", role, ctx)?.title, "We received your report");
    assertEquals(render("report_in_review", role, ctx)?.title, "Your report is being reviewed");
    assertEquals(
      render("report_resolved", role, { ...ctx, outcome: "action_taken" })?.body,
      "DHA reviewed your report and took action.",
    );
    assertEquals(
      render("report_resolved", role, { ...ctx, outcome: "no_action" })?.body,
      "DHA reviewed your report. No action was needed.",
    );
    // an unknown or missing outcome reads as "no action" rather than guessing
    assertEquals(
      render("report_resolved", role, ctx)?.body,
      "DHA reviewed your report. No action was needed.",
    );
  }
  const all = JSON.stringify([
    render("report_received", "worker", ctx),
    render("report_in_review", "worker", ctx),
    render("report_resolved", "worker", { ...ctx, outcome: "action_taken" }),
  ]).toLowerCase();
  for (const word of ["suspend", "warning", "ahmed khan", "fix ac"]) {
    assertEquals(all.includes(word), false, word);
  }
});

Deno.test("staff warnings, messages and suspensions are pushed with a neutral fallback", () => {
  assertEquals(render("report_warning", "worker", { ...ctx, message: "Be on time" }), {
    title: "Warning from DHA staff",
    body: "Be on time",
  });
  assertEquals(render("staff_message", "resident", ctx)?.body, "Open the app to read the message.");
  assertEquals(
    render("account_suspended", "worker", { ...ctx, message: "Rude behaviour", until: "2026-11-21T10:00:00Z" })?.body,
    "Reason: Rude behaviour. It ends on 21 Nov 2026.",
  );
  assertEquals(
    render("account_suspended", "resident", { ...ctx, message: "Rude behaviour" })?.body,
    "Reason: Rude behaviour. DHA staff will tell you when it ends.",
  );
  assertEquals(render("account_suspended", "worker", ctx)?.body, "Contact DHA staff. DHA staff will tell you when it ends.");
  assertEquals(render("account_reactivated", "worker", { ...ctx, outcome: "expired" })?.body, "Your suspension has ended. You can use the app again.");
  assertEquals(render("account_reactivated", "worker", ctx)?.body, "DHA staff reactivated your account. You can use the app again.");
});

Deno.test("a verification decision pushes the reason staff wrote, so the person knows what to fix", () => {
  for (const role of ["resident", "worker"]) {
    assertEquals(
      render("verification_decided", role, { ...ctx, decision: "ask_for_changes", message: "Upload a clear photo of your CNIC." }),
      { title: "Changes needed", body: "Upload a clear photo of your CNIC." },
    );
    assertEquals(
      render("verification_decided", role, { ...ctx, decision: "ask_for_changes", message: "Utility bill must be less than 3 months old." })?.body,
      "Utility bill must be less than 3 months old.",
    );
    assertEquals(render("verification_decided", role, { ...ctx, decision: "visit_hq", message: "Bring your original CNIC." }), {
      title: "Please visit the DHA office",
      body: "Bring your original CNIC.",
    });
    assertEquals(render("verification_decided", role, { ...ctx, decision: "reject", message: "CNIC does not match." }), {
      title: "Application not approved",
      body: "CNIC does not match.",
    });
    assertEquals(render("verification_decided", role, { ...ctx, decision: "approve" }), {
      title: "Your application is approved",
      body: "DHA staff approved your application.",
    });
  }
});

Deno.test("a decision without a reason still reads well, and a long reason is cut for the push", () => {
  assertEquals(render("verification_decided", "worker", { ...ctx, decision: "ask_for_changes" })?.body, "Open the app to see what to fix.");
  assertEquals(render("verification_decided", "worker", { ...ctx, decision: "reject" })?.body, "Open the app to see why.");
  assertEquals(render("verification_decided", "worker", ctx)?.title, "Application not approved");
  const long = "Please upload a clear photo. ".repeat(40);
  const body = render("verification_decided", "resident", { ...ctx, decision: "ask_for_changes", message: long })?.body ?? "";
  assertEquals(body.length <= 160, true);
  assertEquals(body.endsWith("…"), true);
});
