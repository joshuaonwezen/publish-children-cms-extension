import {describe, expect, it} from 'vitest';

import {PUBLISH_BATCH_SIZE} from '../../shared/constants';
import {contentKey, isAction, locale, PARSERS} from './validate';

const KEY = '0f8e2d6c4b1a49e7a3c5d7f9b2e4c6a8';
const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('contentKey', () => {
  it('accepts the dashed, upper-case form the editor can report', () => {
    expect(contentKey('0F8E2D6C-4b1a-49e7-a3c5-d7f9b2e4c6a8')).toBe(KEY);
    expect(contentKey(` ${KEY} `)).toBe(KEY);
  });

  it('rejects anything that is not a content key before it reaches a CMS URL', () => {
    expect(() => contentKey('../../v1/contenttypes')).toThrow(/content key/);
    expect(() => contentKey(`${KEY}/versions`)).toThrow(/content key/);
    expect(() => contentKey('a'.repeat(65))).toThrow(/at most 64/);
    expect(() => contentKey(42)).toThrow(/expected text/);
    expect(() => contentKey(undefined)).toThrow(/required/);
  });
});

describe('locale', () => {
  it('takes plain and region languages', () => {
    expect(locale('en')).toBe('en');
    expect(locale('ja-JP')).toBe('ja-JP');
  });

  it('rejects anything else', () => {
    expect(() => locale('en/../x')).toThrow(/language code/);
    expect(() => locale('')).toThrow(/required/);
  });
});

describe('PARSERS', () => {
  it('lists children from page 0 by default and drops unknown fields', () => {
    expect(PARSERS.listChildren({key: KEY, locale: 'nl', extra: 1})).toEqual({key: KEY, locale: 'nl', pageIndex: 0});
    expect(PARSERS.listChildren({key: KEY, locale: 'nl', pageIndex: 2})).toEqual({key: KEY, locale: 'nl', pageIndex: 2});
    expect(() => PARSERS.listChildren({key: KEY, locale: 'nl', pageIndex: -1})).toThrow(/pageIndex/);
    expect(() => PARSERS.listChildren({key: KEY, locale: 'nl', pageIndex: 1.5})).toThrow(/pageIndex/);
  });

  it('checks every publish pick', () => {
    expect(PARSERS.publish({parentKey: KEY, locale: 'en', items: [{key: OTHER.toUpperCase(), version: '42', extra: true}]})).toEqual({
      parentKey: KEY,
      locale: 'en',
      items: [{key: OTHER, version: '42'}],
    });
    expect(() => PARSERS.publish({parentKey: KEY, locale: 'en', items: []})).toThrow(/at least one/);
    expect(() => PARSERS.publish({parentKey: KEY, locale: 'en', items: [{key: OTHER, version: '4/2'}]})).toThrow(/version number/);
    expect(() =>
      PARSERS.publish({
        parentKey: KEY,
        locale: 'en',
        items: [
          {key: OTHER, version: '1'},
          {key: OTHER, version: '2'},
        ],
      }),
    ).toThrow(/twice/);
  });

  it(`takes at most ${PUBLISH_BATCH_SIZE} items per call`, () => {
    const items = Array.from({length: PUBLISH_BATCH_SIZE + 1}, (_, i) => ({key: i.toString(16).padStart(32, '0'), version: '1'}));
    expect(() => PARSERS.publish({parentKey: KEY, locale: 'en', items})).toThrow(/at most/);
  });

  it('knows its two actions and nothing inherited from Object', () => {
    expect(isAction('listChildren')).toBe(true);
    expect(isAction('publish')).toBe(true);
    expect(isAction('toString')).toBe(false);
  });
});
