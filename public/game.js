/* ============================================================
   Robbin da Hood — full game client.
   Ported from the design-spec prototype; economy rebalanced for
   long-haul grind; state persisted server-side per account.
   ============================================================ */
(function () {
  'use strict';

  // ============ balance constants (grind tuning) ============
  const CYCLE_SEC = 60 * 60;        // 60 minute cycles
  const GROW_SEC = 8 * 60;          // 8 minutes per pot harvest
  const START_GOLD = 100;
  const COP_COUNT = 9;
  const HOUSE_PRICE = 2500;
  const UPG_COST = [0, 0, 4000, 10000, 22000, 45000]; // cost to reach level i
  const SEED_COST = 60;
  const HARVEST_YIELD = 3;
  const CYCLE_GOLD_PER_PT = 1;
  const MUG_BASE = 6, MUG_WEALTH = 44;      // payout = base + wealth*MUG_WEALTH
  const MUG_COOLDOWN = 240000;              // per-suit re-rob cooldown
  const MUG_DROP_CHANCE = 0.04;             // rare item from a mug
  const HEIST_DROP_CHANCE = 0.08;           // rare item from a heist
  const HEIST_COOLDOWN = 360000;            // per-building lockdown
  const PICKUPS_MAX = 2;                    // street finds on the map at once
  const PICKUP_RESPAWN_MS = 480000;         // 8 min until a new one appears

  const ITEMS = [
    { k: 'pipe',   name: 'Crack Pipe',   pts: 2, price: 250,  color: '#c9d8e8' },
    { k: 'needle', name: 'Used Needle',  pts: 1, price: 150,  color: '#9adbe8' },
    { k: 'crack',  name: 'Bag of Crack', pts: 3, price: 450,  color: '#e8e4da' },
    { k: 'knife',  name: 'Bloody Knife', pts: 5, price: 800,  color: '#e86a6a' },
    { k: 'sleep',  name: 'Sleeping Bag', pts: 6, price: 1100, color: '#8ab4e8' }
  ];
  const TITLES = [[0, 'Corner Watcher'], [10, 'Block Helper'], [25, 'Street Saint'], [50, 'Hood Legend'], [90, 'Robin of the Hood'], [150, 'Patron Saint of the Block']];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtWallet = (w) => !w ? '' : (w.length > 16 ? w.slice(0, 6) + '…' + w.slice(-5) : w);

  // ============================================================
  class Game {
    constructor(profile, savedState) {
      this.profile = profile; // { username, wallet }
      this.canvas = $('game');
      this.ctx = this.canvas.getContext('2d');
      this.keys = {};
      this.camOff = { x: 0, y: 0 };
      this.initGame(savedState);
      this.buildWorld();
      this.applySavedHouse();
      this.bindEvents();
      this.resize();
      $('hud').classList.remove('hidden');
      this.renderUser();
      this.ui();
      this.lastT = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
      this.tickIv = setInterval(() => this.tick(), 250);
      // multiplayer presence
      this.remotes = new Map();
      this.connectWs();
      this.posIv = setInterval(() => this.sendPos(), 120);
      // if the cycle expired while offline, settle it now
      if (Date.now() >= this.g.cycleEnd) this.endCycle();
    }

    // ============ multiplayer ============
    connectWs() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try { ws = new WebSocket(proto + '://' + location.host + '/ws?token=' + encodeURIComponent(RHApi.token() || '')); }
      catch (e) { this.wsRetry(); return; }
      this.ws = ws;
      ws.onopen = () => this.setOnline(1);
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'players') {
          const seen = new Set();
          for (const p of m.list) {
            if (p.u === this.profile.username) { this.setOnline(m.list.length); continue; }
            seen.add(p.u);
            const r = this.remotes.get(p.u);
            if (r) { r.tx = p.x; r.ty = p.y; r.run = !!p.r; r.moving = !!p.m; }
            else this.remotes.set(p.u, { u: p.u, x: p.x, y: p.y, tx: p.x, ty: p.y, run: !!p.r, moving: !!p.m, ph: Math.random() * 6 });
          }
          for (const key of [...this.remotes.keys()]) if (!seen.has(key)) this.remotes.delete(key);
        }
        else if (m.t === 'provide' && m.u !== this.profile.username) {
          this.g.cheerUntil = Date.now() + 3000;
          this.g.floaters.push({ x: this.SH.x, y: this.SH.y, txt: m.u + ' +' + m.pts + ' PTS', at: Date.now() });
        }
      };
      ws.onclose = (ev) => {
        this.setOnline(0);
        if (ev.code === 4001) return this.onLoggedOut();
        if (ev.code === 4002) return; // opened the game in another tab — let that one win
        this.wsRetry();
      };
      ws.onerror = () => {};
    }
    wsRetry() {
      clearTimeout(this._wsT);
      this._wsT = setTimeout(() => this.connectWs(), 3000);
    }
    sendPos() {
      if (!this.ws || this.ws.readyState !== 1) return;
      const g = this.g;
      try { this.ws.send(JSON.stringify({ t: 'pos', x: +g.player.x.toFixed(2), y: +g.player.y.toFixed(2), run: g.run && !!this._pmoving, moving: !!this._pmoving })); } catch (e) {}
    }
    setOnline(n) {
      const dot = $('h-online-dot'), txt = $('h-online');
      if (!dot || !txt) return;
      if (n > 0) { dot.style.background = '#8ae05c'; txt.textContent = n + ' in the hood'; }
      else { dot.style.background = '#8f7f63'; txt.textContent = 'reconnecting…'; }
    }

    bindEvents() {
      this.onKeyDown = (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { this.keys[e.code] = true; e.preventDefault(); }
        if (e.code === 'Escape') { this.g.panel = null; this.ui(); }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.g.run = !this.g.run; this.ui(); }
      };
      this.onKeyUp = (e) => { this.keys[e.code] = false; };
      this.onResize = () => this.resize();
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('resize', this.onResize);
      this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));

      $('b-run').onclick = () => { this.sfx('click'); this.g.run = !this.g.run; this.ui(); };
      $('b-house').onclick = () => this.togglePanel('house');
      $('b-bag').onclick = () => this.togglePanel('bag');
      $('b-board').onclick = () => this.togglePanel('board');
      $('b-profile').onclick = () => this.togglePanel('profile');
      $('b-help').onclick = () => this.togglePanel('help');

      // event delegation for panel + modal actions
      const onAct = (e) => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        e.preventDefault();
        this.doAction(el.dataset.act, el.dataset.arg);
      };
      $('panel').addEventListener('click', onAct);
      $('modal').addEventListener('click', onAct);

      window.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
    }

    togglePanel(p) {
      this.sfx('click');
      this.g.panel = this.g.panel === p ? null : p;
      if (this.g.panel === 'board') this.fetchLeaderboard();
      this.ui();
    }

    ui() { this.renderHud(); this.renderPanel(); this.renderModal(); this.saveSoon(); }
    sfx(n) { try { window.BRSfx && window.BRSfx[n] && window.BRSfx[n](); } catch (e) {} }
    fail(msg) { this.sfx('error'); this._noPop = true; this.toast(msg); this._noPop = false; }
    toast(msg) {
      if (!this._noPop) this.sfx('pop');
      const el = $('toast');
      el.textContent = msg;
      el.classList.remove('hidden');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => el.classList.add('hidden'), 2800);
    }

    titleFor(p) { let t = TITLES[0][1]; for (const [th, n] of TITLES) if (p >= th) t = n; return t; }

    // ============ setup ============
    initGame(saved) {
      const def = {
        gold: START_GOLD, weed: 0, items: [],
        house: null, // { id, level, pots: [{plantedAt}|null] }
        history: [], cycleNum: 1, points: 0, helpSeen: false
      };
      this.g = Object.assign({}, def, saved || {});
      this.g.items = this.g.items || [];
      this.g.history = this.g.history || [];
      this.g.cycleMs = CYCLE_SEC * 1000;
      if (!this.g.cycleEnd) this.g.cycleEnd = Date.now() + this.g.cycleMs;
      this.g.panel = this.g.helpSeen ? null : 'help';
      this.g.player = { x: 16, y: 62 };
      this.g.moveTarget = null; this.g.pending = null;
      this.g.run = false; this.g.energy = 100;
      this.g.heat = 0; this.g.heist = null; this.g.minigame = null;
      this.g.busted = null; this.g.cycleResult = null;
      this.g.cheerUntil = 0; this.g.floaters = [];
      this.cam = { x: 16, y: 62 };
      this.freeCamUntil = 0;
      this.board = { rows: null, error: null };
    }

    savePayload() {
      const g = this.g;
      return {
        gold: Math.round(g.gold), weed: g.weed, items: g.items, house: g.house,
        history: g.history, cycleNum: g.cycleNum, points: g.points,
        cycleEnd: g.cycleEnd, helpSeen: g.helpSeen
      };
    }
    saveSoon() {
      clearTimeout(this._saveT);
      this._saveT = setTimeout(() => this.saveNow(), 2500);
    }
    saveNow() {
      clearTimeout(this._saveT);
      RHApi.saveState(this.savePayload()).catch((e) => {
        if (e.status === 401) this.onLoggedOut();
      });
    }
    onLoggedOut() {
      RHApi.setToken(null);
      location.reload();
    }

    wealth(x, y) { return Math.max(0, Math.min(1, 0.5 + (x - y) / (2 * 66))); }

    buildWorld() {
      const M = 80; this.M = M;
      const rng = (() => { let s = 1337; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
      const W = (x, y) => this.wealth(x, y);
      const isRoadX = (v) => (v % 16 === 8 || v % 16 === 9);
      const tiles = [];
      for (let x = 0; x < M; x++) { tiles[x] = []; for (let y = 0; y < M; y++) {
        const rx = isRoadX(y), ry = isRoadX(x);
        let t;
        if (rx || ry) t = rx ? 'roadx' : 'roady';
        else if (isRoadX(y - 1) || isRoadX(y + 1) || isRoadX(x - 1) || isRoadX(x + 1)) t = 'walk';
        else {
          const w = W(x, y), h = window.RHArt.hash(x, y, 4);
          if (w > 0.62) t = 'lawn';
          else if (w < 0.38) t = (h < 0.45 ? 'crack' : 'dirt');
          else t = (h < 0.5 ? 'grass' : 'walk');
        }
        tiles[x][y] = t;
      } }
      this.tiles = tiles;
      const SH = { x: 16, y: 64 }; this.SH = SH;
      for (let x = SH.x - 4; x <= SH.x + 4; x++) for (let y = SH.y - 4; y <= SH.y + 4; y++)
        if (tiles[x] && tiles[x][y] && !tiles[x][y].startsWith('road')) tiles[x][y] = 'plaza';

      const objs = [], robs = [], houses = [];
      const occupied = (x, y, r) => objs.some(o => Math.hypot(o.x - x, o.y - y) < r);
      const blockC = [3.5, 16.5, 32.5, 48.5, 64.5];
      const owners = ['xX_420grower_Xx', 'lilBigMac', 'T0NY2Tone', 'shawtyplants', 'GreenThumbGary', 'nunya.biz', 'BigWorm88', 'auntieRuth'];
      let oi = 0;
      for (const bx of blockC) for (const by of blockC) {
        const w = W(bx, by);
        const spots = [[bx - 2.5, by - 2.5], [bx + 2.5, by + 2.5], [bx + 2.5, by - 2.5], [bx - 2.5, by + 2.5]];
        const rnd = rng();
        if (Math.hypot(bx - SH.x, by - SH.y) < 7) continue;
        if (w > 0.8) {
          objs.push({ t: 'bank', x: spots[0][0], y: spots[0][1], label: 'FIRST NATIONAL' });
          robs.push({ t: 'bank', x: spots[0][0], y: spots[0][1], name: 'First National Bank', dur: 9000, pay: [120, 220], heat: 60, cd: 0 });
          objs.push({ t: 'mansion', x: spots[1][0], y: spots[1][1] });
          robs.push({ t: 'mansion', x: spots[1][0], y: spots[1][1], name: 'Mansion', dur: 7000, pay: [90, 160], heat: 45, cd: 0 });
          objs.push({ t: 'fountain', x: spots[2][0], y: spots[2][1] });
          objs.push({ t: 'hedge', x: spots[3][0], y: spots[3][1] });
        } else if (w > 0.62) {
          if (rnd < 0.5) { objs.push({ t: 'jewel', x: spots[0][0], y: spots[0][1], label: 'DIAMONDS' }); robs.push({ t: 'jewel', x: spots[0][0], y: spots[0][1], name: 'Jewelry Store', dur: 6000, pay: [70, 130], heat: 40, cd: 0 }); }
          else { objs.push({ t: 'bank', x: spots[0][0], y: spots[0][1], label: 'CREDIT UNION' }); robs.push({ t: 'bank', x: spots[0][0], y: spots[0][1], name: 'Credit Union', dur: 8000, pay: [100, 180], heat: 55, cd: 0 }); }
          objs.push({ t: 'mansion', x: spots[1][0], y: spots[1][1] });
          robs.push({ t: 'mansion', x: spots[1][0], y: spots[1][1], name: 'Mansion', dur: 7000, pay: [90, 160], heat: 45, cd: 0 });
          objs.push({ t: 'hedge', x: spots[2][0], y: spots[2][1] });
          objs.push({ t: 'lamp', x: spots[3][0], y: spots[3][1] });
        } else if (w > 0.44) {
          objs.push({ t: 'store', x: spots[0][0], y: spots[0][1], label: 'QUICK MART' });
          robs.push({ t: 'store', x: spots[0][0], y: spots[0][1], name: 'Quick Mart', dur: 4000, pay: [30, 60], heat: 25, cd: 0 });
          if (rnd < 0.5) { objs.push({ t: 'store', x: spots[1][0], y: spots[1][1], label: 'LIQUOR' }); robs.push({ t: 'store', x: spots[1][0], y: spots[1][1], name: 'Liquor Store', dur: 4000, pay: [35, 65], heat: 25, cd: 0 }); }
          objs.push({ t: 'lamp', x: spots[2][0], y: spots[2][1] });
          objs.push({ t: 'trash', x: spots[3][0], y: spots[3][1] });
        } else {
          for (let si = 0; si < 3; si++) {
            const [hx, hy] = spots[si];
            const h = { t: 'hoodhouse', x: hx, y: hy, id: houses.length, level: 0, owner: null };
            if (rng() < 0.42 && oi < owners.length) { h.owner = owners[oi++]; h.level = 1 + Math.floor(rng() * 3); }
            h.label = h.owner ? h.owner : 'FOR SALE';
            houses.push(h); objs.push(h);
          }
          objs.push({ t: rnd < 0.5 ? 'dumpster' : 'barrel', x: spots[3][0], y: spots[3][1] });
        }
      }
      objs.push({ t: 'shelter', x: SH.x, y: SH.y, label: 'HOOD SHELTER' });
      objs.push({ t: 'barrel', x: SH.x - 3, y: SH.y + 2.5 });
      objs.push({ t: 'barrel', x: SH.x + 3.2, y: SH.y - 2 });
      this.VAN = { x: 44, y: 40.5 };
      objs.push({ t: 'van', x: this.VAN.x, y: this.VAN.y, label: 'KENNY' });
      this.objs = objs; this.robs = robs; this.houses = houses;

      // ---- NPCs ----
      const sk = { white: ['#f0d5b8', '#e8c9a8'], black: ['#8a5a3a', '#6e4526', '#a06a42'] };
      const suitsC = ['#2e3440', '#3a3a45', '#4a4238', '#2a3a52'];
      const topsC = ['#8a4ac4', '#c33a2e', '#3a8fc4', '#c4a94a', '#4e9e3a'];
      this.suits = [];
      let si2 = 0, sg = 0;
      while (this.suits.length < 24 && sg++ < 600) {
        const x = 3 + rng() * (M - 6), y = 3 + rng() * (M - 6);
        if (W(x, y) <= 0.5) continue;
        const i = si2++;
        this.suits.push({
          id: i, x, y, tx: x, ty: y, wait: rng() * 3,
          kind: 'suit', skin: sk.white[i % 2],
          suit: suitsC[i % 4], top: topsC[i % 5],
          robbed: 0, flee: 0, seed: i
        });
      }
      this.cops = [];
      let placed = 0, guard = 0;
      while (placed < COP_COUNT && guard++ < 500) {
        const x = 4 + rng() * (M - 8), y = 4 + rng() * (M - 8);
        if (W(x, y) < 0.45) continue;
        if (rng() > 0.2 + W(x, y) * 0.8) continue;
        this.cops.push({ id: placed, x, y, tx: x, ty: y, wait: rng() * 2, chase: 0, giveup: 0 });
        placed++;
      }
      this.crowd = [];
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        this.crowd.push({ x: SH.x + Math.cos(a) * 3.4, y: SH.y + 2.8 + Math.sin(a) * 1.2, skin: sk.black[i % 3], top: topsC[i % 5], seed: 40 + i, zzz: i === 4 });
      }
      // rare item pickup spots (kept scarce on purpose)
      this.pickups = [];
      this.pickupSpots = [];
      for (let i = 0; i < 30; i++) {
        const x = 4 + rng() * (M - 8), y = 4 + rng() * (M - 8);
        if (W(x, y) < 0.55 && !occupied(x, y, 2.2) && Math.hypot(x - SH.x, y - SH.y) > 7) this.pickupSpots.push({ x, y });
      }
      for (let i = 0; i < PICKUPS_MAX; i++) this.spawnPickup();
    }
    spawnPickup() {
      if (!this.pickupSpots.length || this.pickups.length >= PICKUPS_MAX) return;
      const sp = this.pickupSpots[Math.floor(Math.random() * this.pickupSpots.length)];
      if (this.pickups.some(p => Math.hypot(p.x - sp.x, p.y - sp.y) < 3)) return;
      // street finds are the cheap stuff only: pipe / needle / crack
      const it = ITEMS[Math.floor(Math.random() * 3)];
      this.pickups.push({ x: sp.x, y: sp.y, item: it, label: it.name });
    }
    applySavedHouse() {
      const g = this.g;
      if (!g.house) return;
      const h = this.houses[g.house.id];
      if (h) { h.level = g.house.level; h.mine = true; h.owner = null; h.label = 'YOUR SPOT'; }
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = innerWidth * dpr; this.canvas.height = innerHeight * dpr;
      this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px';
      this.dpr = dpr;
    }

    // ============ clicking ============
    onCanvasClick(e) {
      const g = this.g;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (g.minigame) { this.resolveMinigame(); return; }
      const mx = sx - this.camOff.x, my = sy - this.camOff.y;
      const a = mx / 32, b = my / 16;
      const wx = (b + a) / 2, wy = (b - a) / 2;
      if (wx <= 0 || wy <= 0 || wx >= this.M || wy >= this.M) return;
      let best = null, bd = 1.9;
      for (const r of this.robs) { const d = Math.hypot(r.x - wx, r.y - wy); if (d < bd) { bd = d; best = { type: 'rob', rob: r, x: r.x, y: r.y + 1.4 }; } }
      for (const h of this.houses) { const d = Math.hypot(h.x - wx, h.y - wy); if (d < bd) { bd = d; best = { type: 'house', house: h, x: h.x, y: h.y + 1.3 }; } }
      if (Math.hypot(this.SH.x - wx, this.SH.y - wy) < 2.6) best = { type: 'shelter', x: this.SH.x, y: this.SH.y + 2 };
      if (Math.hypot(this.VAN.x - wx, this.VAN.y - wy) < 1.6) best = { type: 'dealer', x: this.VAN.x, y: this.VAN.y + 1.2 };
      for (const n of this.suits) {
        if (n.kind !== 'suit' && this.wealth(n.x, n.y) > 0.5) continue;
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d < Math.min(bd, 1.1)) { bd = d; best = { type: 'mug', npc: n, x: n.x, y: n.y }; }
      }
      for (const p of this.pickups) { const d = Math.hypot(p.x - wx, p.y - wy); if (d < Math.min(bd, 1.3)) { bd = d; best = { type: 'pickup', pk: p, x: p.x, y: p.y }; } }
      g.heist = null;
      if (best) {
        g.pending = best;
        if (Math.hypot(g.player.x - best.x, g.player.y - best.y) < 1.9) { g.moveTarget = null; this.execPending(); }
        else g.moveTarget = { x: best.x, y: best.y };
      } else {
        g.pending = null;
        g.moveTarget = { x: wx, y: wy };
      }
      this.ui();
    }
    execPending() {
      const g = this.g, p = g.pending;
      if (!p) return;
      g.pending = null;
      if (p.type === 'rob') {
        const r = p.rob;
        if (r.cd > Date.now()) return this.fail(r.name + ' is still on lockdown — try later');
        g.heist = { rob: r, start: Date.now(), px: g.player.x, py: g.player.y };
        this.sfx('click');
        for (const c of this.cops) if (Math.hypot(c.x - g.player.x, c.y - g.player.y) < 9) { c.chase = 1; c.giveup = Date.now() + 8000; }
      }
      else if (p.type === 'mug') this.startMinigame(p.npc);
      else if (p.type === 'house') this.onHouseClick(p.house);
      else if (p.type === 'shelter') g.panel = 'shelter';
      else if (p.type === 'dealer') g.panel = 'dealer';
      else if (p.type === 'pickup') {
        const i = this.pickups.indexOf(p.pk);
        if (i >= 0) {
          this.pickups.splice(i, 1);
          g.items.push(p.pk.item.k);
          this.sfx('coin');
          this.toast('Found: ' + p.pk.item.name + ' (+' + p.pk.item.pts + ' pts at shelter)');
          setTimeout(() => this.spawnPickup(), PICKUP_RESPAWN_MS);
        }
      }
      this.ui();
    }
    onHouseClick(h) {
      const g = this.g;
      if (g.house && g.house.id === h.id) { g.panel = 'house'; this.ui(); return; }
      if (h.owner) return this.fail('That’s ' + h.owner + '’s spot. Hood rule #1: don’t touch another grower’s house.');
      if (g.house) return this.fail('You already got a spot. One house per robin hood.');
      if (g.gold < HOUSE_PRICE) return this.fail('House costs ' + HOUSE_PRICE + 'g — that’s a lot of robbing. Get to work.');
      g.gold -= HOUSE_PRICE;
      g.house = { id: h.id, level: 1, pots: [null] };
      h.level = 1; h.mine = true; h.label = 'YOUR SPOT';
      this.sfx('fanfare');
      this.toast('🏠 You bought the spot! Level it up, plant pots, get growing.');
      g.panel = 'house';
      this.ui();
    }

    // ============ mug minigame ============
    startMinigame(npc) {
      const g = this.g;
      if (npc.robbed > Date.now()) return this.fail('Already shook them down — pockets are empty');
      if (npc.kind === 'hood') return this.fail('Nah. We don’t rob our own. That’s the whole point.');
      const w = this.wealth(npc.x, npc.y);
      g.minigame = {
        npc, start: Date.now(), timeout: 4200,
        speed: 1.6 + w * 1.2,
        zoneW: 0.24 - w * 0.1,
        zoneC: 0.35 + Math.random() * 0.3,
        wealth: w
      };
      this.sfx('click');
      this.ui();
    }
    minigameCursor(mg) {
      const el = (Date.now() - mg.start) / 1000;
      return Math.abs(((el * mg.speed) % 2) - 1);
    }
    resolveMinigame() {
      const g = this.g, mg = g.minigame;
      if (!mg) return;
      g.minigame = null;
      const cur = this.minigameCursor(mg);
      const hit = Math.abs(cur - mg.zoneC) < mg.zoneW / 2;
      const npc = mg.npc;
      npc.robbed = Date.now() + MUG_COOLDOWN;
      npc.flee = Date.now() + 5000;
      if (hit) {
        const base = MUG_BASE + mg.wealth * MUG_WEALTH;
        const amt = Math.round(base * (0.8 + Math.random() * 0.6));
        g.gold += amt;
        g.heat = Math.min(100, g.heat + 12 + mg.wealth * 10);
        this.sfx('coin');
        const quips = ['"Take it! I have three more at home!"', '"My lawyer will hear about this!"', '"This blazer is Italian, please—"', '"I was going to donate that. Eventually."'];
        this.toast('+' + amt + 'g. ' + quips[Math.floor(Math.random() * quips.length)]);
        if (Math.random() < MUG_DROP_CHANCE) { const it = ITEMS[Math.floor(Math.random() * ITEMS.length)]; g.items.push(it.k); this.toast('+' + amt + 'g — and they dropped a ' + it.name + '!'); }
      } else {
        g.heat = Math.min(100, g.heat + 16);
        this.sfx('error');
        this.toast('Fumbled it! They’re screaming for the cops.');
        for (const c of this.cops) if (Math.hypot(c.x - g.player.x, c.y - g.player.y) < 12) { c.chase = 1; c.giveup = Date.now() + 9000; }
      }
      this.ui();
    }

    // ============ provide / bust / cycle ============
    bagPts() { const g = this.g; return g.weed + g.items.reduce((a, k) => a + (ITEMS.find(i => i.k === k) || { pts: 0 }).pts, 0); }
    provide() {
      const g = this.g;
      if (Math.hypot(g.player.x - this.SH.x, g.player.y - this.SH.y) > 5) return this.fail('Get closer to the shelter first');
      const pts = this.bagPts();
      if (pts <= 0) return this.fail('Bag’s empty. The hood can’t smoke your good intentions.');
      g.points += pts; g.weed = 0; g.items = [];
      g.cheerUntil = Date.now() + 3000;
      g.floaters.push({ x: this.SH.x, y: this.SH.y, txt: '+' + pts + ' PTS', at: Date.now() });
      this.sfx('fanfare');
      this.toast('♥ The block goes CRAZY. +' + pts + ' hood points!');
      RHApi.provide(pts).catch((e) => { if (e.status === 401) this.onLoggedOut(); });
      this.saveNow();
      this.ui();
    }
    bust() {
      const g = this.g;
      // busted: lose the whole bag + a 25% cut of your gold
      const cut = Math.round(g.gold * 0.25);
      const lostW = g.weed, lostI = g.items.length;
      const bits = [];
      if (cut) bits.push(cut + 'g');
      if (lostW) bits.push(lostW + ' weed');
      if (lostI) bits.push(lostI + ' rare item' + (lostI > 1 ? 's' : ''));
      g.busted = 'Confiscated: ' + (bits.length ? bits.join(', ') : 'nothing (they were just mad)') + '. The paperwork took 4 hours. You were released at the shelter.';
      g.gold -= cut; g.weed = 0; g.items = [];
      g.heat = 0; g.heist = null; g.minigame = null; g.moveTarget = null; g.pending = null;
      g.player.x = this.SH.x + 1; g.player.y = this.SH.y + 2.5;
      this.cam.x = g.player.x; this.cam.y = g.player.y;
      for (const c of this.cops) { c.chase = 0; }
      this.sfx('horn');
      this.saveNow();
      this.ui();
    }
    endCycle() {
      const g = this.g;
      const pts = g.points, reward = pts * CYCLE_GOLD_PER_PT, title = this.titleFor(pts);
      g.history.unshift({ num: g.cycleNum, pts, title });
      g.history = g.history.slice(0, 12);
      g.gold += reward;
      g.cycleResult = { num: g.cycleNum, pts, reward, title };
      g.cycleNum++; g.points = 0;
      g.cycleEnd = Date.now() + g.cycleMs;
      this.sfx('fanfare');
      RHApi.reportCycle(pts).catch(() => {});
      this.saveNow();
      this.ui();
    }

    // ============ tick (slow logic) ============
    tick() {
      const g = this.g, now = Date.now();
      if (now >= g.cycleEnd) this.endCycle();
      g.heat = Math.max(0, g.heat - 0.45);
      if (g.heist) {
        const h = g.heist;
        if (Math.hypot(g.player.x - h.px, g.player.y - h.py) > 0.6) { g.heist = null; this.fail('Heist blown — you walked off mid-job'); }
        else if (now - h.start >= h.rob.dur) {
          const r = h.rob;
          const amt = Math.round(r.pay[0] + Math.random() * (r.pay[1] - r.pay[0]));
          g.gold += amt; g.heat = Math.min(100, g.heat + r.heat);
          r.cd = now + HEIST_COOLDOWN;
          g.heist = null;
          this.sfx('coin');
          this.toast('💰 Cleaned out ' + r.name + ': +' + amt + 'g. Heat rising…');
          if (Math.random() < HEIST_DROP_CHANCE) { const it = ITEMS[Math.floor(Math.random() * ITEMS.length)]; g.items.push(it.k); this.toast('💰 +' + amt + 'g — and you grabbed a ' + it.name + '!'); }
        }
      }
      if (g.minigame && now - g.minigame.start > g.minigame.timeout) {
        g.minigame.npc.flee = now + 4000;
        g.minigame = null;
        this.fail('They power-walked away. Suits do cardio now.');
      }
      g.floaters = g.floaters.filter(f => now - f.at < 2200);
      this.renderHud();
      if (this.g.panel === 'house' || this.g.panel === 'shelter' || this.g.panel === 'bag') this.renderPanel();
    }

    // ============ frame ============
    frame(t) {
      const dt = Math.min(0.05, (t - this.lastT) / 1000); this.lastT = t;
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame((tt) => this.frame(tt));
    }
    step(dt) {
      const g = this.g, p = g.player, now = Date.now();
      const k = this.keys;
      let cx = 0, cy = 0;
      if (k.KeyW || k.ArrowUp) { cx -= 1; cy -= 1; }
      if (k.KeyS || k.ArrowDown) { cx += 1; cy += 1; }
      if (k.KeyA || k.ArrowLeft) { cx -= 1; cy += 1; }
      if (k.KeyD || k.ArrowRight) { cx += 1; cy -= 1; }
      if (cx || cy) {
        const l = Math.hypot(cx, cy);
        this.cam.x += cx / l * 16 * dt; this.cam.y += cy / l * 16 * dt;
        this.cam.x = Math.max(4, Math.min(this.M - 4, this.cam.x));
        this.cam.y = Math.max(4, Math.min(this.M - 4, this.cam.y));
        this.freeCamUntil = now + 3500;
      }
      const wantRun = g.run && g.moveTarget && g.energy > 0;
      if (wantRun) g.energy = Math.max(0, g.energy - 14 * dt);
      else g.energy = Math.min(100, g.energy + 9 * dt);
      if (g.energy <= 0 && g.run) { g.run = false; this.fail('Winded! Walk it off.'); this.renderHud(); }
      const sp = wantRun ? 7.0 : 4.2;
      this._pmoving = false;
      if (g.moveTarget && !g.minigame) {
        this.freeCamUntil = 0;
        const mt = g.moveTarget, d = Math.hypot(mt.x - p.x, mt.y - p.y);
        const arrive = g.pending ? 1.8 : 0.15;
        if (d < arrive) { g.moveTarget = null; if (g.pending) this.execPending(); }
        else { p.x += (mt.x - p.x) / d * sp * dt; p.y += (mt.y - p.y) / d * sp * dt; this._pmoving = true; this._pph = (this._pph || 0) + dt * (wantRun ? 14 : 11); }
      }
      p.x = Math.max(1, Math.min(this.M - 1, p.x)); p.y = Math.max(1, Math.min(this.M - 1, p.y));
      if (now > this.freeCamUntil) {
        const f = Math.min(1, 4 * dt);
        this.cam.x += (p.x - this.cam.x) * f; this.cam.y += (p.y - this.cam.y) * f;
      }
      // remote players glide toward their reported position
      for (const r of this.remotes.values()) {
        const d = Math.hypot(r.tx - r.x, r.ty - r.y);
        if (d > 12) { r.x = r.tx; r.y = r.ty; } // teleport on big jumps (bust, respawn)
        else if (d > 0.03) {
          const f = Math.min(1, 9 * dt);
          r.x += (r.tx - r.x) * f; r.y += (r.ty - r.y) * f;
        }
        if (r.moving) r.ph = (r.ph || 0) + dt * (r.run ? 14 : 11);
      }
      // suits wander / flee
      for (const n of this.suits) {
        const fleeing = n.flee > now;
        if (fleeing) {
          const d = Math.hypot(n.x - p.x, n.y - p.y) || 1;
          n.x += (n.x - p.x) / d * 3.6 * dt; n.y += (n.y - p.y) / d * 3.6 * dt;
          n.moving = true; n.ph = (n.ph || 0) + dt * 13;
        } else if (n.wait > 0) { n.wait -= dt; n.moving = false; }
        else {
          const d = Math.hypot(n.tx - n.x, n.ty - n.y);
          if (d < 0.2) {
            let gx = n.x + (Math.random() - 0.5) * 14, gy = n.y + (Math.random() - 0.5) * 14;
            gx = Math.max(3, Math.min(this.M - 3, gx)); gy = Math.max(3, Math.min(this.M - 3, gy));
            if (this.wealth(gx, gy) > 0.5) { n.tx = gx; n.ty = gy; }
            n.wait = 0.8 + Math.random() * 3.5;
            n.moving = false;
          } else { n.x += (n.tx - n.x) / d * 1.7 * dt; n.y += (n.ty - n.y) / d * 1.7 * dt; n.moving = true; n.ph = (n.ph || 0) + dt * 9; }
        }
        n.x = Math.max(2, Math.min(this.M - 2, n.x)); n.y = Math.max(2, Math.min(this.M - 2, n.y));
      }
      // cops — the hood is a no-go zone for them
      const vision = 3.6 + g.heat * 0.055;
      const playerInHood = this.wealth(p.x, p.y) < 0.4;
      for (const c of this.cops) {
        const dP = Math.hypot(c.x - p.x, c.y - p.y);
        if (!c.chase && !playerInHood && g.heat >= 8 && dP < vision) { c.chase = 1; c.giveup = now + 6000; this.sfx('whoosh'); }
        if (c.chase && playerInHood) {
          c.chase = 0;
          if (!this._hoodSafeT || now - this._hoodSafeT > 6000) { this._hoodSafeT = now; this.toast('You slipped into the hood — cops don’t roll down here.'); }
        }
        if (c.chase) {
          if (dP < vision * 1.5) c.giveup = now + 5000;
          if (now > c.giveup || g.heat <= 1) { c.chase = 0; }
          else {
            c.x += (p.x - c.x) / (dP || 1) * 5.1 * dt;
            c.y += (p.y - c.y) / (dP || 1) * 5.1 * dt;
            c.moving = true; c.ph = (c.ph || 0) + dt * 12;
            if (dP < 0.7 && !g.busted) this.bust();
          }
        }
        if (!c.chase) {
          if (c.wait > 0) { c.wait -= dt; c.moving = false; }
          else {
            const d = Math.hypot(c.tx - c.x, c.ty - c.y);
            if (d < 0.25) {
              let gx, gy, tries = 0;
              do { gx = 4 + Math.random() * (this.M - 8); gy = 4 + Math.random() * (this.M - 8); } while ((this.wealth(gx, gy) < 0.45 || Math.random() > 0.25 + this.wealth(gx, gy) * 0.75) && ++tries < 12);
              if (this.wealth(gx, gy) < 0.45) { gx = c.x; gy = c.y; }
              c.tx = gx; c.ty = gy; c.wait = 0.5 + Math.random() * 2.5; c.moving = false;
            } else { c.x += (c.tx - c.x) / d * 2.1 * dt; c.y += (c.ty - c.y) / d * 2.1 * dt; c.moving = true; c.ph = (c.ph || 0) + dt * 9; }
          }
        }
        c.x = Math.max(2, Math.min(this.M - 2, c.x)); c.y = Math.max(2, Math.min(this.M - 2, c.y));
      }
    }

    iso(x, y) { return { x: (x - y) * 32, y: (x + y) * 16 }; }
    draw() {
      const ctx = this.ctx, dpr = this.dpr || 1, cw = innerWidth, ch = innerHeight;
      const ART = window.RHArt;
      if (!ART) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#4c4a44'; ctx.fillRect(0, 0, cw, ch);
      const cp = this.iso(this.cam.x, this.cam.y);
      const ox = cw / 2 - cp.x, oy = ch / 2 - cp.y + 20;
      this.camOff = { x: ox, y: oy };
      ctx.save(); ctx.translate(ox, oy);
      const isoF = (x, y) => this.iso(x, y);
      const t = performance.now() / 1000, now = Date.now();
      const g = this.g;
      for (let x = 0; x < this.M; x++) for (let y = 0; y < this.M; y++) {
        const s = this.iso(x, y);
        if (s.x + ox < -80 || s.x + ox > cw + 80 || s.y + oy < -60 || s.y + oy > ch + 60) continue;
        ART.tile(ctx, isoF, x, y, this.tiles[x][y]);
      }
      const list = [];
      const seen = (o) => { const s = this.iso(o.x, o.y); return s.x + ox > -170 && s.x + ox < cw + 170 && s.y + oy > -140 && s.y + oy < ch + 100; };
      for (const o of this.objs) { if (!seen(o)) continue; list.push({ d: o.x + o.y, o }); }
      for (const p of this.pickups) { if (!seen(p)) continue; list.push({ d: p.x + p.y, o: { t: 'pickup', ...p, color: p.item.color } }); }
      if (g.house) {
        const h = this.houses[g.house.id];
        for (let i = 0; i < g.house.pots.length; i++) {
          const pot = g.house.pots[i];
          const px = h.x - 1.2 + i * 0.55, py = h.y + 1.35;
          let stage = 0, ready = false;
          if (pot) {
            const el = (now - pot.plantedAt) / (GROW_SEC * 1000);
            stage = Math.min(1, el); ready = el >= 1;
          }
          list.push({ d: px + py, o: { t: 'weedpot', x: px, y: py, stage, ready } });
        }
      }
      for (const n of this.suits) {
        if (!seen(n)) continue;
        const robbedNow = n.robbed > now;
        list.push({ d: n.x + n.y, o: { t: 'person', kind: n.kind, x: n.x, y: n.y, skin: n.skin, suit: n.suit, top: n.top, seed: n.seed, moving: !!n.moving, ph: n.ph || 0, run: n.flee > now, label: n.kind === 'suit' ? (robbedNow ? 'robbed ✓' : null) : null, labelColor: '#8f7f63' } });
      }
      for (const c of this.cops) {
        if (!seen(c)) continue;
        list.push({ d: c.x + c.y, o: { t: 'person', kind: 'cop', x: c.x, y: c.y, skin: '#e8c49a', moving: !!c.moving, ph: c.ph || 0, run: !!c.chase, alert: !!c.chase, label: c.chase ? 'HEY! YOU!' : null, labelColor: '#ff9a8a' } });
      }
      const cheering = g.cheerUntil > now;
      for (const cr of this.crowd) {
        if (!seen(cr)) continue;
        list.push({ d: cr.x + cr.y, o: { t: 'person', kind: 'hood', x: cr.x, y: cr.y, skin: cr.skin, top: cr.top, seed: cr.seed, cheer: cheering, zzz: !cheering && cr.zzz } });
      }
      // other players
      for (const r of this.remotes.values()) {
        if (!seen(r)) continue;
        list.push({ d: r.x + r.y, o: { t: 'person', kind: 'player', x: r.x, y: r.y, ph: r.ph || 0, moving: !!r.moving, run: !!r.run, label: r.u, labelColor: '#5fb4d8' } });
      }
      list.push({ d: g.player.x + g.player.y, o: { t: 'person', kind: 'player', x: g.player.x, y: g.player.y, ph: this._pph || 0, moving: !!this._pmoving, run: g.run && this._pmoving, label: this.profile.username, labelColor: '#8ae05c' } });
      if (g.moveTarget) {
        const s = this.iso(g.moveTarget.x, g.moveTarget.y);
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 10, 5, 0, 0, 7); ctx.stroke();
      }
      list.sort((a, b) => a.d - b.d);
      for (const it of list) ART.drawObj(ctx, isoF, it.o, { t });
      for (const f of g.floaters) {
        const el = (now - f.at) / 2200;
        const s = this.iso(f.x, f.y);
        ctx.font = "700 22px 'Pixelify Sans', monospace";
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(23,16,10,' + (0.9 * (1 - el)).toFixed(2) + ')';
        ctx.fillText(f.txt, s.x + 2, s.y - 60 - el * 46 + 2);
        ctx.fillStyle = 'rgba(138,224,92,' + (1 - el).toFixed(2) + ')';
        ctx.fillText(f.txt, s.x, s.y - 60 - el * 46);
        ctx.textAlign = 'left';
      }
      ctx.restore();

      // minigame bar
      if (g.minigame) {
        const mg = g.minigame;
        const bw = 300, bh = 26, bx = cw / 2 - bw / 2, by = ch - 170;
        ctx.fillStyle = 'rgba(16,14,20,.94)';
        ctx.fillRect(bx - 12, by - 36, bw + 24, bh + 58);
        ctx.strokeStyle = 'rgba(242,178,58,.5)'; ctx.lineWidth = 2;
        ctx.strokeRect(bx - 12, by - 36, bw + 24, bh + 58);
        ctx.font = "700 14px 'Pixelify Sans', monospace"; ctx.textAlign = 'center';
        ctx.fillStyle = '#f3e7cd';
        ctx.fillText('CLICK IN THE GREEN — pick that pocket', cw / 2, by - 14);
        ctx.fillStyle = '#17100a'; ctx.fillRect(bx, by, bw, bh);
        const zx = bx + (mg.zoneC - mg.zoneW / 2) * bw, zw = mg.zoneW * bw;
        ctx.fillStyle = '#4e9e3a'; ctx.fillRect(zx, by, zw, bh);
        ctx.fillStyle = '#8ae05c'; ctx.fillRect(zx + zw * 0.3, by, zw * 0.4, bh);
        const cur = this.minigameCursor(mg);
        ctx.fillStyle = '#f3e7cd'; ctx.fillRect(bx + cur * bw - 2, by - 4, 4, bh + 8);
        const rem = 1 - (now - mg.start) / mg.timeout;
        ctx.fillStyle = '#8f7f63'; ctx.fillRect(bx, by + bh + 6, bw * Math.max(0, rem), 4);
        ctx.textAlign = 'left';
      }
      const chased = this.cops.some(c => c.chase);
      if (chased) {
        const a = 0.12 + 0.08 * Math.sin(t * 6);
        const vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
        vg.addColorStop(0, 'rgba(200,30,30,0)'); vg.addColorStop(1, 'rgba(200,30,30,' + a.toFixed(2) + ')');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);
      }
      this.drawMinimap(ctx, cw);
      // heist HUD element
      const heistEl = $('h-heist');
      if (g.heist) {
        heistEl.classList.remove('hidden');
        $('h-heisttxt').textContent = 'Robbing ' + g.heist.rob.name + '… stay put!';
        $('h-heistbar').style.width = Math.min(100, Math.round((now - g.heist.start) / g.heist.rob.dur * 100)) + '%';
      } else heistEl.classList.add('hidden');
    }
    drawMinimap(ctx, cw) {
      const MW = 148, MH = 82;
      const x0 = cw - MW - 14, y0 = 14;
      if (!this.mmCache) {
        const off = document.createElement('canvas'); off.width = MW; off.height = MH;
        const oc = off.getContext('2d');
        oc.fillStyle = 'rgba(16,14,20,.95)'; oc.fillRect(0, 0, MW, MH);
        for (let x = 0; x < this.M; x += 2) for (let y = 0; y < this.M; y += 2) {
          const t = this.tiles[x][y];
          let c = '#77a54e';
          if (t === 'lawn') c = '#66ba4b'; else if (t === 'crack') c = '#565452'; else if (t === 'dirt') c = '#93744a';
          else if (t.startsWith('road')) c = '#33322f'; else if (t === 'walk') c = '#a8a59d'; else if (t === 'plaza') c = '#a19886';
          const px = MW / 2 + (x - y) * (MW / (2 * this.M)), py = 4 + (x + y) * (MH - 8) / (2 * this.M);
          oc.fillStyle = c; oc.fillRect(px - 1, py - 0.5, 2.2, 1.4);
        }
        this.mmCache = off;
      }
      ctx.drawImage(this.mmCache, x0, y0);
      ctx.strokeStyle = 'rgba(243,231,205,.2)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, MW - 1, MH - 1);
      const dot = (wx, wy, c, r) => {
        const px = x0 + MW / 2 + (wx - wy) * (MW / (2 * this.M)), py = y0 + 4 + (wx + wy) * (MH - 8) / (2 * this.M);
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px, py, r || 2, 0, 7); ctx.fill();
      };
      dot(this.SH.x, this.SH.y, '#e86a8a', 3);
      if (this.g.house) { const h = this.houses[this.g.house.id]; dot(h.x, h.y, '#8ae05c', 2.5); }
      for (const c of this.cops) dot(c.x, c.y, c.chase ? '#ff5a4a' : '#5a8ae8', 1.8);
      for (const r of this.remotes.values()) dot(r.x, r.y, '#5fb4d8', 2);
      dot(this.g.player.x, this.g.player.y, '#f3e7cd', 2.6);
      ctx.font = "600 9px 'Pixelify Sans', monospace";
      ctx.fillStyle = '#8f7f63';
      ctx.fillText('HOOD', x0 + 6, y0 + MH - 5);
      ctx.fillStyle = '#c9b896';
      ctx.fillText('RICH', x0 + MW - 28, y0 + MH - 5);
    }

    fmtCd() {
      const ms = Math.max(0, this.g.cycleEnd - Date.now());
      const s = Math.ceil(ms / 1000);
      const m = Math.floor(s / 60);
      return m + ':' + String(s % 60).padStart(2, '0');
    }

    // ============ HUD render ============
    renderHud() {
      const g = this.g;
      $('h-gold').textContent = Math.round(g.gold);
      $('h-weed').textContent = g.weed;
      $('h-pts').textContent = g.points;
      const bagCount = g.weed + g.items.length;
      $('h-bag').textContent = bagCount;
      $('h-bag2').textContent = bagCount;
      $('h-cyclenum').textContent = g.cycleNum;
      $('h-cycle').textContent = this.fmtCd();
      const heatEl = $('h-heat');
      if (g.heat > 2) {
        heatEl.classList.remove('hidden');
        $('h-heatbar').style.width = Math.round(g.heat) + '%';
        const chasing = this.cops.filter(c => c.chase).length;
        $('h-chase').textContent = chasing ? chasing + ' chasing!' : 'watched';
      } else heatEl.classList.add('hidden');
      $('h-energy').style.width = Math.round(g.energy) + '%';
      const rb = $('b-run');
      if (g.run) { rb.style.background = 'linear-gradient(180deg,#72c3e4,#4fa3c9)'; rb.style.color = '#0d2430'; rb.textContent = '🏃 RUN ON'; }
      else { rb.style.background = 'rgba(20,18,24,.9)'; rb.style.color = '#c9d8e8'; rb.textContent = '🚶 RUN OFF'; }
    }
    renderUser() {
      $('h-user').innerHTML = esc(this.profile.username) + (this.profile.wallet ? '<br><span style="color:#8f7f63">' + esc(fmtWallet(this.profile.wallet)) + '</span>' : '');
    }

    // ============ panels ============
    doAction(act, arg) {
      const g = this.g;
      switch (act) {
        case 'close': g.panel = null; this.ui(); break;
        case 'upgrade': this.upgradeHouse(); break;
        case 'plant': this.plant(+arg); break;
        case 'harvest': this.harvest(+arg); break;
        case 'buy': this.buyItem(arg); break;
        case 'provide': this.provide(); break;
        case 'dismissCycle': g.cycleResult = null; this.ui(); break;
        case 'dismissBusted': g.busted = null; this.ui(); break;
        case 'dismissHelp': g.helpSeen = true; g.panel = null; this.ui(); break;
        case 'saveWallet': this.saveWallet(); break;
        case 'logout': this.logout(); break;
        case 'refreshBoard': this.fetchLeaderboard(); this.renderPanel(); break;
      }
    }
    upgradeHouse() {
      const g = this.g;
      if (!g.house) return;
      const lvl = g.house.level;
      if (lvl >= 5) return this.fail('She’s maxed. A palace of horticulture.');
      const cost = UPG_COST[lvl + 1];
      if (g.gold < cost) return this.fail('Need ' + cost + 'g');
      g.gold -= cost;
      g.house.level++;
      g.house.pots.push(null);
      this.houses[g.house.id].level = g.house.level;
      this.sfx('fanfare');
      this.toast('🏠 House level ' + g.house.level + ' — new pot unlocked!');
      this.ui();
    }
    plant(i) {
      const g = this.g;
      if (!g.house || g.house.pots[i] !== null) return;
      if (g.gold < SEED_COST) return this.fail('Seeds cost ' + SEED_COST + 'g');
      g.gold -= SEED_COST;
      g.house.pots[i] = { plantedAt: Date.now() };
      this.sfx('click');
      this.toast('🌱 Planted. Nature is doing her thing.');
      this.ui();
    }
    harvest(i) {
      const g = this.g;
      if (!g.house || !g.house.pots[i]) return;
      const el = (Date.now() - g.house.pots[i].plantedAt) / (GROW_SEC * 1000);
      if (el < 1) return;
      g.house.pots[i] = null;
      g.weed += HARVEST_YIELD;
      this.sfx('chime');
      this.toast('✂ +' + HARVEST_YIELD + ' weed. Smells like community service.');
      this.ui();
    }
    buyItem(k) {
      const g = this.g;
      const it = ITEMS.find(i => i.k === k);
      if (!it) return;
      if (g.gold < it.price) return this.fail('Kenny doesn’t do credit.');
      g.gold -= it.price;
      g.items.push(it.k);
      this.sfx('coin');
      this.toast('Kenny slides you a ' + it.name + '. No eye contact.');
      this.ui();
    }
    async saveWallet() {
      const inp = $('p-wallet');
      if (!inp) return;
      const wallet = inp.value.trim();
      try {
        await RHApi.setWallet(wallet);
        this.profile.wallet = wallet;
        this.renderUser();
        this.toast(wallet ? '💳 Wallet saved to your profile' : 'Wallet removed');
      } catch (e) {
        if (e.status === 401) return this.onLoggedOut();
        this.fail(e.message);
      }
    }
    async logout() {
      this.saveNow();
      try { await RHApi.logout(); } catch (e) {}
      RHApi.setToken(null);
      location.reload();
    }
    async fetchLeaderboard() {
      this.board = { rows: null, error: null };
      try {
        const data = await RHApi.leaderboard();
        this.board.rows = data.rows || [];
      } catch (e) {
        this.board.error = e.message;
      }
      if (this.g.panel === 'board') this.renderPanel();
    }

    panelFrame(title, color, body) {
      return '<div class="p-head"><div class="p-title" style="color:' + color + '">' + title + '</div>' +
        '<button data-act="close" class="btn-dim" style="border:1px solid rgba(23,16,10,.55);border-radius:8px;padding:3px 11px;font-weight:700;font-size:15px">✕</button></div>' +
        '<div class="p-body">' + body + '</div>';
    }

    renderPanel() {
      const g = this.g, el = $('panel');
      if (!g.panel || g.panel === 'help') { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      const now = Date.now();
      let html = '';
      if (g.panel === 'house') {
        let body = '';
        if (!g.house) {
          body += '<div class="card" style="padding:14px;font-size:14px;line-height:1.5;color:#c9b896">You don’t own a spot yet. Find a <b style="color:#ffce7a">FOR SALE</b> house in the hood (west side) and click it to buy — it’ll run you <b style="color:#f2b23a">' + HOUSE_PRICE + 'g</b>. That’s where the growing happens.</div>';
        } else {
          const lvl = g.house.level;
          const nextCost = UPG_COST[lvl + 1];
          body += '<div class="card" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-weight:700;font-size:17px">House Level ' + lvl + '</span><span class="muted" style="font-size:12px">' + lvl + ' pot' + (lvl === 1 ? '' : 's') + (lvl < 5 ? ' · next level adds one' : ' · maxed out') + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center"><span class="muted" style="font-size:13px">' + (lvl >= 5 ? 'Fully kitted grow op' : 'Level ' + (lvl + 1) + ' costs ' + nextCost + 'g') + '</span>' +
            '<button data-act="upgrade" class="btn btn-green btn-sm">' + (lvl >= 5 ? 'MAX' : 'Upgrade (' + nextCost + 'g)') + '</button></div></div>';
          body += '<div class="dim" style="font-size:12px;letter-spacing:1px">GROW POTS · seed ' + SEED_COST + 'g · harvest ' + Math.round(GROW_SEC / 60) + ' min later</div>';
          g.house.pots.forEach((pot, i) => {
            let inner;
            if (!pot) {
              inner = '<div><div style="font-weight:700;font-size:15px;color:#c9b896">Pot ' + (i + 1) + ' — empty</div><div class="muted" style="font-size:12px;margin-top:2px">Dirt, dreams, potential.</div></div>' +
                '<button data-act="plant" data-arg="' + i + '" class="btn btn-green btn-sm">Plant</button>';
            } else {
              const elp = (now - pot.plantedAt) / (GROW_SEC * 1000);
              if (elp >= 1) {
                inner = '<div><div style="font-weight:700;font-size:15px;color:#8ae05c">Pot ' + (i + 1) + ' — READY</div><div class="muted" style="font-size:12px;margin-top:2px">She’s beautiful. Harvest her.</div></div>' +
                  '<button data-act="harvest" data-arg="' + i + '" class="btn btn-sm" style="background:linear-gradient(180deg,#a2f06e,#7dd044);color:#0f2606;box-shadow:0 0 12px rgba(138,224,92,.5),inset 0 1px 0 rgba(255,255,255,.3)">Harvest ✂</button>';
              } else {
                const remS = Math.ceil((GROW_SEC * 1000 - (now - pot.plantedAt)) / 1000);
                const remTxt = remS >= 60 ? Math.floor(remS / 60) + 'm ' + (remS % 60) + 's' : remS + 's';
                inner = '<div><div style="font-weight:700;font-size:15px;color:#a2d06e">Pot ' + (i + 1) + ' — growing</div><div class="muted" style="font-size:12px;margin-top:2px">' + remTxt + ' to harvest</div></div>' +
                  '<div style="width:90px;height:11px;background:#17100a;border-radius:6px;overflow:hidden"><div style="height:100%;background:#54a336;width:' + Math.round(elp * 100) + '%"></div></div>';
              }
            }
            body += '<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">' + inner + '</div>';
          });
          body += '<div class="dim" style="font-size:12px;line-height:1.5">Harvested weed goes in your bag. Walk it to the <b style="color:#e86a8a">shelter</b> to turn it into hood points — but if the cops get you first, the bag is gone.</div>';
        }
        html = this.panelFrame(g.house ? 'Your Grow House' : 'No House Yet', '#8ae05c', body);
      }
      else if (g.panel === 'bag') {
        const itemsList = g.items.map(k => ITEMS.find(i => i.k === k)).filter(Boolean);
        const bagCount = g.weed + g.items.length;
        let body = '<div class="card" style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;font-size:15px;color:#8ae05c">Weed × ' + g.weed + '</span><span class="muted" style="font-size:12px">' + g.weed + ' pts at the shelter</span></div>';
        for (const it of itemsList)
          body += '<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;font-size:14px;color:' + it.color + '">' + it.name + '</span><span class="muted" style="font-size:12px">+' + it.pts + ' pts</span></div>';
        if (bagCount === 0) body += '<div class="dim" style="font-size:13px;text-align:center;padding:16px 0">Nothing but lint. Rob somebody. Grow something.</div>';
        body += '<div class="dim" style="font-size:12px;line-height:1.5;margin-top:4px">Everything here is worth <b style="color:#8ae05c">' + this.bagPts() + ' points</b> at the shelter — and worth <b style="color:#ff9a8a">nothing</b> in a cop’s evidence locker. Choose your route wisely.</div>';
        html = this.panelFrame('Your Bag', '#f2b23a', body);
      }
      else if (g.panel === 'dealer') {
        let body = '<div class="muted" style="font-size:13px;line-height:1.5;font-style:italic">"Psst. Rare goods. The shelter pays points for these. No refunds. No eye contact."</div>';
        for (const d of ITEMS)
          body += '<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px"><div><div style="font-weight:700;font-size:15px;color:' + d.color + '">' + d.name + '</div><div class="muted" style="font-size:12px;margin-top:2px">worth +' + d.pts + ' pts at the shelter</div></div>' +
            '<button data-act="buy" data-arg="' + d.k + '" class="btn btn-gold btn-sm" style="white-space:nowrap">' + d.price + 'g</button></div>';
        html = this.panelFrame('Trench Coat Kenny', '#c8a2f0', body);
      }
      else if (g.panel === 'shelter') {
        const bagCount = g.weed + g.items.length;
        const desc = bagCount === 0 ? 'You’re carrying nothing' :
          'Hand over ' + (g.weed ? g.weed + ' weed' : '') + (g.weed && g.items.length ? ' + ' : '') + (g.items.length ? g.items.length + ' item' + (g.items.length > 1 ? 's' : '') : '') + ' = +' + this.bagPts() + ' pts';
        let body = '<div class="muted" style="font-size:14px;line-height:1.5">The hood is counting on you. Hand over what you’re carrying and watch the block light up.</div>' +
          '<div class="card" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700;font-size:16px;color:#8ae05c">Provide everything</div><div class="muted" style="font-size:12px;margin-top:2px">' + desc + '</div></div>' +
          '<button data-act="provide" class="btn btn-pink" style="padding:8px 16px">Provide ♥</button></div>' +
          '<div class="dim" style="font-size:12px;line-height:1.5">1 weed = 1 point. Rare goods score bigger. Points reset every cycle — gold, weed and your house never do.</div>';
        html = this.panelFrame('♥ The Shelter', '#e86a8a', body);
      }
      else if (g.panel === 'board') {
        let body = '<div class="card" style="border-color:rgba(138,224,92,.2);padding:14px;text-align:center">' +
          '<div class="muted" style="font-size:12px;letter-spacing:1px">THIS CYCLE (' + this.fmtCd() + ' left)</div>' +
          '<div style="font-size:38px;font-weight:700;color:#8ae05c">' + g.points + ' pts</div>' +
          '<div style="font-size:13px;color:#c8a2f0;margin-top:2px">"' + this.titleFor(g.points) + '"</div></div>';
        body += '<div style="display:flex;justify-content:space-between;align-items:center"><span class="dim" style="font-size:12px;letter-spacing:1px">HOOD LEADERBOARD · ALL-TIME PTS</span><button data-act="refreshBoard" class="btn-dim" style="border:1px solid rgba(243,231,205,.2);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700">↻</button></div>';
        if (this.board.error) body += '<div style="color:#ff9a8a;font-size:13px">' + esc(this.board.error) + '</div>';
        else if (!this.board.rows) body += '<div class="dim" style="font-size:13px;text-align:center;padding:8px 0">Loading…</div>';
        else if (!this.board.rows.length) body += '<div class="dim" style="font-size:13px;text-align:center;padding:8px 0">Nobody’s provided yet. Be the first.</div>';
        else {
          this.board.rows.forEach((r, i) => {
            const me = r.username.toLowerCase() === this.profile.username.toLowerCase();
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
            body += '<div class="card" style="padding:9px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px' + (me ? ';border-color:rgba(138,224,92,.4)' : '') + '">' +
              '<div style="min-width:0"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:14px">' + medal + '</span><span style="font-weight:700;font-size:14px;color:' + (me ? '#8ae05c' : '#f3e7cd') + '">' + esc(r.username) + '</span></div>' +
              (r.wallet ? '<div class="dim" style="font-size:11px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.wallet) + '">' + esc(fmtWallet(r.wallet)) + '</div>' : '') + '</div>' +
              '<span style="font-weight:700;font-size:15px;color:#8ae05c;white-space:nowrap">' + r.total_points + ' pts</span></div>';
          });
        }
        body += '<div class="dim" style="font-size:12px;letter-spacing:1px;margin-top:4px">YOUR PAST CYCLES</div>';
        if (!g.history.length) body += '<div class="dim" style="font-size:13px;text-align:center;padding:8px 0">No history yet — finish a cycle.</div>';
        else g.history.forEach((h, i) => {
          const medal = i === 0 ? '🕐' : (h.pts >= 50 ? '🏆' : h.pts >= 25 ? '⭐' : '·');
          body += '<div class="card" style="padding:9px 14px;display:flex;justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:9px"><span style="font-size:15px">' + medal + '</span><span style="font-weight:700;font-size:14px">Cycle ' + h.num + '</span><span style="font-size:12px;color:#c8a2f0">' + esc(h.title) + '</span></div><span style="font-weight:700;font-size:15px;color:#8ae05c">' + h.pts + ' pts</span></div>';
        });
        body += '<div class="dim" style="font-size:12px;line-height:1.5">Cycle-end reward: <b style="color:#f2b23a">' + CYCLE_GOLD_PER_PT + 'g per point</b>. Be the biggest robin hood of the hood.</div>';
        html = this.panelFrame('Hood Leaderboard', '#c8a2f0', body);
      }
      else if (g.panel === 'profile') {
        let body = '<div class="card" style="display:flex;flex-direction:column;gap:6px">' +
          '<div class="dim" style="font-size:12px;letter-spacing:1px">SIGNED IN AS</div>' +
          '<div style="font-weight:700;font-size:20px;color:#8ae05c">' + esc(this.profile.username) + '</div></div>';
        body += '<div class="card" style="display:flex;flex-direction:column;gap:8px">' +
          '<div class="dim" style="font-size:12px;letter-spacing:1px">WALLET ADDRESS</div>' +
          '<div class="muted" style="font-size:12px;line-height:1.4">Shown next to your name on the leaderboard. Optional.</div>' +
          '<input id="p-wallet" maxlength="120" placeholder="paste your wallet address" value="' + esc(this.profile.wallet || '') + '">' +
          '<button data-act="saveWallet" class="btn btn-green btn-sm" style="align-self:flex-start">Save wallet</button></div>';
        body += '<button data-act="logout" class="btn btn-dim" style="margin-top:8px">Log out</button>';
        body += '<div class="dim" style="font-size:12px;line-height:1.5">Progress is saved to your account automatically.</div>';
        html = this.panelFrame('Profile', '#f3e7cd', body);
      }
      // preserve wallet input focus/value across re-renders
      const prevWallet = document.activeElement && document.activeElement.id === 'p-wallet' ? document.activeElement.value : null;
      el.innerHTML = html;
      if (prevWallet !== null) {
        const w = $('p-wallet');
        if (w) { w.value = prevWallet; w.focus(); }
      }
    }

    // ============ modals ============
    renderModal() {
      const g = this.g, el = $('modal');
      let html = '';
      if (g.busted) {
        html = '<div style="position:relative;background:rgba(26,20,20,.97);border:2px solid #e84a4a;border-radius:14px;color:#f3e7cd;box-shadow:0 20px 50px rgba(0,0,0,.6);animation:rh-pop .2s ease-out;padding:20px 30px;text-align:center">' +
          '<div style="font-size:38px;font-weight:700;color:#e84a4a;letter-spacing:2px">🚨 BUSTED 🚨</div>' +
          '<div class="muted" style="font-size:14px;margin-top:6px;max-width:300px;line-height:1.5">' + esc(g.busted) + '</div>' +
          '<button data-act="dismissBusted" class="btn btn-dim" style="margin-top:12px;border:1px solid rgba(243,231,205,.3);border-radius:10px;padding:7px 20px;font-size:14px">Back to the shelter…</button></div>';
      } else if (g.cycleResult) {
        const r = g.cycleResult;
        html = '<div style="width:420px;max-width:92vw;background:rgba(26,24,32,.97);border:1px solid rgba(138,224,92,.3);border-radius:14px;color:#f3e7cd;box-shadow:0 20px 50px rgba(0,0,0,.55);animation:rh-pop .2s ease-out;overflow:hidden">' +
          '<div style="background:linear-gradient(180deg,#8bcf5e,#6cb03f);color:#14260c;padding:12px 18px;font-size:20px;font-weight:700;border-bottom:4px solid #17100a">Cycle ' + r.num + ' complete</div>' +
          '<div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;text-align:center">' +
          '<div style="font-size:44px;font-weight:700;color:#8ae05c">' + r.pts + ' pts</div>' +
          '<div style="font-size:16px;color:#c8a2f0;font-weight:700">"' + esc(r.title) + '"</div>' +
          '<div style="font-size:14px;color:#f2b23a">Reward: +' + r.reward + 'g</div>' +
          '<button data-act="dismissCycle" class="btn btn-gold" style="margin-top:6px;font-size:16px;padding:9px">Next cycle</button></div></div>';
      } else if (g.panel === 'help') {
        html = '<div style="width:490px;max-width:92vw;background:rgba(26,24,32,.97);border:1px solid rgba(138,224,92,.3);border-radius:14px;color:#f3e7cd;box-shadow:0 20px 50px rgba(0,0,0,.55);animation:rh-pop .2s ease-out;overflow:hidden">' +
          '<div style="background:linear-gradient(180deg,#8bcf5e,#6cb03f);color:#14260c;padding:14px 18px;border-bottom:4px solid #17100a">' +
          '<div style="font-size:26px;font-weight:700;letter-spacing:1px">ROBBIN\' DA HOOD</div>' +
          '<div style="font-size:13px;font-weight:600;opacity:.8">rob the rich · grow the green · feed the hood</div></div>' +
          '<div style="padding:16px 18px;display:flex;flex-direction:column;gap:9px;font-size:14.5px;line-height:1.45">' +
          '<div><b style="color:#f2b23a">Rob</b> — click a suit for a timing minigame, or hold up banks &amp; stores (takes time, draws cops). Richer side = bigger takes, more heat.</div>' +
          '<div><b style="color:#8ae05c">Grow</b> — buy a FOR SALE house in the hood (' + HOUSE_PRICE + 'g), plant pots, harvest weed. Level the house for more pots.</div>' +
          '<div><b style="color:#e86a8a">Provide</b> — carry weed &amp; rare goods to the shelter for hood points. Points reset each cycle; the leaderboard remembers everything.</div>' +
          '<div><b style="color:#ff9a8a">Cops</b> — they patrol the rich side and hunt harder the hotter you are, but they <b>never enter the hood</b>. Caught = lose your bag and a cut of your gold. Toggle <b>RUN</b> to sprint home (drains energy).</div>' +
          '<div class="dim" style="font-size:12px">Click to move · WASD pans the camera · Shift toggles run · cycles last ' + Math.round(CYCLE_SEC / 60) + ' minutes.</div>' +
          '<button data-act="dismissHelp" class="btn btn-gold" style="margin-top:4px;font-size:16px;padding:9px">Hit the streets</button></div></div>';
      }
      if (html) { el.innerHTML = html; el.classList.remove('hidden'); }
      else { el.classList.add('hidden'); el.innerHTML = ''; }
    }
  }

  // ============================================================
  // boot: auth flow
  // ============================================================
  let mode = 'login';
  const aErr = $('a-err'), aUser = $('a-user'), aPass = $('a-pass'), aSubmit = $('a-submit');

  $('a-swap').addEventListener('click', (e) => {
    e.preventDefault();
    mode = mode === 'login' ? 'register' : 'login';
    aSubmit.textContent = mode === 'login' ? 'Log in' : 'Create account';
    $('a-swap-txt').textContent = mode === 'login' ? 'New in the hood?' : 'Already got a name out here?';
    $('a-swap').textContent = mode === 'login' ? 'Create an account' : 'Log in instead';
    aErr.textContent = '';
  });

  async function startGame(profile) {
    let saved = null;
    try {
      const data = await RHApi.getState();
      saved = data.state;
    } catch (e) {
      if (e.status === 401) { RHApi.setToken(null); $('auth').classList.remove('hidden'); return; }
    }
    $('auth').classList.add('hidden');
    window.RHGame = new Game(profile, saved);
  }

  async function submit() {
    const username = aUser.value.trim(), password = aPass.value;
    if (!username || !password) { aErr.textContent = 'Fill in both fields'; return; }
    aSubmit.disabled = true;
    aErr.textContent = '';
    try {
      const res = mode === 'login' ? await RHApi.login(username, password) : await RHApi.register(username, password);
      RHApi.setToken(res.token);
      await startGame({ username: res.username, wallet: res.wallet || '' });
    } catch (e) {
      aErr.textContent = e.message;
    }
    aSubmit.disabled = false;
  }
  aSubmit.addEventListener('click', submit);
  aPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  aUser.addEventListener('keydown', (e) => { if (e.key === 'Enter') aPass.focus(); });

  // auto-login with stored session
  if (RHApi.token()) {
    RHApi.me().then((me) => startGame({ username: me.username, wallet: me.wallet || '' }))
      .catch(() => { RHApi.setToken(null); });
  }
})();
