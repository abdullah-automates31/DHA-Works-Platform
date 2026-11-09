// Accepting a job: one call to accept_job (claim-and-lock, migration 0031), with every refusal turned into a friendly
// message. Injectable client so the behaviour can be unit tested. Raw server text is never shown.
import type { AcceptJobArgs, ReviseQuoteArgs } from './rules.ts';

export type ClaimErrorKey =
  | 'quote.errors.notAvailable'
  | 'quote.errors.expired'
  | 'quote.errors.rejected'
  | 'quote.errors.total'
  | 'quote.errors.network'
  | 'quote.errors.alreadyChanged'
  | 'quote.errors.decided'
  | 'quote.errors.visit'
  | 'quote.errors.generic';

type Err = { name?: string; message?: string; details?: string | null } | null | undefined;

export function claimErrorKey(error: Err): ClaimErrorKey {
  const text = `${error?.name ?? ''} ${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
  if (text.includes('did not accept your quote')) return 'quote.errors.rejected';
  if (text.includes('already changed this quote')) return 'quote.errors.alreadyChanged';
  if (text.includes('already decided on your quote')) return 'quote.errors.decided';
  if (text.includes('the visit') || text.includes('when you will come')) return 'quote.errors.visit';
  if (text.includes('has expired')) return 'quote.errors.expired';
  if (text.includes('not available') || text.includes('not approved') || text.includes('suspended')) {
    return 'quote.errors.notAvailable';
  }
  if (text.includes('enter a price') || text.includes('cannot be negative') || text.includes('quotes_total_positive')) {
    return 'quote.errors.total';
  }
  if (text.includes('network') || text.includes('fetch') || error?.name === 'TypeError') return 'quote.errors.network';
  return 'quote.errors.generic';
}

export type ClaimClient = {
  acceptJob(args: AcceptJobArgs): PromiseLike<{ error: Err }>;
};

/** ok = the job is now locked to this worker and waits for the customer to accept the price (0043). */
export type ClaimResult = { ok: true } | { ok: false; key: ClaimErrorKey };

export async function claimJob(client: ClaimClient, args: AcceptJobArgs): Promise<ClaimResult> {
  try {
    const { error } = await client.acceptJob(args);
    return error ? { ok: false, key: claimErrorKey(error) } : { ok: true };
  } catch (thrown) {
    return { ok: false, key: thrown instanceof Error && thrown.name === 'TypeError' ? 'quote.errors.network' : 'quote.errors.generic' };
  }
}

export type ReviseClient = {
  reviseQuote(args: ReviseQuoteArgs): PromiseLike<{ error: Err }>;
};

/** ok = the quote now shows the new price and window, and the customer was notified (0044). */
export async function reviseQuote(client: ReviseClient, args: ReviseQuoteArgs): Promise<ClaimResult> {
  try {
    const { error } = await client.reviseQuote(args);
    return error ? { ok: false, key: claimErrorKey(error) } : { ok: true };
  } catch (thrown) {
    return { ok: false, key: thrown instanceof Error && thrown.name === 'TypeError' ? 'quote.errors.network' : 'quote.errors.generic' };
  }
}
