const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { initPresence } = require('./presence');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const stmt = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'),
  sessionByToken: db.prepare('SELECT s.token, s.user_id, u.username, u.wallet FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  setWallet: db.prepare('UPDATE users SET wallet = ? WHERE id = ?'),
  upsertSave: db.prepare(`INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?)
                          ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
  getSave: db.prepare('SELECT data FROM saves WHERE user_id = ?'),
  addPoints: db.prepare('UPDATE users SET total_points = total_points + ? WHERE id = ?'),
  bestCycle: db.prepare('UPDATE users SET best_cycle_pts = MAX(best_cycle_pts, ?) WHERE id = ?'),
  leaderboard: db.prepare('SELECT username, wallet, total_points, best_cycle_pts FROM users ORDER BY total_points DESC, username ASC LIMIT 50')
};

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const sess = stmt.sessionByToken.get(token);
  if (!sess) return res.status(401).json({ error: 'Session expired — log in again' });
  req.user = { id: sess.user_id, username: sess.username, wallet: sess.wallet, token };
  next();
}

function makeSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  stmt.insertSession.run(token, userId, Date.now());
  return token;
}

const USERNAME_RE = /^[a-zA-Z0-9_.\-]{3,20}$/;

// crude in-memory rate limit for auth + provide endpoints
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const rec = hits.get(key) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n++;
  hits.set(key, rec);
  return rec.n <= max;
}

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  if (!rateLimit('reg:' + req.ip, 10, 60000)) return res.status(429).json({ error: 'Slow down' });
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username: 3-20 chars, letters/numbers/_.-' });
  if (typeof password !== 'string' || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (stmt.userByName.get(username))
    return res.status(409).json({ error: 'Username already taken' });
  const hash = bcrypt.hashSync(password, 10);
  const info = stmt.insertUser.run(username, hash, Date.now());
  const token = makeSession(info.lastInsertRowid);
  res.json({ token, username, wallet: '' });
});

app.post('/api/login', (req, res) => {
  if (!rateLimit('login:' + req.ip, 20, 60000)) return res.status(429).json({ error: 'Slow down' });
  const { username, password } = req.body || {};
  const user = typeof username === 'string' ? stmt.userByName.get(username) : null;
  if (!user || typeof password !== 'string' || !bcrypt.compareSync(password, user.pass_hash))
    return res.status(401).json({ error: 'Wrong username or password' });
  const token = makeSession(user.id);
  res.json({ token, username: user.username, wallet: user.wallet || '' });
});

app.post('/api/logout', auth, (req, res) => {
  stmt.deleteSession.run(req.user.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.user.username, wallet: req.user.wallet || '' });
});

// ---------- profile ----------
app.post('/api/wallet', auth, (req, res) => {
  let { wallet } = req.body || {};
  if (typeof wallet !== 'string') wallet = '';
  wallet = wallet.trim();
  if (wallet.length > 120) return res.status(400).json({ error: 'Wallet address too long' });
  stmt.setWallet.run(wallet, req.user.id);
  res.json({ ok: true, wallet });
});

// ---------- game state ----------
app.get('/api/state', auth, (req, res) => {
  const row = stmt.getSave.get(req.user.id);
  res.json({ state: row ? JSON.parse(row.data) : null });
});

app.put('/api/state', auth, (req, res) => {
  const { state } = req.body || {};
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'Bad state' });
  stmt.upsertSave.run(req.user.id, JSON.stringify(state), Date.now());
  res.json({ ok: true });
});

// ---------- scoring ----------
// Client reports points when providing at the shelter. Light sanity caps.
app.post('/api/provide', auth, (req, res) => {
  if (!rateLimit('prov:' + req.user.id, 30, 60000)) return res.status(429).json({ error: 'Slow down' });
  let { pts } = req.body || {};
  pts = Math.floor(Number(pts));
  if (!Number.isFinite(pts) || pts <= 0 || pts > 2000) return res.status(400).json({ error: 'Bad points' });
  stmt.addPoints.run(pts, req.user.id);
  presence.broadcast({ t: 'provide', u: req.user.username, pts });
  res.json({ ok: true });
});

app.post('/api/cycle', auth, (req, res) => {
  let { pts } = req.body || {};
  pts = Math.floor(Number(pts));
  if (!Number.isFinite(pts) || pts < 0 || pts > 100000) return res.status(400).json({ error: 'Bad points' });
  stmt.bestCycle.run(pts, req.user.id);
  res.json({ ok: true });
});

// ---------- leaderboard ----------
app.get('/api/leaderboard', (req, res) => {
  res.json({ rows: stmt.leaderboard.all() });
});

app.get('/api/health', (req, res) => res.json({ ok: true, online: presence.onlineCount() }));

const server = http.createServer(app);
const presence = initPresence(server, stmt.sessionByToken);

server.listen(PORT, () => {
  console.log(`Robbin da Hood server listening on :${PORT}`);
});
