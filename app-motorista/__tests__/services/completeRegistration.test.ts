import { completeRegistration } from '@/src/services/completeRegistration';
import { authSignUp } from '@/src/hooks/useAuth';
import { upsertProfile, markOnboardingDone } from '@/src/services/profile';
import { createVehicle, syncVehicleRecurringCost } from '@/src/services/vehicles';
import { saveUserPlatforms } from '@/src/services/platforms';
import { recordConsents } from '@/src/services/legal';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/hooks/useAuth', () => ({ authSignUp: jest.fn() }));
jest.mock('@/src/services/profile', () => ({ upsertProfile: jest.fn(), markOnboardingDone: jest.fn() }));
jest.mock('@/src/services/vehicles', () => ({ createVehicle: jest.fn(), syncVehicleRecurringCost: jest.fn() }));
jest.mock('@/src/services/platforms', () => ({ saveUserPlatforms: jest.fn() }));
jest.mock('@/src/services/legal', () => ({ recordConsents: jest.fn() }));
jest.mock('@/src/lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: null }) })) } }));

const baseInput = {
  email: 'driver@example.com', password: 'senha123',
  profile: { name: 'Driver', phone: '+5511999999999', city: 'São Paulo', state: 'SP', country: 'BR', locale: 'pt-BR', currency_code: 'BRL', distance_unit: 'km' as const, volume_unit: 'liters' as const, timezone: 'America/Sao_Paulo', worker_type: 'driver' as const },
  vehicle: { brand: 'Renault', model: 'Kwid', year: 2026, fuel_type: 'ethanol' as const, avg_consumption_per_100: 1100, ownership_type: 'own' as const, monthly_cost_cents: 0, monthly_insurance_cents: 0, current_odometer: 0, is_taxi: false, taxi_license_monthly_cents: 0 },
  platforms: ['Uber'],
  monthlyGoalCents: 800000,
  legalDocs: [{ id: 'doc-1', type: 'privacy_policy' as const, version: '1', title: 'Privacidade', content: '...' }],
};

beforeEach(() => jest.clearAllMocks());

describe('completeRegistration', () => {
  it('runs every step in order and returns success', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });

    const result = await completeRegistration(baseInput);

    expect(result.status).toBe('success');
    expect(authSignUp).toHaveBeenCalledWith('driver@example.com', 'senha123');
    expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', name: 'Driver' }));
    expect(createVehicle).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', brand: 'Renault' }));
    expect(saveUserPlatforms).toHaveBeenCalledWith('u1', ['Uber']);
    expect(recordConsents).toHaveBeenCalledWith(baseInput.legalDocs);
    expect(markOnboardingDone).toHaveBeenCalledWith('u1');
  });

  it('skips the platforms save when none were selected', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });
    await completeRegistration({ ...baseInput, platforms: [] });
    expect(saveUserPlatforms).not.toHaveBeenCalled();
  });

  it('skips the goal insert when no amount was entered', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });
    await completeRegistration({ ...baseInput, monthlyGoalCents: null });
    expect(supabase.from).not.toHaveBeenCalledWith('goals');
  });

  it('returns an account-creation failure without attempting any later step', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Email already registered' } });
    const result = await completeRegistration(baseInput);
    expect(result.status).toBe('account_creation_failed');
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('stops with an account-creation failure when sign-up returns a user but no session (email confirmation still required)', async () => {
    // Supabase returns user-without-session when the project's "Confirm email"
    // setting is on. Every later step would then fail on RLS, so this must not
    // become an unresumable partial_failure loop.
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });

    const result = await completeRegistration(baseInput);

    expect(result.status).toBe('account_creation_failed');
    expect(upsertProfile).not.toHaveBeenCalled();
    expect(createVehicle).not.toHaveBeenCalled();
    expect(markOnboardingDone).not.toHaveBeenCalled();
  });

  it('returns a resumable partial-failure result identifying the failed step and the created user id, without retrying automatically', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (upsertProfile as jest.Mock).mockRejectedValue(new Error('network'));

    const result = await completeRegistration(baseInput);

    expect(result.status).toBe('partial_failure');
    if (result.status === 'partial_failure') {
      expect(result.userId).toBe('u1');
      expect(result.failedStep).toBe('profile');
    }
    // later steps never attempted after the first failure
    expect(createVehicle).not.toHaveBeenCalled();
  });

  it('resumes from a given step on retry, skipping already-completed steps', async () => {
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });
    // resuming after a profile failure: userId already known, don't call authSignUp/upsertProfile again
    const result = await completeRegistration(baseInput, { resumeUserId: 'u1', resumeFromStep: 'vehicle' });
    expect(authSignUp).not.toHaveBeenCalled();
    expect(upsertProfile).not.toHaveBeenCalled();
    expect(createVehicle).toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('returns a resumable partial-failure result identifying the vehicle step when vehicle creation fails, proving failedStep discriminates between steps', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    // A prior test in this suite leaves upsertProfile rejecting via
    // mockRejectedValue, which jest.clearAllMocks() in beforeEach does not
    // undo (it clears call history, not implementations) — re-arm it here
    // so this test genuinely isolates the vehicle step's failure.
    (upsertProfile as jest.Mock).mockResolvedValue(undefined);
    (createVehicle as jest.Mock).mockRejectedValue(new Error('vehicle insert failed'));

    const result = await completeRegistration(baseInput);

    expect(result.status).toBe('partial_failure');
    if (result.status === 'partial_failure') {
      expect(result.userId).toBe('u1');
      expect(result.failedStep).toBe('vehicle');
    }
    // profile step did complete before vehicle failed
    expect(upsertProfile).toHaveBeenCalled();
    // steps after vehicle never attempted
    expect(saveUserPlatforms).not.toHaveBeenCalled();
    expect(recordConsents).not.toHaveBeenCalled();
    expect(markOnboardingDone).not.toHaveBeenCalled();
  });

  it('syncs the vehicle recurring cost after creating the vehicle, using the chosen rental frequency', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });

    const rentInput = {
      ...baseInput,
      vehicle: { ...baseInput.vehicle, ownership_type: 'rent' as const, monthly_cost_cents: 80431, rentalCostFrequency: 'weekly' as const },
    };

    const result = await completeRegistration(rentInput);

    expect(result.status).toBe('success');
    expect(syncVehicleRecurringCost).toHaveBeenCalledWith({
      vehicleId: 'v1',
      userId: 'u1',
      ownershipType: 'rent',
      amountCents: 80431,
      frequency: 'weekly',
    });
  });

  it('defaults the recurring cost frequency to monthly when rentalCostFrequency is not provided', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    (createVehicle as jest.Mock).mockResolvedValue({ id: 'v1' });

    await completeRegistration(baseInput); // baseInput.vehicle has no rentalCostFrequency, ownership_type: 'own'

    expect(syncVehicleRecurringCost).toHaveBeenCalledWith({
      vehicleId: 'v1',
      userId: 'u1',
      ownershipType: 'own',
      amountCents: 0,
      frequency: 'monthly',
    });
  });
});
