/**
 * Theme-aware categorical chart palette.
 *
 * Each entry resolves from a CSS variable defined in `index.css` (light and
 * dark variants), so Recharts marks adapt automatically to the active theme
 * instead of being locked to hard-coded hex/HSL values.
 */
export const CHART_SERIES = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--chart-7))",
  "hsl(var(--chart-8))",
] as const;

/** Pick a series color by index, wrapping around the palette. */
export const chartColorAt = (index: number): string =>
  CHART_SERIES[index % CHART_SERIES.length];
