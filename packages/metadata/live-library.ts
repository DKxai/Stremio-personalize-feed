import type { Title, MediaType, Profile, EpisodeAirDate } from '../shared/types.js';
import { feedPreferences, platformPriority, LANGUAGES, GENRES } from '../shared/preferences.js';
import { TtlCache } from '../shared/cache.js';
import { TmdbClient, UpstreamUnavailable } from './tmdb.js';
import type { TvdbClient } from './tvdb.js';
import { showCountries } from '../recommendation/views.js';
import type { MetadataStore } from './store.js';
import { TITLES } from './fixtures.js';
import type { CatalogQuery } from '../recommendation/catalog-query.js';
import { isFreshCatalog, type CatalogId } from '../recommendation/catalogs.js';
import { airingWindow, latestRelease, matchesAiring, vietnamDate } from '../recommendation/airing.js';
import { dateOnly, daysAgo, inReleaseWindow, releaseWindow, releaseAge, recommendationDay } from '../recommendation/dates.js';

const genreIds: Record<string, number> = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37 };
const genreNames: Record<number, string> = { ...Object.fromEntries(Object.entries(genreIds).map(([name, id]) => [id, name])), 10763: 'News', 10764: 'Reality', 10767: 'Talk' };
const tvGenres = (genre: string) => ['Action', 'Adventure'].includes(genre) ? 10759 : ['Sci-Fi', 'Fantasy'].includes(genre) ? 10765 : ['Romance', 'History'].includes(genre) ? 18 : ['Horror', 'Thriller'].includes(genre) ? 9648 : genre === 'Music' ? 99 : genre === 'War' ? 10768 : genreIds[genre];
const names = (values: any[] = [], limit = 12): string[] => values.filter(v => typeof v?.name === 'string').slice(0, limit).map(v => v.name);
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(releaseAge(value));
const countryMatch = (title: Title, countries: string[]) => title.originCountries?.some(c => countries.includes(c));
const SNAPSHOT_PREFIX = 'catalog:v2:';
const REFRESH_INTERVAL = 30 * 60_000;
const SNAPSHOT_MAX_AGE = 24 * 60 * 60_000;
const MAX_BACKGROUND_REFRESHES = 2;
const RETRY_DELAY = 60_000;
interface CatalogSnapshot { batch: CandidateBatch; refreshedAt: number }
// Keep only fields used to resolve IMDb IDs, rank titles and show availability.
function compactDetail(detail: any) {
  if (detail.compactVersion === 2) return detail;
  const availability = detail['watch/providers'];
  const providers = Object.fromEntries(Object.entries(availability?.results ?? {}).map(([region, value]) => {
    const entry = value as { flatrate?: { provider_name: string }[]; link?: string };
    return [region, { flatrate: entry.flatrate?.slice(0, 30).map(provider => ({ provider_name: provider.provider_name })), link: entry.link }];
  }));
  return {
    compactVersion: 2,
    status: detail.status,
    seasons: detail.seasons?.filter((season: any) => season.season_number > 0).slice(-40).map((season: any) => ({ air_date: season.air_date })),
    last_episode_to_air: detail.last_episode_to_air && compactEpisode(detail.last_episode_to_air),
    next_episode_to_air: detail.next_episode_to_air && compactEpisode(detail.next_episode_to_air),
    imdb_id: detail.imdb_id,
    external_ids: { imdb_id: detail.external_ids?.imdb_id, tvdb_id: detail.external_ids?.tvdb_id },
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

function compactEpisode(value: any) {
  return { air_date: value.air_date, season_number: value.season_number, episode_number: value.episode_number };
}

function episodeDate(value: any): EpisodeAirDate | undefined {
  if (!value || !validDate(value.air_date) || !Number.isInteger(value.season_number) || value.season_number < 1
    || !Number.isInteger(value.episode_number) || value.episode_number < 1) return undefined;
  return { date: value.air_date, season: value.season_number, episode: value.episode_number };
}

export interface CandidateBatch { more?: boolean; titles: Title[]; revision: string; source: 'tmdb' | 'fixtures' }
export interface DiscoverBatch { titles: Title[]; more: boolean }
export interface LibrarySource {
  searchPage?(query: string, region: string, type?: MediaType, page?: number): Promise<DiscoverBatch>;
  discoverPage?(profile: Profile, type: MediaType, catalog: CatalogId, page: number, genre?: string, country?: string): Promise<DiscoverBatch>;
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
  constructor(private readonly client: TmdbClient, private readonly store?: MetadataStore, private readonly now: () => Date = () => new Date(), private readonly tvdb?: TvdbClient) {}

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

  private async detail(id: number, type: MediaType, region: string, allowUpcoming = false): Promise<Title | undefined> {
    const media = type === 'movie' ? 'movie' : 'tv';
    const d = await this.client.get(`${media}/${id}`, { append_to_response: 'external_ids,keywords,credits,watch/providers' }, type === 'series' ? 3 * 3_600_000 : 86_400_000, compactDetail);
    if (!d) return undefined;
    let imdb = d.imdb_id || d.external_ids?.imdb_id;
    const tvdbId = d.external_ids?.tvdb_id;
    const show = type === 'series' && d.genres?.some((g: { id: number }) => [10764, 10767].includes(g.id));
    const lookup = Number.isSafeInteger(tvdbId) && tvdbId > 0 ? tvdbId : imdb;
    const extra = type === 'series' && lookup && (show || !imdb)
      ? await this.tvdb?.series(lookup) : undefined;
    if (!imdb) imdb = extra?.imdb;
    const tags = extra && (!extra.imdb || extra.imdb === imdb) ? extra.tags : [];
    const releaseDate = type === 'movie' ? d.release_date : d.first_air_date;
    if (d.adult === true || !/^tt\d{7,10}$/.test(imdb ?? '') || !validDate(releaseDate) || (!allowUpcoming && releaseDate > dateOnly(vietnamDate(this.now())))) return undefined;
    const availability = d['watch/providers']?.results?.[region];
    const origins: string[] = d.origin_country || (d.production_countries || []).map((c: any) => c.iso_3166_1);
    const genres: string[] = (d.genres || []).flatMap((g: any) => g.id === 10759 ? ['Action', 'Adventure'] : g.id === 10765 ? ['Sci-Fi', 'Fantasy'] : g.id === 10768 ? ['War'] : genreNames[g.id] ? [genreNames[g.id]] : []);
    const keywords = names(d.keywords?.keywords || d.keywords?.results, 15);
    if (keywords.some(k => /romanc|romantic/i.test(k)) && !genres.includes('Romance')) genres.push('Romance');
    if (keywords.some(k => /horror/i.test(k)) && !genres.includes('Horror')) genres.push('Horror');
    if (keywords.some(k => /thriller/i.test(k)) && !genres.includes('Thriller')) genres.push('Thriller');
    const title: Title = {
      id: imdb, tmdbId: id, type, name: d.title || d.name || d.original_title || d.original_name,
      originalName: d.original_title || d.original_name,
      year: Number(releaseDate.slice(0, 4)), releaseDate, genres,
      cast: names(d.credits?.cast, 8), directors: names((d.credits?.crew || []).filter((c: any) => c.job === 'Director'), 4),
      keywords: [...new Set([...keywords.map(k => k.toLowerCase()), ...tags])],
      // Bayesian shrinkage stops a single 10/10 vote dominating brand-new titles.
      quality: ((Number(d.vote_average) || 0) * (Number(d.vote_count) || 0) + 6 * 50) / ((Number(d.vote_count) || 0) + 50) / 10,
      popularity: Math.min(1, Math.log1p(Math.max(0, Number(d.popularity) || 0)) / Math.log(1001)),
      originCountries: origins, originalLanguage: d.original_language,
      isAnime: genres.includes('Animation') && (origins.includes('JP') || d.original_language === 'ja'),
      ...(type === 'series' ? {
        seriesStatus: typeof d.status === 'string' ? d.status : undefined,
        seasonStarts: (d.seasons || []).map((season: any) => season.air_date).filter(validDate),
        lastEpisode: episodeDate(d.last_episode_to_air),
        nextEpisode: episodeDate(d.next_episode_to_air),
      } : {}),
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

  async search(query: string, region: string, type?: MediaType, page = 1) {
    return (await this.searchPage(query, region, type, page)).titles;
  }

  async searchPage(query: string, region: string, type?: MediaType, page = 1): Promise<DiscoverBatch> {
    if (/^tt\d{7,10}$/.test(query)) {
      if (page > 1) return { titles: [], more: false };
      const title = await this.resolve(query, type, region); return { titles: title ? [title] : [], more: false };
    }
    const data = await this.client.get(type ? `search/${type === 'movie' ? 'movie' : 'tv'}` : 'search/multi', { query, include_adult: 'false', page });
    const rows = (data?.results || []).filter((r: any) => r.adult !== true && (type || ['movie', 'tv'].includes(r.media_type))).slice(0, type ? 20 : 12);
    const titles = await Promise.all(rows.map((r: any) => this.detail(r.id, type || (r.media_type === 'movie' ? 'movie' : 'series'), region)));
    // Keep TMDB relevance and alias matching, including Japanese/Korean/Chinese names.
    return { titles: titles.filter((t): t is Title => Boolean(t)), more: page < Math.min(data?.total_pages ?? 1, 500) };
  }

  async discoverPage(profile: Profile, type: MediaType, catalog: CatalogId, page: number, genre?: string, country?: string): Promise<DiscoverBatch> {
    if (catalog !== 'tv-shows' && catalog !== 'animation') {
      const batch = await this.candidates(profile, type, catalog, { genre }, page);
      return { titles: batch.titles, more: Boolean(batch.more) };
    }
    const media = type === 'movie' ? 'movie' : 'tv';
    const selectedGenre = genre && (type === 'movie' ? genreIds[genre] : tvGenres(genre));
    const params: Record<string, string | number> = { page, include_adult: 'false', sort_by: 'popularity.desc' };
    if (selectedGenre) params.with_genres = selectedGenre;
    if (type === 'series') params.without_genres = '10763,10767,10764';
    if (catalog === 'animation') params.with_genres = selectedGenre && selectedGenre !== 16 ? '16,' + selectedGenre : 16;
    if (catalog === 'tv-shows') Object.assign(params, { with_genres: '10764|10767', without_genres: '10763' });
    params[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = dateOnly(vietnamDate(this.now()));
    const countries = catalog === 'tv-shows' ? (country ? [country] : Object.values(showCountries)) : [undefined];
    const lists = await Promise.all(countries.map(origin => this.client.get('discover/' + media,
      origin ? { ...params, with_origin_country: origin } : params)));
    const ids = new Set<number>();
    for (let i = 0; i < 20; i++) for (const list of lists) {
      const row = list?.results?.[i];
      if (Number.isInteger(row?.id) && !row.adult) ids.add(row.id);
    }
    const titles = await Promise.all([...ids].map(id => this.detail(id, type, feedPreferences(profile).region)));
    return {
      titles: titles.filter((t): t is Title => Boolean(t && (!genre || t.genres.includes(genre))
        && (catalog !== 'tv-shows' || countries.some(c => c && t.originCountries?.includes(c))))),
      more: lists.some(list => page < Math.min(list?.total_pages ?? 1, 500)),
    };
  }

  async candidates(profile: Profile, type: MediaType, catalog: CatalogId, filters: Pick<CatalogQuery, 'genre'> = {}, round = 0): Promise<CandidateBatch> {
    const prefs = feedPreferences(profile);
    const pool = catalog === 'because' || catalog === 'top' ? 'recommended' : catalog;
    const usesOrigins = pool === 'recommended' || pool === 'gems';
    const usesLanguages = pool === 'recommended';
    const origins = [...prefs.preferredOrigins].sort();
    const usesPlatforms = catalog === 'trending' || catalog === 'recent' || catalog.startsWith('new');
    const usesGenres = ['recommended', 'because', 'genres', 'top', 'gems'].includes(catalog) && !filters.genre;
    const key = SNAPSHOT_PREFIX + JSON.stringify([
      type, pool, round, prefs.region, usesPlatforms ? [...prefs.platforms].sort() : [],
      usesGenres ? [...profile.genres].sort() : [], filters.genre,
      usesOrigins ? origins : [], usesLanguages ? [...prefs.preferredLanguages].sort() : [],
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
    const refreshInterval = catalog === 'trending' ? 2 * 3_600_000 : REFRESH_INTERVAL;
    const usable = age >= 0 && age < SNAPSHOT_MAX_AGE ? cached : undefined;
    if (usable && (age < refreshInterval || this.retry.get(key))) return usable.batch;

    let task = this.pending.get(key);
    if (!task) {
      if (usable && this.refreshing >= MAX_BACKGROUND_REFRESHES) return usable.batch;
      if (usable) this.refreshing++;
      task = this.load(profile, type, pool, filters, round).then(async batch => {
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

  private async load(profile: Profile, type: MediaType, catalog: CatalogId, filters: Pick<CatalogQuery, 'genre'> = {}, round = 0): Promise<CandidateBatch> {
    const prefs = feedPreferences(profile);
    const origins = [...prefs.preferredOrigins].sort();
    const genres = [...profile.genres].sort();
    const media = type === 'movie' ? 'movie' : 'tv';
    const now = this.now();
    const today = dateOnly(vietnamDate(now));
    const window = releaseWindow(catalog);
    const platformRow = catalog === 'trending' || catalog === 'recent' || catalog.startsWith('new');
    const language = LANGUAGES.find(item => catalog === `lang-${item.id}`);
    const airing = type === 'series' ? airingWindow(catalog, now) : undefined;
    const common: Record<string, string | number> = { include_adult: 'false', sort_by: 'popularity.desc', page: 1 };
    if (type === 'series') common.without_genres = '10763,10767,10764';
    common[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = today;
    common[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = daysAgo(3 * 365, this.now());
    if (platformRow && catalog !== 'trending') {
      const providers = await this.client.get(`watch/providers/${media}`, { watch_region: prefs.region }, 86_400_000);
      const ids = (providers.results || []).filter((p: any) => typeof p.provider_name === 'string' && platformPriority([p.provider_name], prefs.platforms) >= 0).map((p: any) => p.provider_id);
      if (!ids.length) return { titles: [], revision: today, source: 'tmdb' };
      Object.assign(common, { watch_region: prefs.region, with_watch_providers: ids.join('|'), with_watch_monetization_types: 'flatrate' });
    }
    if (catalog === 'recent' && type === 'series') {
      delete common['first_air_date.gte'];
      common['air_date.gte'] = daysAgo(89, vietnamDate(now));
      common['air_date.lte'] = today;
      common.timezone = 'Asia/Ho_Chi_Minh';
    } else if (window) {
      common[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = daysAgo(window[1], vietnamDate(now));
      common[type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = daysAgo(window[0], vietnamDate(now));
    }
    if (catalog === 'korean') common.with_origin_country = 'KR';
    if (catalog === 'chinese') common.with_origin_country = 'CN|TW|HK';
    if (catalog === 'japanese') { common.with_origin_country = 'JP'; common.without_genres = [common.without_genres, '16'].filter(Boolean).join(','); }
    if (catalog.startsWith('anime')) { common.with_genres = 16; common.with_origin_country = 'JP'; }
    if (catalog === 'donghua') { common.with_genres = 16; common.with_origin_country = 'CN|TW|HK'; }
    if (language?.id === 'ja') common.without_genres = [common.without_genres, '16'].filter(Boolean).join(',');
    if (airing) {
      delete common['first_air_date.gte'];
      common['air_date.gte'] = airing[0];
      common['air_date.lte'] = airing[1];
      common.timezone = 'Asia/Ho_Chi_Minh';
      if (catalog === 'anime-upcoming') common['first_air_date.lte'] = airing[1];
    }
    if (catalog === 'anime-completed') { common.with_status = 3; delete common['first_air_date.gte']; }
    if (catalog === 'anime-gems') { common['vote_count.gte'] = 15; common['vote_average.gte'] = 7; }

    if (catalog === 'genres' && profile.genres.length) common.with_genres = genres.map(g => type === 'movie' ? genreIds[g] : tvGenres(g)).filter(Boolean).join('|');
    if (filters.genre) {
      const genre = type === 'movie' ? genreIds[filters.genre] : tvGenres(filters.genre);
      common.with_genres = (catalog.startsWith('anime') || catalog === 'donghua') && genre !== 16 ? `16,${genre}` : genre!;
    }
    if (catalog === 'gems') {
      common['vote_count.gte'] = 20;
      common['vote_average.gte'] = 6;
      common[type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte'] = daysAgo(8 * 365, vietnamDate(now));
    }
    const requests: Promise<any>[] = [];
    let more = false;
    // Sources which already read two adjacent TMDB pages advance by two per round.
    const offset = Math.max(0, round - 1);
    const add = (path: string, params: Record<string, string | number>, stride = 1, ttl?: number) => {
      const page = Number(params.page ?? 1) + offset * stride;
      if (page > 500) return;
      requests.push(this.client.get(path, { ...params, page }, ttl).then(data => {
        if (page + stride <= Math.min(data?.total_pages ?? 1, 500)) more = true;
        return data;
      }));
    };
    if (catalog === 'trending') {
      // Real weekly TMDB ranks; availability is checked per title and selected territory below.
      for (const page of [1, 2]) add(`trending/${media}/week`, { page }, 2, 2 * 3_600_000);
    } else if (language) {
      for (const code of language.codes) add(`discover/${media}`, { ...common, with_original_language: code }, language.codes.length === 1 ? 2 : 1);
      if (language.codes.length === 1) add(`discover/${media}`, { ...common, with_original_language: language.codes[0], page: 2 }, 2);
    } else {
      add(`discover/${media}`, common, catalog === 'recommended' ? 1 : 2);
      const secondPage = catalog === 'recommended'
        ? {
          ...common,
          [type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte']: daysAgo(180, now),
          sort_by: 'vote_average.desc',
          'vote_count.gte': 20,
          page: 1 + recommendationDay(now) % 3,
        }
        : { ...common, page: 2 };
      add(`discover/${media}`, secondPage, catalog === 'recommended' ? 1 : 2);
      if (['recommended', 'because', 'top', 'gems'].includes(catalog)) {
        if (catalog === 'recommended' && prefs.preferredLanguages.length > 0 && prefs.preferredLanguages.length < LANGUAGES.length) {
          // Rotate language coverage within the existing 40-title detail cap.
          const preferred = LANGUAGES.filter(item => prefs.preferredLanguages.includes(item.id));
          const index = recommendationDay(now) % Math.max(1, preferred.length);
          const mainLanguage = preferred[index];
          if (mainLanguage) add(`discover/${media}`, { ...common, with_original_language: mainLanguage.codes[0] });
        }
        if (origins.length) {
          add(`discover/${media}`, { ...common, with_origin_country: origins.join('|'), page: 1 });
        }
        if (origins.includes('JP') && (prefs.preferredLanguages.length === 0 || prefs.preferredLanguages.length === LANGUAGES.length || catalog !== 'recommended')) {
          add(`discover/${media}`, { ...common, with_origin_country: 'JP', without_genres: [common.without_genres, '16'].filter(Boolean).join(','), page: 1 });
        }
        const preferredGenres = (filters.genre ? [filters.genre] : genres).map(g => type === 'movie' ? genreIds[g] : tvGenres(g)).filter(Boolean).join('|');
        if (preferredGenres) add(`discover/${media}`, { ...common, with_genres: preferredGenres, page: 1 });
        add(`discover/${media}`, { ...common, with_genres: filters.genre ? `16,${type === 'movie' ? genreIds[filters.genre] : tvGenres(filters.genre)}` : 16, with_origin_country: 'JP', page: 1 });
      }
    }
    const pages = await Promise.all(requests);
    const candidateRows = [];
    if (catalog === 'trending') {
      for (const page of pages) candidateRows.push(...(page.results ?? []).slice(0, 20));
    } else {
      // Interleave discovery pools to keep a mix of origins and anime within the lookup budget.
      for (let i = 0; i < 20; i++) for (const page of pages) candidateRows.push(page.results?.[i]);
    }
    const ids = [...new Set<number>(candidateRows
      .filter(row => row && row.adult !== true && Number.isInteger(row.id)).map(row => row.id))].slice(0, round ? undefined : 40);
    const titles = (await Promise.all(ids.map(id => this.detail(id, type, prefs.region, catalog === 'anime-upcoming')))).filter((t): t is Title => Boolean(t));
    const filtered = titles.filter(t => !window || inReleaseWindow(catalog === 'recent' ? latestRelease(t, vietnamDate(now)) : t.releaseDate, ...window, vietnamDate(now)))
      .filter(t => matchesAiring(t, catalog, now))
      .filter(t => !language || ((language.codes as readonly string[]).includes(t.originalLanguage ?? '') && (language.id !== 'ja' || !t.isAnime)))
      .filter(t => catalog !== 'donghua' || (t.genres.includes('Animation') && countryMatch(t, ['CN', 'TW', 'HK'])))
      .filter(t => !platformRow || platformPriority(t.providers ?? [], prefs.platforms) >= 0)
      .filter(t => catalog !== 'korean' || countryMatch(t, ['KR']))
      .filter(t => catalog !== 'chinese' || countryMatch(t, ['CN', 'TW', 'HK']))
      .filter(t => catalog !== 'japanese' || (countryMatch(t, ['JP']) && !t.genres.includes('Animation')))
      .filter(t => !catalog.startsWith('anime') || t.isAnime)
      .filter(t => !filters.genre || t.genres.includes(filters.genre));
    return {
      more, titles: filtered.map(t => catalog === 'trending' ? { ...t, weeklyTrend: 1 - ids.indexOf(t.tmdbId!) / Math.max(1, ids.length) } : t),
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
    return { titles: catalog === 'trending' || isFreshCatalog(catalog) ? [] : TITLES.filter(t => t.type === type), revision: 'fixtures', source: 'fixtures' };
  }
}
export class UnconfiguredLibrary extends FixtureLibrary {
  // The mode communicates setup state; no demo candidates are served implicitly.
  override get mode(): LibrarySource['mode'] { return 'unconfigured'; }
  override async candidates(): Promise<CandidateBatch> { throw new UpstreamUnavailable('Cần thêm TMDB_READ_ACCESS_TOKEN vào Environment của máy chủ để bật feed trực tiếp.'); }
}
export { GENRES };
