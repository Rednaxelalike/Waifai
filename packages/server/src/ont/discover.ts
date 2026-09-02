import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { logger } from '../log.ts';
import { CANDIDATE_PAGES, type OntClient } from './client.ts';
import { detectKinds } from './parse.ts';

const log = logger('discover');

export interface DiscoveryResult {
  path: string;
  status: number;
  bytes: number;
  kinds: string[];
}

/**
 * Probe every candidate page once and record which ones this firmware serves
 * and what each contains.
 *
 * This exists because HG8145V5 builds differ far more than the model number
 * suggests: MTN ships several firmware revisions and they move optical data,
 * WAN counters and the attached-device list between `.asp` files with no
 * pattern. Pinning paths would mean the monitor works on one house's router
 * and silently reports nothing on the next.
 *
 * With `dump` on, every page body is written to disk. That is the escape
 * hatch: if a page responds but no parser recognises it, grep the dump for the
 * value you can see in the router UI and widen the label list in `parse.ts`.
 */
export async function discover(
  db: Db,
  ont: OntClient,
  opts: { dump?: boolean } = {},
): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];

  if (opts.dump) mkdirSync(config.ont.dumpDir, { recursive: true });

  await ont.session(async (client) => {
    for (const path of CANDIDATE_PAGES) {
      const page = await client.page(path).catch(() => null);
      if (!page) {
        results.push({ path, status: 0, bytes: 0, kinds: [] });
        continue;
      }

      const kinds = detectKinds(page);
      results.push({ path, status: page.status, bytes: page.body.length, kinds });

      /*
       * Only remember pages that a parser actually understood. A firmware that
       * serves a 200 for every path - some builds return the login page rather
       * than a 404 - would otherwise leave every candidate marked good, and
       * each poll would fetch twenty useless pages through a router that
       * allows one session at a time.
       */
      db.recordPage(path, page.ok && kinds.length > 0, page.body.length, kinds);

      if (opts.dump && page.ok) {
        const name = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
        writeFileSync(join(config.ont.dumpDir, `${name}.html`), page.body, 'utf8');
      }
    }
  });

  const usable = results.filter((r) => r.kinds.length > 0);
  log.info(`discovery complete: ${usable.length} of ${results.length} candidate pages are usable`);

  if (usable.length === 0) {
    log.warn(
      'No page yielded parseable data. Either the credentials are wrong, or this firmware ' +
        'lays its pages out differently. Re-run with --dump and inspect page_dumps/.',
    );
  }
  return results;
}
