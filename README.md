# Stremio Personalized Feed

Movie + Series + Anime, chạy bằng **Node.js 22, TypeScript, Fastify, Stremio Add-on SDK và Prisma / SQLite**. Không host phim, không cung cấp stream. Các Add-on phát nội dung hiện có vẫn dùng IMDb ID và episode ID từ Cinemeta.

Bản **0.4** bổ sung Đã xem / Thư viện riêng, callback Stremio library/player, tìm kiếm Movie/Series và lọc Genre trong Discover. Bản 0.3 bổ sung catalog phim Nhật / J-Drama và ưu tiên Nhật trong profile mới. Bản 0.2 đã thay thư viện mẫu làm nguồn recommendation bằng **TMDB trực tiếp**, thêm xu hướng tuần, tác phẩm mới trong 90 ngày, phim Hàn, Trung và anime. Cần TMDB API Read Access Token của chủ server. **Thiếu token sẽ hiện trạng thái chưa cấu hình và trả 503 cho feed trực tiếp; không âm thầm dùng phim cũ làm dữ liệu mới.** `DEMO_MODE=true` chỉ dành cho demo offline, với các mục xu hướng/mới để trống.

## Bật dữ liệu thật

1. Lấy **API Read Access Token** tại [TMDB API settings](https://www.themoviedb.org/settings/api). Đây là token API của ứng dụng, không phải mật khẩu tài khoản TMDB hay Stremio.
2. Đặt `TMDB_READ_ACCESS_TOKEN` trong Environment của hosting. Có thể dùng `TMDB_API_KEY` thay thế. Không commit hoặc gửi token trong issue, log, manifest hay URL.
3. Giữ `DEMO_MODE=false`, build và restart.
4. Mở `/health`: `metadata` phải là `tmdb`, `feedReady` phải là `true`. Đây là trạng thái cấu hình; gọi catalog để xác nhận token thực sự được upstream chấp nhận.
5. Mở `/configure`, chọn khu vực, nền tảng, sở thích và favorites. Cài lại Add-on từ manifest của profile để Stremio nhận các catalog mới. Profile và token cũ vẫn được giữ qua migration.

Mặc định dùng **US** để gộp thư viện các dịch vụ quốc tế, đồng thời ưu tiên Hàn, Trung, Nhật và anime. Có thể chọn VN, KR, JP, TW, HK, SG, GB, AU, CA. Danh sách nền tảng theo khu vực có thể khác nhau. Không thay dữ liệu US vào kết quả VN nếu nền tảng không có dữ liệu tại VN.

## Catalog

16 nhóm × hai loại `movie` / `series` = **32 hàng Home/Discover**, cộng 2 catalog chỉ dành cho tìm kiếm = **34 khai báo trong manifest**. Stremio yêu cầu mỗi catalog có một loại, nên Movie và Series có các hàng riêng.

| ID | Nội dung | Quy tắc |
| --- | --- | --- |
| `pf-recommended` | Dành cho bạn | Sở thích, favorites/likes, độ mới, quốc gia, anime và tín hiệu cộng tác khi đủ dữ liệu |
| `pf-trending` | Xu hướng tuần này · Các nền tảng | TMDB weekly trending, giao với nền tảng đăng ký đang có phim tại khu vực đã chọn |
| `pf-new30` | Mới phát hành · 30 ngày qua | Tuổi tác phẩm 0–29 ngày, có trên nền tảng đã chọn |
| `pf-new60` | Mới phát hành · 31–60 ngày | Tuổi tác phẩm 30–59 ngày, có trên nền tảng đã chọn |
| `pf-new90` | Mới phát hành · 61–90 ngày | Tuổi tác phẩm 60–89 ngày, có trên nền tảng đã chọn |
| `pf-korean` | Phim Hàn dành cho bạn | Quốc gia nguồn KR |
| `pf-chinese` | Phim Trung dành cho bạn | Quốc gia nguồn CN, TW hoặc HK |
| `pf-japanese` | Phim Nhật dành cho bạn | Điện ảnh và J-Drama từ JP; anime có hàng riêng |
| `pf-anime` | Thế giới Anime | Animation từ Nhật Bản |
| `pf-anime-new` | Anime mới · 90 ngày qua | Anime có tuổi tác phẩm 0–89 ngày |
| `pf-saved` | Thư viện & Yêu thích | Saved từ Stremio, favorites và likes; không trộn với dislike |
| `pf-watched` | Danh sách Đã xem | Tác phẩm đã xem và series đã xem một số tập, ghi rõ số tập |
| `pf-search` | Tìm kiếm | Movie và Series riêng; TMDB relevance, tên đa ngôn ngữ hoặc IMDb ID, gồm cả phim đã xem |
| `pf-because` | Vì bạn đã xem | Tương đồng với manual watched/favorites/likes |
| `pf-genres` | Thể loại yêu thích | Phù hợp genres đã chọn |
| `pf-gems` | Đáng xem, ít người biết | Tương đồng, chất lượng, độ phổ biến thấp |
| `pf-top` | Lựa chọn hàng đầu | Mức phù hợp và điểm chất lượng được điều chỉnh theo số lượt đánh giá |

### Ý nghĩa chính xác của “mới” và “xu hướng”

- Ngày tính theo UTC, cập nhật theo ngày hiện tại, không cố định theo năm phát triển. Không nhận tác phẩm chưa phát hành, ngày không hợp lệ hoặc không có ngày vào mục mới.
- Movie dùng **ngày phát hành đầu tiên**; Series dùng **ngày phát tập đầu tiên**. Series cũ có mùa mới không được gắn thành series mới.
- Phim mới đang có trên dịch vụ **không đồng nghĩa** dịch vụ vừa thêm phim. TMDB không cung cấp lịch sử đầy đủ ngày được thêm lên Netflix/Disney+/HBO Max. Muốn catalog “vừa thêm lên nền tảng”, cần nguồn dữ liệu lịch sử riêng.
- Weekly trending là xu hướng **TMDB**, không phải tổng hợp Top 10 chính thức của từng dịch vụ. Một mục xu hướng gộp Netflix, Disney+, HBO Max/Max, Prime Video, Apple TV+, Hulu, Crunchyroll, Viki, iQIYI và WeTV được lọc theo lựa chọn của profile.
- Dữ liệu nền tảng là subscription (`flatrate`), theo khu vực, từ **JustWatch qua TMDB**. Không coi kết quả chỉ có thuê/mua là đang nằm trong gói đăng ký.
- Catalog phim Hàn/Trung/Nhật/anime tìm nội dung rộng hơn và có thể gồm phim chưa có trên các nền tảng đã chọn; chỉ các hàng xu hướng và new30/60/90 bắt buộc khớp nền tảng. Anime mới là tác phẩm anime mới, không phải lịch chiếu tập mới của toàn bộ anime đang phát.
- Không bù kết quả thiếu bằng fixture hoặc phim ngoài mốc ngày. Khu vực/nền tảng ít dữ liệu có thể trả danh sách trống.

## Recommendation và giới hạn tài nguyên

Candidate generator tìm Movie/TV, genres, quốc gia, anime và dữ liệu tuần. Các pool được xen kẽ để phim Hàn, Trung, anime không bị loại hết bởi giới hạn request. Tối đa 40 TMDB title candidates cho một catalog; đây không phải toàn bộ thư viện phim. Titles thiếu IMDb mapping bị bỏ để giữ tương thích streaming Add-on.

Ranking ổn định, có chiến lược riêng theo catalog: Jaccard genres/cast/directors/keywords, positive/negative affinity, độ mới, quốc gia yêu thích, anime, Bayesian rating và diversity penalty. Favorites, likes, saved, watched/started và dislikes được loại khỏi danh sách đề xuất; vẫn tìm được trong Search và các danh sách riêng. Watched là tín hiệu tương đồng yếu hơn Like, saved yếu hơn watched. Tín hiệu dislike cũng làm giảm độ tương đồng. Không dùng random.

Hybrid item co-occurrence có trọng số nhỏ trong Recommended/Top/Gems: chỉ dùng ứng viên được **ít nhất ba profile khác nhau** có sở thích giao nhau cùng thích. Dữ liệu ít thì quay về content-based. Đây là baseline cộng tác, chưa phải mô hình học máy đã được đánh giá độ chính xác bằng hành vi thật.

TMDB chạy tối đa bốn request đồng thời trên một process; các request trùng được gộp. Candidate cache: tối đa 100 hàng / 30 phút; ranking: tối đa 500 danh sách / 5 phút, theo user ID + profile version + catalog + nguồn + ngày. Upstream response được cache trong RAM và SQLite; dữ liệu danh sách khoảng 30 phút, metadata/provider tối đa 24 giờ. Cache SQLite được dọn theo thời gian và sau mỗi 100 lượt ghi, giữ khoảng 500 response / 2.000 metadata records. Phản hồi có giới hạn kích thước lưu cache. Thay preferences/interaction tăng version và làm mới ranking.

Chỉ chạy **một instance** với SQLite trên persistent storage. Không cần Redis, Elasticsearch, GPU hoặc microservices. Giới hạn này phù hợp mục tiêu server nhỏ nhưng chưa thay thế benchmark tải production.

## Chạy local

```bash
npm ci --include=dev
cp .env.example .env
# Điền TMDB_READ_ACCESS_TOKEN trong .env, hoặc DEMO_MODE=true để demo offline.
npm run build
npm start
```

Mở `http://localhost:7000/configure`. Startup tạo file SQLite nếu cần, áp dụng migration đã commit, rồi khởi động app. `npm run dev` dùng sau khi đã migrate. Không commit `.env`, database hoặc backup.

## Botkeep Cloud

Chọn **Application → Node.js 22 → GitHub**, repository này, branch `main`, root `.`. Repo public nhập được bằng URL; repo private cần quyền riêng cho Botkeep GitHub App.

Botkeep quản lý bước cài dependencies. Giữ devDependencies để compile, rồi dùng startup:

```bash
npm run build && npm start
```

Trên hosting không tự cài dependencies, build bằng `npm ci --include=dev && npm run build`. Nếu `npm ci` báo thiếu lockfile, kiểm tra source đã import đủ `package.json` và `package-lock.json` ở gốc trước khi restart.

Environment:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
DATABASE_URL=file:../data/feed.db
STORAGE_MODE=persistent
PUBLIC_BASE_URL=https://<domain-https-cua-ban>
TMDB_READ_ACCESS_TOKEN=<nhap-rieng-trong-panel>
DEMO_MODE=false
```

App ưu tiên `SERVER_PORT` do Botkeep cấp, sau đó mới dùng `PORT`; không ép cổng 7000 nếu đã có cổng được cấp. Trong Domains, bật HTTPS và trỏ tới cổng đó. `PUBLIC_BASE_URL` chỉ là origin, không có `/configure` hoặc `/manifest.json`.

Bắt đầu với 1024 MB RAM, 0.5 vCore, 1024 MB storage. Xác nhận filesystem giữ dữ liệu qua restart và import; `STORAGE_MODE` chỉ là mô tả, không tự tạo ổ bền vững. Giữ database trên volume thật. Khi sync GitHub, chọn **Merge files** để giữ thư mục data; backup trước khi import và không chọn replace/wipe nếu chưa có bản sao. Redeploy không đồng nghĩa pull code GitHub.

Tài liệu: [GitHub import](https://botkeep.cloud/docs/github), [HTTP port và Domains](https://botkeep.cloud/docs/hosting).

## Docker / hosting khác

```bash
docker compose up -d --build
```

SQLite nằm trong named volume `feed-data`; không dùng `docker compose down -v` nếu muốn giữ profile. Đặt `PUBLIC_BASE_URL`, `TMDB_READ_ACCESS_TOKEN`, `DEMO_MODE=false` trong environment của container (xem compose.yaml). Khi đưa lên Internet cần HTTPS reverse proxy. Compose giới hạn 768 MB RAM / 0.5 CPU; build nên chạy ngoài máy nhỏ nếu không đủ RAM.

Có sẵn `render.yaml` để thử bằng Render Blueprint. Cần thêm TMDB token trong Environment. Bản Free dùng ổ tạm, `STORAGE_MODE=ephemeral`; dữ liệu profile có thể mất khi restart/redeploy. Chọn persistent disk trước khi dùng lâu dài và cấu hình `DATABASE_URL` đúng mount path. Gói/giá/capacity do hosting quyết định.

## Profile và API

### Đồng bộ thư viện và Đã xem trong Stremio

[Protocol hiện tại](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md) có `library` và `player` resources. [Core-web 0.64.0](https://github.com/Stremio/stremio-core/releases/tag/stremio-core-web-v0.64.0) bổ sung gửi các sự kiện này. Client cũ hoặc dùng core chưa hỗ trợ có thể không gửi. Cần **cài lại manifest của cùng profile**, đồng ý quyền hoạt động xem mà Stremio hiển thị, rồi thử đánh dấu một tác phẩm Đã xem. Trang quản lý hiển thị thời điểm nhận sự kiện thư viện để xác nhận client thật.

- `libraryAdd` / `libraryRemove`: thêm/bỏ **Đã lưu**. Không suy diễn thành Like; protocol không có callback thumbs-up riêng.
- `watched` / `unwatched`: thêm/bỏ Đã xem. Nếu có `videoId`, lưu từng tập; một tập không đánh dấu cả series hoàn thành. Batches tối đa 100 video đúng IMDb cha; lặp callback không nhân bản dữ liệu.
- `syncLibrary` mặc định bật. Có thể tắt tại trang quản lý; handler sẽ không ghi thêm. Đổi cài đặt cần cài lại manifest để Stremio nhận resources mới.
- `syncPlayback` mặc định **tắt**. Nếu bật, chỉ coi hoàn thành khi nhận `stop`, thời lượng ít nhất 5 phút và vị trí đạt ít nhất 85%. Đây là tín hiệu vị trí dừng, không chứng minh đã xem toàn bộ. Không lưu tiến độ, stream URL hoặc từng sự kiện start/pause.
- Callback chỉ nhận **thay đổi mới**, không cung cấp API tải toàn bộ lịch sử trước khi cài. Có thể tìm phim ở trang cấu hình rồi đánh dấu Đã xem, hoặc chọn tối đa 50 tác phẩm khi tạo profile. Không cần mật khẩu Stremio.
- Like/Dislike và Đã xem độc lập: thích rồi đánh dấu xem vẫn giữ cả hai; bỏ xem không xóa Like. Saved cũng độc lập. Dữ liệu tối đa 2.000 tác phẩm, 10.000 video hoàn thành và 500 ratings gần nhất/profile để giới hạn tài nguyên.
- Home có các hàng Nhật, Hàn, Trung, Anime riêng cho Movie/Series; hàng trống có thể bị client ẩn. Discover chọn bộ sưu tập rồi Genre. Search có đúng một catalog cho mỗi loại, tránh fanout cùng một truy vấn qua 16 hàng.

Token riêng là capability của profile, không phải tài khoản Stremio. Chỉ hash được lưu trong database. Manifest URL chứa token; giữ riêng để cài lại hoặc chỉnh sở thích. Có thể chỉnh qua `/<token>/configure`; trang lưu token trong session của tab. Chưa có account recovery hoặc đồng bộ tài khoản Stremio.

| Endpoint | Công dụng |
| --- | --- |
| `GET /health` | Trạng thái app, SQLite, nguồn dữ liệu và cấu hình feed |
| `GET /api/library` | Genres, catalogs, nền tảng, khu vực, defaults và ví dụ onboarding |
| `GET /api/search?q=...&region=US` | Tìm Movie/Series/anime trong TMDB, trả IMDb IDs |
| `POST /api/profiles` | Tạo profile với genres, favorites và tùy chọn feed |
| `GET /api/profile` | Profile hiện tại; Bearer token |
| `GET /api/favorites` | Metadata favorites đã lưu; Bearer token |
| `PUT /api/profile` | Thay genres/favorites, tùy chọn cập nhật cấu hình feed; Bearer token |
| `POST /api/interactions` | `{mediaId:"tt...",kind:"like"/"dislike"/"watched"/"unwatched"/"unlike"/"undislike"/"save"/"unsave"/"clear"}`; Bearer token |
| `GET /<token>/manifest.json` | Manifest đã cấu hình |
| `GET /<token>/catalog/series/pf-anime-new.json` | Anime series mới |
| `GET /<token>/catalog/movie/pf-recommended/skip=100.json` | Trang kế tiếp, tối đa 100 kết quả / trang (chuẩn Stremio); candidate pool tối đa 40 cho recommendation, search xét tối đa 100 ứng viên |
| `GET /<token>/meta/series/<imdb-id>.json` | Chi tiết từ Cinemeta, giữ episode IDs thật |

Profile body bắt buộc `genres: string[]`, `favorites: string[]` (tối đa 10). Tùy chọn: `region`, `platforms`, `preferredOrigins`, `preferAnime`, `syncLibrary`, `syncPlayback`. POST hỗ trợ `watched: string[]` tối đa 50; PUT không thay toàn bộ watched để tránh đè callback, dùng interactions từng tác phẩm. Khi PUT bỏ các tùy chọn này thì giữ giá trị hiện tại. Có thể yêu cầu `registrationKey` khi tạo nếu server bật `REGISTRATION_KEY`. IMDb IDs không còn bị khóa vào thư viện mẫu; phải resolve được qua metadata.

Like và Dislike loại trừ nhau, nhưng độc lập với watched/saved. `clear` xóa rating và watched cho tác phẩm đó (không xóa saved); dùng `unlike`/`undislike`/`unwatched` khi chỉ muốn bỏ một tín hiệu. Các endpoint `/<token>/library/<type>/<imdb>/<extra>.json` và `/<token>/player/<type>/<videoId>/<extra>.json` nhận callback theo protocol, không cache, không tạo HEAD route để tránh HEAD làm thay đổi dữ liệu. Callback được xác thực bằng token riêng của profile.

Metadata chi tiết ưu tiên Cinemeta, giữ ID tập phim thật. Khi upstream lỗi, movie có fallback cơ bản; series trả `meta:null` thay vì tạo tập giả. Hãy giữ Cinemeta cài trong Stremio. Poster TMDB có fallback Metahub. Attribution TMDB / JustWatch xuất hiện trên trang cấu hình và dữ liệu nền tảng trong preview.

Ứng dụng không log URL/body vì đường dẫn chứa token. Proxy/hosting cũng cần ẩn URL chứa token khỏi access log. HTTP profile/catalog dùng `private, no-store`; cache ranking nằm bên trong app. Rate limit chạy trong RAM theo IP kết nối; không mặc định tin `X-Forwarded-For`.

## Backup / restore

```bash
npm run backup
# Hoặc đặt BACKUP_DIR vào ổ lưu bản sao riêng.
```

Script dùng SQLite `VACUUM INTO` để chụp snapshot nhất quán, bao gồm dữ liệu đã commit trong WAL, rồi mở bản sao và chạy `integrity_check`. File nằm ở `data/backups`, quyền 0600, không ghi đè file cũ. Cần đủ disk; tải bản sao ra nơi khác và tự đặt lịch phù hợp hosting. Bản sao cùng ổ không bảo vệ khi mất cả server.

Restore: dừng ứng dụng, giữ một bản sao database hiện tại, thay database trên đúng volume bằng bản backup đã kiểm tra; không giữ WAL/SHM cũ cạnh database thay thế. Khởi động lại để migrations chạy. Kiểm tra `/health`, profile và catalog. Thử restore vào instance riêng trước khi phụ thuộc vào quy trình. Bản 0.2 có test thực tế backup và đọc lại profile/cache.

## Kiểm thử và phần còn lại

```bash
npm run check
npm audit
```

GitHub CI dùng Node 22. Tests chạy offline với fetch mock có kiểm soát, SQLite thật và migration thật: date boundaries/leap year/future, regional provider filtering, phim Hàn/Trung/anime, IMDb mapping, profile isolation/cache invalidation, concurrency/deduplication, hybrid support threshold, nâng cấp database Phase 1 đã có dữ liệu, persistence và backup/restore.

Live smoke cần token thật: mở catalog tuần/mới/anime, xác nhận poster, ID, mốc ngày và thư viện khu vực. Cài thực tế trên Stremio Android/Desktop và benchmark tải vẫn phải làm trong môi trường đích. Tests offline không chứng minh chất lượng recommendation ngoài thực tế.

Đã có nền tảng Phase 2–4 và baseline hybrid/hiệu năng Phase 6. Phase 5 còn phụ thuộc hạ tầng thật, cấu hình token, kiểm thử thiết bị, backup ngoài server và thử tải. Chưa có collaborative model train offline, A/B evaluation hay backfill toàn bộ watch history; không đánh dấu toàn bộ roadmap hoàn tất.

Tài liệu nguồn: [TMDB discover](https://developer.themoviedb.org/reference/discover-movie), [weekly trending](https://developer.themoviedb.org/reference/trending-movies), [JustWatch attribution](https://developer.themoviedb.org/reference/tv-series-watch-providers), [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html), [Stremio SDK](https://github.com/Stremio/stremio-addon-sdk).
