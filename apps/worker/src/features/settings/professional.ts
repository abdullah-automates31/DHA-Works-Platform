// Saves Settings > Professional details with the functions the database already has: update_worker_details
// (experience, about) and set_my_categories (skills). Only the parts that changed are sent. Injectable client for tests.
import { professionalChanges, type ProfessionalDraft, type ProfessionalSaved } from './rules.ts';
import { parseYears } from '../work/rules.ts';

export type ProfessionalErrorKey = 'settings.errors.years' | 'settings.errors.trade' | 'settings.errors.network' | 'settings.errors.generic';
export type ProfessionalResult = { ok: true; sent: number } | { ok: false; key: ProfessionalErrorKey };

type RpcResult = PromiseLike<{ error: { message?: string } | null }>;
export type ProfessionalClient = { rpc(fn: 'update_worker_details' | 'set_my_categories', args: Record<string, unknown>): RpcResult };

export async function saveProfessional(client: ProfessionalClient, saved: ProfessionalSaved, draft: ProfessionalDraft): Promise<ProfessionalResult> {
  const c = professionalChanges(saved, draft);
  if (c.yearsInvalid) return { ok: false, key: 'settings.errors.years' };
  if (c.noTrade) return { ok: false, key: 'settings.errors.trade' };
  let sent = 0;
  try {
    if (c.years || c.about) {
      const years = parseYears(draft.years);
      const args: Record<string, unknown> = {};
      if (c.years && years.ok && years.value !== null) args.p_experience_years = years.value;
      if (c.about) args.p_about = draft.about.trim();
      const { error } = await client.rpc('update_worker_details', args);
      if (error) return { ok: false, key: 'settings.errors.generic' };
      sent++;
    }
    if (c.trades) {
      const { error } = await client.rpc('set_my_categories', { p_category_ids: [...draft.trades] });
      if (error) return { ok: false, key: 'settings.errors.generic' };
      sent++;
    }
    return { ok: true, sent };
  } catch {
    return { ok: false, key: 'settings.errors.network' };
  }
}
