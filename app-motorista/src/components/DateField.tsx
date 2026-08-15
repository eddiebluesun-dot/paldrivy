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
