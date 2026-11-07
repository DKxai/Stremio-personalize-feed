import type { Profile, Title, MediaType } from '../shared/types.js';
import { TtlCache } from '../shared/cache.js';
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
  constructor(private readonly titles: readonly Title[]) {}

  recommend(profile: Profile, type: MediaType, catalog: CatalogId): Title[] {
    const key = `${profile.id}:${profile.version}:${type}:${catalog}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const positiveIds = new Set([...profile.favorites, ...profile.likes]);
    const seedIds = new Set([...positiveIds, ...profile.watched]);
    const positives = this.titles.filter(t => positiveIds.has(t.id));
    // Manual watched signals are valid only for this row; favorites are a cold-start fallback.
    const seeds = this.titles.filter(t => seedIds.has(t.id));
    const blocked = new Set([...seedIds, ...profile.dislikes]);
    const negatives = this.titles.filter(t => profile.dislikes.includes(t.id));
    const affinity = (t: Title) => {
      const genre = overlap(profile.genres, t.genres);
      const content = Math.max(0, ...positives.map(p => similarity(t, p)));
      const dislike = Math.max(0, ...negatives.map(n => similarity(t, n)));
      return Math.max(0, 0.6 * genre + 0.4 * content - 0.2 * dislike);
    };

    const ranked = this.titles
      .filter(t => t.type === type && !blocked.has(t.id))
      .filter(t => catalog !== 'genres' || !profile.genres.length || overlap(profile.genres, t.genres) > 0)
      .filter(t => catalog !== 'because' || seeds.length > 0)
      .filter(t => catalog !== 'gems' || t.popularity <= 0.45)
      .map(title => {
        const match = affinity(title);
        let score: number;
        switch (catalog) {
          case 'because': score = 0.85 * Math.max(0, ...seeds.map(p => similarity(title, p))) + 0.15 * title.quality; break;
          case 'genres': score = 0.85 * overlap(profile.genres, title.genres) + 0.15 * title.quality; break;
          case 'gems': score = 0.65 * match + 0.25 * title.quality + 0.1 * (1 - title.popularity); break;
          case 'trending': score = 0.65 * match + 0.35 * title.popularity; break;
          case 'top': score = 0.65 * match + 0.35 * title.quality; break;
          default: score = 0.75 * match + 0.15 * title.quality + 0.10 * title.popularity;
        }
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
