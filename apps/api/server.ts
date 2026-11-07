import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { ProfileService } from './services/profiles.js';
import { TITLES, GENRES } from '../../packages/metadata/fixtures.js';
import { RecommendationEngine } from '../../packages/recommendation/engine.js';
import { createCinemetaProvider, type MetadataProvider } from '../../packages/metadata/cinemeta.js';
import { createManifest } from '../addon/manifest.js';
import { createAddon } from '../addon/addon.js';
import { isCatalogId } from '../../packages/recommendation/catalogs.js';
import type { Profile } from '../../packages/shared/types.js';
import { configureHtml } from './ui/configure.js';

const preferencesSchema = {
  type: 'object', additionalProperties: false, required: ['genres', 'favorites'],
  properties: {
    genres: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string', enum: GENRES } },
    favorites: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', enum: TITLES.map(t => t.id) } },
  },
} as const;

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildServer(db: PrismaClient, config: Config, metadata: MetadataProvider = createCinemetaProvider()) {
  // URL paths contain Stremio capability tokens. Do not log requests, URLs, or bodies.
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16_384,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const profiles = new ProfileService(db);
  const engine = new RecommendationEngine(TITLES);
  await app.register(cors, { origin: '*', methods: ['GET', 'POST', 'PUT', 'OPTIONS'] });
  await app.register(rateLimit, { max: 150, timeWindow: '1 minute' });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://images.metahub.space; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  });
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;
    // Log stable classifications only, not errors that may embed a token or database URL.
    if (status >= 500) app.log.error({ route: request.routeOptions.url, status }, 'Request failed');
    reply.code(status).send({ error: status >= 500 ? 'Service temporarily unavailable' : error.message });
  });

  const authenticate = async (authorization?: string): Promise<Profile> => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const profile = await profiles.find(token);
    if (!profile) throw httpError(401, 'Invalid profile token');
    return profile;
  };
  const fromPath = async (token: string) => {
    const profile = await profiles.find(token);
    if (!profile) throw httpError(401, 'Invalid profile token');
    return profile;
  };
  const links = (token: string) => ({
    manifestUrl: `${config.publicBaseUrl}/${token}/manifest.json`,
    installUrl: `${config.publicBaseUrl.replace(/^https?:/, 'stremio:')}/${token}/manifest.json`,
  });

  app.get('/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok', version: '0.1.0', metadata: 'fixtures', storage: config.storageMode };
  });
  app.get('/', async (_request, reply) => reply.redirect('/configure'));
  app.get('/configure', async (_request, reply) => reply.type('text/html').send(configureHtml));
  app.get('/:token/configure', async (_request, reply) => reply.type('text/html').send(configureHtml));
  app.get('/assets/configure.js', async (_request, reply) => reply.type('application/javascript').send(configureScript));
  app.get('/assets/style.css', async (_request, reply) => reply.type('text/css').send(configureStyle));
  app.get('/api/library', async () => ({
    genres: GENRES,
    titles: TITLES.map(({ id, type, name, year, genres }) => ({ id, type, name, year, genres })),
    demo: true, storage: config.storageMode, invitationRequired: Boolean(config.registrationKey),
  }));
  app.post<{ Body: { genres: string[]; favorites: string[]; registrationKey?: string } }>('/api/profiles', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { ...preferencesSchema, properties: { ...preferencesSchema.properties, registrationKey: { type: 'string', maxLength: 256 } } } },
  }, async (request, reply) => {
    if (config.registrationKey && !sameSecret(request.body.registrationKey ?? '', config.registrationKey)) throw httpError(403, 'Invalid invitation code');
    const { genres, favorites } = request.body;
    if (!genres.length && !favorites.length) throw httpError(400, 'Choose at least one genre or favorite');
    const { token, profile } = await profiles.create(genres, favorites);
    return reply.code(201).send({ token, profile, ...links(token) });
  });
  app.get('/api/profile', async request => ({ profile: await authenticate(request.headers.authorization) }));
  app.put<{ Body: { genres: string[]; favorites: string[] } }>('/api/profile', {
    schema: { body: preferencesSchema },
  }, async request => {
    const profile = await authenticate(request.headers.authorization);
    const { genres, favorites } = request.body;
    if (!genres.length && !favorites.length) throw httpError(400, 'Choose at least one genre or favorite');
    await profiles.update(profile.id, genres, favorites);
    return { profile: await authenticate(request.headers.authorization) };
  });
  app.post<{ Body: { mediaId: string; kind: 'like' | 'dislike' | 'watched' | 'clear' } }>('/api/interactions', {
    schema: { body: {
      type: 'object', required: ['mediaId', 'kind'], additionalProperties: false,
      properties: {
        mediaId: { type: 'string', enum: TITLES.map(t => t.id) },
        kind: { type: 'string', enum: ['like', 'dislike', 'watched', 'clear'] },
      },
    } },
  }, async request => {
    const profile = await authenticate(request.headers.authorization);
    await profiles.interact(profile.id, request.body.mediaId, request.body.kind);
    return { profile: await authenticate(request.headers.authorization) };
  });

  app.get('/manifest.json', async () => createManifest(false));
  app.get<{ Params: { token: string } }>('/:token/manifest.json', async request => {
    await fromPath(request.params.token);
    return createManifest(true);
  });
  type CatalogParams = { token: string; type: string; id: string; extra?: string };
  const catalogHandler = async (params: CatalogParams) => {
    const profile = await fromPath(params.token);
    if ((params.type !== 'movie' && params.type !== 'series') || !params.id.startsWith('pf-') || !isCatalogId(params.id.slice(3))) throw httpError(404, 'Catalog not found');
    let skip = 0;
    if (params.extra) {
      const extra = new URLSearchParams(params.extra);
      if ([...extra.keys()].some(k => k !== 'skip') || extra.getAll('skip').length !== 1 || !/^\d{1,8}$/.test(extra.get('skip') ?? '')) throw httpError(400, 'Invalid catalog pagination');
      skip = Number(extra.get('skip'));
    }
    const addon = createAddon(profile, engine, TITLES, metadata);
    const result = await addon.get('catalog', params.type, params.id, { skip });
    return result;
  };
  app.get<{ Params: CatalogParams }>('/:token/catalog/:type/:id.json', async r => catalogHandler(r.params));
  app.get<{ Params: CatalogParams }>('/:token/catalog/:type/:id/:extra.json', async r => catalogHandler(r.params));
  app.get<{ Params: { token: string; type: string; id: string } }>('/:token/meta/:type/:id.json', async request => {
    const profile = await fromPath(request.params.token);
    const { type, id } = request.params;
    if ((type !== 'movie' && type !== 'series') || !TITLES.some(t => t.id === id && t.type === type)) throw httpError(404, 'Title not found');
    try {
      return await createAddon(profile, engine, TITLES, metadata).get('meta', type, id);
    } catch { return { meta: null }; }
  });
  return app;
}

import { configureScript, configureStyle } from './ui/assets.js';
