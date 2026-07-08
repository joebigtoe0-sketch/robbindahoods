/* ============================================================
   Robbin' the Hood — city art library (window.RHArt)
   Same iso system as BRArt: 1 unit = one tile; iso(x,y) => px.
   ============================================================ */
(function () {
  const TW = 32, TH = 16;
  const iso0 = (x, y) => ({ x: (x - y) * TW, y: (x + y) * TH });

  function hash(x, y, s) { const n = Math.sin(x * 127.1 + y * 311.7 + (s || 0) * 74.7) * 43758.5453; return n - Math.floor(n); }
  function parseCol(c) {
    if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    const m = c.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
  }
  function mul(c, f) { const [r, g, b] = parseCol(c); const cl = v => Math.max(0, Math.min(255, Math.round(v * f))); return 'rgb(' + cl(r) + ',' + cl(g) + ',' + cl(b) + ')'; }
  function mix(c1, c2, tt) { const a = parseCol(c1), b = parseCol(c2); const ch = i => Math.round(a[i] + (b[i] - a[i]) * tt); return 'rgb(' + ch(0) + ',' + ch(1) + ',' + ch(2) + ')'; }

  function cube(ctx, iso, wx, wy, wd, dd, h, elev, base, faces) {
    const top = (faces && faces.top) || mul(base, 1.0);
    const left = (faces && faces.left) || mul(base, 0.55);
    const right = (faces && faces.right) || mul(base, 0.78);
    const c1 = iso(wx, wy), c2 = iso(wx + wd, wy), c3 = iso(wx + wd, wy + dd), c4 = iso(wx, wy + dd);
    const e = elev, hh = elev + h;
    ctx.fillStyle = right;
    ctx.beginPath(); ctx.moveTo(c2.x, c2.y - hh); ctx.lineTo(c3.x, c3.y - hh); ctx.lineTo(c3.x, c3.y - e); ctx.lineTo(c2.x, c2.y - e); ctx.closePath(); ctx.fill();
    ctx.fillStyle = left;
    ctx.beginPath(); ctx.moveTo(c4.x, c4.y - hh); ctx.lineTo(c3.x, c3.y - hh); ctx.lineTo(c3.x, c3.y - e); ctx.lineTo(c4.x, c4.y - e); ctx.closePath(); ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath(); ctx.moveTo(c1.x, c1.y - hh); ctx.lineTo(c2.x, c2.y - hh); ctx.lineTo(c3.x, c3.y - hh); ctx.lineTo(c4.x, c4.y - hh); ctx.closePath(); ctx.fill();
  }
  function decalCorners(iso, wx, wy, du, axis, elev, h) {
    const p0 = iso(wx, wy);
    const p1 = axis === 'x' ? iso(wx + du, wy) : iso(wx, wy + du);
    return [
      { x: p0.x, y: p0.y - elev - h }, { x: p1.x, y: p1.y - elev - h },
      { x: p1.x, y: p1.y - elev }, { x: p0.x, y: p0.y - elev }
    ];
  }
  function decal(ctx, iso, wx, wy, du, axis, elev, h, col) {
    const c = decalCorners(iso, wx, wy, du, axis, elev, h);
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(c[1].x, c[1].y); ctx.lineTo(c[2].x, c[2].y); ctx.lineTo(c[3].x, c[3].y);
    ctx.closePath(); ctx.fill();
  }
  function decalFrame(ctx, iso, wx, wy, du, axis, elev, h, col, lw) {
    const c = decalCorners(iso, wx, wy, du, axis, elev, h);
    ctx.strokeStyle = col; ctx.lineWidth = lw || 1.6; ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(c[1].x, c[1].y); ctx.lineTo(c[2].x, c[2].y); ctx.lineTo(c[3].x, c[3].y);
    ctx.closePath(); ctx.stroke();
  }
  function diamond(ctx, iso, x, y, col) {
    const s = iso(x, y);
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + TW, s.y + TH); ctx.lineTo(s.x, s.y + TH * 2); ctx.lineTo(s.x - TW, s.y + TH); ctx.closePath(); ctx.fill();
  }
  function shadow(ctx, iso, x, y, rx, ry) {
    const s = iso(x, y);
    ctx.fillStyle = 'rgba(10,12,20,.25)'; ctx.beginPath(); ctx.ellipse(s.x, s.y, rx, ry, 0, 0, 7); ctx.fill();
  }
  function label(ctx, iso, wx, wy, txt, yOff, color) {
    const s = iso(wx, wy);
    ctx.font = "600 11px 'Pixelify Sans', monospace";
    const w = ctx.measureText(txt).width + 10;
    ctx.fillStyle = 'rgba(12,12,20,.82)'; ctx.fillRect(s.x - w / 2, s.y - yOff - 13, w, 16);
    ctx.fillStyle = color || '#f3e7cd'; ctx.textAlign = 'center';
    ctx.fillText(txt, s.x, s.y - yOff - 1); ctx.textAlign = 'left';
  }

  /* ================= ground tiles ================= */
  function tile(ctx, iso, x, y, type) {
    const h1 = hash(x, y, 1), h2 = hash(x, y, 2), h3 = hash(x, y, 3);
    const s = iso(x, y);
    if (type === 'lawn') { // rich manicured grass
      diamond(ctx, iso, x, y, ((x + y) & 1) ? '#6fc253' : '#66ba4b');
      if (h2 < 0.06) { ctx.fillStyle = '#e86a8a'; ctx.fillRect(s.x + (h3 - 0.5) * 22, s.y + 10 + h1 * 10, 3, 3); }
    } else if (type === 'grass') { // patchy mid grass
      diamond(ctx, iso, x, y, h1 < 0.5 ? '#7fae55' : '#77a54e');
      if (h2 < 0.18) { ctx.fillStyle = 'rgba(120,96,52,.5)'; ctx.beginPath(); ctx.ellipse(s.x + (h3 - 0.5) * 24, s.y + 14 + h1 * 8, 6, 3, 0, 0, 7); ctx.fill(); }
    } else if (type === 'dirt') { // hood bare ground
      diamond(ctx, iso, x, y, h1 < 0.5 ? '#9b7c50' : '#93744a');
      ctx.fillStyle = 'rgba(70,50,26,.3)';
      for (let i = 0; i < 2; i++) { const a = hash(x, y, 5 + i), b = hash(x, y, 9 + i); ctx.fillRect(s.x + (a - 0.5) * 36, s.y + 8 + b * 14, 3, 2); }
      if (h2 < 0.07) { ctx.fillStyle = 'rgba(180,180,175,.55)'; ctx.fillRect(s.x + (h3 - 0.5) * 20, s.y + 12 + h1 * 8, 4, 2); } // litter
    } else if (type === 'crack') { // cracked hood asphalt
      diamond(ctx, iso, x, y, h1 < 0.5 ? '#5c5a58' : '#565452');
      ctx.strokeStyle = 'rgba(20,18,16,.4)'; ctx.lineWidth = 1.2;
      if (h2 < 0.4) {
        const tx = s.x + (h3 - 0.5) * 26, ty = s.y + 8 + h1 * 12;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 6, ty + 4); ctx.lineTo(tx + 4, ty + 9); ctx.stroke();
      }
      if (h2 > 0.9) { ctx.fillStyle = 'rgba(110,160,70,.6)'; ctx.fillRect(s.x + (h3 - 0.5) * 22, s.y + 14, 2, 3); } // weed in crack
    } else if (type === 'walk') { // sidewalk
      diamond(ctx, iso, x, y, h1 < 0.5 ? '#b9b6ae' : '#b2afa7');
      ctx.strokeStyle = 'rgba(60,58,52,.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x - TW * 0.5, s.y + TH * 0.5); ctx.lineTo(s.x + TW * 0.5, s.y + TH * 1.5); ctx.stroke();
    } else if (type === 'roadx' || type === 'roady') { // asphalt w/ dashes
      diamond(ctx, iso, x, y, h1 < 0.5 ? '#3f3e3c' : '#3a3937');
      if ((type === 'roadx' ? x : y) % 2 === 0) {
        ctx.strokeStyle = 'rgba(230,190,70,.6)'; ctx.lineWidth = 2;
        const a = type === 'roadx' ? iso(x - 0.3, y + 0.5) : iso(x + 0.5, y - 0.3);
        const b = type === 'roadx' ? iso(x + 0.3, y + 0.5) : iso(x + 0.5, y + 0.3);
        ctx.beginPath(); ctx.moveTo(a.x, a.y + TH); ctx.lineTo(b.x, b.y + TH); ctx.stroke();
      }
    } else if (type === 'plaza') {
      diamond(ctx, iso, x, y, h1 < 0.5 ? '#a89f8d' : '#a19886');
    } else {
      diamond(ctx, iso, x, y, '#77a54e');
    }
  }

  /* ================= props ================= */
  function lamp(ctx, iso, o, t) {
    cube(ctx, iso, o.x - 0.05, o.y - 0.05, 0.1, 0.1, 26, 0, '#3a3f45');
    cube(ctx, iso, o.x - 0.12, o.y - 0.12, 0.24, 0.24, 3, 26, '#f2d98a');
    const s = iso(o.x, o.y);
    ctx.fillStyle = 'rgba(255,225,140,.14)'; ctx.beginPath(); ctx.ellipse(s.x, s.y - 24, 13, 8, 0, 0, 7); ctx.fill();
  }
  function hydrant(ctx, iso, o) {
    shadow(ctx, iso, o.x, o.y, 6, 3);
    cube(ctx, iso, o.x - 0.09, o.y - 0.09, 0.18, 0.18, 6, 0, '#c33a2e');
    cube(ctx, iso, o.x - 0.05, o.y - 0.05, 0.1, 0.1, 2, 6, '#d84a3c');
  }
  function trash(ctx, iso, o, knocked) {
    shadow(ctx, iso, o.x, o.y, 8, 4);
    if (knocked) { cube(ctx, iso, o.x - 0.3, o.y - 0.12, 0.6, 0.24, 4, 0, '#6a7076'); return; }
    cube(ctx, iso, o.x - 0.14, o.y - 0.14, 0.28, 0.28, 8, 0, '#6a7076');
    cube(ctx, iso, o.x - 0.16, o.y - 0.16, 0.32, 0.32, 1.6, 8, '#7d848a');
  }
  function dumpster(ctx, iso, o) {
    shadow(ctx, iso, o.x, o.y + 0.1, 18, 8);
    cube(ctx, iso, o.x - 0.55, o.y - 0.32, 1.1, 0.64, 10, 0, '#3f7042');
    cube(ctx, iso, o.x - 0.57, o.y - 0.34, 1.14, 0.32, 2.5, 10, '#4a8050');
    cube(ctx, iso, o.x - 0.57, o.y + 0.02, 1.14, 0.32, 2.5, 11.5, '#4a8050');
    decal(ctx, iso, o.x - 0.4, o.y + 0.321, 0.5, 'x', 3, 4, 'rgba(240,235,220,.25)'); // graffiti
  }
  function barrelFire(ctx, iso, o, t) {
    shadow(ctx, iso, o.x, o.y, 8, 4);
    cube(ctx, iso, o.x - 0.14, o.y - 0.14, 0.28, 0.28, 9, 0, '#5a4a3a');
    decal(ctx, iso, o.x - 0.14, o.y + 0.141, 0.28, 'x', 2, 1.2, '#3a2f24');
    decal(ctx, iso, o.x - 0.14, o.y + 0.141, 0.28, 'x', 6, 1.2, '#3a2f24');
    const s = iso(o.x, o.y);
    const f = Math.sin((t || 0) * 7 + o.x) * 1.5;
    ctx.fillStyle = 'rgba(240,140,50,.9)'; ctx.beginPath();
    ctx.moveTo(s.x - 4, s.y - 9); ctx.quadraticCurveTo(s.x - 5 + f, s.y - 16, s.x, s.y - 19 + f);
    ctx.quadraticCurveTo(s.x + 5 + f, s.y - 15, s.x + 4, s.y - 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,110,.9)'; ctx.beginPath();
    ctx.moveTo(s.x - 2, s.y - 9); ctx.quadraticCurveTo(s.x + f, s.y - 13, s.x + 1, s.y - 15 + f * 0.5);
    ctx.quadraticCurveTo(s.x + 2.5, s.y - 12, s.x + 2, s.y - 9); ctx.closePath(); ctx.fill();
  }
  function hedge(ctx, iso, o) {
    cube(ctx, iso, o.x - 0.4, o.y - 0.18, 0.8, 0.36, 7, 0, '#3f8f3c');
    cube(ctx, iso, o.x - 0.36, o.y - 0.14, 0.72, 0.28, 2, 7, '#4da349');
  }
  function fountain(ctx, iso, o, t) {
    shadow(ctx, iso, o.x, o.y + 0.1, 20, 9);
    cube(ctx, iso, o.x - 0.6, o.y - 0.6, 1.2, 1.2, 4, 0, '#b9b6ae');
    const s = iso(o.x, o.y);
    ctx.fillStyle = '#7ec2e8'; ctx.beginPath(); ctx.ellipse(s.x, s.y - 4, 22, 11, 0, 0, 7); ctx.fill();
    cube(ctx, iso, o.x - 0.08, o.y - 0.08, 0.16, 0.16, 8, 4, '#a8a49c');
    const sp = 2 + Math.sin((t || 0) * 5) * 1.4;
    ctx.strokeStyle = 'rgba(190,230,255,.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y - 12); ctx.quadraticCurveTo(s.x - 6, s.y - 12 - sp * 2, s.x - 8, s.y - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x, s.y - 12); ctx.quadraticCurveTo(s.x + 6, s.y - 12 - sp * 2, s.x + 8, s.y - 5); ctx.stroke();
  }
  function weedPot(ctx, iso, o, t) {
    // o.stage: 0..1 growth; o.ready bool
    const gx = o.x, gy = o.y, st = o.stage || 0;
    shadow(ctx, iso, gx, gy, 6, 3);
    cube(ctx, iso, gx - 0.11, gy - 0.11, 0.22, 0.22, 4.5, 0, '#a35c33');
    cube(ctx, iso, gx - 0.13, gy - 0.13, 0.26, 0.26, 1.4, 4.5, '#b56a3c');
    const s = iso(gx, gy);
    if (st <= 0.02) { // fresh soil
      ctx.fillStyle = '#4a3826'; ctx.beginPath(); ctx.ellipse(s.x, s.y - 5.5, 4, 2, 0, 0, 7); ctx.fill();
      return;
    }
    const hgt = 4 + st * 14;
    const sway = Math.sin((t || 0) * 1.8 + gx * 3) * st * 1.2;
    ctx.strokeStyle = '#3f7d2e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y - 6); ctx.quadraticCurveTo(s.x + sway, s.y - 6 - hgt * 0.6, s.x + sway, s.y - 6 - hgt); ctx.stroke();
    // fan leaves
    const nl = Math.max(2, Math.round(st * 6));
    for (let i = 0; i < nl; i++) {
      const lh = s.y - 7 - (i + 1) / nl * hgt;
      const side = i % 2 ? 1 : -1, ll = (3 + st * 5) * (1 - i / (nl + 2));
      ctx.strokeStyle = o.ready ? '#6dc93e' : '#54a336'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x + sway * (i / nl), lh);
      ctx.lineTo(s.x + sway * (i / nl) + side * ll, lh - 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x + sway * (i / nl), lh);
      ctx.lineTo(s.x + sway * (i / nl) + side * ll * 0.7, lh - 4); ctx.stroke();
    }
    if (o.ready) {
      const a = 0.5 + 0.4 * Math.sin((t || 0) * 3 + gx);
      ctx.fillStyle = 'rgba(140,240,90,' + a.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(s.x + sway, s.y - 8 - hgt, 2.5, 0, 7); ctx.fill();
    }
  }
  function pickup(ctx, iso, o, t) {
    const s = iso(o.x, o.y);
    const bob = Math.sin((t || 0) * 2.5 + o.x * 2) * 2;
    shadow(ctx, iso, o.x, o.y, 7, 3.5);
    cube(ctx, iso, o.x - 0.12, o.y - 0.12, 0.24, 0.24, 4, 4 + bob * 0.3, o.color || '#c9b896');
    const a = 0.4 + 0.5 * Math.abs(Math.sin((t || 0) * 2.2 + o.y));
    ctx.strokeStyle = 'rgba(255,250,220,' + a.toFixed(2) + ')'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(s.x - 3, s.y - 16 - bob); ctx.lineTo(s.x - 3, s.y - 10 - bob);
    ctx.moveTo(s.x - 6, s.y - 13 - bob); ctx.lineTo(s.x, s.y - 13 - bob);
    ctx.stroke();
    if (o.label) label(ctx, iso, o.x, o.y, o.label, 24, '#ffe9a8');
  }

  /* ================= buildings ================= */
  function bank(ctx, iso, o, t) {
    const gx = o.x, gy = o.y;
    shadow(ctx, iso, gx, gy + 0.5, 58, 24);
    cube(ctx, iso, gx - 1.5, gy - 1.3, 3, 2.6, 4, 0, '#b9b6ae'); // steps
    cube(ctx, iso, gx - 1.35, gy - 1.15, 2.7, 2.3, 26, 4, '#d8d2c2'); // body
    // columns on front (+y)
    for (const cx of [-1.05, -0.45, 0.35, 0.95]) cube(ctx, iso, gx + cx, gy + 1.02, 0.16, 0.14, 24, 4, '#e8e2d2');
    // door
    decal(ctx, iso, gx - 0.3, gy + 1.151, 0.6, 'x', 4, 14, '#3a3428');
    // pediment
    cube(ctx, iso, gx - 1.5, gy - 1.3, 3, 2.6, 5, 30, '#c9c3b3');
    cube(ctx, iso, gx - 1.1, gy - 0.95, 2.2, 1.9, 4, 35, '#d8d2c2');
    // gold $ sign
    const s = iso(gx, gy + 1.15);
    ctx.font = "700 15px 'Pixelify Sans', monospace";
    ctx.fillStyle = '#f2b23a'; ctx.textAlign = 'center';
    ctx.fillText('$', s.x, s.y - 26); ctx.textAlign = 'left';
    if (o.label) label(ctx, iso, gx, gy, o.label, 52, '#f2b23a');
  }
  function jewel(ctx, iso, o, t) {
    const gx = o.x, gy = o.y;
    shadow(ctx, iso, gx, gy + 0.4, 42, 17);
    cube(ctx, iso, gx - 1.0, gy - 0.8, 2.0, 1.6, 20, 0, '#e2ddd0');
    // display window w/ sparkle
    decal(ctx, iso, gx - 0.7, gy + 0.801, 0.9, 'x', 5, 10, '#9adbe8');
    decalFrame(ctx, iso, gx - 0.7, gy + 0.801, 0.9, 'x', 5, 10, '#5a4a6a', 1.6);
    decal(ctx, iso, gx + 0.3, gy + 0.801, 0.4, 'x', 4, 12, '#4a3a5a'); // door
    const s = iso(gx - 0.25, gy + 0.8);
    const a = 0.4 + 0.5 * Math.abs(Math.sin((t || 0) * 3 + gx));
    ctx.strokeStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(s.x, s.y - 13); ctx.lineTo(s.x, s.y - 7); ctx.moveTo(s.x - 3, s.y - 10); ctx.lineTo(s.x + 3, s.y - 10); ctx.stroke();
    // teal awning
    cube(ctx, iso, gx - 1.1, gy + 0.55, 2.2, 0.5, 3, 17, '#3aa8a0');
    cube(ctx, iso, gx - 1.12, gy - 0.92, 2.24, 1.84, 4, 20, '#b8b2a2'); // roof
    if (o.label) label(ctx, iso, gx, gy, o.label, 40, '#7fe0d8');
  }
  function store(ctx, iso, o, t) {
    const gx = o.x, gy = o.y;
    shadow(ctx, iso, gx, gy + 0.4, 44, 18);
    cube(ctx, iso, gx - 1.1, gy - 0.85, 2.2, 1.7, 18, 0, '#c98d4f');
    decal(ctx, iso, gx - 0.75, gy + 0.851, 0.8, 'x', 4, 9, '#8ad0e8'); // window
    decalFrame(ctx, iso, gx - 0.75, gy + 0.851, 0.8, 'x', 4, 9, '#5e3d26', 1.5);
    decal(ctx, iso, gx + 0.25, gy + 0.851, 0.42, 'x', 3.5, 11, '#4a3020'); // door
    // striped awning
    for (let i = 0; i < 4; i++) cube(ctx, iso, gx - 1.15 + i * 0.58, gy + 0.6, 0.58, 0.45, 3, 14.5, i % 2 ? '#e8e0cc' : '#c9573f');
    cube(ctx, iso, gx - 1.22, gy - 0.95, 2.44, 1.9, 4, 18, '#a5764a');
    // roof sign
    cube(ctx, iso, gx - 0.5, gy - 0.4, 1.0, 0.1, 7, 22, '#2a2620');
    const s = iso(gx, gy - 0.35);
    ctx.font = "700 10px 'Pixelify Sans', monospace";
    ctx.fillStyle = (Math.sin((t || 0) * 4) > -0.3) ? '#ffe9a8' : '#8a7f5f'; ctx.textAlign = 'center';
    ctx.fillText('24/7', s.x, s.y - 43); ctx.textAlign = 'left';
    if (o.label) label(ctx, iso, gx, gy, o.label, 40, '#ffce7a');
  }
  function mansion(ctx, iso, o, t) {
    const gx = o.x, gy = o.y;
    shadow(ctx, iso, gx, gy + 0.5, 54, 22);
    cube(ctx, iso, gx - 1.3, gy - 1.05, 2.6, 2.1, 22, 0, '#efe8d8');
    // grand door + windows
    decal(ctx, iso, gx - 0.25, gy + 1.051, 0.5, 'x', 3, 13, '#5a4632');
    decalFrame(ctx, iso, gx - 0.25, gy + 1.051, 0.5, 'x', 3, 13, '#c9b27a', 1.6);
    for (const wx of [-0.95, 0.5]) {
      decal(ctx, iso, gx + wx, gy + 1.051, 0.4, 'x', 8, 8, '#aee0f2');
      decalFrame(ctx, iso, gx + wx, gy + 1.051, 0.4, 'x', 8, 8, '#8a7a5a', 1.4);
    }
    decal(ctx, iso, gx + 1.301, gy - 0.6, 0.5, 'y', 9, 8, '#aee0f2');
    decalFrame(ctx, iso, gx + 1.301, gy - 0.6, 0.5, 'y', 9, 8, '#8a7a5a', 1.4);
    // roof + gold trim
    cube(ctx, iso, gx - 1.45, gy - 1.2, 2.9, 2.4, 5, 22, '#6a7d8f');
    cube(ctx, iso, gx - 1.0, gy - 0.8, 2.0, 1.6, 5, 27, '#7a8da0');
    cube(ctx, iso, gx - 0.08, gy - 0.08, 0.16, 0.16, 5, 32, '#f2b23a');
    if (o.label) label(ctx, iso, gx, gy, o.label, 48, '#c9d8e8');
  }
  function hoodHouse(ctx, iso, o, t) {
    // o.level: 0 = derelict/for-sale, 1..5 owned; o.mine; o.owner label
    const gx = o.x, gy = o.y, lv = o.level || 0;
    shadow(ctx, iso, gx, gy + 0.4, 42, 17);
    const wall = lv === 0 ? '#8a7a66' : (o.mine ? '#7a9a6e' : '#9a8a72');
    cube(ctx, iso, gx - 1.0, gy - 0.8, 2.0, 1.6, 16, 0, wall);
    // door
    decal(ctx, iso, gx - 0.55, gy + 0.801, 0.42, 'x', 2.5, 11, '#4a3a2a');
    // window: boarded when derelict, glowing grow-light when leveled
    if (lv === 0) {
      decal(ctx, iso, gx + 0.15, gy + 0.801, 0.55, 'x', 6, 7, '#3a3228');
      const c = decalCorners(iso, gx + 0.15, gy + 0.801, 0.55, 'x', 6, 7);
      ctx.strokeStyle = '#7a6a52'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(c[2].x, c[2].y); ctx.moveTo(c[1].x, c[1].y); ctx.lineTo(c[3].x, c[3].y); ctx.stroke();
    } else {
      const gl = 0.55 + 0.25 * Math.sin((t || 0) * 2.2 + gx);
      decal(ctx, iso, gx + 0.15, gy + 0.801, 0.55, 'x', 6, 7, lv >= 3 ? 'rgba(200,120,240,' + gl.toFixed(2) + ')' : 'rgba(255,220,130,' + gl.toFixed(2) + ')');
      decalFrame(ctx, iso, gx + 0.15, gy + 0.801, 0.55, 'x', 6, 7, '#4a3a2a', 1.5);
    }
    // roof — improves with level
    cube(ctx, iso, gx - 1.15, gy - 0.92, 2.3, 1.84, 4, 16, lv >= 2 ? '#5e6e7e' : '#6e5a44');
    if (lv === 0) decal(ctx, iso, gx - 0.6, gy + 0.802, 0.5, 'x', 13, 3, 'rgba(40,32,22,.5)'); // roof hole patch
    if (lv >= 2) cube(ctx, iso, gx + 0.55, gy - 0.55, 0.05, 0.05, 9, 20, '#3a3f45'); // antenna
    if (lv >= 4) { // rooftop planter box
      cube(ctx, iso, gx - 0.55, gy - 0.5, 0.5, 0.35, 3, 20, '#a35c33');
      weedPot(ctx, iso, { x: gx - 0.3, y: gy - 0.33, stage: 0.9, ready: false }, t);
    }
    if (o.mine && lv >= 1) { // leaf sign over the door
      const s = iso(gx - 0.34, gy + 0.8);
      ctx.font = "700 11px 'Pixelify Sans', monospace";
      ctx.fillStyle = '#8ae05c'; ctx.textAlign = 'center';
      ctx.fillText('☘', s.x, s.y - 16); ctx.textAlign = 'left';
    }
    if (o.label) label(ctx, iso, gx, gy, o.label, 38, o.mine ? '#8ae05c' : (lv === 0 ? '#ffce7a' : '#c9b896'));
  }
  function shelter(ctx, iso, o, t) {
    const gx = o.x, gy = o.y;
    shadow(ctx, iso, gx, gy + 0.5, 62, 26);
    // big canvas tent — stepped A-frame
    cube(ctx, iso, gx - 1.6, gy - 1.2, 3.2, 2.4, 8, 0, '#7a6e5a');
    cube(ctx, iso, gx - 1.45, gy - 1.05, 2.9, 2.1, 8, 8, '#8a7c64');
    cube(ctx, iso, gx - 1.1, gy - 0.8, 2.2, 1.6, 8, 16, '#9a8a6e');
    cube(ctx, iso, gx - 0.7, gy - 0.5, 1.4, 1.0, 7, 24, '#a89877');
    // entrance flap
    decal(ctx, iso, gx - 0.45, gy + 1.201, 0.9, 'x', 0, 12, '#4a4032');
    // heart sign
    const s = iso(gx, gy + 1.2);
    ctx.font = "700 13px 'Pixelify Sans', monospace";
    ctx.fillStyle = '#e86a8a'; ctx.textAlign = 'center';
    ctx.fillText('♥', s.x, s.y - 16); ctx.textAlign = 'left';
    // sleeping bags outside
    cube(ctx, iso, gx - 1.9, gy + 0.9, 0.7, 0.3, 2.5, 0, '#5a6e9a');
    cube(ctx, iso, gx + 1.4, gy + 0.7, 0.7, 0.3, 2.5, 0, '#9a5a6e');
    if (o.label) label(ctx, iso, gx, gy, o.label, 46, '#e86a8a');
  }
  function dealerVan(ctx, iso, o, t) {
    const gx = o.x, gy = o.y;
    shadow(ctx, iso, gx, gy + 0.2, 30, 13);
    // wheels
    cube(ctx, iso, gx - 0.55, gy - 0.3, 0.18, 0.18, 4, 0, '#1d1d20');
    cube(ctx, iso, gx + 0.4, gy - 0.3, 0.18, 0.18, 4, 0, '#1d1d20');
    cube(ctx, iso, gx - 0.55, gy + 0.15, 0.18, 0.18, 4, 0, '#1d1d20');
    cube(ctx, iso, gx + 0.4, gy + 0.15, 0.18, 0.18, 4, 0, '#1d1d20');
    // body
    cube(ctx, iso, gx - 0.75, gy - 0.35, 1.5, 0.7, 11, 3, '#6a5a8a');
    cube(ctx, iso, gx + 0.45, gy - 0.32, 0.3, 0.64, 7, 3, '#7a6a9a'); // cab
    decal(ctx, iso, gx + 0.751, gy - 0.25, 0.5, 'y', 6.5, 4, '#a8d8e8'); // windshield
    // spray tag on side
    decal(ctx, iso, gx - 0.6, gy + 0.351, 1.1, 'x', 5, 5, 'rgba(140,224,92,.85)');
    decal(ctx, iso, gx - 0.5, gy + 0.352, 0.9, 'x', 6.2, 2.4, 'rgba(40,30,60,.85)');
    if (o.label) label(ctx, iso, gx, gy, o.label, 30, '#c8a2f0');
  }

  /* ================= characters ================= */
  function person(ctx, iso, o, t) {
    // o.kind: player | suit | hood | cop | crowd
    const gx = o.x, gy = o.y, kind = o.kind || 'suit';
    const ph = o.ph || 0;
    const walking = !!o.moving;
    const runAmp = o.run ? 1.5 : 1;
    const sw = walking ? Math.sin(ph) * runAmp : 0;
    let bob = walking ? Math.abs(Math.cos(ph)) * 1.2 * runAmp : 0;
    let cheerUp = 0;
    if (o.cheer) { bob = Math.abs(Math.sin((t || 0) * 8 + gx * 5)) * 3.2; cheerUp = 1; }
    const skin = o.skin || '#e8c49a';
    let top = '#4a72c4', bottom = '#3f3542';
    if (kind === 'player') { top = '#4e9e3a'; bottom = '#3a3330'; }
    else if (kind === 'suit') { top = o.suit || '#2e3440'; bottom = o.suit || '#2e3440'; }
    else if (kind === 'cop') { top = '#2c4a7c'; bottom = '#22314e'; }
    else { top = o.top || '#8a4ac4'; bottom = o.bottom || '#4a4038'; }
    shadow(ctx, iso, gx, gy, 9, 4.5);
    // legs
    cube(ctx, iso, gx - 0.16 + sw * 0.03, gy - 0.11, 0.13, 0.2, 5, Math.max(0, sw) * 2.2, bottom);
    cube(ctx, iso, gx + 0.03 - sw * 0.03, gy - 0.11, 0.13, 0.2, 5, Math.max(0, -sw) * 2.2, bottom);
    // torso
    cube(ctx, iso, gx - 0.195, gy - 0.145, 0.39, 0.29, 2, 5 + bob, mul(bottom, 0.8));
    cube(ctx, iso, gx - 0.19, gy - 0.14, 0.38, 0.28, 8, 7 + bob, top);
    if (kind === 'suit') { // shirt + tie on the front face
      decal(ctx, iso, gx - 0.06, gy + 0.141, 0.12, 'x', 8 + bob, 6, '#e8e4da');
      decal(ctx, iso, gx - 0.025, gy + 0.142, 0.05, 'x', 8 + bob, 5, o.tie || '#a03030');
    }
    if (kind === 'cop') { // badge + belt
      decal(ctx, iso, gx - 0.13, gy + 0.141, 0.06, 'x', 11 + bob, 2.5, '#f2c94c');
      decal(ctx, iso, gx - 0.19, gy + 0.142, 0.38, 'x', 7 + bob, 1.6, '#17130c');
    }
    if (kind === 'player') { // hoodie pocket + drawstrings
      decal(ctx, iso, gx - 0.1, gy + 0.141, 0.2, 'x', 7.5 + bob, 3, mul(top, 0.85));
      decal(ctx, iso, gx - 0.05, gy + 0.142, 0.02, 'x', 11 + bob, 4, '#e8e4da');
      decal(ctx, iso, gx + 0.03, gy + 0.143, 0.02, 'x', 11 + bob, 4, '#e8e4da');
    }
    // arms — raised when cheering
    const armSw = walking ? sw * 0.045 : 0;
    if (cheerUp) {
      cube(ctx, iso, gx - 0.28, gy - 0.1, 0.09, 0.18, 6, 13 + bob, mul(top, 0.92));
      cube(ctx, iso, gx - 0.28, gy - 0.1, 0.09, 0.18, 2.5, 19 + bob, skin);
      cube(ctx, iso, gx + 0.19, gy - 0.1, 0.09, 0.18, 6, 13 + bob, mul(top, 0.92));
      cube(ctx, iso, gx + 0.19, gy - 0.1, 0.09, 0.18, 2.5, 19 + bob, skin);
    } else {
      cube(ctx, iso, gx - 0.28 - armSw, gy - 0.1, 0.09, 0.2, 2.5, 5.5 + bob, skin);
      cube(ctx, iso, gx - 0.28 - armSw, gy - 0.1, 0.09, 0.2, 6, 8 + bob, mul(top, 0.92));
      cube(ctx, iso, gx + 0.19 + armSw, gy - 0.1, 0.09, 0.2, 2.5, 5.5 + bob, skin);
      cube(ctx, iso, gx + 0.19 + armSw, gy - 0.1, 0.09, 0.2, 6, 8 + bob, mul(top, 0.92));
      if (kind === 'suit') { // briefcase in hand
        cube(ctx, iso, gx + 0.21 + armSw, gy + 0.12, 0.16, 0.08, 5, 3.5 + bob, '#5a4632');
      }
    }
    // head
    cube(ctx, iso, gx - 0.14, gy - 0.11, 0.28, 0.22, 8, 15 + bob, skin);
    const fc = iso(gx, gy + 0.11);
    ctx.fillStyle = '#241608';
    ctx.fillRect(fc.x - 4, fc.y - 20 - bob, 2.2, 3);
    ctx.fillRect(fc.x + 2, fc.y - 20 - bob, 2.2, 3);
    // headgear
    if (kind === 'player') { // hood up
      cube(ctx, iso, gx - 0.17, gy - 0.14, 0.34, 0.26, 4, 21 + bob, top);
      cube(ctx, iso, gx - 0.17, gy - 0.14, 0.34, 0.08, 8, 15 + bob, top);
    } else if (kind === 'cop') { // cap + brim
      cube(ctx, iso, gx - 0.15, gy - 0.12, 0.3, 0.24, 3, 23 + bob, '#22314e');
      cube(ctx, iso, gx - 0.15, gy + 0.1, 0.3, 0.14, 1.2, 22.4 + bob, '#17203a');
      if (o.alert) { // flashing light overhead
        const on = Math.sin((t || 0) * 12) > 0;
        const s2 = iso(gx, gy);
        ctx.fillStyle = on ? '#e84a4a' : '#4a7ce8';
        ctx.beginPath(); ctx.arc(s2.x, s2.y - 34 - bob, 3, 0, 7); ctx.fill();
      }
    } else if (kind === 'suit') { // slick hair
      cube(ctx, iso, gx - 0.145, gy - 0.115, 0.29, 0.23, 2.4, 23 + bob, o.hair || '#3a3226');
    } else { // beanie / cap variety
      const seed = Math.floor(hash(gx, o.seed || 1, 3) * 3);
      const bc = ['#c33a2e', '#3a3f45', '#8a4ac4'][seed];
      cube(ctx, iso, gx - 0.148, gy - 0.118, 0.296, 0.236, 2.8, 23 + bob, bc);
    }
    if (o.zzz) { // sleeping z's
      const s3 = iso(gx, gy);
      ctx.font = "700 10px 'Pixelify Sans', monospace";
      ctx.fillStyle = 'rgba(240,235,220,.7)';
      const zph = ((t || 0) * 0.6 + gx) % 1;
      ctx.fillText('z', s3.x + 8, s3.y - 30 - zph * 8);
    }
    if (o.label) label(ctx, iso, gx, gy, o.label, 40, o.labelColor || '#fff');
  }

  function drawObj(ctx, iso, o, opts) {
    opts = opts || {};
    const t = opts.t || 0;
    switch (o.t) {
      case 'lamp': return lamp(ctx, iso, o, t);
      case 'hydrant': return hydrant(ctx, iso, o);
      case 'trash': return trash(ctx, iso, o, o.knocked);
      case 'dumpster': return dumpster(ctx, iso, o);
      case 'barrel': return barrelFire(ctx, iso, o, t);
      case 'hedge': return hedge(ctx, iso, o);
      case 'fountain': return fountain(ctx, iso, o, t);
      case 'weedpot': return weedPot(ctx, iso, o, t);
      case 'pickup': return pickup(ctx, iso, o, t);
      case 'bank': return bank(ctx, iso, o, t);
      case 'jewel': return jewel(ctx, iso, o, t);
      case 'store': return store(ctx, iso, o, t);
      case 'mansion': return mansion(ctx, iso, o, t);
      case 'hoodhouse': return hoodHouse(ctx, iso, o, t);
      case 'shelter': return shelter(ctx, iso, o, t);
      case 'van': return dealerVan(ctx, iso, o, t);
      case 'person': return person(ctx, iso, o, t);
    }
  }

  window.RHArt = { iso: iso0, hash, mul, mix, cube, decal, decalFrame, decalCorners, diamond, shadow, label, tile, drawObj, weedPot, TW, TH };
})();
