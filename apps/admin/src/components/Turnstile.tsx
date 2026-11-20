'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';

type TurnstileApi = { reset: () => void };
type TurnstileWindow = Window & { turnstile?: TurnstileApi; dhaTurnstileOk?: () => void; dhaTurnstileGone?: () => void };

/**
 * The Cloudflare Turnstile bot check for a form. A token works only once, so after every answer from the server
 * (`resetSignal` changes) the box is reset and asks Cloudflare for a new token. `onOk` is called when a token is ready
 * and `onGone` when it is missing again (used, expired or failed), so the form can keep its button off until then.
 */
export function Turnstile({ siteKey, nonce, resetSignal, onOk, onGone }: { siteKey: string; nonce?: string; resetSignal: unknown; onOk: () => void; onGone: () => void }) {
  useEffect(() => {
    const w = window as TurnstileWindow;
    w.dhaTurnstileOk = onOk;
    w.dhaTurnstileGone = onGone;
    return () => {
      delete w.dhaTurnstileOk;
      delete w.dhaTurnstileGone;
    };
  }, [onOk, onGone]);

  // A new answer from the server: that token is used up, ask for a fresh one.
  useEffect(() => {
    (window as TurnstileWindow).turnstile?.reset();
  }, [resetSignal]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" nonce={nonce} />
      <div
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-theme="light"
        data-callback="dhaTurnstileOk"
        data-expired-callback="dhaTurnstileGone"
        data-error-callback="dhaTurnstileGone"
      />
    </>
  );
}

/**
 * Keeps a form's submit button off until the bot check has a fresh token. With no site key (local development) the
 * button is always on. `slow` becomes true if no token arrives within 10 seconds (script blocked or offline).
 */
export function useTurnstileReady(siteKey: string | null) {
  const [ready, setReady] = useState(!siteKey);
  const [slow, setSlow] = useState(false);
  const onOk = useCallback(() => {
    setReady(true);
    setSlow(false);
  }, []);
  const onGone = useCallback(() => setReady(false), []);
  // A submit uses the token up; the form is reset by the Turnstile component when the answer comes back.
  const onSubmit = useCallback(() => {
    if (siteKey) setReady(false);
  }, [siteKey]);
  useEffect(() => {
    if (ready || slow) return;
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [ready, slow]);
  return { ready, slow, onOk, onGone, onSubmit };
}
