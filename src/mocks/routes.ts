import type { RouteResult, RouteStyleId, RouteVariant } from '../types/route';
import { ROUTE_TYPE_META } from '../constants/content';

const MOCK_ORIGIN = { lat: 37.7749, lng: -122.4194 };

const STYLE_OFFSETS: Record<RouteStyleId, number> = {
  highway: 0,
  'no-highway': 4,
  scenic: -3,
  'fewer-lights': 2,
};

const STYLE_SUMMARIES: Record<RouteStyleId, string> = {
  highway: 'US-101 N',
  'no-highway': 'Mission St / Valencia',
  scenic: 'Golden Gate Park loop',
  'fewer-lights': 'Geary Blvd corridor',
};

export function calcNapMatch(durationMins: number, targetMins: number): number {
  const diff = Math.abs(durationMins - targetMins);
  return Math.max(0, Math.round(100 - (diff / 20) * 100));
}

export function napMatchLabel(score: number): { text: string; color: string } {
  if (score >= 90) return { text: 'Perfect match', color: '#2D7D2D' };
  if (score >= 70) return { text: 'Good match', color: '#5A7D2D' };
  if (score >= 50) return { text: 'Close', color: '#8B6A00' };
  return { text: 'Off target', color: '#9B4444' };
}

function buildMockRoute(
  styleId: RouteStyleId,
  targetMinutes: number,
  destination: string | null,
  extraStops: string[],
): RouteResult {
  const mins = Math.max(20, targetMinutes + STYLE_OFFSETS[styleId]);
  const isLoop = !destination;
  return {
    polyline: '',
    durationSeconds: mins * 60,
    durationText: mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} mins`,
    summary: STYLE_SUMMARIES[styleId],
    isLoop,
    destination,
    streetViewUrl: null,
    origin: MOCK_ORIGIN,
    waypoint: {
      lat: MOCK_ORIGIN.lat + 0.03 + STYLE_OFFSETS[styleId] * 0.001,
      lng: MOCK_ORIGIN.lng + 0.04,
    },
    allWaypoints: [
      {
        lat: MOCK_ORIGIN.lat + 0.015,
        lng: MOCK_ORIGIN.lng + 0.02,
      },
    ],
    extraStops,
    legs: [
      {
        distance: `${(mins * 0.4).toFixed(1)} mi`,
        duration: `${mins} mins`,
        steps: [
          {
            instruction: 'Head north on Market St',
            distance: '0.4 mi',
            duration: '2 mins',
          },
          {
            instruction: 'Turn right onto Van Ness Ave',
            distance: '1.2 mi',
            duration: '5 mins',
          },
          {
            instruction: styleId === 'scenic' ? 'Continue through Golden Gate Park' : 'Merge onto US-101 N',
            distance: '3.8 mi',
            duration: `${Math.max(8, Math.round(mins * 0.35))} mins`,
          },
          {
            instruction: isLoop ? 'Return toward starting point' : `Arrive at ${destination}`,
            distance: '2.1 mi',
            duration: `${Math.max(6, Math.round(mins * 0.25))} mins`,
          },
        ],
      },
    ],
  };
}

export async function mockFindRoutes(params: {
  durationMinutes: number;
  destination: string | null;
  extraStops: string[];
  preferredStyle: RouteStyleId;
}): Promise<{ variants: RouteVariant[]; primary: RouteResult; activeStyle: RouteStyleId }> {
  // Simulate network latency
  await new Promise<void>(r => setTimeout(r, 900));

  const styles: RouteStyleId[] = ['highway', 'no-highway', 'scenic', 'fewer-lights'];
  const routes = styles.map(id => buildMockRoute(id, params.durationMinutes, params.destination, params.extraStops));

  const variants: RouteVariant[] = styles.map((id, i) => {
    const route = routes[i];
    const mins = Math.round(route.durationSeconds / 60);
    const meta = ROUTE_TYPE_META[id];
    return {
      id,
      emoji: meta.emoji,
      label: meta.label,
      sublabel: meta.sublabel,
      durationMinutes: mins,
      durationText: route.durationText,
      summary: route.summary,
      napMatchScore: calcNapMatch(mins, params.durationMinutes),
      isLoop: route.isLoop,
    };
  });

  let activeStyle = params.preferredStyle;
  let primary = routes[styles.indexOf(activeStyle)];
  if (!primary) {
    const best = [...variants].sort((a, b) => b.napMatchScore - a.napMatchScore)[0];
    activeStyle = best.id;
    primary = routes[styles.indexOf(activeStyle)];
  }

  return { variants, primary, activeStyle };
}

export async function mockFetchRouteStyle(params: {
  styleId: RouteStyleId;
  durationMinutes: number;
  destination: string | null;
  extraStops: string[];
}): Promise<RouteResult> {
  await new Promise<void>(r => setTimeout(r, 500));
  return buildMockRoute(params.styleId, params.durationMinutes, params.destination, params.extraStops);
}

export const MOCK_GPS = MOCK_ORIGIN;
