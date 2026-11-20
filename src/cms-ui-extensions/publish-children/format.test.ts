import {describe, expect, it} from 'vitest';

import {languageLabel, languageName, shortDate} from './format';

describe('languageName', () => {
  it('names a language in English, whatever the browser speaks', () => {
    expect(languageName('nl')).toBe('Dutch');
    expect(languageName('de')).toBe('German');
    expect(languageName('ja-JP')).toBe('Japanese (Japan)');
  });

  it('falls back to the code', () => {
    expect(languageName('xx')).toBe('xx');
    expect(languageName('')).toBe('');
    expect(languageName('not a code!')).toBe('not a code!');
  });
});

describe('languageLabel', () => {
  it('adds the code the CMS shows, inside any parentheses the name already has', () => {
    expect(languageLabel('nl')).toBe('Dutch (nl)');
    expect(languageLabel('ja-JP')).toBe('Japanese (Japan, ja-JP)');
    expect(languageLabel('xx')).toBe('xx');
  });
});

describe('shortDate', () => {
  const now = new Date('2026-11-11T12:00:00Z');

  it('is en-GB, leaving out the year only for this year', () => {
    expect(shortDate('2026-11-05T12:00:00Z', now)).toBe('5 Nov');
    expect(shortDate('2025-11-05T12:00:00Z', now)).toBe('5 Nov 2025');
  });

  it('is empty without a date', () => {
    expect(shortDate(null, now)).toBe('');
    expect(shortDate('not a date', now)).toBe('');
  });
});
