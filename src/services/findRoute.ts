import { GOOGLE_MAPS_API_KEY } from '../config/maps';
import type { RouteResult, RouteStyleId } from '../types/route';

export interface FindRouteParams {
  origin: string;
  destination?: string | null;
  durationMinutes: number;
  routeTypes: RouteStyleId[];
  extraStops?: string[];
  /** Rotate waypoint bearings to generate alternate paths on refresh. */
  variation?: number;
}

export class RouteError extends Error {
  details?: string;
  constructor(message: string, details?: string) {
    super(message);
    this.name = 'RouteError';
    this.details = details;
  }
}

export async function findRoute(params: FindRouteParams): Promise<RouteResult> {
  const {
    origin,
    destination = null,
    durationMinutes,
    routeTypes,
    extraStops = [],
    variation = 0,
  } = params;

  if (!origin || !durationMinutes) {
    throw new RouteError('origin and durationMinutes are required');
  }

  try {

    // Enforce 30-minute minimum — shorter drives don't produce meaningful loops
    const clampedDuration = Math.max(30, durationMinutes);

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
    const totalRoadMiles = (clampedDuration / 60) * avgSpeedMph;
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

    const avoidParts: string[] = [];
    if (avoidHighways) avoidParts.push('highways');
    if (avoidTolls)    avoidParts.push('tolls');
    const avoidStr = avoidParts.length ? `&avoid=${avoidParts.join('|')}` : '';

    // ── Build Directions URL ──────────────────────────────────────────────────
    // IMPORTANT: waypoints must be pipe-separated with literal | (not %7C).
    // For loops we use regular stop waypoints (NOT via:) so Google is forced to
    // actually route through each point rather than snapping them away.
    // via: waypoints with same origin=destination collapse to zero distance.
    // departure_time is only used for point-to-point (via: incompatibility aside,
    // traffic data on loops is unreliable since the route shape is artificial).

    let directionsUrl: string;

    if (destination) {
      // Point-to-point: origin → wp1 (midpoint) → custom destination
      const waypointsStr = [`${wp1Lat},${wp1Lng}`, ...extraStops].join('|');
      directionsUrl = `https://maps.googleapis.com/maps/api/directions/json`
        + `?origin=${originLat},${originLng}`
        + `&destination=${encodeURIComponent(destination)}`
        + `&waypoints=${waypointsStr}`
        + `&mode=driving`
        + avoidStr
        + `&departure_time=now`
        + `&traffic_model=best_guess`
        + `&key=${apiKey}`;
    } else {
      // Loop: origin → wp1 → wp2 → origin
      // Two stop waypoints at different compass bearings force a triangular circuit.
      // A 3rd waypoint is added dynamically in the clamp loop for long drives that
      // can't reach the target duration with just two waypoints.
      const waypointsStr = [`${wp1Lat},${wp1Lng}`, `${wp2Lat},${wp2Lng}`, ...extraStops].join('|');
      directionsUrl = `https://maps.googleapis.com/maps/api/directions/json`
        + `?origin=${originLat},${originLng}`
        + `&destination=${originLat},${originLng}`
        + `&waypoints=${waypointsStr}`
        + `&mode=driving`
        + avoidStr
        + `&key=${apiKey}`;
    }

    if (__DEV__) {
      console.log('[route] url (no key):', directionsUrl.replace(String(apiKey), 'KEY'));
    }

    let directionsRes  = await fetch(directionsUrl);
    let directionsData = await directionsRes.json() as {
      status: string;
      routes: Array<{
        overview_polyline: { points: string };
        legs: Array<{
          duration:            { value: number; text: string };
          duration_in_traffic?: { value: number; text: string };
          distance:            { value: number; text: string };
          start_location:      { lat: number; lng: number };
          end_location:        { lat: number; lng: number };
          steps: Array<{
            html_instructions: string;
            distance:          { text: string };
            duration:          { text: string };
            start_location:    { lat: number; lng: number };
            end_location:      { lat: number; lng: number };
          }>;
        }>;
        summary: string;
      }>;
    };

    // If ZERO_RESULTS (e.g. waypoint landed in ocean/unreachable area),
    // retry with progressively smaller radii (75%, 50%, 25%) before giving up.
    if (!destination && directionsData.status === 'ZERO_RESULTS') {
      for (const scale of [0.75, 0.5, 0.25]) {
        const rw1Lat = originLat + w1dLat * scale;
        const rw1Lng = originLng + w1dLng * scale;
        const rw2Lat = originLat + w2dLat * scale;
        const rw2Lng = originLng + w2dLng * scale;
        const retryWp = [`${rw1Lat},${rw1Lng}`, `${rw2Lat},${rw2Lng}`, ...extraStops].join('|');
        const retryUrl = `https://maps.googleapis.com/maps/api/directions/json`
          + `?origin=${originLat},${originLng}`
          + `&destination=${originLat},${originLng}`
          + `&waypoints=${retryWp}`
          + `&mode=driving`
          + avoidStr
          + `&key=${apiKey}`;
        const retryRes  = await fetch(retryUrl);
        const retryData = await retryRes.json() as typeof directionsData;
        if (retryData.status === 'OK') {
          directionsData = retryData;
          break;
        }
      }
    }

    // ── Duration-clamp retry (loops only) ────────────────────────────────────
    // If Google returns a route significantly longer/shorter than the target,
    // scale the waypoint radius and retry. Uses cumulative scaling so each
    // attempt builds on the previous correction.
    // Tolerance: ±12%. Max 6 attempts, then a highway-relaxation fallback for
    // long non-highway routes that run out of local roads.
    if (!destination && directionsData.status === 'OK' && directionsData.routes[0]) {
      const targetSecs = clampedDuration * 60;
      const tolerance  = 0.12;
      let cumulativeScale = 1.0;

      const altBearingPairs: Array<[number, number]> = [
        [60,  180],
        [90,  210],
        [30,  150],
        [0,   135],
        [45,  165],
      ];
      let altBearingIdx = 0;
      let prevRatio = Infinity;

      for (let attempt = 0; attempt < 8; attempt++) {
        const actualSecs = directionsData.routes[0].legs.reduce(
          (sum, leg) => sum + (leg.duration_in_traffic?.value ?? leg.duration.value), 0
        );
        const ratio = actualSecs / targetSecs;
        if (ratio >= (1 - tolerance) && ratio <= (1 + tolerance)) break;

        const improvement = Math.abs(prevRatio - ratio) / prevRatio;
        let useB1 = b1, useB2 = b2;
        if (attempt > 0 && improvement < 0.05 && altBearingIdx < altBearingPairs.length) {
          [useB1, useB2] = altBearingPairs[altBearingIdx++];
        }
        prevRatio = ratio;

        // For long non-highway routes (not scenic) that are undershooting (ratio < 0.85),
        // the local road network is exhausted — relax the highway avoid so Google can
        // use arterials/expressways to fill the time. Scenic keeps its avoid to preserve
        // the route character; it just gets a larger radius instead.
        const effectiveAvoidStr = (avoidHighways && !isScenic && ratio < 0.85 && clampedDuration >= 60)
          ? ''   // relax highway avoid for no-highway / fewer-lights at long durations
          : avoidStr;
        if (effectiveAvoidStr !== avoidStr && __DEV__) {
          console.log(`[route] relaxing highway avoid (ratio=${ratio.toFixed(2)}, target=${clampedDuration}min)`);
        }

        // Scenic routes need a higher scale ceiling — winding roads require
        // pushing waypoints much further out to accumulate enough drive time.
        const maxScale = isScenic ? 10.0 : 6.0;
        cumulativeScale = Math.min(maxScale, Math.max(0.15, cumulativeScale / ratio));
        if (__DEV__) {
          console.log(`[route] clamp attempt=${attempt + 1} ratio=${ratio.toFixed(2)} cumScale=${cumulativeScale.toFixed(3)}`);
        }

        const [cb1dLat, cb1dLng] = bearing2xy(useB1, cumulativeScale);
        const [cb2dLat, cb2dLng] = bearing2xy(useB2, cumulativeScale);
        const cw1Lat = originLat + cb1dLat;
        const cw1Lng = originLng + cb1dLng;
        const cw2Lat = originLat + cb2dLat;
        const cw2Lng = originLng + cb2dLng;
        const clampBaseWp = [`${cw1Lat},${cw1Lng}`, `${cw2Lat},${cw2Lng}`];
        // After 3 failed attempts on a long drive that's still undershooting,
        // add a 3rd waypoint to create a quadrilateral loop with more road surface.
        // Only add when ratio < 0.88 (still significantly short) to avoid overshoot.
        if (attempt >= 3 && ratio < 0.88 && clampedDuration >= 75) {
          // Land-biased 3rd bearing: E for highway (freeways go east), NW for scenic
          // (Marin/hills), SW for others (south bay arterials)
          const b3 = isHighway ? 90 : isScenic ? 315 : 240;
          const [cb3dLat, cb3dLng] = bearing2xy(b3, cumulativeScale * 0.7);
          clampBaseWp.push(`${originLat + cb3dLat},${originLng + cb3dLng}`);
        }
        const clampWp  = [...clampBaseWp, ...extraStops].join('|');
        const clampUrl = `https://maps.googleapis.com/maps/api/directions/json`
          + `?origin=${originLat},${originLng}`
          + `&destination=${originLat},${originLng}`
          + `&waypoints=${clampWp}`
          + `&mode=driving`
          + effectiveAvoidStr
          + `&key=${apiKey}`;
        const clampRes  = await fetch(clampUrl);
        const clampData = await clampRes.json() as typeof directionsData;
        if (clampData.status === 'OK') {
          directionsData = clampData;
        } else {
          break;
        }
      }
    }

    if (directionsData.status !== 'OK' || !directionsData.routes[0]) {
      const isNotEnabled = directionsData.status === 'REQUEST_DENIED';
      throw new RouteError(
        isNotEnabled
          ? 'Directions API not enabled. Please enable it in Google Cloud Console → APIs & Services.'
          : 'Could not calculate route. Try a different address or route type.',
        directionsData.status,
      );
    }

    const route = directionsData.routes[0];
    const totalDurationSecs = route.legs.reduce(
      (sum, leg) => sum + (leg.duration_in_traffic?.value ?? leg.duration.value),
      0,
    );

    // ── Street View snapshot ──────────────────────────────────────────────────
    let streetViewUrl: string | null = null;
    try {
      const allSteps = route.legs.flatMap((leg) => leg.steps);
      const previewStep = allSteps[Math.floor(allSteps.length * 0.4)] ?? allSteps[0];
      const svLat = previewStep?.start_location.lat ?? waypointLat;
      const svLng = previewStep?.start_location.lng ?? waypointLng;

      const metaRes  = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${svLat},${svLng}&radius=200&key=${apiKey}`);
      const metaData = await metaRes.json() as { status: string };

      if (metaData.status === 'OK') {
        streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x200&location=${svLat},${svLng}&fov=90&pitch=0&radius=200&key=${apiKey}`;
      }
    } catch {
      // Street View is optional
    }

    return {
      polyline: route.overview_polyline.points,
      durationSeconds: totalDurationSecs,
      durationText: `${Math.round(totalDurationSecs / 60)} min`,
      summary: route.summary,
      isLoop: !destination,
      destination,
      streetViewUrl,
      origin: { lat: originLat, lng: originLng },
      waypoint: { lat: waypointLat, lng: waypointLng },
      allWaypoints: route.legs.slice(0, -1).map(leg => ({
        lat: leg.end_location.lat,
        lng: leg.end_location.lng,
      })),
      extraStops,
      legs: route.legs.map(leg => ({
        distance: leg.distance.text,
        duration: (leg.duration_in_traffic ?? leg.duration).text,
        steps: leg.steps.map(s => ({
          instruction: s.html_instructions.replace(/<[^>]+>/g, ''),
          distance: s.distance.text,
          duration: s.duration.text,
          endLocation: { lat: s.end_location.lat, lng: s.end_location.lng },
        })),
      })),
    };
  } catch (err) {
    if (err instanceof RouteError) throw err;
    console.error('maps.route.error', err);
    throw new RouteError('Failed to calculate route');
  }
}
