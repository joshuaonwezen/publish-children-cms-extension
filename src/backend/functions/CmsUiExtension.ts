import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {ActionName, ActionParams, ActionResults, Envelope} from '../../shared/types';
import {listChildren, publishChildren} from '../lib/children';
import {type CmsConfig, CmsClient} from '../lib/cms';
import {ActionError, NotConfiguredError} from '../lib/errors';
import {ApiError} from '../lib/http';
import {loadCms, requireCms} from '../lib/settings';
import {isAction, PARSERS} from '../lib/validate';

interface RequestBody {
  action?: unknown;
  params?: unknown;
}

function ok<T>(result: T): Envelope<T> {
  return {ok: true, result};
}

function fail(error: string, message?: string): Envelope<never> {
  return message ? {ok: false, error, message} : {ok: false, error};
}

type Handlers = {[A in ActionName]: (cms: CmsConfig | null, params: ActionParams[A]) => Promise<ActionResults[A]>};

const HANDLERS: Handlers = {
  listChildren: (cms, p) => listChildren(new CmsClient(requireCms(cms)), p.key, p.locale, p.pageIndex),
  publish: async (cms, p) => {
    const results = await publishChildren(new CmsClient(requireCms(cms)), p.parentKey, p.locale, p.items);
    // The extension context carries no editor identity and the CMS history shows the API
    // client, so the app logs are the only record of what was published from here.
    logger.info('audit', 'publish', {
      parentKey: p.parentKey,
      locale: p.locale,
      results: results.map((r) => `${r.key}@${r.version}:${r.outcome}${r.problem ? `:${r.problem}` : ''}`),
    });
    return {results};
  },
};

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    if (!isAction(action)) return new App.Response(400, fail('unknown_action', action.slice(0, 64)));

    // Everything inside the try: a throw that escapes perform() reaches the editor as an
    // empty "[ExtensionService] Failed to invoke function:".
    try {
      const raw = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      const params = PARSERS[action](raw as Record<string, unknown>);
      const handler = HANDLERS[action] as (cms: CmsConfig | null, params: unknown) => Promise<unknown>;
      return new App.Response(200, ok(await handler(await loadCms(), params)));
    } catch (error) {
      if (error instanceof ActionError) return new App.Response(400, fail(error.code, error.message));
      if (error instanceof NotConfiguredError) return new App.Response(412, fail('not_configured', error.message));
      if (error instanceof ApiError) {
        logger.warn('Upstream API error', action, error.code, error.message);
        return new App.Response(502, fail(error.code, error.message));
      }
      logger.error('CmsUiExtension failure', action, error);
      return new App.Response(500, fail('internal_error'));
    }
  }
}
