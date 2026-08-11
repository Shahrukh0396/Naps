import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { RouteResult, RouteStyleId } from '../types/route';
import { RouteError } from './routeError';
import { computeTrafficAwareDrive, type TrafficAwareRoute } from './routesApi';

export { RouteError } from './routeError';

export interface FindRouteParams {
  origin: string;
  destination?: string | null;
  durationMinutes: number;
  routeTypes: RouteStyleId[];
  extraStops?: string[];
  /** Rotate waypoint bearings to generate alternate paths on refresh. */
  variation?: number;
  /**
   * Floor for duration clamping (default 30).
   * Mid-drive extend recalcs may pass a lower value so remaining nap time is respected.
   */
  minDurationMinutes?: number;
}

export async function findRoute(params: FindRouteParams): Promise<RouteResult> {
  const {
    origin,
    destination = null,
    durationMinutes,
    routeTypes,
    extraStops = [],
    variation = 0,
    minDurationMinutes = 30,
  } = params;

  if (!origin || !durationMinutes) {
    throw new RouteError('origin and durationMinutes are required');
  }

  try {

    // Default 30-minute floor — shorter drives don't produce meaningful loops.
    // Mid-drive extend recalcs can lower this to match remaining nap time.
    const clampedDuration = Math.max(minDurationMinutes, durationMinutes);

    const apiKey = GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new RouteError('Maps API key not configured');
    }

    // Route type flags
    // highway      → prefer fast roads; no avoids
    // no-highway   → avoid highways; local/residential roads
    // scenic        → avoid highways; bias toward parks/nature via bearing choice
    // fewer-lights → avoid highways; bias toward long arterials with fewer stops
    const routeType     = routeTypes[0] ?? 'highway';
    const avoidHighways = routeType === 'no-highway' || routeType === 'scenic' || routeType === 'fewer-lights';
    const avoidTolls    = false; // never avoid tolls — let user decide in map app
    const isScenic      = routeType === 'scenic';
    const fewerStops    = routeType === 'fewer-lights';
    const isHighway     = routeType === 'highway';

    // ── Speed & distance calibration ─────────────────────────────────────────
    // Conservative real-world averages including stops, turns, traffic.
    // These intentionally under-estimate so the first Google result is close
    // to or slightly under target — the clamp loop then scales up if needed.
    // Over-estimating causes the clamp to fight a huge initial radius for many
    // iterations without converging.
    //
    //   highway:      30 mph  (freeway avg with on/off ramps, city traffic)
    //   fewer-lights: 22 mph  (arterials, some lights but long stretches)
    //   no-highway:   18 mph  (residential/local streets, many stops)
    //   scenic:       15 mph  (winding roads, parks, slow limits)
    //
    // Road tortuosity: actual road distance ÷ straight-line distance.
    // City grids and winding roads make this 2.0–2.5×; use 2.0 as a safe floor.
    // Scenic uses 20 mph (not 15) — scenic roads are more tortuous so the initial
    // radius must be conservative to avoid overshooting on the first Google call.
    // The clamp loop corrects from there. 15 mph caused ratio ~1.8 on first attempt.
    const avgSpeedMph    = isHighway ? 30 : fewerStops ? 22 : isScenic ? 20 : 18;
    const tortuosity     = 2.0;
    // Destination drives spend the last leg going to a fixed end point, so the
    // detour stops must start larger or the ride undershoots the nap timer.
    const destPad        = destination ? 1.25 : 1.0;
    const totalRoadMiles = (clampedDuration / 60) * avgSpeedMph * destPad;
    const waypointMiles  = totalRoadMiles / (3 * tortuosity);

    // 1° latitude ≈ 69 miles; 1° longitude ≈ 69 * cos(lat) miles
    const dLat = waypointMiles / 69;

    // ── Parse origin ──────────────────────────────────────────────────────────
    let originLat: number;
    let originLng: number;

    // Detect GPS "lat,lng" — must be exactly two comma-separated parts,
    // both valid finite numbers, within valid coordinate ranges.
    // Addresses like "10 Main St, Springfield, IL" have 2+ commas or
    // non-numeric second parts and must go through geocoding.
    const originParts = origin.split(',');
    const p0 = parseFloat(originParts[0]);
    const p1 = parseFloat(originParts[1]);
    const isLatLng = originParts.length === 2
      && !isNaN(p0) && isFinite(p0)
      && !isNaN(p1) && isFinite(p1)
      && Math.abs(p0) <= 90 && Math.abs(p1) <= 180
      // Extra guard: a real street number like "10" passes parseFloat but
      // the second part of "10 Main St, Springfield" is " Main St" → NaN.
      // The isNaN(p1) check above already catches that, but belt-and-suspenders:
      && originParts[1].trim() !== '' && /^-?\d/.test(originParts[1].trim());
    console.log(`[route] origin="${origin}" isLatLng=${isLatLng}`);
    if (isLatLng) {
      [originLat, originLng] = [p0, p1];
    } else {
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(origin)}&key=${apiKey}`;
      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json() as {
        status: string;
        results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
      };
      console.log(`[route] geocode status=${geocodeData.status} for "${origin}"`);
      if (geocodeData.status !== 'OK' || !geocodeData.results[0]) {
        throw new RouteError('Could not find that address. Please try a more specific address (e.g. "123 Main St, City, State").');
      }
      originLat = geocodeData.results[0].geometry.location.lat;
      originLng = geocodeData.results[0].geometry.location.lng;
    }

    // Longitude degree size shrinks with latitude
    const dLng = dLat / Math.cos((originLat * Math.PI) / 180);

    // ── Waypoint placement ────────────────────────────────────────────────────
    // For a genuine loop we place TWO waypoints at ~120° apart around the origin
    // so the three segments (O→W1, W1→W2, W2→O) form a triangle.
    // Each waypoint sits at `radiusMiles` distance from the origin.
    //
    // Compass headings (bearing from origin):
    //   scenic      → NW (315°) and SW (225°) — toward parks/nature, away from city
    //   fewerStops  → N  (  0°) and SE (120°) — straight arterials
    //   no-highway  → NE ( 45°) and S  (180°) — residential loops
    //   default     → NE ( 45°) and NW (315°) — balanced suburban loop
    //
    // bearing2xy converts a compass bearing + optional scale to (dLat, dLng) offsets
    function bearing2xy(bearingDeg: number, scale = 1.0): [number, number] {
      const rad = (bearingDeg * Math.PI) / 180;
      return [Math.cos(rad) * dLat * scale, Math.sin(rad) * dLng * scale];
    }

    // ── Smart bearing selection ───────────────────────────────────────────────
    // FEATURE FLAG: set SMART_BEARINGS = false to revert to fixed bearing pairs.
    // When true, adjusts waypoint direction based on:
    //   1. Time of day — avoids rush-hour corridors (morning: avoid east, evening: avoid west)
    //   2. Coastal proximity — avoids west-bearing near US west coast (ocean)
    //   3. Route type — preserves the character of each route style
    //
    // This is purely additive: the clamp loop still corrects duration regardless
    // of which bearings are chosen. Worst case: first attempt is slightly off
    // and takes one extra clamp iteration. To remove: delete this block and
    // restore the original `if/else` bearing assignment below.
    const SMART_BEARINGS = true;

    function smartBearings(
      lat: number,
      lng: number,
      highway: boolean,
      scenic: boolean,
      fewerLights: boolean,
    ): [number, number] {
      // Hour in local time (0–23) approximated from UTC + rough timezone offset.
      // We use lng to estimate UTC offset: every 15° ≈ 1 hour.
      const utcHour = new Date().getUTCHours();
      const tzOffsetHours = Math.round(lng / 15);
      const localHour = ((utcHour + tzOffsetHours) % 24 + 24) % 24;

      // Rush hour windows (approximate)
      const isMorningRush = localHour >= 7 && localHour < 9;   // 7–9 AM
      const isEveningRush = localHour >= 16 && localHour < 19; // 4–7 PM

      // Coastal proximity: US west coast is roughly lng < -115 (CA/OR/WA).
      // Avoid westward bearings there to prevent waypoints landing in the ocean.
      const nearWestCoast = lng < -115;
      // US east coast: lng > -80. Avoid eastward bearings.
      const nearEastCoast = lng > -80;

      if (highway) {
        // Highway: prefer freeway corridors. Avoid the direction commuters are
        // heading during rush hour (morning = eastbound, evening = westbound).
        if (isMorningRush && !nearEastCoast) return [315, 225]; // NW + SW (away from east)
        if (isEveningRush && !nearWestCoast) return [45, 135];  // NE + SE (away from west)
        if (nearWestCoast)                   return [45, 135];  // NE + SE (land-safe)
        if (nearEastCoast)                   return [315, 225]; // NW + SW (land-safe)
        return [45, 135]; // default: NE + SE
      }

      if (scenic) {
        // Scenic: toward parks/hills. Avoid ocean on west coast.
        if (nearWestCoast) return [45, 135];  // NE + SE (inland, toward hills)
        return [135, 225];                    // SE + SW (parks/hills, land-biased)
      }

      if (fewerLights) {
        // Fewer lights: long arterials. Avoid rush-hour direction.
        if (isMorningRush) return [270, 180]; // W + S (cross-traffic, not with commuters)
        if (isEveningRush) return [90, 0];    // E + N
        return [0, 120];                      // N + SE (default arterials)
      }

      // No-highway: residential loops. Avoid ocean.
      if (nearWestCoast) return [45, 135]; // NE + SE (inland)
      return [45, 165];                    // NE + SSE (default residential)
    }

    let b1: number, b2: number;
    if (SMART_BEARINGS) {
      [b1, b2] = smartBearings(originLat, originLng, isHighway, isScenic, fewerStops);
    } else {
      // Original fixed bearing pairs (kept for easy rollback)
      if (isHighway)       { b1 = 45;  b2 = 135; }
      else if (isScenic)   { b1 = 135; b2 = 225; }
      else if (fewerStops) { b1 = 0;   b2 = 120; }
      else                 { b1 = 45;  b2 = 165; }
    }

    // Refresh / alternate suggestions: rotate the loop so Google returns a different path
    // while keeping the same nap-duration targeting.
    if (variation > 0) {
      const offset = (variation * 40) % 360;
      b1 = (b1 + offset) % 360;
      b2 = (b2 + offset) % 360;
    }

    console.log(`[route] bearings b1=${b1} b2=${b2} variation=${variation} smart=${SMART_BEARINGS} hour=${new Date().getUTCHours()}UTC`);

    const [w1dLat, w1dLng] = bearing2xy(b1);
    const [w2dLat, w2dLng] = bearing2xy(b2);

    const wp1Lat = originLat + w1dLat;
    const wp1Lng = originLng + w1dLng;
    const wp2Lat = originLat + w2dLat;
    const wp2Lng = originLng + w2dLng;

    // Primary waypoint exposed to the client (for map marker + Waze/Apple fallback)
    const waypointLat = wp1Lat;
    const waypointLng = wp1Lng;

    // Destination for the drive — loops return to origin.
    const endPoint = destination
      ? destination
      : ({ lat: originLat, lng: originLng } as const);

    const fetchDrive = async (
      waypoints: string[],
      relaxHighwayAvoid = false,
    ): Promise<TrafficAwareRoute> =>
      computeTrafficAwareDrive({
        origin: { lat: originLat, lng: originLng },
        destination: endPoint,
        waypoints,
        avoidHighways: relaxHighwayAvoid ? false : avoidHighways,
        avoidTolls,
      });

    // Always start with two nap stops so a short direct destination can't
    // collapse the drive far below the chosen nap length.
    const initialWaypoints = [
      `${wp1Lat},${wp1Lng}`,
      `${wp2Lat},${wp2Lng}`,
      ...extraStops,
    ];

    let drive = await fetchDrive(initialWaypoints);

    if (__DEV__) {
      console.log(
        `[route] initial source=${drive.source} status=${drive.status} ` +
          `traffic=${Math.round(drive.durationSeconds / 60)}min`,
      );
    }

    const routeDurationSecs = (data: TrafficAwareRoute): number =>
      data.durationSeconds;

    // If ZERO_RESULTS (e.g. waypoint landed in ocean/unreachable area),
    // retry with progressively smaller radii before giving up.
    if (drive.status !== 'OK') {
      for (const scale of [0.75, 0.5, 0.25]) {
        const retryWp = [
          `${originLat + w1dLat * scale},${originLng + w1dLng * scale}`,
          `${originLat + w2dLat * scale},${originLng + w2dLng * scale}`,
          ...extraStops,
        ];
        const retry = await fetchDrive(retryWp);
        if (retry.status === 'OK') {
          drive = retry;
          break;
        }
      }
    }

    // ── Duration-clamp retry (loops AND destination drives) ──────────────────
    // Grow / shrink the detour until ride time is within ±8% of the nap timer.
    // Durations use live traffic (Routes TRAFFIC_AWARE_OPTIMAL or Directions
    // departure_time=now) so the nap length matches what Maps shows.
    if (drive.status === 'OK' && drive.legs.length > 0) {
      const targetSecs = clampedDuration * 60;
      const tolerance = 0.08;
      let cumulativeScale = 1.0;

      const altBearingPairs: Array<[number, number]> = [
        [60, 180],
        [90, 210],
        [30, 150],
        [0, 135],
        [45, 165],
        [120, 240],
        [180, 300],
      ];
      let altBearingIdx = 0;
      let prevRatio = Infinity;
      let bestData = drive;
      let bestAbsError = Math.abs(routeDurationSecs(drive) - targetSecs);

      for (let attempt = 0; attempt < 10; attempt++) {
        const actualSecs = routeDurationSecs(drive);
        const ratio = actualSecs / targetSecs;
        const absError = Math.abs(actualSecs - targetSecs);
        if (absError < bestAbsError) {
          bestAbsError = absError;
          bestData = drive;
        }
        if (ratio >= 1 - tolerance && ratio <= 1 + tolerance) {
          if (__DEV__) {
            console.log(
              `[route] clamp ok attempt=${attempt + 1} actual=${Math.round(actualSecs / 60)}min target=${clampedDuration}min source=${drive.source}`,
            );
          }
          break;
        }

        const improvement = Math.abs(prevRatio - ratio) / Math.max(prevRatio, 1e-6);
        let useB1 = b1,
          useB2 = b2;
        if (attempt > 0 && improvement < 0.05 && altBearingIdx < altBearingPairs.length) {
          [useB1, useB2] = altBearingPairs[altBearingIdx++];
        }
        prevRatio = ratio;

        // Undershooting on non-scenic avoid-highway styles: relax avoid so
        // arterials can fill remaining nap time.
        const relaxAvoid =
          avoidHighways && !isScenic && ratio < 0.9 && clampedDuration >= 45;
        if (relaxAvoid && __DEV__) {
          console.log(
            `[route] relaxing highway avoid (ratio=${ratio.toFixed(2)}, target=${clampedDuration}min)`,
          );
        }

        // Destination drives need more radial room because the final leg
        // toward the fixed end point shortens the effective detour.
        const maxScale = destination
          ? isScenic
            ? 12.0
            : 8.0
          : isScenic
            ? 10.0
            : 6.0;
        // Prefer overshooting slightly when short so the nap isn't cut early.
        const scaleFactor = ratio < 1 ? Math.max(1.12, 1 / ratio) : 1 / ratio;
        cumulativeScale = Math.min(
          maxScale,
          Math.max(0.15, cumulativeScale * scaleFactor),
        );
        if (__DEV__) {
          console.log(
            `[route] clamp attempt=${attempt + 1} ratio=${ratio.toFixed(2)} ` +
              `actual=${Math.round(actualSecs / 60)}min target=${clampedDuration}min ` +
              `cumScale=${cumulativeScale.toFixed(3)} dest=${destination ? 'yes' : 'loop'} ` +
              `source=${drive.source}`,
          );
        }

        const [cb1dLat, cb1dLng] = bearing2xy(useB1, cumulativeScale);
        const [cb2dLat, cb2dLng] = bearing2xy(useB2, cumulativeScale);
        const clampBaseWp = [
          `${originLat + cb1dLat},${originLng + cb1dLng}`,
          `${originLat + cb2dLat},${originLng + cb2dLng}`,
        ];

        // Still short of the nap: add more stops to force a longer drive.
        if (ratio < 0.92) {
          const extraBearings: number[] = [];
          if (attempt >= 1 || clampedDuration >= 45) {
            extraBearings.push(isHighway ? 90 : isScenic ? 315 : 240);
          }
          if (attempt >= 2 || (ratio < 0.85 && clampedDuration >= 50)) {
            extraBearings.push((useB1 + useB2) / 2);
          }
          if (attempt >= 4 || (ratio < 0.8 && clampedDuration >= 60)) {
            extraBearings.push((useB1 + 180) % 360);
          }
          extraBearings.forEach((bearing, idx) => {
            const scale = cumulativeScale * (0.75 - idx * 0.08);
            const [dY, dX] = bearing2xy(bearing, Math.max(0.35, scale));
            clampBaseWp.push(`${originLat + dY},${originLng + dX}`);
          });
        }

        const clampWp = [...clampBaseWp, ...extraStops];
        const clampData = await fetchDrive(clampWp, relaxAvoid);
        if (clampData.status === 'OK' && clampData.legs.length > 0) {
          drive = clampData;
        } else if (__DEV__) {
          console.log(`[route] clamp attempt=${attempt + 1} status=${clampData.status}`);
          cumulativeScale = Math.max(0.4, cumulativeScale * 0.85);
        }
      }

      // Prefer the closest match to the nap timer if the final attempt drifted.
      const finalError = Math.abs(routeDurationSecs(drive) - targetSecs);
      if (finalError > bestAbsError) {
        drive = bestData;
      }
      if (__DEV__) {
        const finalMins = Math.round(routeDurationSecs(drive) / 60);
        console.log(
          `[route] final duration=${finalMins}min target=${clampedDuration}min source=${drive.source}`,
        );
      }
    }

    if (drive.status !== 'OK' || !drive.legs.length) {
      const isNotEnabled =
        drive.status === 'REQUEST_DENIED' || drive.status === 'PERMISSION_DENIED';
      throw new RouteError(
        isNotEnabled
          ? 'Directions / Routes API not enabled. Enable them in Google Cloud Console → APIs & Services.'
          : 'Could not calculate route. Try a different address or route type.',
        drive.status,
      );
    }

    const totalDurationSecs = drive.durationSeconds;
    const snappedWaypoints = drive.legs.slice(0, -1).map(leg => ({
      lat: leg.end.lat,
      lng: leg.end.lng,
    }));
    const primaryWaypoint = snappedWaypoints[0] ?? {
      lat: waypointLat,
      lng: waypointLng,
    };

    // ── Street View snapshot ──────────────────────────────────────────────────
    let streetViewUrl: string | null = null;
    try {
      const allSteps = drive.legs.flatMap(leg => leg.steps);
      const previewStep =
        allSteps[Math.floor(allSteps.length * 0.4)] ?? allSteps[0];
      const svLat = previewStep?.start.lat ?? primaryWaypoint.lat;
      const svLng = previewStep?.start.lng ?? primaryWaypoint.lng;

      const metaRes = await fetch(
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${svLat},${svLng}&radius=200&key=${apiKey}`,
      );
      const metaData = (await metaRes.json()) as { status: string };

      if (metaData.status === 'OK') {
        streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x200&location=${svLat},${svLng}&fov=90&pitch=0&radius=200&key=${apiKey}`;
      }
    } catch {
      // Street View is optional
    }

    if (__DEV__) {
      const mins = Math.round(totalDurationSecs / 60);
      const gap = mins - clampedDuration;
      console.log(
        `[route] done style=${routeType} duration=${mins}min target=${clampedDuration}min ` +
          `gap=${gap >= 0 ? '+' : ''}${gap} stops=${snappedWaypoints.length} source=${drive.source}`,
      );
    }

    return {
      polyline: drive.polyline,
      durationSeconds: totalDurationSecs,
      durationText: `${Math.round(totalDurationSecs / 60)} min`,
      summary: drive.summary,
      isLoop: !destination,
      destination,
      streetViewUrl,
      origin: { lat: originLat, lng: originLng },
      waypoint: primaryWaypoint,
      allWaypoints: snappedWaypoints,
      extraStops,
      legs: drive.legs.map(leg => ({
        distance: leg.distanceText,
        duration: leg.durationText,
        steps: leg.steps.map(s => ({
          instruction: s.instruction,
          distance: s.distanceText,
          duration: s.durationText,
          endLocation: { lat: s.end.lat, lng: s.end.lng },
        })),
      })),
    };
  } catch (err) {
    if (err instanceof RouteError) throw err;
    console.error('maps.route.error', err);
    throw new RouteError('Failed to calculate route');
  }
}

export interface FindDirectRouteParams {
  origin: string;
  destination: string;
  /** Prefer local roads when the nap used a non-highway style. */
  avoidHighways?: boolean;
}

/**
 * Straight A→B drive with no nap waypoints or extra stops.
 * Used when the nap timer ends so the driver heads directly home / to destination.
 */
export async function findDirectRoute(
  params: FindDirectRouteParams,
): Promise<RouteResult> {
  const { origin, destination, avoidHighways = false } = params;

  if (!origin || !destination) {
    throw new RouteError('origin and destination are required');
  }

  try {
    const drive = await computeTrafficAwareDrive({
      origin,
      destination,
      avoidHighways,
    });

    if (drive.status !== 'OK' || !drive.legs.length) {
      throw new RouteError(
        'Could not calculate a direct route to your destination.',
        drive.status,
      );
    }

    const originPoint = drive.legs[0]?.start ?? { lat: 0, lng: 0 };
    const end = drive.legs[drive.legs.length - 1]?.end ?? originPoint;

    return {
      polyline: drive.polyline,
      durationSeconds: drive.durationSeconds,
      durationText: `${Math.round(drive.durationSeconds / 60)} min`,
      summary: drive.summary || 'Direct to destination',
      isLoop: false,
      destination,
      streetViewUrl: null,
      origin: originPoint,
      waypoint: { lat: end.lat, lng: end.lng },
      allWaypoints: [],
      extraStops: [],
      legs: drive.legs.map(leg => ({
        distance: leg.distanceText,
        duration: leg.durationText,
        steps: leg.steps.map(s => ({
          instruction: s.instruction,
          distance: s.distanceText,
          duration: s.durationText,
          endLocation: { lat: s.end.lat, lng: s.end.lng },
        })),
      })),
    };
  } catch (err) {
    if (err instanceof RouteError) throw err;
    console.error('maps.directRoute.error', err);
    throw new RouteError('Failed to calculate direct route');
  }
}
