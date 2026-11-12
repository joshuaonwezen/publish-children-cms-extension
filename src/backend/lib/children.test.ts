import {logger} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {type CmsItem, type CmsVersion, type PublishedAs, VERSION_PAGE_SIZE} from './cms';
import {type CmsPublisher, describeChild, listChildren, localeVersions, publishChildren} from './children';
import {ActionError} from './errors';
import {ApiError} from './http';

const PARENT = '0f8e2d6c4b1a49e7a3c5d7f9b2e4c6a8';
const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccccccccccc';
const OTHER = 'dddddddddddddddddddddddddddddddd';

const child = (key: string, extra: Partial<CmsItem> = {}): CmsItem => ({
  key,
  container: PARENT,
  contentType: 'ArticlePage',
  primaryLocale: 'en',
  locales: ['en', 'nl'],
  ...extra,
});

const v = (key: string, version: number, status: string, extra: Partial<CmsVersion> = {}): CmsVersion => ({
  key,
  version: String(version),
  locale: 'en',
  status,
  displayName: `Page ${key.slice(0, 1)}`,
  lastModified: '2026-11-01T10:00:00Z',
  ...extra,
});

interface World {
  items: Record<string, CmsItem>;
  /** Newest first, like the CMS lists them. */
  versions: Record<string, CmsVersion[]>;
  publish?: (key: string, version: string) => Promise<PublishedAs>;
}

/** A CMS over in-memory items and versions that records every publish. */
function fakeCms(world: World) {
  const published: string[] = [];
  const cms: CmsPublisher = {
    getItem: async (key) => world.items[key] ?? null,
    childPage: async (key) => {
      const items = Object.values(world.items).filter((i) => i.container === key);
      return {items, totalCount: items.length};
    },
    versionPage: async (key, locale, pageIndex) =>
      (world.versions[key] ?? [])
        .filter((x) => x.locale === locale)
        .slice(pageIndex * VERSION_PAGE_SIZE, (pageIndex + 1) * VERSION_PAGE_SIZE),
    publishVersion: async (key, version) => {
      published.push(`${key}@${version}`);
      return world.publish ? world.publish(key, version) : 'published';
    },
  };
  return {cms, published};
}

describe('describeChild', () => {
  const row = (versions: CmsVersion[]) => describeChild(child(A), {base: versions.filter((x) => !x.variation), variations: versions.filter((x) => x.variation)});

  it('offers a draft newer than the published version', () => {
    const r = row([v(A, 9, 'draft'), v(A, 8, 'published'), v(A, 7, 'previous')]);
    expect(r).toMatchObject({state: 'changes', version: '9', publishedVersion: '8', status: 'draft', displayName: 'Page a'});
  });

  it('treats ready like draft', () => {
    expect(row([v(A, 9, 'ready'), v(A, 8, 'published')]).state).toBe('changes');
  });

  it('offers a first publish when nothing was ever published', () => {
    expect(row([v(A, 3, 'draft')])).toMatchObject({state: 'new', version: '3', publishedVersion: null});
  });

  it('has nothing to publish when the published version is the newest', () => {
    expect(row([v(A, 8, 'published'), v(A, 7, 'draft')])).toMatchObject({state: 'published', version: null});
    expect(row([v(A, 8, 'previous')]).state).toBe('published');
  });

  it('leaves review and scheduled versions alone', () => {
    expect(row([v(A, 9, 'inReview'), v(A, 8, 'published')])).toMatchObject({state: 'other', status: 'inReview', version: null});
  });

  it('is missing without a version in the language', () => {
    expect(row([])).toMatchObject({state: 'missing', version: null, displayName: 'Item aaaaaaaa'});
  });

  it('never offers a variation, and counts the variations with a draft', () => {
    const r = row([
      v(A, 12, 'draft', {variation: 'business'}),
      v(A, 11, 'published', {variation: 'business'}),
      v(A, 10, 'published', {variation: 'personal'}),
      v(A, 9, 'draft', {variation: 'personal'}),
      v(A, 8, 'published'),
    ]);
    expect(r).toMatchObject({state: 'published', version: null, variationDrafts: 1});
  });
});

describe('localeVersions', () => {
  it('reads past 100 drafts to the published version, not stopping at a published variation', async () => {
    const versions = [
      v(A, 300, 'published', {variation: 'business'}),
      ...Array.from({length: 150}, (_, i) => v(A, 299 - i, 'draft')),
      v(A, 149, 'published'),
    ];
    const {cms} = fakeCms({items: {[A]: child(A)}, versions: {[A]: versions}});
    const found = await localeVersions(cms, A, 'en');
    expect(found.base[0].version).toBe('299');
    expect(found.base.find((x) => x.status === 'published')?.version).toBe('149');
    expect(found.variations).toHaveLength(1);
  });
});

describe('listChildren', () => {
  afterEach(() => vi.restoreAllMocks());

  it('describes each child, skipping the call for a language it is not in', async () => {
    const reads: string[] = [];
    const {cms} = fakeCms({
      items: {
        [PARENT]: child(PARENT, {container: 'root', locales: ['en', 'nl']}),
        [A]: child(A),
        [B]: child(B, {locales: ['nl']}),
      },
      versions: {[A]: [v(A, 2, 'draft'), v(A, 1, 'published')]},
    });
    const page = cms.versionPage;
    cms.versionPage = async (...args) => {
      reads.push(args[0]);
      return page(...args);
    };
    const list = await listChildren(cms, PARENT, 'en', 0);
    expect(list.items.map((r) => [r.key, r.state])).toEqual([
      [A, 'changes'],
      [B, 'missing'],
    ]);
    expect(reads).toEqual([A]);
    expect(list).toMatchObject({total: 2, hasMore: false, locales: ['en', 'nl']});
  });

  it("offers the children's languages under a folder", async () => {
    const {cms} = fakeCms({
      items: {[PARENT]: child(PARENT, {container: 'root', locales: ['']}), [A]: child(A, {locales: ['sv', 'de']})},
      versions: {},
    });
    expect((await listChildren(cms, PARENT, 'en', 0)).locales).toEqual(['en', 'de', 'sv']);
  });

  it('marks one unreadable child instead of failing the list', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const {cms} = fakeCms({items: {[PARENT]: child(PARENT, {container: 'root'}), [A]: child(A), [B]: child(B)}, versions: {[B]: [v(B, 1, 'draft')]}});
    const page = cms.versionPage;
    cms.versionPage = async (key, ...rest) => {
      if (key === A) throw new ApiError(429, 'cms_rate_limited', 'List versions: HTTP 429');
      return page(key, ...rest);
    };
    const list = await listChildren(cms, PARENT, 'en', 0);
    expect(list.items.map((r) => r.state)).toEqual(['error', 'new']);
  });

  it('says so when the open item is gone', async () => {
    const {cms} = fakeCms({items: {}, versions: {}});
    await expect(listChildren(cms, PARENT, 'en', 0)).rejects.toBeInstanceOf(ActionError);
  });
});

describe('publishChildren', () => {
  afterEach(() => vi.restoreAllMocks());

  const world = (): World => ({
    items: {[PARENT]: child(PARENT, {container: 'root'}), [A]: child(A), [B]: child(B), [C]: child(C), [OTHER]: child(OTHER, {container: 'elsewhere'})},
    versions: {
      [A]: [v(A, 9, 'draft'), v(A, 8, 'published')],
      [B]: [v(B, 5, 'draft')],
      [C]: [v(C, 4, 'published')],
      [OTHER]: [v(OTHER, 2, 'draft')],
    },
  });

  it('publishes the drafts that are still the newest', async () => {
    const {cms, published} = fakeCms(world());
    const results = await publishChildren(cms, PARENT, 'en', [
      {key: A, version: '9'},
      {key: B, version: '5'},
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['published', 'published']);
    expect(published).toEqual([`${A}@9`, `${B}@5`]);
  });

  it('refuses an item that is not a direct child, and the open item itself', async () => {
    const {cms, published} = fakeCms(world());
    const results = await publishChildren(cms, PARENT, 'en', [
      {key: OTHER, version: '2'},
      {key: PARENT, version: '1'},
    ]);
    expect(results.map((r) => r.problem)).toEqual(['not_a_child', 'not_a_child']);
    expect(published).toEqual([]);
  });

  it('refuses a version that is no longer the newest draft', async () => {
    const w = world();
    w.versions[A] = [v(A, 10, 'draft'), v(A, 9, 'draft'), v(A, 8, 'published')];
    const {cms, published} = fakeCms(w);
    const [result] = await publishChildren(cms, PARENT, 'en', [{key: A, version: '9'}]);
    expect(result).toMatchObject({outcome: 'refused', problem: 'stale_version'});
    expect(result.reason).toMatch(/version is now 10/);
    expect(published).toEqual([]);
  });

  it('refuses a variation version', async () => {
    const w = world();
    w.versions[A] = [v(A, 11, 'draft', {variation: 'business'}), v(A, 9, 'draft'), v(A, 8, 'published')];
    const {cms, published} = fakeCms(w);
    const [result] = await publishChildren(cms, PARENT, 'en', [{key: A, version: '11'}]);
    expect(result).toMatchObject({outcome: 'refused', problem: 'variation'});
    expect(published).toEqual([]);
  });

  it('refuses an item that has nothing newer, or no version in the language', async () => {
    const {cms} = fakeCms(world());
    const results = await publishChildren(cms, PARENT, 'nl', [{key: C, version: '4'}]);
    expect(results[0]).toMatchObject({problem: 'not_publishable', reason: 'It has no nl version.'});
    const again = await publishChildren(fakeCms(world()).cms, PARENT, 'en', [{key: C, version: '4'}]);
    expect(again[0]).toMatchObject({problem: 'not_publishable'});
  });

  it('reports a version an approval workflow holds back', async () => {
    const w = world();
    w.publish = async () => 'awaiting_approval';
    const [result] = await publishChildren(fakeCms(w).cms, PARENT, 'en', [{key: A, version: '9'}]);
    expect(result.outcome).toBe('awaiting_approval');
  });

  it('stops publishing once the client turns out to lack publish rights', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const w = world();
    w.publish = async () => {
      throw new ApiError(403, 'cms_unauthorized', 'Publish: HTTP 403');
    };
    const {cms, published} = fakeCms(w);
    const results = await publishChildren(cms, PARENT, 'en', [
      {key: A, version: '9'},
      {key: B, version: '5'},
    ]);
    expect(results.map((r) => [r.outcome, r.problem])).toEqual([
      ['failed', 'write_denied'],
      ['failed', 'write_denied'],
    ]);
    expect(published).toEqual([`${A}@9`]);
  });

  it('carries on after one item fails', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const w = world();
    w.publish = async (key) => {
      if (key === A) throw new ApiError(409, 'cms_conflict', 'Publish: HTTP 409');
      return 'published';
    };
    const results = await publishChildren(fakeCms(w).cms, PARENT, 'en', [
      {key: A, version: '9'},
      {key: B, version: '5'},
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'published']);
    expect(results[0].reason).toBe("The CMS didn't publish it (HTTP 409).");
  });
});
