# Calendar-Based Date Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 9 free-text date `TextInput` fields in the app with tap-to-open `DateField`/`TimeField` components (native OS picker on Android, `<input type="date">`/`<input type="time">` on web), eliminating the malformed-date bug class entirely, per `docs/superpowers/specs/2026-08-15-date-picker-fields-design.md`.

**Architecture:** Two new shared components (`src/components/DateField.tsx`, `src/components/TimeField.tsx`) built on `@react-native-community/datetimepicker`, each branching on `Platform.OS` inside a single file (per the approved spec — not a `.web.tsx` split). A small pure-function module (`src/utils/dateFieldFormat.ts`) handles `YYYY-MM-DD`/`HH:mm` ⇄ `Date` conversion for both components. `shifts.tsx`'s two date+time fields additionally need a pure combine/split helper (`src/utils/shiftDateTimeUtils.ts`), replacing the removed `displayToIso`/`isoToDisplay`. All 9 call sites are swapped from `TextInput` to the new components; `parseFlexibleDateInput` and its test, the two inline regex checks in `expenses.tsx`, `fuel.tsx`'s inline date regex/fallback, and `shifts.tsx`'s `displayToIso`/`isoToDisplay` are deleted once nothing references them.

**Tech Stack:** React Native / Expo SDK ~56, TypeScript (strict), `@react-native-community/datetimepicker` (new dependency, installed via `npx expo install`), Jest + `jest-expo` + `@testing-library/react-native` (existing).

## Global Constraints

- No manual typing anywhere — `DateField`/`TimeField` are tap/click-only, per spec decision #3. Never add a fallback `TextInput` path.
- Install the new dependency with `npx expo install @react-native-community/datetimepicker` (not `npm install`) so Expo resolves the SDK-56-compatible version.
- `DateField`/`TimeField` are each a **single file** with a `Platform.OS` branch inside (per spec's component design section) — do not split into `.web.tsx` variants, even though `Select.tsx`/`Select.web.tsx` in this codebase use that split for an unrelated component.
- The web branch must use `React.createElement('input', {...})`, **not** JSX `<input>` — this codebase's existing `Select.web.tsx` established this convention specifically because the React Native JSX namespace has no intrinsic `'input'`/`'select'` element type, so a literal `<input>` JSX tag fails `tsc --noEmit` even though Jest (which doesn't type-check) would not catch it.
- Every new user-facing string needs an i18n key added to **all 5 full locale files** (`pt.json`, `en.json`, `es.json`, `fr.json`, `zh.json`) — `en-GB.json` is a partial override file that falls back to `en.json` (confirmed: it has only 4 top-level sections), so it does not need the new key.
- `value: string | null` is the contract for both components (`null` = unset); `onChange: (value: string) => void` is only ever called with a real, valid value.
- Full Jest suite (`npx jest`) must be 100% green before every commit after the first. Baseline before this plan: **30 suites / 235 tests passing**.
- Work happens directly on `master`, no worktree/branch, per the standing authorization for this session.
- Do not touch `src/components/ShiftWizard.tsx` — confirmed orphaned, explicitly out of scope per spec.

---

## Task 1: Add shared placeholder i18n keys

**Files:**
- Modify: `locales/pt.json` (common block, line 491-499)
- Modify: `locales/en.json` (common block, line 491-499)
- Modify: `locales/es.json` (common block, line 492-500)
- Modify: `locales/fr.json` (common block, line 423-431)
- Modify: `locales/zh.json` (common block, line 423-431)

**Interfaces:**
- Produces: i18n keys `common.select_date` and `common.select_time`, used as the `placeholder` prop by every `DateField`/`TimeField` call site in Tasks 7-12.

This is a data-only change (no new branching logic), so there is no red/green unit-test cycle for it — instead each step ends with a Node parse+lookup check that fails loudly on a JSON syntax error or a missing key, which is the meaningful failure mode for this kind of edit.

- [ ] **Step 1: Add the keys to `locales/pt.json`**

Find this block (lines 491-499):
```json
    "common":  {
                   "save":  "Salvar",
                   "cancel":  "Cancelar",
                   "delete":  "Excluir",
                   "edit":  "Editar",
                   "loading":  "Carregando...",
                   "error":  "Algo deu errado",
                   "required":  "Campo obrigatório"
               },
```
Replace with:
```json
    "common":  {
                   "save":  "Salvar",
                   "cancel":  "Cancelar",
                   "delete":  "Excluir",
                   "edit":  "Editar",
                   "loading":  "Carregando...",
                   "error":  "Algo deu errado",
                   "required":  "Campo obrigatório",
                   "select_date":  "Selecionar data",
                   "select_time":  "Selecionar horário"
               },
```

- [ ] **Step 2: Add the keys to `locales/en.json`**

Find (lines 491-499):
```json
    "common":  {
                   "save":  "Save",
                   "cancel":  "Cancel",
                   "delete":  "Delete",
                   "edit":  "Edit",
                   "loading":  "Loading...",
                   "error":  "Something went wrong",
                   "required":  "Required field"
               },
```
Replace with:
```json
    "common":  {
                   "save":  "Save",
                   "cancel":  "Cancel",
                   "delete":  "Delete",
                   "edit":  "Edit",
                   "loading":  "Loading...",
                   "error":  "Something went wrong",
                   "required":  "Required field",
                   "select_date":  "Select date",
                   "select_time":  "Select time"
               },
```

- [ ] **Step 3: Add the keys to `locales/es.json`**

Find (lines 492-500):
```json
    "common":  {
                   "save":  "Guardar",
                   "cancel":  "Cancelar",
                   "delete":  "Eliminar",
                   "edit":  "Editar",
                   "loading":  "Cargando...",
                   "error":  "Algo salió mal",
                   "required":  "Campo requerido"
               },
```
Replace with:
```json
    "common":  {
                   "save":  "Guardar",
                   "cancel":  "Cancelar",
                   "delete":  "Eliminar",
                   "edit":  "Editar",
                   "loading":  "Cargando...",
                   "error":  "Algo salió mal",
                   "required":  "Campo requerido",
                   "select_date":  "Seleccionar fecha",
                   "select_time":  "Seleccionar hora"
               },
```

- [ ] **Step 4: Add the keys to `locales/fr.json`**

Find (lines 423-431):
```json
  "common": {
    "save": "Enregistrer",
    "cancel": "Annuler",
    "delete": "Supprimer",
    "edit": "Modifier",
    "loading": "Chargement...",
    "error": "Quelque chose a mal tourné",
    "required": "Champ obligatoire"
  },
```
Replace with:
```json
  "common": {
    "save": "Enregistrer",
    "cancel": "Annuler",
    "delete": "Supprimer",
    "edit": "Modifier",
    "loading": "Chargement...",
    "error": "Quelque chose a mal tourné",
    "required": "Champ obligatoire",
    "select_date": "Sélectionner une date",
    "select_time": "Sélectionner une heure"
  },
```

- [ ] **Step 5: Add the keys to `locales/zh.json`**

Find (lines 423-431):
```json
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "edit": "编辑",
    "loading": "加载中...",
    "error": "出现错误",
    "required": "必填项"
  },
```
Replace with:
```json
  "common": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "edit": "编辑",
    "loading": "加载中...",
    "error": "出现错误",
    "required": "必填项",
    "select_date": "选择日期",
    "select_time": "选择时间"
  },
```

- [ ] **Step 6: Verify all 5 files still parse and contain the new keys**

Run (from `app-motorista/`):
```bash
node -e "
for (const f of ['pt','en','es','fr','zh']) {
  const d = require('./locales/' + f + '.json');
  if (!d.common.select_date || !d.common.select_time) throw new Error(f + ' missing keys');
  console.log(f, '->', d.common.select_date, '/', d.common.select_time);
}
console.log('OK');
"
```
Expected: prints all 5 languages' values followed by `OK`, no error thrown.

- [ ] **Step 7: Run the full suite to confirm nothing broke**

Run: `npx jest`
Expected: `Test Suites: 30 passed, 30 total` / `Tests: 235 passed, 235 total` (unchanged baseline — JSON-only change).

- [ ] **Step 8: Commit**

```bash
git add locales/pt.json locales/en.json locales/es.json locales/fr.json locales/zh.json
git commit -m "i18n: add common.select_date/select_time for the new date picker fields"
```

---

## Task 2: Install the date/time picker dependency

**Files:**
- Modify: `package.json`, `package-lock.json` (via the install command)

**Interfaces:**
- Produces: the `@react-native-community/datetimepicker` package, imported as `DateTimePicker` (default export) and `DateTimePickerEvent` (named type export) by Tasks 4 and 5.

- [ ] **Step 1: Install via Expo's dependency resolver**

Run (from `app-motorista/`):
```bash
npx expo install @react-native-community/datetimepicker
```
Expected: command exits 0; `package.json`'s `dependencies` gains a `@react-native-community/datetimepicker` entry at the SDK-56-compatible version Expo selects.

- [ ] **Step 2: Confirm the package resolves and jest's transform pattern already covers it**

Run:
```bash
node -e "console.log(require.resolve('@react-native-community/datetimepicker/package.json'))"
```
Expected: prints a path inside `node_modules/@react-native-community/datetimepicker/`.

Check `jest.config.js`'s `transformIgnorePatterns` (already present, no edit needed): the existing pattern `'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|...)'` already excludes any `@react-native-community/*` package from the ignore list, so it will be transformed correctly. Confirm by reading the file — do not edit it in this task.

- [ ] **Step 3: Run the full suite to confirm the install alone didn't break anything**

Run: `npx jest`
Expected: `Test Suites: 30 passed, 30 total` / `Tests: 235 passed, 235 total`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @react-native-community/datetimepicker"
```

---

## Task 3: `dateFieldFormat.ts` — pure YYYY-MM-DD/HH:mm ⇄ Date helpers

**Files:**
- Create: `src/utils/dateFieldFormat.ts`
- Test: `__tests__/utils/dateFieldFormat.test.ts`

**Interfaces:**
- Produces: `ymdToDate(ymd: string): Date`, `dateToYmd(date: Date): string`, `hmToDate(hm: string): Date`, `dateToHm(date: Date): string` — consumed by `DateField.tsx` (Task 4) and `TimeField.tsx` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `__tests__/utils/dateFieldFormat.test.ts`:
```typescript
import { dateToHm, dateToYmd, hmToDate, ymdToDate } from '../../src/utils/dateFieldFormat';

describe('ymdToDate', () => {
  it('parses a YYYY-MM-DD string into a local Date at midnight', () => {
    const d = ymdToDate('2026-08-14');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // 0-indexed
    expect(d.getDate()).toBe(14);
  });

  it('parses single-digit month/day correctly', () => {
    const d = ymdToDate('2026-01-05');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
});

describe('dateToYmd', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(dateToYmd(new Date(2026, 7, 14))).toBe('2026-08-14');
  });

  it('zero-pads single-digit month and day', () => {
    expect(dateToYmd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('ymdToDate / dateToYmd round-trip', () => {
  it('returns the original string after a round trip', () => {
    expect(dateToYmd(ymdToDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('hmToDate', () => {
  it('parses an HH:mm string into a Date with matching hours/minutes', () => {
    const d = hmToDate('06:05');
    expect(d.getHours()).toBe(6);
    expect(d.getMinutes()).toBe(5);
  });

  it('parses times at the edge of the day', () => {
    const d = hmToDate('23:59');
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });
});

describe('dateToHm', () => {
  it('formats a Date as zero-padded HH:mm', () => {
    const d = new Date(2026, 7, 14, 6, 5);
    expect(dateToHm(d)).toBe('06:05');
  });

  it('does not zero-pad double-digit hours/minutes', () => {
    const d = new Date(2026, 7, 14, 23, 59);
    expect(dateToHm(d)).toBe('23:59');
  });
});

describe('hmToDate / dateToHm round-trip', () => {
  it('returns the original string after a round trip', () => {
    expect(dateToHm(hmToDate('09:30'))).toBe('09:30');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/utils/dateFieldFormat.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/dateFieldFormat'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/dateFieldFormat.ts`:
```typescript
// Pure YYYY-MM-DD / HH:mm <-> Date conversions shared by DateField and
// TimeField. Kept separate from the components so the format logic is
// unit-testable without rendering React Native components.

export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dateToYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function hmToDate(hm: string): Date {
  const [h, min] = hm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d;
}

export function dateToHm(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/utils/dateFieldFormat.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 31 passed, 31 total` / `Tests: 245 passed, 245 total`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/dateFieldFormat.ts __tests__/utils/dateFieldFormat.test.ts
git commit -m "feat: add dateFieldFormat helpers for the new date/time picker fields"
```

---

## Task 4: `DateField` component

**Files:**
- Create: `src/components/DateField.tsx`
- Test: `__tests__/components/DateField.test.tsx`

**Interfaces:**
- Consumes: `ymdToDate`, `dateToYmd` from `src/utils/dateFieldFormat.ts` (Task 3); `DateTimePicker` (default export) from `@react-native-community/datetimepicker` (Task 2).
- Produces: `DateField` component with props `{ value: string | null; onChange: (value: string) => void; placeholder?: string; minimumDate?: Date; maximumDate?: Date; accessibilityLabel?: string; testID?: string }` — consumed by every call site in Tasks 7-12.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/DateField.test.tsx`:
```tsx
import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DateField } from '../../src/components/DateField';

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

import DateTimePicker from '@react-native-community/datetimepicker';
const mockDateTimePicker = DateTimePicker as unknown as jest.Mock;

describe('DateField', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    mockDateTimePicker.mockClear();
  });

  describe('on native (android)', () => {
    beforeEach(() => { Platform.OS = 'android'; });

    it('shows the placeholder when value is null', () => {
      render(<DateField value={null} onChange={jest.fn()} placeholder="Selecionar data" testID="d" />);
      expect(screen.getByText('Selecionar data')).toBeTruthy();
    });

    it('shows the value when set', () => {
      render(<DateField value="2026-08-14" onChange={jest.fn()} testID="d" />);
      expect(screen.getByText('2026-08-14')).toBeTruthy();
    });

    it('does not mount the native picker until tapped', () => {
      render(<DateField value={null} onChange={jest.fn()} testID="d" />);
      expect(mockDateTimePicker).not.toHaveBeenCalled();
    });

    it('mounts the native picker in date mode on tap', () => {
      render(<DateField value="2026-08-14" onChange={jest.fn()} testID="d" />);
      fireEvent.press(screen.getByTestId('d'));
      expect(mockDateTimePicker).toHaveBeenCalledTimes(1);
      const props = mockDateTimePicker.mock.calls[0][0];
      expect(props.mode).toBe('date');
      expect(props.display).toBe('default');
    });

    it('calls onChange with YYYY-MM-DD when the picker fires a "set" event', () => {
      const onChange = jest.fn();
      render(<DateField value={null} onChange={onChange} testID="d" />);
      fireEvent.press(screen.getByTestId('d'));
      const { onChange: pickerOnChange } = mockDateTimePicker.mock.calls[0][0];
      pickerOnChange({ type: 'set' }, new Date(2026, 7, 14));
      expect(onChange).toHaveBeenCalledWith('2026-08-14');
    });

    it('does not call onChange when the picker is dismissed', () => {
      const onChange = jest.fn();
      render(<DateField value={null} onChange={onChange} testID="d" />);
      fireEvent.press(screen.getByTestId('d'));
      const { onChange: pickerOnChange } = mockDateTimePicker.mock.calls[0][0];
      pickerOnChange({ type: 'dismissed' }, undefined);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('passes minimumDate/maximumDate through to the native picker', () => {
      const min = new Date(2020, 0, 1);
      const max = new Date(2030, 0, 1);
      render(<DateField value={null} onChange={jest.fn()} minimumDate={min} maximumDate={max} testID="d" />);
      fireEvent.press(screen.getByTestId('d'));
      const props = mockDateTimePicker.mock.calls[0][0];
      expect(props.minimumDate).toBe(min);
      expect(props.maximumDate).toBe(max);
    });
  });

  describe('on web', () => {
    beforeEach(() => { Platform.OS = 'web'; });

    it('renders an HTML date input with the current value', () => {
      render(<DateField value="2026-08-14" onChange={jest.fn()} testID="d" />);
      const input = screen.getByTestId('d');
      expect(input.type).toBe('input');
      expect(input.props.type).toBe('date');
      expect(input.props.value).toBe('2026-08-14');
    });

    it('renders an empty value when unset', () => {
      render(<DateField value={null} onChange={jest.fn()} testID="d" />);
      expect(screen.getByTestId('d').props.value).toBe('');
    });

    it('calls onChange with the raw YYYY-MM-DD string from the input event', () => {
      const onChange = jest.fn();
      render(<DateField value={null} onChange={onChange} testID="d" />);
      screen.getByTestId('d').props.onChange({ target: { value: '2026-08-20' } });
      expect(onChange).toHaveBeenCalledWith('2026-08-20');
    });

    it('does not call onChange for an empty input event', () => {
      const onChange = jest.fn();
      render(<DateField value="2026-08-14" onChange={onChange} testID="d" />);
      screen.getByTestId('d').props.onChange({ target: { value: '' } });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('passes minimumDate/maximumDate as min/max attributes', () => {
      const min = new Date(2020, 0, 1);
      const max = new Date(2030, 0, 1);
      render(<DateField value={null} onChange={jest.fn()} minimumDate={min} maximumDate={max} testID="d" />);
      const input = screen.getByTestId('d');
      expect(input.props.min).toBe('2020-01-01');
      expect(input.props.max).toBe('2030-01-01');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/DateField.test.tsx`
Expected: FAIL — `Cannot find module '../../src/components/DateField'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/DateField.tsx`:
```tsx
import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Colors, Radius, Spacing } from '../theme';
import { dateToYmd, ymdToDate } from '../utils/dateFieldFormat';

export interface DateFieldProps {
  value: string | null; // 'YYYY-MM-DD', null = unset
  onChange: (value: string) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  accessibilityLabel?: string;
  testID?: string;
}

// Web renders a raw HTML <input type="date">. This MUST use
// React.createElement rather than JSX <input> — the React Native JSX
// namespace has no intrinsic 'input' element type, so a literal <input> tag
// fails `tsc --noEmit` even though Jest (which doesn't type-check) wouldn't
// catch it. Same convention already used by Select.web.tsx in this codebase.
function WebDateInput({ value, onChange, placeholder, minimumDate, maximumDate, accessibilityLabel, testID }: DateFieldProps) {
  return React.createElement('input', {
    type: 'date',
    value: value ?? '',
    placeholder,
    onChange: (e: { target: { value: string } }) => {
      if (e.target.value) onChange(e.target.value);
    },
    min: minimumDate ? dateToYmd(minimumDate) : undefined,
    max: maximumDate ? dateToYmd(maximumDate) : undefined,
    'aria-label': accessibilityLabel,
    testID,
    style: {
      width: '100%',
      boxSizing: 'border-box',
      padding: '12px 16px',
      fontSize: 16,
      color: Colors.textPrimary,
      backgroundColor: Colors.background,
      border: `1px solid ${Colors.border}`,
      borderRadius: Radius.input,
      minHeight: 48,
      colorScheme: 'dark',
    },
  });
}

export function DateField(props: DateFieldProps) {
  const { value, onChange, placeholder, minimumDate, maximumDate, accessibilityLabel, testID } = props;
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    return <WebDateInput {...props} />;
  }

  function handleChange(event: DateTimePickerEvent, selected?: Date) {
    setOpen(false);
    if (event.type === 'set' && selected) {
      onChange(dateToYmd(selected));
    }
  }

  return (
    <View>
      <TouchableOpacity
        style={s.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        <Text style={[s.triggerText, !value && s.placeholder]} numberOfLines={1}>
          {value ?? placeholder ?? ''}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>
      {open ? (
        <DateTimePicker
          value={value ? ymdToDate(value) : new Date()}
          mode="date"
          display="default"
          onChange={handleChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.input, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4, minHeight: 48,
  },
  triggerText: { color: Colors.textPrimary, fontSize: 16, flex: 1 },
  placeholder: { color: Colors.textSecondary },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/DateField.test.tsx`
Expected: PASS — 11 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 32 passed, 32 total` / `Tests: 256 passed, 256 total`.

- [ ] **Step 6: Commit**

```bash
git add src/components/DateField.tsx __tests__/components/DateField.test.tsx
git commit -m "feat: add DateField component (native picker + web input[type=date])"
```

---

## Task 5: `TimeField` component

**Files:**
- Create: `src/components/TimeField.tsx`
- Test: `__tests__/components/TimeField.test.tsx`

**Interfaces:**
- Consumes: `hmToDate`, `dateToHm` from `src/utils/dateFieldFormat.ts` (Task 3); `DateTimePicker` from `@react-native-community/datetimepicker` (Task 2).
- Produces: `TimeField` component with props `{ value: string | null; onChange: (value: string) => void; placeholder?: string; accessibilityLabel?: string; testID?: string }` — consumed by `shifts.tsx` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/TimeField.test.tsx`:
```tsx
import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TimeField } from '../../src/components/TimeField';

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

import DateTimePicker from '@react-native-community/datetimepicker';
const mockDateTimePicker = DateTimePicker as unknown as jest.Mock;

describe('TimeField', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    mockDateTimePicker.mockClear();
  });

  describe('on native (android)', () => {
    beforeEach(() => { Platform.OS = 'android'; });

    it('shows the placeholder when value is null', () => {
      render(<TimeField value={null} onChange={jest.fn()} placeholder="Selecionar horário" testID="t" />);
      expect(screen.getByText('Selecionar horário')).toBeTruthy();
    });

    it('shows the value when set', () => {
      render(<TimeField value="09:05" onChange={jest.fn()} testID="t" />);
      expect(screen.getByText('09:05')).toBeTruthy();
    });

    it('does not mount the native picker until tapped', () => {
      render(<TimeField value={null} onChange={jest.fn()} testID="t" />);
      expect(mockDateTimePicker).not.toHaveBeenCalled();
    });

    it('mounts the native picker in time mode on tap', () => {
      render(<TimeField value="09:05" onChange={jest.fn()} testID="t" />);
      fireEvent.press(screen.getByTestId('t'));
      expect(mockDateTimePicker).toHaveBeenCalledTimes(1);
      const props = mockDateTimePicker.mock.calls[0][0];
      expect(props.mode).toBe('time');
      expect(props.display).toBe('default');
    });

    it('calls onChange with HH:mm when the picker fires a "set" event', () => {
      const onChange = jest.fn();
      render(<TimeField value={null} onChange={onChange} testID="t" />);
      fireEvent.press(screen.getByTestId('t'));
      const { onChange: pickerOnChange } = mockDateTimePicker.mock.calls[0][0];
      pickerOnChange({ type: 'set' }, new Date(2026, 7, 14, 9, 5));
      expect(onChange).toHaveBeenCalledWith('09:05');
    });

    it('does not call onChange when the picker is dismissed', () => {
      const onChange = jest.fn();
      render(<TimeField value={null} onChange={onChange} testID="t" />);
      fireEvent.press(screen.getByTestId('t'));
      const { onChange: pickerOnChange } = mockDateTimePicker.mock.calls[0][0];
      pickerOnChange({ type: 'dismissed' }, undefined);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('on web', () => {
    beforeEach(() => { Platform.OS = 'web'; });

    it('renders an HTML time input with the current value', () => {
      render(<TimeField value="09:05" onChange={jest.fn()} testID="t" />);
      const input = screen.getByTestId('t');
      expect(input.type).toBe('input');
      expect(input.props.type).toBe('time');
      expect(input.props.value).toBe('09:05');
    });

    it('renders an empty value when unset', () => {
      render(<TimeField value={null} onChange={jest.fn()} testID="t" />);
      expect(screen.getByTestId('t').props.value).toBe('');
    });

    it('calls onChange with the raw HH:mm string from the input event', () => {
      const onChange = jest.fn();
      render(<TimeField value={null} onChange={onChange} testID="t" />);
      screen.getByTestId('t').props.onChange({ target: { value: '14:30' } });
      expect(onChange).toHaveBeenCalledWith('14:30');
    });

    it('does not call onChange for an empty input event', () => {
      const onChange = jest.fn();
      render(<TimeField value="09:05" onChange={onChange} testID="t" />);
      screen.getByTestId('t').props.onChange({ target: { value: '' } });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/TimeField.test.tsx`
Expected: FAIL — `Cannot find module '../../src/components/TimeField'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/TimeField.tsx`:
```tsx
import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Colors, Radius, Spacing } from '../theme';
import { dateToHm, hmToDate } from '../utils/dateFieldFormat';

export interface TimeFieldProps {
  value: string | null; // 'HH:mm', null = unset
  onChange: (value: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  testID?: string;
}

// See DateField.tsx for why this uses React.createElement instead of JSX.
function WebTimeInput({ value, onChange, placeholder, accessibilityLabel, testID }: TimeFieldProps) {
  return React.createElement('input', {
    type: 'time',
    value: value ?? '',
    placeholder,
    onChange: (e: { target: { value: string } }) => {
      if (e.target.value) onChange(e.target.value);
    },
    'aria-label': accessibilityLabel,
    testID,
    style: {
      width: '100%',
      boxSizing: 'border-box',
      padding: '12px 16px',
      fontSize: 16,
      color: Colors.textPrimary,
      backgroundColor: Colors.background,
      border: `1px solid ${Colors.border}`,
      borderRadius: Radius.input,
      minHeight: 48,
      colorScheme: 'dark',
    },
  });
}

export function TimeField(props: TimeFieldProps) {
  const { value, onChange, placeholder, accessibilityLabel, testID } = props;
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    return <WebTimeInput {...props} />;
  }

  function handleChange(event: DateTimePickerEvent, selected?: Date) {
    setOpen(false);
    if (event.type === 'set' && selected) {
      onChange(dateToHm(selected));
    }
  }

  return (
    <View>
      <TouchableOpacity
        style={s.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        <Text style={[s.triggerText, !value && s.placeholder]} numberOfLines={1}>
          {value ?? placeholder ?? ''}
        </Text>
        <Ionicons name="time-outline" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>
      {open ? (
        <DateTimePicker
          value={value ? hmToDate(value) : new Date()}
          mode="time"
          display="default"
          onChange={handleChange}
          is24Hour
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.input, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4, minHeight: 48,
  },
  triggerText: { color: Colors.textPrimary, fontSize: 16, flex: 1 },
  placeholder: { color: Colors.textSecondary },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/TimeField.test.tsx`
Expected: PASS — 10 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 33 passed, 33 total` / `Tests: 266 passed, 266 total`.

- [ ] **Step 6: Commit**

```bash
git add src/components/TimeField.tsx __tests__/components/TimeField.test.tsx
git commit -m "feat: add TimeField component (native picker + web input[type=time])"
```

---

## Task 6: `shiftDateTimeUtils.ts` — replaces `displayToIso`/`isoToDisplay`

**Files:**
- Create: `src/utils/shiftDateTimeUtils.ts`
- Test: `__tests__/utils/shiftDateTimeUtils.test.ts`

**Interfaces:**
- Produces: `isoToDateAndTime(iso: string | null | undefined): { date: string | null; time: string | null }` and `dateAndTimeToIso(date: string | null, time: string | null): string | undefined` — consumed by `shifts.tsx`'s `ShiftFormModal` (Task 12), replacing its local `isoToDisplay`/`displayToIso` functions (lines 183-197 as currently read).

- [ ] **Step 1: Write the failing test**

Create `__tests__/utils/shiftDateTimeUtils.test.ts`:
```typescript
import { dateAndTimeToIso, isoToDateAndTime } from '../../src/utils/shiftDateTimeUtils';

describe('isoToDateAndTime', () => {
  it('returns null date/time for null input', () => {
    expect(isoToDateAndTime(null)).toEqual({ date: null, time: null });
  });

  it('returns null date/time for undefined input', () => {
    expect(isoToDateAndTime(undefined)).toEqual({ date: null, time: null });
  });

  it('splits an ISO timestamp into local date and time parts', () => {
    const d = new Date(2026, 7, 14, 9, 5); // local Aug 14 2026, 09:05
    const { date, time } = isoToDateAndTime(d.toISOString());
    expect(date).toBe('2026-08-14');
    expect(time).toBe('09:05');
  });

  it('zero-pads single-digit month/day/hour/minute', () => {
    const d = new Date(2026, 0, 5, 6, 3); // local Jan 5 2026, 06:03
    const { date, time } = isoToDateAndTime(d.toISOString());
    expect(date).toBe('2026-01-05');
    expect(time).toBe('06:03');
  });

  it('returns null date/time for an unparsable string', () => {
    expect(isoToDateAndTime('not-a-date')).toEqual({ date: null, time: null });
  });
});

describe('dateAndTimeToIso', () => {
  it('returns undefined when date is null', () => {
    expect(dateAndTimeToIso(null, '09:00')).toBeUndefined();
  });

  it('returns undefined when time is null', () => {
    expect(dateAndTimeToIso('2026-08-14', null)).toBeUndefined();
  });

  it('returns undefined when both are null', () => {
    expect(dateAndTimeToIso(null, null)).toBeUndefined();
  });

  it('combines a date and time into the equivalent local-time ISO string', () => {
    const expected = new Date(2026, 7, 14, 9, 5, 0).toISOString();
    expect(dateAndTimeToIso('2026-08-14', '09:05')).toBe(expected);
  });
});

describe('isoToDateAndTime / dateAndTimeToIso round-trip', () => {
  it('returns the original ISO string (to the second) after a round trip', () => {
    const original = new Date(2026, 7, 14, 9, 5, 0).toISOString();
    const { date, time } = isoToDateAndTime(original);
    expect(dateAndTimeToIso(date, time)).toBe(original);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/utils/shiftDateTimeUtils.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/shiftDateTimeUtils'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/shiftDateTimeUtils.ts`:
```typescript
// Pure date+time <-> ISO conversions for the shift edit form's start/end
// timestamps. Replaces the old displayToIso/isoToDisplay pair (DD/MM/YYYY
// HH:mm regex parsing) now that the form collects a DateField + TimeField
// pair instead of one free-text field -- both sub-values are already
// structurally valid (YYYY-MM-DD / HH:mm) by the time they reach here, so
// this is string composition, not validation.

export function isoToDateAndTime(iso: string | null | undefined): { date: string | null; time: string | null } {
  if (!iso) return { date: null, time: null };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: null, time: null };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function dateAndTimeToIso(date: string | null, time: string | null): string | undefined {
  if (!date || !time) return undefined;
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/utils/shiftDateTimeUtils.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 34 passed, 34 total` / `Tests: 276 passed, 276 total`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/shiftDateTimeUtils.ts __tests__/utils/shiftDateTimeUtils.test.ts
git commit -m "feat: add shiftDateTimeUtils to replace displayToIso/isoToDisplay"
```

---

## Task 7: Wire `DateField` into `register.tsx` (#1 `rentalStartDate`)

**Files:**
- Modify: `app/(auth)/register.tsx`

**Interfaces:**
- Consumes: `DateField` from `src/components/DateField.tsx` (Task 4); `common.select_date` i18n key (Task 1).

No new pure logic is introduced by this task — it is a mechanical prop swap on an existing screen with zero pre-existing test coverage of its own (there is no `register.test.tsx` in the repo; only extracted utils/services get dedicated tests, per the codebase's existing convention). Correctness is verified by keeping the full Jest suite green (regression safety net) plus the manual/deploy verification in Task 14. There is no red/green cycle for this task.

- [ ] **Step 1: Remove the `parseFlexibleDateInput` import, add the `DateField` import**

In `app/(auth)/register.tsx`, find:
```typescript
import { decimalToCents } from '../../src/utils/currency';
import { parseFlexibleDateInput } from '../../src/utils/dateInput';
import { displayToMeters } from '../../src/utils/units';
```
Replace with:
```typescript
import { decimalToCents } from '../../src/utils/currency';
import { displayToMeters } from '../../src/utils/units';
import { DateField } from '../../src/components/DateField';
```

- [ ] **Step 2: Make `rentalStartDate` nullable, defaulting to `null`**

Find:
```typescript
  const [rentalStartDate, setRentalStartDate] = useState('');
```
Replace with:
```typescript
  const [rentalStartDate, setRentalStartDate] = useState<string | null>(null);
```

- [ ] **Step 3: Simplify the `rentalOk` validation (no more free-text parsing)**

Find:
```typescript
  // rentalStartDate must actually PARSE, not just be non-empty -- the field's
  // placeholder says "AAAA-MM-DD" but nothing enforced that, and a typed
  // "14/08/2026" (DD/MM/YYYY, the format Brazilian users naturally reach
  // for) crashed vehicle registration in production with a raw Postgres
  // error rather than a caught, correctable validation message.
  const rentalOk      = ownership !== 'rent' || allowancePeriod === 'unlimited'
    ? true
    : !!parseFlexibleDateInput(rentalStartDate) && !!allowanceAmount.trim() && !!excessRate.trim();
```
Replace with:
```typescript
  // rentalStartDate now comes from DateField, which only ever produces a
  // structurally valid 'YYYY-MM-DD' string or null -- no parsing needed.
  const rentalOk      = ownership !== 'rent' || allowancePeriod === 'unlimited'
    ? true
    : !!rentalStartDate && !!allowanceAmount.trim() && !!excessRate.trim();
```

- [ ] **Step 4: Use `rentalStartDate` directly in `buildInput()`**

Find:
```typescript
        rental_contract_start_date: ownership === 'rent' ? parseFlexibleDateInput(rentalStartDate) : null,
```
Replace with:
```typescript
        rental_contract_start_date: ownership === 'rent' ? rentalStartDate : null,
```

- [ ] **Step 5: Swap the `TextInput` for `DateField`**

Find:
```tsx
                <Text style={s.label}>
                  {t('onboarding.rental_start_date')}
                  {allowancePeriod !== 'unlimited' ? <Text style={s.required}> *</Text> : null}
                </Text>
                <TextInput
                  style={inp}
                  value={rentalStartDate}
                  onChangeText={setRentalStartDate}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel={t('onboarding.rental_start_date')}
                />
```
Replace with:
```tsx
                <Text style={s.label}>
                  {t('onboarding.rental_start_date')}
                  {allowancePeriod !== 'unlimited' ? <Text style={s.required}> *</Text> : null}
                </Text>
                <DateField
                  value={rentalStartDate}
                  onChange={setRentalStartDate}
                  placeholder={t('common.select_date')}
                  accessibilityLabel={t('onboarding.rental_start_date')}
                  testID="register-rental-start-date"
                />
```

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 34 passed, 34 total` / `Tests: 276 passed, 276 total` (unchanged — this screen has no dedicated tests, and no shared logic changed).

- [ ] **Step 7: Commit**

```bash
git add "app/(auth)/register.tsx"
git commit -m "feat: replace free-text rental start date with DateField in register.tsx"
```

---

## Task 8: Wire `DateField` into `more.tsx`'s `VehicleModal` (#2 `rentalStartDate`)

**Files:**
- Modify: `app/(tabs)/more.tsx`

**Interfaces:**
- Consumes: `DateField` from `src/components/DateField.tsx` (Task 4); `common.select_date` i18n key (Task 1).

Same rationale as Task 7 — mechanical prop swap, no new logic, verified by the full suite staying green.

- [ ] **Step 1: Remove the `parseFlexibleDateInput` import, add the `DateField` import**

Find:
```typescript
import { Select } from '@/src/components/Select';
import { parseFlexibleDateInput } from '@/src/utils/dateInput';
import { authSignOut } from '@/src/hooks/useAuth';
```
Replace with:
```typescript
import { Select } from '@/src/components/Select';
import { DateField } from '@/src/components/DateField';
import { authSignOut } from '@/src/hooks/useAuth';
```

- [ ] **Step 2: Make `rentalStartDate` nullable in `VehicleModal`**

Find:
```typescript
  const [rentalStartDate, setRentalStartDate]         = useState('');
```
Replace with:
```typescript
  const [rentalStartDate, setRentalStartDate]         = useState<string | null>(null);
```

- [ ] **Step 3: Update the two `useEffect` prefill/reset branches**

Find:
```typescript
      setRentalStartDate(vehicle.rental_contract_start_date ?? '');
```
Replace with:
```typescript
      setRentalStartDate(vehicle.rental_contract_start_date ?? null);
```

Find:
```typescript
      setRentalStartDate(''); setRentalStartOdometer('');
```
Replace with:
```typescript
      setRentalStartDate(null); setRentalStartOdometer('');
```

- [ ] **Step 4: Simplify the `handleSave` validation and payload**

Find:
```typescript
    // rentalStartDate must actually PARSE, not just be non-empty -- see the
    // identical comment in register.tsx. Same production crash, same field.
    if (ownership === 'rent' && allowancePeriod !== 'unlimited' && !parseFlexibleDateInput(rentalStartDate)) { setError(t('more.vehicle_required')); return; }
    const rentalFields = {
      ownership_type: ownership,
      rental_contract_start_date: ownership === 'rent' ? parseFlexibleDateInput(rentalStartDate) : null,
```
Replace with:
```typescript
    // rentalStartDate now comes from DateField, which only ever produces a
    // structurally valid 'YYYY-MM-DD' string or null -- no parsing needed.
    if (ownership === 'rent' && allowancePeriod !== 'unlimited' && !rentalStartDate) { setError(t('more.vehicle_required')); return; }
    const rentalFields = {
      ownership_type: ownership,
      rental_contract_start_date: ownership === 'rent' ? rentalStartDate : null,
```

- [ ] **Step 5: Swap the `TextInput` for `DateField`**

Find:
```tsx
              <Text style={s.fieldLabel}>{t('onboarding.rental_start_date')}</Text>
              <TextInput
                style={s.fieldInput}
                value={rentalStartDate}
                onChangeText={setRentalStartDate}
                placeholder="AAAA-MM-DD"
                placeholderTextColor={Colors.textSecondary}
                accessibilityLabel={t('onboarding.rental_start_date')}
              />
```
Replace with:
```tsx
              <Text style={s.fieldLabel}>{t('onboarding.rental_start_date')}</Text>
              <DateField
                value={rentalStartDate}
                onChange={setRentalStartDate}
                placeholder={t('common.select_date')}
                accessibilityLabel={t('onboarding.rental_start_date')}
                testID="vehicle-rental-start-date"
              />
```

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 34 passed, 34 total` / `Tests: 276 passed, 276 total`.

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/more.tsx"
git commit -m "feat: replace free-text rental start date with DateField in more.tsx VehicleModal"
```

---

## Task 9: Wire `DateField` into `expenses.tsx`'s `ExpenseForm` (#3 `endsAt`, #5 `date`)

**Files:**
- Modify: `app/(tabs)/expenses.tsx`

**Interfaces:**
- Consumes: `DateField` from `src/components/DateField.tsx` (Task 4); `common.select_date` i18n key (Task 1).

- [ ] **Step 1: Remove the `parseFlexibleDateInput` import, add the `DateField` import**

Find:
```typescript
import { decimalToCents, formatMoney } from '@/src/utils/currency';
import { parseFlexibleDateInput } from '@/src/utils/dateInput';
import { displayToMl } from '@/src/utils/units';
```
Replace with:
```typescript
import { decimalToCents, formatMoney } from '@/src/utils/currency';
import { displayToMl } from '@/src/utils/units';
import { DateField } from '@/src/components/DateField';
```

- [ ] **Step 2: Make `ExpenseForm`'s `endsAt` state nullable**

Find:
```typescript
  const [endsAt, setEndsAt] = useState((initialValues as any)?.ends_at ?? '');
```
Replace with:
```typescript
  const [endsAt, setEndsAt] = useState<string | null>((initialValues as any)?.ends_at ?? null);
```

- [ ] **Step 3: Simplify `ExpenseForm.handleSave` (no more regex checks)**

Find:
```typescript
  function handleSave() {
    const trimmedDate = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) return;
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountNum) || amountNum <= 0) return;

    onSave({
      category,
      amount_cents: decimalToCents(amountNum),
      expense_date: trimmedDate,
      description: description.trim() !== '' ? description.trim() : null,
      recurring,
      recurring_frequency: recurring ? frequency : null,
      ends_at: recurring ? parseFlexibleDateInput(endsAt) : null,
    });
  }
```
Replace with:
```typescript
  function handleSave() {
    if (!date) return;
    const amountNum = parseFloat(amount.replace(',', '.'));
    if (isNaN(amountNum) || amountNum <= 0) return;

    onSave({
      category,
      amount_cents: decimalToCents(amountNum),
      expense_date: date,
      description: description.trim() !== '' ? description.trim() : null,
      recurring,
      recurring_frequency: recurring ? frequency : null,
      ends_at: recurring ? endsAt : null,
    });
  }
```

- [ ] **Step 4: Swap `ExpenseForm`'s `endsAt` `TextInput` for `DateField`**

Find:
```tsx
            <Text style={styles.label}>{t('expense.ends_at')}</Text>
            <TextInput
              style={styles.input}
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="AAAA-MM-DD"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <Text style={styles.hint}>{t('expense.ends_at_hint')}</Text>
```
Replace with:
```tsx
            <Text style={styles.label}>{t('expense.ends_at')}</Text>
            <DateField
              value={endsAt}
              onChange={setEndsAt}
              placeholder={t('common.select_date')}
              accessibilityLabel={t('expense.ends_at')}
              testID="expense-form-ends-at"
            />
            <Text style={styles.hint}>{t('expense.ends_at_hint')}</Text>
```

- [ ] **Step 5: Swap `ExpenseForm`'s `date` `TextInput` for `DateField`**

Find:
```tsx
        <Text style={styles.label}>{t('expense.date')}</Text>
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={setDate}
          placeholder={t('expense.date_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />

        {error !== null && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.onBrand} />
          ) : (
            <Text style={styles.primaryButtonText}>{t('expense.save')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── add modal (keeps fuel-entry sync logic) ──────────────────────────────────
```
Replace with:
```tsx
        <Text style={styles.label}>{t('expense.date')}</Text>
        <DateField
          value={date}
          onChange={setDate}
          placeholder={t('common.select_date')}
          accessibilityLabel={t('expense.date')}
          testID="expense-form-date"
        />

        {error !== null && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.onBrand} />
          ) : (
            <Text style={styles.primaryButtonText}>{t('expense.save')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── add modal (keeps fuel-entry sync logic) ──────────────────────────────────
```

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 34 passed, 34 total` / `Tests: 276 passed, 276 total`.

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/expenses.tsx"
git commit -m "feat: replace free-text date fields with DateField in expenses.tsx ExpenseForm"
```

---

## Task 10: Wire `DateField` into `expenses.tsx`'s `AddExpenseModal` (#4 `endsAt`, #6 `date`)

**Files:**
- Modify: `app/(tabs)/expenses.tsx`

**Interfaces:**
- Consumes: `DateField` (already imported in Task 9, same file).

- [ ] **Step 1: Make `AddExpenseModal`'s `endsAt` state nullable**

Find:
```typescript
  const [endsAt, setEndsAt] = useState('');
```
Replace with:
```typescript
  const [endsAt, setEndsAt] = useState<string | null>(null);
```

- [ ] **Step 2: Reset `endsAt` to `null` in `resetForm`**

Find:
```typescript
  function resetForm() {
    setCategory(EXPENSE_CATEGORIES[0]); setAmount(''); setDate(todayIso());
    setDescription(''); setRecurring(false); setFrequency('monthly');
    setEndsAt('');
    setInstallments('1');
```
Replace with:
```typescript
  function resetForm() {
    setCategory(EXPENSE_CATEGORIES[0]); setAmount(''); setDate(todayIso());
    setDescription(''); setRecurring(false); setFrequency('monthly');
    setEndsAt(null);
    setInstallments('1');
```

- [ ] **Step 3: Simplify the date guard and drop `parseFlexibleDateInput` from `handleSave`**

Find:
```typescript
  async function handleSave() {
    setError(null);
    const trimmedDate = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) { setError(t('common.required')); return; }
```
Replace with:
```typescript
  async function handleSave() {
    setError(null);
    const trimmedDate = date;
    if (!trimmedDate) { setError(t('common.required')); return; }
```

Find:
```typescript
        if (n === 1) {
          await addExpense({ user_id: userId, category, amount_cents: totalCents, expense_date: trimmedDate, description: desc, recurring, recurring_frequency: recurring ? frequency : null, ends_at: recurring ? parseFlexibleDateInput(endsAt) : null });
```
Replace with:
```typescript
        if (n === 1) {
          await addExpense({ user_id: userId, category, amount_cents: totalCents, expense_date: trimmedDate, description: desc, recurring, recurring_frequency: recurring ? frequency : null, ends_at: recurring ? endsAt : null });
```

- [ ] **Step 4: Swap `AddExpenseModal`'s `endsAt` `TextInput` for `DateField`**

Find:
```tsx
                      <Text style={styles.label}>{t('expense.ends_at')}</Text>
                      <TextInput
                        style={styles.input}
                        value={endsAt}
                        onChangeText={setEndsAt}
                        placeholder="AAAA-MM-DD"
                        placeholderTextColor={Colors.textSecondary}
                        autoCapitalize="none"
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                      />
                      <Text style={styles.hint}>{t('expense.ends_at_hint')}</Text>
```
Replace with:
```tsx
                      <Text style={styles.label}>{t('expense.ends_at')}</Text>
                      <DateField
                        value={endsAt}
                        onChange={setEndsAt}
                        placeholder={t('common.select_date')}
                        accessibilityLabel={t('expense.ends_at')}
                        testID="add-expense-ends-at"
                      />
                      <Text style={styles.hint}>{t('expense.ends_at_hint')}</Text>
```

- [ ] **Step 5: Swap `AddExpenseModal`'s `date` `TextInput` for `DateField`**

Find:
```tsx
          <Text style={styles.label}>{t('expense.date')}</Text>
          <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder={t('expense.date_placeholder')} placeholderTextColor={Colors.textSecondary} autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={10} />
```
Replace with:
```tsx
          <Text style={styles.label}>{t('expense.date')}</Text>
          <DateField value={date} onChange={setDate} placeholder={t('common.select_date')} accessibilityLabel={t('expense.date')} testID="add-expense-date" />
```

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 34 passed, 34 total` / `Tests: 276 passed, 276 total`.

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/expenses.tsx"
git commit -m "feat: replace free-text date fields with DateField in expenses.tsx AddExpenseModal"
```

---

## Task 11: Wire `DateField` into `fuel.tsx`'s `FuelForm` (#7 `dateStr`)

**Files:**
- Modify: `app/(tabs)/fuel.tsx`

**Interfaces:**
- Consumes: `DateField` from `src/components/DateField.tsx` (Task 4); `common.select_date` i18n key (Task 1).

- [ ] **Step 1: Add the `DateField` import**

Find:
```typescript
import { Select } from '@/src/components/Select';
import { useProfile } from '@/src/hooks/useProfile';
```
Replace with:
```typescript
import { Select } from '@/src/components/Select';
import { DateField } from '@/src/components/DateField';
import { useProfile } from '@/src/hooks/useProfile';
```

- [ ] **Step 2: Simplify `filled_at` derivation in `handleSave` (no more regex fallback)**

Find:
```typescript
      station: station.trim() !== '' ? station.trim() : null,
      filled_at: dateStr.trim().match(/^\d{4}-\d{2}-\d{2}$/)
        ? new Date(dateStr.trim() + 'T12:00:00').toISOString()
        : (initialValues?.filled_at ?? new Date().toISOString()),
    });
```
Replace with:
```typescript
      station: station.trim() !== '' ? station.trim() : null,
      // dateStr now comes from DateField, which only ever produces a
      // structurally valid 'YYYY-MM-DD' string -- no fallback needed.
      filled_at: new Date(dateStr + 'T12:00:00').toISOString(),
    });
```

- [ ] **Step 3: Swap the `dateStr` `TextInput` for `DateField`**

Find:
```tsx
        <Text style={styles.label}>{t('fuel.entry_date')}</Text>
        <TextInput
          style={styles.input}
          value={dateStr}
          onChangeText={setDateStr}
          placeholder="AAAA-MM-DD"
          placeholderTextColor={Colors.textSecondary}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
```
Replace with:
```tsx
        <Text style={styles.label}>{t('fuel.entry_date')}</Text>
        <DateField
          value={dateStr}
          onChange={setDateStr}
          placeholder={t('common.select_date')}
          accessibilityLabel={t('fuel.entry_date')}
          testID="fuel-form-date"
        />
```

- [ ] **Step 4: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 34 passed, 34 total` / `Tests: 276 passed, 276 total`.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/fuel.tsx"
git commit -m "feat: replace free-text entry date with DateField in fuel.tsx FuelForm"
```

---

## Task 12: Wire `DateField` + `TimeField` into `shifts.tsx`'s `ShiftFormModal` (#8 `started_at`, #9 `ended_at`)

**Files:**
- Modify: `app/(tabs)/shifts.tsx`

**Interfaces:**
- Consumes: `DateField`, `TimeField` (Tasks 4-5); `isoToDateAndTime`, `dateAndTimeToIso` from `src/utils/shiftDateTimeUtils.ts` (Task 6); `common.select_date`/`common.select_time` i18n keys (Task 1).

- [ ] **Step 1: Add the `DateField`/`TimeField`/`shiftDateTimeUtils` imports**

Find:
```typescript
import { getUserPlatforms } from '@/src/services/platforms';
import { getEffectiveVehicleId } from '@/src/services/vehicles';
import { reconcileShiftPlatforms } from '@/src/utils/shiftReconciliationUtils';
```
Replace with:
```typescript
import { getUserPlatforms } from '@/src/services/platforms';
import { getEffectiveVehicleId } from '@/src/services/vehicles';
import { reconcileShiftPlatforms } from '@/src/utils/shiftReconciliationUtils';
import { dateAndTimeToIso, isoToDateAndTime } from '@/src/utils/shiftDateTimeUtils';
import { DateField } from '@/src/components/DateField';
import { TimeField } from '@/src/components/TimeField';
```

- [ ] **Step 2: Replace the `editStartedAt`/`editEndedAt` state with four date/time sub-fields**

Find:
```typescript
  const [editStartedAt, setEditStartedAt] = useState('');
  const [editEndedAt, setEditEndedAt] = useState('');
```
Replace with:
```typescript
  const [editStartDate, setEditStartDate] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState<string | null>(null);
  const [editEndDate, setEditEndDate] = useState<string | null>(null);
  const [editEndTime, setEditEndTime] = useState<string | null>(null);
```

- [ ] **Step 3: Delete the local `isoToDisplay`/`displayToIso` functions**

Find:
```typescript
  function isoToDisplay(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function displayToIso(display: string): string | undefined {
    // expects DD/MM/YYYY HH:mm
    const m = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return undefined;
    const [, dd, mm, yyyy, hh, min] = m;
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd), parseInt(hh), parseInt(min));
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  useEffect(() => {
```
Replace with:
```typescript
  useEffect(() => {
```

- [ ] **Step 4: Update the prefill/reset `useEffect`**

Find:
```typescript
      setEditStartedAt(isoToDisplay(existingShift.started_at));
      setEditEndedAt(isoToDisplay(existingShift.ended_at));
    } else {
      setOdometer('');
      setPlatforms([{ name: '', amount: '', rides: '' }]);
      setTips('');
      setBonuses('');
      setMood(null);
      setNotes('');
      setEditStartedAt('');
      setEditEndedAt('');
    }
```
Replace with:
```typescript
      const startParts = isoToDateAndTime(existingShift.started_at);
      setEditStartDate(startParts.date);
      setEditStartTime(startParts.time);
      const endParts = isoToDateAndTime(existingShift.ended_at);
      setEditEndDate(endParts.date);
      setEditEndTime(endParts.time);
    } else {
      setOdometer('');
      setPlatforms([{ name: '', amount: '', rides: '' }]);
      setTips('');
      setBonuses('');
      setMood(null);
      setNotes('');
      setEditStartDate(null);
      setEditStartTime(null);
      setEditEndDate(null);
      setEditEndTime(null);
    }
```

- [ ] **Step 5: Simplify `handleSave`'s edit-mode branch (drop the now-unreachable format-error path)**

Find:
```typescript
      if (mode === 'end') {
        await endShift(shiftId, payload, startedAt, pauses ?? []);
      } else {
        const parsedStart = editStartedAt.trim() ? displayToIso(editStartedAt) : existingShift?.started_at;
        const parsedEnd = editEndedAt.trim() ? displayToIso(editEndedAt) : existingShift?.ended_at;
        if ((editStartedAt.trim() && !parsedStart) || (editEndedAt.trim() && !parsedEnd)) {
          setError(t('shift.time_format_hint'));
          setSaving(false);
          return;
        }
        await updateShift(shiftId, payload, parsedStart, parsedEnd ?? undefined);
      }
```
Replace with:
```typescript
      if (mode === 'end') {
        await endShift(shiftId, payload, startedAt, pauses ?? []);
      } else {
        // editStartDate/editStartTime (and the End pair) are always set
        // together from the same existingShift on modal open, and DateField/
        // TimeField only ever produce structurally valid values -- no parse
        // failure mode remains, so there's no error path to guard here.
        const parsedStart = (editStartDate && editStartTime) ? dateAndTimeToIso(editStartDate, editStartTime) : existingShift?.started_at;
        const parsedEnd = (editEndDate && editEndTime) ? dateAndTimeToIso(editEndDate, editEndTime) : existingShift?.ended_at;
        await updateShift(shiftId, payload, parsedStart, parsedEnd ?? undefined);
      }
```

- [ ] **Step 6: Swap the two `TextInput`s in the edit-mode render block for `DateField`+`TimeField` pairs**

Find:
```tsx
          {mode === 'edit' && (
            <>
              <Text style={styles.fieldLabel}>{t('shift.start_time')}</Text>
              <TextInput
                style={styles.input}
                value={editStartedAt}
                onChangeText={setEditStartedAt}
                placeholder={t('shift.time_format_hint')}
                placeholderTextColor={Colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
              <Text style={styles.fieldLabel}>{t('shift.end_time')}</Text>
              <TextInput
                style={styles.input}
                value={editEndedAt}
                onChangeText={setEditEndedAt}
                placeholder={t('shift.time_format_hint')}
                placeholderTextColor={Colors.textSecondary}
                keyboardType="numbers-and-punctuation"
              />
            </>
          )}
```
Replace with:
```tsx
          {mode === 'edit' && (
            <>
              <Text style={styles.fieldLabel}>{t('shift.start_time')}</Text>
              <View style={styles.dateTimeRow}>
                <View style={styles.dateTimeField}>
                  <DateField
                    value={editStartDate}
                    onChange={setEditStartDate}
                    placeholder={t('common.select_date')}
                    accessibilityLabel={t('shift.start_time')}
                    testID="shift-edit-start-date"
                  />
                </View>
                <View style={styles.dateTimeField}>
                  <TimeField
                    value={editStartTime}
                    onChange={setEditStartTime}
                    placeholder={t('common.select_time')}
                    accessibilityLabel={t('shift.start_time')}
                    testID="shift-edit-start-time"
                  />
                </View>
              </View>
              <Text style={styles.fieldLabel}>{t('shift.end_time')}</Text>
              <View style={styles.dateTimeRow}>
                <View style={styles.dateTimeField}>
                  <DateField
                    value={editEndDate}
                    onChange={setEditEndDate}
                    placeholder={t('common.select_date')}
                    accessibilityLabel={t('shift.end_time')}
                    testID="shift-edit-end-date"
                  />
                </View>
                <View style={styles.dateTimeField}>
                  <TimeField
                    value={editEndTime}
                    onChange={setEditEndTime}
                    placeholder={t('common.select_time')}
                    accessibilityLabel={t('shift.end_time')}
                    testID="shift-edit-end-time"
                  />
                </View>
              </View>
            </>
          )}
```

- [ ] **Step 7: Add the `dateTimeRow`/`dateTimeField` styles**

Find (end of the `styles` `StyleSheet.create` block):
```typescript
  odometerHint: { color: Colors.textSecondary, fontSize: 12, marginTop: -Spacing.xs, marginBottom: Spacing.md, paddingHorizontal: 2 },
  cancelBtn: { paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 15 },
});
```
Replace with:
```typescript
  odometerHint: { color: Colors.textSecondary, fontSize: 12, marginTop: -Spacing.xs, marginBottom: Spacing.md, paddingHorizontal: 2 },
  cancelBtn: { paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 15 },
  dateTimeRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xs },
  dateTimeField: { flex: 1 },
});
```

- [ ] **Step 8: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 34 passed, 34 total` / `Tests: 276 passed, 276 total`.

- [ ] **Step 9: Commit**

```bash
git add "app/(tabs)/shifts.tsx"
git commit -m "feat: replace free-text start/end datetime fields with DateField+TimeField in shifts.tsx"
```

---

## Task 13: Remove dead code (`parseFlexibleDateInput` and its test)

**Files:**
- Delete: `src/utils/dateInput.ts`
- Delete: `__tests__/utils/dateInput.test.ts`

**Interfaces:** none — this task only removes code once nothing imports it.

- [ ] **Step 1: Confirm no remaining importers**

Run (from `app-motorista/`):
```bash
grep -rn "parseFlexibleDateInput" --include="*.ts" --include="*.tsx" app src __tests__
```
Expected: no output (empty). If anything prints, STOP — a call site was missed in Tasks 7-11 and must be fixed before deleting the util.

- [ ] **Step 2: Delete the util and its test**

```bash
git rm src/utils/dateInput.ts __tests__/utils/dateInput.test.ts
```

- [ ] **Step 3: Run the full suite**

Run: `npx jest`
Expected: `Test Suites: 33 passed, 33 total` / `Tests: 269 passed, 269 total` (loses `dateInput.test.ts`'s 1 suite / 7 tests from the Task 6 checkpoint of 34/276).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove parseFlexibleDateInput now that no field accepts free-text dates"
```

---

## Task 14: Final verification and deploy

**Files:** none (verification only).

- [ ] **Step 1: Run the full Jest suite one more time**

Run: `npx jest`
Expected: `Test Suites: 33 passed, 33 total` / `Tests: 269 passed, 269 total`, 0 failures.

- [ ] **Step 2: Sanity-check TypeScript on the app/src tree (non-blocking on pre-existing Deno edge-function errors)**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -v "^supabase/functions/"
```
Expected: empty output. (The baseline run before this plan showed only `supabase/functions/**` errors, from untyped Deno edge functions unrelated to this app — those are pre-existing and out of scope. Any output from `app/` or `src/` here is a real type error introduced by this plan and must be fixed before proceeding.)

- [ ] **Step 3: Confirm the spec's 9 call sites all now use `DateField`/`TimeField`**

Run:
```bash
grep -rn "DateField\|TimeField" "app/(auth)/register.tsx" "app/(tabs)/more.tsx" "app/(tabs)/expenses.tsx" "app/(tabs)/fuel.tsx" "app/(tabs)/shifts.tsx"
```
Expected: at least one `DateField` match in each of `register.tsx`, `more.tsx`, `fuel.tsx`; at least two `DateField` matches in `expenses.tsx` (ExpenseForm + AddExpenseModal); both `DateField` and `TimeField` matches (2 each) in `shifts.tsx`.

- [ ] **Step 4: Deploy to production**

Run (from `app-motorista/`):
```bash
vercel --prod
```
Confirm the deployment finishes and prints a production URL.

- [ ] **Step 5: Confirm the deploy is live and READY**

Run:
```bash
vercel ls --prod 2>&1 | head -5
```
Expected: the newest deployment for this project shows state `Ready`. Then open `https://app.paldrivy.com` (or use `vercel inspect <url>`) and confirm it loads without a blank screen / build error.

- [ ] **Step 6: Update the Obsidian project log**

Append a new dated entry to `D:\Obsidian\Claude Code\PalDrivy.md`, following the same format as the file's existing entries, describing: the bug class this closes (free-text date parsing crashes), the two new components (`DateField`, `TimeField`), the 9 call sites migrated, the dead code removed (`parseFlexibleDateInput` + its test, the two inline expense regex checks, fuel.tsx's inline regex/fallback, shifts.tsx's `displayToIso`/`isoToDisplay`), the new dependency (`@react-native-community/datetimepicker`), final test count, and the production deploy confirmation.

No commit needed for this step — the Obsidian vault is outside the `app-motorista` git repo.

---

## Self-Review Notes (completed during plan authoring)

**Spec coverage:** All 9 call sites from the spec's table are covered — #1/#2 in Tasks 7-8, #3/#5 in Task 9, #4/#6 in Task 10, #7 in Task 11, #8/#9 in Task 12. Both new components (`DateField`, `TimeField`) match the spec's documented prop shapes exactly. All 4 items in "Code removed as dead weight" are covered: `parseFlexibleDateInput` + test (Task 13), `expenses.tsx`'s two regex checks (Tasks 9-10), `fuel.tsx`'s regex/fallback (Task 11), `shifts.tsx`'s `displayToIso`/`isoToDisplay` (Task 12). `ShiftWizard.tsx` is explicitly untouched (Global Constraints). The web `<input>` styling approach, no-manual-typing rule, and `expo install` requirement are all captured as Global Constraints.

**Placeholder scan:** No TBD/TODO markers; every step has literal code, not a description of code.

**Type consistency:** `DateFieldProps`/`TimeFieldProps` (`value: string | null`, `onChange: (value: string) => void`) are defined once in Tasks 4-5 and used identically at every call site in Tasks 7-12. `isoToDateAndTime`/`dateAndTimeToIso` signatures from Task 6 match their exact usage in Task 12 Step 5.
