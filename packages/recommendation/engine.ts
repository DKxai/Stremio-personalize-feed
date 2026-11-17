import type { Profile, Title, MediaType } from '../shared/types.js';
import { TtlCache } from '../shared/cache.js';
import { feedPreferences, LANGUAGES, platformPriority } from '../shared/preferences.js';
import { dateOnly, recommendationDay, releaseAge, releaseWindow } from './dates.js';
import { latestRelease, matchesAiring, upcomingDate, vietnamDate } from './airing.js';
import type { CatalogId } from './catalogs.js';

const overlap = (left: ReadonlySet<string>, right: ReadonlySet<string>): number => {
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common++;
  return common / (left.size + right.size - common);
};

const features = (title: Title) => ({
  genres: new Set(title.genres),
  people: new Set([...title.cast, ...title.directors]),
  keywords: new Set(title.keywords),
});

type Features = ReturnType<typeof features>;

function bestMatch(candidate: Features, seeds: Features[]): number {
  let best = 0;
  for (const seed of seeds) {
    const score = 0.50 * overlap(candidate.genres, seed.genres)
      + 0.25 * overlap(candidate.people, seed.people)
      + 0.25 * overlap(candidate.keywords, seed.keywords);
    best = Math.max(best, score);
  }
  return best;
}

const rotatingCatalogs = new Set<CatalogId>(['recommended', 'japanese', 'korean', 'chinese', 'lang-ko', 'lang-en', 'lang-ja', 'lang-zh', 'anime', 'because', 'gems']);
const DISCOVERY_POSITIONS = [2, 5, 7];

function rotateDiscoveries(titles: Title[], day: number, preferredOrigins: string[]): Title[] {
  // Pull from below the first screen, in relevance order, with a quality floor.
  const eligible = titles.slice(8).filter(title => title.quality >= 0.64);
  const preferred = eligible.filter(title => title.originCountries?.some(country => preferredOrigins.includes(country)));
  const discovery = (preferred.length >= 6 ? preferred : eligible).slice(0, 24);
  const count = Math.min(DISCOVERY_POSITIONS.length, Math.floor(discovery.length / 2));
  if (!count) return titles;
  const start = (day * count) % discovery.length;
  const picks = Array.from({ length: count }, (_, offset) => discovery[(start + offset) % discovery.length]!);
  const picked = new Set(picks.map(title => title.id));
  const result = titles.filter(title => !picked.has(title.id));
  for (const [index, title] of picks.entries()) result.splice(DISCOVERY_POSITIONS[index]!, 0, title);
  return result;
}

export class RecommendationEngine {
  private readonly cache = new TtlCache<Title[]>();
  constructor(private readonly titles: readonly Title[] = [], private readonly now: () => Date = () => new Date()) {}

  recommend(profile: Profile, type: MediaType, catalog: CatalogId, candidates = this.titles, seeds = this.titles, revision = 'fixtures', community: ReadonlyMap<string, number> = new Map()): Title[] {
    const now = this.now();
    const day = recommendationDay(now);
    const today = vietnamDate(now);
    const key = `${profile.id}:${profile.version}:${type}:${catalog}:${dateOnly(now)}:${day}:${revision}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const positiveIds = new Set([...profile.favorites, ...profile.likes]);
    const seedIds = new Set([...positiveIds, ...profile.watched, ...(profile.started ?? []), ...(profile.saved ?? [])]);
    const seenIds = new Set([...profile.watched, ...(profile.started ?? [])]);
    const savedIds = new Set(profile.saved);
    const dislikedIds = new Set(profile.dislikes);
    const blocked = new Set([...seedIds, ...dislikedIds]);
    const seedFeatures = seeds.map(title => ({ id: title.id, values: features(title) }));
    const selectSeeds = (ids: Set<string>, skipDisliked = false) => seedFeatures
      .filter(seed => ids.has(seed.id) && (!skipDisliked || !dislikedIds.has(seed.id)))
      .map(seed => seed.values);
    const positives = selectSeeds(positiveIds);
    const viewing = selectSeeds(seenIds, true);
    const saved = selectSeeds(savedIds, true);
    const becauseSeeds = selectSeeds(seedIds, true);
    const negatives = selectSeeds(dislikedIds);
    const preferredGenres = new Set(profile.genres);

    const prefs = feedPreferences(profile);
    const window = releaseWindow(catalog);
    const language = LANGUAGES.find(item => catalog === `lang-${item.id}`);
    const preferredLanguageCodes = new Set(LANGUAGES.filter(item => prefs.preferredLanguages.includes(item.id)).flatMap<string>(item => [...item.codes]));
    const showingEpisodes = catalog === 'anime-episodes';
    const personalRow = ['recommended', 'because', 'top', 'gems'].includes(catalog);
    const origins = prefs.preferredOrigins;
    const originWeight = personalRow && origins.length <= 2 ? 0.32 : 0.14;
    const unique = [...new Map(candidates.map(t => [`${t.type}:${t.id}`, t])).values()];
    const ranked = unique
      .filter(t => t.type === type && (!blocked.has(t.id) || (showingEpisodes && !dislikedIds.has(t.id))))
      .filter(t => matchesAiring(t, catalog, now))
      .filter(t => !language || ((language.codes as readonly string[]).includes(t.originalLanguage ?? '') && (language.id !== 'ja' || !t.isAnime)))
      .filter(t => catalog !== 'donghua' || (t.genres.includes('Animation') && t.originCountries?.some(code => ['CN', 'TW', 'HK'].includes(code))))
      .filter(t => catalog !== 'anime-gems' || (t.popularity <= 0.55 && t.quality >= 0.65))
      .filter(t => catalog !== 'because' || becauseSeeds.length > 0)
      .filter(t => catalog !== 'korean' || t.originCountries?.includes('KR'))
      .filter(t => catalog !== 'chinese' || t.originCountries?.some(c => ['CN', 'TW', 'HK'].includes(c)))
      .filter(t => catalog !== 'japanese' || (t.originCountries?.includes('JP') && !t.genres.includes('Animation')))
      .filter(t => !catalog.startsWith('anime') || t.isAnime)
      .filter(t => catalog !== 'trending' || t.weeklyTrend !== undefined)
      .filter(t => catalog !== 'gems' || t.popularity <= 0.45)
      .map(title => ({
        title,
        age: releaseAge(catalog === 'recent' ? latestRelease(title, today) : title.releaseDate, today),
        airDate: catalog === 'anime-upcoming' ? upcomingDate(title, now)
          : showingEpisodes || catalog === 'anime-season' ? title.lastEpisode?.date : undefined,
        platform: catalog === 'trending' ? platformPriority(title.providers ?? [], prefs.platforms) : 0,
      }))
      .filter(({ age, platform }) => platform >= 0 && (catalog === 'anime-upcoming' || age >= 0) && (!window || (age >= window[0] && age <= window[1])))
      .map(({ title, age, platform, airDate }) => {
        const candidate = features(title);
        const genre = overlap(preferredGenres, candidate.genres);
        const match = catalog === 'because' || catalog === 'genres' ? 0 : Math.max(0,
          0.6 * genre + 0.4 * bestMatch(candidate, positives) + 0.18 * bestMatch(candidate, viewing)
          + 0.1 * bestMatch(candidate, saved) - 0.35 * bestMatch(candidate, negatives));
        let score: number;
        switch (catalog) {
          case 'because': score = 0.85 * bestMatch(candidate, becauseSeeds) + 0.15 * title.quality; break;
          case 'genres': score = 0.85 * genre + 0.15 * title.quality; break;
          case 'gems': case 'anime-gems': score = 0.65 * match + 0.25 * title.quality + 0.1 * (1 - title.popularity); break;
          case 'trending': score = 0.8 * (title.weeklyTrend ?? 0) + 0.2 * match; break;
          case 'anime-episodes': {
            score = 0.55 * match + 0.15 * title.quality + (seenIds.has(title.id) || savedIds.has(title.id) ? 0.4 : 0);
            break;
          }
          case 'recent': score = 0.45 * match + 0.25 * title.quality + 0.3 * (1 - age / 90); break;
          case 'new30': case 'new60': case 'new90': case 'anime-new': score = 0.55 * match + 0.3 * title.quality + 0.15 * title.popularity; break;
          case 'recommended': score = 0.65 * match + 0.30 * title.quality + 0.05 * title.popularity; break;
          case 'top': score = 0.65 * match + 0.35 * title.quality; break;
          default: score = 0.75 * match + 0.15 * title.quality + 0.10 * title.popularity;
        }
        const freshness = age >= 0 && age < 90 ? 1 - age / 180 : age >= 90 && age < 365 ? 0.3 : 0;
        const origin = title.originCountries?.some(c => origins.includes(c)) ? 1 : 0;
        const anime = prefs.preferAnime && title.isAnime ? 1 : 0;
        // Keep weekly trend ordering dominant. Other rows favor recent Asian content.
        const personalFreshness = Number.isFinite(age) ? Math.max(0, 1 - age / 365) : 0;
        if (catalog === 'recommended') {
          const languageBoost = preferredLanguageCodes.has(title.originalLanguage ?? '') ? (prefs.preferredLanguages.length < LANGUAGES.length ? 0.18 : 0.08) : 0;
          score += 0.22 * personalFreshness + originWeight * origin + 0.1 * anime + languageBoost;
        }
        else if (catalog !== 'trending') score += 0.25 * freshness + originWeight * origin + 0.1 * anime;
        if (['recommended', 'top', 'gems'].includes(catalog)) score += 0.1 * (community.get(title.id) ?? 0);
        return { title, score, platform, airDate, genres: candidate.genres, genre };
      })
      .filter(row => catalog !== 'genres' || !preferredGenres.size || row.genre > 0)
      .sort((a, b) => {
        const byAirDate = catalog === 'anime-upcoming' ? (a.airDate ?? '').localeCompare(b.airDate ?? '')
          : showingEpisodes ? (b.airDate ?? '').localeCompare(a.airDate ?? '') : 0;
        return a.platform - b.platform || byAirDate || b.score - a.score || a.title.id.localeCompare(b.title.id);
      });

    // Greedy reranking penalizes repetitive adjacent recommendations without randomness.
    const result: Title[] = [];
    if (catalog === 'trending' || catalog === 'genres' || catalog === 'top' || showingEpisodes || catalog === 'anime-upcoming') {
      for (const row of ranked) result.push(row.title);
    } else {
      const recentGenres: ReadonlySet<string>[] = [];
      const recentLanguages: string[] = [];
      while (ranked.length) {
        let bestIndex = 0;
        let bestScore = -Infinity;
        for (let index = 0; index < ranked.length; index++) {
          const candidate = ranked[index]!;
          let repetition = 0;
          for (const genres of recentGenres) {
            repetition = Math.max(repetition, overlap(candidate.genres, genres));
          }
          const language = candidate.title.originalLanguage;
          const languageRepetition = catalog === 'recommended' && result.length >= 2 && language
            ? 0.04 * recentLanguages.filter(previous => previous === language).length : 0;
          const adjusted = candidate.score - 0.06 * repetition - languageRepetition;
          if (adjusted > bestScore) {
            bestIndex = index;
            bestScore = adjusted;
          }
        }
        const selected = ranked.splice(bestIndex, 1)[0]!;
        result.push(selected.title);
        recentGenres.push(selected.genres);
        recentLanguages.push(selected.title.originalLanguage ?? '');
        if (recentLanguages.length > 3) recentLanguages.shift();
        if (recentGenres.length > 4) recentGenres.shift();
      }
    }
    const output = rotatingCatalogs.has(catalog) ? rotateDiscoveries(result, day, personalRow && origins.length <= 2 ? origins : []) : result;
    const annotated = output.map((title, index) => {
      if (showingEpisodes && title.lastEpisode) {
        const { season, episode, date } = title.lastEpisode;
        return { ...title, activityNote: `Tập ${episode}, mùa ${season} · phát sóng ${date}` };
      }
      if (catalog === 'anime-upcoming') return { ...title, activityNote: `Dự kiến phát sóng ${upcomingDate(title, now)}` };
      if (catalog === 'recent' && title.type === 'series') return { ...title, activityNote: `Mùa mới · ${latestRelease(title, today)}` };
      const genre = catalog === 'recommended' && index < 8 ? title.genres.find(genre => preferredGenres.has(genre)) : undefined;
      return genre ? { ...title, activityNote: `Hợp thể loại bạn chọn · ${genre}` } : title;
    });
    this.cache.set(key, annotated);
    return annotated;
  }
}
