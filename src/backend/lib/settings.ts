import {logger, storage, ValueHash} from '@zaiusinc/app-sdk';

import type {CmsConfig} from './cms';
import {NotConfiguredError} from './errors';

// The section key matches forms/settings.yml.
// A type alias, not an interface: the settings store requires an index-signature-compatible shape.
export type CmsSettings = {
  clientId?: string;
  clientSecret?: string;
};

/**
 * One settings section, or {} when the store can't be read. On a CMS-scoped install that has
 * never saved its settings, the production store throws "Failed to get value at
 * app-data/<install>/settings" instead of returning {}.
 */
export async function readSection<T extends ValueHash>(section: string): Promise<T> {
  try {
    return await storage.settings.get<T>(section);
  } catch (error) {
    logger.warn('Could not read settings section', section, error);
    return {} as T;
  }
}

/** The CMS API client, or null until both halves are saved. */
export async function loadCms(): Promise<CmsConfig | null> {
  const cms = await readSection<CmsSettings>('cms');
  const clientId = cms.clientId?.trim() ?? '';
  const clientSecret = cms.clientSecret?.trim() ?? '';
  return clientId && clientSecret ? {clientId, clientSecret} : null;
}

export function requireCms(config: CmsConfig | null): CmsConfig {
  if (!config) throw new NotConfiguredError('The app settings are missing the CMS API client ID and secret.');
  return config;
}
