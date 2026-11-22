// The DHA fee on a job, for the price form and the job screens (pure, unit tested with node --test).
//
// The fee comes OUT of the worker's quote: the customer pays the quote and nothing more, the worker collects it in cash and then
// owes DHA the fee (My Dues). The base is the LABOUR price only; materials are the worker's cost and are never charged. The
// database is the authority (private.dha_fee, migration 0071, stored on the quote as quotes.dha_fee); this is the same
// arithmetic so the form can show the worker what they will get before they send. Both round half up on whole rupees.

export type FeeRule = { percent: number; min: number };

/** The rule before it is loaded, or while staff have not switched the fee on (they ship it off). */
export const NO_FEE: FeeRule = { percent: 0, min: 0 };

/** least(labour, greatest(min, round(labour * percent / 100))); 0 when there is no labour price. */
export function dhaFee(labour: number, rule: FeeRule): number {
  if (!Number.isFinite(labour) || labour <= 0) return 0;
  const tenths = Math.round(rule.percent * 10); // the percent has one decimal at most: whole numbers keep the sum exact
  const byPercent = Math.floor((labour * tenths + 500) / 1000);
  return Math.min(labour, Math.max(Math.round(rule.min), byPercent));
}

export type Payout = {
  total: number; // the quote: what the customer pays
  fee: number; // what the worker pays DHA
  youGet: number; // what the worker keeps
  byMinimum: boolean; // the fee is the minimum, not the percentage
};

export function payout(labour: number, materials: number, rule: FeeRule): Payout {
  const total = Math.max(0, labour) + Math.max(0, materials);
  const fee = dhaFee(labour, rule);
  const byPercent = Math.floor((Math.max(0, labour) * Math.round(rule.percent * 10) + 500) / 1000);
  return { total, fee, youGet: total - fee, byMinimum: fee > 0 && fee > byPercent };
}

const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** The two app_settings rows (dha_fee_percent, dha_fee_min); anything missing or odd counts as "no fee". */
export function parseFeeRule(rows: readonly { key: string; value: unknown }[] | null | undefined): FeeRule {
  const find = (key: string) => rows?.find((row) => row.key === key)?.value;
  return { percent: toNumber(find('dha_fee_percent')), min: toNumber(find('dha_fee_min')) };
}

/** "20" or "12.5" (no trailing zeros) for a sentence. */
export function percentText(percent: number): string {
  return String(Math.round(percent * 10) / 10);
}
