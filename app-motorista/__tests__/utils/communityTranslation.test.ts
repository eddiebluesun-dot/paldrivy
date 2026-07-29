import { test, expect, describe } from '@jest/globals';
import { normalizeSupportedLang, pickTranslationTargetLang } from '../../src/utils/communityTranslation';

describe('normalizeSupportedLang', () => {
  test('maps en-US and en-GB to en', () => {
    expect(normalizeSupportedLang('en-US')).toBe('en');
    expect(normalizeSupportedLang('en-GB')).toBe('en');
  });
  test('maps es-419 to es', () => {
    expect(normalizeSupportedLang('es-419')).toBe('es');
  });
  test('unknown locale falls back to pt', () => {
    expect(normalizeSupportedLang('fr-FR')).toBe('pt');
  });
});

describe('pickTranslationTargetLang', () => {
  test('returns null when author and viewer share a language', () => {
    expect(pickTranslationTargetLang('pt-BR', 'pt-BR')).toBeNull();
  });
  test('returns the viewer language when it differs from the author', () => {
    expect(pickTranslationTargetLang('pt-BR', 'en-US')).toBe('en');
  });
});
