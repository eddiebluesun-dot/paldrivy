import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Spacing } from '../theme';
import { getBiometricEnabled, promptBiometric } from '../hooks/useBiometric';

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const appState = useRef(AppState.currentState);
  const didCheckOnMount = useRef(false);

  const unlock = useCallback(async () => {
    const ok = await promptBiometric();
    if (ok) setLocked(false);
  }, []);

  useEffect(() => {
    async function checkOnLaunch() {
      if (didCheckOnMount.current) return;
      didCheckOnMount.current = true;
      const enabled = await getBiometricEnabled();
      if (enabled) {
        setLocked(true);
        const ok = await promptBiometric();
        if (ok) setLocked(false);
      }
    }
    checkOnLaunch();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async nextState => {
      const wasBackground = appState.current.match(/inactive|background/);
      appState.current = nextState;
      if (wasBackground && nextState === 'active') {
        const enabled = await getBiometricEnabled();
        if (enabled) {
          setLocked(true);
          const ok = await promptBiometric();
          if (ok) setLocked(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  if (!locked) return <>{children}</>;

  return (
    <View style={s.overlay}>
      <Ionicons name="lock-closed" size={56} color={Colors.accent} />
      <Text style={s.title}>PalDrivy</Text>
      <Text style={s.sub}>Aplicativo bloqueado</Text>
      <TouchableOpacity style={s.btn} onPress={unlock}>
        <Ionicons name="finger-print-outline" size={22} color={Colors.onAccent} />
        <Text style={s.btnText}>Desbloquear</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, zIndex: 9999,
  },
  title: { color: Colors.textPrimary, fontSize: 28, fontWeight: '900', marginTop: Spacing.md },
  sub: { color: Colors.textSecondary, fontSize: 15 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: Spacing.xl,
    backgroundColor: Colors.accent, paddingVertical: 16, paddingHorizontal: 32,
    borderRadius: 30,
  },
  btnText: { color: Colors.onAccent, fontSize: 16, fontWeight: '800' },
});
