export const configureStyle = `
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#101018;color:#f2f2fb}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:48px 24px}header{max-width:700px;margin-bottom:28px}.badge{font-size:12px;letter-spacing:2px;color:#b9a1ff}h1{font-size:clamp(32px,5vw,52px);line-height:1.1;margin:18px 0}h2{font-size:21px}h3{margin-top:30px}p,footer{color:#b8b8cb;line-height:1.6}aside{background:#242034;border:1px solid #443755;padding:18px;border-radius:12px;font-size:14px;line-height:1.6}section{margin:32px 0}label{display:block;margin:12px 0 8px}input,select{background:#1c1c2a;color:inherit;border:1px solid #45455b;border-radius:8px;padding:12px;font:inherit;max-width:100%}input[type=search],input[readonly]{width:100%}input[type=checkbox]{accent-color:#a388ff;width:17px;height:17px;margin-right:9px}button,.button{border:0;background:#9876f7;color:#100c22;padding:13px 20px;border-radius:9px;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none;display:inline-block;margin:8px 8px 8px 0}button:disabled{opacity:.5;cursor:wait}.secondary{background:#303044;color:#eee}.choices{display:flex;flex-wrap:wrap;gap:9px}.choices label{border:1px solid #414158;background:#1c1c2a;padding:10px;border-radius:20px;margin:0;display:flex;align-items:center}.choices label:has(input:checked){border-color:#b8a0ff;background:#33294b}.title-list{max-height:310px;overflow:auto;border:1px solid #363648;border-radius:10px;margin-top:12px;padding:8px}.title-list label{padding:8px;margin:0;display:flex;align-items:center}.title-list small{color:#9999ae;margin-left:auto;padding-left:12px}#status{min-height:26px;color:#bdaaff}#storage{font-size:14px;color:#e7c583}.cards{display:flex;gap:16px;overflow:auto;padding-bottom:10px}.card{flex:0 0 170px;background:#1d1d2b;border-radius:10px;padding:10px}.card img{width:150px;height:220px;object-fit:cover;border-radius:6px}.card strong{display:block;margin:8px 0;min-height:40px}.card button{font-size:12px;padding:7px;margin:3px}.card button.active{background:#c8b7ff}.card button.secondary.active{outline:2px solid #c8b7ff}a{color:#c4afff;overflow-wrap:anywhere}footer{margin-top:50px;font-size:13px}[hidden]{display:none!important}:focus-visible{outline:3px solid #d9caff;outline-offset:3px}@media(max-width:600px){main{padding:28px 16px}.title-list small{font-size:10px}}
`;

export const configureScript = String.raw`
'use strict';
const $ = id => document.getElementById(id);
const catalogNames = [['recommended','Recommended for You'],['because','Because You Watched'],['genres','Your Favorite Genres'],['gems','Hidden Gems'],['trending','Trending for You'],['top','Top Picks']];
const candidate = location.pathname.split('/').filter(Boolean);
let token = candidate.length === 2 ? candidate[0] : sessionStorage.getItem('pf-token');
let currentProfile = null;
let library = null;
let previewVersion = 0;
const status = message => { $('status').textContent = message; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', ...(token ? { Authorization:'Bearer ' + token } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thể hoàn thành yêu cầu');
  return data;
}
const selected = id => [...$(id).querySelectorAll('input:checked')].map(input => input.value);
function fillProfile(profile) {
  currentProfile = profile;
  for (const input of $('genres').querySelectorAll('input')) input.checked = profile.genres.includes(input.value);
  for (const input of $('favorites').querySelectorAll('input')) input.checked = profile.favorites.includes(input.value);
}
function showInstallation() {
  const url = location.origin + '/' + token + '/manifest.json';
  $('manifest-url').value = url;
  $('install').href = url.replace(/^https?:/, 'stremio:');
  const edit = document.createElement('a');
  edit.href = location.origin + '/' + token + '/configure';
  edit.textContent = 'Mở lại trang quản lý profile';
  $('edit-link').replaceChildren(edit);
  $('installation').hidden = false;
  $('preview').hidden = false;
  $('invitation-section').hidden = true;
  $('save').textContent = 'Cập nhật sở thích';
}
async function preview() {
  const version = ++previewVersion;
  const type = $('media-type').value;
  const rows = await Promise.all(catalogNames.map(async ([id, name]) => {
    const data = await api('/' + token + '/catalog/' + type + '/pf-' + id + '.json');
    return { name, metas:data.metas };
  }));
  if (version !== previewVersion) return;
  $('rows').replaceChildren();
  for (const {name, metas} of rows) {
    const heading = document.createElement('h3'); heading.textContent = name;
    const cards = document.createElement('div'); cards.className = 'cards';
    if (!metas.length) { const p = document.createElement('p'); p.textContent = 'Chưa có kết quả. Thử thêm favorites hoặc đổi thể loại.'; cards.append(p); }
    for (const meta of metas.slice(0, 6)) {
      const card = document.createElement('article'); card.className='card';
      const img = document.createElement('img'); img.src=meta.poster; img.alt=meta.name; img.loading='lazy'; img.referrerPolicy='no-referrer';
      const title = document.createElement('strong'); title.textContent=meta.name;
      card.append(img,title);
      for (const [kind,label] of [['like','Like'],['dislike','Dislike'],['watched','Đã xem']]) {
        const button=document.createElement('button'); button.type='button'; button.textContent=label; button.className='secondary';
        button.addEventListener('click',async()=>{
          button.disabled=true;
          try {
            const result=await api('/api/interactions',{method:'POST',body:JSON.stringify({mediaId:meta.id,kind})});
            fillProfile(result.profile); await preview(); status('Đã cập nhật feed. Stremio có thể cần tải lại catalog.');
          } catch(error) { status(error.message); button.disabled=false; }
        });
        card.append(button);
      }
      cards.append(card);
    }
    $('rows').append(heading,cards);
  }
}
$('preferences').addEventListener('submit',async event=>{
  event.preventDefault();
  $('save').disabled=true;
  try {
    const body={genres:selected('genres'),favorites:selected('favorites')};
    if (!token) body.registrationKey=$('invitation').value;
    const data=await api(token ? '/api/profile' : '/api/profiles',{method:token ? 'PUT':'POST',body:JSON.stringify(body)});
    if(data.token) { token=data.token; sessionStorage.setItem('pf-token',token); }
    fillProfile(data.profile); showInstallation(); await preview(); status('Profile đã sẵn sàng. Bạn có thể cài vào Stremio.');
  } catch(error) { status(error.message); }
  finally { $('save').disabled=false; }
});
$('copy').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText($('manifest-url').value); status('Đã sao chép manifest URL.'); }
  catch { $('manifest-url').select(); status('Chọn và sao chép manifest URL trong ô bên trên.'); }
});
$('media-type').addEventListener('change',()=>preview().catch(error=>status(error.message)));
$('search').addEventListener('input',()=>{
  const search=$('search').value.trim().toLowerCase();
  for(const label of $('favorites').children) label.hidden=!label.textContent.toLowerCase().includes(search);
});
$('favorites').addEventListener('change',event=>{
  if(selected('favorites').length>10) { event.target.checked=false; status('Chọn tối đa 10 phim yêu thích.'); }
});
(async()=>{
  try {
    library=await api('/api/library');
    $('storage').textContent=library.storage==='ephemeral' ? 'Chế độ demo: profile sẽ mất khi dịch vụ restart hoặc redeploy. Dùng Docker volume hoặc persistent disk để lưu lâu dài.' : 'Profile được lưu vào SQLite. Máy chủ cần gắn volume hoặc disk bền vững.';
    for(const genre of library.genres) {
      const label=document.createElement('label'); const input=document.createElement('input'); input.type='checkbox';input.value=genre;
      label.append(input,document.createTextNode(genre)); $('genres').append(label);
    }
    for(const title of library.titles) {
      const label=document.createElement('label'); const input=document.createElement('input');input.type='checkbox';input.value=title.id;
      const small=document.createElement('small');small.textContent=title.type+' · '+title.year;
      label.append(input,document.createTextNode(title.name),small);$('favorites').append(label);
    }
    $('invitation-section').hidden=!library.invitationRequired;
    if(token) {
      try { const data=await api('/api/profile');fillProfile(data.profile);showInstallation();await preview();status('Đã tải profile của bạn.'); }
      catch(error) { if(candidate.length===2) throw error;token=null;sessionStorage.removeItem('pf-token');status('Profile cũ không còn tồn tại. Hãy tạo profile mới.'); }
    } else status('Chọn thể loại và phim yêu thích để bắt đầu.');
    $('save').disabled=false;
  } catch(error) { status(error.message); }
})();
`;
