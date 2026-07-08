/* Real-time multiplayer presence over WebSocket.
   Clients connect to /ws?token=<session token>, stream their position,
   and receive ~7 Hz snapshots of everyone online. */
const { WebSocketServer } = require('ws');

const players = new Map(); // user_id -> { ws, id, username, x, y, run, moving, at }

function initPresence(server, sessionByToken) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let sess = null;
    try {
      const url = new URL(req.url, 'http://x');
      const token = url.searchParams.get('token') || '';
      sess = sessionByToken.get(token);
    } catch (e) {}
    if (!sess) { ws.close(4001, 'unauthorized'); return; }

    // one live connection per account — newest wins
    const prev = players.get(sess.user_id);
    if (prev) { try { prev.ws.close(4002, 'replaced'); } catch (e) {} }

    const p = { ws, id: sess.user_id, username: sess.username, x: 16, y: 62, run: false, moving: false, at: Date.now() };
    players.set(sess.user_id, p);

    ws.on('message', (buf) => {
      let m;
      try { m = JSON.parse(buf.toString()); } catch (e) { return; }
      if (m.t === 'pos') {
        const x = Number(m.x), y = Number(m.y);
        if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 80 && y >= 0 && y <= 80) {
          p.x = x; p.y = y; p.run = !!m.run; p.moving = !!m.moving; p.at = Date.now();
        }
      }
    });
    ws.on('close', () => {
      const cur = players.get(sess.user_id);
      if (cur && cur.ws === ws) players.delete(sess.user_id);
    });
    ws.on('error', () => {});
  });

  // snapshot broadcast loop
  setInterval(() => {
    if (!players.size) return;
    const now = Date.now();
    const list = [];
    for (const [id, p] of players) {
      if (p.ws.readyState !== 1) continue;
      if (now - p.at > 60000 && !p.moving) { /* idle is fine, keep showing them */ }
      list.push({ id, u: p.username, x: +p.x.toFixed(2), y: +p.y.toFixed(2), r: p.run ? 1 : 0, m: p.moving ? 1 : 0 });
    }
    const msg = JSON.stringify({ t: 'players', list });
    for (const p of players.values()) {
      if (p.ws.readyState === 1) { try { p.ws.send(msg); } catch (e) {} }
    }
  }, 150);

  return {
    // let HTTP routes push events to everyone (e.g. shelter provides)
    broadcast(obj) {
      const msg = JSON.stringify(obj);
      for (const p of players.values()) {
        if (p.ws.readyState === 1) { try { p.ws.send(msg); } catch (e) {} }
      }
    },
    onlineCount() { return players.size; }
  };
}

module.exports = { initPresence };
