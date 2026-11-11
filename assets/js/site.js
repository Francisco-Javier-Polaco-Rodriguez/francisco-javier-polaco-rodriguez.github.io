(() => {
  'use strict';
  const S = JSON.parse(document.getElementById('i18n').textContent);
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');

  /* ================================================================
     Type III burst animation.
     One cycle: flare -> beam along B0 -> Langmuir packets in the
     turbulent region -> radio fronts from the source.
     ================================================================ */
  const cv = document.getElementById('burst');
  if (cv) {
    const ctx = cv.getContext('2d');
    const btn = document.querySelector('.burst-toggle');
    const T = 16;            // cycle length [s]
    const STATIC_T = 11.5;   // frame shown when motion is reduced
    let W = 0, H = 0, k = 1; // css size, scale factor vs 1200px reference
    let col = {};
    let lines = [], main = null, src = null, earth = null, sats = [];
    let st = null, t = 0, cycle = 0;
    let playing = !reduceMQ.matches, onScreen = true, last = 0, raf = 0;

    const rgba = (hex, a) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
    };
    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      for (const n of ['bg', 'ink', 'ink-2', 'line', 'accent', 'beam', 'langmuir', 'z', 'radio'])
        col[n] = cs.getPropertyValue('--' + n).trim();
      col.dark = darkMQ.matches && document.documentElement.dataset.theme !== 'light';
    }
    function rng(seed) {
      return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let r = Math.imul(seed ^ seed >>> 15, 1 | seed);
        r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
        return ((r ^ r >>> 14) >>> 0) / 4294967296;
      };
    }
    const gauss = (R) => { let u = 0, v = 0; while (!u) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * v); };
    const smooth = (a, b, x) => { const y = Math.min(1, Math.max(0, (x - a) / (b - a))); return y * y * (3 - 2 * y); };

    // ---------- geometry: cubic Bézier field lines with arc-length lookup
    function curve(p0, p1, p2, p3) {
      const N = 320, pts = [], len = [0];
      for (let i = 0; i <= N; i++) {
        const s = i / N, u = 1 - s;
        pts.push([
          u * u * u * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * p3[0],
          u * u * u * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * p3[1]]);
        if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      }
      return { pts, len, total: len[N] };
    }
    function at(c, s) {
      s = Math.min(1, Math.max(0, s));
      const L = s * c.total, len = c.len;
      let lo = 0, hi = len.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] < L) lo = m; else hi = m; }
      const f = (L - len[lo]) / ((len[hi] - len[lo]) || 1);
      const a = c.pts[lo], b = c.pts[hi];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n;
      return { x: a[0] + f * (b[0] - a[0]), y: a[1] + f * (b[1] - a[1]), tx, ty, nx: -ty, ny: tx };
    }

    function layout() {
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height; k = Math.max(.55, Math.min(1.25, W / 1200));
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const R = Math.min(H * .36, Math.max(56, W * .1));
      const sun = { x: R * .15, y: H * .7, R };
      lines = [];
      const mk = (ang, dy, bend) => {
        const p0 = [sun.x + R * Math.cos(ang), sun.y + R * Math.sin(ang)];
        return curve(p0, [p0[0] + W * .1, p0[1] - H * (.12 + bend)], [W * .48, H * (.42 + dy)], [W * 1.04, H * (.44 + dy)]);
      };
      lines.push(mk(-1.2, -.1, .1), mk(-.85, -.04, .04), mk(-.5, .1, -.04), mk(-.2, .24, -.14));
      main = lines[1];
      const c = at(main, .64);
      src = { x: c.x, y: c.y + H * .04, rx: Math.max(78, W * .14), ry: Math.max(50, H * .24), ang: Math.atan2(c.ty, c.tx) * .5, sun };
      const Re = Math.max(16, Math.min(34, H * .1));
      earth = W < 640 ? { x: W - Re - 10, y: Re + 10, R: Re * .85 } : { x: W - Math.max(46, W * .055), y: Math.max(Re + 16, H * .16), R: Re };
      const small = W < 640;
      // both probes sit inside the radio source, on the beam path
      const so = at(main, .7), pp = at(main, .57);
      sats = [
        { name: small ? 'SolO' : 'Solar Orbiter', kind: 'solo', s: .7, x: so.x + so.nx * src.ry * .42, y: so.y + so.ny * src.ry * .42 },
        { name: small ? 'PSP' : 'Parker Solar Probe', kind: 'psp', s: .57, above: true, x: pp.x - pp.nx * src.ry * .3, y: pp.y - pp.ny * src.ry * .3 },
      ];
      reset(cycle);
    }

    const inSrc = (x, y, f = 1) => {
      const ca = Math.cos(-src.ang), sa = Math.sin(-src.ang);
      const dx = x - src.x, dy = y - src.y;
      const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
      return (u * u) / (src.rx * src.rx * f * f) + (v * v) / (src.ry * src.ry * f * f);
    };

    // ---------- per-cycle state (seeded so every cycle differs but is reproducible)
    function reset(n) {
      const R = rng(9973 * n + 17);
      const nb = W < 640 ? 110 : 190;
      const beam = Array.from({ length: nb }, () => ({
        t0: .6 + Math.abs(gauss(R)) * .9, v: .072 + R() * .05, off: gauss(R),
      }));
      const lang = [];
      const nl = W < 640 ? 46 : 80;
      for (let i = 0; i < nl; i++) {
        const near = R() < .62;
        const s = near ? .64 + gauss(R) * .07 : .28 + R() * .7;
        const p = at(main, s);
        const spread = inSrc(p.x, p.y) < 1.4 ? src.ry * .55 : 12 * k;
        const off = gauss(R) * spread;
        const x = p.x + p.nx * off, y = p.y + p.ny * off;
        // packets inside the source live long enough to cover the radio emission
        const life = inSrc(x, y) < 1 ? 4.5 + R() * 2.5 : 2 + R() * 1.6;
        lang.push({ x, y, th: Math.atan2(p.ty, p.tx) + gauss(R) * .5, tb: 1.2 + s / .095 + R() * 1.4, life, ph: R() * 6.28 });
      }
      const inner = lang.filter((L) => inSrc(L.x, L.y) < .8);
      const fronts = [];
      const nf = 7;
      for (let i = 0; i < nf; i++) {
        const z = inner[Math.floor(R() * inner.length)] || { x: src.x, y: src.y };
        // most fronts head to Earth; the rest leave in other directions
        const r = R(), toE = Math.atan2(earth.y - z.y, earth.x - z.x);
        const dir = r < .55 ? toE + gauss(R) * .1 : r < .8 ? -Math.PI / 2 + gauss(R) * .45 : Math.PI * .3 + gauss(R) * .35;
        const dist = Math.hypot(earth.x - z.x, earth.y - z.y) - earth.R;
        const tb = 8.8 + i * .6 + R() * .4;
        fronts.push({ x0: z.x, y0: z.y, tb, dir, trc: r < .55 ? tb + dist / (85 * k) : Infinity });
      }
      const blobs = [];
      for (let i = 0; i < 16; i++) {
        const s = .3 + R() * .72, p = at(main, s), off = gauss(R) * H * .22;
        blobs.push({ x: p.x + p.nx * off, y: p.y + p.ny * off, r: (26 + R() * 46) * k, a: .05 + R() * .07, w: R() * 6.28, sign: R() < .5 ? 1 : -1 });
      }
      const stars = [];
      for (let i = 0; i < 70; i++) stars.push({ x: R() * W, y: R() * H * .9, r: .4 + R() * .9, a: .25 + R() * .5, w: R() * 6.28 });
      st = { beam, lang, fronts, blobs, stars };
    }

    // ---------- drawing
    function wiggle(x, y, th, L, waves, A, ph, color, alpha, lw) {
      const c = Math.cos(th), s = Math.sin(th), n = 28;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = i / n - .5, env = Math.sin(Math.PI * (u + .5));
        const d = Math.sin(waves * 6.2832 * u + ph) * A * env;
        const px = x + c * u * L - s * d, py = y + s * u * L + c * d;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = lw; ctx.stroke();
    }

    function label(txt, x, y) {
      ctx.font = `500 ${Math.round(11.5 * Math.max(.9, k))}px "Instrument Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.fillStyle = rgba(col['ink-2'], .95);
      ctx.fillText(txt, x, y); ctx.textAlign = 'start';
    }

    // Spacecraft: heat shield faces the Sun; a ring marks the in situ beam crossing.
    function drawSat(sat, g) {
      const u = Math.max(.8, k);
      ctx.save(); ctx.translate(sat.x, sat.y);
      ctx.rotate(Math.atan2(src.sun.y - sat.y, src.sun.x - sat.x));
      if (sat.kind === 'solo') {
        ctx.fillStyle = rgba(col.beam, .85);
        ctx.fillRect(-2.5 * u, -15 * u, 3.5 * u, 10 * u); ctx.fillRect(-2.5 * u, 5 * u, 3.5 * u, 10 * u);
        ctx.fillStyle = col.ink; ctx.fillRect(-4 * u, -3.5 * u, 7 * u, 7 * u);
        ctx.fillStyle = col['ink-2']; ctx.fillRect(3.6 * u, -5 * u, 1.8 * u, 10 * u);
      } else {
        ctx.fillStyle = col.ink;
        ctx.beginPath(); ctx.moveTo(2 * u, -3 * u); ctx.lineTo(-9 * u, 0); ctx.lineTo(2 * u, 3 * u); ctx.closePath(); ctx.fill();
        ctx.fillStyle = col['ink-2']; ctx.fillRect(3 * u, -6.5 * u, 2.2 * u, 13 * u);
      }
      ctx.restore();
      const a = t - (.6 + sat.s / .11);
      if (a > 0 && a < 1.4) {
        ctx.strokeStyle = rgba(col.beam, (1 - a / 1.4) * .8 * g); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(sat.x, sat.y, (8 + a * 22) * k, 0, 6.2832); ctx.stroke();
      }
      // PSP sits above the beam: put its label above so it does not cover the electrons
      label(sat.name, sat.x, sat.above ? sat.y - 16 * u : sat.y + 26 * u);
    }

    // Earth with radio telescopes pointed at the source; they glow when a front arrives.
    function drawEarth(g) {
      const { x, y, R: r } = earth, u = Math.max(.8, k);
      let gr = ctx.createRadialGradient(x, y, r * .9, x, y, r * 1.6);
      gr.addColorStop(0, rgba('#7FB2FF', col.dark ? .35 : .3)); gr.addColorStop(1, rgba('#7FB2FF', 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, 6.2832); ctx.fill();
      gr = ctx.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r);
      gr.addColorStop(0, '#7DB4FA'); gr.addColorStop(1, '#1E4F9C');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.clip();
      ctx.fillStyle = 'rgba(70,170,95,.75)';
      ctx.beginPath(); ctx.ellipse(x - r * .25, y + r * .15, r * .42, r * .26, .6, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + r * .4, y - r * .35, r * .25, r * .16, -.4, 0, 6.2832); ctx.fill();
      ctx.restore();

      let glow = 0;
      for (const f of st.fronts) if (t > f.trc) glow = Math.max(glow, Math.exp(-(t - f.trc) * 1.6));
      glow *= g;
      const toSrc = Math.atan2(src.y - y, src.x - x);
      for (const da of [-.6, 0, .6]) {
        const a = toSrc + da, dx = Math.cos(a), dy = Math.sin(a);
        const bx = x + dx * r, by = y + dy * r, tx = bx + dx * 6 * u, ty = by + dy * 6 * u;
        if (glow > .02) {
          const h = ctx.createRadialGradient(tx, ty, 0, tx, ty, 14 * u);
          h.addColorStop(0, rgba(col.radio, .55 * glow)); h.addColorStop(1, rgba(col.radio, 0));
          ctx.fillStyle = h; ctx.beginPath(); ctx.arc(tx, ty, 14 * u, 0, 6.2832); ctx.fill();
        }
        ctx.strokeStyle = col.ink; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        const cx = tx + dx * 5 * u, cy = ty + dy * 5 * u;
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(cx, cy, 5 * u, a + Math.PI - 1.05, a + Math.PI + 1.05); ctx.stroke();
      }
      label(S.earth, x, y + r + 16 * u);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const g = t < .4 ? t / .4 : t > T - 1.4 ? Math.max(0, (T - t) / 1.4) : 1;

      if (col.dark) for (const s of st.stars) {
        ctx.fillStyle = rgba('#FFFFFF', s.a * (.75 + .25 * Math.sin(t * .8 + s.w)));
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
      }

      // density fluctuations: soft violet (excess) and blue-grey (depletion) patches
      for (const b of st.blobs) {
        const x = b.x + Math.sin(t * .25 + b.w) * 6 * k, y = b.y + Math.cos(t * .2 + b.w) * 4 * k;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, b.r);
        const c0 = b.sign > 0 ? col.z : col['ink-2'];
        gr.addColorStop(0, rgba(c0, b.a * (col.dark ? 1.3 : 1))); gr.addColorStop(1, rgba(c0, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, b.r, 0, 6.2832); ctx.fill();
      }

      // field lines
      ctx.lineWidth = 1;
      lines.forEach((c, i) => {
        ctx.strokeStyle = rgba(col['ink-2'], i === 1 ? .5 : .22);
        ctx.beginPath(); c.pts.forEach((p, j) => j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
      });
      const lb = at(main, .2);
      ctx.fillStyle = rgba(col['ink-2'], .8);
      ctx.font = `italic ${Math.round(14 * Math.max(.85, k))}px Newsreader, Georgia, serif`;
      ctx.fillText('B₀', lb.x + lb.nx * 14 - 6, lb.y + lb.ny * 14);

      // radio source region
      const sa = smooth(4.2, 6.5, t) * g;
      if (sa > 0) {
        ctx.save(); ctx.translate(src.x, src.y); ctx.rotate(src.ang); ctx.scale(src.rx, src.ry);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, rgba(col.z, .13 * sa)); gr.addColorStop(1, rgba(col.z, .02 * sa));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.2832); ctx.fill();
        ctx.restore();
        ctx.save(); ctx.translate(src.x, src.y); ctx.rotate(src.ang);
        ctx.setLineDash([5, 6]); ctx.strokeStyle = rgba(col.z, .55 * sa); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(0, 0, src.rx, src.ry, 0, 0, 6.2832); ctx.stroke();
        ctx.restore(); ctx.setLineDash([]);
      }

      drawEarth(g);
      for (const sat of sats) drawSat(sat, g);

      // Sun
      const { x: sx, y: sy, R } = src.sun;
      let gr = ctx.createRadialGradient(sx, sy, R * .9, sx, sy, R * 1.6);
      gr.addColorStop(0, rgba(col.accent, col.dark ? .35 : .22)); gr.addColorStop(1, rgba(col.accent, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, R * 1.6, 0, 6.2832); ctx.fill();
      gr = ctx.createRadialGradient(sx + R * .2, sy - R * .25, R * .1, sx, sy, R);
      gr.addColorStop(0, '#FFD98A'); gr.addColorStop(1, col.accent);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.2832); ctx.fill();

      // flare at the foot of the main field line
      const fl = t < .5 ? t / .5 : Math.exp(-(t - .5) * 1.1);
      if (fl > .01) {
        const p = main.pts[0], rr = (14 + 46 * fl) * k;
        gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rr);
        gr.addColorStop(0, rgba('#FFF4D6', .95 * fl)); gr.addColorStop(.35, rgba(col.accent, .7 * fl)); gr.addColorStop(1, rgba(col.accent, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, 6.2832); ctx.fill();
      }

      // beam electrons
      ctx.fillStyle = col.beam;
      ctx.strokeStyle = rgba(col.beam, .35 * g); ctx.lineWidth = 1;
      for (const b of st.beam) {
        const s = (t - b.t0) * b.v;
        if (s <= 0 || s > 1.02) continue;
        const a = Math.min(1, s / .03) * Math.min(1, (1.02 - s) / .06) * g;
        const p = at(main, s), off = b.off * (3 + s * 16) * k;
        const x = p.x + p.nx * off, y = p.y + p.ny * off;
        ctx.globalAlpha = .9 * a;
        ctx.beginPath(); ctx.arc(x, y, 1.7 * Math.max(.8, k), 0, 6.2832); ctx.fill();
        const q = at(main, s - .018);
        ctx.beginPath(); ctx.moveTo(q.x + q.nx * off, q.y + q.ny * off); ctx.lineTo(x, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Langmuir packets: short, fast-oscillating
      for (const L of st.lang) {
        const age = t - L.tb; if (age < 0 || age > L.life) continue;
        const env = Math.sin(Math.PI * age / L.life);
        wiggle(L.x, L.y, L.th, 24 * k, 3.5, 3.6 * k * env, L.ph + t * 9, col.langmuir, .9 * env * g, 1.4);
      }
      // radio fronts: expanding arcs
      const rmax = Math.max(W, H) * .7;
      for (const f of st.fronts) {
        const age = t - f.tb; if (age < 0) continue;
        for (let j = 0; j < 3; j++) {
          const r = age * 85 * k - j * 10 * k; if (r <= 4 || r > rmax) continue;
          const a = (1 - r / rmax) * g * (1 - j * .25);
          ctx.strokeStyle = rgba(col.radio, .9 * a); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(f.x0, f.y0, r, f.dir - .42, f.dir + .42); ctx.stroke();
        }
      }
    }

    function frame(now) {
      raf = 0;
      const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
      if (playing && onScreen) {
        t += dt;
        if (t >= T) { t = 0; cycle++; reset(cycle); }
        draw();
        raf = requestAnimationFrame(frame);
      }
    }
    function kick() { if (!raf && playing && onScreen) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    function showStatic() { t = STATIC_T; reset(cycle); draw(); }
    function setPlaying(p) {
      playing = p;
      btn.setAttribute('aria-pressed', String(!p));
      btn.setAttribute('aria-label', p ? S.anim_pause : S.anim_play);
      if (p) kick(); else draw();
    }

    const freeze = parseFloat(new URLSearchParams(location.search).get('burst'));
    readColors(); layout();
    if (!isNaN(freeze)) { t = freeze; reset(cycle); draw(); playing = false; }
    else if (playing) kick(); else { showStatic(); setPlaying(false); }
    btn.addEventListener('click', () => setPlaying(!playing));
    new ResizeObserver(() => { layout(); draw(); }).observe(cv);
    new IntersectionObserver((e) => { onScreen = e[0].isIntersecting; kick(); }).observe(cv);
    document.addEventListener('visibilitychange', () => { onScreen = !document.hidden; kick(); });
    darkMQ.addEventListener('change', () => { readColors(); layout(); draw(); });
    reduceMQ.addEventListener('change', () => { if (reduceMQ.matches) { setPlaying(false); showStatic(); } });
    document.fonts && document.fonts.ready.then(draw);
  }

  /* ================================================================
     Publications sheet: native <dialog>, deep-linkable via #publications.
     ================================================================ */
  const dlg = document.getElementById('pubs');
  if (dlg) {
    const open = (push) => {
      if (dlg.open) return;
      dlg.showModal();
      if (push && location.hash !== '#publications') history.pushState(null, '', '#publications');
    };
    const close = () => { if (dlg.open) dlg.close(); };
    document.querySelectorAll('[data-open-pubs]').forEach((a) =>
      a.addEventListener('click', (e) => { e.preventDefault(); open(true); }));
    dlg.querySelector('[data-close]').addEventListener('click', close);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener('close', () => {
      if (location.hash === '#publications') history.replaceState(null, '', location.pathname + location.search);
    });
    addEventListener('hashchange', () => (location.hash === '#publications' ? open(false) : close()));
    if (location.hash === '#publications') open(false);

    const items = [...dlg.querySelectorAll('.pubs li')];
    const tests = {
      all: () => true,
      peer: (li) => li.dataset.status === 'published',
      first: (li) => li.dataset.first === 'true',
      progress: (li) => li.dataset.status !== 'published',
    };
    dlg.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      dlg.querySelectorAll('[data-filter]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      items.forEach((li) => { li.hidden = !tests[b.dataset.filter](li); });
    }));

    dlg.querySelectorAll('.bib').forEach((b) => b.addEventListener('click', async () => {
      const txt = b.dataset.bib;
      try { await navigator.clipboard.writeText(txt); }
      catch {
        const ta = document.createElement('textarea'); ta.value = txt; dlg.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove();
      }
      b.textContent = S.copied;
      setTimeout(() => { b.textContent = S.copy_bib; }, 1600);
    }));
  }

  /* ================================================================
     Simulation videos: play only while on screen.
     ================================================================ */
  const vids = document.querySelectorAll('video[data-auto]');
  if (vids.length && !reduceMQ.matches) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const v = e.target;
      if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause();
    }), { threshold: .35 });
    vids.forEach((v) => io.observe(v));
  }
  /* ================================================================
     Scroll interaction: sections unfold as they enter and fold as they
     leave (both directions), active section in the nav, reading progress.
     ================================================================ */
  const RV = [
    '.block h2', '.block .intro', '.block > .wrap > .small', '.thesis-title', '#thesis .meta',
    '.block .prose > p', '.spectro figcaption', '.interests > li', '.results > .result',
    '.thesis-side', '.sim figcaption', '.sel > li', '.rows > div', '.tl.recent > li',
    '.path > li', '.talks', '.contact .mail', '.contact .profiles', '.sub-h',
  ];
  const RV_FIG = ['.spectro img', '.scheme', '.defense', '.sim-one video', '.pair > div'];
  const main = document.getElementById('main');
  const bar = document.querySelector('.progress');
  const links = new Map([...document.querySelectorAll('.nav a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]));
  const secs = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  const els = [];
  const motion = () => !reduceMQ.matches;
  if (main) {
    const tag = (sel, fig) => main.querySelectorAll(sel).forEach((el) => {
      if (el.closest('.hero') || el.parentElement.closest('.rv')) return;
      el.classList.add('rv');
      // stagger siblings of the same kind (grid cells, list rows)
      const sib = [...el.parentElement.children].filter((c) => c.matches(sel));
      els.push({ el, fig, i: sib.indexOf(el) % 3 });
    });
    RV.forEach((s) => tag(s, false)); RV_FIG.forEach((s) => tag(s, true));
  }
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  function style(o, r, vh) {
    const st = o.el.style;
    // unfold while the top travels through the lowest third of the viewport
    const a = ease(clamp((vh * (1 - .05 * o.i) - r.top) / (vh * .3)));
    // fold while the bottom travels through the top fifth, just under the header
    const b = ease(clamp((vh * .24 - r.bottom) / (vh * .2)));
    const v = a * (1 - b);
    if (v > .999 || !motion()) { st.opacity = st.transform = st.clipPath = ''; return; }
    const y = (1 - a) * (o.fig ? 48 : 34) - b * 28;
    const sc = o.fig ? .94 + .06 * a - .03 * b : 1 - .02 * b;
    st.opacity = v.toFixed(3);
    st.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`;
    if (o.fig) {
      const c = (1 - a) * 14, cx = (1 - a) * 5;
      st.clipPath = c > .05 ? `inset(${c.toFixed(1)}% ${cx.toFixed(1)}% ${c.toFixed(1)}% ${cx.toFixed(1)}% round 16px)` : '';
    }
  }
  let queued = false;
  function update() {
    queued = false;
    const vh = innerHeight;
    // read everything first, then write, to avoid layout thrashing
    const rects = els.map((o) => o.el.getBoundingClientRect());
    const srects = secs.map((s) => s.getBoundingClientRect());
    els.forEach((o, k) => { const r = rects[k]; if (r.bottom > -vh && r.top < 2 * vh) style(o, r, vh); });
    if (bar) {
      const h = document.documentElement.scrollHeight - vh;
      bar.style.transform = `scaleX(${h > 0 ? clamp(scrollY / h) : 0})`;
    }
    // active section: the last one whose top has passed 40% of the viewport
    let cur = null;
    srects.forEach((r, k) => { if (r.top < vh * .4 && r.bottom > vh * .4) cur = secs[k].id; });
    links.forEach((a, id) => (id === cur ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  reduceMQ.addEventListener('change', queue);
  update();
})();
