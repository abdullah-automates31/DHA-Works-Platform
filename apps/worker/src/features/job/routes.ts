import type { Href } from 'expo-router';

// Links to the job screens. Built as plain paths so they do not depend on the generated route-type file, which lags
// behind new screens until the dev server regenerates it. Only an id-looking value becomes a link.
const SAFE_ID = /^[0-9a-fA-F-]{8,64}$/;

function safe(id: string, path: (id: string) => string): Href {
  return (SAFE_ID.test(id) ? path(id) : '/open-jobs') as Href;
}

/** W08 Job detail (a job the worker has not won). */
export const jobHref = (id: string): Href => safe(id, (i) => `/job/${i}`);
/** W08b Job details, opened from W12 (same screen as W08 with the worker's own status and a back-to-status bar). */
export const jobDetailsHref = (id: string): Href => safe(id, (i) => `/job/${i}?from=status`);
/** W10 Create quote. */
export const quoteHref = (id: string): Href => safe(id, (i) => `/job/${i}/quote`);
/** W10 in change mode: the worker changes their sent quote once, before the customer accepts (0044). */
export const changeQuoteHref = (id: string): Href => safe(id, (i) => `/job/${i}/quote?change=1`);
/** W12 Job status (the worker's own job). */
export const statusHref = (id: string): Href => safe(id, (i) => `/job/${i}/status`);
/** W13 Record cash. */
export const cashHref = (id: string): Href => safe(id, (i) => `/job/${i}/cash`);
/** W18 Request cancellation. */
export const cancelHref = (id: string): Href => safe(id, (i) => `/job/${i}/cancel`);
/** W14 Report a problem; kind "unsafe" opens it on "I felt unsafe". */
export const reportHref = (id: string, kind?: 'unsafe'): Href => safe(id, (i) => `/job/${i}/report${kind ? `?kind=${kind}` : ''}`);
