import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Select } from '../../src/components/Select';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { createVehicle } from '../../src/services/vehicles';
import { decimalToCents } from '../../src/utils/currency';
import { displayToMeters } from '../../src/utils/units';
import { Colors, Radius, Spacing } from '../../src/theme';
import type { FuelType, OwnershipType } from '../../src/types';

export default function VehicleScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2020');
  const [fuelType, setFuelType] = useState<FuelType>('gasoline');
  const [consumption, setConsumption] = useState('12');
  const [ownership, setOwnership] = useState<OwnershipType>('own');
  const [monthlyCost, setMonthlyCost] = useState('0');
  const [insurance, setInsurance] = useState('0');
  const [isTaxi, setIsTaxi] = useState(false);
  const [taxiLicense, setTaxiLicense] = useState('0');
  const [odometer, setOdometer] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    if (!brand.trim() || !model.trim()) {
      setError(t('common.required'));
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError(t('common.error'));
        return;
      }
      const kmPerLiter = parseFloat(consumption) || 1;
      const mlPer100km = Math.round((100 / kmPerLiter) * 1000);
      await createVehicle({
        user_id: data.user.id,
        name: `${brand.trim()} ${model.trim()}`,
        brand: brand.trim(),
        model: model.trim(),
        year: parseInt(year, 10) || new Date().getFullYear(),
        fuel_type: fuelType,
        avg_consumption_per_100: mlPer100km,
        ownership_type: ownership,
        monthly_cost_cents: decimalToCents(parseFloat(monthlyCost) || 0),
        monthly_insurance_cents: decimalToCents(parseFloat(insurance) || 0),
        current_odometer: displayToMeters(parseFloat(odometer) || 0, 'km'),
        is_taxi: isTaxi,
        taxi_license_monthly_cents: isTaxi ? decimalToCents(parseFloat(taxiLicense) || 0) : 0,
      });
      router.push('/onboarding/goal');
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{t('onboarding.vehicle_title')}</Text>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <Text style={s.label}>{t('onboarding.brand')}</Text>
        <TextInput
          style={s.input}
          value={brand}
          onChangeText={setBrand}
          autoCapitalize="words"
          placeholderTextColor={Colors.textSecondary}
          placeholder={t('onboarding.brand')}
          accessibilityLabel={t('onboarding.brand')}
        />

        <Text style={s.label}>{t('onboarding.model')}</Text>
        <TextInput
          style={s.input}
          value={model}
          onChangeText={setModel}
          autoCapitalize="words"
          placeholderTextColor={Colors.textSecondary}
          placeholder={t('onboarding.model')}
          accessibilityLabel={t('onboarding.model')}
        />

        <Text style={s.label}>{t('onboarding.year')}</Text>
        <TextInput
          style={s.input}
          value={year}
          onChangeText={setYear}
          keyboardType="numeric"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel={t('onboarding.year')}
        />

        <Text style={s.label}>{t('onboarding.fuel_type')}</Text>
        <Select
          value={fuelType}
          onValueChange={(v) => setFuelType(v as FuelType)}
          items={[
            { label: t('onboarding.fuel_gasoline'), value: 'gasoline' },
            { label: t('onboarding.fuel_ethanol'), value: 'ethanol' },
            { label: t('onboarding.fuel_diesel'), value: 'diesel' },
            { label: t('onboarding.fuel_gnv'), value: 'gnv' },
            { label: t('onboarding.fuel_electric'), value: 'electric' },
            { label: t('onboarding.fuel_hybrid'), value: 'hybrid' },
          ]}
        />

        <Text style={s.label}>{t('onboarding.consumption')}</Text>
        <TextInput
          style={s.input}
          value={consumption}
          onChangeText={setConsumption}
          keyboardType="decimal-pad"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel={t('onboarding.consumption')}
        />

        <Text style={s.label}>{t('onboarding.ownership')}</Text>
        <Select
          value={ownership}
          onValueChange={(v) => setOwnership(v as OwnershipType)}
          items={[
            { label: t('onboarding.ownership_own'), value: 'own' },
            { label: t('onboarding.ownership_rent'), value: 'rent' },
            { label: t('onboarding.ownership_financed'), value: 'financed' },
          ]}
        />

        <Text style={s.label}>{t('onboarding.monthly_cost')}</Text>
        <TextInput
          style={s.input}
          value={monthlyCost}
          onChangeText={setMonthlyCost}
          keyboardType="decimal-pad"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel={t('onboarding.monthly_cost')}
        />

        <Text style={s.label}>{t('onboarding.insurance')}</Text>
        <TextInput
          style={s.input}
          value={insurance}
          onChangeText={setInsurance}
          keyboardType="decimal-pad"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel={t('onboarding.insurance')}
        />

        <Text style={s.label}>{t('onboarding.odometer_current')}</Text>
        <TextInput
          style={s.input}
          value={odometer}
          onChangeText={setOdometer}
          keyboardType="numeric"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel={t('onboarding.odometer_current')}
        />

        <View style={s.row}>
          <Text style={s.label}>{t('onboarding.is_taxi')}</Text>
          <Switch
            value={isTaxi}
            onValueChange={setIsTaxi}
            trackColor={{ false: Colors.border, true: Colors.brandBlue }}
            thumbColor={Colors.onBrand}
          />
        </View>

        {isTaxi ? (
          <>
            <Text style={s.label}>{t('onboarding.taxi_license')}</Text>
            <TextInput
              style={s.input}
              value={taxiLicense}
              onChangeText={setTaxiLicense}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel={t('onboarding.taxi_license')}
            />
          </>
        ) : null}

        <TouchableOpacity
          style={[s.button, loading && s.buttonDisabled]}
          onPress={handleSave}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.next')}
        >
          {loading ? (
            <ActivityIndicator color={Colors.onBrand} />
          ) : (
            <Text style={s.buttonText}>{t('onboarding.next')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xl,
  },
  label: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    fontSize: 16,
    color: Colors.textPrimary,
    minHeight: 48,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  error: {
    color: Colors.error,
    fontSize: 14,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceAlt,
    padding: Spacing.sm,
    borderRadius: Radius.input,
  },
  button: {
    backgroundColor: Colors.brandBlue,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: Colors.onBrand,
    fontSize: 16,
    fontWeight: '600',
  },
});
