import {ApiError, requestJson} from './http';

const CMS_API = 'https://api.cms.optimizely.com';
export const VERSION_PAGE_SIZE = 100;
const EXPIRY_BUFFER_MS = 30_000;

export interface CmsConfig {
  clientId: string;
  clientSecret: string;
}

export interface CmsVersion {
  key: string;
  version: string;
  locale: string;
  status: string;
  contentType?: string;
  displayName?: string;
  /** Absent on base versions. */
  variation?: string | null;
  lastModified?: string;
  lastModifiedBy?: string;
}

export interface CmsItem {
  key: string;
  /** The parent's key. */
  container?: string | null;
  contentType?: string;
  primaryLocale?: string | null;
  /** [''] for items without language versions (media, folders). */
  locales?: string[];
}

export interface ChildPage {
  items: CmsItem[];
  totalCount: number;
}

/** accepted: the CMS took the publish, but its reads still showed a draft afterwards. */
export type PublishedAs = 'published' | 'awaiting_approval' | 'accepted';

// Reads straight after a publish can still show the old status for a second or two (seen on
// joshCMS 2026-11-12), so the status is read back a few times before anything is concluded.
const CONFIRM_DELAYS_MS = [0, 500, 1000, 1500, 2000];
const PENDING = new Set(['draft', 'ready']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Module scope survives warm invocations of the function.
let tokenCache: {clientId: string; token: string; expiresAt: number} | null = null;

export class CmsClient {
  private readonly cfg: CmsConfig;

  public constructor(cfg: CmsConfig) {
    this.cfg = cfg;
  }

  public async token(): Promise<string> {
    if (tokenCache && tokenCache.clientId === this.cfg.clientId && tokenCache.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      return tokenCache.token;
    }
    const body = await requestJson<{access_token: string; expires_in: number}>('cms', 'CMS token', `${CMS_API}/oauth/token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!body?.access_token) throw new ApiError(502, 'cms_unavailable', 'CMS token: no access_token in response');
    tokenCache = {clientId: this.cfg.clientId, token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000};
    return body.access_token;
  }

  private async get<T>(label: string, path: string): Promise<T | null> {
    return requestJson<T>('cms', label, `${CMS_API}${path}`, {
      headers: {Authorization: `Bearer ${await this.token()}`},
    });
  }

  private async send<T>(label: string, method: string, path: string, body?: unknown) {
    return requestJson<T>('cms', label, `${CMS_API}${path}`, {
      method,
      headers: {Authorization: `Bearer ${await this.token()}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Null when the content doesn't exist (deleted, or never did). */
  public async getItem(key: string): Promise<CmsItem | null> {
    try {
      return await this.get<CmsItem>('Get content', `/v1/content/${key}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * One page of the item's direct children. The CMS leaves system folders out of this list
   * even when they sit under the item.
   */
  public async childPage(key: string, pageIndex: number, pageSize: number): Promise<ChildPage> {
    const page = await this.get<{items?: CmsItem[]; totalCount?: number}>(
      'List children',
      `/v1/content/${key}/items?pageIndex=${pageIndex}&pageSize=${pageSize}`,
    );
    const items = page?.items ?? [];
    return {items, totalCount: typeof page?.totalCount === 'number' ? page.totalCount : items.length};
  }

  /**
   * One page of the item's versions in `locale`, newest first, base and variation versions
   * mixed; [] when the item has no version there (or no languages at all: media, folders).
   */
  public async versionPage(key: string, locale: string, pageIndex: number): Promise<CmsVersion[]> {
    try {
      const page = await this.get<{items?: CmsVersion[]}>(
        'List versions',
        `/v1/content/${key}/locales/${encodeURIComponent(locale)}?pageSize=${VERSION_PAGE_SIZE}&pageIndex=${pageIndex}`,
      );
      return page?.items ?? [];
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  public async getVersion(key: string, version: string): Promise<CmsVersion | null> {
    try {
      return await this.get<CmsVersion>('Get version', `/v1/content/${key}/versions/${encodeURIComponent(version)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  /** Publishes the version, or reports that an approval workflow holds it for review. */
  public async publishVersion(key: string, version: string, confirmDelaysMs = CONFIRM_DELAYS_MS): Promise<PublishedAs> {
    try {
      await this.send('Publish', 'POST', `/v1/content/${key}/versions/${encodeURIComponent(version)}:publish`);
    } catch (error) {
      // Instances with an approval workflow answer 400 "requires approval" and keep the draft.
      if (error instanceof ApiError && error.status === 400 && /requires approval/i.test(error.message)) {
        return 'awaiting_approval';
      }
      throw error;
    }
    for (const ms of confirmDelaysMs) {
      if (ms) await sleep(ms);
      const status = (await this.getVersion(key, version))?.status;
      // previous: published, and already replaced by a newer publish.
      if (status === 'published' || status === 'previous') return 'published';
      // Anything but a draft (inReview, say) means a workflow holds it.
      if (status && !PENDING.has(status)) return 'awaiting_approval';
    }
    return 'accepted';
  }
}
