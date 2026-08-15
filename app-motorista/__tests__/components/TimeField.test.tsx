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
