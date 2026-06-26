import { Platform, View, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
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
  return (
    <View style={styles.wrap}>
      <Picker
        selectedValue={value}
        onValueChange={(v) => onValueChange(v as T)}
        dropdownIconColor={Colors.textSecondary}
        style={styles.picker}
      >
        {items.map((item) => (
          <Picker.Item
            key={item.value}
            label={item.label}
            value={item.value}
            color={Platform.OS === 'android' ? Colors.textPrimary : undefined}
          />
        ))}
      </Picker>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    overflow: 'hidden',
  },
  picker: {
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
});
