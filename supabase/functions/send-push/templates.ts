// Push text per notification type and recipient role. Edit wording here only.
//
// A type/role pair that is missing here is not pushed (it stays in the in-app notification list),
// e.g. admin alerts, new_sign_in, staff_message.

export type Role = "resident" | "worker";

export interface PushContext {
  /** Job title, already trimmed; a neutral fallback when the row has none. */
  job: string;
  /** Full name of the worker the event is about; a neutral fallback when unknown. */
  worker: string;
  /** Quote total in whole rupees, when the event is a quote. */
  total: number | null;
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
