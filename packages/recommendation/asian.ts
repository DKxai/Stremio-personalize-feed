import type { Title } from '../shared/types.js';
import type { CatalogId } from './catalogs.js';

/** Explicit origin checks prevent language-only false positives. */
interface AsianFilter { countries: readonly string[]; genres?: readonly string[]; excluded?: readonly string[]; animation?: boolean }
export const ASIAN_FILTERS: Partial<Record<CatalogId, AsianFilter>> = {
  korean: { countries: ['KR'], excluded: ['Animation'] },
  'asian-jp-sea': { countries: ['JP','VN','TH','ID','MY','PH','SG'] },
  'k-thriller': { countries: ['KR'], genres: ['Crime', 'Thriller', 'Mystery'], excluded: ['Animation'] },
  chinese: { countries: ['CN', 'TW', 'HK'], excluded: ['Animation'] },
  // Fantasy / History / Adventure are a broad, robust proxy: TMDB has no single reliable "xianxia" genre.
  'c-costume': { countries: ['CN', 'TW', 'HK'], genres: ['Fantasy', 'History', 'Adventure'], excluded: ['Animation'] },
  japanese: { countries: ['JP'], excluded: ['Animation'] },
  'jp-mystery': { countries: ['JP'], genres: ['Mystery', 'Thriller', 'Crime'], excluded: ['Animation'] },
  anime: { countries: ['JP'], animation: true },
  donghua: { countries: ['CN', 'TW', 'HK'], animation: true },
  'southeast-asia': { countries: ['VN', 'TH', 'ID', 'MY', 'PH', 'SG'] },
  vietnam: { countries: ['VN'] },
  'thai-horror': { countries: ['TH'], genres: ['Horror', 'Thriller', 'Mystery'] },
  'indonesian-action': { countries: ['ID'], genres: ['Action', 'Adventure', 'Crime'] },
};
export const asianFilter = (id: CatalogId) => ASIAN_FILTERS[id];
export function matchesAsian(title: Title, catalog: CatalogId): boolean {
  const rule = asianFilter(catalog);
  if (!rule) return true;
  if (!title.originCountries?.some(c => rule.countries.includes(c))) return false;
  if (rule.excluded?.some(g => title.genres.includes(g))) return false;
  if (rule.animation && !title.genres.includes('Animation')) return false;
  if (rule.genres && !rule.genres.some(g => title.genres.includes(g))) return false;
  return true;
}
