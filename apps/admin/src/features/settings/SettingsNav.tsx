'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Icon, ICONS } from '@/components/ui';
import { matchSections, type SectionKey } from './rules';

export type NavItem = { key: SectionKey; label: string; icon: ReactNode };

/**
 * The list of settings sections on the left (a wrapped row of buttons on a phone). The search box narrows the list to
 * the sections that hold the words typed, so any setting can be found without opening every section.
 */
export function SettingsNav({ groups, danger, active }: { groups: { title: string; items: NavItem[] }[]; danger: NavItem; active: SectionKey }) {
  const [q, setQ] = useState('');
  const hits = q.trim() ? matchSections(q) : null;
  const shown = (i: NavItem) => !hits || hits.has(i.key);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter(shown) })).filter((g) => g.items.length > 0);
  const showDanger = shown(danger);
  const link = (i: NavItem, extra = '') => (
    <Link key={i.key} href={`/settings?tab=${i.key}`} className={`sitem${i.key === active ? ' on' : ''}${extra}`} aria-current={i.key === active ? 'page' : undefined}>
      <Icon>{i.icon}</Icon>
      {i.label}
    </Link>
  );

  return (
    <nav className="snav" aria-label="Settings sections">
      <div className="ssrch">
        <Icon>{ICONS.search}</Icon>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings" maxLength={60} />
      </div>
      {visible.map((g) => (
        <div key={g.title} className="sg">
          <div className="gt">{g.title}</div>
          {g.items.map((i) => link(i))}
        </div>
      ))}
      {showDanger ? <div className="sg">{link(danger, ' danger')}</div> : null}
      {hits && visible.length === 0 && !showDanger ? <div className="none" role="status">No setting matches &ldquo;{q.trim()}&rdquo;.</div> : null}
    </nav>
  );
}
