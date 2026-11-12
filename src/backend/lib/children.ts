import {logger} from '@zaiusinc/app-sdk';

import {CHILDREN_PAGE_SIZE} from '../../shared/constants';
import type {ChildList, ChildRow, PublishPick, PublishProblem, PublishResult} from '../../shared/types';
import {type CmsClient, type CmsItem, type CmsVersion, VERSION_PAGE_SIZE} from './cms';
import {ActionError} from './errors';
import {ApiError} from './http';

// Low on purpose: every child costs at least one version listing, and the CMS answers 429
// when the function fans out too widely.
const CONCURRENCY = 4;
// A language reworked for months can have hundreds of drafts on top of its published
// version; cap the scan rather than let one call eat the function's time budget.
const MAX_VERSION_PAGES = 10;
const PENDING = new Set(['draft', 'ready']);

/** The CMS calls this module makes: a CmsClient, or a fake one in tests. */
export type CmsReader = Pick<CmsClient, 'getItem' | 'childPage' | 'versionPage'>;
export type CmsPublisher = CmsReader & Pick<CmsClient, 'publishVersion'>;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return results;
}

const newestFirst = (a: CmsVersion, b: CmsVersion) => Number(b.version) - Number(a.version);
const isPublishedBase = (v: CmsVersion) => !v.variation && v.status === 'published';
const normalizeKey = (key: string | null | undefined) => (key ?? '').replace(/-/g, '').toLowerCase();
const languagesOf = (item: CmsItem) => (item.locales ?? []).filter(Boolean);

export interface LocaleVersions {
  /** Base versions, newest first. */
  base: CmsVersion[];
  /** Variation versions: counted, never published from here. */
  variations: CmsVersion[];
}

/**
 * The item's versions in `locale`. Reads a page of 100 at a time until the published base
 * version turns up (it sits far down when a language has had many drafts since), for at
 * most 10 pages. A published variation doesn't end the scan.
 */
export async function localeVersions(cms: CmsReader, key: string, locale: string): Promise<LocaleVersions> {
  const versions: CmsVersion[] = [];
  for (let pageIndex = 0; pageIndex < MAX_VERSION_PAGES; pageIndex++) {
    const items = await cms.versionPage(key, locale, pageIndex);
    versions.push(...items);
    if (items.length < VERSION_PAGE_SIZE || items.some(isPublishedBase)) break;
  }
  return {
    base: versions.filter((v) => !v.variation).sort(newestFirst),
    variations: versions.filter((v) => v.variation),
  };
}

/** Variations whose newest version in this language is a draft. */
function variationDrafts(variations: CmsVersion[]): number {
  const newest = new Map<string, CmsVersion>();
  for (const v of variations) {
    const name = v.variation as string;
    const seen = newest.get(name);
    if (!seen || Number(v.version) > Number(seen.version)) newest.set(name, v);
  }
  return [...newest.values()].filter((v) => PENDING.has(v.status)).length;
}

const fallbackName = (key: string) => `Item ${key.slice(0, 8)}`;

/** One child's state in one language, from its versions there. */
export function describeChild(item: CmsItem, {base, variations}: LocaleVersions): ChildRow {
  const newest = base[0];
  const published = base.find((v) => v.status === 'published');
  let state: ChildRow['state'];
  if (!newest) state = 'missing';
  else if (newest === published || newest.status === 'previous') state = 'published';
  else if (PENDING.has(newest.status)) state = published ? 'changes' : 'new';
  else state = 'other';

  return {
    key: item.key,
    displayName: (newest ?? variations[0])?.displayName || fallbackName(item.key),
    contentType: item.contentType ?? newest?.contentType ?? null,
    state,
    version: state === 'changes' || state === 'new' ? newest.version : null,
    status: newest?.status ?? null,
    publishedVersion: published?.version ?? null,
    lastModified: newest?.lastModified ?? null,
    lastModifiedBy: newest?.lastModifiedBy ?? null,
    variationDrafts: variationDrafts(variations),
    locales: languagesOf(item),
  };
}

function errorRow(item: CmsItem): ChildRow {
  return {...describeChild(item, {base: [], variations: []}), state: 'error'};
}

/** The language list to offer: the open item's own, or its children's when it has none (a folder). */
function languagesToOffer(parent: CmsItem, children: CmsItem[], locale: string): string[] {
  const own = languagesOf(parent);
  const set = new Set(own.length > 0 ? own : children.flatMap(languagesOf));
  set.add(locale);
  return [...set].sort((a, b) => (a === locale ? -1 : b === locale ? 1 : a.localeCompare(b)));
}

export async function listChildren(cms: CmsReader, key: string, locale: string, pageIndex: number): Promise<ChildList> {
  const [parent, page] = await Promise.all([cms.getItem(key), cms.childPage(key, pageIndex, CHILDREN_PAGE_SIZE)]);
  if (!parent) throw new ActionError('not_found', 'The open item no longer exists in the CMS.');

  // One child that fails to load (rate limited, say) must not hide the others.
  const items = await mapLimit(page.items, CONCURRENCY, async (child) => {
    if (!languagesOf(child).includes(locale)) return describeChild(child, {base: [], variations: []});
    try {
      return describeChild(child, await localeVersions(cms, child.key, locale));
    } catch (error) {
      logger.warn('Could not read the versions of a child item', child.key, error instanceof Error ? error.message : error);
      return errorRow(child);
    }
  });

  return {
    key,
    locale,
    locales: languagesToOffer(parent, page.items, locale),
    items,
    pageIndex,
    total: page.totalCount,
    hasMore: (pageIndex + 1) * CHILDREN_PAGE_SIZE < page.totalCount,
  };
}

const refused = (pick: PublishPick, problem: PublishProblem, reason: string): PublishResult => ({
  ...pick,
  outcome: 'refused',
  problem,
  reason,
});

const failed = (pick: PublishPick, problem: PublishProblem, reason: string): PublishResult => ({
  ...pick,
  outcome: 'failed',
  problem,
  reason,
});

const WRITE_DENIED = "The app's CMS API client can read content but not publish it. Ask a CMS admin for a client with publish rights.";

/** Re-checks one pick against the CMS as it is now; null when it may be published. */
async function checkPick(cms: CmsReader, parentKey: string, locale: string, pick: PublishPick): Promise<PublishResult | null> {
  if (pick.key === parentKey) return refused(pick, 'not_a_child', 'This is the open item itself, not one of its child items.');
  const item = await cms.getItem(pick.key);
  if (!item) return refused(pick, 'not_found', 'This item no longer exists.');
  if (normalizeKey(item.container) !== parentKey) {
    return refused(pick, 'not_a_child', 'Not a child item of the open item, so it was not published.');
  }

  const versions = await localeVersions(cms, pick.key, locale);
  if (versions.variations.some((v) => v.version === pick.version)) {
    return refused(pick, 'variation', 'That is a variation version. Publish variations in Visual Builder.');
  }
  const row = describeChild(item, versions);
  if (row.state === 'published') return refused(pick, 'not_publishable', 'Already published: there is nothing newer to publish.');
  if (row.state === 'missing') return refused(pick, 'not_publishable', `It has no ${locale} version.`);
  if (row.state === 'other') {
    return refused(pick, 'not_publishable', `Its newest version is ${row.status ?? 'in another state'}, so it was not published.`);
  }
  if (row.version !== pick.version) {
    return refused(pick, 'stale_version', `It changed after the list loaded (its newest version is now ${row.version}). Refresh and try again.`);
  }
  return null;
}

/**
 * Publishes the picked versions one at a time, each only after checking, against the CMS as
 * it is now, that the item is a direct child of `parentKey` and the version is still its
 * newest base draft in `locale`. One item failing never stops the others, except a client
 * without publish rights, which would fail every one.
 */
export async function publishChildren(
  cms: CmsPublisher,
  parentKey: string,
  locale: string,
  picks: PublishPick[],
): Promise<PublishResult[]> {
  const results: PublishResult[] = [];
  for (const pick of picks) {
    if (results.some((r) => r.problem === 'write_denied')) {
      results.push(failed(pick, 'write_denied', WRITE_DENIED));
      continue;
    }
    try {
      const problem = await checkPick(cms, parentKey, locale, pick);
      results.push(problem ?? {...pick, outcome: await cms.publishVersion(pick.key, pick.version)});
    } catch (error) {
      if (error instanceof ApiError) {
        logger.warn('Publish failed', pick.key, pick.version, error.code, error.message);
        results.push(
          error.status === 403
            ? failed(pick, 'write_denied', WRITE_DENIED)
            : failed(pick, 'cms_error', error.status === 429 ? 'The CMS is busy right now. Try again in a moment.' : `The CMS didn't publish it (HTTP ${error.status}).`),
        );
      } else {
        logger.error('Publish failed', pick.key, pick.version, error);
        results.push(failed(pick, 'internal_error', 'Something went wrong while publishing it. Try again.'));
      }
    }
  }
  return results;
}
