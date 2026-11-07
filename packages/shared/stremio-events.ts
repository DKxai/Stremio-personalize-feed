import type { MediaType } from './types.js';
export type LibraryAction = 'libraryAdd' | 'libraryRemove' | 'watched' | 'unwatched';
export interface LibraryEvent { action: LibraryAction; videoIds: string[] }
const fail = (): never => { throw Object.assign(new Error('Invalid Stremio event'), { statusCode: 400 }); };
export const validMediaId = (id: string) => /^tt\d{7,10}$/.test(id);
export function parseLibraryEvent(type: MediaType, id: string, encoded: string): LibraryEvent {
  if (!['movie','series'].includes(type) || !validMediaId(id) || encoded.length > 8000) return fail();
  const params = new URLSearchParams(encoded);
  if ([...params.keys()].some(k => !['action', 'videoId'].includes(k)) || params.getAll('action').length !== 1 || params.getAll('videoId').length > 1) return fail();
  const action = params.get('action');
  if (!['libraryAdd','libraryRemove','watched','unwatched'].includes(action ?? '')) return fail();
  const raw = params.get('videoId');
  if (raw !== null && (action === 'libraryAdd' || action === 'libraryRemove' || !raw)) return fail();
  const videoIds = raw ? raw.split(',') : [];
  if (videoIds.length > 100 || new Set(videoIds).size !== videoIds.length) return fail();
  for (const video of videoIds) {
    if (type === 'movie' ? video !== id : !new RegExp('^'+id+':[0-9]{1,4}:[0-9]{1,5}$').test(video)) return fail();
  }
  return { action: action as LibraryAction, videoIds };
}
export function parsePlayerEvent(type: MediaType, videoId: string, encoded: string): { id: string; completed: boolean } {
  const parts = videoId.split(':'); const id = parts[0] ?? '';
  if (!['movie','series'].includes(type) || !validMediaId(id) || (type === 'movie' ? parts.length !== 1 : !new RegExp('^'+id+':[0-9]{1,4}:[0-9]{1,5}$').test(videoId))) return fail();
  const params = new URLSearchParams(encoded);
  if (encoded.length > 250 || [...params.keys()].some(k => !['action','currentTime','duration'].includes(k))) return fail();
  for (const key of ['action','currentTime','duration']) if (params.getAll(key).length !== 1) return fail();
  const action = params.get('action');
  if (!['start','pause','stop'].includes(action ?? '')) return fail();
  for (const key of ['currentTime','duration']) if (!/^\d{1,12}$/.test(params.get(key) ?? '')) return fail();
  const duration = Number(params.get('duration')), time = Number(params.get('currentTime'));
  if (duration > 604_800_000 || time > duration + 60_000) return fail();
  return { id, completed: action === 'stop' && duration >= 300_000 && time / duration >= 0.85 };
}
