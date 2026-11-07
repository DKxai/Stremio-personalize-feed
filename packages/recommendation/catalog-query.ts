import { GENRES } from '../shared/preferences.js';
export interface CatalogQuery { skip: number; genre?: string; search?: string }
export function parseCatalogQuery(encoded?: string): CatalogQuery {
  if (!encoded) return { skip: 0 };
  const fail = (): never => { throw Object.assign(new Error('Invalid catalog filters'), { statusCode: 400 }); };
  if (encoded.length > 1200) return fail();
  const params = new URLSearchParams(encoded);
  if ([...params.keys()].some(k => !['skip','search','genre'].includes(k))) return fail();
  for (const key of ['skip','search','genre']) if (params.getAll(key).length > 1) return fail();
  const rawSkip = params.get('skip');
  if (rawSkip !== null && !/^\d{1,5}$/.test(rawSkip)) return fail();
  const skip = Number(rawSkip ?? 0);
  if (skip > 10_000) return fail();
  const rawSearch = params.get('search');
  const search = rawSearch?.normalize('NFC').trim().replace(/\s+/g,' ');
  if (search !== undefined && (!search.length || search.length > 80 || /[\u0000-\u001f\u007f]/.test(search))) return fail();
  const genre = params.get('genre') ?? undefined;
  if (genre !== undefined && !(GENRES as readonly string[]).includes(genre)) return fail();
  return { skip, ...(search !== undefined ? { search } : {}), ...(genre ? { genre } : {}) };
}
