import { config } from '../config.ts';
import { Db } from '../db/index.ts';
import { OntClient } from '../ont/client.ts';
import { discover } from '../ont/discover.ts';

/**
 * `npm run discover` - the first thing to run on a new install.
 *
 * Confirms the credentials work, finds which pages this particular firmware
 * serves, and reports what it managed to read from each. If this prints a
 * table with `optical` and `devices` in it, everything else will work.
 */
async function main(): Promise<void> {
  const dump = process.argv.includes('--dump');
  const db = new Db();
  const ont = new OntClient();

  console.log(`Probing ${config.ont.baseUrl} as "${config.ont.adminUser || config.ont.user}"...\n`);

  const results = await discover(db, ont, { dump });

  const pathWidth = Math.max(...results.map((r) => r.path.length), 4);
  console.log(`${'PATH'.padEnd(pathWidth)}  STATUS  BYTES   CONTAINS`);
  console.log('-'.repeat(pathWidth + 32));
  for (const r of results.sort((a, b) => b.kinds.length - a.kinds.length)) {
    const mark = r.kinds.length ? '*' : ' ';
    console.log(
      `${mark}${r.path.padEnd(pathWidth - 1)}  ${String(r.status).padEnd(6)}  ${String(r.bytes).padEnd(6)}  ${r.kinds.join(', ') || '-'}`,
    );
  }

  const found = new Set(results.flatMap((r) => r.kinds));
  console.log('\nSummary');
  for (const [kind, why] of [
    ['optical', 'Rx/Tx power - line health and drift detection'],
    ['pon', 'PON link state - distinguishes an MTN fault from a house fault'],
    ['wan_ip', 'public IP - confirms the WAN session is really up'],
    ['counters', 'WAN byte counters - throughput charts and data usage'],
    ['devices', 'attached devices - presence and new-device alerts'],
    ['info', 'model and firmware'],
  ] as const) {
    console.log(`  ${found.has(kind) ? 'yes' : ' no'}  ${kind.padEnd(9)} ${why}`);
  }

  if (!found.has('optical')) {
    console.log(
      '\nNo optical readings found. Two things to try, in order:\n' +
        '  1. Set ONT_ADMIN_USER=telecomadmin and ONT_ADMIN_PASS=admintelecom in .env.\n' +
        '     The root account is restricted on this firmware family and often cannot\n' +
        '     see the optical page at all.\n' +
        '  2. Re-run with --dump, then grep page_dumps/ for the Rx power value you can\n' +
        '     see in the router web UI, and add its label to parse.ts.',
    );
  }
  if (dump) console.log(`\nPage bodies written to ${config.ont.dumpDir}`);

  db.close();
}

main().catch((err) => {
  console.error('\nDiscovery failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
