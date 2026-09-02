import type { Tone } from '../components/ui.tsx';

/**
 * What broke, in the words a person would use, and whose fault it was.
 *
 * The blame column is why this exists at all: "the internet was bad" gets
 * nowhere with a support desk, and "4h 12m of PON loss across six incidents
 * this month" does.
 *
 * It lives here rather than on the screen that shows the list because three
 * places now render an incident - the list, the timeline band, and the home
 * activity feed - and two of them were falling back to the raw database value.
 * `collector_down` was the one that made that unacceptable: rendered raw it
 * reads as "collector down", which sounds like the line breaking when it means
 * this app was not watching.
 */
export interface IncidentMeta {
  title: string;
  blame: string;
  tone: Tone;
}

const KIND: Record<string, IncidentMeta> = {
  pon_down: { title: 'Fibre signal lost', blame: 'ISP', tone: 'bad' },
  wan_down: { title: 'No route out', blame: 'ISP', tone: 'bad' },
  ont_unreachable: { title: 'Router not responding', blame: 'Local', tone: 'warn' },
  dns_failure: { title: 'DNS not resolving', blame: 'ISP', tone: 'warn' },
  degraded: { title: 'Slow and lossy', blame: 'ISP', tone: 'warn' },
  collector_down: { title: 'Monitor was off', blame: 'Not measured', tone: 'neutral' },
};

export function incidentMeta(kind: string): IncidentMeta {
  return KIND[kind] ?? { title: kind.replace(/_/g, ' '), blame: 'Unknown', tone: 'neutral' };
}
