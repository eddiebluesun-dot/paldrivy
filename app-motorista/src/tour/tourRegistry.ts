import type { RefObject } from 'react';
import type { View } from 'react-native';

// Module-level Map, not React state: target components register/unregister
// as they mount/unmount across whichever screen currently hosts them, and
// TourOverlay (living at the tab-layout level) looks them up by id without
// needing a shared ancestor or prop-drilling refs across the tab tree.
const registry = new Map<string, RefObject<View>>();

export function registerTourTarget(id: string, ref: RefObject<View>): void {
  registry.set(id, ref);
}

export function unregisterTourTarget(id: string): void {
  registry.delete(id);
}

export function getTourTarget(id: string): RefObject<View> | undefined {
  return registry.get(id);
}
