/* LiquidFlower settings logic. */
const { invoke } = window.__TAURI__.core;

let cfg = null;
let saveTimer = null;
let selectedId = null;
let ACTIONS = [];

const PALETTE = [
  "#0A84FF", "#5AC8FA", "#64D2FF", "#30D158", "#FFD60A", "#FF9F0A",
  "#FF453A", "#FF375F", "#BF5AF2", "#5E5CE6", "#FFFFFF", "#98989D",
];
const ANIM = [["bloom", "Цветение"], ["cascade", "Каскад"], ["wave", "Волна"]];
const TRIGGERS = [["middle", "Колёсико"], ["back", "Назад"], ["forward", "Вперёд"], ["hotkey", "Клавиши"]];
const OPEN_SOUNDS = [
  ["bloom", "Цветение"], ["glass", "Стекло"], ["drop", "Капля"],
  ["pop", "Хлопок"], ["chime", "Колокольчик"],
];
const MAX_PETALS = 10;

const $ = (s) => document.querySelector(s);

/* ---------- sounds (same synth as overlay) ---------- */
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
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 6400;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(lp); lp.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise({ dur, vol, freq = 2600 }) {
    const c = ensure();
    const t = c.currentTime;
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
  };
})();

/* ---------- infra ---------- */

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await invoke("save_config", { cfg: JSON.parse(JSON.stringify(cfg)) });
    } catch (e) {
      toast(String(e).replace(/^.*"([^"]+)".*$/, "$1") || "Ошибка сохранения");
      cfg = await invoke("get_config");
      renderAll();
    }
  }, 250);
}

function setFill(inp) {
  const min = +inp.min, max = +inp.max;
  const p = ((+inp.value - min) / (max - min)) * 100;
  inp.style.setProperty("--fill", p + "%");
}

function bindRange(inp, valEl, fmt, get, set) {
  const update = () => {
    inp.value = get();
    setFill(inp);
    if (valEl) valEl.textContent = fmt(get());
  };
  inp.addEventListener("input", () => {
    set(+inp.value);
    setFill(inp);
    if (valEl) valEl.textContent = fmt(get());
    updatePreviews();
    scheduleSave();
  });
  inp._update = update;
  update();
}

function bindSwitch(el, get, set, after) {
  const update = () => el.classList.toggle("on", !!get());
  el.addEventListener("click", () => {
    set(!get());
    update();
    updatePreviews();
    scheduleSave();
    if (after) after();
  });
  el._update = update;
  update();
}

function makeSeg(el, options, get, set) {
  const thumb = document.createElement("div");
  thumb.className = "seg-thumb";
  el.appendChild(thumb);
  const btns = options.map(([value, label]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => {
      if (get() !== value) {
        set(value);
        scheduleSave();
        update();
      }
    });
    el.appendChild(b);
    return [value, b];
  });
  const update = () => {
    let idx = 0;
    btns.forEach(([value, b], i) => {
      const on = value === get();
      b.classList.toggle("active", on);
      if (on) idx = i;
    });
    const b = btns[idx][1];
    thumb.style.width = b.offsetWidth + "px";
    thumb.style.transform = `translateX(${b.offsetLeft}px)`;
  };
  el._update = update;
  requestAnimationFrame(update);
  window.addEventListener("resize", update);
  update();
}

/* ---------- hotkey pretty ---------- */

function prettyHotkey(combo) {
  if (!combo) return "—";
  const names = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[",
    BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".",
    Slash: "/", Backslash: "\\",
  };
  return combo.split("+").map((p) => {
    if (p === "ctrl") return "Ctrl";
    if (p === "alt") return "Alt";
    if (p === "shift") return "Shift";
    if (p === "super") return "Win";
    return names[p] || (p.startsWith("Key") ? p.slice(3) : p.startsWith("Digit") ? p.slice(5) : p);
  }).join(" + ");
}

/* ---------- petals ---------- */

const appIconCache = new Map();

function currentPetal() {
  return cfg.petals.find((p) => p.id === selectedId) || null;
}

function isMono(color) {
  return !color || color === "none";
}

function chipHTML(p) {
  return `<span class="pchip${isMono(p.color) ? "" : " colored"}" style="--c:${p.color}">${lucideIcon(p.icon, 15, "#fff", 2)}</span>`;
}

function selectPetal(id) {
  if (selectedId === id) return;
  selectedId = id;
  renderPetalList();
  renderEditor(true);
  renderFlowerPreview();
}

function renderPetalList() {
  const list = $("#petalList");
  const sig = cfg.petals.map((p) => `${p.id}:${p.icon}:${p.color}:${p.name}`).join("|");
  if (sig !== list._sig) {
    list._sig = sig;
    list.innerHTML = "";
    cfg.petals.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pitem";
      b.dataset.id = p.id;
      b.innerHTML = `${chipHTML(p)}<span class="pl-name">${escapeHtml(p.name)}</span>`;
      b.addEventListener("click", () => selectPetal(p.id));
      list.appendChild(b);
    });
  }
  list.querySelectorAll(".pitem").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === selectedId);
    const p = cfg.petals.find((x) => x.id === el.dataset.id);
    if (p) el.querySelector(".pchip").outerHTML = chipHTML(p);
  });
  $("#addPetal").disabled = cfg.petals.length >= MAX_PETALS;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderActionSelect() {
  const p = currentPetal();
  if (!p) return;
  const root = $("#pAction");
  root.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "select-btn";
  const name = (ACTIONS.find(([id]) => id === p.action) || ["", p.action])[1];
  btn.innerHTML = `<span>${escapeHtml(name)}</span><span class="chev">${lucideIcon("chevron-down", 14, "currentColor", 2)}</span>`;
  const list = document.createElement("div");
  list.className = "select-list";
  ACTIONS.forEach(([id, label]) => {
    const o = document.createElement("button");
    o.className = "select-opt" + (id === p.action ? " active" : "");
    o.textContent = label;
    o.addEventListener("click", () => {
      p.action = id;
      root.classList.remove("open");
      renderEditor();
      updatePreviews();
      scheduleSave();
    });
    list.appendChild(o);
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    root.classList.toggle("open");
  });
  root.appendChild(btn);
  root.appendChild(list);
}

function renderIconGrid() {
  const p = currentPetal();
  const grid = $("#pIcons");
  grid.innerHTML = "";
  Object.keys(window.LUCIDE).forEach((name) => {
    const b = document.createElement("button");
    b.className = "icell" + (name === p.icon ? " active" : "");
    b.innerHTML = lucideIcon(name, 18, "currentColor", 2);
    b.title = name;
    b.addEventListener("click", () => {
      p.icon = name;
      renderIconGrid();
      renderPetalList();
      updatePreviews();
      scheduleSave();
    });
    grid.appendChild(b);
  });
}

function renderSwatches() {
  const p = currentPetal();
  const root = $("#pColors");
  root.innerHTML = "";
  ["none", ...PALETTE].forEach((c) => {
    const active = isMono(p.color) ? c === "none" : c.toLowerCase() === String(p.color).toLowerCase();
    const b = document.createElement("button");
    b.className = "swatch" + (c === "none" ? " none" : "") + (active ? " active" : "");
    if (c !== "none") b.style.background = c;
    b.title = c === "none" ? "Без цвета" : c;
    b.addEventListener("click", () => {
      p.color = c;
      renderSwatches();
      renderPetalList();
      renderFlowerPreview();
      scheduleSave();
    });
    root.appendChild(b);
  });
}

async function petalIconHTML(p) {
  if (p.action === "open_app" && p.param) {
    if (!appIconCache.has(p.param)) {
      appIconCache.set(p.param, await invoke("get_app_icon", { path: p.param }).catch(() => null));
    }
    const url = appIconCache.get(p.param);
    if (url) return `<img src="${url}" alt="" />`;
  }
  return lucideIcon(p.icon, 30, "#fff", 1.9);
}

function renderParamRow() {
  const p = currentPetal();
  const row = $("#pParamRow");
  const label = $("#pParamLabel");
  if (p.action === "open_app") {
    row.hidden = false;
    label.textContent = "Путь к приложению";
    $("#pParam").placeholder = "C:\\Program Files\\App\\app.exe";
  } else if (p.action === "link") {
    row.hidden = false;
    label.textContent = "Ссылка";
    $("#pParam").placeholder = "https://...";
  } else {
    row.hidden = true;
  }
}

async function renderEditor(swap = false) {
  const p = currentPetal();
  const ed = $("#petalEditor");
  if (!p) {
    ed.style.display = "none";
    return;
  }
  ed.style.display = "";
  $("#pName").value = p.name;
  $("#pParam").value = p.param;
  renderIconGrid();
  renderSwatches();
  renderActionSelect();
  renderParamRow();
  if (swap) {
    ed.classList.remove("swap");
    void ed.offsetWidth; // restart the entrance animation
    ed.classList.add("swap");
  }
}

/* ---------- live flower preview (petals tab) ---------- */

function renderFlowerPreview() {
  const stage = $("#pvFlowerStage");
  const host = $("#pvFlower");
  if (!stage || !host) return;
  const ap = cfg.appearance;
  const size = ap.petalSize;
  const radius = ap.radius;
  const flowerW = radius * 2 + size;
  const flowerH = flowerW;
  const sw = stage.clientWidth - 28;
  const sh = stage.clientHeight - 28;
  const scale = Math.min(1, sw / flowerW, sh / flowerH);
  host.style.width = flowerW + "px";
  host.style.height = flowerH + "px";
  host.style.transform = `scale(${scale})`;
  host.style.setProperty("--pv-op", ap.opacity);
  host.innerHTML = "";
  const n = cfg.petals.length;
  const glow = ap.glow ? ap.glowStrength : 0;

  cfg.petals.forEach((p, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    const mono = isMono(p.color);
    const fp = document.createElement("div");
    fp.className = "fp" + (mono ? " mono" : "") + (p.id === selectedId ? " sel" : "");
    fp.style.setProperty("--fps", size + "px");
    fp.style.setProperty("--px", x + "px");
    fp.style.setProperty("--py", y + "px");
    fp.style.setProperty("--fc", mono ? "transparent" : p.color);
    fp.style.setProperty("--glow", mono ? 0 : glow);
    fp.innerHTML = `
      <div class="disc"><div class="fglass"></div><div class="fcolor"></div><div class="ftint"></div></div>
      <div class="fspec"></div>
      <div class="ficon">${lucideIcon(p.icon, Math.round(size * 0.27), "#fff", 1.9)}</div>
      <div class="flabel">${escapeHtml(p.name)}</div>`;
    fp.addEventListener("click", () => {
      selectedId = p.id;
      renderPetalList();
      renderEditor();
      renderFlowerPreview();
    });
    host.appendChild(fp);
  });

  // .exe icons for the selected petal, if any
  const p = currentPetal();
  if (p && p.action === "open_app" && p.param) {
    petalIconHTML(p).then((html) => {
      if (p.id !== selectedId) return;
      const fp = [...host.children].find((el) => el.classList.contains("sel"));
      if (fp && html) fp.querySelector(".ficon").innerHTML = html;
    });
  }
}

/* ---------- previews ---------- */

async function updatePreviews() {
  renderFlowerPreview();

  // appearance page preview
  const big = $("#pvPetalBig");
  if (big) {
    const ap = cfg.appearance;
    big.style.setProperty("--pv-size", ap.petalSize + "px");
    big.style.setProperty("--pv-op", ap.opacity);
    big.style.setProperty("--pv-blur", ap.blur + "px");
    big.style.setProperty("--pv-c", "#5AC8FA");
    big.style.setProperty("--pv-glow", ap.glow ? ap.glowStrength : 0);
    big.classList.toggle("no-glass", !ap.liquidGlass);
    big.innerHTML = `<span class="pv-ic">${lucideIcon("sparkles", Math.round(ap.petalSize * 0.27), "#fff", 1.9)}</span><span class="pv-lb">Лепесток</span>`;
  }
}

/* ---------- init & bindings ---------- */

function renderAll() {
  renderPetalList();
  renderEditor();
  $("#rowBlur").hidden = !cfg.appearance.liquidGlass;
  $("#rowGlow").hidden = !cfg.appearance.glow;
  ["segAnim", "segTrigger", "segOpenType", "rngSpeed", "rngOpacity", "rngBlur", "rngGlow", "rngSize", "rngRadius", "rngVol"].forEach((id) => {
    const el = $("#" + id);
    if (el && el._update) el._update();
  });
  ["swGlass", "swGlow", "swAutostart", "swSndOpen", "swSndClose"].forEach((id) => {
    const el = $("#" + id);
    if (el && el._update) el._update();
  });
  updateHotkeyVisibility();
  updatePreviews();
}

function updateHotkeyVisibility() {
  $("#rowHotkey").hidden = cfg.trigger !== "hotkey";
  $("#hotkeyField").textContent = prettyHotkey(cfg.hotkey);
}

async function init() {
  ACTIONS = await invoke("action_list");
  cfg = await invoke("get_config");
  selectedId = cfg.petals[0] && cfg.petals[0].id;

  // sidebar icons + navigation
  const navIcons = { petals: "flower-2", behavior: "mouse-pointer-click", appearance: "palette", system: "cpu", sounds: "volume-2" };
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.querySelector(".ni-icon").innerHTML = lucideIcon(navIcons[b.dataset.page], 17, "currentColor", 1.9);
    b.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((x) => x.classList.toggle("active", x === b));
      document.querySelectorAll(".page").forEach((pg) => pg.classList.toggle("active", pg.dataset.page === b.dataset.page));
      if (b.dataset.page === "appearance") requestAnimationFrame(updatePreviews);
      if (b.dataset.page === "petals") requestAnimationFrame(renderFlowerPreview);
    });
  });
  $("#addPetal").querySelector(".bi").innerHTML = lucideIcon("plus", 14, "currentColor", 2.2);
  $("#pDelete").querySelector(".bi").innerHTML = lucideIcon("trash-2", 14, "currentColor", 2);
  $("#pBrowse").querySelector(".bi").innerHTML = lucideIcon("folder-open", 14, "currentColor", 2);

  // titlebar lights
  $("#btnClose").addEventListener("click", () => invoke("close_settings"));
  $("#btnMin").addEventListener("click", () => invoke("minimize_settings"));
  $("#btnMax").addEventListener("click", () => invoke("toggle_maximize_settings"));

  // behavior
  makeSeg($("#segAnim"), ANIM, () => cfg.animation, (v) => { cfg.animation = v; });
  bindRange($("#rngSpeed"), $("#valSpeed"), (v) => v.toFixed(2).replace(/0$/, "") + "×", () => cfg.animationSpeed, (v) => { cfg.animationSpeed = v; });
  makeSeg($("#segTrigger"), TRIGGERS, () => cfg.trigger, (v) => { cfg.trigger = v; updateHotkeyVisibility(); });
  // hotkey recorder
  const hkField = $("#hotkeyField");
  hkField.addEventListener("click", () => {
    if (hkField.classList.contains("recording")) return;
    hkField.classList.add("recording");
    hkField.textContent = "Нажмите сочетание… (Esc — отмена)";
  });
  window.addEventListener("keydown", (e) => {
    if (!hkField.classList.contains("recording")) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      hkField.classList.remove("recording");
      updateHotkeyVisibility();
      return;
    }
    const code = e.code;
    if (/^(Control|Shift|Alt|Meta|Win|Fn|FnLock)/.test(code)) return; // wait for the main key
    const mods = [];
    if (e.ctrlKey) mods.push("ctrl");
    if (e.altKey) mods.push("alt");
    if (e.shiftKey) mods.push("shift");
    if (e.metaKey) mods.push("super");
    const isFn = /^F([1-9]|1[0-9]|2[0-4])$/.test(code);
    if (mods.length === 0 && !isFn) {
      hkField.textContent = "Нужно Ctrl / Alt / Shift / Win или F-клавиша";
      return;
    }
    hkField.classList.remove("recording");
    cfg.trigger = "hotkey";
    cfg.hotkey = [...mods, code].join("+");
    updateHotkeyVisibility();
    // apply immediately so a bad combo is reported right away
    clearTimeout(saveTimer);
    invoke("save_config", { cfg: JSON.parse(JSON.stringify(cfg)) })
      .then(() => renderAll())
      .catch(async (err) => {
        toast(String(err).replace(/^.*"([^"]+)".*$/, "$1") || "Не удалось зарегистрировать сочетание");
        cfg = await invoke("get_config");
        renderAll();
      });
  }, true);

  // appearance
  bindRange($("#rngOpacity"), $("#valOpacity"), (v) => v + "%", () => Math.round(cfg.appearance.opacity * 100), (v) => { cfg.appearance.opacity = v / 100; });
  bindSwitch($("#swGlass"), () => cfg.appearance.liquidGlass, (v) => { cfg.appearance.liquidGlass = v; $("#rowBlur").hidden = !v; });
  bindRange($("#rngBlur"), $("#valBlur"), (v) => v + " px", () => cfg.appearance.blur, (v) => { cfg.appearance.blur = v; });
  bindSwitch($("#swGlow"), () => cfg.appearance.glow, (v) => { cfg.appearance.glow = v; $("#rowGlow").hidden = !v; });
  bindRange($("#rngGlow"), $("#valGlow"), (v) => v + "%", () => Math.round(cfg.appearance.glowStrength * 100), (v) => { cfg.appearance.glowStrength = v / 100; });
  bindRange($("#rngSize"), $("#valSize"), (v) => v + " px", () => cfg.appearance.petalSize, (v) => { cfg.appearance.petalSize = v; });
  bindRange($("#rngRadius"), $("#valRadius"), (v) => v + " px", () => cfg.appearance.radius, (v) => { cfg.appearance.radius = v; });

  // system
  bindSwitch($("#swAutostart"), () => cfg.autostart, (v) => { cfg.autostart = v; });
  const resetBtn = $("#btnReset");
  resetBtn.addEventListener("click", async () => {
    if (!resetBtn.classList.contains("armed")) {
      resetBtn.classList.add("armed");
      resetBtn.textContent = "Точно сбросить?";
      setTimeout(() => {
        resetBtn.classList.remove("armed");
        resetBtn.textContent = "Сбросить";
      }, 3000);
      return;
    }
    resetBtn.classList.remove("armed");
    resetBtn.textContent = "Сбросить";
    cfg = await invoke("reset_config");
    selectedId = cfg.petals[0] && cfg.petals[0].id;
    renderAll();
    toast("Настройки сброшены");
  });

  // sounds
  bindSwitch($("#swSndOpen"), () => cfg.sounds.open, (v) => { cfg.sounds.open = v; });
  bindSwitch($("#swSndClose"), () => cfg.sounds.close, (v) => { cfg.sounds.close = v; });
  makeSeg($("#segOpenType"), OPEN_SOUNDS,
    () => cfg.sounds.openType || "bloom",
    (v) => {
      cfg.sounds.openType = v;
      Sound.open(Math.max(0.05, cfg.sounds.volume), v);
    });
  bindRange($("#rngVol"), $("#valVol"), (v) => v + "%", () => Math.round(cfg.sounds.volume * 100), (v) => { cfg.sounds.volume = v / 100; });
  $("#btnPreview").addEventListener("click", () => Sound.open(Math.max(0.05, cfg.sounds.volume), cfg.sounds.openType || "bloom"));

  // petals page
  $("#addPetal").addEventListener("click", async () => {
    if (cfg.petals.length >= MAX_PETALS) {
      toast(`Максимум ${MAX_PETALS} лепестков`);
      return;
    }
    const p = await invoke("default_petal", { id: "p" + Date.now().toString(36) });
    cfg.petals.push(p);
    selectedId = p.id;
    renderPetalList();
    renderEditor();
    updatePreviews();
    scheduleSave();
  });

  $("#pName").addEventListener("input", (e) => {
    const p = currentPetal();
    if (!p) return;
    p.name = e.target.value.trim() || "Лепесток";
    renderPetalList();
    updatePreviews();
    scheduleSave();
  });
  $("#pParam").addEventListener("input", (e) => {
    const p = currentPetal();
    if (!p) return;
    p.param = e.target.value.trim();
    appIconCache.delete(p.param);
    updatePreviews();
    scheduleSave();
  });
  $("#pBrowse").addEventListener("click", async () => {
    const path = await invoke("pick_app_file");
    if (path) {
      const p = currentPetal();
      p.param = path;
      $("#pParam").value = path;
      appIconCache.delete(path);
      updatePreviews();
      scheduleSave();
    }
  });

  const delBtn = $("#pDelete");
  delBtn.addEventListener("click", () => {
    if (!delBtn.classList.contains("armed")) {
      delBtn.classList.add("armed");
      delBtn.innerHTML = `<span class="bi">${lucideIcon("trash-2", 14, "currentColor", 2)}</span>Точно удалить?`;
      setTimeout(() => {
        delBtn.classList.remove("armed");
        delBtn.innerHTML = `<span class="bi">${lucideIcon("trash-2", 14, "currentColor", 2)}</span>Удалить лепесток`;
      }, 3000);
      return;
    }
    delBtn.classList.remove("armed");
    delBtn.innerHTML = `<span class="bi">${lucideIcon("trash-2", 14, "currentColor", 2)}</span>Удалить лепесток`;
    delBtn.querySelector(".bi").innerHTML = lucideIcon("trash-2", 14, "currentColor", 2);
    if (cfg.petals.length <= 1) {
      toast("Нужен хотя бы один лепесток");
      return;
    }
    cfg.petals = cfg.petals.filter((x) => x.id !== selectedId);
    selectedId = cfg.petals[0].id;
    renderPetalList();
    renderEditor();
    updatePreviews();
    scheduleSave();
  });

  // close custom select on outside click
  document.addEventListener("click", () => $("#pAction").classList.remove("open"));

  // live version from the app
  try {
    window.__TAURI__.app.getVersion().then((v) => { $("#ver").textContent = v; }).catch(() => {});
  } catch (_) {}

  renderAll();
}

init();
