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
