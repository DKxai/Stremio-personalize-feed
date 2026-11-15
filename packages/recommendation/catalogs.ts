/** Stable IDs keep existing installed Stremio catalog URLs working. */
export const CATALOGS = [
  { id: 'recommended', name: '🎯 Dành cho bạn · Top Picks' },
  { id: 'because', name: 'Vì bạn đã xem · Gu 1' },
  { id: 'because-2', name: 'Vì bạn đã xem · Gu 2' },
  { id: 'micro', name: 'Khám phá đúng gu của bạn' },
  { id: 'trending', name: '🔥 Được quan tâm tuần này' },
  { id: 'korean', name: '🇰🇷 K-Wave · Hàn Quốc' },
  { id: 'k-thriller', name: '🇰🇷 Hình sự & giật gân Hàn' },
  { id: 'chinese', name: '🇨🇳 Hoa ngữ · Trung / Đài / Hồng Kông' },
  { id: 'c-costume', name: '🇨🇳 Cổ trang & kỳ ảo Hoa ngữ' },
  { id: 'japanese', name: '🇯🇵 Nhật Bản · Live-action' },
  { id: 'jp-mystery', name: '🇯🇵 Bí ẩn & sinh tồn Nhật Bản' },
  { id: 'anime', name: '🇯🇵 Anime Nhật Bản' },
  { id: 'donghua', name: '🇨🇳 Donghua · Hoạt hình Hoa ngữ' },
  { id: 'southeast-asia', name: '🌏 Đông Nam Á · Tuyển chọn' },
  { id: 'vietnam', name: '🇻🇳 Phim Việt Nam' },
  { id: 'thai-horror', name: '🇹🇭 Kinh dị & giật gân Thái' },
  { id: 'indonesian-action', name: '🇮🇩 Hành động Indonesia' },
  { id: 'anime-new', name: 'Anime mới · 90 ngày qua' },
  { id: 'new30', name: 'Mới phát hành · 30 ngày qua' },
  { id: 'new60', name: 'Mới phát hành · 31–60 ngày' },
  { id: 'new90', name: 'Mới phát hành · 61–90 ngày' },
  { id: 'gems', name: 'Viên ngọc ẩn · Ít người biết' },
  { id: 'top', name: 'Lựa chọn chất lượng' },
  { id: 'genres', name: 'Thể loại yêu thích' },
  { id: 'saved', name: 'Thư viện & Yêu thích của bạn' },
  { id: 'watched', name: 'Danh sách Đã xem' },
] as const;

export type CatalogId = (typeof CATALOGS)[number]['id'];
export const isCatalogId = (id: string): id is CatalogId => CATALOGS.some(c => c.id === id);
/** Intentionally keep Home compact; legacy and specialist IDs remain routable. */
export const HOME_CATALOG_IDS: readonly CatalogId[] = [
  'recommended', 'because', 'because-2', 'micro', 'trending',
  'korean', 'chinese', 'japanese', 'anime', 'donghua', 'southeast-asia',
  'k-thriller', 'c-costume', 'thai-horror', 'new30', 'anime-new',
  'gems', 'saved', 'watched',
];
export const HOME_CATALOGS = HOME_CATALOG_IDS.map(id => CATALOGS.find(c => c.id === id)!);
export const PAGE_SIZE = 100;
export const isFreshCatalog = (id: CatalogId) => id.startsWith('new') || id === 'anime-new';
