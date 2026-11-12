// The contract between the sidebar and the cms_extension function. The UI sends
// {action, params}; the function answers with an Envelope.

export type Envelope<T> =
  | {ok: true; result: T}
  | {ok: false; error: string; message?: string};

/**
 * One child in one language. changes: published, with a newer draft. new: never published,
 * has a draft. published: nothing newer to publish. missing: no version in this language.
 * other: the newest version is in a state the panel doesn't publish (in review, scheduled...).
 * error: its versions couldn't be read.
 */
export type ChildState = 'changes' | 'new' | 'published' | 'missing' | 'other' | 'error';

export interface ChildRow {
  key: string;
  displayName: string;
  contentType: string | null;
  state: ChildState;
  /** The version Publish would publish: set for changes and new only. */
  version: string | null;
  /** The newest base version's status, e.g. "draft", "ready", "inReview". */
  status: string | null;
  publishedVersion: string | null;
  lastModified: string | null;
  lastModifiedBy: string | null;
  /** Unpublished variation versions in this language: never published from here. */
  variationDrafts: number;
  /** [] for items without language versions (media, folders). */
  locales: string[];
}

export interface ChildList {
  key: string;
  locale: string;
  /** Languages to offer: the open item's, or its children's when it has none (a folder). */
  locales: string[];
  items: ChildRow[];
  pageIndex: number;
  total: number;
  hasMore: boolean;
}

/** accepted: the CMS took the publish, but still showed a draft when it was read back. */
export type PublishOutcome = 'published' | 'awaiting_approval' | 'accepted' | 'refused' | 'failed';

/** Why an item was refused or failed. */
export type PublishProblem =
  | 'not_found'
  | 'not_a_child'
  | 'variation'
  | 'stale_version'
  | 'not_publishable'
  | 'write_denied'
  | 'cms_error'
  | 'internal_error';

export interface PublishResult {
  key: string;
  version: string;
  outcome: PublishOutcome;
  /** Set for refused and failed. */
  problem?: PublishProblem;
  /** Set for refused and failed: why, in words for the editor. */
  reason?: string;
}

export interface PublishPick {
  key: string;
  version: string;
}

export type ActionParams = {
  listChildren: {key: string; locale: string; pageIndex: number};
  publish: {parentKey: string; locale: string; items: PublishPick[]};
};

export type ActionResults = {
  listChildren: ChildList;
  publish: {results: PublishResult[]};
};

export type ActionName = keyof ActionParams;
