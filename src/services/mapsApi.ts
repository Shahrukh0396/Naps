import { ROUTE_TYPE_META } from '../constants/content';
import { calcNapMatch } from '../mocks/routes';
import type {
  LatLng,
  RestrictedRouteOption,
  RouteResult,
  RouteStyleId,
  RouteVariant,
} from '../types/route';
import { findDirectRoute, findRoute } from './findRoute';
import { RouteError } from './routeError';

export { findRoute, findDirectRoute, RouteError };

const SUGGESTION_COUNT = 3;

function parseOriginCoord(origin: string): LatLng | null {
  const parts = origin.split(',');
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function emptyMapRoute(
  origin: LatLng,
  destination: string | null,
): RouteResult {
  return {
    polyline: '',
    durationSeconds: 0,
    durationText: '—',
    summary: '',
    isLoop: !destination,
    destination,
    streetViewUrl: null,
    origin,
    waypoint: origin,
    allWaypoints: [],
    extraStops: [],
    legs: [],
  };
}

function toVariant(
  styleId: RouteStyleId,
  data: RouteResult,
  durationMinutes: number,
  variation: number,
): RouteVariant {
  const meta = ROUTE_TYPE_META[styleId];
  const mins = Math.round(data.durationSeconds / 60);
  return {
    id: styleId,
    variation,
    emoji: meta.emoji,
    label: meta.label,
    sublabel: meta.sublabel,
    durationMinutes: mins,
    durationText: data.durationText,
    summary: data.summary,
    napMatchScore: calcNapMatch(mins, durationMinutes),
    isLoop: data.isLoop,
  };
}

export interface RouteSuggestionsResult {
  variants: RouteVariant[];
  primary: RouteResult;
  activeStyle: RouteStyleId;
  activeVariation: number;
  routesByVariation: Record<number, RouteResult>;
  refreshIndex: number;
  restrictedOptions: RestrictedRouteOption[];
}

export async function findRouteSuggestions(params: {
  origin: string;
  destination: string | null;
  durationMinutes: number;
  preferredStyle: RouteStyleId;
  extraStops?: string[];
  refreshIndex?: number;
}): Promise<RouteSuggestionsResult> {
  const refreshIndex = params.refreshIndex ?? 0;
  const extraStops = params.extraStops ?? [];
  const styleId = params.preferredStyle;

  const variants: RouteVariant[] = [];
  const routesByVariation: Record<number, RouteResult> = {};
  const restrictedOptions: RestrictedRouteOption[] = [];
  const attempted = new Set<number>();

  const collect = async (variationIds: number[]) => {
    const pending = variationIds.filter(id => !attempted.has(id));
    pending.forEach(id => attempted.add(id));
    if (pending.length === 0) return;

    const results = await Promise.allSettled(
      pending.map(variation =>
        findRoute({
          origin: params.origin,
          destination: params.destination,
          durationMinutes: params.durationMinutes,
          routeTypes: [styleId],
          extraStops,
          variation,
          avoidRestricted: true,
        }),
      ),
    );

    results.forEach((result, idx) => {
      const variation = pending[idx];
      if (result.status !== 'fulfilled') return;
      const data = { ...result.value, destination: params.destination };
      const variant = toVariant(
        styleId,
        data,
        params.durationMinutes,
        variation,
      );
      const restrictedCount = data.restrictedNear?.count ?? 0;

      if (restrictedCount > 0) {
        restrictedOptions.push({
          styleId,
          variation,
          route: data,
          variant,
          restrictedCount,
          restrictedTitles: data.restrictedNear?.titles ?? [],
        });
        return;
      }

      routesByVariation[variation] = data;
      variants.push(variant);
    });
  };

  const batch = (offset: number) =>
    Array.from({ length: SUGGESTION_COUNT }, (_, i) => offset + i);

  await collect(batch(refreshIndex));
  if (variants.length < SUGGESTION_COUNT) {
    await collect(batch(refreshIndex + SUGGESTION_COUNT));
  }
  if (variants.length < SUGGESTION_COUNT) {
    await collect(batch(refreshIndex + SUGGESTION_COUNT * 2));
  }

  restrictedOptions.sort((a, b) => {
    if (a.restrictedCount !== b.restrictedCount) {
      return a.restrictedCount - b.restrictedCount;
    }
    return b.variant.napMatchScore - a.variant.napMatchScore;
  });

  if (variants.length === 0) {
    const origin = parseOriginCoord(params.origin);
    if (!origin) {
      throw new RouteError(
        'Could not calculate a route. Try a different address or route type.',
      );
    }
    return {
      variants: [],
      primary: emptyMapRoute(origin, params.destination),
      activeStyle: styleId,
      activeVariation: refreshIndex,
      routesByVariation: {},
      refreshIndex,
      restrictedOptions,
    };
  }

  const ranked = [...variants].sort((a, b) => b.napMatchScore - a.napMatchScore);
  const top3 = ranked.slice(0, SUGGESTION_COUNT);
  const activeVariation = top3[0].variation;
  const primary = routesByVariation[activeVariation];
  if (!primary) {
    throw new RouteError(
      'Could not calculate a route. Try a different address or route type.',
    );
  }

  return {
    variants: top3,
    primary,
    activeStyle: styleId,
    activeVariation,
    routesByVariation,
    refreshIndex,
    restrictedOptions,
  };
}

export async function findAllRouteVariants(params: {
  origin: string;
  destination: string | null;
  durationMinutes: number;
  preferredStyle: RouteStyleId;
  extraStops?: string[];
}): Promise<{ variants: RouteVariant[]; primary: RouteResult; activeStyle: RouteStyleId }> {
  const result = await findRouteSuggestions(params);
  return {
    variants: result.variants,
    primary: result.primary,
    activeStyle: result.activeStyle,
  };
}
