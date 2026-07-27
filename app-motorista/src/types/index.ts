export type DistanceUnit = 'km' | 'mi';
export type VolumeUnit = 'liters' | 'gallons';
export type FuelType = 'gasoline' | 'ethanol' | 'diesel' | 'gnv' | 'electric' | 'hybrid';
export type OwnershipType = 'own' | 'rent' | 'financed';
export type PlatformType = 'rideshare' | 'taxi_app' | 'taxi_conventional' | 'delivery';
export type WorkerType = 'driver' | 'motoboy';
export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export type GoalType = 'bruto' | 'liquido';

export interface Profile {
  id: string;
  name: string;
  phone?: string | null;
  country: string;
  city?: string | null;
  state?: string | null;
  currency_code: string;
  distance_unit: DistanceUnit;
  volume_unit: VolumeUnit;
  timezone: string;
  locale: string;
  onboarding_done: boolean;
  vehicle_id?: string | null;
  worker_type?: WorkerType;
  goal_type?: GoalType;
  role?: string;
  push_token?: string | null;
  created_at: string;
}

export interface Vehicle {
  id: string;
  user_id: string;
  name: string;
  brand: string;
  model: string;
  year: number;
  plate?: string;
  fuel_type: FuelType;
  avg_consumption_per_100: number;
  ownership_type: OwnershipType;
  monthly_cost_cents: number;
  monthly_insurance_cents: number;
  current_odometer: number;
  purchase_price_cents?: number;
  purchase_date?: string;
  target_swap_years?: number;
  target_swap_budget_cents?: number;
  is_taxi: boolean;
  taxi_license_monthly_cents: number;
  created_at: string;
}

export interface ShiftCalc {
  duration_hours: number;
  distance_meters: number;
  gross_cents: number;
  fuel_cost_cents: number;
  allocated_fixed_cents: number;
  net_cents: number;
  net_per_hour_cents: number;
  net_per_meter_cents: number;
}

export interface ShiftPlatform {
  platform_name: string;
  amount_cents: number;
}

export type MoodRating = 'good' | 'ok' | 'bad';

export interface EndShiftData {
  odometer_start_meters?: number | null;
  odometer_end_meters: number | null;
  platforms: ShiftPlatform[];
  tolls_cents: number;
  parking_cents: number;
  food_cents: number;
  tips_cents: number;
  bonuses_cents: number;
  rides_count: number | null;
  mood_rating?: MoodRating | null;
  notes?: string | null;
}

export interface ShiftPause {
  started_at: string;
  ended_at: string | null;
}

export interface Shift {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  started_at: string;
  ended_at?: string | null;
  odometer_start_meters?: number | null;
  odometer_end_meters?: number | null;
  platforms?: ShiftPlatform[] | null;
  tips_cents: number;
  bonuses_cents: number;
  tolls_cents: number;
  parking_cents: number;
  food_cents: number;
  gross_cents?: number | null;
  net_cents?: number | null;
  duration_seconds?: number | null;
  rides_count?: number | null;
  pauses?: ShiftPause[];
  region?: string;
  mood_rating?: MoodRating | null;
  notes?: string | null;
  calc?: ShiftCalc;
  created_at: string;
}

export interface FuelEntry {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  filled_at: string;
  odometer_meters: number | null;
  fuel_type: FuelType;
  volume_ml: number;
  total_cost_cents: number;
  price_per_unit_cents: number;
  station: string | null;
  full_tank: boolean;
  notes?: string;
}

export interface Expense {
  id: string;
  user_id: string;
  vehicle_id?: string;
  category: string;
  expense_date: string;
  amount_cents: number;
  description?: string;
  recurring: boolean;
  recurring_frequency?: RecurringFrequency | null;
}

export interface Goal {
  id: string;
  user_id: string;
  type: 'daily' | 'weekly' | 'monthly' | 'per_hour' | 'per_km';
  target_amount_cents: number;
  starts_at: string;
  ends_at?: string;
}
