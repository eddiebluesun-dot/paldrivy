import { test, expect, describe } from '@jest/globals';
import { normalizeConversationPair } from '../../src/utils/communityChat';

describe('normalizeConversationPair', () => {
  test('keeps already-sorted pair as-is', () => {
    expect(normalizeConversationPair('aaa', 'bbb')).toEqual({ user_a: 'aaa', user_b: 'bbb' });
  });
  test('swaps a reversed pair', () => {
    expect(normalizeConversationPair('bbb', 'aaa')).toEqual({ user_a: 'aaa', user_b: 'bbb' });
  });
  test('is idempotent regardless of call order', () => {
    const a = normalizeConversationPair('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
    const b = normalizeConversationPair('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
    expect(a).toEqual(b);
  });
});
