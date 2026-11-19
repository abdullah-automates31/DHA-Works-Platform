'use client';

import { useState } from 'react';

/**
 * The picture layer of an Avatar. The initials stay underneath at the same size, so nothing jumps while the picture loads;
 * the picture fades in over them once it is ready, and is dropped if it cannot load (the initials simply stay).
 */
export function AvatarPhoto({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  if (state === 'failed') return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={state === 'ready' ? 'on' : undefined}
      onLoad={() => setState('ready')}
      onError={() => setState('failed')}
      ref={(el) => {
        // A picture already in the browser cache has finished loading before React attached onLoad.
        if (el && el.complete && el.naturalWidth > 0) setState('ready');
      }}
    />
  );
}
