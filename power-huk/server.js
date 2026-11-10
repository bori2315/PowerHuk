require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
for (const dir of [DATA, UPLOADS]) fs.mkdirSync(dir, { recursive: true });

const DEFAULT_CATEGORIES = ['도구', '생산성', '게임', '엔터테인먼트', '기타'];
const DB_FILE = path.join(DATA, 'db.json');
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function slugify(value) {
  return String(value || '').normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const adminPassword = process.env.ADMIN_PASSWORD || '123';
    writeDB({
      users: [{ id: 'admin', username: process.env.ADMIN_USERNAME || 'admin',
        passwordHash: bcrypt.hashSync(adminPassword, 10), role: 'admin' }],
      apps: [], posts: [], appRequests: [], categories: DEFAULT_CATEGORIES,
      nextPostId: 1, nextAppRequestId: 1
    });
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  let changed = false;
  db.users = Array.isArray(db.users) ? db.users : [];
  db.apps = Array.isArray(db.apps) ? db.apps : [];
  db.posts = Array.isArray(db.posts) ? db.posts : [];
  db.appRequests = Array.isArray(db.appRequests) ? db.appRequests : [];
  if (!Array.isArray(db.categories) || !db.categories.length) { db.categories = DEFAULT_CATEGORIES.slice(); changed = true; }
  if (!Number.isInteger(db.nextPostId)) { db.nextPostId = db.posts.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1; changed = true; }
  if (!Number.isInteger(db.nextAppRequestId)) { db.nextAppRequestId = db.appRequests.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1; changed = true; }
  const usedSlugs = new Set();
  for (const item of db.apps) {
    if (!item.slug) {
      const base = slugify(item.name || 'app') || `app-${String(item.id || crypto.randomUUID()).slice(0, 8)}`;
      let candidate = base, suffix = 2;
      while (usedSlugs.has(candidate) || isReservedSlug(candidate)) candidate = `${base}-${suffix++}`;
      item.slug = candidate; changed = true;
    }
    if (!item.category) { item.category = '기타'; changed = true; }
    usedSlugs.add(item.slug);
  }
  if (changed) writeDB(db);
  return db;
}
function isReservedSlug(slug) {
  return ['api', 'app-file', 'app-image', 'styles.css', 'app.js', 'admin-avatar.png', 'favicon.ico'].includes(slug);
}
function createUniqueSlug(db, requested, name) {
  let base;
  if (requested && String(requested).trim()) {
    base = String(requested).trim().toLowerCase().replace(/^\/+/, '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(base) || base.length > 40)
      throw new Error('앱 주소는 영문 소문자, 숫자, 하이픈만 사용해 주세요. (예: /my-app)');
  } else {
    base = slugify(name) || `app-${crypto.randomBytes(3).toString('hex')}`;
  }
  if (isReservedSlug(base)) throw new Error('해당 앱 주소는 사용할 수 없습니다. 다른 주소를 입력해 주세요.');
  const used = new Set(db.apps.map(item => item.slug).filter(Boolean));
  let candidate = base, suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}
readDB();

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'], frameSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'self'"], upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  name: 'powerhuk.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use((req, _res, next) => {
  if (!req.session.visitorId) req.session.visitorId = crypto.randomUUID();
  next();
});
app.use(express.static(path.join(ROOT, 'public')));

const imageExtensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const appUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (file.fieldname === 'app' ? '.html' : imageExtensions[file.mimetype]))
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'app') {
      const ok = path.extname(file.originalname).toLowerCase() === '.html' && ['text/html', 'application/octet-stream'].includes(file.mimetype);
      return cb(ok ? null : new Error('HTML 파일만 업로드할 수 있습니다.'), ok);
    }
    if (file.fieldname === 'image') {
      const ok = Boolean(imageExtensions[file.mimetype]) && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(file.originalname).toLowerCase());
      return cb(ok ? null : new Error('앱 사진은 PNG, JPG, WEBP, GIF만 사용할 수 있습니다.'), ok);
    }
    cb(new Error('지원하지 않는 파일 항목입니다.'));
  }
}).fields([{ name: 'app', maxCount: 1 }, { name: 'image', maxCount: 1 }]);
function cleanupUploaded(req) {
  for (const files of Object.values(req.files || {})) for (const file of files) {
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {}
  }
}
function receiveAppFiles(req, res, next) {
  appUpload(req, res, error => {
    if (error) { cleanupUploaded(req); return res.status(400).json({ error: error.message || '파일 업로드에 실패했습니다.' }); }
    next();
  });
}
function currentUser(req) {
  if (req.session.userId) {
    const admin = readDB().users.find(u => u.id === req.session.userId && u.role === 'admin');
    if (admin) return admin;
  }
  return { id: req.session.visitorId || 'visitor', username: '방문자', role: 'guest' };
}
function requireLogin(_req, _res, next) { next(); }
function requireAdmin(req, res, next) {
  if (currentUser(req).role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  next();
}
function safeUser(user) { return { id: user.id, username: user.username, role: user.role }; }
function publicApp(item) {
  return {
    id: item.id, name: item.name, description: item.description, filename: item.filename,
    createdAt: item.createdAt, slug: item.slug, category: item.category || '기타',
    imageUrl: item.imageFilename ? `/app-image/${encodeURIComponent(path.basename(item.imageFilename))}` : null
  };
}
function categoryExists(db, value) { return db.categories.includes(String(value || '').trim()); }
function validateAppFiles(req, res) {
  const htmlFile = req.files?.app?.[0];
  const imageFile = req.files?.image?.[0];
  if (!htmlFile) { cleanupUploaded(req); res.status(400).json({ error: 'HTML 파일을 선택해 주세요.' }); return false; }
  if (htmlFile.size > 2 * 1024 * 1024) { cleanupUploaded(req); res.status(400).json({ error: 'HTML 파일은 최대 2MB까지 업로드할 수 있습니다.' }); return false; }
  if (imageFile && imageFile.size > 4 * 1024 * 1024) { cleanupUploaded(req); res.status(400).json({ error: '앱 사진은 최대 4MB까지 업로드할 수 있습니다.' }); return false; }
  return true;
}
function removeAppFiles(item) {
  for (const filename of [item.filename, item.imageFilename]) {
    if (!filename) continue;
    const file = path.join(UPLOADS, path.basename(filename));
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
}

app.get('/api/me', (req, res) => res.json({ user: safeUser(currentUser(req)) }));
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 40 || password.length > 200)
    return res.status(400).json({ error: '아이디와 비밀번호를 확인해 주세요.' });
  const db = readDB();
  const configuredName = process.env.ADMIN_USERNAME || 'admin';
  const configuredPassword = process.env.ADMIN_PASSWORD || '123';
  let user = db.users.find(u => u.role === 'admin' && u.username.toLowerCase() === username.toLowerCase());
  let valid = Boolean(user && bcrypt.compareSync(password, user.passwordHash));
  if (!valid && username.toLowerCase() === configuredName.toLowerCase() && password === configuredPassword) {
    user = db.users.find(u => u.role === 'admin') || { id: crypto.randomUUID(), username: configuredName, role: 'admin', passwordHash: '' };
    user.username = configuredName; user.passwordHash = bcrypt.hashSync(configuredPassword, 10);
    if (!db.users.some(u => u.id === user.id)) db.users.push(user);
    writeDB(db); valid = true;
  }
  if (!valid || !user) return res.status(401).json({ error: '관리자 아이디 또는 비밀번호가 올바르지 않습니다.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: '관리자 로그인 처리에 실패했습니다.' });
    req.session.userId = user.id; req.session.visitorId = crypto.randomUUID();
    res.json({ user: safeUser(user) });
  });
});
app.post('/api/logout', requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/categories', requireLogin, (_req, res) => res.json(readDB().categories));
app.post('/api/categories', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 30) return res.status(400).json({ error: '카테고리 이름은 1~30자로 입력해 주세요.' });
  const db = readDB();
  if (db.categories.some(item => item.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: '이미 존재하는 카테고리입니다.' });
  db.categories.push(name); writeDB(db); res.json({ categories: db.categories });
});

app.get('/api/apps', requireLogin, (_req, res) => res.json(readDB().apps.map(publicApp)));
app.post('/api/apps', requireAdmin, receiveAppFiles, (req, res) => {
  if (!validateAppFiles(req, res)) return;
  const name = String(req.body.name || '').trim().slice(0, 60);
  const description = String(req.body.description || '').trim().slice(0, 180);
  if (!name) { cleanupUploaded(req); return res.status(400).json({ error: '앱 이름을 입력해 주세요.' }); }
  const db = readDB();
  const category = String(req.body.category || '기타').trim();
  if (!categoryExists(db, category)) { cleanupUploaded(req); return res.status(400).json({ error: '목록에 있는 카테고리를 선택해 주세요.' }); }
  let slug;
  try { slug = createUniqueSlug(db, req.body.slug, name); }
  catch (error) { cleanupUploaded(req); return res.status(400).json({ error: error.message }); }
  const htmlFile = req.files.app[0], imageFile = req.files.image?.[0];
  const item = { id: crypto.randomUUID(), name, description, category, slug,
    filename: htmlFile.filename, imageFilename: imageFile?.filename || null, createdAt: new Date().toISOString() };
  db.apps.unshift(item); writeDB(db);
  res.json({ ...publicApp(item), url: `/${item.slug}` });
});
app.delete('/api/apps/:id', requireAdmin, (req, res) => {
  const db = readDB(), index = db.apps.findIndex(a => a.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
  const [item] = db.apps.splice(index, 1); removeAppFiles(item); writeDB(db); res.json({ ok: true });
});
app.get('/app-image/:filename', requireLogin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const db = readDB();
  const inApps = db.apps.some(a => a.imageFilename && path.basename(a.imageFilename) === filename);
  const inReqs = db.appRequests.some(r => r.imageFilename && path.basename(r.imageFilename) === filename);
  if (!inApps && !inReqs) return res.status(404).send('이미지를 찾을 수 없습니다.');
  const file = path.join(UPLOADS, filename);
  if (!fs.existsSync(file)) return res.status(404).send('이미지를 찾을 수 없습니다.');
  const ext = path.extname(filename).toLowerCase();
  const type = ({ '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' })[ext];
  res.set({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
  res.sendFile(file);
});
app.get('/app-file/:id', requireLogin, (req, res) => {
  const item = readDB().apps.find(a => a.id === req.params.id);
  if (!item) return res.status(404).send('앱을 찾을 수 없습니다.');
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
  });
  res.sendFile(path.join(UPLOADS, path.basename(item.filename)));
});

// Requests: text, optional image, optional HTML file. Only visible to the writer (session) and admin.
const requestUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const ext = file.fieldname === 'appFile' ? '.html' : (imageExtensions[file.mimetype] || path.extname(file.originalname).toLowerCase());
      cb(null, 'req-' + crypto.randomUUID() + ext);
    }
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'appFile') {
      const ok = path.extname(file.originalname).toLowerCase() === '.html' && ['text/html', 'application/octet-stream'].includes(file.mimetype);
      return cb(ok ? null : new Error('앱 파일은 HTML 파일만 업로드할 수 있습니다.'), ok);
    }
    if (file.fieldname === 'imageFile') {
      const ok = Boolean(imageExtensions[file.mimetype]) && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(file.originalname).toLowerCase());
      return cb(ok ? null : new Error('이미지는 PNG, JPG, WEBP, GIF만 업로드할 수 있습니다.'), ok);
    }
    cb(new Error('지원하지 않는 파일 항목입니다.'));
  }
}).fields([{ name: 'appFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]);

function receiveRequestFile(req, res, next) {
  requestUpload(req, res, error => {
    if (error) { cleanupUploaded(req); return res.status(400).json({ error: error.message || '파일 업로드에 실패했습니다.' }); }
    next();
  });
}

app.get('/api/app-requests', requireLogin, (req, res) => {
  const user = currentUser(req);
  const isAdmin = user.role === 'admin';
  const all = readDB().appRequests.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  // Only show requests to the writer (same session) and admin
  const visible = all.filter(item => isAdmin || (item.requesterSessionId && item.requesterSessionId === req.sessionID));
  res.json(visible.map(item => ({ id: item.id, title: item.title, description: item.description,
    requestedCategory: item.requestedCategory || '', status: item.status, requester: item.requester,
    hasFile: Boolean(item.htmlFilename),
    imageUrl: item.imageFilename ? `/app-image/${encodeURIComponent(path.basename(item.imageFilename))}` : null,
    createdAt: item.createdAt, processedAt: item.processedAt || null, appSlug: item.appSlug || null })));
});
// Serve the uploaded request HTML for admin preview
app.get('/api/app-requests/:id/preview', requireAdmin, (req, res) => {
  const item = readDB().appRequests.find(r => r.id === Number(req.params.id));
  if (!item || !item.htmlFilename) return res.status(404).send('HTML 파일이 첨부되지 않은 요청입니다.');
  const file = path.join(UPLOADS, path.basename(item.htmlFilename));
  if (!fs.existsSync(file)) return res.status(404).send('파일을 찾을 수 없습니다.');
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
  });
  res.sendFile(file);
});
// Download uploaded HTML file for admin testing
app.get('/api/app-requests/:id/download', requireAdmin, (req, res) => {
  const item = readDB().appRequests.find(r => r.id === Number(req.params.id));
  if (!item || !item.htmlFilename) return res.status(404).send('HTML 파일이 첨부되지 않은 요청입니다.');
  const file = path.join(UPLOADS, path.basename(item.htmlFilename));
  if (!fs.existsSync(file)) return res.status(404).send('파일을 찾을 수 없습니다.');
  const downloadName = (slugify(item.title) || 'app') + '.html';
  res.download(file, downloadName);
});
app.post('/api/app-requests', requireLogin, receiveRequestFile, (req, res) => {
  const appFile = req.files?.appFile?.[0];
  const imageFile = req.files?.imageFile?.[0];
  const title = String(req.body?.title || '').trim(), description = String(req.body?.description || '').trim();
  const requestedCategory = String(req.body?.category || '').trim().slice(0, 30);
  if (!title && !description) {
    cleanupUploaded(req);
    return res.status(400).json({ error: '제목 또는 요청 내용을 입력해 주세요.' });
  }
  if (title.length > 100) {
    cleanupUploaded(req);
    return res.status(400).json({ error: '제목은 100자 이내로 입력해 주세요.' });
  }
  if (description.length > 2000) {
    cleanupUploaded(req);
    return res.status(400).json({ error: '요청 설명은 2000자 이내로 입력해 주세요.' });
  }
  const db = readDB();
  const item = { id: db.nextAppRequestId++,
    title: title || (description.length > 30 ? description.slice(0, 30) + '...' : description),
    description, requestedCategory,
    htmlFilename: appFile ? appFile.filename : null,
    imageFilename: imageFile ? imageFile.filename : null,
    status: 'pending', requester: currentUser(req).role === 'admin' ? currentUser(req).username : '방문자',
    requesterSessionId: req.sessionID, createdAt: new Date().toISOString() };
  db.appRequests.push(item); writeDB(db); res.json({ id: item.id, status: item.status });
});
app.post('/api/app-requests/:id/reject', requireAdmin, (req, res) => {
  const db = readDB(), item = db.appRequests.find(r => r.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: '요청사항을 찾을 수 없습니다.' });
  if (item.status !== 'pending') return res.status(409).json({ error: '이미 처리된 요청입니다.' });
  item.status = 'rejected'; item.processedAt = new Date().toISOString();
  writeDB(db); res.json({ ok: true });
});
// Approve: admin sets name, description, slug, category. The request's uploaded HTML becomes the app file.
app.post('/api/app-requests/:id/approve', requireAdmin, receiveAppFiles, (req, res) => {
  const db = readDB(), request = db.appRequests.find(r => r.id === Number(req.params.id));
  if (!request) { cleanupUploaded(req); return res.status(404).json({ error: '요청사항을 찾을 수 없습니다.' }); }
  if (request.status !== 'pending') { cleanupUploaded(req); return res.status(409).json({ error: '이미 처리된 요청입니다.' }); }
  const name = String(req.body.name || request.title).trim().slice(0, 60);
  const description = String(req.body.description || request.description || '').trim().slice(0, 180);
  if (!name) { cleanupUploaded(req); return res.status(400).json({ error: '앱 이름을 입력해 주세요.' }); }
  const category = String(req.body.category || '').trim();
  if (!categoryExists(db, category)) { cleanupUploaded(req); return res.status(400).json({ error: '앱을 추가할 카테고리를 선택해 주세요.' }); }
  let slug;
  try { slug = createUniqueSlug(db, req.body.slug, name); }
  catch (error) { cleanupUploaded(req); return res.status(400).json({ error: error.message }); }
  // Use newly uploaded HTML if provided, otherwise use the request's original HTML
  let htmlFilename;
  const newHtml = req.files?.app?.[0];
  if (newHtml) {
    htmlFilename = newHtml.filename;
  } else if (request.htmlFilename) {
    htmlFilename = request.htmlFilename;
  } else {
    cleanupUploaded(req); return res.status(400).json({ error: '등록할 HTML 파일을 선택해 주세요.' });
  }
  const imageFile = req.files?.image?.[0];
  const finalImageFilename = imageFile?.filename || request.imageFilename || null;
  const appItem = { id: crypto.randomUUID(), name, description,
    category, slug, filename: htmlFilename, imageFilename: finalImageFilename, createdAt: new Date().toISOString() };
  db.apps.unshift(appItem);

  // If a replacement HTML was uploaded, remove the old request file
  if (newHtml && request.htmlFilename && request.htmlFilename !== newHtml.filename) {
    const oldFile = path.join(UPLOADS, path.basename(request.htmlFilename));
    try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {}
  }

  // Remove the approved request from db.appRequests
  const reqIndex = db.appRequests.findIndex(r => r.id === Number(req.params.id));
  if (reqIndex >= 0) db.appRequests.splice(reqIndex, 1);

  writeDB(db); res.json({ app: publicApp(appItem), url: `/${slug}` });
});

app.get('/api/posts', requireLogin, (req, res) => {
  const db = readDB(), user = currentUser(req);
  const posts = db.posts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(posts.map(p => ({ id: p.id, title: p.title, content: p.content, category: p.category,
    author: p.author, createdAt: p.createdAt,
    canDelete: user.role === 'admin' || Boolean(p.authorSessionId && p.authorSessionId === req.sessionID) })));
});
app.post('/api/posts', requireLogin, (req, res) => {
  const user = currentUser(req), { title, content, category } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 100 || typeof content !== 'string' || !content.trim() || content.length > 5000)
    return res.status(400).json({ error: '제목(100자 이내)과 내용(5000자 이내)을 입력해 주세요.' });
  const db = readDB();
  const post = { id: db.nextPostId++, title: title.trim(), content: content.trim(),
    category: user.role === 'admin' && category === 'notice' ? 'notice' : 'free',
    author: user.role === 'admin' ? user.username : '방문자', authorSessionId: req.sessionID, createdAt: new Date().toISOString() };
  db.posts.push(post); writeDB(db); res.json({ id: post.id });
});
app.delete('/api/posts/:id', requireLogin, (req, res) => {
  const db = readDB(), user = currentUser(req), index = db.posts.findIndex(p => p.id === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
  if (user.role !== 'admin' && (!db.posts[index].authorSessionId || db.posts[index].authorSessionId !== req.sessionID))
    return res.status(403).json({ error: '본인이 작성한 글만 삭제할 수 있습니다.' });
  db.posts.splice(index, 1); writeDB(db); res.json({ ok: true });
});

// App URL route: /calculator, /notepad, etc.
app.get('/:slug', requireLogin, (req, res, next) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return next();
  const item = readDB().apps.find(record => record.slug === slug);
  if (!item) return next();
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const title = escape(item.name), appId = encodeURIComponent(item.id);
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.type('html').send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f3f6fb"><title>${title} | Power Huk</title>
<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f4f7fc;font-family:Segoe UI,Malgun Gothic,sans-serif}iframe{display:block;border:0;width:100%;height:100%;background:#fff}.back{position:fixed;z-index:5;top:12px;left:12px;padding:9px 13px;border-radius:12px;background:#ffffffdc;color:#34435b;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 4px 20px #182b4a22;backdrop-filter:blur(14px);opacity:.18;transition:opacity .15s}.back:hover,.back:focus{opacity:1}</style></head><body><a class="back" href="/?page=apps" aria-label="Power Huk 앱 목록으로 돌아가기">← Power Huk</a><iframe title="${title}" src="/app-file/${appId}" sandbox="allow-scripts allow-forms allow-downloads allow-modals" referrerpolicy="no-referrer" allow="fullscreen"></iframe></body></html>`);
});

app.use((err, _req, res, _next) => { console.error(err.message); res.status(400).json({ error: err.message || '요청을 처리하지 못했습니다.' }); });
app.listen(PORT, () => console.log(`Power Huk running at http://localhost:${PORT}`));
