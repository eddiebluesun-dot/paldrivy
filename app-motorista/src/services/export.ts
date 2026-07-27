import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';

function csvEscape(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

export async function exportShiftsCSV(userId: string, currencyCode: string): Promise<void> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('user_id', userId)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false });

  if (error) throw error;

  const headers = [
    'Data', 'Início', 'Fim', 'Duração (h)',
    `Bruto (${currencyCode})`, `Líquido (${currencyCode})`,
    'KM rodados', 'Plataformas', 'Corridas',
    `Combustível (${currencyCode})`, `Alimentação (${currencyCode})`,
    'Humor', 'Notas',
  ];

  const rows = (data ?? []).map((s: any) => {
    const start = new Date(s.started_at);
    const end   = s.ended_at ? new Date(s.ended_at) : null;
    const km = s.odometer_start_meters != null && s.odometer_end_meters != null
      ? ((s.odometer_end_meters - s.odometer_start_meters) / 1000).toFixed(1)
      : '';
    const platforms = (s.platforms ?? [])
      .map((p: any) => `${p.platform_name}:${(p.amount_cents / 100).toFixed(2)}`)
      .join(';');

    return [
      start.toLocaleDateString('pt-BR'),
      start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      end ? end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
      s.duration_seconds != null ? (s.duration_seconds / 3600).toFixed(2) : '',
      ((s.gross_cents ?? 0) / 100).toFixed(2),
      ((s.net_cents ?? 0) / 100).toFixed(2),
      km,
      platforms,
      s.rides_count ?? '',
      ((s.tolls_cents ?? 0) / 100).toFixed(2),
      ((s.food_cents ?? 0) / 100).toFixed(2),
      s.mood_rating ?? '',
      s.notes ?? '',
    ].map(csvEscape).join(',');
  });

  const csv = '﻿' + [headers.map(csvEscape).join(','), ...rows].join('\r\n');
  const path = `${FileSystem.cacheDirectory}paldrivy_turnos_${Date.now()}.csv`;
  await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Exportar Turnos CSV' });
}

export async function exportLGPDJson(userId: string): Promise<void> {
  const [shiftsR, profileR, vehiclesR, expensesR, fuelR] = await Promise.all([
    supabase.from('shifts').select('*').eq('user_id', userId),
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('vehicles').select('*').eq('user_id', userId),
    supabase.from('expenses').select('*').eq('user_id', userId),
    supabase.from('fuel_entries').select('*').eq('user_id', userId),
  ]);

  const bundle = {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile: profileR.data,
    shifts: shiftsR.data ?? [],
    vehicles: vehiclesR.data ?? [],
    expenses: expensesR.data ?? [],
    fuel_entries: fuelR.data ?? [],
  };

  const path = `${FileSystem.cacheDirectory}paldrivy_meus_dados_${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(bundle, null, 2));
  await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Baixar meus dados (LGPD)' });
}
