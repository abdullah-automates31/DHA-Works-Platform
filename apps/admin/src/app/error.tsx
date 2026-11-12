'use client';

import Link from 'next/link';

// Shown when a page fails while it is being built or loaded. It never prints the error itself (it could hold
// internal details); the short reference below is what staff can quote when they ask for help.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#F7F8F4' }}>
      <div className="card col g8" role="alert" style={{ maxWidth: 440, width: '100%', padding: 28, textAlign: 'center' }}>
        <h1 className="h2" style={{ margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: '8px 0 16px', color: 'var(--mut)' }}>
          This page could not be shown. Your work is safe. Try again, or go back to the dashboard.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => reset()}>Try again</button>
          <Link className="btn out" href="/dashboard">Go to the dashboard</Link>
        </div>
        {error.digest ? <p style={{ margin: '16px 0 0', fontSize: 12, color: 'var(--mut)' }}>Reference: {error.digest}</p> : null}
      </div>
    </main>
  );
}
