// Distance rules for W07 Open jobs: the "Newest / Nearest" switch and the "Within X km" filter (pure, unit tested).
//
// A job carries no coordinates (privacy: before a quote is accepted only the phase and lane are shown), so the
// distance is an estimate: from the worker (phone location when allowed, otherwise the centre of the nearest of
// their chosen phases) to the centre of the job's DHA phase. It is shown with a "~" so nobody reads it as exact.
// The centres below are approximate and live in this one table so they can be corrected in one place.

export type Point = { lat: number; lng: number };

const CENTRES: Readonly<Record<number, Point>> = {
  1: { lat: 24.8445, lng: 67.0705 },
  2: { lat: 24.8290, lng: 67.0690 },
  3: { lat: 24.8180, lng: 67.0450 },
  4: { lat: 24.8180, lng: 67.0560 },
  5: { lat: 24.8040, lng: 67.0510 },
  6: { lat: 24.7950, lng: 67.0620 },
  7: { lat: 24.7860, lng: 67.0570 },
  8: { lat: 24.7690, lng: 67.0950 },
};

/** Approximate centre of a DHA phase, or null for a phase that is not on the list. */
export function phaseCentre(phase: number): Point | null {
  return CENTRES[phase] ?? null;
}

/** The distance choices of the dropdown, in km; `null` means any distance. */
export const RADIUS_OPTIONS: readonly (number | null)[] = [1, 2, 3, 5, 10, null];
export const DEFAULT_RADIUS: number | null = null; // no limit until the worker picks one: an estimate must not hide jobs by itself

export type FeedSort = 'newest' | 'nearest';

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in km. */
export function haversineKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the point is plausibly in or near Karachi (a worker testing from elsewhere must not hide every job). */
export function nearKarachi(p: Point): boolean {
  const reference = phaseCentre(5);
  return reference !== null && haversineKm(p, reference) <= 40;
}

/** Where the distance is measured from: the phone location when it is near Karachi, else the worker's own phases. */
export type Origin = { kind: 'gps'; point: Point } | { kind: 'areas'; phases: number[] } | { kind: 'none' };

export function chooseOrigin(gps: Point | null, areas: readonly number[]): Origin {
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) && nearKarachi(gps)) return { kind: 'gps', point: gps };
  const phases = areas.filter((p) => phaseCentre(p) !== null);
  return phases.length > 0 ? { kind: 'areas', phases: [...phases] } : { kind: 'none' };
}

/** Estimated km from the origin to the job's phase, or null when it cannot be told (unknown phase, no origin). */
export function jobDistanceKm(phase: number, origin: Origin): number | null {
  const centre = phaseCentre(phase);
  if (!centre) return null;
  if (origin.kind === 'gps') return haversineKm(origin.point, centre);
  if (origin.kind === 'areas') {
    // an area phase is the worker's home ground: the job's own phase counts as 0 km, others the nearest chosen phase
    return Math.min(...origin.phases.map((p) => {
      const own = phaseCentre(p);
      return p === phase || !own ? 0 : haversineKm(own, centre);
    }));
  }
  return null;
}

/** "~0.8 km", "~12 km"; "Near you" under 0.3 km; empty when unknown. */
export function distanceLabel(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return '';
  if (km < 0.3) return 'Near you';
  return km < 10 ? `~${km.toFixed(1)} km` : `~${Math.round(km)} km`;
}

export function radiusLabel(radius: number | null): string {
  return radius === null ? 'Any distance' : `Within ${radius} km`;
}

type Placed = { id: string; phase: number };

/**
 * Applies the radius filter and the sort. "Newest" keeps the order of `jobs` (the server's: ASAP first, then newest).
 * "Nearest" sorts by estimated distance, ties keep the server order (stable sort). A job whose distance is unknown
 * is never hidden by the filter and goes last in "Nearest".
 */
export function arrange<J extends Placed>(
  jobs: readonly J[],
  options: { sort: FeedSort; radius: number | null; origin: Origin },
): { job: J; km: number | null }[] {
  const { sort, radius, origin } = options;
  const rows = jobs.map((job) => ({ job, km: jobDistanceKm(job.phase, origin) }));
  const kept = radius === null ? rows : rows.filter((r) => r.km === null || r.km <= radius);
  if (sort === 'nearest') {
    return kept
      .map((r, index) => ({ r, index }))
      .sort((a, b) => {
        const ka = a.r.km ?? Number.POSITIVE_INFINITY;
        const kb = b.r.km ?? Number.POSITIVE_INFINITY;
        return ka === kb ? a.index - b.index : ka - kb;
      })
      .map((x) => x.r);
  }
  return kept;
}
