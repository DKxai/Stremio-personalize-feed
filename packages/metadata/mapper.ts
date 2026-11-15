import type { MetaPreview } from 'stremio-addon-sdk';
import type { Title } from '../shared/types.js';

const countryNames = new Intl.DisplayNames(['vi'], { type: 'region', fallback: 'none' });

export function toMetaPreview(title: Title): MetaPreview & { genres: string[] } {
  const origins = title.originCountries?.filter(code => /^[A-Z]{2}$/.test(code))
    .map(code => countryNames.of(code)).filter(Boolean).join(', ');
  return {
    id: title.id, type: title.type, genres: title.genres, name: title.name,
    poster: title.poster || `https://images.metahub.space/poster/medium/${title.id}/img`,
    posterShape: 'regular',
    description: [title.releaseDate || title.year, title.genres.join(', '), origins, title.providers?.length ? 'Có trên: ' + title.providers.join(', ') + ' (JustWatch / TMDB)' : '', title.activityNote || '', title.overview || ''].filter(Boolean).join(' · '),
  };
}
