import {
  BAND_COUNT,
  BAND_TYPES,
  LIMITS,
  STORAGE_KEYS,
  clamp,
  defaultBand,
  defaultBands,
  defaultDistortion,
  defaultReverb,
  normalizeSettings,
  spectrumFreqs,
} from './shared/config.js';
import {
  BUILTIN_PRESETS,
  EXPORT_FORMAT,
  expandBuiltin,
  normalizeUserPreset,
  parseImport,
} from './shared/presets.js';
import { t, localizeDom } from './shared/i18n.js';

const $ = (id) => document.getElementById(id);

// ============================================================
// 狀態
// ============================================================
const state = {
  settings: normalizeSettings(null),
  userPresets: {},
  status: { tabs: [], sampleRate: null },
  currentTab: null,
  capturable: false,
  selected: null, // 選取中的頻段索引
  hover: null,
  drag: null,
  dbRange: Number(safeLocal('dbRange')) === 15 ? 15 : 30,
  spectrum: null,
  port: null,
};

function safeLocal(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

// ============================================================
// 與引擎同步
// ============================================================
let sendQueued = false;
function pushSettings() {
  if (sendQueued) return;
  sendQueued = true;
  requestAnimationFrame(() => {
    sendQueued = false;
    chrome.runtime
      .sendMessage({ target: 'engine', type: 'apply', settings: state.settings })
      .catch(() => {});
  });
}

// 每次設定改變都呼叫；markDirty 表示偏離目前預設集
function changed({ markDirty = true } = {}) {
  if (markDirty && state.settings.preset) state.settings.presetDirty = true;
  pushSettings();
  curveDirty = true;
  requestDraw();
  renderInspector();
  renderPresetState();
  syncEffects();
  syncMaster();
}

// ============================================================
// 工具
// ============================================================
function fmtFreq(f) {
  if (f >= 1000) return (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' kHz';
  return (f < 100 ? f.toFixed(1).replace(/\.0$/, '') : Math.round(f)) + ' Hz';
}

function fmtDb(g) {
  return (g > 0 ? '+' : '') + g.toFixed(1) + ' dB';
}

function roundFreq(f) {
  if (f < 100) return Math.round(f * 10) / 10;
  if (f < 1000) return Math.round(f);
  return Math.round(f / 10) * 10;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

const BAND_COLORS = Array.from({ length: BAND_COUNT }, (_, i) => {
  // 由青綠到紫到琥珀的漸層色
  const hue = (185 + i * 15.5) % 360;
  return `hsl(${hue} 85% 64%)`;
});

// ============================================================
// EQ 曲線圖
// ============================================================
const canvas = $('graph');
const g2d = canvas.getContext('2d');
const FMIN = 10;
const FMAX = 22000;
const PAD = { l: 34, r: 12, t: 14, b: 20 };
let W = 0;
let H = 0;
let dpr = 1;

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  respFreqs = null;
  curveDirty = true;
  requestDraw();
}

const plotW = () => W - PAD.l - PAD.r;
const plotH = () => H - PAD.t - PAD.b;
const xOf = (f) => PAD.l + (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * plotW();
const fOf = (x) => FMIN * Math.pow(FMAX / FMIN, (x - PAD.l) / plotW());
const yOf = (db) => PAD.t + ((state.dbRange - db) / (2 * state.dbRange)) * plotH();
const gOf = (y) => state.dbRange - ((y - PAD.t) / plotH()) * 2 * state.dbRange;

// 以真正的 BiquadFilterNode 計算頻率響應，保證畫出來的曲線與實際音效一致
let respCtx = null;
let respFilters = null;
let respFreqs = null;
let bandResp = null; // Float32Array[] 每段的 dB
let totalResp = null;
let curveDirty = true;

function ensureRespCtx() {
  const rate = state.status.sampleRate || 48000;
  if (respCtx && respCtx.sampleRate === rate) return;
  respCtx = new OfflineAudioContext(1, 1, rate);
  respFilters = BAND_TYPES.map((type) => {
    const f = respCtx.createBiquadFilter();
    f.type = type;
    return f;
  });
  respFreqs = null;
}

function computeCurves() {
  ensureRespCtx();
  const n = Math.max(2, Math.round(plotW()));
  const nyq = respCtx.sampleRate / 2;
  if (!respFreqs || respFreqs.length !== n) {
    respFreqs = new Float32Array(n);
    for (let i = 0; i < n; i++) respFreqs[i] = Math.min(nyq - 1, fOf(PAD.l + i));
    bandResp = Array.from({ length: BAND_COUNT }, () => new Float32Array(n));
    totalResp = new Float32Array(n);
  }
  const mag = new Float32Array(n);
  const phase = new Float32Array(n);
  totalResp.fill(0);
  state.settings.bands.forEach((b, i) => {
    const f = respFilters[i];
    f.frequency.value = Math.min(b.f, nyq - 1);
    f.gain.value = b.g;
    f.Q.value = b.q;
    f.getFrequencyResponse(respFreqs, mag, phase);
    const out = bandResp[i];
    for (let k = 0; k < n; k++) {
      const db = 20 * Math.log10(Math.max(mag[k], 1e-6));
      out[k] = db;
      totalResp[k] += db;
    }
  });
  curveDirty = false;
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
}

function nodePos(i) {
  const b = state.settings.bands[i];
  const x = clamp(xOf(b.f), [PAD.l, W - PAD.r]);
  const y = clamp(yOf(b.g), [PAD.t, H - PAD.b]);
  return { x, y };
}

function draw() {
  if (!W) return;
  if (curveDirty) computeCurves();
  const c = g2d;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);

  const pw = plotW();
  const ph = plotH();
  const x0 = PAD.l;
  const y0 = PAD.t;

  // ---- 格線 ----
  c.lineWidth = 1;
  c.font = '10px -apple-system, "PingFang TC", sans-serif';
  c.textBaseline = 'middle';
  // 次要頻率線
  c.strokeStyle = 'rgba(255,255,255,0.035)';
  c.beginPath();
  for (let dec = 10; dec < FMAX; dec *= 10) {
    for (let m = 2; m <= 9; m++) {
      const f = dec * m;
      if (f <= FMIN || f >= FMAX) continue;
      const x = Math.round(xOf(f)) + 0.5;
      c.moveTo(x, y0);
      c.lineTo(x, y0 + ph);
    }
  }
  c.stroke();
  // 主要頻率線與標籤
  const majors = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  c.strokeStyle = 'rgba(255,255,255,0.07)';
  c.fillStyle = 'rgba(160,170,190,0.55)';
  c.textAlign = 'center';
  c.beginPath();
  for (const f of majors) {
    const x = Math.round(xOf(f)) + 0.5;
    c.moveTo(x, y0);
    c.lineTo(x, y0 + ph);
    c.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x, H - PAD.b / 2);
  }
  c.stroke();
  // dB 線
  const step = state.dbRange / 3;
  c.textAlign = 'right';
  for (let db = -state.dbRange; db <= state.dbRange; db += step) {
    const y = Math.round(yOf(db)) + 0.5;
    c.strokeStyle = db === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x0 + pw, y);
    c.stroke();
    c.fillText((db > 0 ? '+' : '') + db, x0 - 6, y);
  }

  // ---- 頻譜 ----
  if (state.spectrum) drawSpectrum(c);
  else if (state.status.tabs.length === 0) {
    c.textAlign = 'center';
    c.fillStyle = 'rgba(160,170,190,0.35)';
    c.font = '12px -apple-system, "PingFang TC", sans-serif';
    c.fillText(t('graphEmpty'), x0 + pw / 2, y0 + ph * 0.78);
  }

  c.save();
  c.beginPath();
  c.rect(x0, y0, pw, ph);
  c.clip();

  // ---- 選取頻段的個別曲線 ----
  const focus = state.drag?.i ?? state.selected ?? state.hover;
  if (focus != null && bandResp) {
    const resp = bandResp[focus];
    const zeroY = yOf(0);
    c.beginPath();
    c.moveTo(x0, zeroY);
    for (let k = 0; k < resp.length; k++) c.lineTo(x0 + k, yOf(resp[k]));
    c.lineTo(x0 + resp.length - 1, zeroY);
    c.closePath();
    c.fillStyle = BAND_COLORS[focus].replace(')', ' / 0.14)');
    c.fill();
    c.beginPath();
    for (let k = 0; k < resp.length; k++) {
      const y = yOf(resp[k]);
      k ? c.lineTo(x0 + k, y) : c.moveTo(x0, y);
    }
    c.strokeStyle = BAND_COLORS[focus].replace(')', ' / 0.6)');
    c.lineWidth = 1.2;
    c.stroke();
  }

  // ---- 總響應曲線 ----
  if (totalResp) {
    const grad = c.createLinearGradient(x0, 0, x0 + pw, 0);
    grad.addColorStop(0, '#22d3ee');
    grad.addColorStop(0.55, '#818cf8');
    grad.addColorStop(1, '#e879f9');
    // 曲線下方的淡色填充
    const zeroY = yOf(0);
    c.beginPath();
    c.moveTo(x0, zeroY);
    for (let k = 0; k < totalResp.length; k++) c.lineTo(x0 + k, yOf(totalResp[k]));
    c.lineTo(x0 + totalResp.length - 1, zeroY);
    c.closePath();
    c.fillStyle = 'rgba(129,140,248,0.07)';
    c.fill();

    c.beginPath();
    for (let k = 0; k < totalResp.length; k++) {
      const y = yOf(totalResp[k]);
      k ? c.lineTo(x0 + k, y) : c.moveTo(x0, y);
    }
    c.strokeStyle = grad;
    c.lineWidth = 2.4;
    c.shadowColor = 'rgba(99,102,241,0.6)';
    c.shadowBlur = 10;
    c.stroke();
    c.shadowBlur = 0;
  }
  c.restore();

  // ---- 節點 ----
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '600 9px -apple-system, sans-serif';
  for (let i = 0; i < BAND_COUNT; i++) {
    const { x, y } = nodePos(i);
    const b = state.settings.bands[i];
    const active = i === state.selected || i === state.drag?.i;
    const hot = active || i === state.hover;
    const idle = Math.abs(b.g) < 0.05;
    c.beginPath();
    c.arc(x, y, hot ? 8.5 : 7.5, 0, Math.PI * 2);
    c.fillStyle = idle && !hot ? 'rgba(20,24,32,0.95)' : BAND_COLORS[i];
    c.fill();
    c.lineWidth = active ? 2 : 1.5;
    c.strokeStyle = active ? '#ffffff' : BAND_COLORS[i];
    c.stroke();
    c.fillStyle = idle && !hot ? BAND_COLORS[i] : '#0a0c10';
    c.fillText(String(i + 1), x, y + 0.5);
  }
}

const SPEC_FREQS = spectrumFreqs();
function drawSpectrum(c) {
  const s = state.spectrum;
  const top = PAD.t;
  const bottom = H - PAD.b;
  const yS = (db) => bottom - clamp((db + 100) / 90, [0, 1]) * (bottom - top);
  c.save();
  c.beginPath();
  c.moveTo(xOf(SPEC_FREQS[0]), bottom);
  for (let i = 0; i < s.length; i++) c.lineTo(xOf(SPEC_FREQS[i]), yS(s[i]));
  c.lineTo(xOf(SPEC_FREQS[s.length - 1]), bottom);
  c.closePath();
  const grad = c.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, 'rgba(34,211,238,0.30)');
  grad.addColorStop(1, 'rgba(34,211,238,0.02)');
  c.fillStyle = grad;
  c.fill();
  c.strokeStyle = 'rgba(34,211,238,0.35)';
  c.lineWidth = 1;
  c.stroke();
  c.restore();
}

// ---- 互動 ----
function hitTest(x, y) {
  let best = null;
  let bestD = 14;
  for (let i = 0; i < BAND_COUNT; i++) {
    const p = nodePos(i);
    const d = Math.hypot(p.x - x, p.y - y);
    // 重疊時優先選目前選取的節點
    const bias = i === state.selected ? 3 : 0;
    if (d - bias < bestD) {
      bestD = d - bias;
      best = i;
    }
  }
  return best;
}

function localPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function updateTooltip() {
  const tip = $('tooltip');
  const i = state.drag?.i ?? state.hover;
  if (i == null) {
    tip.hidden = true;
    return;
  }
  const b = state.settings.bands[i];
  const { x, y } = nodePos(i);
  tip.textContent = `${fmtFreq(b.f)} · ${fmtDb(b.g)} · Q ${b.q.toFixed(2)}`;
  tip.style.left = clamp(x, [80, W - 80]) + 'px';
  tip.style.top = Math.max(y, 40) + 'px';
  tip.hidden = false;
}

canvas.addEventListener('pointerdown', (e) => {
  const { x, y } = localPos(e);
  const i = hitTest(x, y);
  canvas.focus();
  if (i == null) {
    state.selected = null;
    renderInspector();
    requestDraw();
    return;
  }
  state.selected = i;
  const b = state.settings.bands[i];
  state.drag = { i, startY: e.clientY, startQ: b.q, qMode: e.shiftKey };
  canvas.setPointerCapture(e.pointerId);
  renderInspector();
  updateTooltip();
  requestDraw();
});

canvas.addEventListener('pointermove', (e) => {
  const { x, y } = localPos(e);
  const d = state.drag;
  if (d) {
    const b = state.settings.bands[d.i];
    if (d.qMode || e.shiftKey) {
      // Shift + 上下拖曳：調整 Q（頻寬）
      if (!d.qMode) {
        d.qMode = true;
        d.startY = e.clientY;
        d.startQ = b.q;
      }
      b.q = clamp(d.startQ * Math.exp(-(e.clientY - d.startY) * 0.015), LIMITS.q);
    } else {
      b.f = clamp(roundFreq(fOf(clamp(x, [PAD.l, W - PAD.r]))), LIMITS.freq);
      let g = gOf(clamp(y, [PAD.t, H - PAD.b]));
      if (Math.abs(g) < 0.35) g = 0; // 靠近 0 dB 時吸附
      b.g = clamp(Math.round(g * 10) / 10, LIMITS.gain);
    }
    changed();
    updateTooltip();
    return;
  }
  const h = hitTest(x, y);
  if (h !== state.hover) {
    state.hover = h;
    canvas.style.cursor = h == null ? 'default' : 'grab';
    updateTooltip();
    requestDraw();
  }
});

function endDrag(e) {
  if (!state.drag) return;
  state.drag = null;
  if (e && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  updateTooltip();
  requestDraw();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => {
  if (state.drag) return;
  state.hover = null;
  updateTooltip();
  requestDraw();
});

canvas.addEventListener('dblclick', (e) => {
  const { x, y } = localPos(e);
  const i = hitTest(x, y);
  if (i == null) return;
  resetBand(i);
});

canvas.addEventListener(
  'wheel',
  (e) => {
    const i = state.hover ?? state.selected;
    if (i == null) return;
    e.preventDefault();
    const b = state.settings.bands[i];
    b.q = clamp(Math.round(b.q * Math.exp(-e.deltaY * 0.0025) * 1000) / 1000, LIMITS.q);
    changed();
    updateTooltip();
  },
  { passive: false }
);

canvas.addEventListener('keydown', (e) => {
  const i = state.selected;
  if (i == null) return;
  const b = state.settings.bands[i];
  const big = e.shiftKey;
  switch (e.key) {
    case 'ArrowUp':
      b.g = clamp(b.g + (big ? 3 : 0.5), LIMITS.gain);
      break;
    case 'ArrowDown':
      b.g = clamp(b.g - (big ? 3 : 0.5), LIMITS.gain);
      break;
    case 'ArrowRight':
      b.f = clamp(roundFreq(b.f * Math.pow(2, big ? 1 / 3 : 1 / 12)), LIMITS.freq);
      break;
    case 'ArrowLeft':
      b.f = clamp(roundFreq(b.f / Math.pow(2, big ? 1 / 3 : 1 / 12)), LIMITS.freq);
      break;
    case 'Delete':
    case 'Backspace':
      resetBand(i);
      e.preventDefault();
      return;
    case 'Escape':
      state.selected = null;
      renderInspector();
      requestDraw();
      return;
    default:
      return;
  }
  e.preventDefault();
  changed();
});

function resetBand(i) {
  state.settings.bands[i] = defaultBand(i);
  changed();
  updateTooltip();
}

$('rangeBtn').addEventListener('click', () => {
  state.dbRange = state.dbRange === 30 ? 15 : 30;
  safeLocal('dbRange', String(state.dbRange));
  $('rangeBtn').textContent = `±${state.dbRange} dB`;
  requestDraw();
});

$('resetAll').addEventListener('click', () => {
  state.settings.bands = defaultBands();
  changed();
  toast(t('eqReset'));
});

// ============================================================
// 頻段檢視器
// ============================================================
function renderInspector() {
  const el = $('inspector');
  const i = state.selected;
  if (i == null) {
    if (el.dataset.mode !== 'hint') {
      el.dataset.mode = 'hint';
      el.innerHTML = ['hintDrag', 'hintQ', 'hintDbl', 'hintKeys'].map((k) => `<span>${t(k)}</span>`).join('');
    }
    return;
  }
  const b = state.settings.bands[i];
  if (el.dataset.mode !== 'band' || el.dataset.band !== String(i)) {
    el.dataset.mode = 'band';
    el.dataset.band = String(i);
    el.innerHTML = `
      <span class="band-tag"><span class="swatch" style="background:${BAND_COLORS[i]}"></span>
        ${t('band')} ${i + 1} <span class="type">${t('type_' + BAND_TYPES[i])}</span></span>
      <label class="field">${t('freq')} <input id="inF" type="number" min="${LIMITS.freq[0]}" max="${LIMITS.freq[1]}" step="1"><span class="unit">Hz</span></label>
      <label class="field">${t('gain')} <input id="inG" type="number" min="${LIMITS.gain[0]}" max="${LIMITS.gain[1]}" step="0.5"><span class="unit">dB</span></label>
      <label class="field">Q <input id="inQ" type="number" min="${LIMITS.q[0]}" max="${LIMITS.q[1]}" step="0.05"></label>
      <span class="spacer"></span>
      <button class="btn" id="inReset">${t('resetBand')}</button>`;
    const bind = (id, key, lim) => {
      $(id).addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isFinite(v)) return renderInspectorValues(true);
        state.settings.bands[state.selected][key] = clamp(v, lim);
        changed();
        renderInspectorValues(true);
      });
    };
    bind('inF', 'f', LIMITS.freq);
    bind('inG', 'g', LIMITS.gain);
    bind('inQ', 'q', LIMITS.q);
    $('inReset').addEventListener('click', () => resetBand(state.selected));
  }
  renderInspectorValues(false);
}

function renderInspectorValues(force) {
  const i = state.selected;
  if (i == null) return;
  const b = state.settings.bands[i];
  const set = (id, v) => {
    const el = $(id);
    if (el && (force || document.activeElement !== el)) el.value = v;
  };
  set('inF', b.f < 100 ? b.f.toFixed(1) : Math.round(b.f));
  set('inG', b.g.toFixed(1));
  set('inQ', b.q.toFixed(2));
}

// ============================================================
// 主音量
// ============================================================
const masterEl = $('master');
function setRangeFill(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--p', p + '%');
}
function syncMaster() {
  if (document.activeElement !== masterEl) masterEl.value = state.settings.masterDb;
  setRangeFill(masterEl);
  $('masterOut').textContent = fmtDb(state.settings.masterDb);
}
masterEl.addEventListener('input', () => {
  state.settings.masterDb = parseFloat(masterEl.value);
  changed({ markDirty: false });
});
masterEl.addEventListener('dblclick', () => {
  state.settings.masterDb = 0;
  masterEl.value = 0;
  changed({ markDirty: false });
});

// ============================================================
// 預設集
// ============================================================
function applyPresetData(data, id) {
  const s = state.settings;
  s.bands = data.bands.map((b) => ({ ...b }));
  s.stereo = data.stereo;
  s.distortion = { ...data.distortion };
  s.reverb = { ...data.reverb };
  s.preset = id;
  s.presetDirty = false;
  changed({ markDirty: false });
}

function buildBuiltinGrid() {
  const grid = $('builtinGrid');
  grid.innerHTML = '';
  for (const p of BUILTIN_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset-card';
    btn.dataset.id = 'builtin:' + p.id;
    const [name, desc] = t('preset_' + p.id);
    btn.title = desc;
    btn.innerHTML = `<div class="t"><span></span><span class="mod" hidden></span></div><div class="d"></div>`;
    btn.querySelector('.t span').textContent = name;
    btn.querySelector('.mod').textContent = t('modified');
    btn.querySelector('.d').textContent = desc;
    btn.addEventListener('click', () => applyPresetData(expandBuiltin(p), 'builtin:' + p.id));
    grid.appendChild(btn);
  }
}

function renderUserPresets() {
  const list = $('userList');
  list.innerHTML = '';
  const names = Object.keys(state.userPresets).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  if (names.length === 0) {
    list.innerHTML = `<span class="empty">${t('noUserPresets')}</span>`;
    return;
  }
  for (const name of names) {
    const chip = document.createElement('span');
    chip.className = 'user-chip';
    chip.dataset.id = 'user:' + name;
    const apply = document.createElement('button');
    apply.className = 'apply';
    apply.textContent = name;
    apply.addEventListener('click', () => {
      const p = normalizeUserPreset(state.userPresets[name]);
      if (!p) return toast(t('presetCorrupt'), true);
      applyPresetData(p, 'user:' + name);
      $('presetName').value = name;
    });
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = t('delete');
    let armed = null;
    del.addEventListener('click', () => {
      // 第一次點擊變成確認狀態，3 秒內再點一次才刪除
      if (!armed) {
        chip.classList.add('confirm');
        del.textContent = t('confirmDelete');
        armed = setTimeout(() => {
          armed = null;
          chip.classList.remove('confirm');
          del.textContent = '✕';
        }, 3000);
        return;
      }
      clearTimeout(armed);
      deleteUserPreset(name);
    });
    chip.append(apply, del);
    list.appendChild(chip);
  }
  renderPresetState();
}

function renderPresetState() {
  const { preset, presetDirty } = state.settings;
  document.querySelectorAll('.preset-card').forEach((el) => {
    const on = el.dataset.id === preset;
    el.classList.toggle('active', on);
    el.querySelector('.mod').hidden = !(on && presetDirty);
  });
  document.querySelectorAll('.user-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === preset);
  });
}

async function saveUserPresets() {
  await chrome.storage.local.set({ [STORAGE_KEYS.userPresets]: state.userPresets });
}

async function saveCurrentAsPreset() {
  const name = $('presetName').value.trim();
  if (!name) {
    $('presetName').focus();
    return toast(t('needName'));
  }
  const existed = name in state.userPresets;
  const s = state.settings;
  state.userPresets[name] = {
    bands: s.bands.map((b) => ({ ...b })),
    stereo: s.stereo,
    distortion: { ...s.distortion },
    reverb: { ...s.reverb },
  };
  await saveUserPresets();
  s.preset = 'user:' + name;
  s.presetDirty = false;
  pushSettings();
  renderUserPresets();
  toast(existed ? t('presetUpdated', name) : t('presetSaved', name));
}

async function deleteUserPreset(name) {
  delete state.userPresets[name];
  await saveUserPresets();
  if (state.settings.preset === 'user:' + name) {
    state.settings.preset = null;
    pushSettings();
  }
  renderUserPresets();
  toast(t('presetDeleted', name));
}

$('savePreset').addEventListener('click', saveCurrentAsPreset);
$('presetName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveCurrentAsPreset();
});

$('exportBtn').addEventListener('click', () => {
  if (Object.keys(state.userPresets).length === 0) return toast(t('nothingToExport'));
  const data = { format: EXPORT_FORMAT, version: 1, presets: state.userPresets };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tonal-eq-presets.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const imported = parseImport(await file.text());
    Object.assign(state.userPresets, imported);
    await saveUserPresets();
    renderUserPresets();
    toast(t('imported', Object.keys(imported).length));
  } catch (err) {
    const m = String(err?.message || err);
    toast(t('importFailed', m === 'badFormat' || m === 'noPresetsInFile' ? t(m) : m), true);
  }
});

// ============================================================
// 效果
// ============================================================
function makeSlider({ label, min, max, step, get, set, fmt, def, log = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  wrap.innerHTML = `<div class="row"><span></span><span class="val"></span></div><input type="range">`;
  wrap.querySelector('.row span').textContent = label;
  const input = wrap.querySelector('input');
  const val = wrap.querySelector('.val');
  // 對數刻度的滑桿以 0–1000 的位置表示
  const toPos = (v) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
  const fromPos = (p) => (log ? min * Math.pow(max / min, p / 1000) : p);
  input.min = log ? 0 : min;
  input.max = log ? 1000 : max;
  input.step = log ? 1 : step;
  input.addEventListener('input', () => {
    let v = fromPos(parseFloat(input.value));
    if (log) v = Math.round(v / 10) * 10;
    set(v);
    changed();
  });
  // 雙擊滑桿：回到預設值
  input.addEventListener('dblclick', () => {
    set(def);
    input.blur();
    changed();
  });
  const sync = () => {
    const v = get();
    if (document.activeElement !== input) input.value = toPos(v);
    setRangeFill(input);
    val.textContent = fmt(v);
  };
  return { el: wrap, sync };
}

const fxSyncers = [];
function buildEffects() {
  const s = () => state.settings;
  const pct = (v) => Math.round(v * 100) + '%';

  document.querySelectorAll('#stereoSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      s().stereo = btn.dataset.mode;
      changed();
    });
  });

  const dist = [
    makeSlider({ label: t('drive'), min: 0, max: 100, step: 1, def: defaultDistortion().drive, get: () => s().distortion.drive, set: (v) => (s().distortion.drive = v), fmt: (v) => Math.round(v) }),
    makeSlider({ label: t('mix'), min: 0, max: 1, step: 0.01, def: defaultDistortion().mix, get: () => s().distortion.mix, set: (v) => (s().distortion.mix = v), fmt: pct }),
  ];
  dist.forEach((x) => $('distControls').appendChild(x.el));

  const rev = [
    makeSlider({ label: t('decay'), min: 0.1, max: 6, step: 0.1, def: defaultReverb().decay, get: () => s().reverb.decay, set: (v) => (s().reverb.decay = v), fmt: (v) => v.toFixed(1) + ' s' }),
    makeSlider({ label: t('mix'), min: 0, max: 1, step: 0.01, def: defaultReverb().mix, get: () => s().reverb.mix, set: (v) => (s().reverb.mix = v), fmt: pct }),
    makeSlider({ label: t('damping'), min: 200, max: 16000, log: true, def: defaultReverb().damping, get: () => s().reverb.damping, set: (v) => (s().reverb.damping = v), fmt: fmtFreq }),
    makeSlider({ label: t('preDelay'), min: 0, max: 0.2, step: 0.001, def: defaultReverb().preDelay, get: () => s().reverb.preDelay, set: (v) => (s().reverb.preDelay = v), fmt: (v) => Math.round(v * 1000) + ' ms' }),
  ];
  rev.forEach((x) => $('revControls').appendChild(x.el));
  fxSyncers.push(...dist.map((d) => d.sync), ...rev.map((r) => r.sync));

  // 各效果的「重設」：參數回到預設值，開關狀態保持不變
  document.querySelectorAll('.mini-reset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.reset;
      if (key === 'stereo') s().stereo = 'normal';
      else if (key === 'distortion') s().distortion = { ...defaultDistortion(), on: s().distortion.on };
      else if (key === 'reverb') s().reverb = { ...defaultReverb(), on: s().reverb.on };
      changed();
    });
  });

  $('distOn').addEventListener('change', (e) => {
    s().distortion.on = e.target.checked;
    changed();
  });
  $('revOn').addEventListener('change', (e) => {
    s().reverb.on = e.target.checked;
    changed();
  });
  $('limOn').addEventListener('change', (e) => {
    s().limiter = e.target.checked;
    changed({ markDirty: false });
  });
}

function syncEffects() {
  const s = state.settings;
  document.querySelectorAll('#stereoSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === s.stereo));
  $('stereoHint').textContent = t('stereoHint_' + s.stereo);
  $('distOn').checked = s.distortion.on;
  $('revOn').checked = s.reverb.on;
  $('limOn').checked = s.limiter;
  $('distOn').closest('.fx-card').classList.toggle('off', !s.distortion.on);
  $('revOn').closest('.fx-card').classList.toggle('off', !s.reverb.on);
  fxSyncers.forEach((fn) => fn());
}

// ============================================================
// 分頁頁籤
// ============================================================
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab.dataset.panel));
    safeLocal('panel', tab.dataset.panel);
  });
});

// ============================================================
// 擷取控制與狀態
// ============================================================
function isCapturing(tabId) {
  return state.status.tabs.some((x) => x.id === tabId);
}

function renderStatus() {
  const cur = state.currentTab;
  const on = cur && isCapturing(cur.id);
  const btn = $('power');
  btn.classList.toggle('on', Boolean(on));
  btn.disabled = !on && !state.capturable;
  btn.querySelector('.txt').textContent = on ? t('tabActive') : t('enableTab');
  btn.title = on ? t('clickToStop') : '';

  const sub = $('tabStatus');
  sub.classList.toggle('on', Boolean(on));
  if (on) sub.textContent = t('statusOn');
  else if (!state.capturable) sub.textContent = t('statusBlocked');
  else sub.textContent = t('statusOff');

  const n = state.status.tabs.length;
  $('tabCount').textContent = n;
  $('tabCount').classList.toggle('on', n > 0);

  const list = $('tabList');
  list.innerHTML = '';
  if (n === 0) {
    list.innerHTML = `<div class="empty-state">${t('noActiveTabs')}</div>`;
  }
  for (const tab of state.status.tabs) {
    const row = document.createElement('div');
    row.className = 'tab-item' + (cur && tab.id === cur.id ? ' current' : '');
    const icon = tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl) ? document.createElement('img') : document.createElement('span');
    if (icon.tagName === 'IMG') {
      icon.src = tab.favIconUrl;
      icon.alt = '';
      icon.onerror = () => icon.replaceWith(Object.assign(document.createElement('span'), { className: 'ph' }));
    } else icon.className = 'ph';
    const title = document.createElement('button');
    title.className = 'title';
    title.textContent = tab.closed ? t('closedTab') : tab.title || t('untitled');
    title.title = t('switchToTab');
    title.addEventListener('click', async () => {
      try {
        const updated = await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(updated.windowId, { focused: true });
      } catch {}
    });
    const stop = document.createElement('button');
    stop.className = 'btn';
    stop.textContent = t('stop');
    stop.addEventListener('click', () => stopTab(tab.id));
    row.append(icon, title, stop);
    list.appendChild(row);
  }
}

async function refreshStatus() {
  try {
    const st = await chrome.runtime.sendMessage({ target: 'bg', type: 'status' });
    if (st) state.status = st;
  } catch {}
  if (state.status.sampleRate && respCtx && respCtx.sampleRate !== state.status.sampleRate) curveDirty = true;
  renderStatus();
  if (state.status.tabs.length > 0) connectSpectrum();
  else {
    state.spectrum = null;
    requestDraw();
  }
}

function connectSpectrum() {
  if (state.port) return;
  const port = chrome.runtime.connect({ name: 'spectrum' });
  state.port = port;
  port.onMessage.addListener((frame) => {
    // 平滑：上升快、下降慢
    const prev = state.spectrum;
    if (prev && prev.length === frame.length) {
      for (let i = 0; i < frame.length; i++) {
        const v = frame[i];
        prev[i] = v > prev[i] ? v * 0.7 + prev[i] * 0.3 : v * 0.25 + prev[i] * 0.75;
      }
    } else state.spectrum = frame.slice();
    requestDraw();
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    state.port = null;
    state.spectrum = null;
    requestDraw();
  });
}

async function startCurrent() {
  const tab = state.currentTab;
  if (!tab) return;
  const btn = $('power');
  btn.disabled = true;
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const r = await chrome.runtime.sendMessage({ target: 'bg', type: 'start', tabId: tab.id, streamId });
    if (!r?.ok) throw new Error(r?.error || t('errUnknown'));
  } catch (err) {
    const m = String(err.message || err);
    if (/active stream/i.test(m)) toast(t('errBusy'), true);
    else if (/chrome pages|cannot be captured|not been invoked/i.test(m)) toast(t('errBlocked'), true);
    else toast(t('errStart', m), true);
  }
  await refreshStatus();
}

async function stopTab(tabId) {
  try {
    await chrome.runtime.sendMessage({ target: 'bg', type: 'stop', tabId });
  } catch {}
  await refreshStatus();
}

$('power').addEventListener('click', () => {
  const cur = state.currentTab;
  if (!cur) return;
  if (isCapturing(cur.id)) stopTab(cur.id);
  else startCurrent();
});

chrome.runtime.onMessage.addListener((msg) => {
  // 引擎的分頁清單改變（例如分頁被關閉）
  if (msg?.type === 'streamsChanged') refreshStatus();
});

// ============================================================
// 初始化
// ============================================================
async function init() {
  localizeDom();
  const data = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.userPresets]);
  state.settings = normalizeSettings(data[STORAGE_KEYS.settings]);
  state.userPresets = data[STORAGE_KEYS.userPresets] || {};

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.currentTab = tab || null;
  state.capturable = Boolean(tab?.url && /^(https?|file):/.test(tab.url) && !/^https:\/\/chromewebstore\.google\.com/.test(tab.url));

  $('rangeBtn').textContent = `±${state.dbRange} dB`;
  const panel = safeLocal('panel');
  if (panel) document.querySelector(`.tab[data-panel="${panel}"]`)?.click();

  buildBuiltinGrid();
  buildEffects();
  renderUserPresets();
  renderInspector();
  syncEffects();
  syncMaster();
  renderPresetState();
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(canvas);
  await refreshStatus();
}

init();
