import type { FeedPreferences } from './preferences.js';

export type MediaType = 'movie' | 'series';

export interface Title {
  id: string;
  type: MediaType;
  name: string;
  year: number;
  genres: string[];
  cast: string[];
  directors: string[];
  keywords: string[];
  quality: number;
  popularity: number;
  tmdbId?: number;
  releaseDate?: string;
  originCountries?: string[];
  originalLanguage?: string;
  isAnime?: boolean;
  poster?: string;
  overview?: string;
  providers?: string[];
  providerLink?: string;
  weeklyTrend?: number;
  source?: 'tmdb' | 'fixtures';
  activityNote?: string;
}

export interface Profile extends Partial<FeedPreferences> {
  id: string;
  version: number;
  genres: string[];
  favorites: string[];
  likes: string[];
  dislikes: string[];
  watched: string[];
  saved?: string[];
  started?: string[];
  episodeCounts?: Record<string, number>;
  itemTypes?: Record<string, MediaType>;
  lastLibraryEventAt?: string | null;
  lastPlayerEventAt?: string | null;
}
