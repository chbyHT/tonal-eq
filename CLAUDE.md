# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

Tonal EQ：Chrome Manifest V3 分頁音效等化器。原生 JavaScript（ES modules），**沒有建置步驟、沒有 npm、沒有測試框架**。

- 安裝：`chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選本資料夾。修改後在該頁按重新整理圖示（改 popup 只需重開 popup；改 background / offscreen 需要重新整理擴充功能）。
- 語法檢查：`for f in src/*.js src/shared/*.js; do node --input-type=module --check < "$f"; done`
- 需求 Chrome 116+（`chrome.runtime.getContexts`、offscreen 使用 tabCapture stream id）。

## 架構

三個執行環境，彼此只透過 `chrome.runtime` 訊息溝通：

- **`src/popup.*`**：介面。呼叫 `chrome.tabCapture.getMediaStreamId({targetTabId})`（必須在 popup 這個使用者觸發的環境中呼叫），把 stream id 交給 background。
- **`src/background.js`**（service worker）：建立/關閉 offscreen document、儲存設定、更新圖示徽章、全螢幕修正。沒有任何分頁在處理時會關閉 offscreen document。
- **`src/offscreen.js`**（offscreen document，reason `USER_MEDIA`）：唯一持有 `AudioContext` 的地方。MV3 service worker 不能用 Web Audio，所以音訊引擎在這裡。

### 訊息協定（重要）

`runtime.sendMessage` 會廣播給**所有**擴充功能頁面（popup、SW、offscreen 都收得到），因此每則訊息帶 `target`，每個 listener 必須忽略不屬於自己的 target，且只在自己要非同步回應時 `return true`，否則會搶走別人的回應。

- `target: 'bg'`：`start` / `stop` / `status` / `streamsChanged`（後者由 offscreen 發出，popup 也會監聽來刷新狀態）
- `target: 'offscreen'`：`ping` / `start` / `stop` / `status`（只由 background 轉發）
- `target: 'engine', type: 'apply'`：popup 每次調整時廣播完整設定；**offscreen 套用、background 防抖後寫入 storage**，兩者都處理同一則訊息
- 頻譜：popup 以 `runtime.connect({name: 'spectrum'})` 連到 offscreen，offscreen 用 `setInterval` 推送（隱藏文件中 `requestAnimationFrame` 不會觸發）。取樣點由 `config.js` 的 `SPECTRUM_*` / `spectrumFreqs()` 共用定義。

### 狀態與儲存

- `chrome.storage.local.settings`：目前音效設定，**只由 background 寫入**。offscreen 無法存取 `chrome.storage`，所以 background 在 `start` 時把設定一併傳過去。
- `chrome.storage.local.userPresets`：由 popup 直接寫入。
- `chrome.storage.session.activeTabIds`：background 用來維護徽章。
- 任何來自 storage、訊息或匯入的設定都要經過 `normalizeSettings()`（`src/shared/config.js`），它負責補齊預設值與限制範圍。

### 訊號流程（offscreen）

分頁音訊 → inputBus → 聲道處理（原聲／去人聲／中央聲道三條並聯路徑，以增益交叉淡變切換）→ 11 段 BiquadFilter 串聯 → 失真（乾濕混合）→ 殘響（ConvolverNode，脈衝響應由 `makeImpulse()` 以雜訊產生）→ 主音量 → 限制器（並聯旁通切換）→ 輸出，並在最後接 AnalyserNode。

- 失真與殘響關閉時會在淡出後斷開節點以省 CPU；所有效果關閉時輸出等同純 EQ。
- 參數變更一律用 `setTargetAtTime` 平滑，避免拖曳時爆音。

### EQ 頻段模型

固定 11 段，類型由索引決定（`BAND_TYPES`）：第 0 段 lowshelf、第 10 段 highshelf、其餘 peaking。Web Audio 的 shelf 濾波器忽略 Q。預設頻率為每八度一段、Q = 1/√2。

popup 的曲線是在 `OfflineAudioContext`（取引擎實際的 sampleRate）中建立真正的 `BiquadFilterNode` 呼叫 `getFrequencyResponse()` 算出來的，因此畫面與實際音效一致；不要改成手寫公式。

### 預設集與多語系

- 內建預設集在 `src/shared/presets.js` 的 `BUILTIN_PRESETS`，`bands` 只列要改動的頻段索引（稀疏），未列出者回到預設；可另帶 `stereo` / `distortion` / `reverb`。主音量與限制器不屬於預設集。
- 預設集的名稱與說明放在 `src/shared/i18n.js` 的 `preset_<id>: [名稱, 說明]`，新增預設集時中英文兩邊都要加。
- 介面文字：HTML 用 `data-i18n` / `data-i18n-title` / `data-i18n-placeholder` / `data-i18n-label` / `data-i18n-html`，JS 用 `t(key, ...args)`。瀏覽器語言為 `zh*` 時顯示繁體中文，其餘顯示英文。擴充功能名稱與說明在 `_locales/`。
- 匯入接受本專案匯出格式（`format: 'tonal-eq-presets'`），也接受 `{名稱: {frequencies, gains, qs}}` 平行陣列格式。

## 專案規範

- 本專案是自行撰寫的乾淨實作：不要引用或複製其他 EQ 擴充功能（包括使用者以前用的 Ears）的名稱、圖示、文字或作者資訊。
- `src/popup.html` 內嵌的 SVG logo 與 `icons/*.png` 是同一個設計，修改時兩邊要一致。
