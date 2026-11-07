export const configureStyle = `
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#101018;color:#f2f2fb}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:48px 24px}header{max-width:700px;margin-bottom:28px}.badge{font-size:12px;letter-spacing:2px;color:#b9a1ff}h1{font-size:clamp(32px,5vw,52px);line-height:1.1;margin:18px 0}h2{font-size:21px}h3{margin-top:30px}p,footer{color:#b8b8cb;line-height:1.6}aside{background:#242034;border:1px solid #443755;padding:18px;border-radius:12px;font-size:14px;line-height:1.6}section{margin:32px 0}label{display:block;margin:12px 0 8px}input,select{background:#1c1c2a;color:inherit;border:1px solid #45455b;border-radius:8px;padding:12px;font:inherit;max-width:100%}input[type=search],input[readonly]{width:100%}input[type=checkbox]{accent-color:#a388ff;width:17px;height:17px;margin-right:9px}button,.button{border:0;background:#9876f7;color:#100c22;padding:13px 20px;border-radius:9px;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none;display:inline-block;margin:8px 8px 8px 0}button:disabled{opacity:.5;cursor:wait}.secondary{background:#303044;color:#eee}.choices{display:flex;flex-wrap:wrap;gap:9px}.choices label{border:1px solid #414158;background:#1c1c2a;padding:10px;border-radius:20px;margin:0;display:flex;align-items:center}.choices label:has(input:checked){border-color:#b8a0ff;background:#33294b}.title-list{max-height:310px;overflow:auto;border:1px solid #363648;border-radius:10px;margin-top:12px;padding:8px}.title-list>div{padding:10px;border-bottom:1px solid #363648}.title-list>div>span{display:block}.title-list label{display:inline-flex!important;padding:8px;margin:0;display:flex;align-items:center}.title-list small{color:#9999ae;margin-left:auto;padding-left:12px}#status{min-height:26px;color:#bdaaff}#storage{font-size:14px;color:#e7c583}.cards{display:flex;gap:16px;overflow:auto;padding-bottom:10px}.card{flex:0 0 170px;background:#1d1d2b;border-radius:10px;padding:10px}.card img{width:150px;height:220px;object-fit:cover;border-radius:6px}.card strong{display:block;margin:8px 0;min-height:40px}.card .details{font-size:12px;max-height:100px;overflow:auto}.card button{font-size:12px;padding:7px;margin:3px}.card button.active{background:#c8b7ff}.card button.secondary.active{outline:2px solid #c8b7ff}a{color:#c4afff;overflow-wrap:anywhere}footer{margin-top:50px;font-size:13px}[hidden]{display:none!important}:focus-visible{outline:3px solid #d9caff;outline-offset:3px}@media(max-width:600px){main{padding:28px 16px}.title-list small{font-size:10px}}
`;

export const configureScript = String.raw`
'use strict';
const $ = id => document.getElementById(id);
const candidate = location.pathname.split('/').filter(Boolean);
let token = candidate.length === 2 ? candidate[0] : sessionStorage.getItem('pf-token');
let currentProfile = null, library = null, previewVersion = 0, skip = 0, searchVersion = 0, searchTimer;
const favorites = new Set(), watched = new Set();
const titles = new Map();
const status = message => { $('status').textContent = message; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', ...(token ? { Authorization:'Bearer ' + token } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thể hoàn thành yêu cầu');
  return data;
}
const selected = id => [...$(id).querySelectorAll('input:checked')].map(input => input.value);
function choices(id, items, checked = []) {
  $(id).replaceChildren();
  for (const item of items) {
    const label=document.createElement('label'), input=document.createElement('input');
    input.type='checkbox'; input.value=item.id; input.checked=checked.includes(item.id);
    label.append(input,document.createTextNode(item.name)); $(id).append(label);
  }
}
function renderFavorites(results = [...titles.values()]) {
  const shown = new Map([...new Set([...favorites, ...[...watched].slice(0, 50)])].map(id => [id,titles.get(id) || {id,name:id,type:'',year:''}]));
  for (const title of results) { titles.set(title.id,title); shown.set(title.id,title); }
  $('favorites').replaceChildren();
  for (const title of shown.values()) {
    const row=document.createElement('div'), name=document.createElement('span');
    name.textContent=title.name+' · '+title.type+' · '+title.year; row.append(name);
    for(const [kind,labelText,set] of [['favorite','Thích',favorites],['watched','Đã xem',watched]]) {
      const label=document.createElement('label'), input=document.createElement('input');
      input.type='checkbox';input.value=title.id;input.dataset.kind=kind;input.checked=set.has(title.id);
      label.append(input,document.createTextNode(labelText));row.append(label);
    }
    $('favorites').append(row);
  }
}
function fillProfile(profile) {
  currentProfile=profile; favorites.clear(); profile.favorites.forEach(id=>favorites.add(id));watched.clear();profile.watched.forEach(id=>watched.add(id));
  for(const input of $('genres').querySelectorAll('input')) input.checked=profile.genres.includes(input.value);
  for(const input of $('platforms').querySelectorAll('input')) input.checked=profile.platforms.includes(input.value);
  for(const input of $('origins').querySelectorAll('input')) input.checked=profile.preferredOrigins.includes(input.value);
  $('sync-library').checked=profile.syncLibrary;$('sync-playback').checked=profile.syncPlayback;
  $('activity-status').textContent='Đã xem: '+profile.watched.length+' tác phẩm · Đang xem: '+(profile.started || []).length+' series · Đã lưu: '+(profile.saved || []).length+'. Sự kiện thư viện gần nhất: '+(profile.lastLibraryEventAt ? new Date(profile.lastLibraryEventAt).toLocaleString('vi-VN') : 'chưa nhận từ client')+'.';
  $('region').value=profile.region; $('prefer-anime').checked=profile.preferAnime;
  renderFavorites();
}
function showInstallation() {
  const url=location.origin+'/'+token+'/manifest.json';
  $('manifest-url').value=url; $('install').href=url.replace(/^https?:/, 'stremio:');
  const edit=document.createElement('a');edit.href=location.origin+'/'+token+'/configure';edit.textContent='Mở lại trang quản lý profile';
  $('edit-link').replaceChildren(edit); $('installation').hidden=false; $('preview').hidden=false;
  $('invitation-section').hidden=true; $('save').textContent='Cập nhật sở thích';
}
async function preview(more=false) {
  const version=++previewVersion;
  if(!more) { skip=0; $('rows').replaceChildren(); }
  $('more').hidden=true; status('Đang tải catalog… Lần đầu cần đồng bộ metadata.');
  try {
    const query=$('discover-search').value.trim(), catalog=query ? 'search' : $('catalog-choice').value;
    const extra=new URLSearchParams();if(skip) extra.set('skip',skip);if(query) extra.set('search',query);
    if(!query && !['saved','watched'].includes(catalog) && $('discover-genre').value) extra.set('genre',$('discover-genre').value);
    const data=await api('/'+token+'/catalog/'+$('media-type').value+'/pf-'+catalog+(extra.size ? '/'+extra.toString() : '')+'.json');
    if(version!==previewVersion) return;
    const cards=document.createElement('div');cards.className='cards';
    if(!data.metas.length) { const p=document.createElement('p');p.textContent='Chưa có phim khớp bộ lọc. Thử khu vực/nền tảng khác. Mục mới không bù bằng phim cũ.';cards.append(p); }
    for(const meta of data.metas) {
      const card=document.createElement('article');card.className='card';
      const img=document.createElement('img');img.src=meta.poster;img.alt=meta.name;img.loading='lazy';img.referrerPolicy='no-referrer';
      const name=document.createElement('strong');name.textContent=meta.name;
      const info=document.createElement('p');info.className='details';info.textContent=(meta.description || '').slice(0,210);
      card.append(img,name,info);
      for(const [kind,label] of [['like','Thích'],['dislike','Không thích'],['watched','Đã xem'],['save','Đã lưu']]) {
        const button=document.createElement('button');button.type='button';button.textContent=label;const active=(kind==='like' ? currentProfile.likes.includes(meta.id) || currentProfile.favorites.includes(meta.id) : kind==='dislike' ? currentProfile.dislikes.includes(meta.id) : kind==='watched' ? currentProfile.watched.includes(meta.id) || currentProfile.started?.includes(meta.id) : currentProfile.saved?.includes(meta.id));button.className='secondary'+(active?' active':'');
        const action=active ? ({like:'unlike',dislike:'undislike',watched:'unwatched',save:'unsave'})[kind] : kind;
        button.addEventListener('click',async()=>{
          button.disabled=true;
          try { const result=await api('/api/interactions',{method:'POST',body:JSON.stringify({mediaId:meta.id,kind:action})});fillProfile(result.profile);await preview();status('Đã cập nhật feed.'); }
          catch(error) { status(error.message);button.disabled=false; }
        });card.append(button);
      }
      cards.append(card);
    }
    $('rows').append(cards);$('more').hidden=data.metas.length<100;skip+=100;
    status('Đã tải catalog. Trong Stremio, các bộ sưu tập hiển thị thành từng hàng.');
  } catch(error) { if(version===previewVersion) status(error.message); }
}
$('preferences').addEventListener('submit',async event=>{
  event.preventDefault();$('save').disabled=true;
  try {
    const body={genres:selected('genres'),favorites:[...favorites],region:$('region').value,platforms:selected('platforms'),preferredOrigins:selected('origins'),preferAnime:$('prefer-anime').checked,syncLibrary:$('sync-library').checked,syncPlayback:$('sync-playback').checked};
    if(!token) body.watched=[...watched];
    if(!body.platforms.length) throw new Error('Chọn ít nhất một nền tảng.');
    if(!token) body.registrationKey=$('invitation').value;
    const data=await api(token ? '/api/profile' : '/api/profiles',{method:token ? 'PUT':'POST',body:JSON.stringify(body)});
    if(data.token) { token=data.token;sessionStorage.setItem('pf-token',token); }
    fillProfile(data.profile);showInstallation();await preview();
  } catch(error) { status(error.message); }
  finally { $('save').disabled=false; }
});
$('copy').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText($('manifest-url').value);status('Đã sao chép manifest URL.'); }
  catch { $('manifest-url').select();status('Sao chép URL trong ô bên trên.'); }
});
$('media-type').addEventListener('change',()=>preview());
$('catalog-choice').addEventListener('change',()=>{$('discover-search').value='';preview();});
$('discover-genre').addEventListener('change',()=>preview());
$('run-search').addEventListener('click',()=>preview());
$('discover-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();preview();}});
$('more').addEventListener('click',()=>preview(true));
$('search').addEventListener('input',()=>{
  clearTimeout(searchTimer);const version=++searchVersion;
  searchTimer=setTimeout(async()=>{
    const query=$('search').value.trim();
    if(query.length<2) { renderFavorites(library.titles);return; }
    try { const data=await api('/api/search?q='+encodeURIComponent(query)+'&region='+$('region').value);if(version===searchVersion) renderFavorites(data.titles); }
    catch(error) { status(error.message); }
  },500);
});
$('favorites').addEventListener('change',async event=>{
  const input=event.target, set=input.dataset.kind==='watched' ? watched : favorites;
  if(input.checked && set.size>=(set===favorites ? 10 : 50) && (!token || set===favorites)) { input.checked=false;status('Đã đạt giới hạn lựa chọn ban đầu.');return; }
  if(set===watched && token) {
    input.disabled=true;
    try {const data=await api('/api/interactions',{method:'POST',body:JSON.stringify({mediaId:input.value,kind:input.checked ? 'watched' : 'unwatched'})});fillProfile(data.profile);status('Đã cập nhật danh sách Đã xem.');}
    catch(error){input.checked=!input.checked;status(error.message);input.disabled=false;}
  } else if(input.checked) set.add(input.value);else set.delete(input.value);
});
(async()=>{
  try {
    library=await api('/api/library');
    $('demo').textContent=library.source==='tmdb' ? 'Nguồn trực tiếp: TMDB. Xu hướng tuần được làm mới tự động; nền tảng được lọc theo khu vực. Phim mới dùng ngày phát hành, không phải ngày được thêm vào nền tảng.' : library.demo ? 'DEMO: dữ liệu mẫu. Các catalog xu hướng/mới để trống. Thêm TMDB token vào máy chủ để bật dữ liệu thật.' : 'Máy chủ chưa có TMDB_READ_ACCESS_TOKEN. Feed trực tiếp chưa sẵn sàng. Chủ server cần cấu hình token rồi khởi động lại.';
    $('storage').textContent=library.storage==='ephemeral' ? 'Dữ liệu trên ổ tạm sẽ mất khi redeploy. Cần ổ bền vững để giữ profile.' : '';
    const regionNames={US:'Hoa Kỳ · thư viện quốc tế',VN:'Việt Nam',KR:'Hàn Quốc',JP:'Nhật Bản',TW:'Đài Loan',HK:'Hồng Kông',SG:'Singapore',GB:'Anh',AU:'Úc',CA:'Canada'};
    const origins={KR:'Hàn Quốc',CN:'Trung Quốc',TW:'Đài Loan',HK:'Hồng Kông',JP:'Nhật Bản',US:'Hoa Kỳ'};
    for(const region of library.regions) { const option=document.createElement('option');option.value=region;option.textContent=regionNames[region] || region;$('region').append(option); }
    $('region').value=library.defaults.region;
    choices('platforms',library.platforms,library.defaults.platforms);choices('origins',library.origins.map(id=>({id,name:origins[id]})),library.defaults.preferredOrigins);
    choices('genres',library.genres.map(id=>({id,name:id})));
    for(const genre of library.genres){const option=document.createElement('option');option.value=genre;option.textContent=genre;$('discover-genre').append(option);}
    for(const catalog of library.catalogs) { const option=document.createElement('option');option.value=catalog.id;option.textContent=catalog.name;$('catalog-choice').append(option); }
    renderFavorites(library.titles);$('invitation-section').hidden=!library.invitationRequired;
    if(token) {
      let data;
      try { data=await api('/api/profile'); }
      catch(error) { if(candidate.length===2) throw error;token=null;sessionStorage.removeItem('pf-token'); }
      if(data) {
        const saved=await api('/api/favorites');for(const title of saved.titles) titles.set(title.id,title);
        fillProfile(data.profile);showInstallation();await preview();
      }
    }
    if(!token) status('Chọn thể loại và phim yêu thích để bắt đầu.');$('save').disabled=false;
  } catch(error) { status(error.message); }
})();
`;
