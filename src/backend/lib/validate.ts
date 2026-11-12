import {PUBLISH_BATCH_SIZE} from '../../shared/constants';
import type {ActionName, ActionParams, PublishPick} from '../../shared/types';
import {ActionError} from './errors';

// Content keys, languages and versions end up in CMS REST URL paths, so they are checked
// against an allow-list here, before any handler runs.

const CONTENT_KEY = /^[0-9a-f]{32}$/;
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;
const VERSION = /^\d{1,12}$/;
const MAX_PAGE_INDEX = 999;

function invalid(field: string, why: string): never {
  throw new ActionError('invalid_input', `${field}: ${why}`);
}

function str(raw: unknown, field: string, max: number): string {
  if (raw === undefined || raw === null || raw === '') invalid(field, 'required.');
  if (typeof raw !== 'string') invalid(field, 'expected text.');
  if (raw.length > max) invalid(field, `at most ${max} characters.`);
  return raw;
}

/** 32 lowercase hex characters: the editor reports keys with or without dashes, in either case. */
export function contentKey(raw: unknown, field = 'key'): string {
  const key = str(raw, field, 64).trim().replace(/-/g, '').toLowerCase();
  if (!CONTENT_KEY.test(key)) invalid(field, 'not a CMS content key.');
  return key;
}

export function locale(raw: unknown, field = 'locale'): string {
  const value = str(raw, field, 35).trim();
  if (!LOCALE.test(value)) invalid(field, 'not a language code.');
  return value;
}

function pageIndex(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_PAGE_INDEX) {
    invalid('pageIndex', `a whole number from 0 to ${MAX_PAGE_INDEX}.`);
  }
  return raw;
}

function picks(raw: unknown): PublishPick[] {
  if (!Array.isArray(raw) || raw.length === 0) invalid('items', 'pick at least one item.');
  if (raw.length > PUBLISH_BATCH_SIZE) invalid('items', `at most ${PUBLISH_BATCH_SIZE} per call.`);
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const pick = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const key = contentKey(pick.key, `items[${i}].key`);
    const version = str(pick.version, `items[${i}].version`, 12);
    if (!VERSION.test(version)) invalid(`items[${i}].version`, 'not a version number.');
    if (seen.has(key)) invalid(`items[${i}].key`, 'listed twice.');
    seen.add(key);
    return {key, version};
  });
}

type Parsers = {[A in ActionName]: (raw: Record<string, unknown>) => ActionParams[A]};

/** One parser per action: unknown fields are dropped, every kept field is checked. */
export const PARSERS: Parsers = {
  listChildren: (p) => ({key: contentKey(p.key), locale: locale(p.locale), pageIndex: pageIndex(p.pageIndex)}),
  publish: (p) => ({parentKey: contentKey(p.parentKey, 'parentKey'), locale: locale(p.locale), items: picks(p.items)}),
};

export function isAction(action: string): action is ActionName {
  return Object.prototype.hasOwnProperty.call(PARSERS, action);
}
