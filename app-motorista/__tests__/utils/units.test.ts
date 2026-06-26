import { test, expect } from '@jest/globals';
import { metersToDisplay, mlToDisplay, displayToMeters, displayToMl } from '../../src/utils/units';

test('km display', () => {
  expect(metersToDisplay(176000, 'km')).toBeCloseTo(176, 1);
});
test('mi display', () => {
  expect(metersToDisplay(1609, 'mi')).toBeCloseTo(1, 1);
});
test('liters display', () => {
  expect(mlToDisplay(45000, 'liters')).toBeCloseTo(45, 1);
});
test('displayToMeters km', () => {
  expect(displayToMeters(176, 'km')).toBe(176000);
});
