import type { Profile, Title, MediaType } from '../shared/types.js';
import { TtlCache } from '../shared/cache.js';
import { dateOnly, recommendationDay, releaseAge, releaseWindow } from './dates.js';
import { buildTaste, contentSimilarity, distinctSeed, itemSimilarity } from './taste.js';
import { matchesAsian } from './asian.js';
import { matchesWesternVibe } from './western.js';
import { balancedTopPicks, classifyRegionBucket } from './regions.js';
import type { CatalogId } from './catalogs.js';

const rotatingCatalogs = new Set<CatalogId>([
  'recommended', 'because', 'because-2', 'because-west', 'because-asian', 'micro', 'japanese', 'korean', 'chinese',
  'anime', 'donghua', 'southeast-asia', 'vietnam', 'gems',
]);
const DISCOVERY_POSITIONS = [2, 5, 7];

/** A deterministic daily slate change; strongest two matches remain anchored. */
function rotateDiscoveries(titles: Title[], day: number, preferredOrigins: string[]): Title[] {
  const eligible = titles.slice(8).filter(title => title.quality >= 0.64);
  const preferred = eligible.filter(t => t.originCountries?.some(country => preferredOrigins.includes(country)));
  const discovery = (preferred.length >= 6 ? preferred : eligible).slice(0, 24);
  const count = Math.min(DISCOVERY_POSITIONS.length, Math.floor(discovery.length / 2));
  if (!count) return titles;
  const start = (day * count) % discovery.length;
  const picks = Array.from({ length: count }, (_, offset) => discovery[(start + offset) % discovery.length]!);
  const picked = new Set(picks.map(t => t.id));
  const result = titles.filter(title => !picked.has(title.id));
  for (const [index, title] of picks.entries()) result.splice(DISCOVERY_POSITIONS[index]!, 0, title);
  return result;
}

const clamp = (score: number) => Math.max(0, Math.min(1, score));
const personalCatalog = (id: CatalogId) => ['recommended','top','because','because-2','because-west','because-asian','micro','gems'].includes(id);
const scoreFreshness = (age: number) => Number.isFinite(age) ? Math.exp(-Math.max(0, age) / 550) : 0;
const fmtName = (name: string) => name.length > 65 ? name.slice(0, 62) + '…' : name;

export class RecommendationEngine {
  private readonly cache = new TtlCache<Title[]>(120, 300_000);
  constructor(private readonly titles: readonly Title[] = [], private readonly now: () => Date = () => new Date()) {}

  recommend(profile: Profile, type: MediaType, catalog: CatalogId, candidates = this.titles, seeds = this.titles, revision = 'fixtures', community: ReadonlyMap<string, number> = new Map()): Title[] {
    const now = this.now();
    const day = recommendationDay(now);
    const key = [profile.id, profile.version, type, catalog, dateOnly(now), day, revision].join(':');
    const cached = this.cache.get(key);
    if (cached) return cached;

    const taste = buildTaste(profile, seeds, now);
    const regionalSeed = catalog === 'because-west' ? 'WESTERN' : catalog === 'because-asian' ? 'ASIAN' : null;
    const primary = regionalSeed
      ? taste.seeds.find(s => classifyRegionBucket(s.title.originCountries) === regionalSeed)
      : distinctSeed(taste, catalog === 'because-2' ? 1 : 0);
    const isBecause = ['because','because-2','because-west','because-asian'].includes(catalog);
    if (isBecause && !primary) return [];
    const blocked = new Set([
      ...profile.favorites, ...profile.likes, ...profile.watched,
      ...(profile.started ?? []), ...(profile.saved ?? []), ...profile.dislikes,
    ]);
    const preferredGenres = new Set(profile.genres);
    const window = releaseWindow(catalog);
    const filtered = [...new Map(candidates.map(t => [t.type + ':' + t.id, t])).values()]
      .filter(t => t.type === type && !blocked.has(t.id))
      .filter(t => matchesAsian(t, catalog) && matchesWesternVibe(t, catalog))
      .filter(t => catalog !== 'anime-new' || t.isAnime)
      .filter(t => catalog !== 'trending' || t.weeklyTrend !== undefined)
      .filter(t => catalog !== 'gems' || t.popularity <= 0.45)
      .map(title => ({ title, age: releaseAge(title.releaseDate, now) }))
      .filter(({age}) => age >= 0 && (!window || (age >= window[0] && age <= window[1])))
      .filter(({title}) => catalog !== 'genres' || !preferredGenres.size || title.genres.some(g => preferredGenres.has(g)));
    const pair = [...taste.pairs].sort((a,b) => b[1]-a[1])[0]?.[0]?.split('|') ?? [];
    const microCandidates = filtered.filter(row => pair.every(g => row.title.genres.includes(g)));
    const pool = catalog === 'micro' && microCandidates.length >= 5 ? microCandidates : filtered;
    const maxNeighbor = Math.max(0, ...pool.map(row => row.title.collabScore ?? 0));
    const cold = taste.seeds.length < 5;

    const ranked = pool.map(({title,age}) => {
      const content = contentSimilarity(taste, title);
      const direct = primary ? itemSimilarity(primary.title, title) * clamp(primary.weight / 2.2) : 0;
      const neighbors = maxNeighbor ? (title.collabScore ?? 0) / maxNeighbor : 0;
      const social = community.get(title.id) ?? 0;
      // Item-graph recommendation evidence, sparse community support and direct seed similarity.
      const collab = clamp(0.68 * neighbors + 0.17 * social + 0.15 * direct);
      const freshness = scoreFreshness(age);
      const quality = clamp(title.quality);
      // Netflix-inspired hybrid score, not Netflix's proprietary algorithm.
      let score = 0.40 * collab + 0.35 * content + 0.15 * quality + 0.10 * freshness;
      if (cold) score = 0.24 * collab + 0.34 * content + 0.30 * quality + 0.12 * freshness;
      if (isBecause) score = 0.52 * itemSimilarity(primary!.title,title) + 0.25 * content + 0.18 * quality + 0.05 * freshness;
      if (catalog === 'genres') score = 0.75 * (title.genres.filter(g => preferredGenres.has(g)).length / Math.max(1, title.genres.length)) + 0.25 * quality;
      if (catalog === 'trending') score = 0.82 * (title.weeklyTrend ?? 0) + 0.12 * content + 0.06 * quality;
      if (catalog === 'top') score = 0.45 * quality + 0.40 * content + 0.15 * collab;
      if (catalog === 'gems') score = 0.45 * content + 0.35 * quality + 0.12 * collab + 0.08 * (1-title.popularity);
      if (catalog === 'new30' || catalog === 'new60' || catalog === 'new90' || catalog === 'anime-new') {
        score = 0.45 * content + 0.30 * quality + 0.15 * title.popularity + 0.10 * freshness;
      }
      const negative = taste.negatives.reduce((best,seed) => Math.max(best,itemSimilarity(seed,title)),0);
      score -= 0.25 * negative;
      // An explicit preference always remains effective even when historical seeds are sparse.
      if (personalCatalog(catalog) && profile.preferredOrigins?.length) {
        const chosen = title.originCountries?.some(c => profile.preferredOrigins?.includes(c));
        if (chosen) score += profile.preferredOrigins.length <= 2 ? 0.28 : 0.08;
      }
      if (profile.preferAnime && title.isAnime && personalCatalog(catalog)) score += 0.05;
      const evidence = (title.matchedSeeds ?? []).slice(0,2);
      const seedNote = evidence.length ? 'Vì bạn thích ' + evidence.map(fmtName).join(' & ')
        : primary && itemSimilarity(title,primary.title) >= 0.26 ? 'Tương tự ' + fmtName(primary.title.name) : '';
      const reason = personalCatalog(catalog) && seedNote ? seedNote : '';
      return { title: reason ? { ...title, activityNote: reason } : title, score };
    }).sort((a,b)=>b.score-a.score || a.title.id.localeCompare(b.title.id));

    // Bounded MMR: look at the first 72 candidates, and compare against the last 12
    // selected items. Preserves the ordering of remaining pages without cubic cost.
    const pending = ranked.slice(0,72);
    const selected: Title[] = [];
    if (catalog === 'genres' || catalog === 'trending') {
      selected.push(...pending.map(r=>r.title));
    } else {
      while(pending.length) {
        let bestIndex=0, best=-Infinity;
        for (let i=0;i<pending.length;i++) {
          const row=pending[i]!;
          let redundancy=0;
          for(const chosen of selected.slice(-12)) redundancy=Math.max(redundancy,itemSimilarity(row.title,chosen));
          const mmr=0.72*row.score-0.28*redundancy;
          if(mmr>best){best=mmr;bestIndex=i;}
        }
        selected.push(pending.splice(bestIndex,1)[0]!.title);
      }
    }
    selected.push(...ranked.slice(72).map(r=>r.title));
    const rotated = rotatingCatalogs.has(catalog)
      ? rotateDiscoveries(selected, day, personalCatalog(catalog) ? profile.preferredOrigins ?? [] : [])
      : selected;
    const output = catalog === 'recommended' ? balancedTopPicks(rotated, taste.seeds.map(s=>s.title)) : rotated;
    this.cache.set(key, output);
    return output;
  }
}
