import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { feedPreferences, type FeedPreferences } from '../../../packages/shared/preferences.js';
import type { Profile } from '../../../packages/shared/types.js';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export class ProfileService {
  constructor(private readonly db: PrismaClient) {}

  async create(genres: string[], favorites: string[], feed: FeedPreferences = feedPreferences()): Promise<{ token: string; profile: Profile }> {
    const token = randomBytes(32).toString('base64url');
    const user = await this.db.user.create({ data: {
      tokenHash: tokenHash(token),
      preferences: { create: { genres: JSON.stringify(genres), feed: JSON.stringify(feed) } },
      favorites: { create: [...new Set(favorites)].map(mediaId => ({ mediaId })) },
    } });
    return { token, profile: { id: user.id, version: user.version, genres, favorites, ...feed, likes: [], dislikes: [], watched: [] } };
  }

  async find(token: string): Promise<Profile | null> {
    if (!validToken(token)) return null;
    const user = await this.db.user.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { preferences: true, favorites: true, interactions: { orderBy: { updatedAt: 'desc' }, take: 500 } },
    });
    if (!user) return null;
    return {
      id: user.id, version: user.version,
      ...feedPreferences(JSON.parse(user.preferences?.feed ?? '{}')),
      genres: JSON.parse(user.preferences?.genres ?? '[]') as string[],
      favorites: user.favorites.map(f => f.mediaId),
      likes: user.interactions.filter(i => i.kind === 'like').map(i => i.mediaId),
      dislikes: user.interactions.filter(i => i.kind === 'dislike').map(i => i.mediaId),
      watched: user.interactions.filter(i => i.kind === 'watched').map(i => i.mediaId),
    };
  }

  async update(userId: string, genres: string[], favorites: string[], feed: FeedPreferences = feedPreferences()): Promise<void> {
    await this.db.$transaction([
      this.db.preference.upsert({ where: { userId }, create: { userId, genres: JSON.stringify(genres), feed: JSON.stringify(feed) }, update: { genres: JSON.stringify(genres), feed: JSON.stringify(feed) } }),
      this.db.favorite.deleteMany({ where: { userId } }),
      ...[...new Set(favorites)].map(mediaId => this.db.favorite.create({ data: { userId, mediaId } })),
      this.db.user.update({ where: { id: userId }, data: { version: { increment: 1 } } }),
    ]);
  }

  async interact(userId: string, mediaId: string, kind: 'like' | 'dislike' | 'watched' | 'clear'): Promise<void> {
    await this.db.$transaction(async tx => {
      // A dislike must override a previous favorite, including in Because You Watched.
      if (kind === 'dislike') await tx.favorite.deleteMany({ where: { userId, mediaId } });
      if (kind === 'clear') await tx.interaction.deleteMany({ where: { userId, mediaId } });
      else await tx.interaction.upsert({
        where: { userId_mediaId: { userId, mediaId } },
        create: { userId, mediaId, kind }, update: { kind },
      });
      const old = await tx.interaction.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, skip: 500, select: { mediaId: true } });
      if (old.length) await tx.interaction.deleteMany({ where: { userId, mediaId: { in: old.map(i => i.mediaId) } } });
      await tx.user.update({ where: { id: userId }, data: { version: { increment: 1 } } });
    });
  }
}
