import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  DAILY_HOUR:    'notif_daily_hour',
  DAILY_MINUTE:  'notif_daily_minute',
  ENABLED:       'notif_enabled',
  WEEKDAYS:      'notif_weekdays',
  IN_APP_NOTIFS: 'paldrivy_in_app_notifs',
};

const DEFAULT_HOUR    = 6;
const DEFAULT_MINUTE  = 0;
// 2=Mon 3=Tue 4=Wed 5=Thu 6=Fri (Expo: 1=Sun … 7=Sat)
const DEFAULT_WEEKDAYS = [2, 3, 4, 5, 6];

// ─── Handler (must be called before any notification is displayed) ─────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
    shouldShowList:   true,
  }),
});

// ─── Permission ───────────────────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

export async function getDailyReminderTime(): Promise<{ hour: number; minute: number }> {
  const [h, m] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.DAILY_HOUR),
    AsyncStorage.getItem(STORAGE_KEYS.DAILY_MINUTE),
  ]);
  return {
    hour:   h != null ? parseInt(h, 10) : DEFAULT_HOUR,
    minute: m != null ? parseInt(m, 10) : DEFAULT_MINUTE,
  };
}

export async function saveDailyReminderTime(hour: number, minute: number): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEYS.DAILY_HOUR,   String(hour)),
    AsyncStorage.setItem(STORAGE_KEYS.DAILY_MINUTE, String(minute)),
  ]);
}

export async function getNotificationsEnabled(): Promise<boolean> {
  const val = await AsyncStorage.getItem(STORAGE_KEYS.ENABLED);
  return val !== 'false';
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.ENABLED, String(enabled));
}

export async function getNotifWeekdays(): Promise<number[]> {
  const val = await AsyncStorage.getItem(STORAGE_KEYS.WEEKDAYS);
  try { return val ? JSON.parse(val) : DEFAULT_WEEKDAYS; } catch { return DEFAULT_WEEKDAYS; }
}

export async function saveNotifWeekdays(days: number[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.WEEKDAYS, JSON.stringify(days));
}

// ─── In-app notifications ──────────────────────────────────────────────────────

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

export async function getInAppNotifications(): Promise<InAppNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.IN_APP_NOTIFS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function addInAppNotification(title: string, body: string): Promise<void> {
  try {
    const existing = await getInAppNotifications();
    const newNotif: InAppNotification = { id: Date.now().toString(), title, body, created_at: new Date().toISOString() };
    const updated = [newNotif, ...existing].slice(0, 50);
    await AsyncStorage.setItem(STORAGE_KEYS.IN_APP_NOTIFS, JSON.stringify(updated));
  } catch {}
}

export async function deleteInAppNotification(id: string): Promise<void> {
  try {
    const existing = await getInAppNotifications();
    await AsyncStorage.setItem(STORAGE_KEYS.IN_APP_NOTIFS, JSON.stringify(existing.filter(n => n.id !== id)));
  } catch {}
}

export async function clearInAppNotifications(): Promise<void> {
  try { await AsyncStorage.removeItem(STORAGE_KEYS.IN_APP_NOTIFS); } catch {}
}

// ─── Content per language ─────────────────────────────────────────────────────

type Lang = 'pt' | 'en' | 'en-GB' | 'es';

function normLang(lang: string): Lang {
  if (lang.startsWith('en-GB')) return 'en-GB';
  if (lang.startsWith('en'))    return 'en';
  if (lang.startsWith('es'))    return 'es';
  return 'pt';
}

const CONTENT = {
  daily: {
    pt:    { title: 'PalDrivy — Bom dia! 🌅', body: 'Boa sorte no turno de hoje. Registre tudo para acompanhar seus ganhos.' },
    en:    { title: 'PalDrivy — Good morning! 🌅', body: "Good luck on today's shift. Log everything to track your earnings." },
    'en-GB': { title: 'PalDrivy — Good morning! 🌅', body: "Good luck on today's shift. Log everything to track your earnings." },
    es:    { title: 'PalDrivy — ¡Buenos días! 🌅', body: 'Buena suerte en el turno de hoy. Registra todo para seguir tus ganancias.' },
  },
  weekly: {
    pt:    { title: 'PalDrivy — Resumo da semana 📊', body: 'Confira quanto você ganhou esta semana e planeje a próxima.' },
    en:    { title: 'PalDrivy — Weekly recap 📊',     body: 'Check how much you earned this week and plan the next.' },
    'en-GB': { title: 'PalDrivy — Weekly recap 📊',   body: 'Check how much you earned this week and plan the next.' },
    es:    { title: 'PalDrivy — Resumen semanal 📊',  body: 'Revisa cuánto ganaste esta semana y planifica la próxima.' },
  },
  monthly: {
    pt:    { title: 'PalDrivy — Novo mês, nova meta 🎯', body: 'Seu balanço do mês passado está pronto. Vamos bater a meta este mês?' },
    en:    { title: 'PalDrivy — New month, new goal 🎯', body: "Last month's summary is ready. Let's hit the goal this month!" },
    'en-GB': { title: 'PalDrivy — New month, new goal 🎯', body: "Last month's summary is ready. Let's hit the goal this month!" },
    es:    { title: 'PalDrivy — Nuevo mes, nueva meta 🎯', body: 'El balance del mes pasado está listo. ¿Vamos a superar la meta este mes?' },
  },
  goalReached: {
    pt:    { title: 'PalDrivy — Meta atingida! 🏆', body: 'Parabéns! Você atingiu sua meta mensal. Continue assim!' },
    en:    { title: 'PalDrivy — Goal reached! 🏆',  body: "Congratulations! You've hit your monthly goal. Keep it up!" },
    'en-GB': { title: 'PalDrivy — Goal reached! 🏆', body: "Congratulations! You've hit your monthly goal. Keep it up!" },
    es:    { title: 'PalDrivy — ¡Meta alcanzada! 🏆', body: '¡Felicitaciones! Alcanzaste tu meta mensual. ¡Sigue así!' },
  },
  rentalNearLimit: {
    pt:    { title: 'PalDrivy — Franquia de km quase no limite ⚠️', body: 'Você já usou 90% da franquia de km do seu veículo alugado neste período.' },
    en:    { title: 'PalDrivy — Km allowance almost used up ⚠️',    body: "You've used 90% of your rental vehicle's km allowance for this period." },
    'en-GB': { title: 'PalDrivy — Mileage allowance almost used up ⚠️', body: "You've used 90% of your rental vehicle's mileage allowance for this period." },
    es:    { title: 'PalDrivy — Franquicia de km casi al límite ⚠️', body: 'Ya usaste el 90% de la franquicia de km de tu vehículo alquilado en este período.' },
  },
};

// ─── Schedule helpers ─────────────────────────────────────────────────────────

async function cancelByIdentifier(id: string) {
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
}

// ─── Public schedule functions ────────────────────────────────────────────────

export async function scheduleDailyReminder(lang: string): Promise<void> {
  // Cancel all possible per-weekday identifiers + old single identifier
  await cancelByIdentifier('daily-reminder');
  for (let d = 1; d <= 7; d++) await cancelByIdentifier(`daily-reminder-${d}`);

  const enabled = await getNotificationsEnabled();
  if (!enabled || !(await getNotificationPermission())) return;

  const { hour, minute } = await getDailyReminderTime();
  const weekdays = await getNotifWeekdays();
  const l = normLang(lang);
  const { title, body } = CONTENT.daily[l];

  for (const weekday of weekdays) {
    await Notifications.scheduleNotificationAsync({
      identifier: `daily-reminder-${weekday}`,
      content: { title, body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour,
        minute,
      },
    });
  }
}

export async function scheduleWeeklySummary(lang: string): Promise<void> {
  await cancelByIdentifier('weekly-summary');
  const enabled = await getNotificationsEnabled();
  if (!enabled || !(await getNotificationPermission())) return;

  const l = normLang(lang);
  const { title, body } = CONTENT.weekly[l];

  await Notifications.scheduleNotificationAsync({
    identifier: 'weekly-summary',
    content: { title, body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1, // Sunday = 1
      hour: 9,
      minute: 0,
    },
  });
}

export async function scheduleMonthlySummary(lang: string): Promise<void> {
  await cancelByIdentifier('monthly-summary');
  const enabled = await getNotificationsEnabled();
  if (!enabled || !(await getNotificationPermission())) return;

  const l = normLang(lang);
  const { title, body } = CONTENT.monthly[l];

  await Notifications.scheduleNotificationAsync({
    identifier: 'monthly-summary',
    content: { title, body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 30 * 24 * 60 * 60,
      repeats: true,
    },
  });
}

export async function fireGoalReachedNotification(lang: string): Promise<void> {
  if (!(await getNotificationPermission())) return;
  const l = normLang(lang);
  const { title, body } = CONTENT.goalReached[l];

  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

// Fires once per rental allowance period when usage first crosses 90% --
// periodStartIso (the period's own start date, e.g. "2026-08-05") keys the
// "already notified" flag, so a fresh period (new week/month) is free to
// notify again, but re-computing status on every dashboard load within the
// SAME period doesn't spam the driver with a duplicate notification every
// time they open the app.
export async function fireRentalAllowanceNearLimitNotification(lang: string, periodStartIso: string): Promise<void> {
  const key = `notif_rental_near_limit_${periodStartIso}`;
  if (await AsyncStorage.getItem(key)) return;
  await AsyncStorage.setItem(key, 'true');

  if (!(await getNotificationPermission())) return;
  const l = normLang(lang);
  const { title, body } = CONTENT.rentalNearLimit[l];

  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

// ─── Schedule all (called after login / lang change) ──────────────────────────

export async function scheduleAllNotifications(lang: string): Promise<void> {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await Promise.all([
    scheduleDailyReminder(lang),
    scheduleWeeklySummary(lang),
    scheduleMonthlySummary(lang),
  ]);
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const token = await Notifications.getExpoPushTokenAsync();
    await supabase.from('profiles').update({ push_token: token.data }).eq('id', userId);
  } catch {}
}
