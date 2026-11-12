# Publish children

Publish a page's child items in one go from the CMS editor, instead of opening and publishing each one. Editors see every direct child of the open item with its publish state in one language, tick the ones to publish, and publish them with one confirm.

Documentation: [walkthrough](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#publish-children).

## What editors get

### Publish children sidebar (per item)
- How many child items the open item has, in which language, and a language switch when there is more than one. A folder has no languages of its own, so it offers its children's.
- Every direct child with a state for that language:
  - **Unpublished changes:** published, with a newer draft (or ready) version;
  - **Not yet live:** never published, with a draft;
  - **Published:** nothing newer to publish;
  - **No version** in that language, or no language versions at all (media);
  - **Newest is inReview / scheduled / …:** left alone, so a review or a schedule is never cut short.
- Ticking: only unpublished changes and not-yet-live items can be ticked. **Select all changes** ticks the unpublished changes and leaves not-yet-live items unticked, so a first publish is always a deliberate choice.
- **Publish N items** asks to confirm, publishes in batches of 20 with progress, then reports what was published, what went to an approval workflow, and what was skipped, with the reason for each. The list reloads afterwards.
- A note on every child whose variations have drafts: those are never published from here.
- **Refresh**, **Load more** (50 children per page), **Retry** after an error, and a "How this works" section.

## Setup

1. Install the app on the CMS instance (see [Deploy](#deploy)). Each CMS instance gets its own install.
2. Fill in the settings. It works with any Optimizely CMS (SaaS) instance.
3. Open an item and the **Publish children** tab on the editor's right-hand rail.

| Setting | Required | Where to find it | Used for |
|---|---|---|---|
| CMS client ID and secret | Yes | CMS: Settings > API Keys, for a client that may publish content | Listing the open item's children and their versions, drafts included, and publishing the versions an editor picks. |

Saving tests the client against the CMS first. A blank secret keeps the saved one.

Using the extension on another CMS instance: [reuse](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse). Something not working: [troubleshooting](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting).

## What your site needs

Nothing. The extension talks only to the CMS REST API, so it works the same whatever renders the site.

## How a publish is checked

The list can be minutes old by the time an editor clicks Publish, so the backend checks every picked item against the CMS as it is at that moment, one at a time:

1. The item must still exist and its `container` must be the open item. The open item itself is refused.
2. The item's versions in that language are read again. A picked variation version is refused. The picked version must still be the newest base version and a draft (or ready) newer than the published one, or the item is skipped as changed since the list loaded.
3. `POST /v1/content/{key}/versions/{version}:publish`, then the version is read back: `published`, or held by an approval workflow (a 400 "requires approval", or a status other than published).

One item failing never stops the others, except a client without publish rights (403), which would fail every one: the rest of the batch is then reported without trying. Nothing is ever created or patched, only existing drafts published, so a publish can't drop properties or touch a variation.

## Limits

These come from the CMS UI extensions platform (beta, SDK 1.1.0) and the CMS API:

- **The extension context is only `{key, version, locale, publicUrl}`**, and carries no editor identity.
- **Publishes are made as the app's API client.** The CMS can't check the editor's own publish rights, the CMS history shows the client, and the app logs (`audit` lines) are the only record of what was published from the panel.
- **Direct children only**, as the CMS lists them (`GET /v1/content/{key}/items`). The CMS leaves system folders out of that list.
- **Variations are never published:** the CMS API can't safely write one, so they are counted and left to Visual Builder.
- **Version history is read up to 1,000 versions per language** (10 pages of 100). A child published more than 1,000 versions ago shows as not yet live, and publishing it is refused if that turns out wrong.
- **Extensions get no CMS token.** The app stores its own CMS API client in its settings.
- **Reading settings an install never saved throws** in the production runtime; the app treats that as empty.

## Security

- Every action's parameters go through one parser in `src/backend/lib/validate.ts` before any CMS call. Content keys (dashes removed, lower-cased) must be 32 hex characters, languages a language code and versions a number, because all three end up in CMS URL paths. A publish takes at most 20 items, each key once. Unknown fields are dropped; an unknown action is echoed back cut to 64 characters.
- The child check runs on the server, but the open item's key comes from the browser like everything else, so it guards against a stale or mistaken pick, not a determined editor: anyone who can open the panel can publish what the API client may publish.
- Upstream errors keep their HTTP status and body in the app's logs only. Editors see a plain sentence for every error code (`src/cms-ui-extensions/common/api.ts`).
- The CMS client secret is stored in the app's secret settings field and never sent to the browser.

## Develop

```bash
yarn install
yarn validate      # lint + typecheck + unit tests + build + ocp-app-sdk validate
ocp dev -p 3100    # the sidebar in a simulated CMS host
```

The live suite only reads:

```bash
PUBLISH_CHILDREN_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=<client-id> OPTIMIZELY_CMS_CLIENT_SECRET=<client-secret> \
PUBLISH_CHILDREN_LIVE_KEY=<content-key> PUBLISH_CHILDREN_LIVE_OUT=/tmp/children.json yarn vitest run tests/live
```

## Deploy

With the OCP CLI (run it as `npx -p @optimizely/ocp-cli-v2 ocp ...` if it isn't installed):

```bash
npx -p @optimizely/ocp-cli-v2 ocp app register      # once
ocp app prepare --bump-dev-version --publish
ocp directory install cms_publish_children@<version> --scope <cms-instance-uuid>
```

Publishing a new dev version moves existing installs onto it.

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | Action router: `listChildren` (`{key, locale, pageIndex}`), `publish` (`{parentKey, locale, items}`); validates params, checks the settings, logs an `audit` line per publish |
| `src/backend/lib/validate.ts` | One parser per action |
| `src/backend/lib/errors.ts` | `ActionError` (400) and `NotConfiguredError` (412) |
| `src/backend/lib/children.ts` | Version paging, the per-child state, the list, and the checked publish |
| `src/backend/lib/cms.ts` | CMS REST: token, item, children, versions, publish |
| `src/cms-ui-extensions/publish-children/` | `PublishChildren.sidebar.tsx`, selection and report helpers (`selection.ts`), language names and dates (`format.ts`) |
