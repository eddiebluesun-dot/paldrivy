import { registerTourTarget, unregisterTourTarget, getTourTarget } from '@/src/tour/tourRegistry';
import { createRef } from 'react';
import { View } from 'react-native';

describe('tourRegistry', () => {
  afterEach(() => unregisterTourTarget('test-id'));

  it('returns undefined for an unregistered id', () => {
    expect(getTourTarget('nope')).toBeUndefined();
  });

  it('returns the registered ref', () => {
    const ref = createRef<View>();
    registerTourTarget('test-id', ref);
    expect(getTourTarget('test-id')).toBe(ref);
  });

  it('removes the ref on unregister', () => {
    const ref = createRef<View>();
    registerTourTarget('test-id', ref);
    unregisterTourTarget('test-id');
    expect(getTourTarget('test-id')).toBeUndefined();
  });
});
