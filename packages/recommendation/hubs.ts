import { GENRES } from '../shared/preferences.js';
import type { CatalogId } from './catalogs.js';

/** Optional Stremio genre choices for each broad Home hub. */
export const HUB_CHOICES: Partial<Record<CatalogId, readonly { label: string; catalog: CatalogId }[]>> = {
  'recommended': [
    { label: 'Gu sở thích sâu', catalog: 'micro' },
    { label: 'Phim chất lượng', catalog: 'top' },
    { label: 'Mới phát hành', catalog: 'new30' },
  ],
  'trending': [
    { label: 'Mới · 30 ngày', catalog: 'new30' },
    { label: 'Mới · 31–60 ngày', catalog: 'new60' },
    { label: 'Mới · 61–90 ngày', catalog: 'new90' },
  ],
  'western-hub': [
    { label: 'Hành động & gián điệp', catalog: 'western-action' },
    { label: 'Drama danh tiếng', catalog: 'western-prestige' },
    { label: 'Crime, Noir & Mafia', catalog: 'western-crime' },
    { label: 'Điện ảnh châu Âu', catalog: 'european' },
  ],
  'vibes': [
    { label: 'Hack não & du hành thời gian', catalog: 'vibe-mind' },
    { label: 'Tội phạm đen tối', catalog: 'vibe-crime' },
    { label: 'Cyberpunk & AI', catalog: 'vibe-cyberpunk' },
    { label: 'Sinh tồn & đấu trí', catalog: 'vibe-survival' },
    { label: 'Hài & chữa lành', catalog: 'vibe-feelgood' },
    { label: 'Hidden Gems', catalog: 'gems' },
  ],
  'korean': [
    { label: 'Hình sự & giật gân', catalog: 'k-thriller' },
  ],
  'chinese': [
    { label: 'Cổ trang & kỳ ảo', catalog: 'c-costume' },
    { label: 'Donghua', catalog: 'donghua' },
  ],
  'asian-jp-sea': [
    { label: 'Nhật Bản live-action', catalog: 'japanese' },
    { label: 'Bí ẩn & sinh tồn Nhật', catalog: 'jp-mystery' },
    { label: 'Anime Nhật', catalog: 'anime' },
    { label: 'Anime mới', catalog: 'anime-new' },
    { label: 'Donghua', catalog: 'donghua' },
    { label: 'Đông Nam Á', catalog: 'southeast-asia' },
    { label: 'Việt Nam', catalog: 'vietnam' },
    { label: 'Kinh dị Thái', catalog: 'thai-horror' },
    { label: 'Hành động Indonesia', catalog: 'indonesian-action' },
  ],
};
const subcategoryLabels = new Set(Object.values(HUB_CHOICES).flatMap(options => options?.map(o => o.label) ?? []));
export const isRecognizedGenreOption = (value: string) =>
  (GENRES as readonly string[]).includes(value) || subcategoryLabels.has(value);
export function resolveHubChoice(id: CatalogId, option?: string): CatalogId {
  return HUB_CHOICES[id]?.find(item => item.label === option)?.catalog ?? id;
}
export function hubOptions(id: CatalogId): string[] {
  return [...(HUB_CHOICES[id]?.map(o => o.label) ?? []), ...GENRES];
}
export function isGenreFilter(option?: string): boolean {
  return Boolean(option && (GENRES as readonly string[]).includes(option));
}
