// 內建效果預設集與使用者預設集的轉換工具（名稱與說明在 i18n.js 的 preset_<id>）
import {
  defaultBand,
  defaultBands,
  defaultDistortion,
  defaultReverb,
  normalizeDistortion,
  normalizeReverb,
  BAND_COUNT,
  LIMITS,
  clamp,
  STEREO_MODES,
} from './config.js';

// bands 只列出要改動的頻段：{ 頻段索引: { f, g, q } }，未列出的頻段回到預設值
export const BUILTIN_PRESETS = [
  {
    id: 'flat',
    bands: {},
  },
  {
    id: 'heavyBass',
    bands: {
      0: { f: 110, g: 9 },
      1: { f: 55, g: 4, q: 1.0 },
      4: { f: 300, g: -3, q: 1.0 },
      8: { f: 4000, g: 1.5, q: 0.8 },
    },
  },
  {
    // 像地板震動器（subfloor）：只留低音。高架放在 110 Hz 把中高音整段壓低，
    // 再用四個寬頻段把 1 kHz 以上幾乎完全消除
    id: 'subBass',
    bands: {
      0: { f: 120, g: 6 },
      1: { f: 40, g: 4, q: 1.0 },
      2: { f: 65, g: 3, q: 1.0 },
      6: { f: 1300, g: -24 },
      7: { f: 2600, g: -24 },
      8: { f: 5100, g: -24 },
      9: { f: 10000, g: -24 },
      10: { f: 110, g: -20 },
    },
  },
  {
    // 隔牆聽：低音保留、中高音大幅衰減，再加上悶的殘響
    id: 'outsideCinema',
    stereo: 'center',
    bands: {
      0: { f: 100, g: 5 },
      6: { f: 1300, g: -18 },
      7: { f: 2600, g: -18 },
      8: { f: 5100, g: -18 },
      9: { f: 10000, g: -18 },
      10: { f: 250, g: -24 },
    },
    reverb: { on: true, decay: 2.4, damping: 700, preDelay: 0.035, mix: 0.45 },
  },
  {
    id: 'bathroom',
    bands: {
      3: { f: 250, g: 2, q: 1.0 },
      7: { f: 2500, g: 2.5, q: 1.2 },
      10: { f: 9000, g: -4 },
    },
    reverb: { on: true, decay: 2.2, damping: 9000, preDelay: 0.012, mix: 0.62 },
  },
  {
    // 山洞／地下室：很長、偏暗的殘響，較長的預延遲讓空間感覺更大
    id: 'cave',
    bands: {
      3: { f: 200, g: 2, q: 0.8 },
      10: { f: 5000, g: -5 },
    },
    reverb: { on: true, decay: 4.8, damping: 3000, preDelay: 0.06, mix: 0.6 },
  },
  {
    id: 'distortedBass',
    bands: {
      0: { f: 130, g: 12 },
      1: { f: 60, g: 4, q: 1.0 },
      7: { f: 2500, g: 2, q: 1.0 },
    },
    distortion: { on: true, drive: 65, mix: 0.55 },
  },
  {
    id: 'telephone',
    stereo: 'center',
    bands: {
      0: { f: 450, g: -30 },
      6: { f: 1500, g: 7, q: 0.9 },
      10: { f: 3200, g: -30 },
    },
    distortion: { on: true, drive: 20, mix: 0.35 },
  },
];

// 把內建預設集展開成完整的音效設定（bands 陣列 + 效果）
export function expandBuiltin(preset) {
  const bands = defaultBands();
  for (const [idx, b] of Object.entries(preset.bands || {})) {
    const i = Number(idx);
    bands[i] = { ...defaultBand(i), ...b };
  }
  return {
    bands,
    stereo: preset.stereo || 'normal',
    distortion: { ...defaultDistortion(), ...(preset.distortion || {}) },
    reverb: { ...defaultReverb(), ...(preset.reverb || {}) },
  };
}

// 使用者預設集格式：{ bands: [{f,g,q}...], stereo, distortion, reverb }
export function normalizeUserPreset(p) {
  if (!p || typeof p !== 'object') return null;

  // 也接受「frequencies / gains / qs」三個平行陣列的通用格式
  let bands = p.bands;
  if (!Array.isArray(bands) && Array.isArray(p.frequencies)) {
    bands = p.frequencies.map((f, i) => ({ f, g: p.gains?.[i] ?? 0, q: p.qs?.[i] }));
  }
  if (!Array.isArray(bands)) return null;

  const out = [];
  for (let i = 0; i < BAND_COUNT; i++) {
    const b = bands[i] || defaultBand(i);
    const def = defaultBand(i);
    out.push({
      f: clamp(Number(b.f ?? def.f), LIMITS.freq),
      g: clamp(Number(b.g ?? 0), LIMITS.gain),
      q: clamp(Number(b.q ?? def.q), LIMITS.q),
    });
  }
  return {
    bands: out,
    stereo: STEREO_MODES.includes(p.stereo) ? p.stereo : 'normal',
    distortion: normalizeDistortion(p.distortion),
    reverb: normalizeReverb(p.reverb),
  };
}

export const EXPORT_FORMAT = 'tonal-eq-presets';

// 解析匯入的 JSON，回傳 { 名稱: 預設集 }
export function parseImport(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const src = data && data.format === EXPORT_FORMAT ? data.presets : data;
  if (!src || typeof src !== 'object') throw new Error('badFormat');
  const out = {};
  for (const [name, p] of Object.entries(src)) {
    const n = normalizeUserPreset(p);
    if (n && name.trim()) out[name.trim()] = n;
  }
  if (Object.keys(out).length === 0) throw new Error('noPresetsInFile');
  return out;
}
