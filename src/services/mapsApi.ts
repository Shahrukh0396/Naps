import { ROUTE_TYPE_META } from '../constants/content';
import { calcNapMatch } from '../mocks/routes';
import type { RouteResult, RouteStyleId, RouteVariant } from '../types/route';
import { findDirectRoute, findRoute } from './findRoute';
import { RouteError } from './routeError';

export { findRoute, findDirectRoute, RouteError };

const ALL_STYLES: RouteStyleId[] = [
  'highway',
  'no-highway',
  'scenic',
  'fewer-lights',
];

/** Pick up to 3 styles for this suggestion batch. Preferred style leads on first load. */
function pickSuggestionStyles(
  preferred: RouteStyleId,
  refreshIndex: number,
): RouteStyleId[] {
  if (refreshIndex === 0) {
    return [preferred, ...ALL_STYLES.filter(s => s !== preferred)].slice(0, 3);
  }
  // Rotate which styles appear so refresh feels like a new set
  const start = refreshIndex % ALL_STYLES.length;
  const rotated = [
    ...ALL_STYLES.slice(start),
    ...ALL_STYLES.slice(0, start),
  ];
  return rotated.slice(0, 3);
}

export interface RouteSuggestionsResult {
  variants: RouteVariant[];
  primary: RouteResult;
  activeStyle: RouteStyleId;
  routesById: Partial<Record<RouteStyleId, RouteResult>>;
  refreshIndex: number;
}

/**
 * Returns exactly up to 3 nap-matched route suggestions.
 * Pass a higher refreshIndex to get alternate paths (bearing rotation + style mix).
 */
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

  const results = await Promise.allSettled(
    styles.map(styleId =>
      findRoute({
        origin: params.origin,
        destination: params.destination,
        durationMinutes: params.durationMinutes,
        routeTypes: [styleId],
        extraStops,
        variation: refreshIndex,
      }),
    ),
  );

  const variants: RouteVariant[] = [];
  const routesById: Partial<Record<RouteStyleId, RouteResult>> = {};

  results.forEach((result, idx) => {
    const styleId = styles[idx];
    const meta = ROUTE_TYPE_META[styleId];
    if (result.status === 'fulfilled') {
      const data = { ...result.value, destination: params.destination };
      const mins = Math.round(data.durationSeconds / 60);
      routesById[styleId] = data;
      variants.push({
        id: styleId,
        emoji: meta.emoji,
        label: meta.label,
        sublabel: meta.sublabel,
        durationMinutes: mins,
        durationText: data.durationText,
        summary: data.summary,
        napMatchScore: calcNapMatch(mins, params.durationMinutes),
        isLoop: data.isLoop,
      });
    }
  });

  if (variants.length === 0) {
    const firstReject = results.find(r => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    const msg =
      firstReject?.reason instanceof RouteError
        ? firstReject.reason.message
        : 'Could not calculate any routes. Try a different address or route type.';
    throw new RouteError(msg);
  }

  const ranked = [...variants].sort((a, b) => b.napMatchScore - a.napMatchScore);
  const top3 = ranked.slice(0, 3);

  // Prefer user's preferred style if it made the top 3 and this is the first batch
  let activeStyle = top3[0].id;
  if (
    refreshIndex === 0 &&
    top3.some(v => v.id === params.preferredStyle)
  ) {
    activeStyle = params.preferredStyle;
  }

  const primary = routesById[activeStyle];
  if (!primary) {
    throw new RouteError('Could not calculate a route. Try a different address or route type.');
  }

  return {
    variants: top3,
    primary,
    activeStyle,
    routesById,
    refreshIndex,
  };
}

/** @deprecated use findRouteSuggestions — kept for any leftover callers */
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
