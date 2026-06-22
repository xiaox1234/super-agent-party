/**
 * THA Desk Pet — full frontend module (PixiJS rendering)
 */
import { CNNx2M, CNNx2UL, CNNx2VL } from '../libs/anime4k-sr.bundle.js';
const container = document.getElementById('pixi-container');
const subtitleEl = document.getElementById('subtitle-container');
const controlPanel = document.getElementById('control-panel');

let app, sprite, renderWs, ttsWs;
let mx = 0, my = 0;
let connected = false, ttsConnected = false;
let isLocked = false, pttVisible = false, textInputVisible = false;
let isSubtitleEnabled = true;
let isPanelHovered = false, hideTimeout, hideTimer;
let allModels = [], currentModelIndex = 0;
let audioCtx = null, audioAnalyser = null, mouthTimer = null;
let mediaRecorder = null, pttWs = null, recording = false;

// ==================== I18n Translation Engine (对齐 3D 逻辑) ====================
async function fetchLanguage() {
    try {
        let res = await fetch(`${window.location.protocol}//${window.location.host}/cur_language`);
        const data = await res.json();
        return data.language || 'zh-CN';
    } catch (error) { 
        return 'zh-CN'; 
    }
}

async function t(key) {
    const lang = await fetchLanguage();
    if (typeof window.translations !== 'undefined' && window.translations[lang] && window.translations[lang][key]) {
        return window.translations[lang][key];
    }
    const fb = {
        'zh-CN': { 'LockWindow': '锁定窗口', 'UnlockWindow': '解锁窗口', 'AutoHideDescription': '鼠标悬停自动隐藏', 'AutoHideEnabled': '自动隐藏已启用', 'Previous': '上一个模型', 'Next': '下一个模型', 'refreshWindow': '刷新 / 重置', 'closeWindow': '关闭挂件', 'WebSocketConnected': '服务已连接', 'WebSocketDisconnected': '服务重连中...', 'EnableVoiceInput': '开启语音唤醒', 'DisableVoiceInput': '关闭语音唤醒', 'EnableTextInput': '开启文字输入', 'DisableTextInput': '关闭文字输入', 'dragWindow': '按住拖动', 'SubtitleEnabled': '字幕已开启', 'SubtitleDisabled': '字幕已关闭' },
        'en-US': { 'LockWindow': 'Lock Window', 'UnlockWindow': 'Unlock Window', 'AutoHideDescription': 'Auto Hide on Hover', 'AutoHideEnabled': 'Auto Hide Enabled', 'Previous': 'Previous Model', 'Next': 'Next Model', 'refreshWindow': 'Refresh / Reset', 'closeWindow': 'Close Widget', 'WebSocketConnected': 'Services Connected', 'WebSocketDisconnected': 'Services Disconnected', 'EnableVoiceInput': 'Enable Voice Input', 'DisableVoiceInput': 'Disable Voice Input', 'EnableTextInput': 'Enable Text Input', 'DisableTextInput': 'Disable Text Input', 'dragWindow': 'Drag to move', 'SubtitleEnabled': 'Subtitle Enabled', 'SubtitleDisabled': 'Subtitle Disabled' }
    };
    return fb[lang]?.[key] || key;
}

// ==================== Tooltip Customization ====================
const tooltipContainer = document.createElement('div');
tooltipContainer.id = 'control-tooltip-container';
tooltipContainer.style.cssText = `
    position: fixed;
    z-index: 100000;
    pointer-events: none;
    opacity: 0;
    transform: translateX(-10px);
    transition: all 0.3s ease;
`;

const customTooltip = document.createElement('div');
customTooltip.id = 'control-tooltip';
customTooltip.style.cssText = `
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(8px);
`;

tooltipContainer.appendChild(customTooltip);
document.body.appendChild(tooltipContainer);

function showTooltip(button, text) {
    if (!text) return;
    const rect = button.getBoundingClientRect();
    customTooltip.textContent = text;
    const topPosition = rect.top + (rect.height - customTooltip.offsetHeight) / 2;
    tooltipContainer.style.left = `${rect.left - customTooltip.offsetWidth - 15}px`;
    tooltipContainer.style.top = `${topPosition}px`;
    tooltipContainer.style.opacity = '1';
    tooltipContainer.style.transform = 'translateX(0)';
}

function hideTooltip() {
    tooltipContainer.style.opacity = '0';
    tooltipContainer.style.transform = 'translateX(-10px)';
}

function addHoverEffect(button, textFunc) {
    if (!button) return;
    if (button.hasAttribute('title')) button.removeAttribute('title');
    button.addEventListener('mouseenter', async () => {
        const text = typeof textFunc === 'function' ? await textFunc() : textFunc;
        button.dataset.title = text; 
        showTooltip(button, text);
        button.style.transform = 'scale(1.1)';
        button.style.background = 'rgba(255,255,255,1)';
    });
    button.addEventListener('mousemove', () => {
        const rect = button.getBoundingClientRect();
        const topPosition = rect.top + (rect.height - customTooltip.offsetHeight) / 2;
        tooltipContainer.style.left = `${rect.left - customTooltip.offsetWidth - 15}px`;
        tooltipContainer.style.top = `${topPosition}px`;
    });
    button.addEventListener('mouseleave', () => {
        hideTooltip();
        button.style.transform = 'scale(1)';
        button.style.background = 'rgba(255,255,255,0.95)';
    });
}

// ==================== Tap Event Binding ====================
function bindTapEvent(element, callback) {
    if (!element) return;
    let touchMoved = false;
    element.addEventListener('touchstart', () => { touchMoved = false; }, { passive: true });
    element.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });
    element.addEventListener('touchend', (e) => {
        if (!touchMoved) { e.preventDefault(); e.stopPropagation(); callback(e); }
    }, { passive: false });
    element.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); callback(e);
    });
}

// ==================== PixiJS Init (v7) ====================
const BG_THRESHOLD = 0.18; // 绿幕剔除初始灵敏度，你可以微调它

const bgFilterVert = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main(void) {
  gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vTextureCoord = aTextureCoord;
}
`;

const bgFilterFrag = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uThreshold; // 对应传入的 BG_THRESHOLD

void main(void) {
  vec4 color = texture2D(uSampler, vTextureCoord);
  
  // 🌟 经典绿幕（Chroma Key）剔除算法
  // 绿色通道差值 = 绿色分量 - 红色与蓝色分量中的较大值
  float greenDifference = color.g - max(color.r, color.b);
  
  // 自动将 uThreshold (0.18) 缩放为最佳的绿幕阈值 (0.144 左右)
  float sensitivity = uThreshold * 0.8;
  
  // 如果绿色差值明显大于门限且绿色本身有亮度，则设为完全透明，否则保留原色
  if (greenDifference > sensitivity && color.g > 0.3) {
    gl_FragColor = vec4(0.0);
  } else {
    gl_FragColor = color;
  }
}
`;

function initPixi() {
  const w = window.innerWidth || 540;
  const h = window.innerHeight || 540;
  app = new PIXI.Application({
    width: w, height: h, backgroundAlpha: 0, antialias: true,
    resolution: window.devicePixelRatio || 1, autoDensity: true,
  });
  container.appendChild(app.view);
  app.view.style.display = 'block';
  app.view.style.width = '100%';
  app.view.style.height = '100%';
  app.view.style.pointerEvents = 'none';

  window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  });

  sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
  sprite.anchor.set(0.5);
  app.stage.addChild(sprite);

  try {
    const filter = new PIXI.Filter(bgFilterVert, bgFilterFrag, { uThreshold: BG_THRESHOLD });
    sprite.filters = [filter];
  } catch (e) {}
}

// ==================== Render (帧跳跃 + 显存泄漏修复) ====================
let _framePending = false;
let _lastFrameTime = 0;

function updateSprite(texture) {
  if (!sprite || !app || !app.screen.width) return false;
  sprite.texture = texture;
  sprite.x = app.screen.width / 2;
  sprite.y = app.screen.height / 2;
  const sw = app.screen.width / texture.width;
  const sh = app.screen.height / texture.height;
  sprite.scale.set(Math.min(sw, sh));
  return true;
}

function connectRender() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  renderWs = new WebSocket(`${protocol}//${window.location.host}/ws/tha`);
  renderWs.binaryType = 'arraybuffer';

  renderWs.onopen = () => { connected = true; _framePending = false; };
  renderWs.onmessage = (e) => {
    if (!(e.data instanceof ArrayBuffer)) return;

    if (_framePending) return;

    const now = performance.now();
    if (now - _lastFrameTime < 14) return;
    _lastFrameTime = now;

    _framePending = true;
    const blob = new Blob([e.data], { type: 'image/jpeg' });

    (async () => {
      try {
        let bitmap = await createImageBitmap(blob);
        if (SR.enabled) {
          SR._logFirstFrame(bitmap.width, bitmap.height);
          const up = await SR.upscale(bitmap);
          bitmap.close();
          bitmap = up;
        }
        _framePending = false;
        if (!sprite || !app) {
          bitmap.close();
          return;
        }
        const oldTex = sprite.texture;
        const tex = PIXI.Texture.from(bitmap);
        if (SR.enabled) tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
        const updated = updateSprite(tex);
        if (updated && oldTex && oldTex !== PIXI.Texture.WHITE) {
          oldTex.destroy(true);
        } else if (!updated) {
          tex.destroy(true);
        }
      } catch (err) {
        _framePending = false;
        console.error('[THA] Frame error:', err);
      }
    })();
  };
  renderWs.onclose = () => { connected = false; setTimeout(connectRender, 3000); };
  renderWs.onerror = () => { renderWs.close(); };
}

function disconnectRender() {
  if (renderWs) { renderWs.onclose = null; renderWs.close(); renderWs = null; }
  connected = false;
}

// ==================== Super-Resolution Manager (Anime4K CNNx2VL WebGPU) ====================
const SR = {
  device: null, adapter: null, pipe: null,
  inTex: null, outTex: null,
  inCanvas: null, outCanvas: null,
  method: 'none',
  mode: 'cnnx2vl',
  enabled: false,
  _logged: false,
  NATIVE: 512,
  TARGET: 1024,

  async init() {
    if (navigator.gpu) {
      try {
        this.adapter = await navigator.gpu.requestAdapter();
        this.device = await this.adapter.requestDevice();
        this.method = 'webgpu';
        console.log('[SR] WebGPU ready (点击 按钮启用) 设备:', this.adapter.info?.architecture || 'ok');
      } catch (e) { console.warn('[SR] WebGPU init fail:', e); }
    }
    if (this.method === 'none') {
      this.method = 'canvas';
      console.log('[SR] Canvas 2D bicubic ready (点击 按钮启用)');
    }
  },

  async upscale(bitmap) {
    if (this.method === 'webgpu') return this._upscaleWebGPU(bitmap);
    if (this.method === 'canvas') return this._upscaleCanvas(bitmap);
    return bitmap;
  },

  _logFirstFrame(width, height) {
    if (!this._logged) {
      this._logged = true;
      console.log('[SR] 首帧超分: ' + width + 'x' + height + ' -> ' + this.TARGET + 'x' + this.TARGET + ' (' + this.method + ')');
    }
  },

  async _upscaleWebGPU(bitmap) {
    if (!this.device) return this._upscaleCanvas(bitmap);
    try {
      if (!this.inCanvas) this._initWebGPU();
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap, origin: [0, 0] },
        { texture: this.inTex, origin: [0, 0] },
        [this.NATIVE, this.NATIVE]
      );
      { const e = this.device.createCommandEncoder(); this.pipe.pass(e); this.device.queue.submit([e.finish()]); }
      this._blit(this.pipe.getOutputTexture());
      await this.device.queue.onSubmittedWorkDone();
      this.outCanvas.ctx.drawImage(this.inCanvas.gpu, 0, 0);
      return createImageBitmap(this.outCanvas.c2d);
    } catch (e) {
      console.warn('[SR] WebGPU fail, fallback:', e);
      return this._upscaleCanvas(bitmap);
    }
  },

  _initWebGPU() {
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
    this.inTex = this.device.createTexture({ size: [this.NATIVE, this.NATIVE], format: 'rgba8unorm', usage });
    const Klass = { cnnx2m: CNNx2M, cnnx2vl: CNNx2VL, cnnx2ul: CNNx2UL }[this.mode] || CNNx2VL;
    this.pipe = new Klass({ device: this.device, inputTexture: this.inTex });
    this.inCanvas = { gpu: new OffscreenCanvas(this.TARGET, this.TARGET), fmt: '' };
    this.inCanvas.ctx = this.inCanvas.gpu.getContext('webgpu');
    this.inCanvas.fmt = navigator.gpu.getPreferredCanvasFormat();
    this.inCanvas.ctx.configure({ device: this.device, format: this.inCanvas.fmt, alphaMode: 'opaque' });
    this.blitObj = this._buildBlit();
    this.outCanvas = {
      c2d: new OffscreenCanvas(this.TARGET, this.TARGET),
      ctx: null
    };
    this.outCanvas.ctx = this.outCanvas.c2d.getContext('2d', { willReadFrequently: true });
  },

  _buildBlit() {
    const code = `
      @group(0) @binding(0) var samp: sampler;
      @group(0) @binding(1) var tex: texture_2d<f32>;
      struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
        var p = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
        var o: VO; o.pos = vec4f(p[i],0,1); o.uv = vec2f((p[i].x+1)/2,(1-p[i].y)/2); return o;
      }
      @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f { return textureSample(tex, samp, uv); }`;
    const shader = this.device.createShaderModule({ code });
    const pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.inCanvas.fmt }] },
      primitive: { topology: 'triangle-list' }
    });
    return { pipeline, sampler: this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) };
  },

  _blit(tex) {
    const bg = this.device.createBindGroup({
      layout: this.blitObj.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.blitObj.sampler },
        { binding: 1, resource: tex.createView() }
      ]
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.inCanvas.ctx.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 1, b: 0, a: 1 }
      }]
    });
    pass.setPipeline(this.blitObj.pipeline);
    pass.setBindGroup(0, bg);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  },

  _cleanupWebGPU() {
    this.pipe = null;
    if (this.inTex) { try { this.inTex.destroy(); } catch(e) {} this.inTex = null; }
    this.inCanvas = null;
    this.outCanvas = null;
    this.blitObj = null;
  },

  _upscaleCanvas(bitmap) {
    const c = new OffscreenCanvas(this.TARGET, this.TARGET);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, this.TARGET, this.TARGET);
    return createImageBitmap(c);
  },

  setEnabled(v) {
    this.enabled = v && this.method !== 'none';
    if (!this.enabled) this._cleanupWebGPU();
    return this.enabled;
  },

  destroy() {
    this._cleanupWebGPU();
    if (this.device) { try { this.device.destroy(); } catch(e) {} this.device = null; }
    this.method = 'none';
    this.enabled = false;
  },

  getLabel() {
    if (!this.enabled) return 'SR: off';
    const names = { cnnx2m: 'CNNx2M', cnnx2vl: 'CNNx2VL', cnnx2ul: 'CNNx2UL' };
    return 'SR: ' + (names[this.mode] || 'CNNx2VL') + ' (1024p)';
  }
};

// ==================== Mouse Tracking & Auto Hide ====================
let isAutoHideEnabled = false;
let isModelHiddenByHover = false;

document.addEventListener('mousemove', (e) => {
  const rect = container.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxD = Math.max(window.innerWidth, window.innerHeight);
  
  // 更新看向的方向
  mx = ((e.clientX - cx) / maxD) * 2;
  my = ((e.clientY - cy) / maxD) * 2;

  // 鼠标悬浮自动隐藏判断
  if (isAutoHideEnabled && !isLocked && !isModelHiddenByHover && !isPanelHovered) {
      isModelHiddenByHover = true;
      app.view.style.transition = 'opacity 150ms ease';
      app.view.style.opacity = '0';
  }
});

document.addEventListener('mouseleave', () => {
  // 核心特性：鼠标离开窗口之后，自动恢复看向前方
  mx = 0;
  my = 0; 
  
  if (isAutoHideEnabled && isModelHiddenByHover) {
      isModelHiddenByHover = false;
      app.view.style.transition = 'opacity 150ms ease';
      app.view.style.opacity = '1';
  }
});

setInterval(() => {
  if (renderWs && renderWs.readyState === WebSocket.OPEN) {
    renderWs.send(JSON.stringify({ type: 'mouse', x: mx.toFixed(3), y: my.toFixed(3) }));
  }
}, 33);

// ==================== Control Panel ====================
function showPanel() {
  clearTimeout(hideTimeout);
  controlPanel.classList.remove('hidden');
  controlPanel.style.opacity = '1';
  controlPanel.style.transform = 'translateX(0)';
}
function hidePanel() {
  if (!isPanelHovered) {
    controlPanel.classList.add('hidden');
    controlPanel.style.opacity = '0';
    controlPanel.style.transform = 'translateX(20px)';
  }
}
function scheduleHide() {
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hidePanel, isLocked ? 200 : 1200);
}
document.body.addEventListener('mouseenter', () => showPanel());
document.body.addEventListener('mousemove', () => { showPanel(); scheduleHide(); });
document.body.addEventListener('mouseleave', () => { if (!isPanelHovered) scheduleHide(); });
document.body.addEventListener('touchstart', (e) => {
  if (!controlPanel.contains(e.target)) { showPanel(); scheduleHide(); }
}, { passive: true });
controlPanel.addEventListener('mouseenter', () => {
  isPanelHovered = true; clearTimeout(hideTimeout); showPanel();
  if (isLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false);
  if (isAutoHideEnabled && !isLocked && isModelHiddenByHover) {
    isModelHiddenByHover = false;
    app.view.style.transition = 'opacity 150ms ease';
    app.view.style.opacity = '1';
  }
});
controlPanel.addEventListener('mouseleave', () => {
  isPanelHovered = false; scheduleHide();
  if (isLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
  if (isAutoHideEnabled && !isLocked && !isModelHiddenByHover) {
    isModelHiddenByHover = true;
    app.view.style.transition = 'opacity 150ms ease';
    app.view.style.opacity = '0';
  }
});
scheduleHide();

// ==================== DOM Elements & Buttons Logic ====================
const lockBtn = document.getElementById('lock-btn');
const hideBtn = document.getElementById('hide-btn');
const prevModelBtn = document.getElementById('prev-model-btn');
const nextModelBtn = document.getElementById('next-model-btn');
const refreshBtn = document.getElementById('refresh-btn');
const closeBtn = document.getElementById('close-btn');
const wsStatusBtn = document.getElementById('ws-status-btn');
const voiceBtn = document.getElementById('voice-btn');
const textBtn = document.getElementById('text-btn');
const subtitleBtn = document.getElementById('subtitle-btn');
const dragBtn = document.getElementById('drag-handle') || document.getElementById('drag-btn');
const pttBtn = document.getElementById('ptt-floating-btn');
const textContainer = document.getElementById('text-input-container');
const textField = document.getElementById('text-input-field');
const sendBtn = document.getElementById('text-send-btn');

// --- Lock ---
bindTapEvent(lockBtn, async () => {
  isLocked = !isLocked;
  if (window.electronAPI) {
    if (isLocked) {
      window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
      controlPanel.querySelectorAll('.ctrl-btn').forEach(b => { if (b !== lockBtn) b.style.display = 'none'; });
    } else {
      window.electronAPI.setIgnoreMouseEvents(false);
      controlPanel.querySelectorAll('.ctrl-btn').forEach(b => { b.style.display = 'flex'; });
    }
  }
  const i = lockBtn.querySelector('i');
  if (isLocked) { i.className = 'fas fa-lock'; lockBtn.style.color = '#dc3545'; }
  else { i.className = 'fas fa-lock-open'; lockBtn.style.color = '#28a745'; }
  
  const text = await (isLocked ? t('UnlockWindow') : t('LockWindow'));
  lockBtn.dataset.title = text;
  if (tooltipContainer.style.opacity === '1') customTooltip.textContent = text;
});

// --- Hide ---
bindTapEvent(hideBtn, async () => {
  isAutoHideEnabled = !isAutoHideEnabled;
  const i = hideBtn.querySelector('i');
  if (isAutoHideEnabled) { 
      i.className = 'fas fa-eye-slash'; hideBtn.style.color = '#ffc107'; 
  } else { 
      i.className = 'fas fa-eye'; hideBtn.style.color = '#6c757d'; 
      if (app && app.view) app.view.style.opacity = '1';
      isModelHiddenByHover = false;
  }
  const text = await (isAutoHideEnabled ? t('AutoHideEnabled') : t('AutoHideDescription'));
  hideBtn.dataset.title = text;
  if (tooltipContainer.style.opacity === '1') customTooltip.textContent = text;
});

// --- PTT & Text Toggles ---
bindTapEvent(voiceBtn, async () => {
  pttVisible = !pttVisible;
  const i = voiceBtn.querySelector('i');
  if (pttVisible) { pttBtn.classList.add('visible'); i.style.color = '#ff6b35'; }
  else { pttBtn.classList.remove('visible'); pttBtn.classList.remove('recording'); i.style.color = '#333'; }
  
  const text = await (pttVisible ? t('DisableVoiceInput') : t('EnableVoiceInput'));
  voiceBtn.dataset.title = text;
  if (tooltipContainer.style.opacity === '1') customTooltip.textContent = text;
});

bindTapEvent(textBtn, async () => {
  textInputVisible = !textInputVisible;
  const i = textBtn.querySelector('i');
  if (textInputVisible) { textContainer.classList.add('visible'); textField.focus(); i.style.color = '#007bff'; }
  else { textContainer.classList.remove('visible'); i.style.color = '#333'; }

  const text = await (textInputVisible ? t('DisableTextInput') : t('EnableTextInput'));
  textBtn.dataset.title = text;
  if (tooltipContainer.style.opacity === '1') customTooltip.textContent = text;
});

// --- Subtitle Toggle ---
function toggleSubtitle(enable) {
  isSubtitleEnabled = enable;
  if (subtitleEl) subtitleEl.style.display = enable ? 'block' : 'none';
}

bindTapEvent(subtitleBtn, async () => {
  toggleSubtitle(!isSubtitleEnabled);
  subtitleBtn.style.color = isSubtitleEnabled ? '#28a745' : '#dc3545';
  const text = await (isSubtitleEnabled ? t('SubtitleEnabled') : t('SubtitleDisabled'));
  subtitleBtn.dataset.title = text;
  if (tooltipContainer.style.opacity === '1') customTooltip.textContent = text;
});

// --- App Control ---
bindTapEvent(refreshBtn, () => location.reload());
bindTapEvent(closeBtn, () => window.close());
bindTapEvent(wsStatusBtn, () => { disconnectRender(); disconnectTTS(); setTimeout(() => { connectRender(); connectTTS(); }, 500); });

// Initial Tooltip Bindings (Dynamic i18n mapping)
(async () => {
    addHoverEffect(lockBtn, async () => await t('LockWindow'));
    addHoverEffect(hideBtn, async () => isAutoHideEnabled ? await t('AutoHideEnabled') : await t('AutoHideDescription'));
    addHoverEffect(prevModelBtn, async () => await t('Previous'));
    addHoverEffect(nextModelBtn, async () => await t('Next'));
    addHoverEffect(refreshBtn, async () => await t('refreshWindow'));
    addHoverEffect(closeBtn, async () => await t('closeWindow'));
    if(dragBtn) addHoverEffect(dragBtn, async () => await t('dragWindow'));
    addHoverEffect(wsStatusBtn, async () => (connected && ttsConnected) ? await t('WebSocketConnected') : await t('WebSocketDisconnected'));
    addHoverEffect(voiceBtn, async () => pttVisible ? await t('DisableVoiceInput') : await t('EnableVoiceInput'));
    addHoverEffect(textBtn, async () => textInputVisible ? await t('DisableTextInput') : await t('EnableTextInput'));
    addHoverEffect(subtitleBtn, async () => isSubtitleEnabled ? await t('SubtitleEnabled') : await t('SubtitleDisabled'));
})();

setInterval(async () => {
  const i = wsStatusBtn.querySelector('i');
  let statusText = '';
  if (connected && ttsConnected) { i.style.color = '#28a745'; statusText = await t('WebSocketConnected'); }
  else { i.style.color = '#dc3545'; statusText = await t('WebSocketDisconnected'); }
  wsStatusBtn.dataset.title = statusText;
  if (isPanelHovered && tooltipContainer.style.opacity === '1' && customTooltip.textContent !== statusText && customTooltip.textContent.includes('服')) {
      customTooltip.textContent = statusText;
  }
}, 1000);

function setupHideModel() {
  app.view.addEventListener('mouseenter', () => {
    if (!isHidden) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { app.stage.alpha = 0.08; }, 300);
  });
  app.view.addEventListener('mouseleave', () => {
    if (!isHidden) return;
    clearTimeout(hideTimer);
    app.stage.alpha = 1;
  });
}

// ==================== Model Switching ====================
async function loadModelList() {
  try {
    const [dRes, uRes] = await Promise.all([fetch('/get_default_tha_models'), fetch('/get_user_tha_models')]);
    const dData = await dRes.json();
    const uData = await uRes.json();
    allModels = [...(dData.models || []), ...(uData.models || [])];
    if (allModels.length > 0) {
      const cfgRes = await fetch('/tha_config');
      const cfg = await cfgRes.json();
      const selId = cfg.THAConfig?.selectedModelId || allModels[0].id;
      currentModelIndex = allModels.findIndex(m => m.id === selId);
      if (currentModelIndex < 0) currentModelIndex = 0;
    }
    updateModelBtns();
  } catch (e) { console.error('Load models:', e); }
}
function updateModelBtns() {
  prevModelBtn.style.opacity = allModels.length > 1 ? '1' : '0.4';
  nextModelBtn.style.opacity = allModels.length > 1 ? '1' : '0.4';
}
async function switchModel(dir) {
  if (allModels.length < 2) return;
  currentModelIndex = ((currentModelIndex + dir) % allModels.length + allModels.length) % allModels.length;
  const model = allModels[currentModelIndex];
  showModelIndicator(model.name || model.id);
  try {
    await fetch('/tha_config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectedModelId: model.id }) });
    setTimeout(() => { disconnectRender(); connectRender(); }, 500);
  } catch (e) { hideModelIndicator(); }
}
function showModelIndicator(name) {
  let el = document.getElementById('model-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'model-indicator';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:#fff;padding:12px 24px;border-radius:12px;font-size:16px;z-index:9999;pointer-events:none;display:flex;align-items:center;gap:10px;backdrop-filter:blur(8px);';
    document.body.appendChild(el);
  }
  el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + name;
  el.style.display = 'flex';
  setTimeout(() => { el.style.transition = 'opacity 0.3s'; el.style.opacity = '0'; setTimeout(() => { el.style.display = 'none'; el.style.opacity = '1'; el.style.transition = ''; }, 300); }, 1500);
}
function hideModelIndicator() {
  const el = document.getElementById('model-indicator');
  if (el) el.style.display = 'none';
}

bindTapEvent(prevModelBtn, () => switchModel(-1));
bindTapEvent(nextModelBtn, () => switchModel(1));


// ==================== Subtitle Engine (对齐 3D 高级打字机) ====================
let fullTargetText = "";          
let currentVisibleCount = 0;      
let displayStartIndex = 0; 
const MAX_WINDOW_SIZE = 60;  
const OVERLAP_SIZE = 30;     
const SAFE_PUNC_LIST = /[，。！？；：、“”（）《》,.!?;:()]/; 

let typewriterTimer = null;       
let isAudioStreaming = false;
let isOmniMode = false;           
let subtitleTimeout = null;
let processedChunks = new Set(); 

function renderSubtitleUI(text) {
    if (!subtitleEl) return;
    if (!isSubtitleEnabled) return;
    subtitleEl.textContent = text;
    subtitleEl.style.opacity = '1';
}

function updateSubtitleAndRoll() {
    const currentDisplayLength = currentVisibleCount - displayStartIndex;
    if (currentDisplayLength > MAX_WINDOW_SIZE) {
        let targetStartIndex = currentVisibleCount - OVERLAP_SIZE;
        const lookbackRange = Math.floor(MAX_WINDOW_SIZE * 0.6); 
        const searchText = fullTargetText.slice(currentVisibleCount - lookbackRange, currentVisibleCount);
        let lastPuncIndex = -1;
        for (let i = searchText.length - 1; i >= 0; i--) {
            if (SAFE_PUNC_LIST.test(searchText[i])) { lastPuncIndex = i; break; }
        }
        if (lastPuncIndex !== -1) {
            const foundIndex = (currentVisibleCount - lookbackRange) + lastPuncIndex + 1;
            const newOverlap = currentVisibleCount - foundIndex;
            if (newOverlap >= 5 && newOverlap <= MAX_WINDOW_SIZE * 0.8) {
                targetStartIndex = foundIndex;
            }
        }
        displayStartIndex = targetStartIndex;
    }

    const displayText = fullTargetText.slice(displayStartIndex, currentVisibleCount);
    const prefix = displayStartIndex > 0 ? "..." : "";
    renderSubtitleUI(prefix + displayText);
}

function startTypewriterLoop() {
    if (typewriterTimer) return;
    let lastUpdateTime = performance.now();
    const CHARS_PER_SECOND = 10; 

    function typeTextOnly() {
        if (!isOmniMode) { typewriterTimer = null; return; }

        const now = performance.now();
        const elapsed = now - lastUpdateTime;
        const interval = 1000 / CHARS_PER_SECOND;
        
        if (elapsed >= interval) {
            if (currentVisibleCount < fullTargetText.length) {
                currentVisibleCount++;
                updateSubtitleAndRoll();
            }
            lastUpdateTime = now - (elapsed % interval);
        }

        if (currentVisibleCount >= fullTargetText.length && (!isAudioStreaming || (audioQueue.length === 0 && !isPlayingAudio))) {
            typewriterTimer = null;
            isOmniMode = false; 
            finalizeSpeech(false);
        } else {
            typewriterTimer = requestAnimationFrame(typeTextOnly);
        }
    }
    typewriterTimer = requestAnimationFrame(typeTextOnly);
}

function stopTypewriterLoop() {
    if (typewriterTimer) { cancelAnimationFrame(typewriterTimer); typewriterTimer = null; }
}

// 强制清空字幕
function clearSubtitle() {
    if (subtitleEl) {
        subtitleEl.style.transition = 'opacity 0.5s ease';
        subtitleEl.style.opacity = '0';
    }
}

function updateSubtitle(text) {
    if (!text.trim()) return;
    renderSubtitleUI(text);
}

function finalizeSpeech(immediate = false) {
    stopMouthTracking();
    resetEmotionToNeutral();
    if (immediate) {
        clearSubtitle();
        fullTargetText = "";
        currentVisibleCount = 0;
        displayStartIndex = 0;
    } else {
        if (subtitleTimeout) clearTimeout(subtitleTimeout);
        subtitleTimeout = setTimeout(() => {
            if (!isOmniMode && !typewriterTimer) {
                clearSubtitle();
                fullTargetText = "";
                currentVisibleCount = 0;
                displayStartIndex = 0;
            }
        }, 2000); 
    }
}

function resetEmotionToNeutral() {
    if (renderWs && renderWs.readyState === WebSocket.OPEN) {
        renderWs.send(JSON.stringify({ type: 'emotion', emotion: 'neutral' }));
        renderWs.send(JSON.stringify({ type: 'motionClear' }));
    }
}

function sendMotion(motionName) {
    if (renderWs && renderWs.readyState === WebSocket.OPEN) {
        renderWs.send(JSON.stringify({ type: 'motion', motion: motionName }));
    }
}

// ==================== TTS + Audio + Mouth Sync ====================
let audioQueue = [];
let isPlayingAudio = false;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// 核心唇律提取器：【对准 8Hz 经典说唱波段调制】
function startMouthTracking(source) {
  stopMouthTracking();
  const ctx = getAudioCtx();
  audioAnalyser = ctx.createAnalyser();
  audioAnalyser.fftSize = 512;
  audioAnalyser.smoothingTimeConstant = 0.0; // 绝对零残影，提供超清脆响应
  source.connect(audioAnalyser);

  const bufferLength = audioAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  const sampleRate = ctx.sampleRate;
  let lastSendTime = 0;

  function trackLoop() {
    if (!audioAnalyser) return;
    mouthTimer = requestAnimationFrame(trackLoop);

    const now = performance.now();
    // 🌟 发包频率匹配渲染帧率 ~30Hz，避免无效高频消息堆积
    if (now - lastSendTime < 33) return;

    audioAnalyser.getByteFrequencyData(dataArray);

    let vocalEnergy = 0;
    const startBin = Math.floor((200 / (sampleRate / 2)) * bufferLength);
    const endBin = Math.floor((3000 / (sampleRate / 2)) * bufferLength);
    for (let i = startBin; i < endBin; i++) vocalEnergy += dataArray[i];
    const avgVol = vocalEnergy / (endBin - startBin);

    let amp = 0;
    const NOISE_GATE = 12; 
    
    if (avgVol > NOISE_GATE) {
        const baseIntensity = Math.min(1.0, (avgVol - NOISE_GATE) / 35.0);
        
        // 🌟 引入 8Hz 二次正弦调制，强行制造高频颤动。
        // 这完美杜绝了声音持续发出“啊”长音时嘴巴呆滞定格的毛病！
        const modulation = 0.5 + 0.5 * Math.sin(now * 0.03); 
        amp = baseIntensity * (0.3 + 0.7 * modulation); // 限制振幅在 30% ~ 100% 极速颤动
        amp = Math.min(1.0, amp);
    }

    if (renderWs && renderWs.readyState === WebSocket.OPEN) {
      renderWs.send(JSON.stringify({ type: 'mouth', amplitude: amp.toFixed(3) }));
      lastSendTime = now;
    }
  }
  trackLoop();
}

function stopMouthTracking() {
  if (mouthTimer) { cancelAnimationFrame(mouthTimer); mouthTimer = null; }
  if (renderWs && renderWs.readyState === WebSocket.OPEN) {
    renderWs.send(JSON.stringify({ type: 'mouth', amplitude: 0 }));
  }
  if (audioAnalyser) { audioAnalyser.disconnect(); audioAnalyser = null; }
}

function haltCurrentAudio() {
  audioQueue = [];
  isPlayingAudio = false;
  if (audioCtx) {
      audioCtx.suspend().then(() => audioCtx.close());
      audioCtx = null;
  }
  stopMouthTracking();
}

async function processAudioQueue() {
  if (audioQueue.length === 0) {
      isPlayingAudio = false;
      if (!isAudioStreaming && !isOmniMode) {
          finalizeSpeech(false);
      }
      return;
  }
  isPlayingAudio = true;
  const { audioBytes, meta } = audioQueue.shift();
  await playAudioChunk(audioBytes, meta);
  processAudioQueue();
}

function playAudioChunk(audioBytes, meta) {
  return new Promise(async (resolve) => {
      const ctx = getAudioCtx();
      const arrayBuffer = audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength);
      
      let audioBuffer;
      try {
          audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      } catch (e) {
          console.error("Decode error", e);
          return resolve();
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      // 声音延迟 150ms 匹配渲染时间，硬件级锁同步
      const delayNode = ctx.createDelay();
      delayNode.delayTime.value = 0.15; 

      source.connect(delayNode);
      delayNode.connect(ctx.destination);

      startMouthTracking(source);
      source.start(0);

      if (meta && meta.text && !isOmniMode) {
          updateSubtitle(meta.text);
      }

      source.onended = () => {
          stopMouthTracking();
          source.disconnect();
          delayNode.disconnect();
          resolve(); 
      };
  });
}

function handleTTSBinary(buffer) {
  if (buffer.byteLength < 4) return;
  const view = new DataView(buffer);
  const jsonLen = view.getUint32(0, true);
  if (buffer.byteLength < 4 + jsonLen) return;
  const jsonBytes = new Uint8Array(buffer, 4, jsonLen);
  const audioBytes = new Uint8Array(buffer, 4 + jsonLen);
  
  try {
    const meta = JSON.parse(new TextDecoder().decode(jsonBytes));
    
    // 🌟 添加去重逻辑：拦截前端因为状态同步而产生的重复音频分片
    if (meta.chunkIndex !== undefined) {
        if (processedChunks.has(meta.chunkIndex)) return;
        processedChunks.add(meta.chunkIndex);
    }
    
    if (audioBytes.length > 0) {
       audioQueue.push({ audioBytes, meta });
       if (!isPlayingAudio) {
           processAudioQueue();
       }
    }
  } catch (err) {}
}


function connectTTS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ttsWs = new WebSocket(`${protocol}//${window.location.host}/ws/vrm`);
  ttsWs.onopen = () => { ttsConnected = true; };
  ttsWs.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) return handleTTSBinary(e.data);
    if (e.data instanceof Blob) return e.data.arrayBuffer().then(handleTTSBinary);
    try { handleTTSMessage(JSON.parse(e.data)); } catch (err) {}
  };
  ttsWs.onclose = () => { ttsConnected = false; haltCurrentAudio(); setTimeout(connectTTS, 3000); };
  ttsWs.onerror = () => ttsWs.close();
}

function handleTTSMessage(msg) {
  const type = msg.type, data = msg.data || {};
  
  if (type === 'ttsStarted' || type === 'stopSpeaking') {
      isOmniMode = false;
      isAudioStreaming = false;
      fullTargetText = "";
      currentVisibleCount = 0;
      displayStartIndex = 0;
      stopTypewriterLoop();
      haltCurrentAudio();
      
      processedChunks.clear(); // 🌟 清理已播放的音频块记录，防止历史记录重放失败
      
      if (type === 'stopSpeaking') finalizeSpeech(true);
      else clearSubtitle();
  }
  else if (type === 'omniStreaming') {
      if (!isOmniMode || (data.text && data.text.length < fullTargetText.length)) {
         fullTargetText = "";
         currentVisibleCount = 0;
         displayStartIndex = 0;
         stopTypewriterLoop();
         clearSubtitle();
      }
      isOmniMode = true;
      isAudioStreaming = true;
      if (data.text) fullTargetText = data.text;
      startTypewriterLoop();
  }
  else if (type === 'allChunksCompleted') {
      isAudioStreaming = false;
  }
}

function disconnectTTS() {
  if (ttsWs) { ttsWs.onclose = null; ttsWs.close(); ttsWs = null; }
  ttsConnected = false;
  haltCurrentAudio();
}

// ==================== Voice PTT ====================
function initPttWs() {
  if (pttWs && pttWs.readyState === WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  pttWs = new WebSocket(`${protocol}//${window.location.host}/ws`);
  pttWs.onclose = () => setTimeout(initPttWs, 3000);
}

pttBtn.addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  if (recording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      pttBtn.classList.remove('recording');
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const wav = await encodeWav(blob);
      initPttWs();
      const check = () => {
        if (pttWs && pttWs.readyState === WebSocket.OPEN) {
          pttWs.send(JSON.stringify({ type: 'asr_audio', audio: wav }));
        } else setTimeout(check, 200);
      };
      check();
      recording = false;
    };
    mediaRecorder.start();
    pttBtn.classList.add('recording');
    recording = true;
  } catch (err) { recording = false; }
});
pttBtn.addEventListener('pointerup', () => { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); });
pttBtn.addEventListener('pointerleave', () => { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); });

async function encodeWav(blob) {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const len = buf.length;
  const wav = new ArrayBuffer(44 + len * 2);
  const v = new DataView(wav);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, len * 2, true);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, ch[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); }
  const bytes = new Uint8Array(wav);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ==================== Text Input ====================
function sendTextMessage() {
  const text = textField.value.trim();
  if (!text) return;
  initPttWs();
  const check = () => {
    if (pttWs && pttWs.readyState === WebSocket.OPEN) {
      pttWs.send(JSON.stringify({ type: 'set_user_input', data: { text } }));
      pttWs.send(JSON.stringify({ type: 'trigger_send_message' }));
    } else setTimeout(check, 200);
  };
  check();
  textField.value = '';
}
bindTapEvent(sendBtn, sendTextMessage);
textField.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTextMessage(); });

// ==================== Init ====================
try {
  initPixi();
} catch (e) {
  console.error('[THA] PixiJS init failed:', e);
  app = null;
}
if (app) {
  setupHideModel();
}
SR.init().then(async () => {
  try {
    const res = await fetch('/tha_config');
    const cfg = await res.json();
    const mode = cfg.THAConfig?.srMode || 'cnnx2vl';
    if (mode === 'off' || SR.method === 'none') {
      console.log('[SR] 配置: 关闭 (mode=' + mode + ', method=' + SR.method + ')');
    } else {
      SR.mode = mode;
      SR.setEnabled(true);
      console.log('[SR] 配置已启用 -> ' + SR.getLabel());
    }
  } catch (e) {
    if (SR.method !== 'none') {
      SR.setEnabled(true);
      console.log('[SR] 无法读取配置，默认启用 CNNx2VL');
    }
  }
});
connectRender();
connectTTS();
loadModelList();