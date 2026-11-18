'use client';

/** A filter-bar checkbox that sends its form as soon as it is ticked or unticked (no Apply button). */
export function AutoSubmitCheckbox({ name, value, defaultChecked, label }: { name: string; value: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="row g8 b" style={{ fontSize: 13 }}>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} onChange={(e) => e.currentTarget.form?.requestSubmit()} /> {label}
    </label>
  );
}
