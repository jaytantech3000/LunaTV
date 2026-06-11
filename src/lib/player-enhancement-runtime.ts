import { PlayerEnhancementPreferences } from '@/lib/player-enhancements';

type VideoFrameRequestHandle = number;

type VideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: unknown) => void
  ) => VideoFrameRequestHandle;
  cancelVideoFrameCallback?: (handle: VideoFrameRequestHandle) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeDisconnect(node: AudioNode | null | undefined) {
  if (!node) {
    return;
  }

  try {
    node.disconnect();
  } catch (_) {
    // Ignore redundant disconnect attempts.
  }
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

class AudioSpikeProtectionController {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private outputGainNode: GainNode | null = null;
  private analysisBuffer: Float32Array | null = null;
  private monitorTimerId: number | null = null;
  private baselineDb: number | null = null;
  private enabled = false;
  private documentListenersBound = false;
  private graphInitialized = false;

  private readonly handlePlay = () => {
    if (this.graphInitialized) {
      void this.resumeContext();
      return;
    }

    if (this.enabled) {
      void this.initializeEnabledGraph();
    }
  };

  private readonly handleFirstInteraction = () => {
    if (!this.enabled || this.graphInitialized) {
      return;
    }

    void this.initializeEnabledGraph();
  };

  private readonly handleLoadedData = () => {
    this.baselineDb = null;
  };

  constructor(private readonly video: HTMLVideoElement) {}

  private async ensureGraphReady(): Promise<boolean> {
    if (this.graphInitialized) {
      return true;
    }

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      return false;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContextConstructor();
    }

    await this.resumeContext();

    if (this.audioContext.state !== 'running') {
      return false;
    }

    if (!this.sourceNode) {
      this.sourceNode = this.audioContext.createMediaElementSource(this.video);
    }

    if (!this.analyserNode) {
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.82;
      this.analysisBuffer = new Float32Array(this.analyserNode.fftSize);
    }

    if (!this.compressorNode) {
      this.compressorNode = this.audioContext.createDynamicsCompressor();
      this.compressorNode.threshold.value = -20;
      this.compressorNode.knee.value = 20;
      this.compressorNode.ratio.value = 5.5;
      this.compressorNode.attack.value = 0.004;
      this.compressorNode.release.value = 0.28;
    }

    if (!this.outputGainNode) {
      this.outputGainNode = this.audioContext.createGain();
      this.outputGainNode.gain.value = 1;
    }

    this.graphInitialized = true;
    return true;
  }

  private bindDocumentListeners() {
    if (this.documentListenersBound || typeof document === 'undefined') {
      return;
    }

    document.addEventListener('pointerdown', this.handleFirstInteraction);
    document.addEventListener('keydown', this.handleFirstInteraction);
    document.addEventListener('touchstart', this.handleFirstInteraction, {
      passive: true,
    });
    this.documentListenersBound = true;
  }

  private unbindDocumentListeners() {
    if (!this.documentListenersBound || typeof document === 'undefined') {
      return;
    }

    document.removeEventListener('pointerdown', this.handleFirstInteraction);
    document.removeEventListener('keydown', this.handleFirstInteraction);
    document.removeEventListener('touchstart', this.handleFirstInteraction);
    this.documentListenersBound = false;
  }

  private reconnectGraph(enabled: boolean) {
    if (
      !this.audioContext ||
      !this.sourceNode ||
      !this.analyserNode ||
      !this.compressorNode ||
      !this.outputGainNode
    ) {
      return;
    }

    safeDisconnect(this.sourceNode);
    safeDisconnect(this.compressorNode);
    safeDisconnect(this.outputGainNode);
    safeDisconnect(this.analyserNode);

    this.sourceNode.connect(this.analyserNode);

    if (enabled) {
      this.sourceNode.connect(this.compressorNode);
      this.compressorNode.connect(this.outputGainNode);
      this.outputGainNode.connect(this.audioContext.destination);
    } else {
      this.sourceNode.connect(this.audioContext.destination);
    }
  }

  private async initializeEnabledGraph() {
    const ready = await this.ensureGraphReady();
    if (!ready) {
      this.bindDocumentListeners();
      return;
    }

    this.unbindDocumentListeners();
    this.reconnectGraph(true);
    this.startMonitoring();
  }

  private startMonitoring() {
    if (
      this.monitorTimerId !== null ||
      !this.enabled ||
      !this.analyserNode ||
      !this.analysisBuffer ||
      !this.audioContext ||
      !this.outputGainNode
    ) {
      return;
    }

    this.monitorTimerId = window.setInterval(() => {
      if (
        !this.analyserNode ||
        !this.analysisBuffer ||
        !this.audioContext ||
        !this.outputGainNode
      ) {
        return;
      }

      this.analyserNode.getFloatTimeDomainData(this.analysisBuffer);

      let sum = 0;
      let peak = 0;
      for (let index = 0; index < this.analysisBuffer.length; index += 1) {
        const sample = this.analysisBuffer[index];
        const absolute = Math.abs(sample);
        sum += sample * sample;
        if (absolute > peak) {
          peak = absolute;
        }
      }

      const rms = Math.sqrt(sum / this.analysisBuffer.length);
      const rmsDb = 20 * Math.log10(Math.max(rms, 0.0001));
      const peakDb = 20 * Math.log10(Math.max(peak, 0.0001));
      const referenceDb = Math.max(rmsDb, peakDb - 3);

      if (this.baselineDb === null) {
        this.baselineDb = referenceDb;
      } else {
        const smoothing = referenceDb > this.baselineDb ? 0.04 : 0.16;
        this.baselineDb =
          this.baselineDb + (referenceDb - this.baselineDb) * smoothing;
      }

      const deltaDb = referenceDb - this.baselineDb;
      const targetReductionDb = clamp((deltaDb - 6) * 0.9, 0, 12);
      const targetGain = Math.pow(10, -targetReductionDb / 20);
      const now = this.audioContext.currentTime;

      this.outputGainNode.gain.cancelScheduledValues(now);
      this.outputGainNode.gain.setTargetAtTime(
        targetGain,
        now,
        targetReductionDb > 0 ? 0.05 : 0.28
      );
    }, 120);
  }

  private stopMonitoring() {
    if (this.monitorTimerId !== null) {
      window.clearInterval(this.monitorTimerId);
      this.monitorTimerId = null;
    }

    this.baselineDb = null;

    if (this.audioContext && this.outputGainNode) {
      const now = this.audioContext.currentTime;
      this.outputGainNode.gain.cancelScheduledValues(now);
      this.outputGainNode.gain.setValueAtTime(
        this.outputGainNode.gain.value,
        now
      );
      this.outputGainNode.gain.linearRampToValueAtTime(1, now + 0.08);
    }
  }

  private async resumeContext() {
    if (!this.audioContext || this.audioContext.state === 'running') {
      return;
    }

    try {
      await this.audioContext.resume();
    } catch (_) {
      // Some browsers still require another explicit user gesture.
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;

    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('loadeddata', this.handleLoadedData);

    if (!enabled) {
      this.unbindDocumentListeners();
      this.stopMonitoring();

      if (this.graphInitialized) {
        this.reconnectGraph(false);
      }

      return;
    }

    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('loadeddata', this.handleLoadedData);

    if (!this.video.paused) {
      void this.initializeEnabledGraph();
      return;
    }

    this.bindDocumentListeners();
  }

  dispose() {
    this.enabled = false;
    this.stopMonitoring();
    this.unbindDocumentListeners();
    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('loadeddata', this.handleLoadedData);

    safeDisconnect(this.sourceNode);
    safeDisconnect(this.analyserNode);
    safeDisconnect(this.compressorNode);
    safeDisconnect(this.outputGainNode);

    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
    }

    this.sourceNode = null;
    this.analyserNode = null;
    this.compressorNode = null;
    this.outputGainNode = null;
    this.audioContext = null;
    this.analysisBuffer = null;
    this.graphInitialized = false;
  }
}

interface VisualEnhancementGlContext {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  positionBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
  positionLocation: number;
  texCoordLocation: number;
  texelSizeLocation: WebGLUniformLocation;
}

function buildVisualEnhancementVertexShader() {
  return `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;
}

function buildVisualEnhancementFragmentShader() {
  return `
    precision mediump float;

    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_texelSize;

    void main() {
      vec3 center = texture2D(u_texture, v_texCoord).rgb;
      vec3 left = texture2D(u_texture, v_texCoord + vec2(-u_texelSize.x, 0.0)).rgb;
      vec3 right = texture2D(u_texture, v_texCoord + vec2(u_texelSize.x, 0.0)).rgb;
      vec3 up = texture2D(u_texture, v_texCoord + vec2(0.0, -u_texelSize.y)).rgb;
      vec3 down = texture2D(u_texture, v_texCoord + vec2(0.0, u_texelSize.y)).rgb;

      vec3 blur = (center + left + right + up + down) / 5.0;
      vec3 sharpened = clamp(center + (center - blur) * 0.78, 0.0, 1.0);

      float luma = dot(sharpened, vec3(0.299, 0.587, 0.114));
      float maxChannel = max(sharpened.r, max(sharpened.g, sharpened.b));
      float minChannel = min(sharpened.r, min(sharpened.g, sharpened.b));
      float saturation = maxChannel - minChannel;

      float highlightMask = smoothstep(0.72, 0.98, luma);
      vec3 toned = mix(
        sharpened,
        sharpened * vec3(0.98, 0.95, 0.92),
        highlightMask * 0.6
      );

      float skinMask =
        smoothstep(0.03, 0.18, toned.r - toned.b) *
        smoothstep(0.52, 0.88, luma) *
        (1.0 - smoothstep(0.08, 0.28, saturation));

      toned = mix(toned, toned * vec3(1.03, 0.99, 0.95), skinMask * 0.45);

      float tonedLuma = dot(toned, vec3(0.299, 0.587, 0.114));
      vec3 lumaColor = vec3(tonedLuma);
      vec3 corrected = clamp(mix(lumaColor, toned, 1.08), 0.0, 1.0);

      gl_FragColor = vec4(corrected, 1.0);
    }
  `;
}

function compileShader(
  gl: WebGLRenderingContext,
  shaderType: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(shaderType);
  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }

  gl.deleteShader(shader);
  return null;
}

function createVisualEnhancementGlContext(
  canvas: HTMLCanvasElement
): VisualEnhancementGlContext | null {
  const gl =
    (canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null) ||
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

  if (!gl) {
    return null;
  }

  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    buildVisualEnhancementVertexShader()
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    buildVisualEnhancementFragmentShader()
  );

  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const texture = gl.createTexture();
  const positionBuffer = gl.createBuffer();
  const texCoordBuffer = gl.createBuffer();
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
  const texelSizeLocation = gl.getUniformLocation(program, 'u_texelSize');

  if (
    !texture ||
    !positionBuffer ||
    !texCoordBuffer ||
    positionLocation < 0 ||
    texCoordLocation < 0 ||
    !texelSizeLocation
  ) {
    if (texture) {
      gl.deleteTexture(texture);
    }
    if (positionBuffer) {
      gl.deleteBuffer(positionBuffer);
    }
    if (texCoordBuffer) {
      gl.deleteBuffer(texCoordBuffer);
    }
    gl.deleteProgram(program);
    return null;
  }

  gl.useProgram(program);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

  return {
    gl,
    program,
    texture,
    positionBuffer,
    texCoordBuffer,
    positionLocation,
    texCoordLocation,
    texelSizeLocation,
  };
}

class VisualEnhancementController {
  private canvas: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;
  private glContext: VisualEnhancementGlContext | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;
  private videoFrameCallbackHandle: VideoFrameRequestHandle | null = null;
  private enabled = false;
  private lastWidth = 0;
  private lastHeight = 0;
  private previousVideoOpacity = '';

  private readonly handlePlay = () => {
    this.startRendering();
  };

  private readonly handlePause = () => {
    this.stopRendering();
    this.renderFrame();
  };

  private readonly handleSeeked = () => {
    this.renderFrame();
  };

  private readonly handleLoadedData = () => {
    this.renderFrame();
  };

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly host: HTMLElement
  ) {}

  private ensureCanvas(): boolean {
    if (this.canvas) {
      return true;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'pointer-events-none absolute inset-0 h-full w-full';
    canvas.style.zIndex = '1';
    canvas.style.borderRadius = 'inherit';

    const glContext = createVisualEnhancementGlContext(canvas);
    const canvasContext = glContext
      ? null
      : canvas.getContext('2d', {
          alpha: false,
          desynchronized: true,
        });

    if (!glContext && !canvasContext) {
      return false;
    }

    this.host.appendChild(canvas);
    this.canvas = canvas;
    this.glContext = glContext;
    this.canvasContext = canvasContext;
    this.previousVideoOpacity = this.video.style.opacity;
    this.video.style.opacity = '0';
    this.video.style.willChange = 'opacity';
    this.observeResize();

    return true;
  }

  private observeResize() {
    if (typeof ResizeObserver === 'undefined' || this.resizeObserver) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.renderFrame();
    });
    this.resizeObserver.observe(this.host);
  }

  private resizeCanvas() {
    if (!this.canvas) {
      return;
    }

    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }

    const devicePixelRatio =
      typeof window === 'undefined'
        ? 1
        : Math.min(window.devicePixelRatio || 1, 1.5);
    const nextWidth = Math.max(1, Math.round(width * devicePixelRatio));
    const nextHeight = Math.max(1, Math.round(height * devicePixelRatio));

    if (this.lastWidth === nextWidth && this.lastHeight === nextHeight) {
      return;
    }

    this.lastWidth = nextWidth;
    this.lastHeight = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;

    if (this.glContext) {
      this.glContext.gl.viewport(0, 0, nextWidth, nextHeight);
    }
  }

  private renderWebGlFrame() {
    if (!this.canvas || !this.glContext) {
      return;
    }

    const { gl, texture, texelSizeLocation } = this.glContext;
    gl.useProgram(this.glContext.program);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.video
    );
    gl.uniform2f(
      texelSizeLocation,
      1 / Math.max(this.canvas.width, 1),
      1 / Math.max(this.canvas.height, 1)
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private render2dFrame() {
    if (!this.canvas || !this.canvasContext) {
      return;
    }

    const context = this.canvasContext;
    const width = this.canvas.width;
    const height = this.canvas.height;

    context.save();
    context.clearRect(0, 0, width, height);
    context.filter = 'contrast(1.1) saturate(0.92) brightness(0.96)';
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.drawImage(this.video, 0, 0, width, height);

    context.filter = 'contrast(1.35) saturate(0.88) brightness(0.98)';
    context.globalCompositeOperation = 'overlay';
    context.globalAlpha = 0.18;
    context.drawImage(this.video, 0, 0, width, height);

    context.filter = 'sepia(0.08) contrast(1.08)';
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 0.12;
    context.drawImage(this.video, 0, 0, width, height);

    context.restore();
  }

  private renderFrame() {
    if (
      !this.enabled ||
      !this.canvas ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    this.resizeCanvas();

    try {
      if (this.glContext) {
        this.renderWebGlFrame();
      } else {
        this.render2dFrame();
      }
    } catch (_) {
      this.disableInternal();
    }
  }

  private scheduleNextFrame() {
    if (!this.enabled) {
      return;
    }

    const videoWithFrameCallback = this.video as VideoElementWithFrameCallback;
    if (
      typeof videoWithFrameCallback.requestVideoFrameCallback === 'function'
    ) {
      this.videoFrameCallbackHandle =
        videoWithFrameCallback.requestVideoFrameCallback(() => {
          this.videoFrameCallbackHandle = null;
          this.renderFrame();
          if (this.enabled && !this.video.paused && !this.video.ended) {
            this.scheduleNextFrame();
          }
        });
      return;
    }

    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.renderFrame();
      if (this.enabled && !this.video.paused && !this.video.ended) {
        this.scheduleNextFrame();
      }
    });
  }

  private startRendering() {
    if (
      !this.enabled ||
      this.animationFrameId !== null ||
      this.videoFrameCallbackHandle !== null
    ) {
      return;
    }

    this.renderFrame();
    this.scheduleNextFrame();
  }

  private stopRendering() {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.videoFrameCallbackHandle !== null) {
      const videoWithFrameCallback = this
        .video as VideoElementWithFrameCallback;
      if (
        typeof videoWithFrameCallback.cancelVideoFrameCallback === 'function'
      ) {
        videoWithFrameCallback.cancelVideoFrameCallback(
          this.videoFrameCallbackHandle
        );
      }
      this.videoFrameCallbackHandle = null;
    }
  }

  private disableInternal() {
    this.stopRendering();
    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('pause', this.handlePause);
    this.video.removeEventListener('seeked', this.handleSeeked);
    this.video.removeEventListener('loadeddata', this.handleLoadedData);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.canvas) {
      this.canvas.remove();
    }

    if (this.glContext) {
      const { gl, texture, positionBuffer, texCoordBuffer, program } =
        this.glContext;
      gl.deleteTexture(texture);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(texCoordBuffer);
      gl.deleteProgram(program);
    }

    this.canvas = null;
    this.canvasContext = null;
    this.glContext = null;
    this.video.style.opacity = this.previousVideoOpacity;
    this.video.style.willChange = '';
    this.lastWidth = 0;
    this.lastHeight = 0;
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) {
      if (enabled) {
        this.renderFrame();
      }
      return;
    }

    this.enabled = enabled;

    if (!enabled) {
      this.disableInternal();
      return;
    }

    if (!this.ensureCanvas()) {
      this.enabled = false;
      return;
    }

    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('pause', this.handlePause);
    this.video.addEventListener('seeked', this.handleSeeked);
    this.video.addEventListener('loadeddata', this.handleLoadedData);

    if (this.video.paused) {
      this.renderFrame();
      return;
    }

    this.startRendering();
  }

  dispose() {
    this.enabled = false;
    this.disableInternal();
  }
}

export class PlayerEnhancementManager {
  private video: HTMLVideoElement | null = null;
  private host: HTMLElement | null = null;
  private audioController: AudioSpikeProtectionController | null = null;
  private visualController: VisualEnhancementController | null = null;
  private preferences: PlayerEnhancementPreferences = {
    audioSpikeProtectionEnabled: false,
    visualEnhancementEnabled: false,
  };

  bind(video: HTMLVideoElement | null, host: HTMLElement | null) {
    if (!video || !host) {
      this.dispose();
      return;
    }

    if (this.video === video && this.host === host) {
      this.sync();
      return;
    }

    this.dispose();

    this.video = video;
    this.host = host;
    this.audioController = new AudioSpikeProtectionController(video);
    this.visualController = new VisualEnhancementController(video, host);
    this.sync();
  }

  setPreferences(preferences: PlayerEnhancementPreferences) {
    this.preferences = preferences;
    this.sync();
  }

  private sync() {
    this.audioController?.setEnabled(
      this.preferences.audioSpikeProtectionEnabled
    );
    this.visualController?.setEnabled(
      this.preferences.visualEnhancementEnabled
    );
  }

  dispose() {
    this.audioController?.dispose();
    this.visualController?.dispose();
    this.audioController = null;
    this.visualController = null;
    this.video = null;
    this.host = null;
  }
}
