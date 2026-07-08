/* Real-time multiplayer presence + chat over WebSocket.
   Clients connect to /ws?token=<session token>, stream their position,
   and receive ~7 Hz snapshots of everyone online. Connections are keyed
   per-socket (not per-account) so a second tab never kills the first. */
const { WebSocketServer } = require('ws');

const players = new Map(); // connId -> { ws, connId, userId, username, x, y, run, moving, at }
let connSeq = 0;

function initPresence(server, sessionByToken) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcastAll(obj) {
    const msg = JSON.stringify(obj);
    for (const p of players.values()) {
      if (p.ws.readyState === 1) { try { p.ws.send(msg); } catch (e) {} }
    }
  }

  wss.on('connection', (ws, req) => {
    let sess = null;
    try {
      const url = new URL(req.url, 'http://x');
      const token = url.searchParams.get('token') || '';
      sess = sessionByToken.get(token);
    } catch (e) {}
    if (!sess) { ws.close(4001, 'unauthorized'); return; }

    const p = { ws, connId: ++connSeq, userId: sess.user_id, username: sess.username, x: 16, y: 62, run: false, moving: false, at: Date.now() };
    players.set(p.connId, p);

    ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(buf.toString()); } catch (e) { return; }
      if (m.t === 'pos') {
        const x = Number(m.x), y = Number(m.y);
        if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 80 && y >= 0 && y <= 80) {
          p.x = x; p.y = y; p.run = !!m.run; p.moving = !!m.moving; p.at = Date.now();
        }
      }
      else if (m.t === 'chat') {
        const txt = String(m.txt || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        if (!txt) return;
        const now = Date.now();
        if (p.lastChat && now - p.lastChat < 800) return; // anti-spam
        p.lastChat = now;
        broadcastAll({ t: 'chat', u: p.username, txt });
      }
    });
    ws.on('close', () => players.delete(p.connId));
    ws.on('error', () => {});
  });

  // snapshot broadcast loop
  setInterval(() => {
    if (!players.size) return;
    const list = [];
    for (const p of players.values()) {
      if (p.ws.readyState !== 1) continue;
      list.push({ u: p.username, x: +p.x.toFixed(2), y: +p.y.toFixed(2), r: p.run ? 1 : 0, m: p.moving ? 1 : 0 });
    }
    const msg = JSON.stringify({ t: 'players', list });
    for (const p of players.values()) {
      if (p.ws.readyState === 1) { try { p.ws.send(msg); } catch (e) {} }
    }
  }, 150);

  return {
    // let HTTP routes push events to everyone (e.g. shelter provides, admin reset)
    broadcast: broadcastAll,
    onlineCount() { return new Set([...players.values()].map(p => p.username)).size; }
  };
}

module.exports = { initPresence };
