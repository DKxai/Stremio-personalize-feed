import type { Title } from '../shared/types.js';
import { dateOnly, daysAgo, inReleaseWindow, recommendationDay } from './dates.js';

export function vietnamDate(now: Date): Date {
  return new Date(recommendationDay(now) * 86_400_000);
}

export function seasonStart(now: Date): string {
  return dateOnly(new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)));
}

export function latestRelease(title: Title, now: Date): string | undefined {
  const today = dateOnly(now);
  return [...(title.seasonStarts ?? []), title.releaseDate].filter((date): date is string => Boolean(date && date <= today)).sort().at(-1);
}

export function matchesAiring(title: Title, catalog: string, now: Date): boolean {
  const today = vietnamDate(now);
  const last = title.lastEpisode?.date;
  const next = title.nextEpisode?.date;
  switch (catalog) {
    case 'anime-season':
      return title.type === 'series' && Boolean(last && last >= seasonStart(today) && last <= dateOnly(today));
    case 'anime-episodes':
      return title.type === 'series' && inReleaseWindow(last, 0, 6, today);
    case 'anime-completed':
      return title.type === 'series' && title.seriesStatus === 'Ended';
    case 'anime-upcoming':
      return title.type === 'series' && Boolean([next, ...title.seasonStarts ?? [], title.releaseDate]
        .some(date => inReleaseWindow(date, -90, -1, today)));
    default:
      return true;
  }
}

export function upcomingDate(title: Title, now: Date): string | undefined {
  const today = dateOnly(vietnamDate(now));
  return [title.nextEpisode?.date, ...title.seasonStarts ?? [], title.releaseDate].sort()
    .find(date => date && date > today);
}

export function airingWindow(catalog: string, now: Date): [string, string] | undefined {
  const today = vietnamDate(now);
  if (catalog === 'anime-season') return [seasonStart(today), dateOnly(today)];
  if (catalog === 'anime-episodes') return [daysAgo(6, today), dateOnly(today)];
  if (catalog === 'anime-upcoming') return [daysAgo(-1, today), daysAgo(-90, today)];
  return undefined;
}
