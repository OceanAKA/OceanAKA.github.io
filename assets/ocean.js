
(function () {
  var box = document.getElementById('lightbox');
  var boxImg = document.getElementById('lightbox-img');
  var boxCap = document.getElementById('lightbox-cap');
  document.querySelectorAll('.zoom').forEach(function (b) {
    b.addEventListener('click', function () {
      var img = b.querySelector('img');
      var cap = b.closest('figure').querySelector('figcaption');
      boxImg.src = img.src;
      boxImg.alt = img.alt;
      boxCap.textContent = cap ? cap.textContent : img.alt;
      if (box.showModal) box.showModal();
    });
  });
  document.getElementById('lightbox-close').addEventListener('click', function () { box.close(); });
  box.addEventListener('click', function (e) { if (e.target === box) box.close(); });

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('video[autoplay]').forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); v.controls = true; });
  }
})();
(function () {
  var clock = document.getElementById('clock');
  var fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Honolulu', hour: 'numeric', minute: '2-digit' });
  } catch (e) { fmt = null; }
  function tick() { if (fmt && clock) clock.textContent = fmt.format(new Date()) + ' HST'; }
  tick();
  setInterval(tick, 30000);

  var btn = document.getElementById('copy-email');
  var email = document.getElementById('email');
  if (!btn || !email) return;
  function done(label) {
    btn.textContent = label;
    btn.dataset.done = 'true';
    setTimeout(function () { btn.textContent = 'Copy email'; btn.dataset.done = 'false'; }, 2000);
  }
  function selectText() {
    var r = document.createRange();
    r.selectNodeContents(email);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    done('Selected, press ⌘C');
  }
  btn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(email.textContent.trim()).then(function () { done('Copied'); }, selectText);
    } else {
      selectText();
    }
  });
})();

/* The water: a 1-D surface simulation (each column springs toward its
   neighbours) riding on two slow ambient swells. Pointer strokes add
   energy where they cross the surface; a click drops a random object
   that splashes in, floats a while and sinks. Sea animals cruise
   below the surface. */
(function () {
  var canvas = document.getElementById('sea-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SP = 4; // px between simulated columns
  var W = 0, H = 0, N = 0, dpr = 1;
  var h = [], v = [], hs = [];
  var colors = {};
  var tNow = 0, lastT = 0, raf = 0, inView = true, poked = false;

  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  var DROP_POOL = ['🥥', '🍍', '🌺', '🏐', '🛟', '⭐', '🐚', '🧋', '⚽', '🎲', '👟', '🎧', '🍉', '🩴', '📦'];
  var ANIMAL_POOL = ['🐟', '🐠', '🐡', '🐢', '🦈', '🐙', '🐬', '🦑', '🐋', '🦞'];
  var swimmers = [], drops = [], spray = [];

  function toClear(c) {
    // the same color at alpha 0, so gradients can dissolve into the page
    var m = /^#([0-9a-f]{6})$/i.exec(c.trim());
    if (m) {
      var n = parseInt(m[1], 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',0)';
    }
    m = /^rgba?\(([^)]+)\)$/.exec(c.trim());
    if (m) {
      var parts = m[1].split(',');
      return 'rgba(' + parts[0] + ',' + parts[1] + ',' + parts[2] + ',0)';
    }
    return 'rgba(10,78,110,0)';
  }

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    function cv(name, fb) { var x = cs.getPropertyValue(name).trim(); return x || fb; }
    colors = {
      back: cv('--sea-back', 'rgba(9,107,146,0.2)'),
      a: cv('--sea-front-a', '#19789F'),
      b: cv('--sea-front-b', '#0A4E6E'),
      foam: cv('--foam', 'rgba(255,255,255,0.85)')
    };
    colors.bClear = toClear(colors.b);
    colors.backClear = toClear(colors.back);
  }

  function initSwimmers() {
    var n = Math.max(3, Math.min(7, Math.round(W / 190)));
    swimmers = [];
    var used = [];
    for (var k = 0; k < n; k++) {
      var e;
      do { e = ANIMAL_POOL[Math.floor(Math.random() * ANIMAL_POOL.length)]; } while (used.indexOf(e) !== -1 && used.length < ANIMAL_POOL.length);
      used.push(e);
      swimmers.push({
        e: e,
        x: Math.random() * W,
        depth: 0.3 + Math.random() * 0.55, // fraction of the underwater zone
        dir: Math.random() < 0.5 ? -1 : 1,
        sp: 14 + Math.random() * 26,
        size: 17 + Math.random() * 13,
        ph: Math.random() * 6.28,
        bob: 2 + Math.random() * 3
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.ceil(W / SP) + 2;
    if (n !== N) { N = n; h = new Array(N).fill(0); v = new Array(N).fill(0); hs = new Array(N).fill(0); }
    if (!swimmers.length) initSwimmers();
    if (reduce) draw(0);
  }

  function step() {
    var i;
    for (i = 0; i < N; i++) {
      var l = h[i > 0 ? i - 1 : i], r = h[i < N - 1 ? i + 1 : i];
      v[i] += ((l + r) * 0.5 - h[i]) * 0.22; // neighbour tension
      v[i] += -h[i] * 0.018; // gravity: pull back to rest level
      v[i] *= 0.975;
    }
    for (i = 0; i < N; i++) {
      h[i] += v[i];
      if (h[i] > 34) { h[i] = 34; v[i] *= 0.4; }
      else if (h[i] < -34) { h[i] = -34; v[i] *= 0.4; }
    }
    // spatial smoothing: narrow spikes round off into soft mounds
    for (i = 0; i < N; i++) {
      var ls = h[i > 0 ? i - 1 : i], rs = h[i < N - 1 ? i + 1 : i];
      hs[i] = h[i] * 0.6 + (ls + rs) * 0.2;
    }
    var swap = h; h = hs; hs = swap;
  }

  function surfaceY(i, t) {
    var x = i * SP;
    return H * 0.52 + h[i]
      + Math.sin(x * 0.006 + t * 0.0012) * 5
      + Math.sin(x * 0.0145 - t * 0.0007) * 3;
  }
  function surfAt(x, t) {
    var i = Math.max(0, Math.min(N - 1, Math.round(x / SP)));
    return surfaceY(i, t);
  }

  function poke(i, amount) {
    if (i < 0 || i > N - 1) return;
    for (var k = -6; k <= 6; k++) {
      var j = i + k;
      if (j < 1 || j > N - 2) continue;
      var w = Math.cos((k / 6.5) * Math.PI / 2);
      v[j] += amount * 0.32 * w * w;
    }
    if (!poked) {
      poked = true;
      var hint = document.getElementById('sea-hint');
      if (hint) hint.style.opacity = '0';
    }
  }

  function splash(x, y, power) {
    poke(Math.round(x / SP), power);
    var n = 4 + Math.round(power * 1.4);
    for (var k = 0; k < n && spray.length < 110; k++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
      var sp = (45 + Math.random() * 130) * (0.35 + power / 11);
      spray.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 1.2 + Math.random() + power * 0.05,
        life: 0.4 + Math.random() * 0.4 + power * 0.012 });
    }
  }

  function spawnDrop(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var x = Math.max(8, Math.min(W - 8, clientX - rect.left));
    var y = clientY - rect.top;
    var surf = surfAt(x, tNow);
    var below = y >= surf - 8;
    var d = {
      e: DROP_POOL[Math.floor(Math.random() * DROP_POOL.length)],
      x: x,
      y: below ? surf - 6 : y,
      vy: 5,
      size: 19 + Math.random() * 8,
      rot: (Math.random() - 0.5) * 0.5,
      state: below ? 'float' : 'fall',
      floatT: 0,
      alpha: 1
    };
    if (below) splash(x, surf, 9);
    drops.push(d);
    if (drops.length > 10) drops.shift();
  }

  function update(dt, t) {
    var i;
    for (i = 0; i < swimmers.length; i++) {
      var s = swimmers[i];
      s.x += s.dir * s.sp * dt;
      if (s.x < -46) s.x = W + 44;
      else if (s.x > W + 46) s.x = -44;
    }
    for (i = drops.length - 1; i >= 0; i--) {
      var d = drops[i], surf = surfAt(d.x, t);
      if (d.state === 'fall') {
        d.vy += 950 * dt;
        d.y += d.vy * dt;
        if (d.y >= surf - 4) {
          d.y = surf - 4;
          d.state = 'float';
          splash(d.x, surf, Math.min(22, 2.5 + d.vy * 0.02));
        }
      } else if (d.state === 'float') {
        d.floatT += dt;
        d.y = surf - d.size * 0.24;
        d.x += Math.sin(t * 0.001 + d.rot * 12) * 5 * dt;
        if (d.floatT > 6.5) d.state = 'sink';
      } else {
        d.y += 17 * dt;
        d.alpha -= 0.4 * dt;
        if (d.alpha <= 0 || d.y > H + 30) drops.splice(i, 1);
      }
    }
    for (i = spray.length - 1; i >= 0; i--) {
      var p = spray[i];
      p.vy += 720 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) spray.splice(i, 1);
    }
  }

  function surfaceTo(t, startWithMove) {
    // curve through midpoints so the surface renders without corners
    var y0 = surfaceY(0, t);
    if (startWithMove) ctx.moveTo(0, y0); else ctx.lineTo(0, y0);
    var px = 0, py = y0;
    for (var i = 1; i < N; i++) {
      var x = i * SP, y = surfaceY(i, t);
      ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x; py = y;
    }
    ctx.lineTo(px, py);
    return px;
  }

  function tracePath(t) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    var lastX = surfaceTo(t, false);
    ctx.lineTo(lastX, H);
    ctx.closePath();
  }

  function drawEmoji(e, x, y, size, flip, rot, alpha) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    if (rot) ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.font = size + 'px ' + EMOJI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e, 0, 0);
    ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var x, i;
    // back swell
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (x = 0; x <= W; x += 8) {
      ctx.lineTo(x, H * 0.36 + Math.sin(x * 0.004 + t * 0.00045) * 9 + Math.sin(x * 0.0105 - t * 0.0003) * 5);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    var gb = ctx.createLinearGradient(0, H * 0.3, 0, H);
    gb.addColorStop(0, colors.back);
    gb.addColorStop(1, colors.backClear);
    ctx.fillStyle = gb;
    ctx.fill();
    // water body, dissolving into the page below so the ocean continues
    tracePath(t);
    var g = ctx.createLinearGradient(0, H * 0.3, 0, H);
    g.addColorStop(0, colors.a);
    g.addColorStop(0.55, colors.b);
    g.addColorStop(1, colors.bClear);
    ctx.fillStyle = g;
    ctx.fill();
    // underwater: animals and sinking objects, clipped to the water body
    ctx.save();
    tracePath(t);
    ctx.clip();
    for (i = 0; i < swimmers.length; i++) {
      var s = swimmers[i];
      var surf = surfAt(s.x, t);
      var yS = surf + 10 + (H - surf - 16) * s.depth + Math.sin(t * 0.0015 + s.ph) * s.bob;
      // emoji sea animals face left by default; flip when swimming right
      drawEmoji(s.e, s.x, yS, s.size, s.dir > 0, Math.sin(t * 0.001 + s.ph) * 0.08, 0.95);
    }
    for (i = 0; i < drops.length; i++) {
      if (drops[i].state === 'sink') {
        var dS = drops[i];
        drawEmoji(dS.e, dS.x, dS.y, dS.size, false, dS.rot + Math.sin(t * 0.002) * 0.2, Math.max(0, dS.alpha) * 0.9);
      }
    }
    ctx.restore();
    // foam line
    ctx.beginPath();
    surfaceTo(t, true);
    ctx.strokeStyle = colors.foam;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // falling and floating objects ride above the surface
    for (i = 0; i < drops.length; i++) {
      var d = drops[i];
      if (d.state === 'sink') continue;
      var rot = d.state === 'float' ? d.rot + Math.sin(t * 0.0022 + d.rot * 9) * 0.18 : d.rot;
      drawEmoji(d.e, d.x, d.y, d.size, false, rot, 1);
    }
    // spray droplets
    ctx.fillStyle = colors.foam;
    for (i = 0; i < spray.length; i++) {
      var pS = spray[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, pS.life * 2));
      ctx.beginPath();
      ctx.arc(pS.x, pS.y, pS.r || 1.8, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    raf = 0;
    if (!inView || document.hidden) return;
    tNow = t;
    var dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    step(); step();
    update(dt, t);
    draw(t);
    raf = requestAnimationFrame(loop);
  }
  function play() {
    if (!reduce && !raf && inView && !document.hidden) {
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

  function colAt(clientX) {
    var rect = canvas.getBoundingClientRect();
    return Math.round((clientX - rect.left) / SP);
  }

  readColors();
  resize();

  if (!reduce) {
    var lastX = null, lastY = null;
    canvas.addEventListener('pointermove', function (e) {
      if (lastX !== null) {
        var dx = e.clientX - lastX, dy = e.clientY - lastY;
        var imp = Math.max(-4, Math.min(4, dy * 0.18)) + (Math.random() - 0.5) * Math.min(3, Math.abs(dx) * 0.12);
        if (imp !== 0) poke(colAt(e.clientX), imp);
      }
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener('pointerleave', function () { lastX = lastY = null; });
    canvas.addEventListener('pointerdown', function (e) { spawnDrop(e.clientX, e.clientY); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        play();
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', play);
    play();
  }

  window.addEventListener('resize', resize);
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function onTheme() { readColors(); if (reduce) draw(tNow); }
  if (dark) { if (dark.addEventListener) dark.addEventListener('change', onTheme); else if (dark.addListener) dark.addListener(onTheme); }
  if ('MutationObserver' in window) {
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // Hooks for the page-wide deep layer below
  window.__sea = {
    calm: function () {
      var m = 0, mx = 0, i;
      for (i = 0; i < N; i++) { m += h[i]; if (Math.abs(h[i]) > mx) mx = Math.abs(h[i]); }
      return { mean: +(m / N).toFixed(2), max: +mx.toFixed(2) };
    },
    visible: function () {
      var r = canvas.getBoundingClientRect();
      return r.bottom > -40 && r.top < window.innerHeight + 40;
    },
    splash: function (clientX, power) {
      var r = canvas.getBoundingClientRect();
      var x = Math.max(4, Math.min(W - 4, clientX - r.left));
      splash(x, surfAt(x, tNow), power);
    },
    dropAt: function (clientX, e) {
      var r = canvas.getBoundingClientRect();
      var x = Math.max(8, Math.min(W - 8, clientX - r.left));
      drops.push({ e: e, x: x, y: surfAt(x, tNow) - 6, vy: 0, size: 20 + Math.random() * 6, rot: (Math.random() - 0.5) * 0.5, state: 'float', floatT: 0, alpha: 1 });
      if (drops.length > 10) drops.shift();
    }
  };
})();

/* The deep: a fixed page-wide layer behind the content. Click anywhere
   to drop something in. What happens depends on the object and the
   depth: floaters rise to the surface, sinkers settle on the seafloor,
   explosives go off, inflatables implode under midnight-zone pressure,
   and a person can only swim back up from the sunlight zone. Zone
   animals cruise past at their own depths, and bioluminescent specks
   drift up from the deep. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var sea = document.getElementById('sea');
  if (reduce || !sea) return;
  var canvas = document.createElement('canvas');
  canvas.id = 'deep-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  var FLOATERS = ['🥥', '🍍', '🛟', '🦆', '🧋', '🏐', '⚽', '🏀', '🎈'];
  var SINKERS = ['⚓', '🪨', '🎳', '📦', '👟', '🎲', '📱', '🐚', '🗿', '🔑'];
  var HUMANS = ['🧍', '🏊', '🤿'];
  var BOOMS = ['🧨', '💣'];
  var INFLATABLE = { '🎈': 1, '🏐': 1, '⚽': 1, '🏀': 1, '🛟': 1 };
  var ZONE_ANIMALS = {
    sun: ['🐠', '🐟', '🐢', '🐬', '🐳'],
    twi: ['🦈', '🐙', '🦑', '🐡', '🪼'],
    mid: ['🦑', '🪼', '🦐', '🐍']
  };

  var W = 0, Hv = 0, dpr = 1, waterDoc = 0, floorDoc = 0;
  var objs = [], animals = [], fx = [], sparks = [];
  var kelp = [], tufts = [], kelpW = 0, kelpC = ['#2F7D5B', '#45936B'];
  var algae = [], drifters = [], ruleDoc = -999, ruleX0 = 0, ruleX1 = 0, twiTop = 0, twiBot = 0;
  var diveBubs = [], diving = false, diveCancel = null;
  var PAD = 500, CH = 0, canvasTop = -1e9;
  var sparkColor = 'rgba(140,235,255,0.85)';
  var lastT = 0, raf = 0, idleTimer = 0, spawnIn = 2, remeasureIn = 3, now = 0;

  function measure() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; Hv = window.innerHeight;
    CH = Hv + PAD * 2;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(CH * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(CH * dpr);
      canvas.style.height = CH + 'px';
      canvasTop = -1e9; // force re-anchor
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var r = sea.getBoundingClientRect();
    waterDoc = r.top + window.scrollY + r.height * 0.52;
    floorDoc = document.documentElement.scrollHeight - 26;
    var cs = getComputedStyle(document.documentElement);
    sparkColor = (cs.getPropertyValue('--spark') || '').trim() || sparkColor;
    kelpC = [
      (cs.getPropertyValue('--kelp-1') || '').trim() || kelpC[0],
      (cs.getPropertyValue('--kelp-2') || '').trim() || kelpC[1]
    ];
    var rule = document.querySelector('.wave-rule');
    if (rule) {
      var rr = rule.getBoundingClientRect();
      ruleDoc = rr.top + window.scrollY + rr.height;
      ruleX0 = rr.left; ruleX1 = rr.right;
    }
    var scrollMax = Math.max(1, document.documentElement.scrollHeight - Hv);
    twiTop = Math.max(waterDoc + 140, Hv / 2 + (240 / 1050) * scrollMax);
    twiBot = Hv / 2 + (940 / 1050) * scrollMax;
    if (!kelp.length || Math.abs(kelpW - W) > 90) buildKelp();
  }

  function buildKelp() {
    kelpW = W;
    kelp = []; tufts = [];
    var i, n = Math.max(8, Math.round(W / 52));
    for (i = 0; i < n; i++) {
      var tall = Math.random() < 0.2;
      kelp.push({
        x: Math.random() * W,
        h: tall ? 240 + Math.random() * 210 : 50 + Math.random() * 150,
        ph: Math.random() * 6.28,
        amp: 5 + Math.random() * 11,
        w: 1.5 + Math.random() * 1.8,
        c: (Math.random() * 2) | 0,
        leaf: 5 + Math.random() * 8
      });
    }
    var m = Math.round(W / 60);
    for (i = 0; i < m; i++) {
      tufts.push({ x: Math.random() * W, h: 8 + Math.random() * 18, blades: 3 + ((Math.random() * 3) | 0), ph: Math.random() * 6.28, c: (Math.random() * 2) | 0 });
    }
    // algae patches rooted on the wave rule, and sargassum clumps adrift
    // in the twilight band
    algae = []; drifters = [];
    var span = Math.max(60, ruleX1 - ruleX0);
    n = Math.max(6, Math.round(span / 85));
    for (i = 0; i < n; i++) {
      algae.push({
        x: ruleX0 + Math.random() * span,
        h: 9 + Math.random() * 17,
        blades: 4 + ((Math.random() * 4) | 0),
        ph: Math.random() * 6.28,
        c: (Math.random() * 2) | 0
      });
    }
    for (i = 0; i < 6; i++) {
      var blobs = [], bn = 5 + ((Math.random() * 5) | 0), br = 7 + Math.random() * 9, k2;
      for (k2 = 0; k2 < bn; k2++) {
        blobs.push({ dx: (Math.random() - 0.5) * br * 2.4, dy: (Math.random() - 0.5) * br * 1.4, r: 2 + Math.random() * 3.5 });
      }
      drifters.push({ x: Math.random() * W, f: Math.random(), dir: Math.random() < 0.5 ? -1 : 1, sp: 4 + Math.random() * 8, ph: Math.random() * 6.28, blobs: blobs, c: (Math.random() * 2) | 0 });
    }
  }

  function algaeOnScreen() {
    var sy = window.scrollY;
    return (ruleDoc > sy - 40 && ruleDoc - 40 < sy + Hv) || (twiBot > sy && twiTop < sy + Hv);
  }

  function drawAlgae(sy) {
    var i, sgm;
    var ry = ruleDoc - sy;
    if (ry > -40 && ry < Hv + 40) {
      ctx.lineCap = 'round';
      for (i = 0; i < algae.length; i++) {
        var a = algae[i];
        ctx.strokeStyle = kelpC[a.c];
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.3;
        for (sgm = 0; sgm < a.blades; sgm++) {
          var spread = (sgm - (a.blades - 1) / 2) * 3.4;
          var sw = Math.sin(now * 0.0012 + a.ph + sgm * 1.3) * 2.5;
          ctx.beginPath();
          ctx.moveTo(a.x + spread * 0.3, ry + 2);
          ctx.quadraticCurveTo(a.x + spread * 0.7 + sw * 0.5, ry - a.h * 0.55, a.x + spread + sw, ry - a.h);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    for (i = 0; i < drifters.length; i++) {
      var d = drifters[i];
      var dy = twiTop + d.f * (twiBot - twiTop) - sy + Math.sin(now * 0.0008 + d.ph) * 10;
      if (dy < -40 || dy > Hv + 40) continue;
      ctx.fillStyle = kelpC[d.c];
      ctx.globalAlpha = 0.3;
      for (sgm = 0; sgm < d.blobs.length; sgm++) {
        var bl = d.blobs[sgm];
        ctx.beginPath();
        ctx.arc(d.x + bl.dx, dy + bl.dy + Math.sin(now * 0.001 + sgm) * 1.5, bl.r, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function kelpOnScreen() {
    var sy = window.scrollY;
    return floorDoc - 480 < sy + Hv && floorDoc + 30 > sy;
  }

  function drawKelp(sy) {
    if (!kelpOnScreen()) return;
    var baseY = floorDoc - sy + 8;
    var i, sgm;
    ctx.lineCap = 'round';
    for (i = 0; i < tufts.length; i++) {
      var tf = tufts[i];
      ctx.strokeStyle = kelpC[tf.c];
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.4;
      for (sgm = 0; sgm < tf.blades; sgm++) {
        var spread = (sgm - (tf.blades - 1) / 2) * 5;
        var swayT = Math.sin(now * 0.0011 + tf.ph + sgm) * 3;
        ctx.beginPath();
        ctx.moveTo(tf.x + spread * 0.4, baseY);
        ctx.quadraticCurveTo(tf.x + spread * 0.8, baseY - tf.h * 0.6, tf.x + spread + swayT, baseY - tf.h);
        ctx.stroke();
      }
    }
    var segs = 7;
    for (i = 0; i < kelp.length; i++) {
      var k = kelp[i];
      ctx.strokeStyle = kelpC[k.c];
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = k.w;
      var prevX = k.x, prevY = baseY;
      ctx.beginPath();
      ctx.moveTo(k.x, baseY);
      for (sgm = 1; sgm <= segs; sgm++) {
        var f = sgm / segs;
        var nx = k.x + Math.sin(now * 0.0009 + k.ph + sgm * 0.55) * k.amp * f * f;
        var ny = baseY - k.h * f;
        ctx.quadraticCurveTo(prevX, prevY, (prevX + nx) / 2, (prevY + ny) / 2);
        prevX = nx; prevY = ny;
      }
      ctx.lineTo(prevX, prevY);
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(1, k.w * 0.75);
      for (sgm = 2; sgm <= segs; sgm++) {
        var ff = sgm / segs;
        var bx = k.x + Math.sin(now * 0.0009 + k.ph + sgm * 0.55) * k.amp * ff * ff;
        var by = baseY - k.h * ff;
        var side = sgm % 2 ? 1 : -1;
        var ln = k.leaf * (1 - ff * 0.4);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + side * ln * 0.7, by - ln * 0.25, bx + side * ln, by - ln * 0.7);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function ensureAnchor() {
    var sy = window.scrollY;
    var maxTop = Math.max(0, document.documentElement.scrollHeight - CH);
    if (sy - 80 < canvasTop || sy + Hv + 80 > canvasTop + CH) {
      canvasTop = Math.max(0, Math.min(maxTop, sy - PAD));
      canvas.style.top = canvasTop + 'px';
    }
  }

  function metersAt(docY) {
    // same scale as the depth gauge: the metres it reads when this
    // point sits at the centre of the screen
    var max = document.documentElement.scrollHeight - Hv;
    var f = (docY - Hv / 2) / Math.max(1, max);
    return Math.max(0, Math.min(1, f)) * 1050;
  }
  function zoneAt(docY) {
    var m = metersAt(docY);
    return m < 200 ? 'sun' : m < 1000 ? 'twi' : 'mid';
  }
  function viewMeters() {
    var max = document.documentElement.scrollHeight - Hv;
    return max > 0 ? (window.scrollY / max) * 1050 : 0;
  }

  function addFx(f) { if (fx.length < 120) fx.push(f); }
  function bubblesAt(x, y, n, fast) {
    for (var k = 0; k < n; k++) {
      addFx({ type: 'bub', x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 10,
        vx: fast ? (Math.random() - 0.5) * 160 : (Math.random() - 0.5) * 20,
        vy: -(30 + Math.random() * (fast ? 160 : 60)),
        r: 1.3 + Math.random() * 2, life: 0.8 + Math.random() * 0.6, t: 0 });
    }
  }

  function crushNow(o) {
    var m = metersAt(o.y);
    return o.e === '🎈' ? m >= 200 : m >= 1000;
  }

  function enterWater(o) {
    bubblesAt(o.x, o.y, 5);
    if (o.cat === 'float') o.state = (INFLATABLE[o.e] && crushNow(o)) ? 'crush' : 'rise';
    else if (o.cat === 'sink') o.state = 'sinking';
    else if (o.cat === 'boom') o.state = 'fuse';
    else {
      var z = zoneAt(o.y);
      if (z === 'sun') o.state = 'swim';
      else { o.state = 'struggle'; o.doom = z === 'mid'; }
    }
    o.t = 0;
  }

  function easeDive(u) {
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }

  function dive(targetY, hash) {
    if (diveCancel) diveCancel();
    var startY = window.scrollY;
    var maxY = document.documentElement.scrollHeight - Hv;
    var endY = Math.max(0, Math.min(maxY, targetY));
    var dist = Math.abs(endY - startY);
    if (dist < 4) return;
    var dur = Math.min(2100, 500 + dist * 0.45);
    var t0 = performance.now(), cancelled = false, lastY = startY;
    function cancel() { cancelled = true; diving = false; }
    diveCancel = cancel;
    window.addEventListener('wheel', cancel, { once: true, passive: true });
    window.addEventListener('touchstart', cancel, { once: true, passive: true });
    diving = true;
    function stepDive(tn) {
      if (cancelled) return;
      var u = Math.min(1, (tn - t0) / dur);
      var y = startY + (endY - startY) * easeDive(u);
      window.scrollTo(0, y);
      // bubbles stream past, more the faster we move
      var speed = Math.abs(y - lastY);
      lastY = y;
      var n = Math.min(6, Math.round(speed * 0.14));
      for (var k = 0; k < n && diveBubs.length < 90; k++) {
        diveBubs.push({
          x: Math.random() * W,
          y: Hv + 12 + Math.random() * 60,
          vy: -(280 + Math.random() * 430),
          r: 1.6 + Math.random() * 3.6,
          ph: Math.random() * 6.28,
          life: 0.8 + Math.random() * 0.8,
          t: 0
        });
      }
      if (u < 1) requestAnimationFrame(stepDive);
      else {
        diving = false;
        if (hash) { try { history.replaceState(null, '', hash); } catch (err) {} }
      }
      wake();
    }
    requestAnimationFrame(stepDive);
    wake();
  }

  function spawnObject(cx, cy, forceCat) {
    var r = Math.random(), e, cat;
    cat = forceCat || (r < 0.38 ? 'float' : r < 0.72 ? 'sink' : r < 0.9 ? 'human' : 'boom');
    var pool = cat === 'float' ? FLOATERS : cat === 'sink' ? SINKERS : cat === 'human' ? HUMANS : BOOMS;
    e = pool[(Math.random() * pool.length) | 0];
    var o = {
      e: e, cat: cat,
      x: Math.max(12, Math.min(W - 12, cx)),
      y: cy + window.scrollY,
      vx: 0, vy: 0,
      size: e === '🗿' ? 34 : e === '🐳' ? 30 : 20 + Math.random() * 8,
      rot: (Math.random() - 0.5) * 0.4, t: 0, alpha: 1, doom: false,
      state: 'air'
    };
    if (o.y >= waterDoc) enterWater(o);
    objs.push(o);
    if (objs.length > 16) objs.shift();
    wake();
    return o;
  }

  function explode(o) {
    addFx({ type: 'flash', x: o.x, y: o.y, size: 54, life: 0.4, t: 0 });
    addFx({ type: 'ring', x: o.x, y: o.y, r: 6, vr: 260, life: 0.55, t: 0 });
    bubblesAt(o.x, o.y, 22, true);
    var i;
    for (i = 0; i < animals.length; i++) {
      var a = animals[i];
      var dx = a.x - o.x, dy = (a.y - o.y);
      if (dx * dx + dy * dy < 260 * 260) {
        a.dir = dx >= 0 ? 1 : -1;
        a.sp = 160 + Math.random() * 80;
        a.flee = true;
      }
    }
    for (i = 0; i < objs.length; i++) {
      var b = objs[i];
      if (b !== o && Math.abs(b.x - o.x) < 170 && Math.abs(b.y - o.y) < 170) b.vy -= 150;
    }
    var prox = 1 - Math.abs(o.y - waterDoc) / 340;
    if (prox > 0 && window.__sea) window.__sea.splash(o.x, 8 + 14 * prox);
  }

  function pop(o) {
    addFx({ type: 'flash', x: o.x, y: o.y, size: o.size * 1.7, life: 0.32, t: 0 });
    addFx({ type: 'ring', x: o.x, y: o.y, r: 4, vr: 150, life: 0.4, t: 0 });
    bubblesAt(o.x, o.y, 12, true);
  }

  function die(o) {
    bubblesAt(o.x, o.y, 8);
    objs.push({ e: '💀', cat: 'sink', state: 'sinking', x: o.x, y: o.y, vx: 0, vy: 10, size: 19, rot: 0, t: 0, alpha: 1 });
    objs.push({ e: '👻', cat: 'ghost', state: 'ghost', x: o.x, y: o.y, vx: 0, vy: -55, size: 21, rot: 0, t: 0, alpha: 1 });
  }

  function reachSurface(o, quiet) {
    if (window.__sea) {
      if (!quiet && window.__sea.visible()) window.__sea.splash(o.x, 6);
      if (o.e === '🎈') return false; // balloons burst free instead
      window.__sea.dropAt(o.x, o.e);
    }
    return true;
  }

  function update(dt) {
    var i;
    for (i = objs.length - 1; i >= 0; i--) {
      var o = objs[i];
      o.t += dt;
      switch (o.state) {
        case 'air':
          o.vy += (o.e === '🎈' ? -520 : 900) * dt;
          o.y += o.vy * dt;
          if (o.e === '🎈' && o.y - window.scrollY < -140) { objs.splice(i, 1); break; }
          if (o.vy > 0 && o.y >= waterDoc - 4) {
            o.y = waterDoc - 4;
            var impact = Math.min(22, 2.5 + o.vy * 0.02);
            if (window.__sea && window.__sea.visible()) window.__sea.splash(o.x, impact);
            bubblesAt(o.x, o.y, Math.round(2 + impact * 0.5), impact > 14);
            if (o.cat === 'float') {
              if (reachSurface(o, true)) objs.splice(i, 1);
            } else enterWater(o);
          }
          break;
        case 'rise':
          o.vy = Math.max(o.vy - 500 * dt, -130);
          o.y += o.vy * dt;
          o.x += Math.sin(now * 0.004 + o.rot * 10) * 14 * dt;
          if (Math.random() < dt * 2) bubblesAt(o.x, o.y + o.size * 0.4, 1);
          if (o.y <= waterDoc + 6) {
            if (o.e === '🎈') { o.state = 'air'; o.vy = -170; if (window.__sea && window.__sea.visible()) window.__sea.splash(o.x, 5); }
            else if (reachSurface(o)) objs.splice(i, 1);
          }
          break;
        case 'sinking':
          o.vy = Math.min(o.vy + 420 * dt, o.e === '🗿' ? 230 : 110);
          o.y += o.vy * dt;
          o.x += Math.sin(now * 0.003 + o.rot * 8) * 10 * dt;
          o.rot += 0.3 * dt;
          if (Math.random() < dt * 1.2) bubblesAt(o.x, o.y, 1);
          if (o.y >= floorDoc - o.size * 0.4) {
            o.y = floorDoc - o.size * 0.4;
            o.state = 'rest';
            o.t = 0;
            bubblesAt(o.x, o.y, o.e === '🗿' ? 10 : 4);
          }
          break;
        case 'rest':
          if (o.t > 10) { o.alpha -= 0.6 * dt; if (o.alpha <= 0) objs.splice(i, 1); }
          break;
        case 'swim':
          o.y += Math.sin(now * 0.005 + o.rot * 9) * 8 * dt;
          o.x += Math.sin(now * 0.002) * 12 * dt;
          if (Math.random() < dt * 1.4) bubblesAt(o.x, o.y, 1);
          if (o.t > 1.5) { o.state = 'rise'; o.vy = -40; }
          break;
        case 'struggle':
          if (Math.random() < dt * 5) bubblesAt(o.x, o.y, 1);
          if (o.t > 1.05) {
            if (o.doom) { die(o); objs.splice(objs.indexOf(o), 1); }
            else { o.state = 'rise'; o.vy = -120; }
          }
          break;
        case 'ghost':
          o.y += o.vy * dt;
          o.x += Math.sin(now * 0.003 + o.rot) * 18 * dt;
          if (o.t > 2.2) o.alpha -= 0.35 * dt;
          if (o.alpha <= 0 || o.y - window.scrollY < -140) objs.splice(i, 1);
          break;
        case 'fuse':
          o.y += 24 * dt;
          if (Math.random() < dt * 6) bubblesAt(o.x, o.y, 1);
          if (o.t > 1.15) { explode(o); objs.splice(i, 1); }
          break;
        case 'crush':
          if (o.t > 0.55) { pop(o); objs.splice(i, 1); }
          break;
      }
    }

    for (i = animals.length - 1; i >= 0; i--) {
      var a = animals[i];
      a.x += a.dir * a.sp * dt;
      if (a.x < -80 || a.x > W + 80) animals.splice(i, 1);
    }

    for (i = diveBubs.length - 1; i >= 0; i--) {
      var db = diveBubs[i];
      db.t += dt;
      db.y += db.vy * dt;
      db.x += Math.sin(now * 0.004 + db.ph) * 26 * dt;
      if (db.t >= db.life || db.y < -14) diveBubs.splice(i, 1);
    }

    for (i = 0; i < drifters.length; i++) {
      var dr = drifters[i];
      dr.x += dr.dir * dr.sp * dt;
      if (dr.x < -30) dr.x = W + 28; else if (dr.x > W + 30) dr.x = -28;
    }

    for (i = fx.length - 1; i >= 0; i--) {
      var f = fx[i];
      f.t += dt;
      if (f.type === 'bub') {
        f.x += (f.vx || 0) * dt;
        f.y += f.vy * dt;
        f.vy -= 20 * dt;
      } else if (f.type === 'ring') {
        f.r += f.vr * dt;
      }
      if (f.t >= f.life) fx.splice(i, 1);
    }

    // spawn zone animals in the visible underwater band
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawnIn = 2 + Math.random() * 2;
      if (animals.length < 6) {
        var y0 = Math.max(waterDoc + 40, window.scrollY + 30);
        var y1 = Math.min(window.scrollY + Hv - 30, floorDoc - 20);
        if (y1 > y0) {
          var docY = y0 + Math.random() * (y1 - y0);
          var pool = ZONE_ANIMALS[zoneAt(docY)];
          var dir = Math.random() < 0.5 ? -1 : 1;
          var z = zoneAt(docY);
          animals.push({
            e: pool[(Math.random() * pool.length) | 0],
            x: dir < 0 ? W + 60 : -60,
            y: docY,
            dir: dir,
            sp: 20 + Math.random() * 30,
            size: z === 'mid' ? 22 + Math.random() * 12 : 17 + Math.random() * 11,
            ph: Math.random() * 6.28,
            bob: 2 + Math.random() * 4,
            flee: false
          });
        }
      }
    }

    // bioluminescent specks track the viewport's depth
    var m = viewMeters();
    var target = m < 420 ? 0 : Math.round(((m - 420) / 630) * 70);
    while (sparks.length < target) {
      sparks.push({ x: Math.random() * W, y: Math.random() * Hv, r: 0.8 + Math.random() * 1.9,
        ph: Math.random() * 6.28, vy: -(4 + Math.random() * 10), big: Math.random() < 0.12 });
    }
    if (sparks.length > target) sparks.length = target;
    for (i = 0; i < sparks.length; i++) {
      var sp = sparks[i];
      sp.y += sp.vy * dt;
      sp.x += Math.sin(now * 0.0006 + sp.ph) * 8 * dt;
      if (sp.y < -6) { sp.y = Hv + 6; sp.x = Math.random() * W; }
    }
  }

  function drawEmoji(e, x, y, size, flip, rot, alpha) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    if (rot) ctx.rotate(rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = Math.round(size) + 'px ' + EMOJI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e, 0, 0);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, CH);
    var sy = window.scrollY, i;
    ctx.save();
    ctx.translate(0, sy - canvasTop);

    ctx.fillStyle = sparkColor;
    for (i = 0; i < sparks.length; i++) {
      var sp = sparks[i];
      var tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * 0.002 + sp.ph * 3));
      ctx.globalAlpha = tw;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, 6.2832);
      ctx.fill();
      if (sp.big) {
        ctx.globalAlpha = tw * 0.22;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.r * 3.2, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    drawKelp(sy);
    drawAlgae(sy);

    for (i = 0; i < animals.length; i++) {
      var a = animals[i];
      var ay = a.y - sy + Math.sin(now * 0.0015 + a.ph) * a.bob;
      if (ay < -60 || ay > Hv + 60) continue;
      drawEmoji(a.e, a.x, ay, a.size, a.dir > 0, Math.sin(now * 0.001 + a.ph) * 0.08, a.flee ? 0.9 : 0.85);
    }

    for (i = 0; i < objs.length; i++) {
      var o = objs[i];
      var oy = o.y - sy;
      if (oy < -140 || oy > Hv + 140) continue;
      var ox = o.x, rot = o.rot, alpha = o.alpha;
      if (o.state === 'struggle' || o.state === 'crush') {
        ox += (Math.random() - 0.5) * 5;
        oy += (Math.random() - 0.5) * 4;
      }
      if (o.state === 'fuse') alpha = 0.6 + 0.4 * Math.sin(now * 0.03);
      if (o.state === 'ghost') alpha = o.alpha * (0.7 + 0.3 * Math.sin(now * 0.006));
      if (o.state === 'rest') rot = 0.5;
      drawEmoji(o.e, ox, oy, o.size, false, rot, alpha);
    }

    for (i = 0; i < fx.length; i++) {
      var f = fx[i];
      var k = 1 - f.t / f.life;
      var fy = f.y - sy;
      if (f.type === 'bub') {
        ctx.globalAlpha = Math.max(0, k) * 0.8;
        ctx.fillStyle = sparkColor;
        ctx.beginPath();
        ctx.arc(f.x, fy, f.r, 0, 6.2832);
        ctx.fill();
      } else if (f.type === 'ring') {
        ctx.globalAlpha = Math.max(0, k) * 0.9;
        ctx.strokeStyle = sparkColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, fy, f.r, 0, 6.2832);
        ctx.stroke();
      } else if (f.type === 'flash') {
        drawEmoji('💥', f.x, fy, f.size * (1 + (1 - k) * 0.7), false, 0, k);
      }
    }
    ctx.strokeStyle = sparkColor;
    ctx.lineWidth = 1.2;
    for (i = 0; i < diveBubs.length; i++) {
      var db = diveBubs[i];
      var kb = 1 - db.t / db.life;
      ctx.globalAlpha = Math.max(0, kb) * 0.75;
      ctx.beginPath();
      ctx.arc(db.x, db.y, db.r, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = Math.max(0, kb) * 0.25;
      ctx.beginPath();
      ctx.arc(db.x, db.y, db.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function active() {
    return objs.length > 0 || animals.length > 0 || fx.length > 0 || sparks.length > 0 || viewMeters() >= 420 || kelpOnScreen() || algaeOnScreen() || diving || diveBubs.length > 0;
  }

  function loop(t) {
    raf = 0;
    if (document.hidden) return;
    now = t;
    var dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;
    remeasureIn -= dt;
    if (remeasureIn <= 0) { remeasureIn = 3; measure(); }
    ensureAnchor();
    update(dt);
    draw();
    if (active()) raf = requestAnimationFrame(loop);
    else {
      ctx.clearRect(0, 0, W, Hv);
      idle();
    }
  }
  function idle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { wake(); }, 500);
  }
  function wake() {
    if (!raf && !document.hidden) {
      if (active()) {
        lastT = performance.now();
        raf = requestAnimationFrame(loop);
      } else idle();
    }
  }

  measure();
  window.addEventListener('resize', function () { measure(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
  window.addEventListener('scroll', function () { if (!raf) ensureAnchor(); wake(); }, { passive: true });

  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (dark) {
    var onT = function () { measure(); };
    if (dark.addEventListener) dark.addEventListener('change', onT); else if (dark.addListener) dark.addListener(onT);
  }
  if ('MutationObserver' in window) {
    new MutationObserver(function () { measure(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  document.addEventListener('click', function (e) {
    var anchor = e.target && e.target.closest && e.target.closest('a[href^="#"]');
    if (anchor) {
      var id = anchor.getAttribute('href').slice(1);
      var el = id && document.getElementById(id);
      if (el) {
        e.preventDefault();
        var target = id === 'top' ? 0 : el.getBoundingClientRect().top + window.scrollY - 24;
        dive(target, '#' + id);
      }
      return;
    }
    if (e.defaultPrevented) return;
    if (e.target && e.target.closest && e.target.closest('a,button,input,select,textarea,video,dialog,label')) return;
    if (e.target && e.target.id === 'sea-canvas') return;
    if (window.getSelection && String(window.getSelection())) return;
    spawnObject(e.clientX, e.clientY);
  });

  window.__deep = { spawn: spawnObject, objs: objs, animals: animals, sparks: sparks };
  wake();
})();

/* Depth gauge: the hidden scrollbar, read as metres below the surface. */
(function () {
  var el = document.getElementById('depth');
  var floor = document.getElementById('floor');
  if (!el) return;
  var ticking = false;
  function update() {
    ticking = false;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) { el.dataset.on = 'false'; return; }
    var y = window.scrollY || doc.scrollTop || 0;
    var frac = y / max;
    doc.style.setProperty('--depth01', frac.toFixed(3));
    var m = Math.round(frac * 1050);
    var zone = m < 200 ? 'sunlight zone' : m < 1000 ? 'twilight zone' : 'midnight zone';
    var atFloor = frac > 0.985;
    el.textContent = atFloor ? '▼ seafloor · ' + zone : '▼ ' + m + ' m · ' + zone;
    el.dataset.on = y > 160 ? 'true' : 'false';
    if (floor) floor.textContent = atFloor || frac > 0.9 ? 'Made in Honolulu · you reached the seafloor' : 'Made in Honolulu';
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();
