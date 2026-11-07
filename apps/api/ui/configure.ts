export const configureHtml = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personalized Feed · Stremio</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/configure.js" defer></script></head>
<body><main>
<header><span class="badge">STREMIO ADD-ON · PHASE 1</span><h1>Feed phim theo gu của bạn.</h1><p>Thiết lập một lần, xem các catalog gợi ý ngay trong Stremio.</p></header>
<aside id="demo">Bản thử nghiệm với thư viện phim mẫu. Trending và các điểm chất lượng là trọng số minh họa, chưa lấy dữ liệu TMDB trực tiếp.</aside>
<p id="storage"></p><p id="status" role="status" aria-live="polite">Đang tải…</p>
<form id="preferences">
<section><h2>1. Chọn thể loại yêu thích</h2><div id="genres" class="choices"></div></section>
<section><h2>2. Chọn tối đa 10 phim yêu thích</h2><p>Chọn vài phim để catalog “Because You Watched” có tín hiệu ban đầu. Stremio không tự gửi lịch sử xem cho Add-on.</p>
<label for="search">Tìm trong thư viện mẫu</label><input id="search" type="search" placeholder="Tên phim hoặc series…"><div id="favorites" class="title-list"></div></section>
<section id="invitation-section" hidden><label for="invitation">Mã mời</label><input id="invitation" type="password" autocomplete="off"></section>
<button id="save" type="submit" disabled>Tạo profile và link cài đặt</button>
</form>
<section id="installation" hidden><h2>3. Cài vào Stremio</h2><p>Link dưới đây chứa token của profile. Lưu riêng để cài lại hoặc chỉnh sửa sở thích.</p>
<a id="install" class="button" href="#">Cài Add-on vào Stremio</a>
<label for="manifest-url">Manifest URL · có thể dán vào ô cài Add-on của Stremio</label><input id="manifest-url" readonly><button id="copy" type="button" class="secondary">Sao chép URL</button>
<p id="edit-link"></p><p>Catalog “Because You Watched” dùng favorites hoặc tín hiệu “Đã xem” do bạn chủ động thêm. Like / Dislike trên trang này giúp thử thay đổi feed.</p></section>
<section id="preview" hidden><h2>Xem trước feed của bạn</h2><label for="media-type">Loại nội dung</label><select id="media-type"><option value="movie">Movie</option><option value="series">Series</option></select><div id="rows"></div></section>
<footer>Không lưu hoặc cung cấp phim. Hãy giữ Cinemeta và các Add-on phát nội dung bạn đang sử dụng trong Stremio.</footer>
</main></body></html>`;
