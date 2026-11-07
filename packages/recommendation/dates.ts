export function dateOnly(date: Date): string { return date.toISOString().slice(0, 10); }
export function daysAgo(days: number, now = new Date()): string {
  const date = new Date(dateOnly(now) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - days);
  return dateOnly(date);
}
export function releaseAge(releaseDate: string | undefined, now = new Date()): number {
  if (!releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return Infinity;
  const parsed = new Date(releaseDate + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || dateOnly(parsed) !== releaseDate) return Infinity;
  return Math.floor((Date.parse(dateOnly(now)) - parsed.getTime()) / 86_400_000);
}
export function inReleaseWindow(date: string | undefined, minimum: number, maximum: number, now = new Date()): boolean {
  const age = releaseAge(date, now);
  return age >= minimum && age <= maximum;
}
export function releaseWindow(catalog: string): [number, number] | null {
  return catalog === 'new30' ? [0, 29] : catalog === 'new60' ? [30, 59] : catalog === 'new90' ? [60, 89] : catalog === 'anime-new' ? [0, 89] : null;
}
