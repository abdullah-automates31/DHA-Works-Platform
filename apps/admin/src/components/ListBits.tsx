// Server-rendered pieces shared by the list screens: tabs, filter pills, search box and the previous/next bar.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, ICONS } from './ui';

export function TabBar({ tabs, active }: { tabs: { key: string; label: string; count?: number; href: string }[]; active: string }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <Link key={t.key} className={`tab${t.key === active ? ' on' : ''}`} href={t.href}>
          {t.label}
          {t.count !== undefined ? <em>{t.count}</em> : null}
        </Link>
      ))}
    </div>
  );
}

export function PillRow({ pills, active, right }: { pills: { key: string; label: string; href: string }[]; active: string; right?: ReactNode }) {
  return (
    <div className="row wrap g8">
      {pills.map((p) => (
        <Link key={p.key} className={`pill${p.key === active ? ' on' : ''}`} href={p.href}>{p.label}</Link>
      ))}
      {right ? <><span className="fx" />{right}</> : null}
    </div>
  );
}

/** The search box of the header. Other parameters are kept as hidden fields so searching does not lose the tab or filter. */
export function SearchBox({ action, q, placeholder, keep }: { action: string; q: string; placeholder: string; keep?: Record<string, string | null | undefined> }) {
  return (
    <form className="srch" action={action} method="get" role="search">
      <Icon>{ICONS.search}</Icon>
      {/* key: a new search (or "Clear all") remounts the box so it never keeps old text. */}
      <input key={q} name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} maxLength={80} />
      {Object.entries(keep ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
    </form>
  );
}

export function PagerBar({ shown, total, page, last, hrefFor, noun }: { shown: number; total: number; page: number; last: number; hrefFor: (page: number) => string; noun: string }) {
  return (
    <div className="row sb">
      <span className="mut b" style={{ fontSize: 13 }}>Showing {shown} of {total} {noun}</span>
      <div className="row g8">
        {page > 1 ? <Link className="btn out sm" href={hrefFor(page - 1)}>Previous</Link> : null}
        {page < last ? <Link className="btn out sm" href={hrefFor(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}

/**
 * The "Clear all" bar at the bottom of a list screen: names the search and filters that are on and links back to
 * the plain list (the tab stays). Shown only when something is on. It changes the view only; it never deletes data.
 */
export function ClearAllBar({ active, href }: { active: string[]; href: string }) {
  if (active.length === 0) return null;
  return (
    <div className="card row sb wrap g8" style={{ padding: '12px 16px' }} role="region" aria-label="Search and filters">
      <span className="mut b" style={{ fontSize: 13 }}>
        Filtered by: <span className="xb">{active.join(' · ')}</span>
      </span>
      <Link className="btn out sm" href={href} aria-label="Clear all search and filters">Clear all</Link>
    </div>
  );
}

export function LoadError() {
  return <div className="note red" role="alert">The list could not be loaded. Reload the page. If it keeps happening, sign out and in again.</div>;
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="mut" style={{ textAlign: 'center', padding: 32 }}>{text}</td>
    </tr>
  );
}

/** Photos of a case or a job: signed links opened full size in a new tab. */
export function PhotoGrid({ paths, urls, label }: { paths: string[]; urls: Record<string, string>; label: string }) {
  if (paths.length === 0) return null;
  return (
    <div className="row wrap g8">
      {paths.map((p, i) => {
        const url = urls[p];
        return url ? (
          <a key={p} href={url} target="_blank" rel="noopener noreferrer" className="doc" style={{ width: 110, height: 110, overflow: 'hidden' }} aria-label={`Open ${label} ${i + 1} full size`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${label} ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </a>
        ) : (
          <div key={p} className="doc" style={{ width: 110, height: 110 }}>{label} {i + 1}</div>
        );
      })}
    </div>
  );
}
