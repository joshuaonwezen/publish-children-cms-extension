import type {ChildRow} from '@shared/types';
import {describe, expect, it} from 'vitest';

import {applyResults, batches, changedKeys, picksFor, report} from './selection';

const row = (key: string, state: ChildRow['state'], version: string | null = state === 'changes' || state === 'new' ? '7' : null): ChildRow => ({
  key,
  displayName: `Page ${key}`,
  contentType: 'ArticlePage',
  state,
  version,
  status: 'draft',
  publishedVersion: null,
  lastModified: null,
  lastModifiedBy: null,
  variationDrafts: 0,
  locales: ['en'],
});

const rows = [row('a', 'changes'), row('b', 'new'), row('c', 'published'), row('d', 'changes')];

describe('selection', () => {
  it('selects all changes but never a first publish', () => {
    expect(changedKeys(rows)).toEqual(['a', 'd']);
  });

  it('sends only picks that are still publishable, in list order', () => {
    expect(picksFor(rows, new Set(['d', 'c', 'b']))).toEqual([
      {key: 'b', version: '7'},
      {key: 'd', version: '7'},
    ]);
  });

  it('splits a selection into batches', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});

describe('report', () => {
  const names = new Map([
    ['a', 'Savings'],
    ['b', 'Loans'],
  ]);

  it('is a success when everything went out', () => {
    const r = report(
      [
        {key: 'a', version: '1', outcome: 'published'},
        {key: 'b', version: '2', outcome: 'awaiting_approval'},
      ],
      names,
    );
    expect(r).toEqual({headline: 'Published 1 item, 1 item sent for approval.', clean: true, problems: []});
  });

  it('lists what was not published, and why', () => {
    const r = report(
      [
        {key: 'a', version: '1', outcome: 'published'},
        {key: 'b', version: '2', outcome: 'refused', problem: 'stale_version', reason: 'It changed.'},
      ],
      names,
    );
    expect(r.headline).toBe('Published 1 item, 1 item not published.');
    expect(r.clean).toBe(false);
    expect(r.problems).toEqual([{key: 'b', name: 'Loans', reason: 'It changed.'}]);
  });
});

describe('applyResults', () => {
  it('shows what the publish did before the reload confirms it', () => {
    const next = applyResults(rows, [
      {key: 'a', version: '7', outcome: 'published'},
      {key: 'b', version: '7', outcome: 'awaiting_approval'},
      {key: 'd', version: '7', outcome: 'refused', problem: 'stale_version', reason: 'It changed.'},
    ]);
    expect(next.map((r) => [r.key, r.state, r.version])).toEqual([
      ['a', 'published', null],
      ['b', 'other', null],
      ['c', 'published', null],
      ['d', 'changes', '7'],
    ]);
    expect(next[0].publishedVersion).toBe('7');
  });

  it('counts a publish the CMS took but still shows as a draft', () => {
    expect(report([{key: 'a', version: '1', outcome: 'accepted'}], new Map()).headline).toBe(
      '1 item accepted by the CMS but still showing as a draft (refresh in a moment).',
    );
  });
});
