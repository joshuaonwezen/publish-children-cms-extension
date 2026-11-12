import {writeFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {listChildren} from '../../src/backend/lib/children';
import {CmsClient} from '../../src/backend/lib/cms';
import {contentKey} from '../../src/backend/lib/validate';

// Read-only: lists one item's children and their publish state. It never publishes - try
// that by hand, on throwaway pages.
// PUBLISH_CHILDREN_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… \
// PUBLISH_CHILDREN_LIVE_KEY=<content key> PUBLISH_CHILDREN_LIVE_OUT=/tmp/children.json yarn vitest run tests/live
const live = process.env.PUBLISH_CHILDREN_LIVE === '1';

describe.skipIf(!live)('child items against a real CMS', () => {
  const cms = new CmsClient({
    clientId: process.env.OPTIMIZELY_CMS_CLIENT_ID ?? '',
    clientSecret: process.env.OPTIMIZELY_CMS_CLIENT_SECRET ?? '',
  });

  it('lists the children of an item', async () => {
    const key = contentKey(process.env.PUBLISH_CHILDREN_LIVE_KEY);
    const list = await listChildren(cms, key, process.env.PUBLISH_CHILDREN_LIVE_LOCALE ?? 'en', 0);
    if (process.env.PUBLISH_CHILDREN_LIVE_OUT) writeFileSync(process.env.PUBLISH_CHILDREN_LIVE_OUT, JSON.stringify(list, null, 2));
    expect(list.total).toBeGreaterThan(0);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((r) => r.state !== 'error')).toBe(true);
  });
});
