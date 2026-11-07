export const configureHtml = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personalized Feed · Stremio</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/configure.js" defer></script></head>
<body><main>
<header><span class="badge">STREMIO · MOVIE · SERIES · ANIME</span><h1>Feed phim theo gu của bạn.</h1><p>Thiết lập một lần, xem các catalog gợi ý ngay trong Stremio.</p></header>
<aside id="demo">Đang kiểm tra nguồn dữ liệu…</aside>
<p id="storage"></p><p id="status" role="status" aria-live="polite">Đang tải…</p>
<form id="preferences">
<section><h2>1. Nội dung bạn muốn xem</h2>
<label for="region">Khu vực thư viện nền tảng</label><select id="region"></select>
<p>Mặc định Hoa Kỳ để gộp Netflix, Disney+, HBO Max và các dịch vụ quốc tế. Chọn VN để lọc theo thư viện Việt Nam; một số nền tảng có thể không có dữ liệu tại khu vực này.</p>
<div id="platforms" class="choices"></div>
<h3>Ưu tiên phim từ</h3><div id="origins" class="choices"></div>
<label><input id="prefer-anime" type="checkbox" checked> Ưu tiên anime trong feed dành cho bạn</label>
<p>Anime có catalog riêng cho cả phim điện ảnh và series. “Anime mới” dùng ngày ra mắt phim/tập đầu, không dùng ngày ra mùa mới của series cũ.</p></section>
<section><h2>2. Chọn thể loại yêu thích</h2><div id="genres" class="choices"></div></section>
<section><h2>3. Phim yêu thích và phim đã xem</h2><p>Chọn tối đa 10 phim yêu thích và 50 tác phẩm đã xem lúc tạo profile. Hai tín hiệu được lưu riêng; đã xem không có nghĩa là thích.</p>
<label for="search">Tìm phim, series hoặc anime</label><input id="search" type="search" placeholder="Tên phim, series hoặc anime…"><div id="favorites" class="title-list"></div></section>
<section><h2>4. Đồng bộ từ Stremio</h2>
<label><input id="sync-library" type="checkbox" checked> Nhận thay đổi Thư viện và Đã xem từ Stremio</label>
<label><input id="sync-playback" type="checkbox"> Tự ghi nhận khi dừng phát ở ít nhất 85% thời lượng</label>
<p>Cần client Stremio hỗ trợ library/player events và cài lại Add-on để nhận quyền theo dõi mới. Chỉ nhận thay đổi sau khi cài; lịch sử cũ có thể thêm tại đây. Lưu vào Thư viện là tín hiệu Đã lưu, không tự coi là Like. Một tập đã xem không đánh dấu cả series hoàn thành. Theo dõi phát mặc định tắt; chỉ lưu tập/tác phẩm hoàn thành, không lưu tiến độ hay link phát.</p>
<p id="activity-status"></p></section>
<section id="invitation-section" hidden><label for="invitation">Mã mời</label><input id="invitation" type="password" autocomplete="off"></section>
<button id="save" type="submit" disabled>Tạo profile và link cài đặt</button>
</form>
<section id="installation" hidden><h2>5. Cài vào Stremio</h2><p>Link dưới đây chứa token của profile. Lưu riêng để cài lại hoặc chỉnh sửa sở thích.</p>
<a id="install" class="button" href="#">Cài Add-on vào Stremio</a>
<label for="manifest-url">Manifest URL · có thể dán vào ô cài Add-on của Stremio</label><input id="manifest-url" readonly><button id="copy" type="button" class="secondary">Sao chép URL</button>
<p id="edit-link"></p><p>Sau khi cập nhật catalog hoặc bật đồng bộ, gỡ Add-on cũ và cài lại bằng cùng manifest URL. Profile vẫn được giữ. Like / Dislike / Đã xem trên trang này cũng cập nhật feed.</p></section>
<section id="preview" hidden><h2>Xem trước feed của bạn</h2><label for="media-type">Loại nội dung</label><select id="media-type"><option value="movie">Movie</option><option value="series">Series</option></select><label for="catalog-choice">Bộ sưu tập</label><select id="catalog-choice"></select><p id="feed-note">Xu hướng là bảng tuần TMDB lọc theo nền tảng đang có phim, không phải Top 10 chính thức của từng dịch vụ. Mục mới chỉ lấy tác phẩm phát hành gần đây, không phải ngày được thêm vào thư viện dịch vụ.</p><label for="discover-search">Tìm trong thư viện TMDB</label><input id="discover-search" type="search" placeholder="Tên quốc tế, Nhật, Hàn, Trung hoặc IMDb ID…"><button id="run-search" type="button">Tìm kiếm</button>
<label for="discover-genre">Lọc thể loại trong bộ sưu tập</label><select id="discover-genre"><option value="">Tất cả thể loại</option></select>
<p>Trong Stremio: Home có hàng Nhật, Hàn, Trung và Anime riêng; Discover chọn Movie/Series → Personalized Feed → catalog → Genre. Tìm kiếm dùng hàng riêng cho Movie và Series.</p><div id="rows"></div><button id="more" type="button" class="secondary" hidden>Xem thêm</button></section>
<footer><a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg" width="80" height="58" alt="TMDB"></a><p>Dữ liệu phim: <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a>. Nền tảng phát: <a href="https://www.justwatch.com/" target="_blank" rel="noreferrer">JustWatch</a> qua TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>Không lưu hoặc cung cấp phim. Hãy giữ Cinemeta và các Add-on phát nội dung bạn đang sử dụng trong Stremio.</footer>
</main></body></html>`;
