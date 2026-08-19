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

const ALL_STYLES: RouteStyleId[] = [
  'highway',
  'no-highway',
  'scenic',
  'fewer-lights',
];

function pickSuggestionStyles(
  preferred: RouteStyleId,
  refreshIndex: number,
): RouteStyleId[] {
  if (refreshIndex === 0) {
    return [preferred, ...ALL_STYLES.filter(s => s !== preferred)].slice(0, 3);
  }
  const start = refreshIndex % ALL_STYLES.length;
  const rotated = [
    ...ALL_STYLES.slice(start),
    ...ALL_STYLES.slice(0, start),
  ];
  return rotated.slice(0, 3);
}

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
): RouteVariant {
  const meta = ROUTE_TYPE_META[styleId];
  const mins = Math.round(data.durationSeconds / 60);
  return {
    id: styleId,
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
  routesById: Partial<Record<RouteStyleId, RouteResult>>;
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
  const styles = pickSuggestionStyles(params.preferredStyle, refreshIndex);

  const variants: RouteVariant[] = [];
  const routesById: Partial<Record<RouteStyleId, RouteResult>> = {};
  const restrictedOptions: RestrictedRouteOption[] = [];

  const collect = async (styleIds: RouteStyleId[], variation: number) => {
    const pending = styleIds.filter(
      id => !routesById[id] && !restrictedOptions.some(o => o.styleId === id),
    );
    if (pending.length === 0) return;

    const results = await Promise.allSettled(
      pending.map(styleId =>
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
      const styleId = pending[idx];
      if (result.status !== 'fulfilled') return;
      const data = { ...result.value, destination: params.destination };
      const variant = toVariant(styleId, data, params.durationMinutes);
      const restrictedCount = data.restrictedNear?.count ?? 0;

      if (restrictedCount > 0) {
        restrictedOptions.push({
          styleId,
          route: data,
          variant,
          restrictedCount,
          restrictedTitles: data.restrictedNear?.titles ?? [],
        });
        return;
      }

      routesById[styleId] = data;
      variants.push(variant);
    });
  };

  await collect(styles, refreshIndex);

  if (variants.length < 3) {
    await collect(
      ALL_STYLES.filter(id => !routesById[id]),
      refreshIndex + 1,
    );
  }

  if (variants.length < 3) {
    await collect(
      ALL_STYLES.filter(id => !routesById[id]),
      refreshIndex + 2,
    );
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
      activeStyle: params.preferredStyle,
      routesById: {},
      refreshIndex,
      restrictedOptions,
    };
  }

  const ranked = [...variants].sort((a, b) => b.napMatchScore - a.napMatchScore);
  const top3 = ranked.slice(0, 3);

  let activeStyle = top3[0].id;
  if (
    refreshIndex === 0 &&
    top3.some(v => v.id === params.preferredStyle)
  ) {
    activeStyle = params.preferredStyle;
  }

  const primary = routesById[activeStyle];
  if (!primary) {
    throw new RouteError(
      'Could not calculate a route. Try a different address or route type.',
    );
  }

  return {
    variants: top3,
    primary,
    activeStyle,
    routesById,
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
