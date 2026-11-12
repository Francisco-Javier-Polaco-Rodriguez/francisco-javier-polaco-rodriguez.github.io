(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const S = JSON.parse(document.getElementById('i18n').textContent);
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

  /* ================================================================
     Type III burst animation.
     One cycle: flare -> beam along the open field line -> Langmuir packets
     and radio fronts all along the beam path. Density fluctuations fill
     the whole solar wind and stay fixed from one cycle to the next.
     ================================================================ */
  const cv = document.getElementById('burst');
  if (cv) {
    const ctx = cv.getContext('2d');
    const btn = document.querySelector('.burst-toggle');
    const dyn = document.getElementById('dynspec'), dctx = dyn && dyn.getContext('2d');
    const T = 17;            // cycle length [s]
    const STATIC_T = 9.5;    // frame shown when motion is reduced
    const PACE = .6;         // animation seconds per real second: slows the whole scene
    const TOP = .3;          // the scene sits in the lower 70% of the canvas; the top fades under the hero text
    let W = 0, H = 0, Y0 = 0, HB = 0, k = 1; // css size, scene band (top, height), scale vs 1200px reference
    let col = {};
    let cR = 100;
    let lines = [], main = null, src = null, earth = null, sats = [], wells = [];
    const fluct = document.createElement('canvas'), fctx = fluct.getContext('2d');
    const dynNoise = document.createElement('canvas'), dynBurst = document.createElement('canvas');
    let sprite = null;
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
    const Y = (f) => Y0 + f * HB;

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

    // soft round sprite for additive glow (beam electrons)
    function makeSprite(color, r) {
      const c = document.createElement('canvas'), d = Math.ceil(r * 2);
      c.width = c.height = d;
      const x = c.getContext('2d'), g = x.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.18, rgba(color, .9)); g.addColorStop(.5, rgba(color, .22)); g.addColorStop(1, rgba(color, 0));
      x.fillStyle = g; x.fillRect(0, 0, d, d);
      return { c, r };
    }

    function layout() {
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height; Y0 = H * TOP; HB = H - Y0; k = Math.max(.55, Math.min(1.25, W / 1200));
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const R = Math.min(HB * .31, Math.max(56, W * .1));
      const sun = { x: R * .12, y: Y(.62), R };
      lines = [];
      const mk = (ang, dy, bend) => {
        const p0 = [sun.x + R * Math.cos(ang), sun.y + R * Math.sin(ang)];
        return curve(p0, [p0[0] + W * .1, p0[1] - HB * (.12 + bend)], [W * .48, Y(.42 + dy)], [W * 1.04, Y(.44 + dy)]);
      };
      lines.push(mk(-1.2, -.1, .1), mk(-.85, -.04, .04), mk(-.5, .1, -.04), mk(-.2, .24, -.14));
      main = lines[1];
      // radio fronts travel ~1.75x the mean beam speed (beam: .072-.122 of the line length per second)
      cR = main.total * .17;
      const c = at(main, .64);
      src = { x: c.x, y: c.y + HB * .04, ry: Math.max(50, HB * .24), sun };
      const Re = Math.max(16, Math.min(34, HB * .1));
      earth = W < 640 ? { x: W - Re - 10, y: Y0 + Re + 4, R: Re * .85 } : { x: W - Math.max(46, W * .055), y: Math.max(Y0 + Re + 16, Y(.16)), R: Re };
      const small = W < 640;
      // both probes sit on the beam path
      const so = at(main, .7), pp = at(main, .57);
      sats = [
        { name: small ? 'SolO' : 'Solar Orbiter', kind: 'solo', s: .7, x: so.x + so.nx * src.ry * .42, y: so.y + so.ny * src.ry * .42 },
        { name: small ? 'PSP' : 'Parker Solar Probe', kind: 'psp', s: .57, above: true, x: pp.x - pp.nx * src.ry * .3, y: pp.y - pp.ny * src.ry * .3 },
      ];
      sprite = makeSprite(col.beam, 9 * Math.max(.8, k));
      drawFluct(dpr);
      buildDyn();
      reset(cycle);
    }

    // Density fluctuations over the whole solar wind, fixed seed, rendered once per layout.
    // Excesses violet, depletions (wells) blue-grey; Langmuir packets favour the wells.
    function drawFluct(dpr) {
      fluct.width = cv.width; fluct.height = cv.height;
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.clearRect(0, 0, W, H);
      const R = rng(4242), n = Math.round(W * H / (W < 640 ? 2600 : 3600));
      const { x: sx, y: sy, R: sr } = src.sun;
      wells = [];
      for (let i = 0; i < n; i++) {
        const x = R() * W, y = R() * H, r = (16 + R() * 40) * k;
        if (Math.hypot(x - sx, y - sy) < sr * 1.15) continue;
        const sign = R() < .5 ? 1 : -1, a = (.045 + R() * .06) * (.35 + .65 * smooth(0, Y0, y));
        if (sign < 0) wells.push({ x, y, r });
        const c0 = sign > 0 ? col.z : col['ink-2'];
        const gr = fctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(c0, a * 1.9)); gr.addColorStop(1, rgba(c0, 0));
        fctx.fillStyle = gr; fctx.beginPath(); fctx.arc(x, y, r, 0, 6.2832); fctx.fill();
      }
    }
    const nearWell = (x, y) => wells.some((w) => Math.hypot(w.x - x, w.y - y) < w.r * .8);

    // ---------- live dynamic spectrum: what a radio telescope records during the cycle.
    // Frequency (log, 20 -> 0.3 MHz) against time; the burst drifts as f ~ 1/distance.
    const DW = 240, DH = 120, FSPAN = Math.log10(20 / .3);
    function buildDyn() {
      if (!dyn) return;
      const r = dyn.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      dyn.width = Math.round(r.width * dpr); dyn.height = Math.round(r.height * dpr);
      const stops = [[0, 7, 12, 26], [.22, 44, 28, 104], [.48, 176, 44, 100], [.74, 255, 138, 61], [1, 255, 244, 214]];
      const cmap = (v) => {
        v = Math.min(1, Math.max(0, v));
        let i = 0; while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
        const a = stops[i], b = stops[i + 1], f = (v - a[0]) / (b[0] - a[0]);
        return [a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), a[3] + f * (b[3] - a[3])];
      };
      const R = rng(77);
      for (const [cvs, withBurst] of [[dynNoise, false], [dynBurst, true]]) {
        cvs.width = DW; cvs.height = DH;
        const x2 = cvs.getContext('2d'), img = x2.createImageData(DW, DH);
        for (let y = 0; y < DH; y++) {
          const f = 20 * Math.pow(10, -(y / DH) * FSPAN), s = .5 / f;      // MHz, position along the path
          const t0 = 2.1 + s / .1, tau = .3 + 1.3 * s, rise = .14 + .25 * s;
          const band = .03 * Math.sin(y * .9) + (y % 23 === 0 ? .06 : 0);
          for (let x = 0; x < DW; x++) {
            let v = .07 + .07 * R() + band;
            if (withBurst && s > .03 && s < 1.08) {
              const dt = x / DW * T - t0;
              const I = dt < 0 ? Math.exp(-(dt * dt) / (rise * rise)) : Math.exp(-dt / tau);
              v += I * (.8 + .2 * R()) * smooth(.03, .07, s) * (1 - .35 * smooth(.6, 1.08, s));
            }
            const c = cmap(v), o = 4 * (y * DW + x);
            img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
          }
        }
        x2.putImageData(img, 0, 0);
      }
    }
    function drawDyn() {
      if (!dyn) return;
      const w = dyn.width, h = dyn.height, x = Math.min(1, t / T) * w;
      dctx.imageSmoothingEnabled = true;
      dctx.drawImage(dynNoise, 0, 0, w, h);
      dctx.save(); dctx.beginPath(); dctx.rect(0, 0, x, h); dctx.clip();
      dctx.drawImage(dynBurst, 0, 0, w, h); dctx.restore();
      dctx.fillStyle = 'rgba(255,255,255,.55)'; dctx.fillRect(x - 1, 0, Math.max(1, w / 400), h);
    }

    // ---------- per-cycle state (seeded so every cycle differs but is reproducible)
    function reset(n) {
      const R = rng(9973 * n + 17);
      const nb = W < 640 ? 110 : 190;
      const beam = Array.from({ length: nb }, () => ({
        t0: .6 + Math.abs(gauss(R)) * .9, v: .072 + R() * .05, off: gauss(R),
      }));
      // Langmuir packets all along the path, born as the beam passes; kept preferably in density wells
      const lang = [];
      const nl = W < 640 ? 70 : 120;
      for (let i = 0; i < nl; i++) {
        let x, y, s, p, tries = 0;
        do {
          s = .05 + R() * .97; p = at(main, s);
          const off = gauss(R) * (5 + s * 24) * k;
          x = p.x + p.nx * off; y = p.y + p.ny * off;
        } while (!nearWell(x, y) && ++tries < 3);
        lang.push({ x, y, th: Math.atan2(p.ty, p.tx) + gauss(R) * .5, tb: .9 + s / .105 + R() * 1.2, life: 2.8 + R() * 2.4, ph: R() * 6.28 });
      }
      // radio fronts emitted from all along the path; wavelength grows outward (lower plasma frequency)
      const fronts = [];
      const nf = W < 640 ? 16 : 26;
      for (let i = 0; i < nf; i++) {
        const s = .08 + (i + R()) / nf * .9, p = at(main, s);
        const x0 = p.x + p.nx * gauss(R) * 8 * k, y0 = p.y + p.ny * gauss(R) * 8 * k;
        const r = R(), toE = Math.atan2(earth.y - y0, earth.x - x0);
        const dir = r < .5 ? toE + gauss(R) * .12 : -Math.PI / 2 + gauss(R) * .7;
        const dist = Math.hypot(earth.x - x0, earth.y - y0) - earth.R;
        const tb = 1.8 + s / .1 + R() * .6;
        fronts.push({ x0, y0, tb, dir, lam: (7 + s * 14) * k, trc: r < .5 ? tb + dist / cR : Infinity });
      }
      const stars = [];
      for (let i = 0; i < 110; i++) stars.push({ x: R() * W, y: R() * H * .95, r: .4 + R() * 1.1, a: .25 + R() * .6, w: R() * 6.28 });
      st = { beam, lang, fronts, stars };
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
      // wide faint pass + thin bright pass = glow without shadowBlur
      ctx.strokeStyle = rgba(color, alpha * .22); ctx.lineWidth = lw * 3.6; ctx.stroke();
      ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = lw; ctx.stroke();
    }

    function label(txt, x, y) {
      ctx.font = `500 ${Math.round(11.5 * Math.max(.9, k))}px "Bricolage Grotesque", system-ui, sans-serif`;
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
        ctx.fillStyle = col.accent; ctx.fillRect(3.6 * u, -5 * u, 1.8 * u, 10 * u);
      } else {
        ctx.fillStyle = col.ink;
        ctx.beginPath(); ctx.moveTo(2 * u, -3 * u); ctx.lineTo(-9 * u, 0); ctx.lineTo(2 * u, 3 * u); ctx.closePath(); ctx.fill();
        ctx.fillStyle = col.accent; ctx.fillRect(3 * u, -6.5 * u, 2.2 * u, 13 * u);
      }
      ctx.restore();
      const a = t - (.6 + sat.s / .11);
      if (a > 0 && a < 1.8) {
        for (let j = 0; j < 2; j++) {
          const b = a - j * .35; if (b <= 0) continue;
          ctx.strokeStyle = rgba(col.beam, (1 - b / 1.8) * .8 * g); ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(sat.x, sat.y, (8 + b * 24) * k, 0, 6.2832); ctx.stroke();
        }
      }
      label(sat.name, sat.x, sat.above ? sat.y - 16 * u : sat.y + 26 * u);
    }

    // Earth with radio telescopes pointed at the source; they glow when a front arrives.
    function drawEarth(g) {
      const { x, y, R: r } = earth, u = Math.max(.8, k);
      let gr = ctx.createRadialGradient(x, y, r * .9, x, y, r * 2);
      gr.addColorStop(0, rgba('#7FB2FF', .4)); gr.addColorStop(1, rgba('#7FB2FF', 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * 2, 0, 6.2832); ctx.fill();
      gr = ctx.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r);
      gr.addColorStop(0, '#8DC0FF'); gr.addColorStop(1, '#173F86');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.clip();
      ctx.fillStyle = 'rgba(70,170,95,.75)';
      ctx.beginPath(); ctx.ellipse(x - r * .25, y + r * .15, r * .42, r * .26, .6, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + r * .4, y - r * .35, r * .25, r * .16, -.4, 0, 6.2832); ctx.fill();
      // night side, away from the Sun
      const ns = ctx.createLinearGradient(x - r, y, x + r, y);
      ns.addColorStop(.45, 'rgba(3,8,20,0)'); ns.addColorStop(1, 'rgba(3,8,20,.7)');
      ctx.fillStyle = ns; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.restore();

      let glow = 0;
      for (const f of st.fronts) if (t > f.trc) glow = Math.max(glow, Math.exp(-(t - f.trc) * 1.6));
      glow *= g;
      const toSrc = Math.atan2(src.y - y, src.x - x);
      for (const da of [-.6, 0, .6]) {
        const a = toSrc + da, dx = Math.cos(a), dy = Math.sin(a);
        const bx = x + dx * r, by = y + dy * r, tx = bx + dx * 6 * u, ty = by + dy * 6 * u;
        if (glow > .02) {
          const h = ctx.createRadialGradient(tx, ty, 0, tx, ty, 16 * u);
          h.addColorStop(0, rgba(col.radio, .65 * glow)); h.addColorStop(1, rgba(col.radio, 0));
          ctx.fillStyle = h; ctx.beginPath(); ctx.arc(tx, ty, 16 * u, 0, 6.2832); ctx.fill();
        }
        ctx.strokeStyle = col.ink; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        const cx = tx + dx * 5 * u, cy = ty + dy * 5 * u;
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(cx, cy, 5 * u, a + Math.PI - 1.05, a + Math.PI + 1.05); ctx.stroke();
      }
      label(S.earth, x, y + r + 16 * u);
    }

    function drawSun(fl) {
      const { x: sx, y: sy, R } = src.sun;
      ctx.globalCompositeOperation = 'lighter';
      // corona: wide halo plus slow streamers
      let gr = ctx.createRadialGradient(sx, sy, R * .8, sx, sy, R * 3.4);
      gr.addColorStop(0, rgba(col.accent, .42 + .2 * fl)); gr.addColorStop(.35, rgba(col.accent, .12)); gr.addColorStop(1, rgba(col.accent, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, R * 3.4, 0, 6.2832); ctx.fill();
      for (let i = 0; i < 12; i++) {
        const a = -1.9 + i * .3 + .06 * Math.sin(t * .35 + i * 1.7), len = R * (2.3 + .6 * Math.sin(t * .5 + i * 2.3)), w = .2 + .05 * Math.sin(i * 5.1);
        const x1 = sx + Math.cos(a) * len, y1 = sy + Math.sin(a) * len;
        const sg = ctx.createLinearGradient(sx, sy, x1, y1);
        sg.addColorStop(.4, rgba(col.accent, .075)); sg.addColorStop(1, rgba(col.accent, 0));
        ctx.fillStyle = sg; ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a - w) * R * .96, sy + Math.sin(a - w) * R * .96);
        ctx.lineTo(x1, y1); ctx.lineTo(sx + Math.cos(a + w) * R * .96, sy + Math.sin(a + w) * R * .96); ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      // disk: hot centre, darker limb
      gr = ctx.createRadialGradient(sx + R * .25, sy - R * .3, R * .05, sx, sy, R);
      gr.addColorStop(0, '#FFF1C4'); gr.addColorStop(.35, '#FFC566'); gr.addColorStop(.8, col.accent); gr.addColorStop(1, '#E2571C');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = rgba('#FFE2A8', .35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, R, 0, 6.2832); ctx.stroke();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const g = t < .4 ? t / .4 : t > T - 1.4 ? Math.max(0, (T - t) / 1.4) : 1;
      const u = Math.max(.8, k);

      for (const s of st.stars) {
        ctx.fillStyle = rgba('#FFFFFF', s.a * (.7 + .3 * Math.sin(t * .8 + s.w)));
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
      }
      ctx.drawImage(fluct, 0, 0, W, H);

      // field lines, fading away from the Sun; the beam's line is brighter
      lines.forEach((c, i) => {
        const lg = ctx.createLinearGradient(0, 0, W, 0);
        lg.addColorStop(0, rgba(col.accent, i === 1 ? .7 : .35)); lg.addColorStop(.25, rgba(col['ink-2'], i === 1 ? .55 : .26)); lg.addColorStop(1, rgba(col['ink-2'], i === 1 ? .3 : .12));
        ctx.strokeStyle = lg; ctx.lineWidth = i === 1 ? 1.3 : 1;
        ctx.beginPath(); c.pts.forEach((p, j) => j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
      });
      const lb = at(main, .2);
      ctx.fillStyle = rgba(col['ink-2'], .85);
      ctx.font = `italic ${Math.round(14 * Math.max(.85, k))}px Newsreader, Georgia, serif`;
      ctx.fillText('B₀', lb.x + lb.nx * 14 - 6, lb.y + lb.ny * 14);

      // the radio source travels with the beam: a soft violet halo around the bulk of the electrons
      const sb = (t - 1.3) * .097;
      if (sb > .03 && sb < 1.05) {
        const p = at(main, sb), rr = (46 + sb * 100) * k, a = Math.min(1, sb / .1) * Math.min(1, (1.05 - sb) / .1) * g;
        const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        gr.addColorStop(0, rgba(col.z, .22 * a)); gr.addColorStop(1, rgba(col.z, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.2832); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      drawEarth(g);
      for (const sat of sats) drawSat(sat, g);

      const fl = t < .5 ? t / .5 : Math.exp(-(t - .5) * 1.1);
      drawSun(fl);

      ctx.globalCompositeOperation = 'lighter';
      // flare at the foot of the main field line: core, halo and four short rays
      if (fl > .01) {
        const p = main.pts[0], rr = (16 + 60 * fl) * k;
        const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rr);
        gr.addColorStop(0, rgba('#FFF4D6', .95 * fl)); gr.addColorStop(.3, rgba(col.accent, .7 * fl)); gr.addColorStop(1, rgba(col.accent, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = rgba('#FFF4D6', .55 * fl); ctx.lineWidth = 1.2;
        for (let i = 0; i < 4; i++) {
          const a = .4 + i * 1.5708, l = rr * 1.5;
          ctx.beginPath(); ctx.moveTo(p[0] + Math.cos(a) * 4, p[1] + Math.sin(a) * 4); ctx.lineTo(p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l); ctx.stroke();
        }
      }

      // beam electrons: glowing dots with short streaks
      ctx.lineWidth = 1.2;
      for (const b of st.beam) {
        const s = (t - b.t0) * b.v;
        if (s <= 0 || s > 1.02) continue;
        const a = Math.min(1, s / .03) * Math.min(1, (1.02 - s) / .06) * g;
        const p = at(main, s), off = b.off * (3 + s * 16) * k;
        const x = p.x + p.nx * off, y = p.y + p.ny * off;
        const q = at(main, s - .024);
        const qx = q.x + q.nx * off, qy = q.y + q.ny * off;
        const sg = ctx.createLinearGradient(qx, qy, x, y);
        sg.addColorStop(0, rgba(col.beam, 0)); sg.addColorStop(1, rgba(col.beam, .55 * a));
        ctx.strokeStyle = sg; ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.drawImage(sprite.c, x - sprite.r * .5, y - sprite.r * .5, sprite.r, sprite.r);
      }
      ctx.globalAlpha = 1;

      // Langmuir packets: short, fast-oscillating
      for (const L of st.lang) {
        const age = t - L.tb; if (age < 0 || age > L.life) continue;
        const env = Math.sin(Math.PI * age / L.life);
        wiggle(L.x, L.y, L.th, 24 * k, 3.5, 3.6 * k * env, L.ph + t * 9, col.langmuir, .95 * env * g, 1.4);
      }
      // radio fronts: expanding arcs
      const rmax = Math.max(W, H) * .7;
      for (const f of st.fronts) {
        const age = t - f.tb; if (age < 0) continue;
        for (let j = 0; j < 3; j++) {
          const r = age * cR - j * f.lam; if (r <= 4 || r > rmax) continue;
          const a = (1 - r / rmax) * g * (1 - j * .25);
          ctx.beginPath(); ctx.arc(f.x0, f.y0, r, f.dir - .42, f.dir + .42);
          ctx.strokeStyle = rgba(col.radio, .2 * a); ctx.lineWidth = 6; ctx.stroke();
          ctx.strokeStyle = rgba(col.radio, .95 * a); ctx.lineWidth = 1.6; ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      drawDyn();
    }

    function frame(now) {
      raf = 0;
      const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
      if (playing && onScreen) {
        t += dt * PACE;
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
     About: inline drawers (a word in the text opens a panel below it)
     and a lightbox for the photos.
     ================================================================ */
  document.querySelectorAll('.inl').forEach((b) => {
    const d = document.getElementById(b.getAttribute('aria-controls'));
    if (!d) return;
    b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      d.classList.toggle('open', open);
    });
  });
  const lb = document.getElementById('lightbox');
  if (lb) {
    const img = lb.querySelector('img'), cap = lb.querySelector('p');
    document.querySelectorAll('.zoom').forEach((z) => z.addEventListener('click', () => {
      img.src = z.dataset.full; img.alt = z.dataset.cap; cap.textContent = z.dataset.cap;
      lb.showModal();
    }));
    lb.addEventListener('click', () => lb.close());
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
    '.path > li', '.talks', '.contact .mail', '.contact .profiles', '.sub-h', '.obs-text', '.stat-row > li',
  ];
  const RV_FIG = ['.spectro img', '.scheme', '.defense', '.sim-one video', '.pair > div', '.obs-fig', '.obs-pair > div'];
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
  // [data-in] elements get .in the first time they scroll into view; numbers count up then
  const ins = [...document.querySelectorAll('[data-in]')];
  function countUp(el) {
    el.querySelectorAll('[data-count]').forEach((n) => {
      const end = +n.dataset.count;
      if (!motion() || end < 2) return;
      const t0 = performance.now(), dur = 1300;
      const step = (now) => {
        const x = Math.min(1, (now - t0) / dur);
        n.textContent = Math.round(end * (1 - Math.pow(1 - x, 3)));
        if (x < 1) requestAnimationFrame(step);
      };
      n.textContent = '0'; requestAnimationFrame(step);
    });
  }
  // result cards: a soft light follows the pointer
  document.querySelectorAll('.result').forEach((el) => el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }));
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
    ins.forEach((el) => {
      if (el.classList.contains('in')) return;
      const r = el.getBoundingClientRect();
      if (r.top < vh * .9 && r.bottom > 0) { el.classList.add('in'); countUp(el); }
    });
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
