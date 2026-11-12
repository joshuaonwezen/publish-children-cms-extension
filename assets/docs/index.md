# Publish children

Publish the child items of a page in one go from the editor. Walkthrough:
[Publish children extension](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#publish-children).

## Setup

Install the app on the CMS instance, then fill in the settings. It works with any Optimizely CMS (SaaS) instance.

1. **CMS API client**: a client ID and secret (CMS: Settings > API Keys) for a client that may publish content.
   Publishes are made as this client, not as the editor: any editor who can open the panel can publish the open
   item's child items, and the CMS history shows the client as the author.

## Using it

Open an item and the **Publish children** tab on the right-hand rail. It lists the item's direct child items in
the editor's language; switch language at the top when the item has more than one. Tick the items to publish, or
use **Select all changes**, then **Publish** and confirm.

- **Unpublished changes**: published, with a newer draft. Select all changes ticks these.
- **Not yet live**: never published. Tick these one by one: publishing makes them live for the first time.
- **Published**, **No version** and other states (in review, scheduled) can't be ticked.

Just before publishing, each item is checked again: it must still be a child of the open item, and the ticked
version must still be its newest draft. Anything that changed is skipped, and the panel says why. On a CMS with
an approval workflow, a publish goes to review instead, and the panel says so.

Variations are never published from here: publish them in Visual Builder.

## What your site needs

Nothing. The app talks only to the CMS.

## Help

- Using the app on another CMS instance: [reuse](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse).
- Something not working: [troubleshooting](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting).
