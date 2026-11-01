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
  function blip({ f0, f1, dur, vol, type = "sine", delay = 0 }) {
    const c = ensure();
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6400;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(lp); lp.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise({ dur, vol, freq = 2600, delay = 0 }) {
    const c = ensure();
    const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(t);
  }
  const OPEN = {
    bloom: (v) => blip({ f0: 330, f1: 680, dur: 0.16, vol: 0.5 * v }),
    glass: (v) => {
      blip({ f0: 1560, f1: 1900, dur: 0.18, vol: 0.26 * v, type: "triangle" });
      blip({ f0: 2340, f1: 2500, dur: 0.13, vol: 0.10 * v, delay: 0.03 });
    },
    drop: (v) => blip({ f0: 950, f1: 320, dur: 0.15, vol: 0.5 * v }),
    pop: (v) => {
      noise({ dur: 0.07, vol: 0.22 * v, freq: 2800 });
      blip({ f0: 210, f1: 130, dur: 0.10, vol: 0.38 * v });
    },
    chime: (v) => {
      blip({ f0: 660, f1: 655, dur: 0.34, vol: 0.24 * v });
      blip({ f0: 990, f1: 985, dur: 0.30, vol: 0.16 * v, delay: 0.05 });
    },
  };
  return {
    open: (v, type) => (OPEN[type] || OPEN.bloom)(v),
    close: (v) => blip({ f0: 640, f1: 300, dur: 0.11, vol: 0.38 * v }),
    tick: (v) => blip({ f0: 900, f1: 1050, dur: 0.06, vol: 0.2 * v }),
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
      <div class="clip"><div class="cap"></div><div class="color"></div><div class="tint"></div></div>
      <div class="spec"></div>
      <div class="icon">${icon}</div>
      <div class="label"></div>
    </div>`;
}

function setPetalLabel(el, name) {
  el.querySelector(".label").textContent = name;
}

function positionCap(el, screenX, screenY, region, scale) {
  const cap = el.querySelector(".cap");
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
  config.sounds = config.sounds || { open: true, close: true, volume: 0.6 };
  config.sounds.openType = config.sounds.openType || "bloom";
  config.petals = Array.isArray(config.petals) && config.petals.length ? config.petals : [];
}

function buildMenu(payload) {
  const { cursor, region, scale, config, capture } = payload;
  normalizeConfig(config);
  CFG = config;
  CFG._capture = capture || null;
  CFG._cursor = { x: cursor.x / scale, y: cursor.y / scale };

  applyConfigVars();
  menu.className = `anim-${CFG.animation || "bloom"}`;
  menu.classList.add("open");
  menu.querySelectorAll(".petal, .core").forEach((n) => n.remove());

  const positions = petalPositions(CFG.petals.length, CFG.appearance.radius);
  const cx = CFG._cursor.x, cy = CFG._cursor.y;

  CFG.petals.forEach((p, i) => {
    const [x, y] = positions[i];
    const el = document.createElement("div");
    el.className = "petal pre" + (!p.color || p.color === "none" ? " mono" : "");
    // The element is anchored at the cursor; --px/--py place it on the ring.
    // Bloom grows from translate(0,0); cascade/wave start from the offset.
    el.style.left = cx - CFG.appearance.petalSize / 2 + "px";
    el.style.top = cy - CFG.appearance.petalSize / 2 + "px";
    el.style.setProperty("--px", x + "px");
    el.style.setProperty("--py", y + "px");
    el.style.setProperty("--c", p.color);
    el.style.setProperty("--d", Math.round(i * (16 / Math.max(0.5, CFG.animationSpeed || 1))) + "ms");
    el.innerHTML = petalHTML(p);
    setPetalLabel(el, p.name);

    positionCap(el, cx + x - CFG.appearance.petalSize / 2, cy + y - CFG.appearance.petalSize / 2, region, scale);
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
  core.innerHTML = lucideIcon("settings", Math.round(CFG.appearance.petalSize * 0.2), "rgba(255,255,255,0.95)", 2);
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
  closeMenu(true);
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

invoke("overlay_ready").catch(() => {});
