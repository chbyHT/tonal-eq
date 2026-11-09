// 介面多語系：依瀏覽器介面語言自動選擇，中文（含簡繁）顯示繁體中文，其餘顯示英文

const zh = {
  loading: '讀取中…',
  volume: '音量',
  volumeTitle: '主音量（雙擊重設為 0 dB）',
  enableTab: '啟用此分頁',
  tabActive: '此分頁啟用中',
  clickToStop: '點擊停止處理此分頁',
  rangeTitle: '切換縱軸範圍',
  resetEq: '重設 EQ',
  resetEqTitle: '所有頻段回到 0 dB',
  eqReset: 'EQ 已重設',
  graphLabel: 'EQ 曲線編輯器',
  graphEmpty: '按右上角「啟用此分頁」開始處理音訊；EQ 可隨時先調整',

  hintDrag: '拖曳圓點調整頻率與增益',
  hintQ: '<kbd>Shift</kbd>+拖曳 或 滾輪：調整 Q',
  hintDbl: '雙擊：重設頻段',
  hintKeys: '選取後可用方向鍵微調',
  band: '頻段',
  freq: '頻率',
  gain: '增益',
  resetBand: '重設頻段',
  type_lowshelf: '低架 Low Shelf',
  type_highshelf: '高架 High Shelf',
  type_peaking: '峰值 Peaking',

  tabPresets: '預設集',
  tabEffects: '效果',
  tabTabs: '播放中分頁',

  modified: '已修改',
  myPresets: '我的預設集',
  presetPlaceholder: '輸入名稱後儲存目前設定',
  save: '儲存',
  import: '匯入',
  export: '匯出',
  noUserPresets: '還沒有自訂預設集。調整好後輸入名稱按「儲存」。',
  delete: '刪除',
  confirmDelete: '刪除？',
  presetCorrupt: '預設集資料損毀',
  needName: '請先輸入預設集名稱',
  presetUpdated: (n) => `已更新「${n}」`,
  presetSaved: (n) => `已儲存「${n}」`,
  presetDeleted: (n) => `已刪除「${n}」`,
  nothingToExport: '沒有可匯出的自訂預設集',
  imported: (n) => `已匯入 ${n} 組預設集`,
  importFailed: (m) => `匯入失敗：${m}`,
  badFormat: '檔案格式不正確',
  noPresetsInFile: '檔案中沒有可用的預設集',

  stereo: '聲道',
  stereo_normal: '原聲',
  stereo_karaoke: '去人聲',
  stereo_center: '中央聲道',
  stereoHint_normal: '保持原本的立體聲。',
  stereoHint_karaoke: '相減左右聲道以消除置中人聲，並保留低頻。效果依歌曲混音而定。',
  stereoHint_center: '只保留置中的單聲道內容，人聲較突出、伴奏與空間感減少。',
  distortion: '失真',
  drive: '驅動',
  mix: '混合',
  reverb: '殘響',
  decay: '長度',
  damping: '音色（高頻）',
  preDelay: '預延遲',
  reset: '重設',
  resetTitle: '恢復預設值（滑桿也可以雙擊單獨重設）',
  limiter: '防爆音限制器',
  limiterHint: '大幅提升低音或音量時，避免輸出超過 0 dB 而破音。會略微改變動態，預設關閉。',

  statusOn: '此分頁的音訊正在處理中',
  statusBlocked: '此頁面無法擷取音訊（瀏覽器內建頁面）',
  statusOff: '此分頁未啟用',
  noActiveTabs: '目前沒有分頁正在使用 EQ',
  untitled: '(無標題)',
  closedTab: '(已關閉的分頁)',
  switchToTab: '切換到此分頁',
  stop: '停止',
  errBusy: '此分頁正被其他程式擷取（例如其他 EQ 或錄影擴充功能）',
  errBlocked: '此頁面無法擷取音訊',
  errStart: (m) => `啟用失敗：${m}`,
  errUnknown: '未知錯誤',

  preset_flat: ['原聲', '不做任何處理'],
  preset_heavyBass: ['重低音加強', '厚實的低頻衝擊'],
  preset_subBass: ['超低音', '強調 30–60 Hz 的下潛'],
  preset_outsideCinema: ['電影院外', '隔著牆的悶低音與回聲'],
  preset_bathroom: ['廁所回音', '磁磚小空間的明亮殘響'],
  preset_cave: ['山洞回音', '地下室般巨大、低沉的長殘響'],
  preset_distortedBass: ['破音低音', '過載失真的低頻'],
  preset_telephone: ['電話聲', '窄頻、單聲道的話筒音色'],
};

const en = {
  loading: 'Loading…',
  volume: 'Volume',
  volumeTitle: 'Master volume (double-click to reset to 0 dB)',
  enableTab: 'Enable on this tab',
  tabActive: 'Active on this tab',
  clickToStop: 'Click to stop processing this tab',
  rangeTitle: 'Toggle vertical range',
  resetEq: 'Reset EQ',
  resetEqTitle: 'Set all bands back to 0 dB',
  eqReset: 'EQ reset',
  graphLabel: 'EQ curve editor',
  graphEmpty: 'Click “Enable on this tab” to start. You can adjust the EQ anytime.',

  hintDrag: 'Drag dots: freq & gain',
  hintQ: '<kbd>Shift</kbd>+drag / scroll: Q',
  hintDbl: 'Double-click: reset',
  hintKeys: 'Arrow keys: fine-tune',
  band: 'Band',
  freq: 'Freq',
  gain: 'Gain',
  resetBand: 'Reset band',
  type_lowshelf: 'Low Shelf',
  type_highshelf: 'High Shelf',
  type_peaking: 'Peaking',

  tabPresets: 'Presets',
  tabEffects: 'Effects',
  tabTabs: 'Active tabs',

  modified: 'modified',
  myPresets: 'My presets',
  presetPlaceholder: 'Name, then save current settings',
  save: 'Save',
  import: 'Import',
  export: 'Export',
  noUserPresets: 'No custom presets yet. Tweak the sound, type a name and press Save.',
  delete: 'Delete',
  confirmDelete: 'Delete?',
  presetCorrupt: 'Preset data is corrupted',
  needName: 'Please enter a preset name first',
  presetUpdated: (n) => `Updated “${n}”`,
  presetSaved: (n) => `Saved “${n}”`,
  presetDeleted: (n) => `Deleted “${n}”`,
  nothingToExport: 'No custom presets to export',
  imported: (n) => `Imported ${n} preset${n === 1 ? '' : 's'}`,
  importFailed: (m) => `Import failed: ${m}`,
  badFormat: 'Unrecognized file format',
  noPresetsInFile: 'No usable presets in this file',

  stereo: 'Stereo',
  stereo_normal: 'Original',
  stereo_karaoke: 'Remove vocals',
  stereo_center: 'Center only',
  stereoHint_normal: 'Keeps the original stereo image.',
  stereoHint_karaoke: 'Subtracts left/right to cancel centered vocals while keeping the lows. Results depend on the mix.',
  stereoHint_center: 'Keeps only the centered mono content: vocals stand out, width and accompaniment drop.',
  distortion: 'Distortion',
  drive: 'Drive',
  mix: 'Mix',
  reverb: 'Reverb',
  decay: 'Length',
  damping: 'Tone (highs)',
  preDelay: 'Pre-delay',
  reset: 'Reset',
  resetTitle: 'Restore defaults (double-click a slider to reset just that one)',
  limiter: 'Limiter',
  limiterHint: 'Prevents clipping above 0 dB when boosting bass or volume heavily. Slightly changes dynamics; off by default.',

  statusOn: 'Processing audio on this tab',
  statusBlocked: 'This page can’t be captured (browser page)',
  statusOff: 'Not enabled on this tab',
  noActiveTabs: 'No tabs are using the EQ',
  untitled: '(untitled)',
  closedTab: '(closed tab)',
  switchToTab: 'Switch to this tab',
  stop: 'Stop',
  errBusy: 'This tab is already being captured by something else (another EQ or recorder extension)',
  errBlocked: 'This page can’t be captured',
  errStart: (m) => `Couldn’t enable: ${m}`,
  errUnknown: 'Unknown error',

  preset_flat: ['Flat', 'No processing'],
  preset_heavyBass: ['Bass Boost', 'Thick, punchy lows'],
  preset_subBass: ['Sub Bass', 'Deep 30–60 Hz extension'],
  preset_outsideCinema: ['Outside the Cinema', 'Muffled bass through a wall, with echo'],
  preset_bathroom: ['Bathroom Echo', 'Bright reverb of a small tiled room'],
  preset_cave: ['Cave Echo', 'Huge, dark reverb like a cave or basement'],
  preset_distortedBass: ['Distorted Bass', 'Overdriven low end'],
  preset_telephone: ['Telephone', 'Narrow-band mono handset tone'],
};

function detect() {
  let lang = '';
  try {
    lang = chrome.i18n.getUILanguage();
  } catch {
    lang = navigator.language || '';
  }
  return /^zh/i.test(lang) ? 'zh' : 'en';
}

export const LANG = detect();
const dict = LANG === 'zh' ? zh : en;

export function t(key, ...args) {
  const v = dict[key] ?? en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

// 套用 HTML 中的 data-i18n（文字）、data-i18n-html、data-i18n-title、data-i18n-placeholder、data-i18n-label
export function localizeDom(root = document) {
  document.documentElement.lang = LANG === 'zh' ? 'zh-Hant' : 'en';
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  root.querySelectorAll('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nLabel)));
}
