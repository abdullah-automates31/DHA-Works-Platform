// Push text per notification type and recipient role. Edit wording here only.
//
// A type/role pair that is missing here is not pushed (it stays in the in-app notification list),
// e.g. admin alerts and new_sign_in.

export type Role = "resident" | "worker";

export interface PushContext {
  /** Job title, already trimmed; a neutral fallback when the row has none. */
  job: string;
  /** Full name of the worker the event is about; a neutral fallback when unknown. */
  worker: string;
  /** Quote total in whole rupees, when the event is a quote. */
  total: number | null;
  /** The text DHA staff wrote (a warning, a message or a suspension reason), when the notice has one. */
  message?: string | null;
  /** For a resolved report: "action_taken" or "no_action". Nothing more is ever put in the notice. */
  outcome?: string | null;
  /** The end date of a suspension (ISO text), when it has one. */
  until?: string | null;
  /** For a verification decision: approve, ask_for_changes, visit_hq or reject. */
  decision?: string | null;
}

export interface PushText {
  title: string;
  body: string;
}

type Template = (c: PushContext) => PushText;

const rupees = (n: number) => `${n.toLocaleString("en-US")} Rs`;

const resident: Record<string, Template> = {
  job_accepted: (c) => ({
    title: `Your job is accepted by ${c.worker}`,
    body: "Tap to see details",
  }),
  quote_received: (c) => ({
    title: `${c.worker} quoted`,
    body: c.total != null
      ? `${c.worker} quoted ${rupees(c.total)}`
      : `${c.worker} sent a quote for ${c.job}`,
  }),
  quote_revised: (c) => ({
    title: `${c.worker} updated the quote`,
    body: c.total != null
      ? `New price ${rupees(c.total)}. Check the price and visit time for ${c.job}.`
      : `Check the new price and visit time for ${c.job}.`,
  }),
  new_interest: (c) => ({ title: "A worker is interested", body: c.job }),
  job_started: (c) => ({
    title: `Work started by ${c.worker}`,
    body: `${c.job} is started by ${c.worker}`,
  }),
  job_completed: (c) => ({
    title: `Work completed by ${c.worker}`,
    body: `${c.job} is completed by ${c.worker}.`,
  }),
  cash_awaiting_you: (c) => ({
    title: "Confirm the cash you paid",
    body: `Record how much you paid ${c.worker} for ${c.job}.`,
  }),
  rate_worker: (c) => ({
    title: `Rate your experience for ${c.job} by ${c.worker}`,
    body: "Tap to leave a review",
  }),
  job_cancelled: (c) => ({
    title: "Job cancelled",
    body: `${c.job} was cancelled.`,
  }),
  cancellation_requested: (c) => ({
    title: "Cancellation requested",
    body: `${c.worker} asked to cancel ${c.job}.`,
  }),
  cancellation_declined: (c) => ({
    title: "Cancellation declined",
    body: `Your request to cancel ${c.job} was declined.`,
  }),
  job_expiring: (c) => ({
    title: "Your job expires soon",
    body: `No worker has taken ${c.job} yet.`,
  }),
  job_expired: (c) => ({
    title: "Job expired",
    body: `${c.job} expired before a worker took it.`,
  }),
  job_stuck: (c) => ({
    title: "Job needs attention",
    body: `${c.job} needs an update.`,
  }),
  worker_replaced_by_staff: (c) => ({
    title: "Your worker was replaced",
    body: `${c.job} is open to workers again.`,
  }),
};

const worker: Record<string, Template> = {
  new_job: (c) => ({ title: "New Job Available", body: c.job }),
  quote_accepted: (c) => ({
    title: "Your quote was accepted",
    body: `${c.job} is scheduled. Tap to see the visit time.`,
  }),
  quote_rejected: (c) => ({
    title: "Quote not accepted",
    body: `The customer did not go ahead with your quote for ${c.job}.`,
  }),
  quote_not_selected: (c) => ({
    title: "Job went to another worker",
    body: `${c.job} was given to another worker.`,
  }),
  cash_awaiting_you: (c) => ({
    title: `Your job ${c.job} is completed`,
    body: `${c.job} is completed by you. Collect cash and acknowledge.`,
  }),
  cash_collected: (c) => ({
    title: "Cash recorded",
    body: `${c.job} is closed. Thank you!`,
  }),
  job_cancelled: (c) => ({
    title: "Job cancelled",
    body: `${c.job} was cancelled.`,
  }),
  cancellation_requested: (c) => ({
    title: "Cancellation requested",
    body: `The customer asked to cancel ${c.job}.`,
  }),
  cancellation_declined: (c) => ({
    title: "Cancellation declined",
    body: `Your request to cancel ${c.job} was declined.`,
  }),
  job_expired: (c) => ({ title: "Job expired", body: `${c.job} expired.` }),
  job_stuck: (c) => ({
    title: "Job needs attention",
    body: `${c.job} needs an update.`,
  }),
};

// Notices from DHA staff, the same wording for residents and workers (report tracking and suspensions, 0053).
// A report notice never says what was done to the other person.
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

// A push shows about two lines; the full text stays in the app.
const short = (text: string, max = 160) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const staff: Record<string, Template> = {
  // The decision on a worker or resident application. The reason is what staff wrote for the applicant to read.
  verification_decided: (c) => {
    const why = (fallback: string) => c.message ? short(c.message) : fallback;
    switch (c.decision) {
      case "approve":
        return { title: "Your application is approved", body: "DHA staff approved your application." };
      case "ask_for_changes":
        return { title: "Changes needed", body: why("Open the app to see what to fix.") };
      case "visit_hq":
        return { title: "Please visit the DHA office", body: why("Open the app for details.") };
      default:
        return { title: "Application not approved", body: why("Open the app to see why.") };
    }
  },
  report_received: () => ({
    title: "We received your report",
    body: "DHA staff will look at it. You can follow it in My reports.",
  }),
  report_in_review: () => ({
    title: "Your report is being reviewed",
    body: "DHA staff are looking at your report now.",
  }),
  report_resolved: (c) => ({
    title: "Your report is resolved",
    body: c.outcome === "action_taken"
      ? "DHA reviewed your report and took action."
      : "DHA reviewed your report. No action was needed.",
  }),
  report_warning: (c) => ({
    title: "Warning from DHA staff",
    body: c.message || "Open the app to read the message.",
  }),
  staff_message: (c) => ({
    title: "Message from DHA staff",
    body: c.message || "Open the app to read the message.",
  }),
  account_suspended: (c) => ({
    title: "Your account is suspended",
    body: [
      c.message ? `Reason: ${c.message}.` : "Contact DHA staff.",
      c.until ? `It ends on ${day(c.until)}.` : "DHA staff will tell you when it ends.",
    ].join(" "),
  }),
  account_reactivated: (c) => ({
    title: "Your account is active again",
    body: c.outcome === "expired"
      ? "Your suspension has ended. You can use the app again."
      : "DHA staff reactivated your account. You can use the app again.",
  }),
};
Object.assign(resident, staff);
Object.assign(worker, staff);

const byRole: Record<Role, Record<string, Template>> = { resident, worker };

/** The push for this row, or null when this type is not pushed to this role. */
export function render(
  type: string,
  role: string,
  context: PushContext,
): PushText | null {
  const table = byRole[role as Role];
  const template = table?.[type];
  return template ? template(context) : null;
}

/** Only residents (customer app) and workers (worker app) get pushes; admins use the web portal. */
export const isRole = (role: string): role is Role =>
  role === "resident" || role === "worker";
