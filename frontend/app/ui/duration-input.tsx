import type { InputHTMLAttributes } from 'react';

export const NEW_SESSION_MINUTES = 60;
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  value: string;
  onValue: (value: string) => void;
};
export function DurationInput({ value, onValue, disabled, ...props }: Props) {
  const number = Number(value);
  function change(delta: number) {
    if (!disabled && value !== '' && Number.isInteger(number) && number + delta > 0)
      onValue(String(number + delta));
  }
  return (
    <span className="duration-control">
      <button
        type="button"
        disabled={disabled || !value || number <= 30}
        aria-label="Уменьшить на 30 минут"
        onClick={() => change(-30)}
      >
        −30
      </button>
      <input
        {...props}
        aria-label={props['aria-label'] ?? 'Длительность, минут'}
        type="number"
        min="1"
        step="1"
        value={value}
        disabled={disabled}
        onChange={(e) => onValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            change(e.key === 'ArrowUp' ? 30 : -30);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled || !value || !Number.isInteger(number)}
        aria-label="Увеличить на 30 минут"
        onClick={() => change(30)}
      >
        +30
      </button>
    </span>
  );
}
