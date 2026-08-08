import { authSignUp } from '../hooks/useAuth';
import { upsertProfile, markOnboardingDone } from './profile';
import { createVehicle } from './vehicles';
import { saveUserPlatforms } from './platforms';
import { recordConsents } from './legal';
import { supabase } from '../lib/supabase';
import type { Profile, Vehicle } from '../types';
import type { LegalDoc } from './legal';

export type RegistrationStep = 'account' | 'profile' | 'vehicle' | 'platforms' | 'goal' | 'consent' | 'finish';

export interface RegistrationInput {
  email: string;
  password: string;
  profile: Pick<Profile, 'name' | 'phone' | 'city' | 'state' | 'country' | 'locale' | 'currency_code' | 'distance_unit' | 'volume_unit' | 'timezone' | 'worker_type'>;
  vehicle: Omit<Vehicle, 'id' | 'user_id' | 'created_at' | 'name'>;
  platforms: string[];
  monthlyGoalCents: number | null;
  legalDocs: LegalDoc[];
}

export type RegistrationResult =
  | { status: 'success' }
  | { status: 'account_creation_failed'; message: string }
  | { status: 'partial_failure'; userId: string; failedStep: RegistrationStep; message: string };

const STEP_ORDER: RegistrationStep[] = ['account', 'profile', 'vehicle', 'platforms', 'goal', 'consent', 'finish'];

export async function completeRegistration(
  input: RegistrationInput,
  resume?: { resumeUserId: string; resumeFromStep: RegistrationStep },
): Promise<RegistrationResult> {
  let userId = resume?.resumeUserId ?? null;
  const startIndex = resume ? STEP_ORDER.indexOf(resume.resumeFromStep) : 0;

  // Tracks which step is currently in flight so the catch block can report
  // exactly the step that failed, instead of guessing. Updated right before
  // each step's call — if that call throws, `currentStep` still holds the
  // name of the step that was executing.
  let currentStep: RegistrationStep = 'account';

  try {
    if (startIndex <= STEP_ORDER.indexOf('account')) {
      currentStep = 'account';
      const { data, error } = await authSignUp(input.email, input.password);
      if (error || !data.user) {
        return { status: 'account_creation_failed', message: error?.message ?? 'Sign-up failed' };
      }
      // No session means this Supabase project still has "Confirm email" on, so
      // every subsequent step would fail on RLS. Stop here with a clear message
      // instead of letting the driver loop on an unresumable partial_failure.
      // Reported as `account_creation_failed` on purpose: nothing downstream was
      // created, so there is nothing to resume — the screen renders it as an
      // inline, retry-safe error.
      if (!data.session) {
        return {
          status: 'account_creation_failed',
          message: 'Confirme seu e-mail para continuar (verifique sua caixa de entrada).',
        };
      }
      userId = data.user.id;
    }
    if (!userId) throw new Error('completeRegistration: missing userId after account step');

    if (startIndex <= STEP_ORDER.indexOf('profile')) {
      currentStep = 'profile';
      await upsertProfile({ id: userId, ...input.profile, onboarding_done: false });
    }
    if (startIndex <= STEP_ORDER.indexOf('vehicle')) {
      currentStep = 'vehicle';
      await createVehicle({ ...input.vehicle, user_id: userId, name: `${input.vehicle.brand} ${input.vehicle.model}` });
    }
    if (startIndex <= STEP_ORDER.indexOf('platforms') && input.platforms.length > 0) {
      currentStep = 'platforms';
      await saveUserPlatforms(userId, input.platforms);
    }
    if (startIndex <= STEP_ORDER.indexOf('goal') && input.monthlyGoalCents != null && input.monthlyGoalCents > 0) {
      currentStep = 'goal';
      const { error } = await supabase.from('goals').insert({
        user_id: userId, type: 'monthly',
        target_amount_cents: input.monthlyGoalCents,
        starts_at: new Date().toISOString().split('T')[0],
      });
      if (error) throw error;
    }
    if (startIndex <= STEP_ORDER.indexOf('consent') && input.legalDocs.length > 0) {
      currentStep = 'consent';
      await recordConsents(input.legalDocs);
    }
    currentStep = 'finish';
    await markOnboardingDone(userId);
    return { status: 'success' };
  } catch (err) {
    if (!userId) return { status: 'account_creation_failed', message: (err as Error).message };
    return { status: 'partial_failure', userId, failedStep: currentStep, message: (err as Error).message };
  }
}
