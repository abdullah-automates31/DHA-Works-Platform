import Link from 'next/link';

// A link that leads nowhere (an old or mistyped address, or a record that no longer exists).
export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#F7F8F4' }}>
      <div className="card col g8" style={{ maxWidth: 440, width: '100%', padding: 28, textAlign: 'center' }}>
        <h1 className="h2" style={{ margin: 0 }}>Page not found</h1>
        <p style={{ margin: '8px 0 16px', color: 'var(--mut)' }}>
          This page does not exist, or the record was removed. Check the address, or go back to the dashboard.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link className="btn" href="/dashboard">Go to the dashboard</Link>
        </div>
      </div>
    </main>
  );
}
