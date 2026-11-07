import type { MetaPreview } from 'stremio-addon-sdk';
import type { Title } from '../shared/types.js';

export function toMetaPreview(title: Title): MetaPreview {
  return {
    id: title.id, type: title.type, name: title.name,
    poster: title.poster || `https://images.metahub.space/poster/medium/${title.id}/img`,
    posterShape: 'regular',
    description: [title.releaseDate || title.year, title.genres.join(', '), title.providers?.length ? 'Có trên: ' + title.providers.join(', ') + ' (JustWatch / TMDB)' : '', title.overview || ''].filter(Boolean).join(' · '),
  };
}
