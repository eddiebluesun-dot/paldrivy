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
