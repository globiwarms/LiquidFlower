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
const MAX_PETALS = 8;

const $ = (s) => document.querySelector(s);

/* ---------- sounds (same synth as overlay) ---------- */
const Sound = (() => {
  let ctx;
  function blip({ f0, f1, dur, vol }) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 4200; o.type = "sine";
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(lp); lp.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.03);
    } catch (_) {}
  }
  return {
    open: (v) => blip({ f0: 330, f1: 680, dur: 0.16, vol: 0.5 * v }),
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

function renderPetalList() {
  const list = $("#petalList");
  list.innerHTML = "";
  cfg.petals.forEach((p) => {
    const active = p.id === selectedId;
    const b = document.createElement("button");
    b.className = "pitem" + (active ? " active" : "");
    b.innerHTML = `
      <span class="pchip" style="--c:${p.color}">${lucideIcon(p.icon, 15, "#fff", 2)}</span>
      <span>${escapeHtml(p.name)}</span>
      ${active ? `<span class="pcount">${cfg.petals.length}/${MAX_PETALS}</span>` : ""}`;
    b.querySelector(".pchip svg").style.display = "block";
    b.addEventListener("click", () => {
      selectedId = p.id;
      renderPetalList();
      renderEditor();
    });
    list.appendChild(b);
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
  PALETTE.forEach((c) => {
    const b = document.createElement("button");
    b.className = "swatch" + (c.toLowerCase() === p.color.toLowerCase() ? " active" : "");
    b.style.background = c;
    b.addEventListener("click", () => {
      p.color = c;
      renderSwatches();
      renderPetalList();
      updatePreviews();
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

async function renderEditor() {
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

  const pv = $("#pvPetal");
  pv.style.setProperty("--pv-c", p.color);
  pv.innerHTML = `<span class="pv-ic">${lucideIcon(p.icon, 30, "#fff", 1.9)}</span><span class="pv-lb">${escapeHtml(p.name)}</span>`;
  const html = await petalIconHTML(p);
  if (p.id === selectedId) {
    pv.querySelector(".pv-ic").innerHTML = html;
  }
}

/* ---------- big preview (appearance) ---------- */

async function updatePreviews() {
  const ap = cfg.appearance;

  // editor mini preview
  const p = currentPetal();
  if (p) {
    const pv = $("#pvPetal");
    pv.style.setProperty("--pv-c", p.color);
    pv.querySelector(".pv-lb").textContent = p.name;
    const ic = pv.querySelector(".pv-ic");
    const html = await petalIconHTML(p);
    if (p.id === selectedId) ic.innerHTML = html;
  }

  // appearance page preview
  const big = $("#pvPetalBig");
  if (big) {
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
  ["segAnim", "segTrigger", "rngSpeed", "rngOpacity", "rngBlur", "rngGlow", "rngSize", "rngRadius", "rngVol"].forEach((id) => {
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
    });
  });
  $("#addPetal").querySelector(".ab-ic").innerHTML = lucideIcon("plus", 14, "currentColor", 2);

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
  bindRange($("#rngVol"), $("#valVol"), (v) => v + "%", () => Math.round(cfg.sounds.volume * 100), (v) => { cfg.sounds.volume = v / 100; });
  $("#btnPreview").addEventListener("click", () => Sound.open(Math.max(0.05, cfg.sounds.volume)));

  // petals page
  $("#addPetal").addEventListener("click", async () => {
    if (cfg.petals.length >= MAX_PETALS) {
      toast("Максимум 8 лепестков");
      return;
    }
    const p = await invoke("default_petal", { id: "p" + Date.now().toString(36) });
    cfg.petals.push(p);
    selectedId = p.id;
    renderPetalList();
    renderEditor();
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
      delBtn.textContent = "Точно удалить?";
      setTimeout(() => {
        delBtn.classList.remove("armed");
        delBtn.textContent = "Удалить лепесток";
      }, 3000);
      return;
    }
    delBtn.classList.remove("armed");
    delBtn.textContent = "Удалить лепесток";
    if (cfg.petals.length <= 1) {
      toast("Нужен хотя бы один лепесток");
      return;
    }
    cfg.petals = cfg.petals.filter((x) => x.id !== selectedId);
    selectedId = cfg.petals[0].id;
    renderPetalList();
    renderEditor();
    scheduleSave();
  });

  // close custom select on outside click
  document.addEventListener("click", () => $("#pAction").classList.remove("open"));

  renderAll();
}

init();
