import {Alert, Badge, Button, Checkbox, Disclosure, DisclosureContent, DisclosureTrigger, Group, Separator, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {PUBLISH_BATCH_SIZE} from '@shared/constants';
import type {ChildList, ChildRow, ChildState, PublishResult} from '@shared/types';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {call} from '../common/api';
import {Frame} from '../common/Frame';
import {useContent} from '../common/useContent';
import {languageLabel, languageName, shortDate} from './format';
import {applyResults, batches, changedKeys, isPublishable, picksFor, report, type Report} from './selection';

type Intent = 'success' | 'warning' | 'information' | 'neutral' | 'danger';

const STATE: Record<ChildState, {label: string; intent: Intent}> = {
  changes: {label: 'Unpublished changes', intent: 'warning'},
  new: {label: 'Not yet live', intent: 'information'},
  published: {label: 'Published', intent: 'success'},
  missing: {label: 'No version', intent: 'neutral'},
  other: {label: 'Other state', intent: 'neutral'},
  error: {label: "Couldn't load", intent: 'danger'},
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The CMS's reads lag a moment behind a publish; reloading sooner can show a draft again.
const RELOAD_AFTER_PUBLISH_MS = 2000;

/** An editor's address as the CMS records it; API clients show up as a hex ID, which says nothing. */
const byWhom = (who: string | null) => (who && who.includes('@') ? ` by ${who}` : '');

function stateLabel(row: ChildRow, locale: string): string {
  if (row.state === 'missing') return row.locales.length === 0 ? 'No language versions' : `No ${languageName(locale)} version`;
  if (row.state === 'other') return row.status ? `Newest is ${row.status}` : STATE.other.label;
  return STATE[row.state].label;
}

function Child({row, locale, picked, disabled, onToggle}: {
  row: ChildRow;
  locale: string;
  picked: boolean;
  disabled: boolean;
  onToggle: (key: string, on: boolean) => void;
}) {
  const when = shortDate(row.lastModified);
  const details = [
    row.contentType,
    row.version ? `version ${row.version}` : '',
    when ? `changed ${when}${byWhom(row.lastModifiedBy)}` : '',
  ].filter(Boolean);
  return (
    <Group flexDirection="column" gap="4">
      <Checkbox checked={picked} disabled={disabled || !isPublishable(row)} onCheckedChange={(on) => onToggle(row.key, on)}>
        {row.displayName}
      </Checkbox>
      <Group alignItems="center" flexWrap="wrap" gap="8" pl="24">
        <Badge intent={STATE[row.state].intent} variant="subtle">
          {stateLabel(row, locale)}
        </Badge>
        <Text color="fg.secondary" fontSize="xs">
          {details.join(' · ')}
        </Text>
      </Group>
      {row.variationDrafts > 0 && (
        <Text color="fg.tertiary" fontSize="xs" pl="24">
          {count(row.variationDrafts, 'variation has', 'variations have')} a draft too: publish variations in Visual Builder.
        </Text>
      )}
      {row.state === 'error' && (
        <Text color="fg.tertiary" fontSize="xs" pl="24">
          Its versions couldn&apos;t be read. Refresh to try again.
        </Text>
      )}
    </Group>
  );
}

function ReportAlert({result}: {result: Report}) {
  return (
    <Alert intent={result.clean ? 'success' : 'warning'}>
      <Group flexDirection="column" gap="4">
        <Text fontSize="sm">{result.headline}</Text>
        {result.problems.map((p) => (
          <Text fontSize="xs" key={p.key}>
            {p.name}: {p.reason}
          </Text>
        ))}
      </Group>
    </Alert>
  );
}

function HowItWorks() {
  return (
    <Disclosure>
      <DisclosureTrigger>How this works</DisclosureTrigger>
      <DisclosureContent>
        <Group flexDirection="column" gap="8">
          <Text color="fg.secondary" fontSize="xs">
            The list shows the open item&apos;s direct child items in one language. An item can be ticked when its newest
            version is a draft: newer than the published one (unpublished changes), or never published (not yet live).
            Select all changes leaves items that were never published unticked, so a first publish is always a choice.
          </Text>
          <Text color="fg.secondary" fontSize="xs">
            Just before publishing, each item is checked again: it must still be a child of this item, and the ticked
            version must still be its newest draft. Anything that changed in the meantime is skipped, with the reason.
          </Text>
          <Text color="fg.secondary" fontSize="xs">
            Variations are never published from here: publish them in Visual Builder. Publishes are made with the
            app&apos;s CMS API client, so the CMS history shows that client rather than you, and an approval workflow on
            this CMS still applies.
          </Text>
        </Group>
      </DisclosureContent>
    </Disclosure>
  );
}

interface Loaded {
  key: string;
  locale: string;
  list: ChildList;
}

function PublishChildren({context}: {context: ExtensionContext}) {
  const {content, ready} = useContent(context);
  const [chosenLocale, setChosenLocale] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{done: number; total: number} | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const requestId = useRef(0);

  const key = content?.key ?? null;
  const locale = chosenLocale ?? content?.locale ?? 'en';

  // A new item starts in the editor's own language, with nothing ticked.
  useEffect(() => {
    setChosenLocale(null);
    setPicked(new Set());
    setConfirming(false);
    setResult(null);
  }, [key]);

  const load = useCallback(
    async (itemKey: string, itemLocale: string, pageIndex = 0) => {
      const id = ++requestId.current;
      setBusy(true);
      setError(null);
      try {
        const list = await call(context, 'listChildren', {key: itemKey, locale: itemLocale, pageIndex});
        if (id !== requestId.current) return;
        setLoaded((prev) =>
          pageIndex > 0 && prev?.key === itemKey && prev.locale === itemLocale
            ? {key: itemKey, locale: itemLocale, list: {...list, items: [...prev.list.items, ...list.items]}}
            : {key: itemKey, locale: itemLocale, list},
        );
      } catch (e) {
        if (id === requestId.current) setError(e);
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [context],
  );

  useEffect(() => {
    if (key) void load(key, locale);
  }, [key, locale, load]);

  // Between switching items or languages and the new answer arriving, `loaded` still
  // describes the previous one; show nothing of it.
  const list = loaded && loaded.key === key && loaded.locale === locale ? loaded.list : null;
  const rows = useMemo(() => list?.items ?? [], [list]);
  const picks = useMemo(() => picksFor(rows, picked), [rows, picked]);
  const changed = useMemo(() => changedKeys(rows), [rows]);
  const publishing = progress !== null;

  const toggle = useCallback((rowKey: string, on: boolean) => {
    setConfirming(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    if (key) void load(key, locale);
  }, [key, locale, load]);

  const chooseLocale = (next: string) => {
    setChosenLocale(next);
    setPicked(new Set());
    setConfirming(false);
    setResult(null);
  };

  const publish = async () => {
    if (!key || picks.length === 0) return;
    const names = new Map(rows.map((r) => [r.key, r.displayName]));
    const results: PublishResult[] = [];
    setConfirming(false);
    setResult(null);
    setError(null);
    setProgress({done: 0, total: picks.length});
    try {
      for (const batch of batches(picks, PUBLISH_BATCH_SIZE)) {
        const answer = await call(context, 'publish', {parentKey: key, locale, items: batch});
        results.push(...answer.results);
        setProgress({done: results.length, total: picks.length});
      }
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
      if (results.length > 0) {
        setResult(report(results, names));
        setLoaded((prev) =>
          prev?.key === key && prev.locale === locale ? {...prev, list: {...prev.list, items: applyResults(prev.list.items, results)}} : prev,
        );
      }
      setPicked(new Set());
      setTimeout(() => void load(key, locale), RELOAD_AFTER_PUBLISH_MS);
    }
  };

  if (!ready) return <Frame busy />;
  if (!content) {
    return (
      <Frame>
        <Text color="fg.secondary">Open an item to see its child items.</Text>
      </Frame>
    );
  }

  const subtitle = list
    ? `${count(list.total, 'child item')} · ${languageLabel(locale)}${list.items.length < list.total ? ` · ${list.items.length} shown` : ''}`
    : undefined;

  return (
    <Frame busy={busy || publishing} error={error} onRetry={refresh} subtitle={subtitle}>
      {list && list.locales.length > 1 && (
        <Group alignItems="center" gap="8">
          <Text fontSize="sm">Language</Text>
          <select
            aria-label="Language"
            disabled={publishing}
            onChange={(e) => chooseLocale(e.target.value)}
            style={{flex: 1, minWidth: 0, font: 'inherit', fontSize: 13, padding: '4px 6px'}}
            value={locale}
          >
            {list.locales.map((l) => (
              <option key={l} value={l}>
                {languageLabel(l)}
              </option>
            ))}
          </select>
        </Group>
      )}

      {result && <ReportAlert result={result} />}

      {list && list.total === 0 && (
        <Text color="fg.secondary" fontSize="sm">
          This item has no child items.
        </Text>
      )}

      {rows.length > 0 && (
        <Group flexWrap="wrap" gap="8" justifyContent="space-between">
          <Group gap="8">
            <Button
              appearance="subtle"
              disabled={publishing || changed.length === 0}
              onClick={() => {
                setConfirming(false);
                setPicked(new Set(changed));
              }}
              size="sm"
            >
              Select all changes ({changed.length})
            </Button>
            {picked.size > 0 && (
              <Button appearance="subtle" disabled={publishing} onClick={() => setPicked(new Set())} size="sm">
                Clear
              </Button>
            )}
          </Group>
          <Button appearance="subtle" disabled={busy || publishing} onClick={refresh} size="sm">
            Refresh
          </Button>
        </Group>
      )}

      {rows.map((row) => (
        <Group flexDirection="column" gap="8" key={row.key}>
          <Separator />
          <Child disabled={publishing} locale={locale} onToggle={toggle} picked={picked.has(row.key)} row={row} />
        </Group>
      ))}

      {list?.hasMore && (
        <Button appearance="subtle" disabled={busy || publishing} onClick={() => key && void load(key, locale, list.pageIndex + 1)} size="sm">
          Load more
        </Button>
      )}

      {rows.length > 0 && <Separator />}

      {progress && (
        <Text color="fg.secondary" fontSize="sm">
          Publishing {progress.done} of {progress.total}…
        </Text>
      )}

      {confirming && picks.length > 0 ? (
        <Alert intent="warning">
          <Group flexDirection="column" gap="8">
            <Text fontSize="sm">
              Publish {count(picks.length, 'item')} in {languageName(locale)}? This makes them live, published by the
              app&apos;s CMS API client.
            </Text>
            <Group gap="8">
              <Button appearance="primary" onClick={() => void publish()} size="sm">
                Publish
              </Button>
              <Button appearance="subtle" onClick={() => setConfirming(false)} size="sm">
                Cancel
              </Button>
            </Group>
          </Group>
        </Alert>
      ) : (
        rows.length > 0 && (
          <Button appearance="primary" disabled={publishing || picks.length === 0} loading={publishing} onClick={() => setConfirming(true)} size="sm">
            {picks.length > 0 ? `Publish ${count(picks.length, 'item')}` : 'Tick items to publish'}
          </Button>
        )
      )}

      {list && <HowItWorks />}
    </Frame>
  );
}

register((context) => <PublishChildren context={context} />);
