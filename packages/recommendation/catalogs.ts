export const CATALOGS = [
  { id: 'recommended', name: 'Dành cho bạn' },
  { id: 'trending', name: 'Xu hướng tuần này · Các nền tảng' },
  { id: 'new30', name: 'Mới phát hành · 30 ngày qua' },
  { id: 'new60', name: 'Mới phát hành · 31–60 ngày' },
  { id: 'new90', name: 'Mới phát hành · 61–90 ngày' },
  { id: 'korean', name: 'Phim Hàn dành cho bạn' },
  { id: 'chinese', name: 'Phim Trung dành cho bạn' },
  { id: 'japanese', name: 'Phim Nhật dành cho bạn' },
  { id: 'anime', name: 'Thế giới Anime' },
  { id: 'anime-new', name: 'Anime mới · 90 ngày qua' },
  { id: 'because', name: 'Vì bạn đã xem' },
  { id: 'genres', name: 'Thể loại yêu thích' },
  { id: 'gems', name: 'Đáng xem, ít người biết' },
  { id: 'top', name: 'Lựa chọn hàng đầu' },
] as const;
export type CatalogId = (typeof CATALOGS)[number]['id'];
export const isCatalogId = (id: string): id is CatalogId => CATALOGS.some(c => c.id === id);
export const PAGE_SIZE = 20;
export const isFreshCatalog = (id: CatalogId) => id.startsWith('new') || id === 'anime-new';
