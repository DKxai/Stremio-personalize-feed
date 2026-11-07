# Stremio Personalized Feed

Add-on Movie + Series với 6 catalog theo profile riêng, chạy trong một ứng dụng **Node.js 22 + TypeScript + Fastify + Stremio Add-on SDK + Prisma / SQLite**.

**Trạng thái: bản Phase 1 có thể tự host để kiểm thử, sử dụng 49 phim/series mẫu.** Không cần TMDB key. Chưa phải MVP hoàn chỉnh theo roadmap: chưa có candidate generation từ TMDB, dữ liệu trending trực tiếp, collaborative filtering hoặc đồng bộ lịch sử xem.

## Deploy nhanh

### Render — thử nghiệm với HTTPS

Repo có sẵn `render.yaml`. Trong Render, chọn **New → Blueprint**, kết nối repository này và dùng cấu hình mặc định. Blueprint dùng gói Free để chạy thử; bạn tự xem và xác nhận lựa chọn dịch vụ trên Render.

Nếu tạo **New → Web Service** thủ công, chọn repository này và nhập:

| Thiết lập | Giá trị |
| --- | --- |
| Runtime | Node |
| Node version | `22` |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/health` |
| `DATABASE_URL` | `file:../data/feed.db` |
| `STORAGE_MODE` | `ephemeral` |

Ứng dụng nhận `PORT` và `RENDER_EXTERNAL_URL` do Render cung cấp. Không đặt `PUBLIC_BASE_URL` thành `localhost` khi deploy. Nếu dùng domain riêng, đặt `PUBLIC_BASE_URL=https://domain-cua-ban`.

Sau khi service chạy, mở **`https://<ten-service>.onrender.com/configure`**, chọn sở thích và bấm **Cài Add-on vào Stremio**, hoặc dán manifest URL được tạo vào giao diện cài Add-on của Stremio.

**Render Free chỉ dùng để thử:** không gắn persistent disk, dữ liệu SQLite và profile sẽ mất khi restart / redeploy. Profile cũ sẽ không còn truy cập được. Muốn giữ profile, dùng Docker với volume hoặc dịch vụ có persistent disk. Với Render, disk bền vững yêu cầu dịch vụ trả phí; kiểm tra gói và chi phí hiện tại trước khi chọn. Dịch vụ Free có thể ngủ khi không có request nên lần gọi đầu có thể chậm.

Để chuyển sang persistent disk: gắn disk vào `/var/data`, đặt `DATABASE_URL=file:/var/data/feed.db`, `STORAGE_MODE=persistent` và chỉ chạy **một instance**. Đây là database mới nếu trước đó bạn dùng đường dẫn demo; cần chuyển dữ liệu cũ riêng nếu muốn giữ profile.

### Docker — lưu profile qua restart

```bash
docker compose up -d --build
```

Mở `http://localhost:7000/configure`. SQLite nằm trong named volume `feed-data`; không dùng `docker compose down -v` nếu muốn giữ dữ liệu.

Khi đưa lên Internet, đặt `PUBLIC_BASE_URL` thành domain HTTPS của bạn, dùng reverse proxy TLS và giữ volume `/app/data`. Ví dụ tạo `.env`:

```dotenv
PUBLIC_BASE_URL=https://feed.example.com
REGISTRATION_KEY=ma-moi-rieng-cua-ban
```

Compose giới hạn runtime ở 768 MB và 0.5 CPU; đây là cấu hình giới hạn, chưa phải số đo tải production. Build image nên chạy ngoài server 1 GB nếu không đủ RAM lúc cài dependency/compile.

### Botkeep Cloud

Tại trang Create, chọn ứng dụng **Node.js 22**, nguồn GitHub, repository này, branch `main`, project root là gốc repository (`.`). Repository public có thể nhập bằng URL. Với repository private, cần cài/cấp quyền cho **Botkeep GitHub App**; quyền của ChatGPT không thay thế quyền của Botkeep.

Botkeep đã được kiểm tra thực tế với bước cài dependencies do nền tảng quản lý trước khi chạy startup command. Trên cấu hình này, dùng:

```bash
npm run build && npm start
```

Giữ devDependencies trong bước cài vì TypeScript cần cho build. Nếu một hosting khác không tự cài dependencies, chạy `npm ci --include=dev` trong bước build trước. Tránh cài lại lần thứ hai trong startup khi Botkeep đã hoàn thành locked install. Nếu gói cho phép, cấp 1024 MB RAM, 0.5 vCore và 1024 MB storage để bắt đầu; mức này chưa được benchmark tải trên Botkeep. Không cần tạo database server riêng vì bản này dùng SQLite.

Ứng dụng tự nhận cổng `SERVER_PORT` được Botkeep cấp (ưu tiên hơn `PORT`) và bind `0.0.0.0`. Không ép cổng `7000` nếu panel đã cấp cổng khác. Trong Environment: đặt `NODE_ENV=production`, `HOST=0.0.0.0`, `DATABASE_URL=file:../data/feed.db` và `STORAGE_MODE=ephemeral` để chạy thử trước khi xác nhận volume thật.

Trong **Domains**, cấu hình alias hoặc domain của bạn với HTTPS tới cổng được cấp. Sau đó đặt `PUBLIC_BASE_URL` thành origin HTTPS thực tế (không có `/configure` hay `/manifest.json`) rồi restart. Kiểm tra `/health`, mở `/configure` và tạo profile để cài vào Stremio.

Chỉ đổi sang `STORAGE_MODE=persistent` sau khi xác nhận đường dẫn volume bền vững; trỏ `DATABASE_URL=file:/<duong-dan-volume-thuc-te>/feed.db` tới đúng volume đó. Chạy một instance. Nếu đổi đường dẫn, cần chuyển database riêng nếu muốn giữ profile cũ. Không thể deploy khi Botkeep báo hết capacity. Repository này không tự tạo server, domain hay tài khoản Botkeep.

Xem hướng dẫn chính thức: [GitHub import](https://botkeep.cloud/docs/github), [HTTP port và Domains](https://botkeep.cloud/docs/hosting).

## Chạy local

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

`npm start` tạo thư mục và file database nếu chưa có, chạy các migration đã commit, rồi khởi động server. Chạy lại không xóa profile. Với chế độ phát triển: sau khi đã khởi tạo database bằng `npm start`, dùng `npm run dev`.

Ứng dụng bind `0.0.0.0` để chạy được trong container. Android phải dùng domain HTTPS hoặc địa chỉ máy chủ mà thiết bị thực sự truy cập được; `localhost` trên điện thoại là chính điện thoại. Stremio Web cần endpoint HTTPS để tránh mixed content. Việc cài thực tế trên Android/Desktop vẫn cần kiểm thử trên thiết bị.

## Các catalog

Mỗi catalog có hai loại `movie` / `series`: tổng cộng 12 khai báo trong manifest.

| ID | Hiển thị | Chiến lược bản mẫu |
| --- | --- | --- |
| `pf-recommended` | Recommended for You | Thể loại + nội dung tương đồng với favorites/likes |
| `pf-because` | Because You Watched | Tương đồng với các phim chủ động đánh dấu đã xem; favorites/likes cũng là seed ban đầu |
| `pf-genres` | Your Favorite Genres | Lọc và xếp hạng theo thể loại đã chọn |
| `pf-gems` | Hidden Gems | Tương đồng và trọng số độ phổ biến thấp trong fixture |
| `pf-trending` | Trending for You | Sở thích + trọng số độ phổ biến minh họa, chưa có xu hướng trực tiếp |
| `pf-top` | Top Picks | Sở thích + điểm chất lượng minh họa |

Ranking ổn định, không random; có diversity penalty cho một số catalog. Mỗi trang tối đa 20 mục, phân trang bằng `skip=20`. Các phim đã favorite/like/watched hoặc bị dislike được loại khỏi candidate list. Catalog Because trống khi chưa có seed. Cast/director/keywords của fixture chỉ là dữ liệu minh họa giới hạn, không phải bản sao đầy đủ TMDB. Công thức sẽ tiếp tục được hiệu chỉnh ở phase recommendation.

Các preview dùng IMDb ID để tương thích Add-on phát nội dung hiện có. Poster đến từ Metahub. Metadata chi tiết được lấy từ Cinemeta với timeout và cache giới hạn; series giữ nguyên episode ID do Cinemeta cung cấp. Khi upstream lỗi, movie có metadata cơ bản dự phòng; series trả `meta: null`, không tạo episode giả. Hãy giữ Cinemeta cài trong Stremio. Không có stream handler và không lưu trữ phim.

## Profile và API

Onboarding tạo profile riêng; token là capability để truy cập và sửa profile, không phải tài khoản Stremio. Token chỉ xuất hiện khi tạo và trong manifest URL, database chỉ giữ hash. Không chia sẻ manifest URL công khai. Đường dẫn cấu hình `/<token>/configure` cho phép chỉnh sửa profile; trang còn nhớ token trong session của tab. Chưa có đăng nhập, khôi phục tài khoản hay xoay token.

| Endpoint | Công dụng |
| --- | --- |
| `GET /health` | Kiểm tra ứng dụng và kết nối SQLite |
| `GET /configure` | Tạo profile, chọn genres + favorites |
| `GET /manifest.json` | Manifest yêu cầu cấu hình |
| `POST /api/profiles` | Tạo profile: `{genres: [], favorites: [], registrationKey?: "..."}` |
| `GET /api/profile` | Profile hiện tại, header `Authorization: Bearer <token>` |
| `PUT /api/profile` | Thay toàn bộ genres/favorites, cùng header |
| `POST /api/interactions` | `{mediaId: "tt...", kind: "like" / "dislike" / "watched" / "clear"}`, cùng header |
| `GET /<token>/manifest.json` | Manifest đã cấu hình |
| `GET /<token>/catalog/movie/pf-recommended.json` | Catalog Movie |
| `GET /<token>/catalog/series/pf-recommended/skip=20.json` | Trang tiếp theo của Series |
| `GET /<token>/meta/movie/tt0816692.json` | Metadata chi tiết |

API chỉ chấp nhận ID trong fixture ở Phase 1. Mỗi title có một trạng thái interaction hiện tại; thao tác mới thay thế trạng thái trước. `watched` là thao tác chủ động, không phải sự kiện xem tự động. Add-on Protocol không cung cấp toàn bộ watch history / click events cho backend này. Tương tác trên trang cấu hình cập nhật feed; Stremio có thể cần tải lại catalog để thấy thay đổi.

Cache recommendation là TTL/LRU trong RAM (tối đa 500 danh sách, 5 phút), key gồm user ID + version + type + catalog. Thay đổi profile/interaction tăng version. HTTP response của profile/catalog có `private, no-store`. Cache mất khi restart và được tính lại từ dữ liệu SQLite.

Ứng dụng không log URL/body request vì đường dẫn chứa token; reverse proxy và hosting cũng cần cấu hình ẩn token khỏi access log. `REGISTRATION_KEY` tùy chọn hạn chế tạo profile công khai. Rate limiting chạy trong RAM theo IP kết nối; mặc định không tin `X-Forwarded-For`, nên sau reverse proxy một số người dùng có thể dùng chung giới hạn.

## Kiểm thử

```bash
npm run check
```

Gồm TypeScript check, integration tests với SQLite tạm thật, và build. Tests xác nhận 12 catalog, phân trang không lặp, profile khác nhau có ranking khác nhau, tín hiệu tương tác làm mới cache, xác thực đầu vào/token, và profile còn nguyên khi đóng/mở lại database. Metadata tests dùng fetch giả để chạy offline. GitHub Actions chạy cùng lệnh bằng Node 22.

Docker image và cài Add-on thực tế trên Android/Desktop cần xác nhận riêng trong môi trường đích; HTTP tests không thay thế kiểm thử thiết bị.

Các `overrides` trong package.json khóa bản vá của `deepmerge-ts`, `path-to-regexp` và `tmp` trong cây dependencies của Prisma/SDK. Chúng giữ nguyên phiên bản API chính của Prisma và Stremio SDK; hãy chạy `npm run check` và `npm audit` khi thay đổi lockfile. Các luồng migration, catalog và profile được kiểm tra bằng SQLite thật.

## Sao lưu SQLite

Với volume thật: dừng ứng dụng trước khi sao chép database để tránh bản sao lệch với WAL. Sao chép toàn bộ thư mục data (cả các file `-wal` / `-shm` nếu còn), khởi động lại, rồi lưu bản sao ra nơi khác. Ví dụ Docker Compose:

```bash
docker compose stop feed
docker compose cp feed:/app/data ./backup-data
docker compose start feed
```

Kiểm thử restore vào instance riêng trước khi cần dùng bản sao. Không commit database hoặc token vào Git.

## Cấu trúc và phần tiếp theo

`apps/addon` giữ manifest/SDK handlers; `apps/api` giữ Fastify routes, onboarding và profile service; `packages/recommendation` giữ ranking/cache; `packages/metadata` giữ fixture, Cinemeta và mapper; `prisma` giữ schema và migration.

1. **Tiếp theo:** thay fixture bằng TMDB candidate generator, mapping IMDb/TMDB, metadata cache và attribution phù hợp.
2. Hoàn thiện profile, token lifecycle, nhiều tín hiệu đồng thời và quản lý dữ liệu.
3. Đánh giá ranking theo từng catalog, dữ liệu mới, diversity và metrics.
4. Kiểm thử Android/Desktop, deployment với disk thật, backup/restore và tải trên cấu hình mục tiêu.
5. Chỉ triển khai hybrid/collaborative khi có đủ dữ liệu và cơ chế đồng ý phù hợp.

Tài liệu tham khảo: [Stremio SDK](https://github.com/Stremio/stremio-addon-sdk), [Render Node deployment](https://render.com/docs/deploy-node-express-app), [Render persistent disks](https://render.com/docs/disks), [Render free services](https://render.com/docs/free).
