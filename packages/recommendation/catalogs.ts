export const CATALOGS = [
  { id: 'recommended', name: 'Recommended for You' },
  { id: 'because', name: 'Because You Watched' },
  { id: 'genres', name: 'Your Favorite Genres' },
  { id: 'gems', name: 'Hidden Gems' },
  { id: 'trending', name: 'Trending for You' },
  { id: 'top', name: 'Top Picks' },
] as const;

export type CatalogId = (typeof CATALOGS)[number]['id'];
export const isCatalogId = (id: string): id is CatalogId => CATALOGS.some(c => c.id === id);
export const PAGE_SIZE = 20;
