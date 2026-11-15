/** Catalog IDs are stable API routes. Only nine curated hubs are on Home. */
export const CATALOGS = [
  { id: 'recommended', name: '🎯 Top Picks · Dành cho bạn' },
  { id: 'because-west', name: 'Vì bạn đã xem · Âu-Mỹ' },
  { id: 'because-asian', name: 'Vì bạn đã xem · Châu Á' },
  { id: 'trending', name: '🔥 Bom tấn & Xu hướng toàn cầu' },
  { id: 'western-hub', name: '🎬 Hollywood & Điện ảnh Âu-Mỹ' },
  { id: 'vibes', name: '✨ Khám phá theo tâm trạng' },
  { id: 'korean', name: '🇰🇷 K-Wave · Hàn Quốc' },
  { id: 'chinese', name: '🇨🇳 Hoa ngữ · Trung / Đài / Hồng Kông' },
  { id: 'asian-jp-sea', name: '🌏 Nhật Bản · Anime · Đông Nam Á' },
  // Specialist catalogs remain usable via Discover filters / existing direct URLs.
  { id: 'because', name: 'Vì bạn đã xem' },
  { id: 'because-2', name: 'Vì bạn đã xem · Gu 2' },
  { id: 'micro', name: 'Khám phá đúng gu của bạn' },
  { id: 'western-action', name: 'Hành động & Gián điệp Âu-Mỹ' },
  { id: 'western-prestige', name: 'Điện ảnh chất lượng Âu-Mỹ' },
  { id: 'western-crime', name: 'Hình sự & Mafia Âu-Mỹ' },
  { id: 'european', name: 'Điện ảnh Châu Âu' },
  { id: 'vibe-mind', name: 'Hack não & du hành thời gian' },
  { id: 'vibe-crime', name: 'Tội phạm đen tối' },
  { id: 'vibe-cyberpunk', name: 'Cyberpunk & phản địa đàng' },
  { id: 'vibe-survival', name: 'Sinh tồn & đấu trí' },
  { id: 'vibe-feelgood', name: 'Hài, thư giãn & chữa lành' },
  { id: 'japanese', name: 'Nhật Bản · Live-action' },
  { id: 'jp-mystery', name: 'Bí ẩn & sinh tồn Nhật' },
  { id: 'anime', name: 'Anime Nhật Bản' },
  { id: 'donghua', name: 'Donghua · Hoạt hình Hoa ngữ' },
  { id: 'southeast-asia', name: 'Điện ảnh Đông Nam Á' },
  { id: 'vietnam', name: 'Phim Việt Nam' },
  { id: 'thai-horror', name: 'Kinh dị & giật gân Thái' },
  { id: 'indonesian-action', name: 'Hành động Indonesia' },
  { id: 'k-thriller', name: 'Hình sự & giật gân Hàn' },
  { id: 'c-costume', name: 'Cổ trang & kỳ ảo Hoa ngữ' },
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
export const HOME_CATALOG_IDS: readonly CatalogId[] = [
  'recommended','because-west','because-asian','trending','western-hub',
  'vibes','korean','chinese','asian-jp-sea',
];
export const HOME_CATALOGS = HOME_CATALOG_IDS.map(id => CATALOGS.find(c => c.id === id)!);
export const PAGE_SIZE = 100;
export const isFreshCatalog = (id: CatalogId) => id.startsWith('new') || id === 'anime-new';
