# Calendar-Based Date Fields — Design

**Goal:** replace every free-text date `TextInput` in the app with a tap-to-open calendar/time picker, so a driver can no longer type a malformed or ambiguous date (DD/MM vs YYYY-MM-DD, invalid days, etc.) into any form. This directly targets the class of bug fixed twice earlier today (2026-08-15): a registration crash from an unparsed Brazilian-format date, and a silent-failure variant of the same issue discovered while auditing the rest of the app for this feature.

## Context

An audit of every `TextInput` in `app/` and `src/components/` (2026-08-15) found 9 real date fields across 5 files, only 4 of which were already guarded by `src/utils/dateInput.ts`'s `parseFlexibleDateInput`:

| # | File | Field | Represents | Currently validated? | Date+time? |
|---|------|-------|-----------|----------------------|------------|
| 1 | `app/(auth)/register.tsx` | `rentalStartDate` | `rental_contract_start_date` | Yes | No |
| 2 | `app/(tabs)/more.tsx` (`VehicleModal`) | `rentalStartDate` | `rental_contract_start_date` | Yes | No |
| 3 | `app/(tabs)/expenses.tsx` (`ExpenseForm`) | `endsAt` | `ends_at` | Yes | No |
| 4 | `app/(tabs)/expenses.tsx` (`AddExpenseModal`) | `endsAt` | `ends_at` | Yes | No |
| 5 | `app/(tabs)/expenses.tsx` (`ExpenseForm`) | `date` | `expense_date` | **No** — strict regex, silently rejects DD/MM/AAAA | No |
| 6 | `app/(tabs)/expenses.tsx` (`AddExpenseModal`) | `date` | `expense_date` (+ `filled_at` if category is fuel) | **No** — same as #5 | No |
| 7 | `app/(tabs)/fuel.tsx` (`FuelForm`) | `dateStr` | `filled_at` | **No** — own regex, silently falls back to the previous value | No |
| 8 | `app/(tabs)/shifts.tsx` (`ShiftFormModal`) | `editStartedAt` | `started_at` | **No** — custom `displayToIso`, format `DD/MM/YYYY HH:mm` | **Yes** |
| 9 | `app/(tabs)/shifts.tsx` (`ShiftFormModal`) | `editEndedAt` | `ended_at` | **No** — same as #8 | **Yes** |

`src/components/ShiftWizard.tsx` has a 10th date field but is orphaned (imported nowhere) — confirmed dead code from an already-executed plan (`docs/superpowers/plans/2026-07-29-comunidade.md`). Out of scope; not touched by this pass.

## Decisions (brainstormed with the owner, 2026-08-15)

1. **Library, not a hand-built calendar grid**: `@react-native-community/datetimepicker`, installed via `npx expo install @react-native-community/datetimepicker` (Expo SDK 56, confirmed compatible). On native it opens the OS's own date/time dialog.
2. **Web fallback**: the browser's native `<input type="date">` / `<input type="time">`, not a custom-styled web calendar. Fast to build, accessible, at the cost of not matching the app's dark theme exactly on web (acceptable tradeoff, explicitly chosen over building/maintaining a second calendar implementation).
3. **No manual typing left as a fallback** — the field becomes tap/click-only. This is the actual fix for the bug class motivating this work; leaving a typable escape hatch would leave the door open to the same malformed-input bugs.
4. **Scope: all 9 fields**, including the 2 date+time shift fields (each becomes a date sub-field + a time sub-field, not a single combined text field).

## Component design

Two new shared components in `src/components/`:

### `DateField`

```ts
interface DateFieldProps {
  value: string | null; // 'YYYY-MM-DD', null = unset
  onChange: (value: string) => void;
  placeholder?: string; // shown when value is null, e.g. "Selecionar data"
  minimumDate?: Date;
  maximumDate?: Date;
}
```

- **Native** (`Platform.OS !== 'web'`): a `TouchableOpacity` trigger (visually consistent with `Select.tsx`'s existing `s.trigger` styling — surface background, border, `Radius.input`) showing the formatted value or the placeholder, plus a calendar icon. Tapping it sets a local `open` boolean to `true`, which conditionally mounts `<DateTimePicker value={...} mode="date" display="default" onChange={...} />` — on Android this immediately opens the OS date dialog; the `onChange` handler closes it (`setOpen(false)`) and, only when `event.type === 'set'`, calls the field's `onChange` with the picked date formatted as `YYYY-MM-DD`. A dismissed/cancelled picker (`event.type === 'dismissed'`) leaves the value untouched.
- **Web** (`Platform.OS === 'web'`): renders a native HTML `<input type="date" value={value ?? ''} onChange={...} min={...} max={...} />` directly (no trigger/modal layer needed — clicking the input opens the browser's own picker). Styled inline to fit the surrounding dark form as closely as an unstyleable native control allows (background, text color, border-radius via CSS, matching `Colors`/`Radius` token values where the browser lets a date input be styled at all).
- Both branches format/parse using a small `YYYY-MM-DD ⇄ Date` helper (reuse `isValidYMD`-style logic already in `src/utils/dateInput.ts` where useful, but a formatter is new — `parseFlexibleDateInput` itself becomes unnecessary once no field accepts free text; see "Code removed" below).

### `TimeField`

Same shape (`value: string | null` as `'HH:mm'`, same `onChange`/`placeholder` contract), same native/web split, `mode="time"` on the native picker and `<input type="time">` on web. Used only alongside `DateField` for the 2 shift timestamp fields (#8, #9) — combined into a single ISO datetime string at the call site when saving, the same way `displayToIso` does today, just fed by two already-structured values instead of parsing one free-text string.

## Rollout (9 call sites)

- **#1, #2** (`rentalStartDate`): straightforward `DateField` swap, output feeds the same `rental_contract_start_date` string field as today.
- **#3, #4** (`endsAt`): `DateField` with `value: string | null` (nullable, since ending a recurring expense is optional) swapped in directly.
- **#5, #6** (`expense_date`): `DateField` swap. `AddExpenseModal`'s fuel-category `filled_at` derivation (`new Date(trimmedDate + 'T12:00:00').toISOString()`) is unchanged — it just consumes the `DateField`'s already-valid `YYYY-MM-DD` output instead of a regex-checked free-text string.
- **#7** (`filled_at` in `FuelForm`): `DateField` swap, same noon-fixed-time derivation preserved.
- **#8, #9** (shift `started_at`/`ended_at`): each single text field becomes a `DateField` + `TimeField` pair, rendered side by side. The existing `displayToIso`/`isoToDisplay` pair (`shifts.tsx` lines ~183-197) is replaced by a straight `` `${dateValue}T${timeValue}:00` `` → `Date` → ISO construction (no regex parsing needed once both sub-values are already structurally valid).

## Code removed as dead weight

Once no field accepts free-text date input:
- `src/utils/dateInput.ts`'s `parseFlexibleDateInput` (and its test file `__tests__/utils/dateInput.test.ts`) — no remaining callers after #1-#4 are migrated.
- `shifts.tsx`'s local `displayToIso`/`isoToDisplay` functions and their `DD/MM/YYYY HH:mm` regex.
- `expenses.tsx`'s two strict `/^\d{4}-\d{2}-\d{2}$/` inline checks (in `ExpenseForm.handleSave` and `AddExpenseModal`'s save handler).
- `fuel.tsx`'s `FuelForm` inline date regex/fallback logic.

## Out of scope for this pass

- `src/components/ShiftWizard.tsx` — confirmed orphaned/unreachable, not touched.
- Any redesign of the visual theme of the native OS picker dialogs (not stylable beyond what the OS allows) or the web `<input type="date">` (browser-native chrome, limited styling surface).
- iOS-specific behavior — this app currently only ships Android + Web (per the existing AAB build pipeline); `@react-native-community/datetimepicker` supports iOS too, but its exact display mode there (`spinner`/`inline`/`compact`) is not being tuned as part of this pass.
