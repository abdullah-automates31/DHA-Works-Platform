// Small presentational pieces shared by the screens. Class names come from the design stylesheet (admin.css).
import type { ReactNode } from 'react';
import { AvatarPhoto } from './AvatarPhoto';

export type ChipTone = 'ok' | 'wait' | 'red' | 'blue' | 'pur' | 'gray';

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`chip c-${tone}`}>{children}</span>;
}

const AVATAR_TONES = ['', 'b', 'g'] as const;

/** Round initials badge. The colour is picked from the id so a person always keeps the same one. */
/** Round initials; with `src` the person's picture fades in over them (see AvatarPhoto). Same size either way. */
export function Avatar({ initials, seed, large, src, alt }: { initials: string; seed: string; large?: boolean; src?: string | null; alt?: string }) {
  const tone = AVATAR_TONES[[...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <div className={`av ${tone ?? ''}${large ? ' l' : ''}`.trim()}>
      {initials}
      {src ? <AvatarPhoto key={src} src={src} alt={alt ?? ''} /> : null}
    </div>
  );
}

export function Icon({ children, size }: { children: ReactNode; size?: number }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {children}
    </svg>
  );
}

export const ICONS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  workers: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  residents: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  jobs: <path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" />,
  reports: <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />,
  helpline: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  reviews: <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 5a4 4 0 0 1 0 7M19 15c2 1 3 3 3 6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16v.5" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
} as const;
