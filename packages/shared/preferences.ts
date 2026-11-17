export const PLATFORMS = [
  { id: 'netflix', name: 'Netflix', matches: ['Netflix', 'Netflix Standard with Ads'] },
  { id: 'disney', name: 'Disney+', matches: ['Disney Plus'] },
  { id: 'max', name: 'HBO Max / Max', matches: ['HBO Max', 'Max', 'HBO Max Amazon Channel', 'Max Amazon Channel'] },
  { id: 'prime', name: 'Prime Video', matches: ['Amazon Prime Video', 'Amazon Prime Video with Ads'] },
  { id: 'apple', name: 'Apple TV+', matches: ['Apple TV Plus', 'Apple TV'] },
  { id: 'crunchyroll', name: 'Crunchyroll', matches: ['Crunchyroll', 'Crunchyroll Amazon Channel'] },
  { id: 'viki', name: 'Rakuten Viki', matches: ['Rakuten Viki'] },
  { id: 'iqiyi', name: 'iQIYI', matches: ['iQIYI'] },
  { id: 'wetv', name: 'WeTV', matches: ['WeTV'] },
  { id: 'hulu', name: 'Hulu', matches: ['Hulu'] },
] as const;

export function platformPriority(providerNames: readonly string[], selectedPlatforms: readonly string[]): number {
  const names = new Set(providerNames.map(name => name.toLowerCase()));
  return PLATFORMS.findIndex(platform => selectedPlatforms.includes(platform.id)
    && platform.matches.some(name => names.has(name.toLowerCase())));
}

export const LANGUAGES = [
  { id: 'ko', name: 'Tiếng Hàn', codes: ['ko'] },
  { id: 'en', name: 'Tiếng Anh', codes: ['en'] },
  { id: 'ja', name: 'Tiếng Nhật', codes: ['ja'] },
  { id: 'zh', name: 'Tiếng Trung', codes: ['zh', 'cn', 'yue'] },
] as const;
export const HOME_EXTRAS = ['regional-movies', 'because'] as const;
export const REGIONS = ['US', 'VN', 'KR', 'JP', 'TW', 'HK', 'SG', 'GB', 'AU', 'CA'] as const;
export const ORIGINS = ['KR', 'CN', 'TW', 'HK', 'JP', 'US'] as const;
export const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'] as const;
export interface FeedPreferences { region: string; platforms: string[]; preferredOrigins: string[]; preferredLanguages: string[]; homeExtras: string[]; preferAnime: boolean; syncLibrary: boolean; syncPlayback: boolean }
export const DEFAULT_FEED: FeedPreferences = {
  region: 'US', platforms: PLATFORMS.map(p => p.id), preferredOrigins: ['KR', 'CN', 'TW', 'HK', 'JP'], preferredLanguages: LANGUAGES.map(language => language.id), homeExtras: [], preferAnime: true, syncLibrary: true, syncPlayback: false,
};
export function feedPreferences(value: Partial<FeedPreferences> = {}): FeedPreferences {
  return {
    region: value.region ?? DEFAULT_FEED.region,
    platforms: value.platforms ?? DEFAULT_FEED.platforms,
    preferredOrigins: value.preferredOrigins ?? DEFAULT_FEED.preferredOrigins,
    preferredLanguages: value.preferredLanguages ?? DEFAULT_FEED.preferredLanguages,
    homeExtras: value.homeExtras ?? DEFAULT_FEED.homeExtras,
    preferAnime: value.preferAnime ?? DEFAULT_FEED.preferAnime,
    syncLibrary: value.syncLibrary ?? DEFAULT_FEED.syncLibrary,
    syncPlayback: value.syncPlayback ?? DEFAULT_FEED.syncPlayback,
  };
}
