import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { feedPreferences, type FeedPreferences } from '../../../packages/shared/preferences.js';
import type { Profile, MediaType } from '../../../packages/shared/types.js';
import type { LibraryEvent } from '../../../packages/shared/stremio-events.js';
import { TtlCache } from '../../../packages/shared/cache.js';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
export type InteractionKind = 'like' | 'dislike' | 'watched' | 'unwatched' | 'unlike' | 'undislike' | 'clear';

export class ProfileService {
  private readonly cache = new TtlCache<Profile>(120, 5000);
  constructor(private readonly db: PrismaClient) {}

  async create(genres: string[], favorites: string[], feed: FeedPreferences = feedPreferences(), watched: string[] = [], types: Record<string, MediaType> = {}): Promise<{ token: string; profile: Profile }> {
    const token = randomBytes(32).toString('base64url');
    await this.db.user.create({ data: {
      tokenHash: tokenHash(token),
      preferences: { create: { genres: JSON.stringify(genres), feed: JSON.stringify(feed) } },
      favorites: { create: [...new Set(favorites)].map(mediaId => ({ mediaId })) },
      library: { create: [...new Set([...favorites,...watched])].map(mediaId => ({ mediaId, type: types[mediaId] || 'movie', watched: watched.includes(mediaId) })) },
    } });
    return { token, profile: (await this.find(token))! };
  }

  async find(token: string): Promise<Profile | null> {
    if (!validToken(token)) return null;
    const hash = tokenHash(token);
    const head = await this.db.user.findUnique({ where: { tokenHash: hash }, select: { id: true, version: true } });
    if (!head) return null;
    const cached = this.cache.get(hash);
    if (cached?.version === head.version) return cached;
    const [user, videos] = await Promise.all([
      this.db.user.findUnique({ where: { id: head.id }, include: {
        preferences: true, favorites: true,
        interactions: { orderBy: { updatedAt: 'desc' }, take: 500 },
        library: { orderBy: [{ updatedAt: 'desc' }, { mediaId: 'asc' }], take: 2000 },
      } }),
      this.db.watchedVideo.groupBy({ by: ['mediaId'], where: { userId: head.id }, _count: { videoId: true } }),
    ]);
    if (!user) return null;
    const episodeCounts = Object.fromEntries(videos.map(v => [v.mediaId, v._count.videoId]));
    const profile: Profile = {
      id: user.id, version: user.version,
      ...feedPreferences(JSON.parse(user.preferences?.feed ?? '{}')),
      genres: JSON.parse(user.preferences?.genres ?? '[]') as string[],
      favorites: user.favorites.map(f => f.mediaId),
      likes: user.interactions.filter(i => i.kind === 'like').map(i => i.mediaId),
      dislikes: user.interactions.filter(i => i.kind === 'dislike').map(i => i.mediaId),
      watched: user.library.filter(i => i.watched).map(i => i.mediaId),
      saved: user.library.filter(i => i.saved).map(i => i.mediaId),
      started: user.library.filter(i => !i.watched && episodeCounts[i.mediaId]).map(i => i.mediaId),
      episodeCounts,
      itemTypes: Object.fromEntries(user.library.filter(i => ['movie','series'].includes(i.type)).map(i => [i.mediaId, i.type])) as Record<string, MediaType>,
      lastLibraryEventAt: user.lastLibraryEventAt?.toISOString() ?? null,
      lastPlayerEventAt: user.lastPlayerEventAt?.toISOString() ?? null,
    };
    this.cache.set(hash, profile);
    return profile;
  }

  async update(userId: string, genres: string[], favorites: string[], feed: FeedPreferences = feedPreferences(), types: Record<string, MediaType> = {}): Promise<void> {
    await this.db.$transaction([
      this.db.preference.upsert({ where: { userId }, create: { userId, genres: JSON.stringify(genres), feed: JSON.stringify(feed) }, update: { genres: JSON.stringify(genres), feed: JSON.stringify(feed) } }),
      this.db.favorite.deleteMany({ where: { userId } }),
      ...[...new Set(favorites)].map(mediaId => this.db.favorite.create({ data: { userId, mediaId } })),
      ...Object.entries(types).map(([mediaId,type]) => this.db.libraryEntry.upsert({ where: { userId_mediaId: { userId, mediaId } }, create: { userId, mediaId, type }, update: { type } })),
      this.db.user.update({ where: { id: userId }, data: { version: { increment: 1 } } }),
    ]);
  }

  async interact(userId: string, mediaId: string, kind: InteractionKind, type: MediaType = 'movie'): Promise<void> {
    await this.db.$transaction(async tx => {
      if (kind === 'dislike' || kind === 'unlike') await tx.favorite.deleteMany({ where: { userId, mediaId } });
      await tx.libraryEntry.upsert({ where: { userId_mediaId: { userId, mediaId } }, create: { userId, mediaId, type }, update: { type } });
      if (kind === 'clear' || kind === 'unlike' || kind === 'undislike') await tx.interaction.deleteMany({ where: { userId, mediaId, ...(kind === 'unlike' ? { kind: 'like' } : kind === 'undislike' ? { kind: 'dislike' } : {}) } });
      else if (kind === 'like' || kind === 'dislike') await tx.interaction.upsert({
        where: { userId_mediaId: { userId, mediaId } }, create: { userId, mediaId, kind }, update: { kind },
      });
      if (['watched','unwatched','clear'].includes(kind)) {
        await tx.libraryEntry.update({ where: { userId_mediaId: { userId, mediaId } }, data: { watched: kind === 'watched' } });
        if (kind !== 'watched') await tx.watchedVideo.deleteMany({ where: { userId, mediaId } });
      }
      await this.prune(tx,userId);
      await tx.user.update({ where: { id: userId }, data: { version: { increment: 1 } } });
    });
  }

  async libraryEvent(userId: string, type: MediaType, mediaId: string, event: LibraryEvent, source: 'library' | 'player' | 'manual' = 'library'): Promise<void> {
    await this.db.$transaction(async tx => {
      const existing = await tx.libraryEntry.findUnique({ where: { userId_mediaId: { userId, mediaId } } });
      let saved = existing?.saved ?? false, watched = existing?.watched ?? false, changed = false;
      if (event.action === 'libraryAdd' || event.action === 'libraryRemove') {
        const next = event.action === 'libraryAdd'; changed = saved !== next; saved = next;
      } else if (type === 'series' && event.videoIds.length) {
        if (event.action === 'watched') {
          const present = await tx.watchedVideo.findMany({ where: { userId, videoId: { in: event.videoIds } }, select: { videoId: true } });
          const seen = new Set(present.map(v => v.videoId));
          const missing = event.videoIds.filter(videoId => !seen.has(videoId));
          if (missing.length) { await tx.watchedVideo.createMany({ data: missing.map(videoId => ({ userId, mediaId, videoId })) }); changed = true; }
        } else {
          const removed = await tx.watchedVideo.deleteMany({ where: { userId, mediaId, videoId: { in: event.videoIds } } });
          changed = removed.count > 0 || watched; watched = false;
        }
      } else {
        const next = event.action === 'watched'; changed = watched !== next; watched = next;
        if (!next) { const removed = await tx.watchedVideo.deleteMany({ where: { userId, mediaId } }); changed ||= removed.count > 0; }
      }
      if (!existing || changed || existing.type !== type) await tx.libraryEntry.upsert({
        where: { userId_mediaId: { userId, mediaId } }, create: { userId, mediaId, type, saved, watched }, update: { type, saved, watched },
      });
      if (changed || !existing) await this.prune(tx,userId);
      await tx.user.update({ where: { id: userId }, data: {
        ...(source === 'library' ? { lastLibraryEventAt: new Date() } : source === 'player' ? { lastPlayerEventAt: new Date() } : {}),
        ...(changed ? { version: { increment: 1 } } : {}),
      } });
    });
  }

  private async prune(tx: Prisma.TransactionClient, userId: string) {
    const old = await tx.interaction.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, skip: 500, select: { mediaId: true } });
    if (old.length) await tx.interaction.deleteMany({ where: { userId, mediaId: { in: old.map(i => i.mediaId) } } });
    const entries = await tx.libraryEntry.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, skip: 2000, select: { mediaId: true } });
    for (let i=0;i<entries.length;i+=200) {
      const mediaId = { in: entries.slice(i,i+200).map(e=>e.mediaId) };
      await tx.watchedVideo.deleteMany({ where: { userId, mediaId } });
      await tx.libraryEntry.deleteMany({ where: { userId, mediaId } });
    }
    const videos = await tx.watchedVideo.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, skip: 10_000, select: { videoId: true } });
    for (let i=0;i<videos.length;i+=200) await tx.watchedVideo.deleteMany({ where: { userId, videoId: { in: videos.slice(i,i+200).map(v=>v.videoId) } } });
  }
}
