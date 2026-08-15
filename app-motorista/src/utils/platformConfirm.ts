import { Alert, Platform } from 'react-native';

// Alert.alert has no implementation on react-native-web -- it renders
// nothing and its callbacks (including the destructive/confirm button's
// onPress) never fire. Any delete/discard flow gated behind a bare
// Alert.alert() call therefore silently does nothing on the web build.
//
// Confirmed in production: the trash-icon "excluir" button on the
// Despesas screen (app.paldrivy.com, web) did not respond to taps at
// all -- expenses.tsx's handleDelete called Alert.alert directly with
// no web fallback.
//
// This is not a new problem in this codebase: app/(tabs)/shifts.tsx and
// src/components/community/PostCard.tsx already hit the same bug and
// fixed it the same way (Platform.OS === 'web' -> window.confirm).
// This extracts that pattern into one place so it can be unit tested.
export function platformConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  options?: { cancelText?: string; confirmText?: string }
): void {
  const cancelText = options?.cancelText ?? 'Cancelar';
  const confirmText = options?.confirmText ?? 'Confirmar';

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}
