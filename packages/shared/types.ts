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
  // Editorial demonstration weight, NOT live TMDB popularity or trending.
  popularity: number;
}

export interface Profile {
  id: string;
  version: number;
  genres: string[];
  favorites: string[];
  likes: string[];
  dislikes: string[];
  watched: string[];
}
