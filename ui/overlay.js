/* LiquidFlower overlay: petals + center, real backdrop glass, sounds. */
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const menu = document.getElementById("menu");
let CFG = null;
let isOpen = false;
let hideTimer = null;

/* ---------- Sounds (WebAudio, no assets) ---------- */
const Sound = (() => {
  let ctx;
  const ensure = () => {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  // Soft attack, exponential body, gentle lowpass — small and warm.
  function tone({ f0, f1, dur, vol, type = "sine", delay = 0, lp = 5600 }) {
    const c = ensure();
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lp;
    f.Q.value = 0.4;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur * 0.85);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.018);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.55, dur * 0.22);
    o.connect(g); g.connect(f); f.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.08);
  }
  function breath({ dur, vol, freq, delay = 0 }) {
    const c = ensure();
    const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(t);
  }
  const OPEN = {
    // warm rise with a light sparkle on top
    bloom: (v) => {
      tone({ f0: 294, f1: 523, dur: 0.22, vol: 0.34 * v, lp: 3200 });
      tone({ f0: 880, f1: 1175, dur: 0.17, vol: 0.10 * v, delay: 0.05, lp: 6000 });
    },
    // crystalline ping, bell partials, long soft tail
    glass: (v) => {
      tone({ f0: 1318, f1: 1306, dur: 0.50, vol: 0.16 * v, type: "sine", lp: 8000 });
      tone({ f0: 1975, f1: 1960, dur: 0.36, vol: 0.07 * v, delay: 0.02, lp: 9000 });
      breath({ dur: 0.10, vol: 0.05 * v, freq: 5200 });
    },
    // water drop: quick pitch fall with a plop
    drop: (v) => {
      tone({ f0: 740, f1: 233, dur: 0.17, vol: 0.36 * v, lp: 2600 });
      tone({ f0: 1480, f1: 466, dur: 0.10, vol: 0.08 * v, lp: 4200 });
    },
    // tight pop: airy tick over a warm thump
    pop: (v) => {
      breath({ dur: 0.05, vol: 0.16 * v, freq: 3000 });
      tone({ f0: 196, f1: 147, dur: 0.11, vol: 0.30 * v, lp: 1400 });
    },
    // little major arpeggio, like a doorbell
    chime: (v) => {
      tone({ f0: 1046, f1: 1040, dur: 0.42, vol: 0.13 * v, lp: 7000 });
      tone({ f0: 1318, f1: 1312, dur: 0.40, vol: 0.11 * v, delay: 0.06, lp: 7000 });
      tone({ f0: 1568, f1: 1562, dur: 0.38, vol: 0.09 * v, delay: 0.12, lp: 7000 });
    },
  };
  return {
    open: (v, type) => (OPEN[type] || OPEN.bloom)(v),
    close: (v) => {
      tone({ f0: 523, f1: 262, dur: 0.13, vol: 0.24 * v, lp: 3000 });
      tone({ f0: 1046, f1: 523, dur: 0.09, vol: 0.07 * v, lp: 5200 });
    },
    tick: (v) => tone({ f0: 987, f1: 1108, dur: 0.05, vol: 0.14 * v, lp: 6000 }),
  };
})();

/* ---------- Layout ---------- */

function petalPositions(n, radius) {
  const size = CFG.appearance.petalSize;
  const m = size / 2 + 6;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    let x = Math.cos(a) * radius;
    let y = Math.sin(a) * radius;
    // keep petals inside the screen
    const dx = CFG._cursor.x + x;
    const dy = CFG._cursor.y + y;
    if (dx < m) x += m - dx;
    if (dx > W - m) x -= dx - (W - m);
    if (dy < m) y += m - dy;
    if (dy > H - m) y -= dy - (H - m);
    out.push([x, y]);
  }
  return out;
}

function applyConfigVars() {
  const ap = CFG.appearance;
  const s = document.documentElement.style;
  s.setProperty("--petal-size", ap.petalSize + "px");
  s.setProperty("--petal-opacity", ap.opacity);
  s.setProperty("--glass-blur", ap.blur + "px");
  s.setProperty("--glow-a", ap.glow ? ap.glowStrength * 0.5 : 0);
  const speed = Math.min(2, Math.max(0.5, CFG.animationSpeed || 1));
  s.setProperty("--dur", Math.round(420 / speed) + "ms");
  s.setProperty("--stagger", Math.round(16 / speed) + "ms");
  menu.classList.toggle("flat", !ap.liquidGlass);
}

function petalHTML(p) {
  const iconSize = Math.round(CFG.appearance.petalSize * 0.27);
  const icon = lucideIcon(p.icon, iconSize, "#fff", 1.9);
  const mono = !p.color || p.color === "none";
  return `
    <div class="body${mono ? " mono" : ""}">
      <div class="clip"><div class="cap"></div><div class="color"></div><div class="tint"></div><div class="sheen"></div></div>
      <div class="spec"></div>
      <div class="icon">${icon}</div>
      <div class="label"></div>
    </div>`;
}

function setPetalLabel(el, name) {
  el.querySelector(".label").textContent = name;
}

function positionCap(el, screenX, screenY, region, scale, sel = ".cap") {
  const cap = el.querySelector(sel);
  if (!cap) return;
  if (!CFG._capture) {
    cap.style.display = "none";
    return;
  }
  const rx = region.x / scale, ry = region.y / scale;
  const rw = region.w / scale, rh = region.h / scale;
  cap.style.backgroundImage = `url("${CFG._capture}")`;
  cap.style.backgroundSize = `${rw}px ${rh}px`;
  cap.style.backgroundPosition = `${rx - screenX}px ${ry - screenY}px`;
}

async function attachAppIcon(el, petal) {
  if (petal.action !== "open_app" || !petal.param) return;
  try {
    const url = await invoke("get_app_icon", { path: petal.param });
    if (url && isOpen) {
      const holder = el.querySelector(".icon");
      const img = document.createElement("img");
      img.src = url;
      holder.innerHTML = "";
      holder.appendChild(img);
    }
  } catch (_) { /* keep lucide fallback */ }
}

function normalizeConfig(config) {
  const ap = (config.appearance = config.appearance || {});
  ap.petalSize = ap.petalSize ?? ap.petal_size ?? 112;
  ap.opacity = ap.opacity ?? 0.5;
  ap.blur = ap.blur ?? 24;
  ap.liquidGlass = ap.liquidGlass ?? ap.liquid_glass ?? true;
  ap.glow = ap.glow ?? true;
  ap.glowStrength = ap.glowStrength ?? ap.glow_strength ?? 0.6;
  ap.radius = ap.radius ?? 150;
  config.animation = config.animation || "bloom";
  config.animationSpeed = config.animationSpeed ?? config.animation_speed ?? 1;
  config.closeAfterAction = config.closeAfterAction ?? config.close_after_action ?? true;
  config.sounds = config.sounds || { open: true, close: true, volume: 0.6 };
  config.sounds.openType = config.sounds.openType || "bloom";
  config.petals = Array.isArray(config.petals) && config.petals.length ? config.petals : [];
}

function buildMenu(payload) {
  const { cursor, region, scale, config, capture, micMuted, soundMuted } = payload;
  normalizeConfig(config);
  CFG = config;
  CFG._capture = capture || null;
  CFG._cursor = { x: cursor.x / scale, y: cursor.y / scale };
  CFG._micMuted = !!micMuted;
  CFG._soundMuted = !!soundMuted;
  CFG._petalEls = new Map();
  CFG._parallax = [];

  applyConfigVars();
  menu.className = `anim-${CFG.animation || "bloom"}`;
  menu.classList.add("open");
  menu.querySelectorAll(".petal, .core").forEach((n) => n.remove());

  const positions = petalPositions(CFG.petals.length, CFG.appearance.radius);
  const cx = CFG._cursor.x, cy = CFG._cursor.y;

  CFG.petals.forEach((p, i) => {
    const [x, y] = positions[i];
    const el = document.createElement("div");
    const mono = !p.color || p.color === "none";
    el.className = "petal pre" + (mono ? " mono" : "");
    // The element is anchored at the cursor; --px/--py place it on the ring.
    // Bloom grows from translate(0,0); cascade/wave start from the offset.
    el.style.left = cx - CFG.appearance.petalSize / 2 + "px";
    el.style.top = cy - CFG.appearance.petalSize / 2 + "px";
    el.style.setProperty("--px", x + "px");
    el.style.setProperty("--py", y + "px");
    // Neutral carrier for colorless petals so rims and glow still work.
    el.style.setProperty("--c", mono ? "#9aa3b2" : p.color);
    el.style.setProperty("--d", Math.round(i * (16 / Math.max(0.5, CFG.animationSpeed || 1))) + "ms");
    el.innerHTML = petalHTML(p);
    setPetalLabel(el, p.name);

    positionCap(el, cx + x - CFG.appearance.petalSize / 2, cy + y - CFG.appearance.petalSize / 2, region, scale);
    const capEl = el.querySelector(".cap");
    if (capEl) capEl.dataset.depth = "9";
    if (p.action === "mic_mute" && CFG._micMuted) el.classList.add("alert");
    if (CFG._parallax) CFG._parallax.push({ el: capEl, depth: 9 });
    CFG._petalEls.set(p.id, el);
    el.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (e.button === 0) activatePetal(p);
    });
    menu.appendChild(el);
    attachAppIcon(el, p);
  });

  const core = document.createElement("div");
  core.className = "core pre";
  core.style.left = cx - (CFG.appearance.petalSize * 0.5) / 2 + "px";
  core.style.top = cy - (CFG.appearance.petalSize * 0.5) / 2 + "px";
  core.innerHTML = `<div class="cbody"><div class="clip"><div class="ccap"></div><div class="ctint"></div></div><div class="cspec"></div>${lucideIcon("settings", Math.round(CFG.appearance.petalSize * 0.2), "rgba(255,255,255,0.95)", 2)}</div>`;
  positionCap(core, cx - (CFG.appearance.petalSize * 0.5) / 2, cy - (CFG.appearance.petalSize * 0.5) / 2, region, scale, ".ccap");
  const coreCap = core.querySelector(".ccap");
  if (coreCap) coreCap.dataset.depth = "13";
  if (CFG._parallax) CFG._parallax.push({ el: coreCap, depth: 13 });
  core.title = "";
  core.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    if (e.button === 0) {
      invoke("open_settings_window").catch(() => {});
      closeMenu(false);
    }
  });
  menu.appendChild(core);
}

function activatePetal(p) {
  const v = CFG.sounds.volume;
  if (CFG.sounds.open || CFG.sounds.close) Sound.tick(v);
  invoke("run_action", { action: p.action, param: p.param || "" }).catch(() => {});

  // live mic-state badge: the petal glows red while the mic is muted
  if (p.action === "mic_mute") {
    CFG._micMuted = !CFG._micMuted;
    const el = CFG._petalEls && CFG._petalEls.get(p.id);
    if (el) el.classList.toggle("alert", CFG._micMuted);
  }

  if (CFG.closeAfterAction !== false) closeMenu(true);
}

function showMenu(payload) {
  clearTimeout(hideTimer);
  buildMenu(payload);
  isOpen = true;
  const v = CFG.sounds.volume;
  if (CFG.sounds.open) Sound.open(v, CFG.sounds.openType);

  // move petals from center to their places on the next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      menu.querySelectorAll(".petal, .core").forEach((el) => {
        el.classList.remove("pre");
        el.classList.add("in");
      });
    });
  });
}

function closeMenu(playSound = true) {
  if (!isOpen) return;
  isOpen = false;
  if (playSound && CFG && CFG.sounds.close) Sound.close(CFG.sounds.volume);

  const els = menu.querySelectorAll(".petal, .core");
  els.forEach((el) => {
    el.classList.remove("in");
    el.classList.add("out");
  });

  const dur = 420 / Math.max(0.5, (CFG && CFG.animationSpeed) || 1) * 0.45;
  hideTimer = setTimeout(() => {
    menu.classList.remove("open");
    menu.querySelectorAll(".petal, .core").forEach((n) => n.remove());
    invoke("overlay_hidden").catch(() => {});
  }, dur + 40);
}

/* ---------- Events from Rust ---------- */

listen("menu/show", (e) => showMenu(e.payload));
listen("menu/hide", () => closeMenu(true));
listen("config/updated", (e) => { CFG = e.payload; });

/* Click anywhere outside petals closes. */
window.addEventListener("mousedown", (e) => {
  if (isOpen && !e.target.closest(".petal") && !e.target.closest(".core")) closeMenu(true);
});
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (isOpen) closeMenu(true);
});

/* ---------- Parallax: the refracted backdrop shifts as the cursor moves,
   like looking through real glass at different angles ---------- */
(() => {
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  let raf = null;

  function step() {
    cur.x += (target.x - cur.x) * 0.14;
    cur.y += (target.y - cur.y) * 0.14;
    const targets = (CFG && CFG._parallax) || [];
    for (const t of targets) {
      if (!t.el) continue;
      t.el.style.transform = `translate(${(-cur.x * t.depth).toFixed(2)}px, ${(-cur.y * t.depth).toFixed(2)}px) scale(1.18)`;
    }
    if (isOpen && targets.length && (Math.abs(target.x - cur.x) > 0.002 || Math.abs(target.y - cur.y) > 0.002)) {
      raf = requestAnimationFrame(step);
    } else {
      raf = null;
    }
  }

  window.addEventListener("mousemove", (e) => {
    if (!isOpen || !CFG || !CFG._capture) return;
    const dx = e.clientX - CFG._cursor.x;
    const dy = e.clientY - CFG._cursor.y;
    const extent = CFG.appearance.radius * 1.3 + 60;
    target.x = Math.max(-1, Math.min(1, dx / extent));
    target.y = Math.max(-1, Math.min(1, dy / extent));
    if (!raf) raf = requestAnimationFrame(step);
  });
})();

invoke("overlay_ready").catch(() => {});
