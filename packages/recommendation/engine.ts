import type { Profile, Title, MediaType } from '../shared/types.js';
import { TtlCache } from '../shared/cache.js';
import { feedPreferences } from '../shared/preferences.js';
import { dateOnly, inReleaseWindow, releaseAge, releaseWindow } from './dates.js';
import type { CatalogId } from './catalogs.js';

const overlap = (a: string[], b: string[]): number => {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common++;
  return common / (left.size + right.size - common);
};

const similarity = (a: Title, b: Title): number =>
  0.50 * overlap(a.genres, b.genres) +
  0.25 * overlap([...a.cast, ...a.directors], [...b.cast, ...b.directors]) +
  0.25 * overlap(a.keywords, b.keywords);

export class RecommendationEngine {
  private readonly cache = new TtlCache<Title[]>();
  constructor(private readonly titles: readonly Title[] = [], private readonly now: () => Date = () => new Date()) {}

  recommend(profile: Profile, type: MediaType, catalog: CatalogId, candidates = this.titles, seeds = this.titles, revision = 'fixtures', community: ReadonlyMap<string, number> = new Map()): Title[] {
    const key = `${profile.id}:${profile.version}:${type}:${catalog}:${dateOnly(this.now())}:${revision}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const positiveIds = new Set([...profile.favorites, ...profile.likes]);
    const seedIds = new Set([...positiveIds, ...profile.watched]);
    const positives = seeds.filter(t => positiveIds.has(t.id));
    // Manual watched signals are valid only for this row; favorites are a cold-start fallback.
    const becauseSeeds = seeds.filter(t => seedIds.has(t.id));
    const blocked = new Set([...seedIds, ...profile.dislikes]);
    const negatives = seeds.filter(t => profile.dislikes.includes(t.id));
    const affinity = (t: Title) => {
      const genre = overlap(profile.genres, t.genres);
      const content = Math.max(0, ...positives.map(p => similarity(t, p)));
      const dislike = Math.max(0, ...negatives.map(n => similarity(t, n)));
      return Math.max(0, 0.6 * genre + 0.4 * content - 0.2 * dislike);
    };

    const prefs = feedPreferences(profile);
    const window = releaseWindow(catalog);
    const unique = [...new Map(candidates.map(t => [`${t.type}:${t.id}`, t])).values()];
    const ranked = unique
      .filter(t => t.type === type && !blocked.has(t.id))
      .filter(t => catalog !== 'genres' || !profile.genres.length || overlap(profile.genres, t.genres) > 0)
      .filter(t => catalog !== 'because' || becauseSeeds.length > 0)
      .filter(t => !t.releaseDate || releaseAge(t.releaseDate, this.now()) >= 0)
      .filter(t => !window || inReleaseWindow(t.releaseDate, ...window, this.now()))
      .filter(t => catalog !== 'korean' || t.originCountries?.includes('KR'))
      .filter(t => catalog !== 'chinese' || t.originCountries?.some(c => ['CN', 'TW', 'HK'].includes(c)))
      .filter(t => catalog !== 'japanese' || (t.originCountries?.includes('JP') && !t.genres.includes('Animation')))
      .filter(t => !catalog.startsWith('anime') || t.isAnime)
      .filter(t => catalog !== 'trending' || t.weeklyTrend !== undefined)
      .filter(t => catalog !== 'gems' || t.popularity <= 0.45)
      .map(title => {
        const match = affinity(title);
        let score: number;
        switch (catalog) {
          case 'because': score = 0.85 * Math.max(0, ...becauseSeeds.map(p => similarity(title, p))) + 0.15 * title.quality; break;
          case 'genres': score = 0.85 * overlap(profile.genres, title.genres) + 0.15 * title.quality; break;
          case 'gems': score = 0.65 * match + 0.25 * title.quality + 0.1 * (1 - title.popularity); break;
          case 'trending': score = 0.8 * (title.weeklyTrend ?? 0) + 0.2 * match; break;
          case 'new30': case 'new60': case 'new90': case 'anime-new': score = 0.55 * match + 0.3 * title.quality + 0.15 * title.popularity; break;
          case 'top': score = 0.65 * match + 0.35 * title.quality; break;
          default: score = 0.75 * match + 0.15 * title.quality + 0.10 * title.popularity;
        }
        const age = releaseAge(title.releaseDate, this.now());
        const freshness = age >= 0 && age < 90 ? 1 - age / 180 : age >= 90 && age < 365 ? 0.3 : 0;
        const origin = title.originCountries?.some(c => prefs.preferredOrigins.includes(c)) ? 1 : 0;
        const anime = prefs.preferAnime && title.isAnime ? 1 : 0;
        // Keep weekly trend ordering dominant. Other rows favor recent Asian content.
        if (catalog !== 'trending') score += 0.25 * freshness + 0.14 * origin + 0.1 * anime;
        if (['recommended', 'top', 'gems'].includes(catalog)) score += 0.1 * (community.get(title.id) ?? 0);
        return { title, score };
      })
      .sort((a, b) => b.score - a.score || a.title.id.localeCompare(b.title.id));

    // Greedy reranking penalizes repetitive adjacent recommendations without randomness.
    const result: Title[] = [];
    const remaining = [...ranked];
    while (remaining.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      remaining.forEach((candidate, index) => {
        const repetition = Math.max(0, ...result.slice(-4).map(t => overlap(candidate.title.genres, t.genres)));
        const adjusted = candidate.score - (catalog === 'genres' || catalog === 'top' ? 0 : 0.06 * repetition);
        if (adjusted > bestScore) { bestIndex = index; bestScore = adjusted; }
      });
      result.push(remaining.splice(bestIndex, 1)[0]!.title);
    }
    this.cache.set(key, result);
    return result;
  }
}
