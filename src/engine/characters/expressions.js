// Facial expression presets. Each maps to brow, lid and mouth parameters
// that the face rig blends between.
export const EXPRESSIONS = {
  neutral: { brow: [0, 0, 0, 0], browR: null, upper: 0.5, lower: 0.5, tilt: 0, smile: 0.18, open: 0, width: 1, round: 0, blush: 0 },
  happy: { brow: [0.03, 0.02, 0.02, 0], upper: 0.44, lower: 0.21, tilt: 0, smile: 0.85, open: 0.04, width: 1.08, round: 0, blush: 0.3 },
  excited: { brow: [0.08, 0.06, 0.03, 0], upper: 0.56, lower: 0.21, tilt: 0, smile: 1, open: 0.45, width: 1.12, round: 0, blush: 0.4 },
  sad: { brow: [0.09, -0.05, -0.01, 0.4], upper: 0.22, lower: 0.38, tilt: -0.18, smile: -0.65, open: 0.02, width: 0.92, round: 0, blush: 0.1 },
  angry: { brow: [-0.09, 0.03, -0.01, 1], upper: 0.22, lower: 0.26, tilt: 0.22, smile: -0.45, open: 0.08, width: 0.95, round: 0, blush: 0.15 },
  scared: { brow: [0.11, 0.05, 0.01, 0.6], upper: 0.7, lower: 0.48, tilt: -0.05, smile: -0.35, open: 0.3, width: 0.9, round: 0.35, blush: 0 },
  surprised: { brow: [0.13, 0.12, 0.03, 0], upper: 0.78, lower: 0.46, tilt: 0, smile: 0.05, open: 0.5, width: 0.9, round: 0.75, blush: 0.1 },
  curious: { brow: [0.08, 0.06, 0.03, 0], browR: [-0.02, -0.01, 0, 0.2], upper: 0.6, lower: 0.4, tilt: 0, smile: 0.25, open: 0.0, width: 0.95, round: 0.1, blush: 0 },
  tired: { brow: [-0.01, -0.03, -0.01, 0], upper: 0.06, lower: 0.26, tilt: -0.08, smile: 0, open: 0, width: 0.95, round: 0, blush: 0 },
  love: { brow: [0.05, 0.02, 0.01, 0.2], upper: 0.36, lower: 0.18, tilt: -0.05, smile: 0.7, open: 0.05, width: 1.02, round: 0, blush: 0.8 },
  proud: { brow: [0.02, 0.03, 0.01, 0], upper: 0.38, lower: 0.31, tilt: 0, smile: 0.55, open: 0.0, width: 1.05, round: 0, blush: 0.15 },
  calm: { brow: [0.02, 0, 0.01, 0], upper: 0.4, lower: 0.31, tilt: 0, smile: 0.35, open: 0, width: 1, round: 0, blush: 0.1 },
  hopeful: { brow: [0.06, 0.01, 0.02, 0.2], upper: 0.5, lower: 0.28, tilt: -0.04, smile: 0.5, open: 0.02, width: 1.02, round: 0, blush: 0.25 },
  laugh: { brow: [0.06, 0.04, 0.02, 0], upper: 0.14, lower: 0.15, tilt: 0, smile: 1, open: 0.65, width: 1.15, round: 0, blush: 0.5 },
  cry: { brow: [0.12, -0.06, -0.01, 0.6], upper: 0.12, lower: 0.18, tilt: -0.2, smile: -0.85, open: 0.25, width: 1.05, round: 0, blush: 0.4 },
  sleep: { brow: [0, -0.02, 0, 0], upper: -0.2, lower: 0.15, tilt: 0, smile: 0.12, open: 0.03, width: 0.9, round: 0.3, blush: 0.1 },
  pray: { brow: [0.04, 0, 0.01, 0.2], upper: -0.15, lower: 0.15, tilt: 0, smile: 0.2, open: 0, width: 0.95, round: 0, blush: 0.15 },
};

export function expressionFor(emotion, action) {
  if (action === 'laugh') return EXPRESSIONS.laugh;
  if (action === 'cry') return EXPRESSIONS.cry;
  if (action === 'sleep') return EXPRESSIONS.sleep;
  if (action === 'pray') return EXPRESSIONS.pray;
  return EXPRESSIONS[emotion] || EXPRESSIONS.neutral;
}

export function blendExpr(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k];
    if (Array.isArray(va) || Array.isArray(vb)) {
      const A = va || a.brow, B = vb || b.brow;
      out[k] = A.map((x, i) => x + (B[i] - x) * t);
    } else if (typeof va === 'number') out[k] = va + ((vb ?? va) - va) * t;
    else out[k] = vb ?? va;
  }
  return out;
}
