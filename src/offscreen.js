// 音訊引擎：在 offscreen document 中執行（MV3 的 service worker 無法使用 Web Audio）
//
// 訊號流程：
//   各分頁音訊 → inputBus → 聲道處理（原聲 / 去人聲 / 中央聲道）
//   → 11 段 EQ → 失真 → 殘響 → 主音量 → 限制器（可關）→ 喇叭
//                                                    └→ 頻譜分析
import {
  BAND_COUNT,
  BAND_TYPES,
  normalizeSettings,
  dbToGain,
  spectrumFreqs,
} from './shared/config.js';

const SMOOTH = 0.015; // 參數平滑時間常數（秒），避免拖曳時產生爆音

class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.streams = new Map(); // tabId -> { stream, source }
    this.settings = normalizeSettings(null);
    this.reverbDecay = null;
    this.build();
  }

  gain(value = 1) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  filter(type, frequency, Q = Math.SQRT1_2) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  }

  set(param, value) {
    param.setTargetAtTime(value, this.ctx.currentTime, SMOOTH);
  }

  build() {
    const ctx = this.ctx;
    this.inputBus = this.gain();

    // ---- 聲道處理：三條路徑並聯，以增益切換（無爆音）----
    this.stereoOut = this.gain();
    const splitter = ctx.createChannelSplitter(2);
    this.inputBus.connect(splitter);

    // 原聲
    this.pathNormal = this.gain(1);
    this.inputBus.connect(this.pathNormal).connect(this.stereoOut);

    // Mid = (L+R)/2
    const mid = this.gain();
    const midL = this.gain(0.5);
    const midR = this.gain(0.5);
    splitter.connect(midL, 0);
    splitter.connect(midR, 1);
    midL.connect(mid);
    midR.connect(mid);

    // 中央聲道（單聲道 Mid）：去掉左右分佈的內容，人聲較突出
    this.pathCenter = this.gain(0);
    mid.connect(this.pathCenter).connect(this.stereoOut);

    // 去人聲：Side = (L−R) 消掉置中的人聲；低頻改用 Mid 補回，避免大鼓和貝斯一起消失
    this.pathKaraoke = this.gain(0);
    const side = this.gain();
    const sideL = this.gain(0.6);
    const sideR = this.gain(-0.6);
    splitter.connect(sideL, 0);
    splitter.connect(sideR, 1);
    sideL.connect(side);
    sideR.connect(side);
    const crossover = 140;
    side
      .connect(this.filter('highpass', crossover))
      .connect(this.filter('highpass', crossover))
      .connect(this.pathKaraoke);
    mid
      .connect(this.filter('lowpass', crossover))
      .connect(this.filter('lowpass', crossover))
      .connect(this.pathKaraoke);
    this.pathKaraoke.connect(this.stereoOut);

    // ---- 11 段 EQ（串聯）----
    this.bands = [];
    let node = this.stereoOut;
    for (let i = 0; i < BAND_COUNT; i++) {
      const b = this.settings.bands[i];
      const f = this.filter(BAND_TYPES[i], b.f, b.q);
      f.gain.value = b.g;
      node.connect(f);
      node = f;
      this.bands.push(f);
    }
    const eqOut = node;

    // ---- 失真（乾/濕混合）----
    this.distOut = this.gain();
    this.distDry = this.gain(1);
    this.distWet = this.gain(0);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    eqOut.connect(this.distDry).connect(this.distOut);
    this.distWet.connect(this.distOut);
    this.shaper.connect(this.distWet);
    this.eqOut = eqOut;
    this.distConnected = false;

    // ---- 殘響（乾/濕混合）----
    this.revOut = this.gain();
    this.revDry = this.gain(1);
    this.revWet = this.gain(0);
    this.preDelay = ctx.createDelay(1);
    this.convolver = ctx.createConvolver();
    this.damping = this.filter('lowpass', 6000, 0.5);
    this.preDelay.connect(this.convolver).connect(this.damping).connect(this.revWet);
    this.distOut.connect(this.revDry).connect(this.revOut);
    this.revWet.connect(this.revOut);
    this.revConnected = false;

    // ---- 主音量 + 限制器 ----
    this.master = this.gain(1);
    this.revOut.connect(this.master);

    this.finalOut = this.gain();
    this.limBypass = this.gain(1);
    this.limOn = this.gain(0);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limBypass).connect(this.finalOut);
    this.master.connect(this.limiter).connect(this.limOn).connect(this.finalOut);

    this.finalOut.connect(ctx.destination);

    // ---- 頻譜分析 ----
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0.6;
    this.finalOut.connect(this.analyser);
  }

  apply(raw) {
    const s = normalizeSettings(raw);
    this.settings = s;

    for (let i = 0; i < BAND_COUNT; i++) {
      const f = this.bands[i];
      const b = s.bands[i];
      this.set(f.frequency, b.f);
      this.set(f.gain, b.g);
      this.set(f.Q, b.q);
    }

    this.set(this.pathNormal.gain, s.stereo === 'normal' ? 1 : 0);
    this.set(this.pathCenter.gain, s.stereo === 'center' ? 1 : 0);
    this.set(this.pathKaraoke.gain, s.stereo === 'karaoke' ? 1 : 0);

    this.applyDistortion(s.distortion);
    this.applyReverb(s.reverb);

    this.set(this.master.gain, dbToGain(s.masterDb));
    this.set(this.limOn.gain, s.limiter ? 1 : 0);
    this.set(this.limBypass.gain, s.limiter ? 0 : 1);
  }

  applyDistortion(d) {
    if (d.on) {
      if (this.distDrive !== d.drive) {
        this.shaper.curve = makeDriveCurve(d.drive);
        this.distDrive = d.drive;
      }
      if (!this.distConnected) {
        this.eqOut.connect(this.shaper);
        this.distConnected = true;
      }
      // 失真後音量會變大，濕訊號稍微壓低
      this.set(this.distWet.gain, d.mix * 0.7);
      this.set(this.distDry.gain, 1 - d.mix);
    } else {
      this.set(this.distWet.gain, 0);
      this.set(this.distDry.gain, 1);
      if (this.distConnected) {
        // 等淡出後再斷開，節省 CPU
        clearTimeout(this.distTimer);
        this.distTimer = setTimeout(() => {
          if (!this.settings.distortion.on && this.distConnected) {
            this.eqOut.disconnect(this.shaper);
            this.distConnected = false;
          }
        }, 200);
      }
    }
  }

  applyReverb(r) {
    if (r.on) {
      if (this.reverbDecay !== r.decay) {
        this.convolver.buffer = makeImpulse(this.ctx, r.decay);
        this.reverbDecay = r.decay;
      }
      if (!this.revConnected) {
        this.distOut.connect(this.preDelay);
        this.revConnected = true;
      }
      this.set(this.preDelay.delayTime, r.preDelay);
      this.set(this.damping.frequency, r.damping);
      this.set(this.revWet.gain, r.mix);
      this.set(this.revDry.gain, 1 - r.mix * 0.5);
    } else {
      this.set(this.revWet.gain, 0);
      this.set(this.revDry.gain, 1);
      if (this.revConnected) {
        clearTimeout(this.revTimer);
        this.revTimer = setTimeout(() => {
          if (!this.settings.reverb.on && this.revConnected) {
            this.distOut.disconnect(this.preDelay);
            this.revConnected = false;
          }
        }, 200);
      }
    }
  }

  async start(tabId, streamId) {
    if (this.streams.has(tabId)) this.stop(tabId, false);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    });
    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.inputBus);
    this.streams.set(tabId, { stream, source });
    // 分頁關閉或擷取被中斷時自動清除
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => this.stop(tabId));
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    notifyStreams();
  }

  stop(tabId, notify = true) {
    const entry = this.streams.get(tabId);
    if (!entry) return;
    this.streams.delete(tabId);
    entry.source.disconnect();
    entry.stream.getTracks().forEach((t) => t.stop());
    if (this.streams.size === 0) this.ctx.suspend();
    if (notify) notifyStreams();
  }

  status() {
    return { tabIds: [...this.streams.keys()], sampleRate: this.ctx.sampleRate };
  }
}

// tanh 飽和曲線，drive 0–100
function makeDriveCurve(drive) {
  const n = 4096;
  const k = 1 + (drive / 100) * 24;
  const norm = Math.tanh(k);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

// 以指數衰減的雜訊產生殘響脈衝響應（decay = 衰減 60 dB 所需秒數）
function makeImpulse(ctx, decay) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * decay));
  const buf = ctx.createBuffer(2, length, rate);
  const fadeIn = Math.floor(rate * 0.003);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const env = Math.exp((-6.9 * t) / decay) * (i < fadeIn ? i / fadeIn : 1);
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

// ---- 頻譜串流（popup 透過 Port 連線時才運作）----
const SPEC_FREQS = spectrumFreqs();
function spectrumFrame(engine, buf) {
  const a = engine.analyser;
  a.getFloatFrequencyData(buf);
  const binHz = engine.ctx.sampleRate / a.fftSize;
  const out = new Array(SPEC_FREQS.length);
  for (let i = 0; i < SPEC_FREQS.length; i++) {
    const f = SPEC_FREQS[i];
    const lo = i === 0 ? f : Math.sqrt(f * SPEC_FREQS[i - 1]);
    const hi = i === SPEC_FREQS.length - 1 ? f : Math.sqrt(f * SPEC_FREQS[i + 1]);
    let b0 = Math.floor(lo / binHz);
    let b1 = Math.ceil(hi / binHz);
    b0 = Math.max(1, Math.min(buf.length - 1, b0));
    b1 = Math.max(b0, Math.min(buf.length - 1, b1));
    let m = -Infinity;
    for (let b = b0; b <= b1; b++) if (buf[b] > m) m = buf[b];
    out[i] = Number.isFinite(m) ? Math.round(m * 10) / 10 : -160;
  }
  return out;
}

// ---- 訊息處理 ----
const engine = new AudioEngine();

function notifyStreams() {
  chrome.runtime.sendMessage({ target: 'bg', type: 'streamsChanged', ...engine.status() }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  // 'engine' 為 popup 的即時參數更新（background 同時會負責儲存）
  if (msg.target === 'engine' && msg.type === 'apply') {
    engine.apply(msg.settings);
    return;
  }
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {
    case 'ping':
      sendResponse({ ok: true });
      return;
    case 'start':
      if (msg.settings) engine.apply(msg.settings);
      engine
        .start(msg.tabId, msg.streamId)
        .then(() => sendResponse({ ok: true, ...engine.status() }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    case 'stop':
      engine.stop(msg.tabId);
      sendResponse({ ok: true, ...engine.status() });
      return;
    case 'status':
      sendResponse(engine.status());
      return;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'spectrum') return;
  const buf = new Float32Array(engine.analyser.frequencyBinCount);
  // 隱藏文件中 requestAnimationFrame 不會觸發，改用計時器（約 30 fps）
  const timer = setInterval(() => {
    if (engine.streams.size === 0) return;
    try {
      port.postMessage(spectrumFrame(engine, buf));
    } catch {
      clearInterval(timer);
    }
  }, 33);
  port.onDisconnect.addListener(() => clearInterval(timer));
});
