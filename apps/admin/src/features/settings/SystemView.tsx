import type { ReactNode } from 'react';
import { LoadError } from '@/components/ListBits';
import { Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { ago } from '@/lib/format';
import { parseSystemStatus } from './parse';
import { formatBytes } from './rules';

type Tone = 'ok' | 'wait' | 'red' | 'gray';
type Row = { label: string; tone: Tone; state: string; detail?: ReactNode };

/** A reachability check: any HTTP answer below 500 means the service is up. Nothing from the answer is shown. */
async function reach(url: string, init: RequestInit): Promise<{ ok: boolean; ms: number; code: number | null }> {
  const t = Date.now();
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return { ok: res.status < 500, ms: Date.now() - t, code: res.status };
  } catch {
    return { ok: false, ms: Date.now() - t, code: null };
  }
}

/** Runs a call and says how long it took. */
async function timed<T>(work: PromiseLike<T>): Promise<{ value: T; ms: number }> {
  const t = Date.now();
  const value = await work;
  return { value, ms: Date.now() - t };
}

/** System status: live checks of the services the platform depends on. Read-only, and no key or secret is ever shown. */
export async function SystemView() {
  const { supabase } = await requireSession();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const [rpcCall, auth, mail, push] = await Promise.all([
    timed(supabase.rpc('admin_system_status')),
    reach(`${url}/auth/v1/health`, { headers: { apikey: anon } }),
    reach(`${url}/functions/v1/admin-2fa`, { method: 'OPTIONS' }),
    reach(`${url}/functions/v1/send-push`, { method: 'OPTIONS' }),
  ]);
  const rpc = rpcCall.value;
  const dbMs = rpcCall.ms;
  const s = parseSystemStatus(rpc.error ? null : rpc.data);
  const turnstile = !!process.env.TURNSTILE_SECRET_KEY && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const services: Row[] = [
    { label: 'Database', tone: s ? 'ok' : 'red', state: s ? 'Connected' : 'Not reachable', detail: s ? `Answered in about ${dbMs} ms` : undefined },
    { label: 'Sign-in service (Supabase Auth)', tone: auth.ok ? 'ok' : 'red', state: auth.ok ? 'Running' : 'Not responding', detail: auth.ok ? undefined : 'Admins may not be able to sign in.' },
    { label: 'Emailed sign-in codes (Edge Function)', tone: mail.ok ? 'ok' : 'red', state: mail.ok ? 'Responding' : 'Not responding', detail: 'Checks that the function answers. It does not send an email.' },
    { label: 'Push notifications (Edge Function)', tone: push.ok ? 'ok' : 'red', state: push.ok ? 'Responding' : 'Not responding', detail: 'Checks that the function answers. It does not send a notification.' },
    { label: 'Cloudflare Turnstile (bot check at sign-in)', tone: turnstile ? 'ok' : 'wait', state: turnstile ? 'Configured' : 'Not configured', detail: turnstile ? 'The keys are set on the server (never shown here).' : 'Without it a production portal refuses every sign-in.' },
  ];
  if (s) {
    const w = s.push.waiting24h;
    services.push({
      label: 'Push queue',
      tone: w === 0 ? 'ok' : w < 50 ? 'wait' : 'red',
      state: w === 0 ? 'Nothing waiting' : `${w} waiting`,
      detail: `Notices from the last 24 hours not yet sent. ${s.push.lastSentAt ? `Last one was sent ${ago(s.push.lastSentAt)}.` : 'No push has been sent yet.'}`,
    });
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="card col" style={{ gap: 0 }}>
        <h2 className="h2" style={{ paddingBottom: 12 }}>Services</h2>
        {services.map((r) => (
          <div key={r.label} className="srow">
            <div className="fx"><div className="xb">{r.label}</div>{r.detail ? <div className="mut" style={{ fontSize: 12.5 }}>{r.detail}</div> : null}</div>
            <div className="st"><Chip tone={r.tone}>{r.state}</Chip></div>
          </div>
        ))}
      </div>

      {!s ? <LoadError /> : null}
      {s ? (
        <>
          <div className="card col" style={{ gap: 0 }}>
            <h2 className="h2" style={{ paddingBottom: 12 }}>Storage</h2>
            <div className="srow"><div className="fx xb">Database size</div><div className="st b">{formatBytes(s.databaseBytes)}</div></div>
            {s.storage.length === 0 ? <div className="srow"><div className="fx mut">No files stored yet.</div></div> : null}
            {s.storage.map((b) => (
              <div key={b.bucket} className="srow">
                <div className="fx"><div className="xb">{b.bucket}</div><div className="mut" style={{ fontSize: 12.5 }}>{b.objects} {b.objects === 1 ? 'file' : 'files'}</div></div>
                <div className="st b">{formatBytes(b.bytes)}</div>
              </div>
            ))}
            <div className="mut" style={{ fontSize: 12.5, paddingTop: 12, borderTop: '1px solid var(--line)' }}>Compare these with your plan limits in the Supabase dashboard.</div>
          </div>

          <div className="card col" style={{ gap: 0 }}>
            <h2 className="h2" style={{ paddingBottom: 12 }}>Scheduled jobs</h2>
            {s.cron === null ? <div className="mut">The scheduler cannot be read from here.</div> : null}
            {s.cron?.length === 0 ? <div className="mut">No scheduled jobs found.</div> : null}
            {s.cron?.map((c) => (
              <div key={c.name} className="srow">
                <div className="fx"><div className="xb">{c.name}</div><div className="mut" style={{ fontSize: 12.5 }}>{c.lastRunAt ? `Last ran ${ago(c.lastRunAt)}` : 'Has not run yet'}</div></div>
                <div className="st"><Chip tone={c.status === 'succeeded' ? 'ok' : c.status ? 'red' : 'gray'}>{c.status ? (c.status === 'succeeded' ? 'Succeeded' : c.status) : 'No run yet'}</Chip></div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="card col" style={{ gap: 8 }}>
        <h2 className="h2">Fixed settings and what is not visible here</h2>
        <div className="mut" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          Time zone: Asia/Karachi (all dates, and &ldquo;today&rdquo; on the dashboard). App language: English.<br />
          Not visible from the portal: Twilio and WhatsApp configuration (check the Twilio and Supabase Auth settings) and database backups (check the Supabase dashboard). They are not shown here because the portal cannot read them.
        </div>
      </div>
    </div>
  );
}
