import type { PrismaClient } from '@prisma/client';
import type { Profile } from '../shared/types.js';
import { TtlCache } from '../shared/cache.js';

/** Positive co-occurrences only; requires support from three distinct other profiles. */
export function communityScores(profile: Profile, signals: { userId: string; mediaId: string }[]): Map<string, number> {
  const mine = new Set([...profile.favorites, ...profile.likes]);
  const byUser = new Map<string, Set<string>>();
  for (const signal of signals) {
    if (signal.userId === profile.id) continue;
    const titles = byUser.get(signal.userId) || new Set<string>();
    titles.add(signal.mediaId); byUser.set(signal.userId, titles);
  }
  const support = new Map<string, number>();
  for (const titles of byUser.values()) {
    if (![...titles].some(id => mine.has(id))) continue;
    for (const id of titles) if (!mine.has(id)) support.set(id, (support.get(id) ?? 0) + 1);
  }
  return new Map([...support].filter(([, count]) => count >= 3).map(([id, count]) => [id, Math.min(1, count / 10)]));
}
export class CommunitySignals {
  private readonly cache = new TtlCache<{ userId: string; mediaId: string }[]>(1, 300_000);
  constructor(private readonly db: PrismaClient) {}
  async scores(profile: Profile) {
    let signals = this.cache.get('all');
    if (!signals) {
      const [favorites, likes] = await Promise.all([
        this.db.favorite.findMany({ select: { userId: true, mediaId: true }, take: 1000, orderBy: [{ userId: 'desc' }, { mediaId: 'asc' }] }),
        this.db.interaction.findMany({ where: { kind: 'like' }, select: { userId: true, mediaId: true }, orderBy: { updatedAt: 'desc' }, take: 1000 }),
      ]);
      signals = [...favorites, ...likes]; this.cache.set('all', signals);
    }
    return communityScores(profile, signals);
  }
}
