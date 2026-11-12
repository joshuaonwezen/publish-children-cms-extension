import {afterEach, describe, expect, it, vi} from 'vitest';

import {CmsClient} from './cms';

const KEY = '0123456789abcdef0123456789abcdef';

/** Answers the CMS API from a table of `METHOD path?query` -> [status, body]; records every call. */
function stubCms(routes: Record<string, Array<[number, unknown]>>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const {pathname, search} = new URL(url);
      if (pathname === '/oauth/token') return new Response(JSON.stringify({access_token: 't', expires_in: 3600}));
      const route = `${init.method ?? 'GET'} ${pathname}${search}`;
      calls.push(route);
      const answer = routes[route]?.shift();
      if (!answer) return new Response('not stubbed', {status: 500});
      return new Response(answer[1] === null ? '' : JSON.stringify(answer[1]), {status: answer[0]});
    }),
  );
  return calls;
}

const client = () => new CmsClient({clientId: 'id', clientSecret: 'secret'});

describe('CmsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads one page of children with the total', async () => {
    stubCms({
      [`GET /v1/content/${KEY}/items?pageIndex=1&pageSize=50`]: [[200, {items: [{key: 'a'}], pageIndex: 1, pageSize: 50, totalCount: 51}]],
    });
    expect(await client().childPage(KEY, 1, 50)).toEqual({items: [{key: 'a'}], totalCount: 51});
  });

  it('re-reads the status after publishing', async () => {
    const calls = stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [
        [200, {key: KEY, version: '7', locale: 'en', status: 'published'}],
        [200, {key: KEY, version: '7', locale: 'en', status: 'inReview'}],
      ],
    });
    expect(await client().publishVersion(KEY, '7')).toBe('published');
    expect(calls).toEqual([`POST /v1/content/${KEY}/versions/7:publish`, `GET /v1/content/${KEY}/versions/7`]);
  });

  it('waits out a read that still shows the draft right after publishing', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [
        [200, {key: KEY, version: '7', locale: 'en', status: 'draft'}],
        [200, {key: KEY, version: '7', locale: 'en', status: 'published'}],
      ],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0, 0])).toBe('published');
  });

  it('says accepted when the draft never shows as published', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [
        [200, {key: KEY, version: '7', locale: 'en', status: 'draft'}],
        [200, {key: KEY, version: '7', locale: 'en', status: 'draft'}],
      ],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0])).toBe('accepted');
  });

  it('reads a review status as waiting for approval', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [[200, {key: KEY, version: '7', locale: 'en', status: 'inReview'}]],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0])).toBe('awaiting_approval');
  });

  it("treats 'requires approval' as waiting, not as a failure", async () => {
    stubCms({[`POST /v1/content/${KEY}/versions/7:publish`]: [[400, {title: 'This content requires approval before publishing'}]]});
    expect(await client().publishVersion(KEY, '7')).toBe('awaiting_approval');
  });

  it('passes any other refusal on', async () => {
    stubCms({[`POST /v1/content/${KEY}/versions/7:publish`]: [[403, {title: 'Forbidden'}]]});
    await expect(client().publishVersion(KEY, '7')).rejects.toMatchObject({status: 403});
  });
});
