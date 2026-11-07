import type { Manifest } from 'stremio-addon-sdk';
import { CATALOGS } from '../../packages/recommendation/catalogs.js';

export function createManifest(configured = false): Manifest {
  return {
    id: 'community.dkxai.personalizedfeed',
    version: '0.3.0',
    name: 'Personalized Feed',
    description: 'Feed Movie + Series cá nhân hóa: xu hướng tuần, phim phát hành trong 90 ngày, phim Hàn, Trung, Nhật và Anime. Xu hướng: TMDB; nền tảng theo khu vực: JustWatch qua TMDB.',
    types: ['movie', 'series'],
    resources: ['catalog', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    catalogs: (['movie', 'series'] as const).flatMap(type => CATALOGS.map(c => ({
      type, id: `pf-${c.id}`, name: c.name,
      extra: [{ name: 'skip', isRequired: false }],
    }))),
    behaviorHints: { configurable: true, configurationRequired: !configured },
  };
}
