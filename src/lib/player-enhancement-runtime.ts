import {
  AudioSpikeProtectionLevel,
  VisualEnhancementLevel,
} from '@/lib/player-enhancement-types';
import {
  isAudioSpikeProtectionActive,
  isVisualEnhancementActive,
  PlayerEnhancementPreferences,
} from '@/lib/player-enhancements';

type VideoFrameRequestHandle = number;

type VideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: unknown) => void
  ) => VideoFrameRequestHandle;
  cancelVideoFrameCallback?: (handle: VideoFrameRequestHandle) => void;
};

interface AudioSpikeProtectionLevelConfig {
  triggerMarginDb: number;
  deltaRatio: number;
  maxReductionDb: number;
  ceilingDb: number;
  baselineRise: number;
  baselineFall: number;
  attackTime: number;
  releaseTime: number;
  compressorThreshold: number;
  compressorKnee: number;
  compressorRatio: number;
  compressorAttack: number;
  compressorRelease: number;
  monitorIntervalMs: number;
}

export interface AudioSpikeProtectionStatus {
  level: AudioSpikeProtectionLevel;
  inputDb: number | null;
  currentDb: number | null;
  baselineDb: number | null;
  ceilingDb: number | null;
  reductionDb: number;
  limited: boolean;
}

export interface PlayerEnhancementManagerOptions {
  onAudioStatusChange?: (status: AudioSpikeProtectionStatus) => void;
}

export interface AspectFitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const AUDIO_SPIKE_PROTECTION_LEVEL_CONFIG: Record<
  Exclude<AudioSpikeProtectionLevel, 'off'>,
  AudioSpikeProtectionLevelConfig
> = {
  light: {
    triggerMarginDb: 4.8,
    deltaRatio: 1.6,
    maxReductionDb: 18,
    ceilingDb: -6.5,
    baselineRise: 0.022,
    baselineFall: 0.12,
    attackTime: 0.012,
    releaseTime: 0.22,
    compressorThreshold: -24,
    compressorKnee: 12,
    compressorRatio: 10,
    compressorAttack: 0.0028,
    compressorRelease: 0.18,
    monitorIntervalMs: 72,
  },
  standard: {
    triggerMarginDb: 3.6,
    deltaRatio: 2.05,
    maxReductionDb: 24,
    ceilingDb: -8.5,
    baselineRise: 0.018,
    baselineFall: 0.1,
    attackTime: 0.008,
    releaseTime: 0.16,
    compressorThreshold: -28,
    compressorKnee: 8,
    compressorRatio: 16,
    compressorAttack: 0.0016,
    compressorRelease: 0.14,
    monitorIntervalMs: 48,
  },
  strong: {
    triggerMarginDb: 2.9,
    deltaRatio: 2.55,
    maxReductionDb: 30,
    ceilingDb: -10.5,
    baselineRise: 0.014,
    baselineFall: 0.085,
    attackTime: 0.004,
    releaseTime: 0.12,
    compressorThreshold: -32,
    compressorKnee: 6,
    compressorRatio: 22,
    compressorAttack: 0.001,
    compressorRelease: 0.1,
    monitorIntervalMs: 32,
  },
};

const VISUAL_ENHANCEMENT_LEVEL_INTENSITY: Record<
  Exclude<VisualEnhancementLevel, 'off'>,
  number
> = {
  light: 0.38,
  standard: 0.68,
  strong: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function measureAudioBufferLevels(buffer: Float32Array): {
  rmsDb: number;
  peakDb: number;
} {
  let sum = 0;
  let peak = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const sample = buffer[index];
    const absolute = Math.abs(sample);
    sum += sample * sample;
    if (absolute > peak) {
      peak = absolute;
    }
  }

  const rms = Math.sqrt(sum / buffer.length);
  return {
    rmsDb: 20 * Math.log10(Math.max(rms, 0.00001)),
    peakDb: 20 * Math.log10(Math.max(peak, 0.00001)),
  };
}

export function buildHardLimiterCurve(
  ceilingDb: number,
  resolution = 4096
): Float32Array {
  const safeResolution = Math.max(3, Math.trunc(resolution));
  const limit = clamp(dbToLinear(ceilingDb), 0.01, 1);
  const curve = new Float32Array(safeResolution);
  const lastIndex = safeResolution - 1;

  for (let index = 0; index <= lastIndex; index += 1) {
    const input = (index / lastIndex) * 2 - 1;
    curve[index] = clamp(input, -limit, limit);
  }

  return curve;
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

function buildAudioSpikeProtectionStatus(
  level: AudioSpikeProtectionLevel = 'off',
  overrides: Partial<AudioSpikeProtectionStatus> = {}
): AudioSpikeProtectionStatus {
  return {
    level,
    inputDb: null,
    currentDb: null,
    baselineDb: null,
    ceilingDb:
      level === 'off'
        ? null
        : AUDIO_SPIKE_PROTECTION_LEVEL_CONFIG[level].ceilingDb,
    reductionDb: 0,
    limited: false,
    ...overrides,
  };
}

function getAudioSpikeProtectionLevelConfig(
  level: AudioSpikeProtectionLevel
): AudioSpikeProtectionLevelConfig | null {
  return level === 'off' ? null : AUDIO_SPIKE_PROTECTION_LEVEL_CONFIG[level];
}

function getVisualEnhancementIntensity(level: VisualEnhancementLevel): number {
  return level === 'off' ? 0 : VISUAL_ENHANCEMENT_LEVEL_INTENSITY[level];
}

export function calculateAspectFitRect(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number
): AspectFitRect {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return {
      x: 0,
      y: 0,
      width: Math.max(0, containerWidth),
      height: Math.max(0, containerHeight),
    };
  }

  const scale = Math.min(
    containerWidth / sourceWidth,
    containerHeight / sourceHeight
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

class AudioSpikeProtectionController {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private inputAnalyserNode: AnalyserNode | null = null;
  private outputAnalyserNode: AnalyserNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private limiterNode: WaveShaperNode | null = null;
  private outputGainNode: GainNode | null = null;
  private inputAnalysisBuffer: Float32Array | null = null;
  private outputAnalysisBuffer: Float32Array | null = null;
  private monitorTimerId: number | null = null;
  private baselineDb: number | null = null;
  private level: AudioSpikeProtectionLevel = 'off';
  private lastReductionDb = 0;
  private lastStatus: AudioSpikeProtectionStatus =
    buildAudioSpikeProtectionStatus();
  private documentListenersBound = false;
  private graphInitialized = false;

  private readonly handlePlay = () => {
    if (this.graphInitialized) {
      void this.resumeContext();
      return;
    }

    if (isAudioSpikeProtectionActive(this.level)) {
      void this.initializeEnabledGraph();
    }
  };

  private readonly handleFirstInteraction = () => {
    if (!isAudioSpikeProtectionActive(this.level) || this.graphInitialized) {
      return;
    }

    void this.initializeEnabledGraph();
  };

  private readonly handleLoadedData = () => {
    this.baselineDb = null;
    this.lastReductionDb = 0;
    this.emitStatus({
      inputDb: null,
      baselineDb: null,
      reductionDb: 0,
      limited: false,
    });
  };

  constructor(
    private readonly video: HTMLVideoElement,
    private onStatusChange?: (status: AudioSpikeProtectionStatus) => void
  ) {
    this.emitStatus({});
  }

  private emitStatus(overrides: Partial<AudioSpikeProtectionStatus>) {
    const nextStatus = buildAudioSpikeProtectionStatus(this.level, overrides);
    this.lastStatus = nextStatus;
    this.onStatusChange?.(nextStatus);
  }

  setStatusListener(listener?: (status: AudioSpikeProtectionStatus) => void) {
    this.onStatusChange = listener;
    listener?.(this.lastStatus);
  }

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

    if (!this.inputAnalyserNode) {
      this.inputAnalyserNode = this.audioContext.createAnalyser();
      this.inputAnalyserNode.fftSize = 2048;
      this.inputAnalyserNode.smoothingTimeConstant = 0.72;
      this.inputAnalysisBuffer = new Float32Array(
        this.inputAnalyserNode.fftSize
      );
    }

    if (!this.outputAnalyserNode) {
      this.outputAnalyserNode = this.audioContext.createAnalyser();
      this.outputAnalyserNode.fftSize = 2048;
      this.outputAnalyserNode.smoothingTimeConstant = 0.58;
      this.outputAnalysisBuffer = new Float32Array(
        this.outputAnalyserNode.fftSize
      );
    }

    if (!this.compressorNode) {
      this.compressorNode = this.audioContext.createDynamicsCompressor();
    }

    if (!this.limiterNode) {
      this.limiterNode = this.audioContext.createWaveShaper();
      this.limiterNode.oversample = '4x';
    }

    if (!this.outputGainNode) {
      this.outputGainNode = this.audioContext.createGain();
      this.outputGainNode.gain.value = 1;
    }

    this.graphInitialized = true;
    return true;
  }

  private applyLevelConfig() {
    const config = getAudioSpikeProtectionLevelConfig(this.level);
    if (!config || !this.compressorNode || !this.limiterNode) {
      return;
    }

    this.compressorNode.threshold.value = config.compressorThreshold;
    this.compressorNode.knee.value = config.compressorKnee;
    this.compressorNode.ratio.value = config.compressorRatio;
    this.compressorNode.attack.value = config.compressorAttack;
    this.compressorNode.release.value = config.compressorRelease;
    this.limiterNode.curve = buildHardLimiterCurve(config.ceilingDb);
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
      !this.inputAnalyserNode ||
      !this.outputAnalyserNode ||
      !this.compressorNode ||
      !this.limiterNode ||
      !this.outputGainNode
    ) {
      return;
    }

    safeDisconnect(this.sourceNode);
    safeDisconnect(this.inputAnalyserNode);
    safeDisconnect(this.outputAnalyserNode);
    safeDisconnect(this.compressorNode);
    safeDisconnect(this.limiterNode);
    safeDisconnect(this.outputGainNode);

    if (enabled) {
      this.sourceNode.connect(this.inputAnalyserNode);
      this.inputAnalyserNode.connect(this.compressorNode);
      this.compressorNode.connect(this.outputGainNode);
      this.outputGainNode.connect(this.limiterNode);
      this.limiterNode.connect(this.outputAnalyserNode);
      this.outputAnalyserNode.connect(this.audioContext.destination);
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
    this.applyLevelConfig();
    this.reconnectGraph(true);
    this.startMonitoring();
  }

  private runMonitorTick() {
    const config = getAudioSpikeProtectionLevelConfig(this.level);
    if (
      !config ||
      !this.inputAnalyserNode ||
      !this.inputAnalysisBuffer ||
      !this.outputAnalyserNode ||
      !this.outputAnalysisBuffer ||
      !this.audioContext ||
      !this.outputGainNode ||
      !this.compressorNode
    ) {
      return;
    }

    this.inputAnalyserNode.getFloatTimeDomainData(this.inputAnalysisBuffer);
    const { rmsDb, peakDb: inputPeakDb } = measureAudioBufferLevels(
      this.inputAnalysisBuffer
    );
    const referenceDb = Math.max(rmsDb + 1.5, inputPeakDb - 1.5);

    if (this.baselineDb === null) {
      this.baselineDb = referenceDb;
    } else {
      const riseFactor =
        this.lastReductionDb > 0.8
          ? config.baselineRise * 0.35
          : config.baselineRise;
      const smoothing =
        referenceDb > this.baselineDb ? riseFactor : config.baselineFall;
      this.baselineDb =
        this.baselineDb + (referenceDb - this.baselineDb) * smoothing;
    }

    const deltaOvershootDb =
      referenceDb - (this.baselineDb + config.triggerMarginDb);
    const deltaReductionDb = Math.max(0, deltaOvershootDb) * config.deltaRatio;
    const ceilingReductionDb = Math.max(0, inputPeakDb - config.ceilingDb);
    const targetReductionDb = clamp(
      Math.max(deltaReductionDb, ceilingReductionDb),
      0,
      config.maxReductionDb
    );
    const targetGain = dbToLinear(-targetReductionDb);
    const now = this.audioContext.currentTime;

    this.outputGainNode.gain.cancelScheduledValues(now);
    this.outputGainNode.gain.setTargetAtTime(
      targetGain,
      now,
      targetReductionDb > this.lastReductionDb
        ? config.attackTime
        : config.releaseTime
    );

    this.outputAnalyserNode.getFloatTimeDomainData(this.outputAnalysisBuffer);
    const { peakDb: outputPeakDb } = measureAudioBufferLevels(
      this.outputAnalysisBuffer
    );
    const compressorReductionDb = Math.max(
      0,
      Math.abs(this.compressorNode.reduction)
    );
    const effectiveReductionDb = Math.max(
      targetReductionDb,
      compressorReductionDb
    );

    this.lastReductionDb = effectiveReductionDb;
    this.emitStatus({
      inputDb: inputPeakDb,
      currentDb: outputPeakDb,
      baselineDb: this.baselineDb,
      ceilingDb: config.ceilingDb,
      reductionDb: effectiveReductionDb,
      limited:
        effectiveReductionDb > 0.35 ||
        inputPeakDb >= config.ceilingDb + 0.25 ||
        outputPeakDb >= config.ceilingDb - 0.4,
    });
  }

  private startMonitoring() {
    const config = getAudioSpikeProtectionLevelConfig(this.level);
    if (
      this.monitorTimerId !== null ||
      !config ||
      !this.inputAnalyserNode ||
      !this.inputAnalysisBuffer ||
      !this.outputAnalyserNode ||
      !this.outputAnalysisBuffer ||
      !this.audioContext ||
      !this.outputGainNode
    ) {
      return;
    }

    this.monitorTimerId = window.setInterval(() => {
      this.runMonitorTick();
    }, config.monitorIntervalMs);
  }

  private stopMonitoring() {
    if (this.monitorTimerId !== null) {
      window.clearInterval(this.monitorTimerId);
      this.monitorTimerId = null;
    }

    this.baselineDb = null;
    this.lastReductionDb = 0;

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

  setLevel(level: AudioSpikeProtectionLevel) {
    if (level === this.level) {
      this.emitStatus({});
      return;
    }

    this.level = level;
    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('loadeddata', this.handleLoadedData);

    if (!isAudioSpikeProtectionActive(level)) {
      this.unbindDocumentListeners();
      this.stopMonitoring();

      if (this.graphInitialized) {
        this.reconnectGraph(false);
      }

      this.emitStatus({});
      return;
    }

    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('loadeddata', this.handleLoadedData);

    if (this.graphInitialized) {
      this.applyLevelConfig();
      this.reconnectGraph(true);
      this.stopMonitoring();
      this.startMonitoring();
      this.emitStatus({});
      return;
    }

    if (!this.video.paused) {
      void this.initializeEnabledGraph();
      this.emitStatus({});
      return;
    }

    this.bindDocumentListeners();
    this.emitStatus({});
  }

  dispose() {
    this.level = 'off';
    this.stopMonitoring();
    this.unbindDocumentListeners();
    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('loadeddata', this.handleLoadedData);

    safeDisconnect(this.sourceNode);
    safeDisconnect(this.inputAnalyserNode);
    safeDisconnect(this.outputAnalyserNode);
    safeDisconnect(this.compressorNode);
    safeDisconnect(this.limiterNode);
    safeDisconnect(this.outputGainNode);

    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
    }

    this.sourceNode = null;
    this.inputAnalyserNode = null;
    this.outputAnalyserNode = null;
    this.compressorNode = null;
    this.limiterNode = null;
    this.outputGainNode = null;
    this.audioContext = null;
    this.inputAnalysisBuffer = null;
    this.outputAnalysisBuffer = null;
    this.graphInitialized = false;
    this.emitStatus({});
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
  intensityLocation: WebGLUniformLocation;
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
    uniform float u_intensity;

    void main() {
      vec3 center = texture2D(u_texture, v_texCoord).rgb;
      vec3 left = texture2D(u_texture, v_texCoord + vec2(-u_texelSize.x, 0.0)).rgb;
      vec3 right = texture2D(u_texture, v_texCoord + vec2(u_texelSize.x, 0.0)).rgb;
      vec3 up = texture2D(u_texture, v_texCoord + vec2(0.0, -u_texelSize.y)).rgb;
      vec3 down = texture2D(u_texture, v_texCoord + vec2(0.0, u_texelSize.y)).rgb;

      float sharpenStrength = mix(0.32, 0.92, u_intensity);
      float highlightSuppression = mix(0.22, 0.7, u_intensity);
      float skinSuppression = mix(0.18, 0.54, u_intensity);
      float saturationMix = mix(1.0, 1.08, u_intensity);

      vec3 blur = (center + left + right + up + down) / 5.0;
      vec3 sharpened = clamp(center + (center - blur) * sharpenStrength, 0.0, 1.0);

      float luma = dot(sharpened, vec3(0.299, 0.587, 0.114));
      float maxChannel = max(sharpened.r, max(sharpened.g, sharpened.b));
      float minChannel = min(sharpened.r, min(sharpened.g, sharpened.b));
      float saturation = maxChannel - minChannel;

      float highlightMask = smoothstep(0.72, 0.98, luma);
      vec3 toned = mix(
        sharpened,
        sharpened * vec3(0.98, 0.95, 0.92),
        highlightMask * highlightSuppression
      );

      float skinMask =
        smoothstep(0.03, 0.18, toned.r - toned.b) *
        smoothstep(0.52, 0.88, luma) *
        (1.0 - smoothstep(0.08, 0.28, saturation));

      toned = mix(toned, toned * vec3(1.03, 0.99, 0.95), skinMask * skinSuppression);

      float tonedLuma = dot(toned, vec3(0.299, 0.587, 0.114));
      vec3 lumaColor = vec3(tonedLuma);
      vec3 corrected = clamp(mix(lumaColor, toned, saturationMix), 0.0, 1.0);

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
  const intensityLocation = gl.getUniformLocation(program, 'u_intensity');

  if (
    !texture ||
    !positionBuffer ||
    !texCoordBuffer ||
    positionLocation < 0 ||
    texCoordLocation < 0 ||
    !texelSizeLocation ||
    !intensityLocation
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
  gl.clearColor(0, 0, 0, 1);

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
    intensityLocation,
  };
}

class VisualEnhancementController {
  private canvas: HTMLCanvasElement | null = null;
  private canvasHost: HTMLElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;
  private glContext: VisualEnhancementGlContext | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;
  private videoFrameCallbackHandle: VideoFrameRequestHandle | null = null;
  private viewportChangeTimerId: number | null = null;
  private level: VisualEnhancementLevel = 'off';
  private lastWidth = 0;
  private lastHeight = 0;
  private windowListenersBound = false;

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

  private readonly handleLoadedMetadata = () => {
    this.renderFrame();
  };

  private readonly handleViewportChange = () => {
    if (!isVisualEnhancementActive(this.level)) {
      return;
    }

    this.syncCanvasHost();
    this.resizeCanvas();
    this.renderFrame();

    if (this.viewportChangeTimerId !== null) {
      window.clearTimeout(this.viewportChangeTimerId);
    }

    this.viewportChangeTimerId = window.setTimeout(() => {
      this.viewportChangeTimerId = null;
      if (!isVisualEnhancementActive(this.level)) {
        return;
      }

      this.syncCanvasHost();
      this.resizeCanvas();
      this.renderFrame();
    }, 80);
  };

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly fallbackHost: HTMLElement
  ) {}

  private getRenderHost(): HTMLElement | null {
    return (
      (this.video.closest('.art-video-player') as HTMLElement | null) ||
      this.fallbackHost ||
      this.video.parentElement
    );
  }

  private setCanvasVisible(visible: boolean) {
    if (!this.canvas) {
      return;
    }

    this.canvas.style.opacity = visible ? '1' : '0';
  }

  private bindWindowListeners() {
    if (this.windowListenersBound || typeof document === 'undefined') {
      return;
    }

    window.addEventListener('resize', this.handleViewportChange);
    document.addEventListener('fullscreenchange', this.handleViewportChange);
    document.addEventListener(
      'webkitfullscreenchange' as keyof DocumentEventMap,
      this.handleViewportChange as EventListener
    );
    this.windowListenersBound = true;
  }

  private unbindWindowListeners() {
    if (!this.windowListenersBound || typeof document === 'undefined') {
      return;
    }

    window.removeEventListener('resize', this.handleViewportChange);
    document.removeEventListener('fullscreenchange', this.handleViewportChange);
    document.removeEventListener(
      'webkitfullscreenchange' as keyof DocumentEventMap,
      this.handleViewportChange as EventListener
    );
    this.windowListenersBound = false;
  }

  private observeResize() {
    if (typeof ResizeObserver === 'undefined' || !this.canvasHost) {
      return;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.renderFrame();
    });
    this.resizeObserver.observe(this.canvasHost);
  }

  private syncCanvasHost(): boolean {
    const nextHost = this.getRenderHost();
    if (!nextHost || !this.canvas) {
      return false;
    }

    if (this.canvasHost !== nextHost) {
      this.canvasHost = nextHost;
      nextHost.appendChild(this.canvas);
      this.observeResize();
      this.lastWidth = 0;
      this.lastHeight = 0;
    }

    return true;
  }

  private ensureCanvas(): boolean {
    if (this.canvas) {
      return this.syncCanvasHost();
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'pointer-events-none absolute inset-0 h-full w-full';
    canvas.style.zIndex = '15';
    canvas.style.borderRadius = 'inherit';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 120ms ease';

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

    this.canvas = canvas;
    this.glContext = glContext;
    this.canvasContext = canvasContext;
    this.canvasHost = null;
    this.bindWindowListeners();

    if (!this.syncCanvasHost()) {
      this.disableInternal();
      return false;
    }

    this.observeResize();
    return true;
  }

  private resizeCanvas() {
    if (!this.canvas || !this.canvasHost) {
      return;
    }

    const width = this.canvasHost.clientWidth;
    const height = this.canvasHost.clientHeight;
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
  }

  private getDrawRect(): AspectFitRect | null {
    if (!this.canvas) {
      return null;
    }

    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return null;
    }

    return calculateAspectFitRect(
      this.canvas.width,
      this.canvas.height,
      sourceWidth,
      sourceHeight
    );
  }

  private renderWebGlFrame(drawRect: AspectFitRect, intensity: number) {
    if (!this.canvas || !this.glContext) {
      return;
    }

    const { gl, texture, texelSizeLocation, intensityLocation, program } =
      this.glContext;
    const viewportX = Math.round(drawRect.x);
    const viewportY = Math.round(
      this.canvas.height - drawRect.y - drawRect.height
    );
    const viewportWidth = Math.max(1, Math.round(drawRect.width));
    const viewportHeight = Math.max(1, Math.round(drawRect.height));

    gl.useProgram(program);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
      1 / Math.max(this.video.videoWidth, 1),
      1 / Math.max(this.video.videoHeight, 1)
    );
    gl.uniform1f(intensityLocation, intensity);
    gl.viewport(viewportX, viewportY, viewportWidth, viewportHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private render2dFrame(drawRect: AspectFitRect, intensity: number) {
    if (!this.canvas || !this.canvasContext) {
      return;
    }

    const context = this.canvasContext;
    const width = this.canvas.width;
    const height = this.canvas.height;

    context.save();
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);

    context.filter = `contrast(${(1 + 0.1 * intensity).toFixed(2)}) saturate(${(
      1 -
      0.08 * intensity
    ).toFixed(2)}) brightness(${(1 - 0.04 * intensity).toFixed(2)})`;
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.drawImage(
      this.video,
      drawRect.x,
      drawRect.y,
      drawRect.width,
      drawRect.height
    );

    context.filter = `contrast(${(1 + 0.35 * intensity).toFixed(
      2
    )}) saturate(${(0.98 - 0.12 * intensity).toFixed(2)}) brightness(${(
      1 -
      0.03 * intensity
    ).toFixed(2)})`;
    context.globalCompositeOperation = 'overlay';
    context.globalAlpha = 0.12 + 0.14 * intensity;
    context.drawImage(
      this.video,
      drawRect.x,
      drawRect.y,
      drawRect.width,
      drawRect.height
    );

    context.filter = `sepia(${(0.04 + 0.08 * intensity).toFixed(
      2
    )}) contrast(${(1 + 0.08 * intensity).toFixed(2)})`;
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 0.08 + 0.1 * intensity;
    context.drawImage(
      this.video,
      drawRect.x,
      drawRect.y,
      drawRect.width,
      drawRect.height
    );

    context.restore();
  }

  private renderFrame() {
    if (!isVisualEnhancementActive(this.level)) {
      return;
    }

    if (
      !this.canvas ||
      !this.syncCanvasHost() ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      this.setCanvasVisible(false);
      return;
    }

    this.resizeCanvas();

    const drawRect = this.getDrawRect();
    const intensity = getVisualEnhancementIntensity(this.level);
    if (!drawRect || intensity <= 0) {
      this.setCanvasVisible(false);
      return;
    }

    try {
      if (this.glContext) {
        this.renderWebGlFrame(drawRect, intensity);
      } else {
        this.render2dFrame(drawRect, intensity);
      }

      this.setCanvasVisible(true);
    } catch (_) {
      this.setCanvasVisible(false);
      this.disableInternal();
      this.level = 'off';
    }
  }

  private scheduleNextFrame() {
    if (!isVisualEnhancementActive(this.level)) {
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
          if (
            isVisualEnhancementActive(this.level) &&
            !this.video.paused &&
            !this.video.ended
          ) {
            this.scheduleNextFrame();
          }
        });
      return;
    }

    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.renderFrame();
      if (
        isVisualEnhancementActive(this.level) &&
        !this.video.paused &&
        !this.video.ended
      ) {
        this.scheduleNextFrame();
      }
    });
  }

  private startRendering() {
    if (
      !isVisualEnhancementActive(this.level) ||
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
    this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unbindWindowListeners();

    if (this.viewportChangeTimerId !== null) {
      window.clearTimeout(this.viewportChangeTimerId);
      this.viewportChangeTimerId = null;
    }

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
    this.canvasHost = null;
    this.canvasContext = null;
    this.glContext = null;
    this.lastWidth = 0;
    this.lastHeight = 0;
  }

  setLevel(level: VisualEnhancementLevel) {
    if (level === this.level) {
      if (isVisualEnhancementActive(level)) {
        this.renderFrame();
      }
      return;
    }

    this.level = level;

    if (!isVisualEnhancementActive(level)) {
      this.disableInternal();
      return;
    }

    if (!this.ensureCanvas()) {
      this.level = 'off';
      return;
    }

    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('pause', this.handlePause);
    this.video.addEventListener('seeked', this.handleSeeked);
    this.video.addEventListener('loadeddata', this.handleLoadedData);
    this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.renderFrame();

    if (this.video.paused) {
      return;
    }

    this.startRendering();
  }

  dispose() {
    this.level = 'off';
    this.disableInternal();
  }
}

export class PlayerEnhancementManager {
  private video: HTMLVideoElement | null = null;
  private host: HTMLElement | null = null;
  private audioController: AudioSpikeProtectionController | null = null;
  private visualController: VisualEnhancementController | null = null;
  private onAudioStatusChange?: (status: AudioSpikeProtectionStatus) => void;
  private preferences: PlayerEnhancementPreferences = {
    audioSpikeProtectionLevel: 'off',
    visualEnhancementLevel: 'off',
  };

  constructor(options: PlayerEnhancementManagerOptions = {}) {
    this.onAudioStatusChange = options.onAudioStatusChange;
    this.onAudioStatusChange?.(buildAudioSpikeProtectionStatus());
  }

  setAudioStatusListener(
    listener?: (status: AudioSpikeProtectionStatus) => void
  ) {
    this.onAudioStatusChange = listener;
    if (this.audioController) {
      this.audioController.setStatusListener(listener);
      return;
    }

    listener?.(buildAudioSpikeProtectionStatus());
  }

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
    this.audioController = new AudioSpikeProtectionController(
      video,
      this.onAudioStatusChange
    );
    this.visualController = new VisualEnhancementController(video, host);
    this.sync();
  }

  setPreferences(preferences: PlayerEnhancementPreferences) {
    this.preferences = preferences;
    this.sync();
  }

  private sync() {
    this.audioController?.setLevel(this.preferences.audioSpikeProtectionLevel);
    this.visualController?.setLevel(this.preferences.visualEnhancementLevel);
  }

  dispose() {
    this.audioController?.dispose();
    this.visualController?.dispose();
    this.audioController = null;
    this.visualController = null;
    this.video = null;
    this.host = null;
    this.onAudioStatusChange?.(buildAudioSpikeProtectionStatus());
  }
}
