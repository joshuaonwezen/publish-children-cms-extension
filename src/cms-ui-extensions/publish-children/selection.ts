import type {ChildRow, PublishPick, PublishResult} from '@shared/types';

export const isPublishable = (row: ChildRow) => (row.state === 'changes' || row.state === 'new') && row.version !== null;

/** "Select all changes" ticks the live items with newer drafts, never a first publish. */
export function changedKeys(rows: ChildRow[]): string[] {
  return rows.filter((r) => r.state === 'changes' && isPublishable(r)).map((r) => r.key);
}

/** The picked rows as publish requests, in list order, without rows that stopped being publishable. */
export function picksFor(rows: ChildRow[], picked: ReadonlySet<string>): PublishPick[] {
  return rows.filter((r) => picked.has(r.key) && isPublishable(r)).map((r) => ({key: r.key, version: r.version as string}));
}

export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface Report {
  headline: string;
  /** Every item published (or handed to the approval workflow): shown as a success. */
  clean: boolean;
  /** Items that weren't published, with why. */
  problems: Array<{key: string; name: string; reason: string}>;
}

export function report(results: PublishResult[], names: ReadonlyMap<string, string>): Report {
  const published = results.filter((r) => r.outcome === 'published').length;
  const waiting = results.filter((r) => r.outcome === 'awaiting_approval').length;
  const accepted = results.filter((r) => r.outcome === 'accepted').length;
  const problems = results
    .filter((r) => r.outcome === 'refused' || r.outcome === 'failed')
    .map((r) => ({key: r.key, name: names.get(r.key) ?? r.key, reason: r.reason ?? 'Not published.'}));
  const parts = [
    published ? `Published ${count(published, 'item')}` : '',
    waiting ? `${count(waiting, 'item')} sent for approval` : '',
    accepted ? `${count(accepted, 'item')} accepted by the CMS but still showing as a draft (refresh in a moment)` : '',
    problems.length ? `${count(problems.length, 'item')} not published` : '',
  ].filter(Boolean);
  return {headline: `${parts.join(', ') || 'Nothing published'}.`, clean: problems.length === 0, problems};
}

/**
 * The rows as the publish left them, before a reload can confirm it: the CMS's own reads lag
 * a moment behind a publish, so reloading straight away could show a published item as a draft.
 */
export function applyResults(rows: ChildRow[], results: PublishResult[]): ChildRow[] {
  const byKey = new Map(results.map((r) => [r.key, r]));
  return rows.map((row) => {
    const r = byKey.get(row.key);
    if (r?.outcome === 'published') return {...row, state: 'published', status: 'published', publishedVersion: r.version, version: null};
    if (r?.outcome === 'awaiting_approval') return {...row, state: 'other', status: 'awaiting approval', version: null};
    return row;
  });
}
