// The two-column frame shared by the sign-in and code screens (design A01).
const POINTS: [string, string][] = [
  ['Verify every worker and resident', 'Check CNIC, police certificate and address before anyone goes live.'],
  ['Answer unsafe reports first', 'Call both people right away and decide on the case.'],
  ['Follow every job to cash paid', 'See quotes, schedule, progress and any cash dispute in one place.'],
];

function Tick() {
  return (
    <span className="si-tick">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  );
}

export function SignInShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="si">
      <div className="si-left">
        <div className="si-ring" />
        <div className="si-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/dha-crest.png" alt="DHA Karachi" />
          <div>
            <b>DHA Works</b>
            <span>Admin portal</span>
          </div>
        </div>
        <div className="si-hero">
          <h1>
            Keep DHA homes and workers <em>safe and verified.</em>
          </h1>
          <p>Review workers and residents, handle reports, and follow every job from request to cash paid.</p>
          <div className="si-points">
            {POINTS.map(([title, text]) => (
              <div className="si-point" key={title}>
                <Tick />
                <div>
                  <b>{title}</b>
                  <span>{text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="si-chips">
          <span className="chip">Verification</span>
          <span className="chip">Reports and disputes</span>
          <span className="chip">Helpline 1092</span>
        </div>
      </div>
      <div className="si-right">
        <div className="si-col">{children}</div>
      </div>
    </div>
  );
}
