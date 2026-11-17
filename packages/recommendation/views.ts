import { GENRES, LANGUAGES, PLATFORMS, feedPreferences, type FeedPreferences } from '../shared/preferences.js';
import type { MediaType, Profile } from '../shared/types.js';
import { CATALOGS, type CatalogId } from './catalogs.js';

const genres: readonly string[] = GENRES;
const both = ['movie', 'series'] as const;
const catalogNames = new Map<CatalogId, string>(CATALOGS.map(({ id, name }) => [id, name]));
const releaseViews = { 'Trong 30 ngày': 'new30', '31–60 ngày': 'new60', '61–90 ngày': 'new90' } as const;
const animeViews = { 'Đã hoàn thành': 'anime-completed', 'Sắp phát sóng': 'anime-upcoming', 'Đáng xem, ít người biết': 'anime-gems', 'Donghua Trung Quốc': 'donghua' } as const;
export const animeThemes = {
  Isekai: /isekai|another world/i, 'Học đường': /school|student/i, 'Tình cảm': /romance|romantic/i,
  'Thể thao': /sport|football|basketball|volleyball|baseball/i, Mecha: /mecha|giant robot/i,
  'Trinh thám': /detective|investigation|mystery/i,
} as const;
const languageViews = { 'Tiếng Hàn': 'lang-ko', 'Tiếng Anh': 'lang-en', 'Tiếng Nhật': 'lang-ja', 'Tiếng Trung': 'lang-zh' } as const;
const originViews = { 'Hàn Quốc': 'korean', 'Nhật Bản': 'japanese', 'Trung Quốc, Đài Loan, Hồng Kông': 'chinese' } as const;
export const showCountries: Record<string, string> = { 'Anh': 'GB', 'Nhật': 'JP', 'Hàn': 'KR', 'Trung Quốc': 'CN' };
const libraryViews = { 'Đã lưu & Yêu thích': 'saved', 'Đã xem': 'watched' } as const;
const viewSelections: Partial<Record<CatalogId, Readonly<Record<string, CatalogId>>>> = {
  recent: releaseViews, anime: animeViews, languages: languageViews, origins: originViews, library: libraryViews,
};

interface View {
  id: CatalogId;
  type: MediaType;
  name: string;
  home: boolean;
  options: readonly string[];
}

export function catalogViews(preferences: Partial<FeedPreferences> = {}, hasHistory = true): View[] {
  const prefs = feedPreferences(preferences);
  const views: View[] = [];
  function add(id: CatalogId, types: readonly MediaType[], home = true, options = genres) {
    for (const type of types) views.push({ id, type, name: catalogNames.get(id)!, home, options });
  }
  add('recommended', both);
  add('recent', both, true, Object.keys(releaseViews));
  add('trending', both, true, PLATFORMS.filter(platform => prefs.platforms.includes(platform.id)).map(platform => platform.name));
  const languages = [...LANGUAGES].sort((a, b) =>
    Number(prefs.preferredLanguages.includes(b.id)) - Number(prefs.preferredLanguages.includes(a.id)));
  for (const language of languages) add(`lang-${language.id}`, prefs.homeExtras.includes('regional-movies') ? ['series', 'movie'] : ['series']);
  add('tv-shows', ['series'], false, ['Tất cả', ...Object.keys(showCountries)]);
  add('animation', both, false, ['Tất cả', ...genres.filter(g => g !== 'Animation')]);
  add('anime-season', ['series']);
  add('anime-episodes', ['series']);
  add('anime', ['series'], true, [...Object.keys(animeViews), ...Object.keys(animeThemes), ...genres]);
  add('anime', ['movie'], true, [...Object.keys(animeThemes), ...genres]);
  add('gems', ['movie']);
  add('languages', ['movie'], false, Object.keys(languageViews));
  add('origins', both, false, Object.keys(originViews));
  add('library', both, false, Object.keys(libraryViews));
  if (hasHistory && prefs.homeExtras.includes('because')) add('because', both);
  return views;
}

export function selectCatalog(profile: Profile, id: CatalogId, type: MediaType, option?: string) {
  const invalid = () => Object.assign(new Error('Bộ lọc không hợp lệ cho danh mục này.'), { statusCode: 400 });
  if (id === 'tv-shows') {
    if (type !== 'series' || (option && option !== 'Tất cả' && !Object.hasOwn(showCountries, option))) throw invalid();
    return { profile, id, country: option ? showCountries[option] : undefined };
  }
  if (id === 'animation' && option === 'Tất cả') return { profile, id };
  if (option === undefined) {
    if (id === 'languages' || id === 'origins' || id === 'library') throw invalid();
    return { profile, id };
  }
  const view = catalogViews(profile).find(view => view.id === id && view.type === type);
  if (id === 'trending') {
    const platform = PLATFORMS.find(platform => platform.name === option && feedPreferences(profile).platforms.includes(platform.id));
    if (platform) return { profile: { ...profile, platforms: [platform.id] }, id };
  }
  const selection = viewSelections[id];
  const target = selection && Object.hasOwn(selection, option) ? selection[option] : undefined;
  if (target && view?.options.includes(option)) {
    if (id === 'recent' && (target === 'new30' || target === 'new60' || target === 'new90')) return { profile, id, releaseBand: target };
    return { profile, id: target };
  }
  if (id === 'anime' && Object.hasOwn(animeThemes, option)) return { profile, id, theme: option as keyof typeof animeThemes };
  if (genres.includes(option) && !['library', 'languages', 'origins', 'saved', 'watched'].includes(id)) return { profile, id, genre: option };
  throw invalid();
}
