ALTER TABLE "User" ADD COLUMN "lastLibraryEventAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastPlayerEventAt" DATETIME;
CREATE TABLE "LibraryEntry" (
 "userId" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "type" TEXT NOT NULL,
 "saved" BOOLEAN NOT NULL DEFAULT false, "watched" BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("userId", "mediaId"),
 CONSTRAINT "LibraryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LibraryEntry_userId_updatedAt_idx" ON "LibraryEntry"("userId", "updatedAt");
CREATE TABLE "WatchedVideo" (
 "userId" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "videoId" TEXT NOT NULL,
 "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("userId", "videoId"),
 CONSTRAINT "WatchedVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WatchedVideo_userId_mediaId_idx" ON "WatchedVideo"("userId", "mediaId");
-- Preserve previously recorded favorites/feedback. Watched is now independent of like/dislike.
INSERT INTO "LibraryEntry" ("userId", "mediaId", "type", "watched")
SELECT signals."userId", signals."mediaId", COALESCE((SELECT "type" FROM "MovieMetadata" WHERE "imdbId"=signals."mediaId" LIMIT 1), ''), MAX(signals."watched")
FROM (
 SELECT "userId", "mediaId", CASE WHEN "kind"='watched' THEN 1 ELSE 0 END AS "watched" FROM "Interaction"
 UNION ALL SELECT "userId", "mediaId", 0 FROM "Favorite"
) signals GROUP BY signals."userId", signals."mediaId";
DELETE FROM "Interaction" WHERE "kind"='watched';
UPDATE "LibraryEntry" SET "type"=CASE "mediaId" WHEN 'tt0816692' THEN 'movie' WHEN 'tt2543164' THEN 'movie' WHEN 'tt1856101' THEN 'movie' WHEN 'tt0470752' THEN 'movie' WHEN 'tt1375666' THEN 'movie' WHEN 'tt0482571' THEN 'movie' WHEN 'tt0111161' THEN 'movie' WHEN 'tt0110912' THEN 'movie' WHEN 'tt0468569' THEN 'movie' WHEN 'tt0133093' THEN 'movie' WHEN 'tt0088763' THEN 'movie' WHEN 'tt0109830' THEN 'movie' WHEN 'tt0266543' THEN 'movie' WHEN 'tt0910970' THEN 'movie' WHEN 'tt2096673' THEN 'movie' WHEN 'tt0107048' THEN 'movie' WHEN 'tt2278388' THEN 'movie' WHEN 'tt0317248' THEN 'movie' WHEN 'tt1187043' THEN 'movie' WHEN 'tt2582802' THEN 'movie' WHEN 'tt1637688' THEN 'movie' WHEN 'tt0390384' THEN 'movie' WHEN 'tt1182345' THEN 'movie' WHEN 'tt1568921' THEN 'movie' WHEN 'tt0944947' THEN 'series' WHEN 'tt0903747' THEN 'series' WHEN 'tt3032476' THEN 'series' WHEN 'tt4574334' THEN 'series' WHEN 'tt1475582' THEN 'series' WHEN 'tt7366338' THEN 'series' WHEN 'tt0137523' THEN 'movie' WHEN 'tt0386676' THEN 'series' WHEN 'tt0108778' THEN 'series' WHEN 'tt2467372' THEN 'series' WHEN 'tt1442437' THEN 'series' WHEN 'tt0898266' THEN 'series' WHEN 'tt2861424' THEN 'series' WHEN 'tt0096697' THEN 'series' WHEN 'tt0121955' THEN 'series' WHEN 'tt2085059' THEN 'series' WHEN 'tt5753856' THEN 'series' WHEN 'tt0475784' THEN 'series' WHEN 'tt3230854' THEN 'series' WHEN 'tt11280740' THEN 'series' WHEN 'tt4093826' THEN 'series' WHEN 'tt4299972' THEN 'series' WHEN 'tt4635276' THEN 'series' WHEN 'tt1548850' THEN 'series' WHEN 'tt5290382' THEN 'series' ELSE "type" END WHERE "type"='';
