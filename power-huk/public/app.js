const $ = (selector) => document.querySelector(selector);
const state = {
  user: { id: 'visitor', username: '방문자', role: 'guest' },
  apps: [], posts: [], requests: [], categories: [], page: 'home',
  selectedCategory: '전체', selectedApp: null
};
const labels = { home: '홈', apps: '앱', notice: '공지사항', admin: '관리자 센터' };

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 2800);
}
function date(value) {
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}
function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function statusLabel(status) {
  return ({ pending: '검토 중', approved: '승인됨', rejected: '반려됨' })[status] || '상태 미확인';
}
function applyUser(user) {
  state.user = user || { id: 'visitor', username: '방문자', role: 'guest' };
  $('#sideUsername').textContent = state.user.username;
  $('#topUsername').textContent = state.user.username;
  $('#sideRole').textContent = state.user.role === 'admin' ? '관리자' : '일반 사용자';
  $('#adminNav').classList.toggle('hidden', state.user.role !== 'admin');
  $('#logoutBtn').classList.toggle('hidden', state.user.role !== 'admin');
  $('#adminEntryBtn').classList.toggle('is-admin', state.user.role === 'admin');
  $('#adminEntryBtn span').textContent = state.user.role === 'admin' ? '관리자 센터' : '관리자';
}
async function loadCategories() {
  try { state.categories = await api('/api/categories'); }
  catch { state.categories = ['기타']; }
  const options = state.categories.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
  for (const selector of ['#uploadCategory', '#requestCategory', '#approveCategory']) {
    const el = $(selector);
    if (el) {
      const previous = el.value;
      el.innerHTML = options;
      if (state.categories.includes(previous)) el.value = previous;
    }
  }
  renderCategoryAdmin();
  renderCategoryFilters();
}
function renderCategoryAdmin() {
  const list = $('#categoryList');
  if (!list) return;
  list.innerHTML = state.categories.map(name => `<span class="category-admin-chip">${escapeHTML(name)}</span>`).join('');
}
function appCard(app) {
  const image = app.imageUrl
    ? `<img class="app-card-image" src="${escapeHTML(app.imageUrl)}" alt="${escapeHTML(app.name)} 대표 사진" loading="lazy">`
    : `<div class="app-card-image app-card-placeholder"><span>▦</span></div>`;
  return `<article class="app-card" tabindex="0" role="button" aria-label="${escapeHTML(app.name)} 상세 보기">
    ${image}<div class="app-card-body"><div class="app-card-top"><span class="category-chip">${escapeHTML(app.category || '기타')}</span></div>
    <h3>${escapeHTML(app.name)}</h3><p>${escapeHTML(app.description || '설명이 등록되지 않았습니다.')}</p>
    <div class="launch">상세 정보 보기 →</div></div></article>`;
}
function wireAppCards(container, apps) {
  [...container.children].forEach((element, index) => {
    element.addEventListener('click', () => openAppDetails(apps[index]));
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openAppDetails(apps[index]); }
    });
  });
}
function renderCategoryFilters() {
  const container = $('#categoryFilters');
  if (!container) return;
  const names = ['전체', ...state.categories];
  container.innerHTML = names.map(name => `<button class="category-filter ${state.selectedCategory === name ? 'active' : ''}" data-category="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join('');
  container.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
    state.selectedCategory = button.dataset.category;
    renderCategoryFilters(); renderApps();
  }));
}
async function renderApps() {
  try { state.apps = await api('/api/apps'); }
  catch (error) { toast(error.message); state.apps = []; }
  const visibleApps = state.selectedCategory === '전체'
    ? state.apps : state.apps.filter(app => (app.category || '기타') === state.selectedCategory);
  $('#appCount').textContent = `${visibleApps.length} APPS`;
  $('#appsGrid').innerHTML = visibleApps.map(appCard).join('');
  $('#homeApps').innerHTML = state.apps.slice(0, 4).map(appCard).join('') || '<div class="muted tiny">아직 등록된 앱이 없습니다.</div>';
  wireAppCards($('#appsGrid'), visibleApps);
  wireAppCards($('#homeApps'), state.apps.slice(0, 4));
  $('#emptyApps').classList.toggle('hidden', visibleApps.length > 0);
  if (state.user?.role === 'admin') {
    $('#managedApps').innerHTML = state.apps.map(item => {
      const thumb = item.imageUrl ? `<img class="managed-thumb" src="${escapeHTML(item.imageUrl)}" alt="">` : '<div class="managed-thumb managed-thumb-empty">▦</div>';
      return `<div class="managed-row">${thumb}<div class="managed-info"><b>${escapeHTML(item.name)}</b><small>${escapeHTML(item.category || '기타')} · /${escapeHTML(item.slug || '')} · ${escapeHTML(item.description || '설명 없음')}</small></div><a class="text-btn" href="/${encodeURIComponent(item.slug || '')}" target="_blank" rel="noopener">열기 ↗</a><button class="danger-btn" data-delete-app="${escapeHTML(item.id)}">삭제</button></div>`;
    }).join('') || '<p class="muted tiny">등록된 앱이 없습니다.</p>';
    document.querySelectorAll('[data-delete-app]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('이 앱과 대표 사진을 삭제할까요?')) return;
      try { await api(`/api/apps/${encodeURIComponent(button.dataset.deleteApp)}`, { method: 'DELETE' }); toast('앱을 삭제했습니다.'); await renderApps(); }
      catch (error) { toast(error.message); }
    }));
  }
}
function openAppDetails(app) {
  if (!app) return;
  state.selectedApp = app;
  $('#appDetailName').textContent = app.name;
  $('#appDetailDescription').textContent = app.description || '등록된 설명이 없습니다.';
  $('#appDetailCategory').textContent = app.category || '기타';
  $('#appDetailUrl').textContent = `powerhuk.com/${app.slug}`;
  const image = $('#appDetailImage'), fallback = $('#appDetailFallback');
  if (app.imageUrl) {
    image.src = app.imageUrl; image.alt = `${app.name} 대표 사진`; image.classList.remove('hidden'); fallback.classList.add('hidden');
  } else {
    image.removeAttribute('src'); image.classList.add('hidden'); fallback.classList.remove('hidden');
  }
  $('#appDetailModal').classList.remove('hidden');
}
function closeAppDetails() {
  $('#appDetailModal').classList.add('hidden'); state.selectedApp = null;
}
function showPage(page) {
  if (page === 'admin' && state.user?.role !== 'admin') return;
  state.page = page;
  document.querySelectorAll('.page').forEach(element => element.classList.add('hidden'));
  $(`#page-${page}`)?.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(element => element.classList.toggle('active', element.dataset.page === page));
  $('#pageCrumb').textContent = labels[page] || page;
  if (page === 'apps' || page === 'home' || page === 'admin') { renderApps(); renderAppRequests(); }
  if (page === 'notice' || page === 'home') renderPosts();
  if (page === 'admin') loadCategories();
}
async function renderPosts() {
  try { state.posts = await api('/api/posts'); } catch { state.posts = []; }
  const notices = state.posts.filter(post => post.category === 'notice');
  const noticeList = $('#noticeList');
  if (noticeList) noticeList.innerHTML = notices.map(postCard).join('');
  $('#homeNotices').innerHTML = notices.slice(0, 3).map(post => `<div class="mini-item"><b>${escapeHTML(post.title)}</b><small>${date(post.createdAt)}</small></div>`).join('') || '<p class="muted tiny">새로운 공지가 없습니다.</p>';
  $('#emptyNotices')?.classList.toggle('hidden', notices.length > 0);
  document.querySelectorAll('[data-delete-post]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('공지사항을 삭제할까요?')) return;
    try { await api(`/api/posts/${button.dataset.deletePost}`, { method: 'DELETE' }); toast('공지사항을 삭제했습니다.'); await renderPosts(); }
    catch (error) { toast(error.message); }
  }));
}
function postCard(post) {
  const canDelete = Boolean(post.canDelete) || state.user?.role === 'admin';
  return `<article class="post-card"><div class="post-top"><span class="post-tag notice">공지</span><span class="post-date">${date(post.createdAt)}</span></div><h3>${escapeHTML(post.title)}</h3><div class="post-content">${escapeHTML(post.content)}</div><div class="post-bottom"><span>${escapeHTML(post.author)}</span>${canDelete ? `<button class="delete-link" data-delete-post="${post.id}">삭제</button>` : ''}</div></article>`;
}
function switchAppTab(tab) {
  const isRequests = tab === 'requests';
  $('#appLibraryPane')?.classList.toggle('hidden', isRequests);
  $('#appRequestsPane')?.classList.toggle('hidden', !isRequests);
  document.querySelectorAll('[data-app-tab]').forEach(button => button.classList.toggle('active', button.dataset.appTab === tab));
  if (isRequests) renderAppRequests();
}
function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function requestCardHTML(request, isAdmin) {
  const metaParts = [];
  if (request.hasFile) {
    metaParts.push('📎 HTML 파일 첨부됨');
  } else {
    metaParts.push('📝 글/텍스트 요청');
  }
  if (request.requestedCategory) metaParts.push(`희망 카테고리: ${escapeHTML(request.requestedCategory)}`);
  if (isAdmin && request.requester) metaParts.push(`요청자: ${escapeHTML(request.requester)}`);

  const previewBtn = (isAdmin && request.hasFile)
    ? `<div style="display:inline-flex;gap:6px;align-items:center;"><a class="secondary-btn small-primary preview-download-link" href="/api/app-requests/${request.id}/download" target="_blank" download title="HTML 파일 다운로드">다운로드 ⬇</a><button class="request-preview-btn" data-preview-request="${request.id}" data-preview-title="${escapeHTML(request.title)}">테스트 미리보기 ▶</button></div>` : '';

  const actions = (isAdmin && request.status === 'pending')
    ? `<div class="request-actions"><button class="primary small-primary" data-approve-request="${request.id}">승인 및 앱 등록</button><button class="danger-btn" data-reject-request="${request.id}">반려</button></div>`
    : (request.status === 'approved' && request.appSlug)
      ? `<div class="request-meta approved-path">등록 주소: <a class="text-btn" href="/${encodeURIComponent(request.appSlug)}" target="_blank" rel="noopener">/${escapeHTML(request.appSlug)} ↗</a></div>`
      : '';

  const imageThumb = request.imageUrl
    ? `<img class="request-thumb" src="${escapeHTML(request.imageUrl)}" alt="${escapeHTML(request.title)} 참고 이미지" loading="lazy">`
    : '';

  return `<article class="request-card ${isAdmin ? 'admin-request-card' : ''}">
    <div class="request-card-head">
      <div>
        <span class="request-status ${request.status}">${statusLabel(request.status)}</span>
        <span class="post-date">${date(request.createdAt)}${isAdmin ? ` · ${escapeHTML(request.requester || '방문자')}` : ''}</span>
      </div>
      <div>
        ${previewBtn}
        ${request.status === 'approved' && request.appSlug ? `<a class="text-btn" href="/${encodeURIComponent(request.appSlug)}" target="_blank" rel="noopener">앱 열기 ↗</a>` : ''}
      </div>
    </div>
    <div class="request-card-content-wrap">
      ${imageThumb}
      <div class="request-card-main">
        <h3>${escapeHTML(request.title)}</h3>
        ${request.description ? `<p>${escapeHTML(request.description)}</p>` : ''}
        <div class="request-meta">${metaParts.join(' · ')}</div>
      </div>
    </div>
    ${actions}
  </article>`;
}

async function renderAppRequests() {
  try { state.requests = await api('/api/app-requests'); } catch { state.requests = []; }
  const isAdmin = state.user?.role === 'admin';
  const publicList = $('#publicAppRequests');
  if (publicList) {
    publicList.innerHTML = state.requests.map(req => requestCardHTML(req, isAdmin)).join('');
    $('#emptyAppRequests').classList.toggle('hidden', state.requests.length > 0);
  }
  if (isAdmin && $('#adminAppRequests')) {
    const pending = state.requests.filter(request => request.status === 'pending');
    $('#pendingRequestCount').textContent = `${pending.length} PENDING`;
    $('#adminAppRequests').innerHTML = state.requests.map(req => requestCardHTML(req, true)).join('') || '<div class="empty-inline">접수된 요청사항이 없습니다.</div>';
  }

  // Bind actions for all rendered request cards
  document.querySelectorAll('[data-preview-request]').forEach(button => {
    button.onclick = () => openPreviewRequest(Number(button.dataset.previewRequest), button.dataset.previewTitle);
  });
  document.querySelectorAll('[data-approve-request]').forEach(button => {
    button.onclick = () => openApproveRequest(Number(button.dataset.approveRequest));
  });
  document.querySelectorAll('[data-reject-request]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('이 요청사항을 반려할까요?')) return;
      try {
        await api(`/api/app-requests/${button.dataset.rejectRequest}/reject`, { method: 'POST' });
        toast('요청사항을 반려했습니다.');
        await renderAppRequests();
      } catch (error) { toast(error.message); }
    };
  });
}
function openRequestModal() {
  $('#requestForm').reset(); $('#requestMessage').textContent = '';
  $('#requestModal').classList.remove('hidden');
}
function closeRequestModal() { $('#requestModal').classList.add('hidden'); }
function openPreviewRequest(id, title) {
  state.currentPreviewRequestId = id;
  const request = state.requests.find(r => r.id === id);
  const isPending = request && request.status === 'pending';
  $('#previewRequestTitle').textContent = `${title || '앱'} (테스트 화면)`;
  $('#previewApproveBtn').classList.toggle('hidden', !isPending);
  $('#previewRejectBtn').classList.toggle('hidden', !isPending);
  $('#previewDownloadBtn').href = `/api/app-requests/${encodeURIComponent(id)}/download`;
  $('#previewRequestFrame').src = `/api/app-requests/${encodeURIComponent(id)}/preview`;
  $('#previewRequestModal').classList.remove('hidden');
}
function closePreviewRequest() {
  $('#previewRequestModal').classList.add('hidden');
  $('#previewRequestFrame').src = 'about:blank';
  $('#previewDownloadBtn').href = '#';
  state.currentPreviewRequestId = null;
}
function openApproveRequest(id) {
  const request = state.requests.find(item => item.id === id);
  if (!request) return;
  const form = $('#approveRequestForm'); form.reset();
  form.elements.requestId.value = String(id);
  form.elements.name.value = request.title || '';
  form.elements.description.value = request.description || '';
  const suggestedSlug = slugify(request.title);
  form.elements.slug.value = suggestedSlug ? `/${suggestedSlug}` : '';
  $('#approveRequestSummary').textContent = `요청: ${request.title}`;
  if (request.requestedCategory && state.categories.includes(request.requestedCategory)) $('#approveCategory').value = request.requestedCategory;

  // Set help texts and HTML required state
  if (request.hasFile) {
    $('#approveHtmlHelp').textContent = '.html · 비워두면 요청자가 올린 HTML 사용';
    form.elements.app.required = false;
  } else {
    $('#approveHtmlHelp').textContent = '.html · 요청에 HTML이 없으므로 등록할 파일을 선택해 주세요 (필수)';
    form.elements.app.required = true;
  }
  if (request.imageUrl) {
    $('#approveImageHelp').textContent = 'PNG · JPG · WEBP · GIF · 비워두면 요청 시 첨부된 이미지 사용';
  } else {
    $('#approveImageHelp').textContent = 'PNG · JPG · WEBP · GIF · 최대 4MB';
  }

  $('#approveMessage').textContent = '';
  $('#approveRequestModal').classList.remove('hidden');
}
function closeApproveRequest() { $('#approveRequestModal').classList.add('hidden'); }
function openAdminLogin() {
  if (state.user.role === 'admin') { showPage('admin'); return; }
  $('#loginForm').reset(); $('#loginError').textContent = '';
  $('#adminLoginModal').classList.remove('hidden');
}
function closeAdminLogin() { $('#adminLoginModal').classList.add('hidden'); }

// Main navigation and tabs
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.goto)));
document.querySelectorAll('[data-app-tab]').forEach(button => button.addEventListener('click', () => switchAppTab(button.dataset.appTab)));
$('#adminEntryBtn').addEventListener('click', openAdminLogin);
$('#closeAdminLogin').addEventListener('click', closeAdminLogin);
$('#adminLoginModal').addEventListener('click', event => { if (event.target.id === 'adminLoginModal') closeAdminLogin(); });
$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#loginError').textContent = '';
  const form = event.currentTarget, body = Object.fromEntries(new FormData(form));
  try {
    const data = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    applyUser(data.user); closeAdminLogin(); toast('관리자로 로그인했습니다.'); showPage('admin');
  } catch (error) { $('#loginError').textContent = error.message; }
});
$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); }
  catch (error) { toast(error.message); return; }
  applyUser({ id: 'visitor', username: '방문자', role: 'guest' }); toast('관리자 로그아웃 완료'); showPage('home');
});

// App detail overlay
$('#closeAppDetail').addEventListener('click', closeAppDetails);
$('#appDetailModal').addEventListener('click', event => { if (event.target.id === 'appDetailModal') closeAppDetails(); });
$('#openSelectedApp').addEventListener('click', () => {
  if (!state.selectedApp?.slug) return;
  window.location.assign(`/${encodeURIComponent(state.selectedApp.slug)}`);
});

// App requests
$('#requestAppBtn')?.addEventListener('click', openRequestModal);
$('#requestAppBtnInline')?.addEventListener('click', openRequestModal);
$('#closeRequestModal').addEventListener('click', closeRequestModal);
$('#requestModal').addEventListener('click', event => { if (event.target.id === 'requestModal') closeRequestModal(); });
$('#requestForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  $('#requestMessage').textContent = '요청 등록 중...';
  try {
    await api('/api/app-requests', { method: 'POST', body: new FormData(form) });
    closeRequestModal();
    toast('요청사항을 등록했습니다.');
    switchAppTab('requests');
    await renderAppRequests();
  } catch (error) { $('#requestMessage').textContent = error.message; }
});

// Admin app and category management
$('#uploadForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  $('#uploadMessage').textContent = '업로드 중...';
  try {
    const data = await api('/api/apps', { method: 'POST', body: new FormData(form) });
    $('#uploadMessage').textContent = `${data.name} 앱을 등록했습니다. 주소: ${data.url}`;
    form.reset(); await loadCategories(); await renderApps();
  } catch (error) { $('#uploadMessage').textContent = error.message; }
});
$('#noticeForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, body = Object.fromEntries(new FormData(form)); body.category = 'notice';
  try {
    await api('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    $('#noticeMessage').textContent = '공지사항을 등록했습니다.'; form.reset(); await renderPosts();
  } catch (error) { $('#noticeMessage').textContent = error.message; }
});
$('#categoryForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, body = Object.fromEntries(new FormData(form));
  try { await api('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); form.reset(); await loadCategories(); toast('카테고리를 추가했습니다.'); }
  catch (error) { toast(error.message); }
});
$('#closeApproveModal').addEventListener('click', closeApproveRequest);
$('#approveRequestModal').addEventListener('click', event => { if (event.target.id === 'approveRequestModal') closeApproveRequest(); });
$('#closePreviewModal').addEventListener('click', closePreviewRequest);
$('#previewRequestModal').addEventListener('click', event => { if (event.target.id === 'previewRequestModal') closePreviewRequest(); });
$('#previewApproveBtn').addEventListener('click', () => {
  const id = state.currentPreviewRequestId;
  closePreviewRequest();
  if (id) openApproveRequest(id);
});
$('#previewRejectBtn').addEventListener('click', async () => {
  const id = state.currentPreviewRequestId;
  if (!id) return;
  if (!confirm('이 앱 요청을 반려할까요?')) return;
  try {
    await api(`/api/app-requests/${id}/reject`, { method: 'POST' });
    toast('앱 요청을 반려했습니다.');
    closePreviewRequest();
    await renderAppRequests();
  } catch (error) { toast(error.message); }
});
$('#approveRequestForm').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, requestId = form.elements.requestId.value;
  $('#approveMessage').textContent = '앱 등록 및 승인 중...';
  try {
    const result = await api(`/api/app-requests/${encodeURIComponent(requestId)}/approve`, { method: 'POST', body: new FormData(form) });
    closeApproveRequest(); toast(`앱을 승인하고 /${result.app.slug}에 등록했습니다.`);
    await loadCategories(); await renderApps(); await renderAppRequests();
  } catch (error) { $('#approveMessage').textContent = error.message; }
});

// Keyboard and initial state
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeAppDetails(); closeRequestModal(); closeApproveRequest(); closeAdminLogin(); closePreviewRequest();
    $('#postModal').classList.add('hidden');
  }
});
api('/api/me').then(async data => {
  applyUser(data.user);
  await loadCategories();
  const requestedPage = new URLSearchParams(window.location.search).get('page');
  showPage(['home', 'apps', 'notice', 'admin'].includes(requestedPage) ? requestedPage : 'home');
}).catch(() => {
  applyUser({ id: 'visitor', username: '방문자', role: 'guest' });
  showPage('home');
});
