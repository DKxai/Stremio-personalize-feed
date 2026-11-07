ALTER TABLE "Preference" ADD COLUMN "feed" TEXT NOT NULL DEFAULT '{}';
CREATE TABLE "ExternalCache" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "payload" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "ExternalCache_expiresAt_idx" ON "ExternalCache"("expiresAt");
CREATE TABLE "MovieMetadata" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "imdbId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "MovieMetadata_imdbId_type_idx" ON "MovieMetadata"("imdbId", "type");
