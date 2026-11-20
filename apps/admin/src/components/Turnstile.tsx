'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

type RenderOptions = {
  sitekey: string;
  theme: 'light';
  callback: () => void;
  'expired-callback': () => void;
  'error-callback': () => void;
};
type TurnstileApi = {
  render: (container: HTMLElement, options: RenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

/**
 * The Cloudflare Turnstile bot check for a form. It is drawn explicitly (not by Cloudflare's automatic scan, which only
 * runs once when the script first loads and so misses a form reached by clicking a link from another page). A token
 * works only once, so after every answer from the server (`resetSignal` changes) the box is reset and asks Cloudflare
 * for a new token. `onOk` is called when a token is ready and `onGone` when it is missing again (used, expired or
 * failed), so the form can keep its button off until then. Every call into Cloudflare's script is guarded: a failure
 * there leaves the button off and the "taking long" hint, never a broken page.
 */
export function Turnstile({ siteKey, nonce, resetSignal, onOk, onGone }: { siteKey: string; nonce?: string; resetSignal: unknown; onOk: () => void; onGone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const handlers = useRef({ onOk, onGone });
  useEffect(() => {
    handlers.current = { onOk, onGone };
  }, [onOk, onGone]);

  const draw = useCallback(() => {
    const api = (window as TurnstileWindow).turnstile;
    if (!api || !box.current || widgetId.current !== null) return;
    try {
      widgetId.current = api.render(box.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: () => handlers.current.onOk(),
        'expired-callback': () => handlers.current.onGone(),
        'error-callback': () => handlers.current.onGone(),
      });
    } catch {
      widgetId.current = null;
    }
  }, [siteKey]);

  // The script may already be on the page (we arrived by clicking a link): draw now. Otherwise onReady draws it.
  useEffect(() => {
    draw();
    return () => {
      const api = (window as TurnstileWindow).turnstile;
      const id = widgetId.current;
      widgetId.current = null;
      if (api && id !== null) {
        try {
          api.remove(id);
        } catch {
          // the box is already gone
        }
      }
    };
  }, [draw]);

  // A new answer from the server: that token is used up, ask for a fresh one.
  useEffect(() => {
    const api = (window as TurnstileWindow).turnstile;
    const id = widgetId.current;
    if (!api || id === null) return;
    try {
      api.reset(id);
    } catch {
      // nothing to reset
    }
  }, [resetSignal]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" nonce={nonce} onReady={draw} />
      <div ref={box} />
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
  // A submit uses the token up; the box is reset by the Turnstile component when the answer comes back.
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
