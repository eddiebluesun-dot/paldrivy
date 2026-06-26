import { createElement } from 'react';
import { Colors, Radius } from '../theme';

export interface SelectItem<T extends string = string> {
  label: string;
  value: T;
}

interface Props<T extends string> {
  value: T;
  items: SelectItem<T>[];
  onValueChange: (value: T) => void;
}

export function Select<T extends string>({ value, items, onValueChange }: Props<T>) {
  return createElement(
    'select',
    {
      value,
      onChange: (e: Event) => onValueChange((e.target as HTMLSelectElement).value as T),
      style: {
        width: '100%',
        padding: '10px 14px',
        fontSize: 16,
        color: Colors.textPrimary,
        backgroundColor: Colors.surface,
        border: `1px solid ${Colors.border}`,
        borderRadius: Radius.input,
        outline: 'none',
        cursor: 'pointer',
        minHeight: 48,
        appearance: 'none',
        WebkitAppearance: 'none',
      },
    },
    ...items.map((item) =>
      createElement('option', { key: item.value, value: item.value }, item.label)
    )
  );
}
