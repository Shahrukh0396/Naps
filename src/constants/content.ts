import type { RouteStyleId } from '../types/route';

export const DURATIONS = [
  { label: '30 min', value: 30 },
  { label: '40 min', value: 40 },
  { label: '1 hr', value: 60 },
  { label: '1.5 hr', value: 90 },
  { label: '2 hr', value: 120 },
] as const;

/** Quick chips + wheel values for extending an active nap. */
export const EXTEND_PRESETS = [5, 10, 15, 20, 30] as const;
export const EXTEND_WHEEL_MINUTES = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
] as const;

export const ROUTE_TYPES: Array<{
  id: RouteStyleId;
  emoji: string;
  label: string;
  sublabel: string;
}> = [
    { id: 'highway', emoji: '🛣️', label: 'Highway', sublabel: 'Avoid tolls' },
    { id: 'no-highway', emoji: '🌿', label: 'No Highway', sublabel: 'Local roads only' },
    { id: 'scenic', emoji: '🏞️', label: 'Scenic', sublabel: 'Parks & nature' },
    { id: 'fewer-lights', emoji: '🛤️', label: 'Fewer Stops', sublabel: 'Long stretches, no lights' },
  ];

export const ROUTE_TYPE_META: Record<
  RouteStyleId,
  { emoji: string; label: string; sublabel: string }
> = {
  highway: { emoji: '🛣️', label: 'Highway', sublabel: 'Fast roads & freeways' },
  'no-highway': { emoji: '🌿', label: 'No Highway', sublabel: 'Local roads only' },
  scenic: { emoji: '🏞️', label: 'Scenic', sublabel: 'Parks & nature' },
  'fewer-lights': { emoji: '🛤️', label: 'Fewer Stops', sublabel: 'Long stretches, no lights' },
};

export const NOTIFY_OPTIONS = [
  { label: '2 min before', value: 2 },
  { label: '5 min before', value: 5 },
  { label: '10 min before', value: 10 },
  { label: 'At end', value: 0 },
] as const;

export const COMPANY_TAGLINE = 'Powered by Linton Tech LLC';
export const COMPANY_COPYRIGHT = '© 2026';
export const PRIVACY_POLICY_URL = 'https://vsirj7j0qh.c37.airoapp.ai/privacy';

export const SUPPORT_FAQS = [
  {
    q: 'How does Naps pick a route?',
    a: 'Naps builds a loop (or destination) drive that matches your nap length and the route style you selected, then ranks same-style options by how close they are to your target time.',
  },
  {
    q: 'Does Naps store my location?',
    a: 'No. Location is used only to calculate routes in the moment and is not stored or shared.',
  },
  {
    q: 'Can I open the route in Google Maps?',
    a: 'Begin Nap starts in-app turn-by-turn on the Naps map. Stops are collected like checkpoints around half a kilometer away, so you can keep driving without tapping Next. Spoken turn-by-turn plays while you drive. Extend updates the route while the timer stays in Naps.',
  },
  {
    q: 'What is the nap timer for?',
    a: 'The timer tracks your drive and alerts you a few minutes before the nap ends — even while Google Maps is open — so you can head home on time.',
  },
];
