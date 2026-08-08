import { useEffect, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { registerTourTarget, unregisterTourTarget } from './tourRegistry';

export function TourTarget({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<View>(null);

  useEffect(() => {
    registerTourTarget(id, ref);
    return () => unregisterTourTarget(id);
  }, [id]);

  return <View ref={ref}>{children}</View>;
}
