// Service worker：管理 offscreen 音訊文件的生命週期、儲存設定、更新圖示徽章
import { normalizeSettings, STORAGE_KEYS } from './shared/config.js';

const OFFSCREEN_URL = 'src/offscreen.html';

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

let creating = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['USER_MEDIA'],
        justification: 'Capture tab audio and apply equalization',
      })
      .finally(() => (creating = null));
  }
  await creating;
  // 確認 offscreen 的訊息監聽已就緒
  for (let i = 0; i < 20; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' });
      if (r?.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(data[STORAGE_KEYS.settings]);
}

// ---- 設定儲存（popup 每次調整都會廣播 apply，這裡做防抖後寫入）----
let pendingSettings = null;
let saveTimer = null;
function scheduleSave(settings) {
  pendingSettings = settings;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ [STORAGE_KEYS.settings]: normalizeSettings(pendingSettings) });
    pendingSettings = null;
  }, 250);
}

// ---- 徽章 ----
async function getActiveTabIds() {
  const data = await chrome.storage.session.get('activeTabIds');
  return data.activeTabIds || [];
}

async function updateBadges(tabIds) {
  const prev = await getActiveTabIds();
  await chrome.storage.session.set({ activeTabIds: tabIds });
  for (const id of prev) {
    if (!tabIds.includes(id)) chrome.action.setBadgeText({ tabId: id, text: '' }).catch(() => {});
  }
  for (const id of tabIds) setOnBadge(id);
}

function setOnBadge(tabId) {
  chrome.action.setBadgeText({ tabId, text: 'EQ' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#22d3ee' }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ tabId, color: '#06121a' })?.catch(() => {});
}

// 分頁換頁後徽章可能被重設，重新標上
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'loading') return;
  const ids = await getActiveTabIds();
  if (ids.includes(tabId)) setOnBadge(tabId);
});

async function getStatus() {
  if (!(await hasOffscreen())) return { tabs: [], sampleRate: null };
  let st;
  try {
    st = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'status' });
  } catch {
    return { tabs: [], sampleRate: null };
  }
  const tabs = [];
  for (const id of st?.tabIds || []) {
    try {
      const t = await chrome.tabs.get(id);
      tabs.push({ id, title: t.title, favIconUrl: t.favIconUrl, url: t.url });
    } catch {
      tabs.push({ id, title: '', favIconUrl: '', closed: true });
    }
  }
  return { tabs, sampleRate: st?.sampleRate ?? null };
}

async function handle(msg) {
  switch (msg.type) {
    case 'start': {
      await ensureOffscreen();
      const settings = await loadSettings();
      const r = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'start',
        tabId: msg.tabId,
        streamId: msg.streamId,
        settings: pendingSettings ? normalizeSettings(pendingSettings) : settings,
      });
      return r;
    }
    case 'stop': {
      if (!(await hasOffscreen())) return { ok: true };
      return chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop', tabId: msg.tabId });
    }
    case 'status':
      return getStatus();
    case 'streamsChanged': {
      await updateBadges(msg.tabIds || []);
      // 沒有任何分頁在處理時關閉 offscreen 文件以釋放資源
      if ((msg.tabIds || []).length === 0 && (await hasOffscreen())) {
        await chrome.offscreen.closeDocument().catch(() => {});
      }
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.target === 'engine' && msg.type === 'apply') {
    scheduleSave(msg.settings);
    return;
  }
  if (msg.target !== 'bg') return;
  handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// ---- 全螢幕修正 ----
// 分頁被擷取時，網頁內的全螢幕（例如影片）只會填滿分頁區域而不是整個螢幕。
// 收到擷取狀態的全螢幕變化時，同步切換視窗的全螢幕狀態。
const prevWindowState = {};
chrome.tabCapture.onStatusChanged?.addListener(async (info) => {
  if (info.status !== 'active') return;
  try {
    const tab = await chrome.tabs.get(info.tabId);
    const win = await chrome.windows.get(tab.windowId);
    if (info.fullscreen) {
      if (win.state !== 'fullscreen') {
        prevWindowState[win.id] = win.state;
        await chrome.windows.update(win.id, { state: 'fullscreen' });
      }
    } else if (win.state === 'fullscreen' && prevWindowState[win.id]) {
      await chrome.windows.update(win.id, { state: prevWindowState[win.id] });
      delete prevWindowState[win.id];
    }
  } catch {}
});
