import { useId } from 'react';

interface SwitchControlProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  footer?: React.ReactNode;
}

export function SwitchControl({
  title,
  description,
  checked,
  onChange,
  footer,
}: SwitchControlProps) {
  const id = useId();
  const switchAttrs = { switch: '' } as Record<string, string>;

  return (
    <div className="pref-switch-row">
      <div style={{ flex: 1, minInlineSize: 0 }}>
        <label htmlFor={id} className="pref-switch-label">
          <span style={{ flex: 1, minInlineSize: 0 }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
              {title}
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 13.5,
                color: 'var(--slate)',
                marginTop: 4,
              }}
            >
              {description}
            </span>
          </span>
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            {...switchAttrs}
          />
        </label>
        {footer}
      </div>
    </div>
  );
}
