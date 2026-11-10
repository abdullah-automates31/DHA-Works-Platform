'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type SelectOption = { value: string; label: string };

type Props = {
  name: string;
  options: SelectOption[];
  /** Shown when nothing is chosen, and as the first entry when `allLabel` is not set. */
  placeholder: string;
  defaultValue?: string;
  ariaLabel?: string;
  /** Pill-shaped 36px version for the filter bars. The default is the 44px form field. */
  compact?: boolean;
  width?: number;
  required?: boolean;
  /** Adds a first entry with the empty value (for example "All phases"). */
  allLabel?: string;
};

/**
 * Our own dropdown, because the browser's list cannot be styled (square corners, blue highlight).
 * It still submits like a normal field: a hidden input carries the value, so GET filters and server
 * actions work as before. Keyboard: Arrow keys, Home/End, Enter or Space to choose, Escape to close,
 * and typing a letter jumps to the matching entry.
 */
export function Select({ name, options, placeholder, defaultValue = '', ariaLabel, compact, width, required, allLabel }: Props) {
  const all: SelectOption[] = allLabel !== undefined ? [{ value: '', label: allLabel }, ...options] : options;
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const selected = all.find((o) => o.value === value);
  const label = selected?.label ?? placeholder;

  const openMenu = () => {
    setActive(Math.max(0, all.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (v: string) => {
    setValue(v);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>('button.sel-btn')?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openMenu(); return; }
      setActive((i) => Math.min(all.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Home' || e.key === 'End') {
      if (open) { e.preventDefault(); setActive(e.key === 'Home' ? 0 : all.length - 1); }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) openMenu(); else choose(all[active]?.value ?? '');
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const from = open ? active + 1 : 0;
      const hit = [...all.slice(from), ...all.slice(0, from)].find((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit) { if (!open) openMenu(); setActive(all.indexOf(hit)); }
    }
  };

  return (
    <div ref={root} className={`sel${compact ? ' compact' : ''}${open ? ' open' : ''}`} style={width ? { width } : undefined}>
      <input type="hidden" name={name} value={value} />
      {required ? <input className="sel-req" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} /> : null}
      <button
        type="button"
        className={`sel-btn${selected && selected.value !== '' ? '' : ' empty'}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
      >
        <span className="sel-txt">{label}</span>
        <svg className="sel-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open ? (
        <ul ref={list} id={`${id}-list`} className="sel-list" role="listbox" aria-label={ariaLabel}>
          {all.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`sel-opt${i === active ? ' act' : ''}${o.value === value ? ' on' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o.value)}
            >
              <span>{o.label}</span>
              {o.value === value ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
