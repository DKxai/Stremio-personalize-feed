export const PLATFORMS = [
  { id: 'netflix', name: 'Netflix', matches: ['Netflix', 'Netflix Standard with Ads'] },
  { id: 'disney', name: 'Disney+', matches: ['Disney Plus'] },
  { id: 'max', name: 'HBO Max / Max', matches: ['HBO Max', 'Max', 'HBO Max Amazon Channel', 'Max Amazon Channel'] },
  { id: 'prime', name: 'Prime Video', matches: ['Amazon Prime Video', 'Amazon Prime Video with Ads'] },
  { id: 'apple', name: 'Apple TV+', matches: ['Apple TV Plus', 'Apple TV'] },
  { id: 'hulu', name: 'Hulu', matches: ['Hulu'] },
  { id: 'crunchyroll', name: 'Crunchyroll', matches: ['Crunchyroll', 'Crunchyroll Amazon Channel'] },
  { id: 'viki', name: 'Rakuten Viki', matches: ['Rakuten Viki'] },
  { id: 'iqiyi', name: 'iQIYI', matches: ['iQIYI'] },
  { id: 'wetv', name: 'WeTV', matches: ['WeTV'] },
] as const;
export const REGIONS = ['US', 'VN', 'KR', 'JP', 'TW', 'HK', 'SG', 'GB', 'AU', 'CA'] as const;
export const ORIGINS = ['KR', 'CN', 'TW', 'HK', 'JP', 'US'] as const;
export const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'] as const;
export interface FeedPreferences { region: string; platforms: string[]; preferredOrigins: string[]; preferAnime: boolean }
export const DEFAULT_FEED: FeedPreferences = {
  region: 'US', platforms: PLATFORMS.map(p => p.id), preferredOrigins: ['KR', 'CN', 'TW', 'HK', 'JP'], preferAnime: true,
};
export function feedPreferences(value: Partial<FeedPreferences> = {}): FeedPreferences {
  return {
    region: value.region ?? DEFAULT_FEED.region,
    platforms: value.platforms ?? DEFAULT_FEED.platforms,
    preferredOrigins: value.preferredOrigins ?? DEFAULT_FEED.preferredOrigins,
    preferAnime: value.preferAnime ?? DEFAULT_FEED.preferAnime,
  };
}
