import type { Title, MediaType, Profile } from '../shared/types.js';
import { feedPreferences, PLATFORMS, GENRES } from '../shared/preferences.js';
import { TtlCache } from '../shared/cache.js';
import { TmdbClient, UpstreamUnavailable } from './tmdb.js';
import type { MetadataStore } from './store.js';
import { TITLES } from './fixtures.js';
import type { CatalogId } from '../recommendation/catalogs.js';
import { dateOnly, daysAgo, inReleaseWindow, releaseWindow, releaseAge } from '../recommendation/dates.js';

const genreIds: Record<string, number> = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37 };
const genreNames = Object.fromEntries(Object.entries(genreIds).map(([name, id]) => [id, name]));
const tvGenres = (genre: string) => ['Action', 'Adventure'].includes(genre) ? 10759 : ['Sci-Fi', 'Fantasy'].includes(genre) ? 10765 : ['Romance', 'History'].includes(genre) ? 18 : ['Horror', 'Thriller'].includes(genre) ? 9648 : genre === 'Music' ? 99 : genre === 'War' ? 10768 : genreIds[genre];
const names = (values: any[] = [], limit = 12): string[] => values.filter(v => typeof v?.name === 'string').slice(0, limit).map(v => v.name);
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(releaseAge(value));
const countryMatch = (title: Title, countries: string[]) => title.originCountries?.some(c => countries.includes(c));
const providerMatches = (providerName: string, ids: string[]) => PLATFORMS.some(p => ids.includes(p.id) && (p.matches as readonly string[]).some(n => n.toLowerCase() === providerName.toLowerCase()));
export interface CandidateBatch { titles: Title[]; revision: string; source: 'tmdb' | 'fixtures' }
export interface LibrarySource {
  readonly mode: 'tmdb' | 'fixtures' | 'unconfigured';
  candidates(profile: Profile, type: MediaType, catalog: CatalogId): Promise<CandidateBatch>;
  resolve(id: string, type?: MediaType, region?: string): Promise<Title | undefined>;
  search(query: string, region: string): Promise<Title[]>;
}

export class LiveLibrary implements LibrarySource {
  readonly mode = 'tmdb' as const;
  private readonly rows = new TtlCache<CandidateBatch>(100, 1_800_000);
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
    const d = await this.client.get(`${media}/${id}`, { append_to_response: 'external_ids,credits,keywords,watch/providers' }, 86_400_000);
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

  async search(query: string, region: string): Promise<Title[]> {
    const data = await this.client.get('search/multi', { query, include_adult: 'false' });
    const rows = (data.results || []).filter((r: any) => r.adult !== true && ['movie', 'tv'].includes(r.media_type)).slice(0, 12);
    const titles = await Promise.all(rows.map((r: any) => this.detail(r.id, r.media_type === 'movie' ? 'movie' : 'series', region)));
    return titles.filter((t): t is Title => Boolean(t));
  }

  async candidates(profile: Profile, type: MediaType, catalog: CatalogId): Promise<CandidateBatch> {
    const prefs = feedPreferences(profile);
    const key = JSON.stringify([dateOnly(this.now()), type, catalog, prefs.region, [...prefs.platforms].sort(), [...profile.genres].sort()]);
    const cached = this.rows.get(key);
    if (cached) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.load(profile, type, catalog).then(batch => { this.rows.set(key, batch); return batch; }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private async load(profile: Profile, type: MediaType, catalog: CatalogId): Promise<CandidateBatch> {
    const prefs = feedPreferences(profile);
    const media = type === 'movie' ? 'movie' : 'tv';
    const today = dateOnly(this.now());
    const window = releaseWindow(catalog);
    const platformRow = catalog === 'trending' || catalog.startsWith('new');
    const common: Record<string, string | number> = { include_adult: 'false', sort_by: 'popularity.desc', page: 1 };
    if (type === 'series') common.without_genres = '10763,10767,10764';
    common[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = today;
    common[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = daysAgo(3 * 365, this.now());
    if (platformRow) {
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
    if (catalog === 'genres' && profile.genres.length) common.with_genres = profile.genres.map(g => type === 'movie' ? genreIds[g] : tvGenres(g)).filter(Boolean).join('|');
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
        const preferredGenres = profile.genres.map(g => type === 'movie' ? genreIds[g] : tvGenres(g)).filter(Boolean).join('|');
        if (preferredGenres) requests.push(this.client.get(`discover/${media}`, { ...common, with_genres: preferredGenres, page: 1 }));
        requests.push(this.client.get(`discover/${media}`, { ...common, with_genres: 16, with_origin_country: 'JP', page: 1 }));
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
      .filter(t => !catalog.startsWith('anime') || t.isAnime);
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
  async search(query: string) { return TITLES.filter(t => t.name.toLowerCase().includes(query.toLowerCase())); }
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
