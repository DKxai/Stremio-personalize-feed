import type { Title, MediaType, Profile } from '../shared/types.js';
import { feedPreferences, PLATFORMS, GENRES } from '../shared/preferences.js';
import { TtlCache } from '../shared/cache.js';
import { TmdbClient, UpstreamUnavailable } from './tmdb.js';
import type { MetadataStore } from './store.js';
import { TITLES } from './fixtures.js';
import type { CatalogQuery } from '../recommendation/catalog-query.js';
import type { CatalogId } from '../recommendation/catalogs.js';
import { dateOnly, daysAgo, inReleaseWindow, releaseWindow, releaseAge } from '../recommendation/dates.js';

const genreIds: Record<string, number> = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37 };
const genreNames = Object.fromEntries(Object.entries(genreIds).map(([name, id]) => [id, name]));
const tvGenres = (genre: string) => ['Action', 'Adventure'].includes(genre) ? 10759 : ['Sci-Fi', 'Fantasy'].includes(genre) ? 10765 : ['Romance', 'History'].includes(genre) ? 18 : ['Horror', 'Thriller'].includes(genre) ? 9648 : genre === 'Music' ? 99 : genre === 'War' ? 10768 : genreIds[genre];
const names = (values: any[] = [], limit = 12): string[] => values.filter(v => typeof v?.name === 'string').slice(0, limit).map(v => v.name);
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(releaseAge(value));
const countryMatch = (title: Title, countries: string[]) => title.originCountries?.some(c => countries.includes(c));
const providerMatches = (providerName: string, ids: string[]) => PLATFORMS.some(p => ids.includes(p.id) && (p.matches as readonly string[]).some(n => n.toLowerCase() === providerName.toLowerCase()));
const SNAPSHOT_PREFIX = 'catalog:v1:';
const REFRESH_INTERVAL = 30 * 60_000;
const SNAPSHOT_MAX_AGE = 24 * 60 * 60_000;
const MAX_BACKGROUND_REFRESHES = 2;
const RETRY_DELAY = 60_000;
interface CatalogSnapshot { batch: CandidateBatch; refreshedAt: number }
// Keep only fields used to resolve IMDb IDs, rank titles and show availability.
function compactDetail(detail: any) {
  // Existing SQLite responses are decoded through this function on cache misses.
  if (detail.compactVersion === 1) return detail;
  const availability = detail['watch/providers'];
  const providers = Object.fromEntries(Object.entries(availability?.results ?? {}).map(([region, value]) => {
    const entry = value as { flatrate?: { provider_name: string }[]; link?: string };
    return [region, { flatrate: entry.flatrate?.slice(0, 30).map(provider => ({ provider_name: provider.provider_name })), link: entry.link }];
  }));
  return {
    compactVersion: 1,
    imdb_id: detail.imdb_id,
    external_ids: { imdb_id: detail.external_ids?.imdb_id },
    title: detail.title, name: detail.name, original_title: detail.original_title, original_name: detail.original_name,
    release_date: detail.release_date, first_air_date: detail.first_air_date, adult: detail.adult,
    origin_country: detail.origin_country,
    production_countries: detail.production_countries?.map((country: any) => ({ iso_3166_1: country.iso_3166_1 })),
    genres: detail.genres?.map((genre: any) => ({ id: genre.id })),
    original_language: detail.original_language, poster_path: detail.poster_path, overview: detail.overview,
    vote_average: detail.vote_average, vote_count: detail.vote_count, popularity: detail.popularity,
    credits: {
      cast: names(detail.credits?.cast, 8).map(name => ({ name })),
      crew: names(detail.credits?.crew?.filter((credit: any) => credit.job === 'Director'), 4)
        .map(name => ({ name, job: 'Director' })),
    },
    keywords: { keywords: names(detail.keywords?.keywords || detail.keywords?.results, 15).map(name => ({ name })) },
    'watch/providers': { results: providers },
  };
}

export interface CandidateBatch { titles: Title[]; revision: string; source: 'tmdb' | 'fixtures' }
export interface LibrarySource {
  readonly mode: 'tmdb' | 'fixtures' | 'unconfigured';
  candidates(profile: Profile, type: MediaType, catalog: CatalogId, filters?: Pick<CatalogQuery, 'genre'>): Promise<CandidateBatch>;
  resolve(id: string, type?: MediaType, region?: string): Promise<Title | undefined>;
  search(query: string, region: string, type?: MediaType, page?: number): Promise<Title[]>;
}

export class LiveLibrary implements LibrarySource {
  readonly mode = 'tmdb' as const;
  private readonly rows = new TtlCache<CatalogSnapshot>(100, SNAPSHOT_MAX_AGE);
  private readonly retry = new TtlCache<boolean>(100, RETRY_DELAY);
  private refreshing = 0;
  private readonly pending = new Map<string, Promise<CandidateBatch>>();
  constructor(private readonly client: TmdbClient, private readonly store?: MetadataStore, private readonly now: () => Date = () => new Date()) {}

  async resolve(id: string, type?: MediaType, region = 'US'): Promise<Title | undefined> {
    if (!/^tt\d{7,10}$/.test(id)) return undefined;
    const cached = await this.store?.title(id, type, region);
    // Saved metadata stays useful for profile seeds even when a title leaves a live row.
    if (cached) return cached;
    const result = await this.client.get(`find/${id}`, { external_source: 'imdb_id' });
    if (!result) return undefined;
    const match = type === 'movie' ? result.movie_results?.[0] : type === 'series' ? result.tv_results?.[0] : result.movie_results?.[0] || result.tv_results?.[0];
    if (!match || !Number.isInteger(match.id)) return undefined;
    const resolvedType: MediaType = type || (result.movie_results?.some((r: any) => r.id === match.id) ? 'movie' : 'series');
    const title = await this.detail(match.id, resolvedType, region);
    return title?.id === id ? title : undefined;
  }

  private async detail(id: number, type: MediaType, region: string): Promise<Title | undefined> {
    const media = type === 'movie' ? 'movie' : 'tv';
    const d = await this.client.get(`${media}/${id}`, { append_to_response: 'external_ids,credits,keywords,watch/providers' }, 86_400_000, compactDetail);
    if (!d) return undefined;
    const imdb = d.imdb_id || d.external_ids?.imdb_id;
    const releaseDate = type === 'movie' ? d.release_date : d.first_air_date;
    if (d.adult === true || !/^tt\d{7,10}$/.test(imdb ?? '') || !validDate(releaseDate) || releaseDate > dateOnly(this.now())) return undefined;
    const availability = d['watch/providers']?.results?.[region];
    const origins: string[] = d.origin_country || (d.production_countries || []).map((c: any) => c.iso_3166_1);
    const genres: string[] = (d.genres || []).flatMap((g: any) => g.id === 10759 ? ['Action', 'Adventure'] : g.id === 10765 ? ['Sci-Fi', 'Fantasy'] : g.id === 10768 ? ['War'] : genreNames[g.id] ? [genreNames[g.id]] : []);
    const keywords = names(d.keywords?.keywords || d.keywords?.results, 15);
    if (keywords.some(k => /romanc|romantic/i.test(k)) && !genres.includes('Romance')) genres.push('Romance');
    if (keywords.some(k => /horror/i.test(k)) && !genres.includes('Horror')) genres.push('Horror');
    if (keywords.some(k => /thriller/i.test(k)) && !genres.includes('Thriller')) genres.push('Thriller');
    const title: Title = {
      id: imdb, tmdbId: id, type, name: d.title || d.name || d.original_title || d.original_name,
      year: Number(releaseDate.slice(0, 4)), releaseDate, genres,
      cast: names(d.credits?.cast, 8), directors: names((d.credits?.crew || []).filter((c: any) => c.job === 'Director'), 4),
      keywords,
      // Bayesian shrinkage stops a single 10/10 vote dominating brand-new titles.
      quality: ((Number(d.vote_average) || 0) * (Number(d.vote_count) || 0) + 6 * 50) / ((Number(d.vote_count) || 0) + 50) / 10,
      popularity: Math.min(1, Math.log1p(Math.max(0, Number(d.popularity) || 0)) / Math.log(1001)),
      originCountries: origins, originalLanguage: d.original_language,
      isAnime: genres.includes('Animation') && (origins.includes('JP') || d.original_language === 'ja'),
      poster: typeof d.poster_path === 'string' && /^\/[\w.]+$/.test(d.poster_path) ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : undefined,
      overview: typeof d.overview === 'string' ? d.overview : '',
      providers: (availability?.flatrate || []).filter((p: any) => typeof p.provider_name === 'string').slice(0, 30).map((p: any) => p.provider_name),
      providerLink: typeof availability?.link === 'string' && availability.link.startsWith('https://www.themoviedb.org/') ? availability.link : undefined,
      source: 'tmdb',
    };
    if (typeof title.name !== 'string' || !title.name) return undefined;
    await this.store?.save(title, region);
    return title;
  }

  async search(query: string, region: string, type?: MediaType, page = 1): Promise<Title[]> {
    if (/^tt\d{7,10}$/.test(query)) {
      if (page > 1) return [];
      const title = await this.resolve(query, type, region); return title ? [title] : [];
    }
    const data = await this.client.get(type ? `search/${type === 'movie' ? 'movie' : 'tv'}` : 'search/multi', { query, include_adult: 'false', page });
    const rows = (data?.results || []).filter((r: any) => r.adult !== true && (type || ['movie', 'tv'].includes(r.media_type))).slice(0, type ? 20 : 12);
    const titles = await Promise.all(rows.map((r: any) => this.detail(r.id, type || (r.media_type === 'movie' ? 'movie' : 'series'), region)));
    // Keep TMDB relevance and alias matching, including Japanese/Korean/Chinese names.
    return titles.filter((t): t is Title => Boolean(t));
  }

  async candidates(profile: Profile, type: MediaType, catalog: CatalogId, filters: Pick<CatalogQuery, 'genre'> = {}): Promise<CandidateBatch> {
    const prefs = feedPreferences(profile);
    const pool = catalog === 'because' || catalog === 'top' ? 'recommended' : catalog;
    const usesPlatforms = catalog === 'trending' || catalog.startsWith('new');
    const usesGenres = ['recommended', 'because', 'genres', 'top', 'gems'].includes(catalog) && !filters.genre;
    const key = SNAPSHOT_PREFIX + JSON.stringify([
      type, pool, prefs.region, usesPlatforms ? [...prefs.platforms].sort() : [],
      usesGenres ? [...profile.genres].sort() : [], filters.genre,
    ]);
    let cached = this.rows.get(key);
    if (!cached && this.store) {
      const snapshot = await this.store.read(key) as Partial<CatalogSnapshot> | undefined;
      if (typeof snapshot?.refreshedAt === 'number' && Array.isArray(snapshot.batch?.titles)) {
        cached = snapshot as CatalogSnapshot;
        this.rows.set(key, cached);
      }
    }
    const age = cached ? this.now().getTime() - cached.refreshedAt : Infinity;
    const usable = age >= 0 && age < SNAPSHOT_MAX_AGE ? cached : undefined;
    if (usable && (age < REFRESH_INTERVAL || this.retry.get(key))) return usable.batch;

    let task = this.pending.get(key);
    if (!task) {
      if (usable && this.refreshing >= MAX_BACKGROUND_REFRESHES) return usable.batch;
      if (usable) this.refreshing++;
      task = this.load(profile, type, pool, filters).then(async batch => {
        const refreshedAt = this.now().getTime();
        const snapshot = { batch: { ...batch, revision: String(refreshedAt) }, refreshedAt };
        this.rows.set(key, snapshot);
        // Keep the memory cache usable if the optional SQLite cache cannot write.
        await this.store?.write(key, snapshot, SNAPSHOT_MAX_AGE).catch(() => undefined);
        return snapshot.batch;
      }).catch(error => {
        if (usable) this.retry.set(key, true);
        throw error;
      }).finally(() => {
        this.pending.delete(key);
        if (usable) this.refreshing--;
      });
      this.pending.set(key, task);
    }
    if (!usable) return task;
    // A client opening Home receives the last catalog while one refresh runs.
    void task.catch(() => {});
    return usable.batch;
  }

  private async load(profile: Profile, type: MediaType, catalog: CatalogId, filters: Pick<CatalogQuery, 'genre'> = {}): Promise<CandidateBatch> {
    const prefs = feedPreferences(profile);
    const genres = [...profile.genres].sort();
    const media = type === 'movie' ? 'movie' : 'tv';
    const today = dateOnly(this.now());
    const window = releaseWindow(catalog);
    const platformRow = catalog === 'trending' || catalog.startsWith('new');
    const common: Record<string, string | number> = { include_adult: 'false', sort_by: 'popularity.desc', page: 1 };
    if (type === 'series') common.without_genres = '10763,10767,10764';
    common[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = today;
    common[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = daysAgo(3 * 365, this.now());
    if (platformRow && catalog !== 'trending') {
      const providers = await this.client.get(`watch/providers/${media}`, { watch_region: prefs.region }, 86_400_000);
      const ids = (providers.results || []).filter((p: any) => typeof p.provider_name === 'string' && providerMatches(p.provider_name, prefs.platforms)).map((p: any) => p.provider_id);
      if (!ids.length) return { titles: [], revision: today, source: 'tmdb' };
      Object.assign(common, { watch_region: prefs.region, with_watch_providers: ids.join('|'), with_watch_monetization_types: 'flatrate' });
    }
    if (window) {
      common[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = daysAgo(window[1], this.now());
      common[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = daysAgo(window[0], this.now());
    }
    if (catalog === 'korean') common.with_origin_country = 'KR';
    if (catalog === 'chinese') common.with_origin_country = 'CN|TW|HK';
    if (catalog === 'japanese') { common.with_origin_country = 'JP'; common.without_genres = [common.without_genres, '16'].filter(Boolean).join(','); }
    if (catalog.startsWith('anime')) { common.with_genres = 16; common.with_origin_country = 'JP'; }
    if (catalog === 'genres' && profile.genres.length) common.with_genres = genres.map(g => type === 'movie' ? genreIds[g] : tvGenres(g)).filter(Boolean).join('|');
    if (filters.genre) {
      const genre = type === 'movie' ? genreIds[filters.genre] : tvGenres(filters.genre);
      common.with_genres = catalog.startsWith('anime') && genre !== 16 ? `16,${genre}` : genre!;
    }
    if (catalog === 'gems') { common['vote_count.gte'] = 20; common['vote_average.gte'] = 6; }
    const requests: Promise<any>[] = [];
    if (catalog === 'trending') {
      // Real weekly TMDB ranks; availability is checked per title and selected territory below.
      requests.push(this.client.get(`trending/${media}/week`, { page: 1 }), this.client.get(`trending/${media}/week`, { page: 2 }));
    } else {
      requests.push(this.client.get(`discover/${media}`, common), this.client.get(`discover/${media}`, { ...common, page: 2 }));
      if (['recommended', 'because', 'top', 'gems'].includes(catalog)) {
        requests.push(this.client.get(`discover/${media}`, { ...common, with_origin_country: 'KR|CN|TW|HK|JP', page: 1 }));
        requests.push(this.client.get(`discover/${media}`, { ...common, with_origin_country: 'JP', without_genres: [common.without_genres, '16'].filter(Boolean).join(','), page: 1 }));
        const preferredGenres = (filters.genre ? [filters.genre] : genres).map(g => type === 'movie' ? genreIds[g] : tvGenres(g)).filter(Boolean).join('|');
        if (preferredGenres) requests.push(this.client.get(`discover/${media}`, { ...common, with_genres: preferredGenres, page: 1 }));
        requests.push(this.client.get(`discover/${media}`, { ...common, with_genres: filters.genre ? `16,${type === 'movie' ? genreIds[filters.genre] : tvGenres(filters.genre)}` : 16, with_origin_country: 'JP', page: 1 }));
      }
    }
    const pages = await Promise.all(requests);
    // Interleave pools so Korean, Chinese and anime candidates survive the request budget.
    const interleaved: number[] = [];
    for (let i = 0; i < 20; i++) for (const page of pages) {
      const row = page.results?.[i];
      if (row && row.adult !== true && Number.isInteger(row.id)) interleaved.push(row.id);
    }
    const ids = [...new Set(interleaved)].slice(0, 40);
    const titles = (await Promise.all(ids.map(id => this.detail(id, type, prefs.region)))).filter((t): t is Title => Boolean(t));
    const filtered = titles.filter(t => !window || inReleaseWindow(t.releaseDate, ...window, this.now()))
      .filter(t => !platformRow || t.providers?.some(name => providerMatches(name, prefs.platforms)))
      .filter(t => catalog !== 'korean' || countryMatch(t, ['KR']))
      .filter(t => catalog !== 'chinese' || countryMatch(t, ['CN', 'TW', 'HK']))
      .filter(t => catalog !== 'japanese' || (countryMatch(t, ['JP']) && !t.genres.includes('Animation')))
      .filter(t => !catalog.startsWith('anime') || t.isAnime)
      .filter(t => !filters.genre || t.genres.includes(filters.genre));
    return {
      titles: filtered.map(t => catalog === 'trending' ? { ...t, weeklyTrend: 1 - ids.indexOf(t.tmdbId!) / Math.max(1, ids.length) } : t),
      revision: `${today}:${Math.floor(this.now().getTime() / 1_800_000)}`, source: 'tmdb',
    };
  }
}

/** Explicit demo only. Fresh/trending rows stay empty rather than disguising fixtures as current releases. */
export class FixtureLibrary implements LibrarySource {
  get mode(): LibrarySource['mode'] { return 'fixtures'; }
  async resolve(id: string, type?: MediaType) { return TITLES.find(t => t.id === id && (!type || t.type === type)); }
  async search(query: string, _region = 'US', type?: MediaType, page = 1) { return TITLES.filter(t => (!type || t.type === type) && (t.id === query || t.name.toLowerCase().includes(query.toLowerCase()))).slice(type ? (page-1)*20 : 0, type ? page*20 : 12); }
  async candidates(_profile: Profile, type: MediaType, catalog: CatalogId): Promise<CandidateBatch> {
    return { titles: catalog === 'trending' || releaseWindow(catalog) ? [] : TITLES.filter(t => t.type === type), revision: 'fixtures', source: 'fixtures' };
  }
}
export class UnconfiguredLibrary extends FixtureLibrary {
  // The mode communicates setup state; no demo candidates are served implicitly.
  override get mode(): LibrarySource['mode'] { return 'unconfigured'; }
  override async candidates(): Promise<CandidateBatch> { throw new UpstreamUnavailable('Cần thêm TMDB_READ_ACCESS_TOKEN vào Environment của máy chủ để bật feed trực tiếp.'); }
}
export { GENRES };
