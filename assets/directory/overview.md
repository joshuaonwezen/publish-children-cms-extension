# Publish children

Publish a page's child items in one go, instead of opening each one.

- **Publish children** sidebar on an item:
  - every direct child item, in the language you pick: unpublished changes, not yet live, published, or no
    version in that language;
  - tick the ones to publish, or **Select all changes** (items that were never published stay unticked, so a
    first publish is always a choice);
  - one **Publish** with a confirm step, then what was published, what went to an approval workflow, and what
    was skipped and why.
- Each item is checked again just before it is published: it must still be a child of the open item, and the
  ticked version must still be its newest draft.
- Variations are never published from here: their drafts are counted, and the panel points to Visual Builder.

Works with any Optimizely CMS (SaaS) instance and needs nothing from the site: one CMS API client that may
publish content.
