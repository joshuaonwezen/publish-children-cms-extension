import {logger, resetLocalSettingsStore, storage} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {loadCms, requireCms} from './settings';

describe('settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalSettingsStore();
  });

  it('treats an unreadable store as empty', async () => {
    // What the production store throws on an install that has never saved its settings.
    vi.spyOn(storage.settings, 'get').mockRejectedValue(new Error('Failed to get value at app-data/1/settings'));
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const cms = await loadCms();
    expect(cms).toBeNull();
    expect(() => requireCms(cms)).toThrow(/CMS API client/);
  });

  it('trims the saved client', async () => {
    await storage.settings.put('cms', {clientId: ' id ', clientSecret: 'secret'});
    expect(requireCms(await loadCms())).toEqual({clientId: 'id', clientSecret: 'secret'});
  });

  it('needs both halves of the client', async () => {
    await storage.settings.put('cms', {clientId: 'id'});
    expect(await loadCms()).toBeNull();
  });
});
