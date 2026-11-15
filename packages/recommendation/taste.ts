import type { Profile, Title } from '../shared/types.js';

/** Sparse multi-vector taste model. No third-party embeddings or persistent model files. */
export type TasteSeed = { title: Title; weight: number };
export interface Taste {
  seeds: TasteSeed[];
  negatives: Title[];
  genres: Map<string, number>;
  pairs: Map<string, number>;
  keywords: Map<string, number>;
  countries: Map<string, number>;
  people: Map<string, number>;
  languages: Map<string, number>;
  preferredYear?: number;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const pairKey = (a: string, b: string) => [a, b].sort().join('|');
const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);
const normalize = (map: Map<string, number>) => {
  const max = Math.max(0, ...map.values());
  if (max) for (const [key, value] of map) map.set(key, clamp(value / max));
};
const baseWeight = (profile: Profile, title: Title) => {
  const id = title.id;
  if (profile.dislikes.includes(id)) return -1.3;
  let weight = 0;
  if (profile.favorites.includes(id)) weight += 1.25;
  if (profile.likes.includes(id)) weight += 1.05;
  if (profile.watched.includes(id)) weight += 0.75;
  if (profile.saved?.includes(id)) weight += 0.40;
  if (profile.started?.includes(id)) weight += 0.20;
  if (title.type === 'series') weight += Math.min(0.45, Math.log1p(profile.episodeCounts?.[id] ?? 0) * 0.14);
  return Math.min(2.5, weight);
};
export function engagementWeight(profile: Profile, title: Title, now: Date): number {
  const weight = baseWeight(profile, title);
  const recent = profile.activityTimes?.[title.id];
  const parsed = recent ? Date.parse(recent) : NaN;
  // Missing legacy timestamps carry no invented recency penalty.
  const days = Number.isFinite(parsed) ? Math.max(0, (now.getTime() - parsed) / 86_400_000) : 0;
  return weight * Math.exp(-Math.LN2 * days / 45);
}
export function buildTaste(profile: Profile, metadata: readonly Title[], now: Date): Taste {
  const seeds: TasteSeed[] = [];
  const negatives: Title[] = [];
  const taste: Taste = {
    seeds, negatives, genres: new Map(), pairs: new Map(), keywords: new Map(),
    countries: new Map(), people: new Map(), languages: new Map(),
  };
  const unique = [...new Map(metadata.map(t => [t.id, t])).values()];
  const docFrequency = new Map<string, number>();
  for (const title of unique) for (const key of new Set(title.keywords.map(k => k.toLowerCase()))) {
    add(docFrequency, key, 1);
  }
  const personSupport = new Map<string, number>();
  let sumYears = 0, yearMass = 0;
  for (const title of unique) {
    const weight = engagementWeight(profile, title, now);
    if (weight < 0) { negatives.push(title); continue; }
    if (weight <= 0) continue;
    seeds.push({ title, weight });
    for (const genre of new Set(title.genres)) add(taste.genres, genre, weight);
    const genres = [...new Set(title.genres)].sort();
    for (let i = 0; i < genres.length; i++) for (let j = i + 1; j < genres.length; j++)
      add(taste.pairs, pairKey(genres[i]!, genres[j]!), weight);
    for (const keyword of new Set(title.keywords.map(k => k.toLowerCase()))) {
      const idf = Math.log(1 + unique.length / (1 + (docFrequency.get(keyword) ?? 0)));
      add(taste.keywords, keyword, weight * idf);
    }
    for (const country of new Set(title.originCountries ?? [])) add(taste.countries, country, weight);
    if (title.originalLanguage) add(taste.languages, title.originalLanguage, weight);
    for (const person of new Set([...title.directors, ...title.cast.slice(0, 3)].map(v => v.toLowerCase()))) {
      add(personSupport, person, 1);
      add(taste.people, person, weight);
    }
    if (Number.isInteger(title.year) && title.year >= 1900) { sumYears += title.year * weight; yearMass += weight; }
  }
  for (const [name] of taste.people) if ((personSupport.get(name) ?? 0) < 2) taste.people.delete(name);
  for (const genre of profile.genres) add(taste.genres, genre, 1.0);
  for (const country of profile.preferredOrigins ?? []) add(taste.countries, country, 0.9);
  if (profile.preferAnime) add(taste.genres, 'Animation', 0.35);
  for (const map of [taste.genres, taste.pairs, taste.keywords, taste.countries, taste.people, taste.languages]) normalize(map);
  if (yearMass) taste.preferredYear = sumYears / yearMass;
  seeds.sort((a,b) => b.weight - a.weight || a.title.id.localeCompare(b.title.id));
  return taste;
}
function affinity(map: ReadonlyMap<string, number>, values: readonly string[]): number {
  if (!map.size || !values.length) return 0;
  const hits = new Set(values).size;
  return [...new Set(values)].reduce((sum, value) => sum + (map.get(value) ?? 0), 0) / Math.max(1, Math.min(hits, 3));
}
export function contentSimilarity(taste: Taste, title: Title): number {
  const genres = [...new Set(title.genres)];
  const pairs: string[] = [];
  for (let i=0;i<genres.length;i++) for (let j=i+1;j<genres.length;j++) pairs.push(pairKey(genres[i]!, genres[j]!));
  const era = taste.preferredYear === undefined ? 0 : Math.exp(-Math.abs(title.year - taste.preferredYear) / 15);
  const parts: [number,number][] = [
    [0.30, affinity(taste.genres, genres)],
    [0.16, affinity(taste.pairs, pairs)],
    [0.22, affinity(taste.keywords, title.keywords.map(k => k.toLowerCase()))],
    [0.14, affinity(taste.countries, title.originCountries ?? [])],
    [0.12, affinity(taste.people, [...title.directors,...title.cast.slice(0,3)].map(v => v.toLowerCase()))],
    [0.03, affinity(taste.languages, title.originalLanguage ? [title.originalLanguage] : [])],
    [0.03, era],
  ];
  // Empty signals should not force the match downward, especially on cold start.
  const available = parts.filter(([weight,value],i) => i === 0 || value > 0);
  return clamp(available.reduce((sum,[w,v]) => sum + w*v,0) / Math.max(0.01,available.reduce((sum,[w]) => sum+w,0)));
}
export function itemSimilarity(a: Title,b: Title): number {
  const jaccard = (left: readonly string[],right: readonly string[]) => {
    const x=new Set(left),y=new Set(right);
    if(!x.size || !y.size)return 0;
    let common=0;
    for(const v of x)if(y.has(v))common++;
    return common/(x.size+y.size-common);
  };
  return 0.50*jaccard(a.genres,b.genres)+0.20*jaccard(a.keywords,b.keywords)
    +0.20*jaccard(a.originCountries??[],b.originCountries??[])
    +0.10*jaccard(a.directors,b.directors);
}
export function distinctSeed(taste: Taste, index: number): TasteSeed | undefined {
  if (!index) return taste.seeds[0];
  const first = taste.seeds[0];
  if (!first) return undefined;
  return taste.seeds.slice(1).find(seed => itemSimilarity(seed.title, first.title) < 0.55) ?? taste.seeds[index];
}
