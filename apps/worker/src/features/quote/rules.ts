// Pure rules for W10 Accept job, the price form (unit tested with node --test). The database is the authority: it
// computes the total and re-checks everything (accept_job and the quotes table constraints). These rules only guide the form
// and build the request; the preview total is display only.

const MAX_DIGITS = 7; // sanity limit on one amount (Rs 9,999,999); the database only needs a non-negative integer

export function amountDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, MAX_DIGITS);
}

/** "" -> 0 (blank counts as nothing); digits -> the whole rupee amount. */
export function parseAmount(raw: string): number {
  const digits = amountDigits(raw);
  return digits === '' ? 0 : Number(digits);
}

export const MAX_ITEMS = 10;
export const ITEM_NAME_MAX = 40;

export type MaterialItem = { name: string; price: string };

/** The toggle decides whether materials count at all; the items are kept while it is off so a tap back loses nothing. */
export type QuoteInput = {
  labour: string;
  withMaterials: boolean;
  items: MaterialItem[];
};

const itemUsed = (item: MaterialItem) => item.name.trim() !== '' || parseAmount(item.price) > 0;
const itemComplete = (item: MaterialItem) => item.name.trim() !== '' && parseAmount(item.price) > 0;

/** Rows the worker actually started (blank rows are ignored). */
export function usedItems(input: Pick<QuoteInput, 'withMaterials' | 'items'>): MaterialItem[] {
  return input.withMaterials ? input.items.filter(itemUsed) : [];
}

/** The materials cost is worked out from the item prices; it is never typed. 0 when "Without materials". */
export function materialsTotal(input: Pick<QuoteInput, 'withMaterials' | 'items'>): number {
  return usedItems(input).reduce((sum, item) => sum + parseAmount(item.price), 0);
}

export function computeTotal(input: Pick<QuoteInput, 'labour' | 'withMaterials' | 'items'>): number {
  return parseAmount(input.labour) + materialsTotal(input);
}

export type QuoteErrors = {
  total?: true; // nothing entered: the total must be above zero
  items?: true; // "With materials" needs at least one item, and every started row needs a name and a price
};

/** Mirrors the table rule (total above zero) plus the form rule for the materials list. */
export function validateQuote(input: QuoteInput): QuoteErrors {
  const errors: QuoteErrors = {};
  if (computeTotal(input) <= 0) errors.total = true;
  if (input.withMaterials) {
    const used = usedItems(input);
    if (used.length === 0 || !used.every(itemComplete)) errors.items = true;
  }
  return errors;
}

export function isQuoteValid(input: QuoteInput): boolean {
  const errors = validateQuote(input);
  return !errors.total && !errors.items;
}

// ---------------------------------------------------------------- the request
export type AcceptJobArgs = {
  p_job_id: string;
  p_labour: number;
  p_materials: number;
  p_materials_note: string | undefined;
  p_note: undefined;
  p_visit_start: string;
  p_visit_end: string;
};

/** revise_quote (0044): the same amounts and window, for the worker's one change before the customer accepts. */
export type ReviseQuoteArgs = Omit<AcceptJobArgs, 'p_job_id'> & { p_quote_id: string };

/**
 * accept_job (claim-and-lock): the worker states a price and the job is theirs. The materials amount is the sum of the item prices and the list goes in the note ("Pipe Rs 500; Tape Rs 50").
 * There is no "Other" charge. No total is ever sent (the database computes it), and no bill: the actual bill is
 * uploaded when the job is completed. The visit window is the worker's offer (0044).
 */
export function buildSubmitArgs(jobId: string, input: QuoteInput, visit: { p_visit_start: string; p_visit_end: string }): AcceptJobArgs {
  const materials = materialsTotal(input);
  const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
  const list = usedItems(input)
    .map((item) => `${collapse(item.name)} Rs ${parseAmount(item.price)}`)
    .join('; ');
  return {
    p_job_id: jobId,
    p_labour: parseAmount(input.labour),
    p_materials: materials,
    p_materials_note: materials > 0 && list !== '' ? list : undefined,
    p_note: undefined,
    ...visit,
  };
}

export function buildReviseArgs(quoteId: string, input: QuoteInput, visit: { p_visit_start: string; p_visit_end: string }): ReviseQuoteArgs {
  const { p_job_id: _unused, ...rest } = buildSubmitArgs('', input, visit);
  return { p_quote_id: quoteId, ...rest };
}

/**
 * The form's input back from a sent quote, to change it: the materials note ("Pipe Rs 500; Tape Rs 50") becomes the
 * item list again. A note that does not parse becomes one "Materials" item with the stored amount.
 */
export function inputFromQuote(quote: { labour: number; materials: number; materialsNote: string | null }): QuoteInput {
  const labour = quote.labour > 0 ? String(quote.labour) : '';
  if (quote.materials <= 0) return { labour, withMaterials: false, items: [{ name: '', price: '' }] };
  const parsed = (quote.materialsNote ?? '')
    .split(';')
    .map((part) => /^\s*(.+?)\s+Rs\s+(\d+)\s*$/.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: (m[1] ?? '').slice(0, ITEM_NAME_MAX), price: m[2] ?? '0' }));
  const sum = parsed.reduce((n, item) => n + Number(item.price), 0);
  const items = parsed.length > 0 && sum === quote.materials ? parsed.slice(0, MAX_ITEMS) : [{ name: 'Materials', price: String(quote.materials) }];
  return { labour, withMaterials: true, items };
}
