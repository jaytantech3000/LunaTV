import {
  analyzeAudioSpikeProtectionFrame,
  buildHardLimiterCurve,
  calculateAspectFitRect,
  evaluateDialoguePresence,
} from '@/lib/player-enhancement-runtime';

function learnDialogueBaseline(
  {
    level = 'standard',
    rmsDb = -24,
    peakDb = -11,
    frames = 12,
  }: {
    level?: 'light' | 'standard' | 'strong';
    rmsDb?: number;
    peakDb?: number;
    frames?: number;
  } = {}
) {
  let baselineDb: number | null = null;
  let baselineHistory: number[] = [];

  for (let index = 0; index < frames; index += 1) {
    const analysis = analyzeAudioSpikeProtectionFrame({
      level,
      rmsDb,
      peakDb,
      baselineDb,
      baselineHistory,
      dialogueCandidate: true,
      dynamicProtectionEnabled: true,
      fixedCeilingEnabled: false,
    });
    baselineDb = analysis.baselineDb;
    baselineHistory = analysis.baselineHistory;
  }

  return {
    baselineDb,
    baselineHistory,
  };
}

describe('player enhancement runtime helpers', () => {
  it('keeps video aspect ratio inside a wider host', () => {
    expect(calculateAspectFitRect(1920, 1080, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('preserves letterboxing for a taller host', () => {
    expect(calculateAspectFitRect(1200, 1200, 1920, 1080)).toEqual({
      x: 0,
      y: 262.5,
      width: 1200,
      height: 675,
    });
  });

  it('preserves pillarboxing for a narrower host', () => {
    expect(calculateAspectFitRect(900, 1600, 1920, 1080)).toEqual({
      x: 0,
      y: 546.875,
      width: 900,
      height: 506.25,
    });
  });

  it('builds a hard limiter curve that clamps peaks to the configured ceiling', () => {
    const curve = buildHardLimiterCurve(-12, 5);
    const expectedLimit = Math.pow(10, -12 / 20);

    expect(curve[0]).toBeCloseTo(-expectedLimit, 5);
    expect(curve[1]).toBeCloseTo(-expectedLimit, 5);
    expect(curve[2]).toBeCloseTo(0, 5);
    expect(curve[3]).toBeCloseTo(expectedLimit, 5);
    expect(curve[4]).toBeCloseTo(expectedLimit, 5);
  });

  it('does not treat quiet ambience as the dialogue baseline for dynamic protection', () => {
    const ambience = analyzeAudioSpikeProtectionFrame({
      level: 'standard',
      rmsDb: -48,
      peakDb: -38,
      baselineDb: null,
      baselineHistory: [],
      dialogueCandidate: false,
      dynamicProtectionEnabled: true,
      fixedCeilingEnabled: true,
    });

    expect(ambience.baselineDb).toBeNull();
    expect(ambience.baselineHistory).toHaveLength(0);
    expect(ambience.targetReductionDb).toBe(0);

    const dialogue = learnDialogueBaseline();

    expect(dialogue.baselineDb).toBeCloseTo(-24, 5);
    expect(dialogue.baselineHistory).toHaveLength(12);
  });

  it('builds a rolling dialogue baseline instead of sticking to the earliest quiet line', () => {
    let baselineDb: number | null = null;
    let baselineHistory: number[] = [];
    const dialogueFrames = [-34, -33, -31, -30, -29, -28, -27, -26, -25, -24, -23, -22];

    dialogueFrames.forEach((rmsDb) => {
      const analysis = analyzeAudioSpikeProtectionFrame({
        level: 'standard',
        rmsDb,
        peakDb: rmsDb + 12,
        baselineDb,
        baselineHistory,
        dialogueCandidate: true,
        dynamicProtectionEnabled: true,
        fixedCeilingEnabled: false,
      });
      baselineDb = analysis.baselineDb;
      baselineHistory = analysis.baselineHistory;
    });

    expect(baselineDb).not.toBeNull();
    expect(baselineDb).toBeGreaterThan(-29);
  });

  it('protects dialogue from routine compression while still catching louder non-dialogue scenes', () => {
    const learnedDialogue = learnDialogueBaseline();
    const normalDialogue = analyzeAudioSpikeProtectionFrame({
      level: 'standard',
      rmsDb: -21.8,
      peakDb: -8.5,
      baselineDb: learnedDialogue.baselineDb,
      baselineHistory: learnedDialogue.baselineHistory,
      dialogueCandidate: true,
      dynamicProtectionEnabled: true,
      fixedCeilingEnabled: false,
    });
    const loudScene = analyzeAudioSpikeProtectionFrame({
      level: 'standard',
      rmsDb: -21.8,
      peakDb: -8.5,
      baselineDb: learnedDialogue.baselineDb,
      baselineHistory: learnedDialogue.baselineHistory,
      dialogueCandidate: false,
      dynamicProtectionEnabled: true,
      fixedCeilingEnabled: false,
    });

    expect(normalDialogue.dynamicReductionDb).toBe(0);
    expect(loudScene.dynamicReductionDb).toBeGreaterThan(0);
    expect(loudScene.fixedCeilingReductionDb).toBe(0);
  });

  it('can disable the fixed ceiling independently from the dynamic protection', () => {
    const learnedDialogue = learnDialogueBaseline();
    const fixedOff = analyzeAudioSpikeProtectionFrame({
      level: 'standard',
      rmsDb: -26,
      peakDb: -1,
      baselineDb: learnedDialogue.baselineDb,
      baselineHistory: learnedDialogue.baselineHistory,
      dialogueCandidate: false,
      dynamicProtectionEnabled: false,
      fixedCeilingEnabled: false,
    });
    const fixedOn = analyzeAudioSpikeProtectionFrame({
      level: 'standard',
      rmsDb: -26,
      peakDb: -1,
      baselineDb: learnedDialogue.baselineDb,
      baselineHistory: learnedDialogue.baselineHistory,
      dialogueCandidate: false,
      dynamicProtectionEnabled: false,
      fixedCeilingEnabled: true,
    });

    expect(fixedOff.fixedCeilingReductionDb).toBe(0);
    expect(fixedOff.ceilingDb).toBeNull();
    expect(fixedOn.fixedCeilingReductionDb).toBeGreaterThan(0);
    expect(fixedOn.ceilingDb).toBe(-4.5);
  });

  it('does not let loud non-dialogue material rewrite the learned dialogue baseline', () => {
    const learnedDialogue = learnDialogueBaseline({
      rmsDb: -25,
      peakDb: -11,
    });
    const loudBgm = analyzeAudioSpikeProtectionFrame({
      level: 'standard',
      rmsDb: -15,
      peakDb: -3,
      baselineDb: learnedDialogue.baselineDb,
      baselineHistory: learnedDialogue.baselineHistory,
      dialogueCandidate: false,
      dynamicProtectionEnabled: true,
      fixedCeilingEnabled: false,
    });

    expect(learnedDialogue.baselineDb).toBeCloseTo(-25, 5);
    expect(loudBgm.baselineDb).toBeCloseTo(-25, 5);
    expect(loudBgm.baselineHistory).toEqual(learnedDialogue.baselineHistory);
    expect(loudBgm.dynamicReductionDb).toBeGreaterThan(0);
  });

  it('scores dialogue-like spectra higher than bass-heavy bgm spectra', () => {
    const dialogue = evaluateDialoguePresence({
      speechRatio: 0.7,
      voiceCoreRatio: 0.62,
      bassRatio: 0.16,
      airRatio: 0.14,
      crestDb: 11,
    });
    const bgm = evaluateDialoguePresence({
      speechRatio: 0.42,
      voiceCoreRatio: 0.28,
      bassRatio: 0.38,
      airRatio: 0.2,
      crestDb: 8,
    });

    expect(dialogue.isDialogueCandidate).toBe(true);
    expect(dialogue.score).toBeGreaterThan(0.75);
    expect(bgm.isDialogueCandidate).toBe(false);
    expect(bgm.score).toBeLessThan(dialogue.score);
  });
});
