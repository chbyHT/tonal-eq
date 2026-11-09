// 共用設定：頻段定義、數值範圍、預設值與設定正規化。
// popup、offscreen、background 都會 import 這個檔案。

export const BAND_COUNT = 11;

// 每八度一個頻段（20 Hz ~ 20 kHz），Q = 1/√2（Butterworth）為音訊工程的標準起始值
export const DEFAULT_FREQS = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
export const DEFAULT_Q = Math.SQRT1_2;

// 第一段為低架、最後一段為高架、其餘為峰值濾波器
export const BAND_TYPES = DEFAULT_FREQS.map((_, i) =>
  i === 0 ? 'lowshelf' : i === BAND_COUNT - 1 ? 'highshelf' : 'peaking'
);

export const LIMITS = {
  freq: [5, 20480],
  gain: [-30, 30],
  q: [0.2, 11],
  masterDb: [-30, 20],
  drive: [0, 100],
  mix: [0, 1],
  decay: [0.1, 6],
  damping: [200, 16000],
  preDelay: [0, 0.2],
};

export const STEREO_MODES = ['normal', 'karaoke', 'center'];

export const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export function defaultBand(i) {
  return { f: DEFAULT_FREQS[i], g: 0, q: DEFAULT_Q };
}

export function defaultBands() {
  return DEFAULT_FREQS.map((_, i) => defaultBand(i));
}

export function defaultDistortion() {
  return { on: false, drive: 40, mix: 0.5 };
}

export function defaultReverb() {
  return { on: false, decay: 1.5, damping: 6000, preDelay: 0.02, mix: 0.3 };
}

export function defaultSettings() {
  return {
    bands: defaultBands(),
    masterDb: 0,
    stereo: 'normal',
    distortion: defaultDistortion(),
    reverb: defaultReverb(),
    limiter: false,
    preset: 'builtin:flat',
    presetDirty: false,
  };
}

function normalizeBands(bands) {
  return DEFAULT_FREQS.map((_, i) => {
    const b = (Array.isArray(bands) && bands[i]) || defaultBand(i);
    return {
      f: clamp(Number(b.f), LIMITS.freq),
      g: clamp(Number(b.g), LIMITS.gain),
      q: clamp(Number(b.q), LIMITS.q),
    };
  });
}

export function normalizeDistortion(d = {}) {
  const def = defaultDistortion();
  return {
    on: Boolean(d.on ?? def.on),
    drive: clamp(Number(d.drive ?? def.drive), LIMITS.drive),
    mix: clamp(Number(d.mix ?? def.mix), LIMITS.mix),
  };
}

export function normalizeReverb(r = {}) {
  const def = defaultReverb();
  return {
    on: Boolean(r.on ?? def.on),
    decay: clamp(Number(r.decay ?? def.decay), LIMITS.decay),
    damping: clamp(Number(r.damping ?? def.damping), LIMITS.damping),
    preDelay: clamp(Number(r.preDelay ?? def.preDelay), LIMITS.preDelay),
    mix: clamp(Number(r.mix ?? def.mix), LIMITS.mix),
  };
}

// 將任何來源（儲存、匯入、訊息）的設定補齊預設值並限制範圍
export function normalizeSettings(s) {
  const def = defaultSettings();
  if (!s || typeof s !== 'object') return def;
  return {
    bands: normalizeBands(s.bands),
    masterDb: clamp(Number(s.masterDb ?? def.masterDb), LIMITS.masterDb),
    stereo: STEREO_MODES.includes(s.stereo) ? s.stereo : def.stereo,
    distortion: normalizeDistortion(s.distortion),
    reverb: normalizeReverb(s.reverb),
    limiter: Boolean(s.limiter),
    preset: typeof s.preset === 'string' ? s.preset : null,
    presetDirty: Boolean(s.presetDirty),
  };
}

export const dbToGain = (db) => Math.pow(10, db / 20);

// 頻譜資料點：offscreen 依此取樣，popup 依此繪製
export const SPECTRUM_POINTS = 180;
export const SPECTRUM_FMIN = 16;
export const SPECTRUM_FMAX = 20000;
export function spectrumFreqs() {
  const out = new Array(SPECTRUM_POINTS);
  const ratio = SPECTRUM_FMAX / SPECTRUM_FMIN;
  for (let i = 0; i < SPECTRUM_POINTS; i++) {
    out[i] = SPECTRUM_FMIN * Math.pow(ratio, i / (SPECTRUM_POINTS - 1));
  }
  return out;
}

export const STORAGE_KEYS = {
  settings: 'settings',
  userPresets: 'userPresets',
};
