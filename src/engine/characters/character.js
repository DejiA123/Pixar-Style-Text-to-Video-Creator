// A Character wraps a built rig (human or creature) and applies poses and
// facial expressions every frame.
import * as THREE from 'three';
import { buildHuman } from './human.js';
import { buildCreature } from './creatures.js';
import { computePose, blinkAt, visemeAt } from './animation.js';
import { expressionFor, blendExpr, EXPRESSIONS } from './expressions.js';
import { setHandCurl } from './body.js';
import { clamp, lerp } from '../../util.js';

const JOINT_KEYS = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Character {
  constructor(cast) {
    this.cast = cast;
    this.id = cast.id;
    const b = cast.kind === 'human' ? buildHuman(cast) : buildCreature(cast);
    Object.assign(this, b);
    this.seed = (cast.seed || 1) % 1000;
    this.rest = {};
    for (const k of JOINT_KEYS) {
      const j = this.joints[k];
      if (j) this.rest[k] = { p: j.position.clone(), r: j.rotation.clone() };
    }
    this.root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.canFly = ['bird', 'owl', 'dragon', 'robot', 'fairy', 'ghost', 'angel'].includes(cast.kind) || ['fairy', 'angel', 'superhero'].includes(cast.role) || cast.kind === 'alien';
    this.holding = null;
  }

  // world position of the eyes, for camera framing
  headWorld(target = new THREE.Vector3()) {
    const hm = this.joints.headModel || this.joints.head;
    return hm.getWorldPosition(target);
  }

  // state: { t, localT, action, emotion, talk, lookAt (Vector3), speed, seatHeight, kneel }
  update(state) {
    const J = this.joints;
    const H = this.height;
    for (const k of JOINT_KEYS) {
      const j = J[k];
      if (!j) continue;
      j.position.copy(this.rest[k].p);
      j.rotation.copy(this.rest[k].r);
    }
    const action = state.action || 'stand';
    const p = computePose(action, state.localT ?? state.t, {
      seed: this.seed, H, speed: state.speed, emotion: state.emotion,
      hipHeight: this.dims ? this.dims.hipY : H * 0.45, seatHeight: state.seatHeight,
      canFly: this.canFly, kneel: state.kneel, shinLen: this.dims ? this.dims.shin : H * 0.2,
    });
    if (this.poseHook) this.poseHook(p, state);

    // body
    const hips = J.hips;
    hips.position.y = this.rest.hips.p.y + p.rootY;
    hips.position.x = this.rest.hips.p.x + p.rootX;
    hips.position.z = this.rest.hips.p.z + p.rootZ;
    hips.rotation.set(p.hips[0] + p.rootRx, p.hips[1] + p.rootRy, p.hips[2] + p.rootRz);
    hips.scale.set(p.sx, p.sy, p.sz);
    const setR = (k, r) => { const j = J[k]; if (j) j.rotation.set(this.rest[k].r.x + r[0], this.rest[k].r.y + r[1], this.rest[k].r.z + r[2]); };
    setR('spine', p.spine); setR('chest', p.chest); setR('neck', [p.neck[0] + p.head[0] * 0.3, p.neck[1] + p.head[1] * 0.3, p.neck[2]]);
    // head looks toward a target (blended with the animation)
    let headYaw = p.head[1] * 0.7, headPitch = p.head[0] * 0.7;
    let eyeYaw = p.lookSide * 0.4, eyePitch = p.lookUp * 0.4;
    if (state.lookAt && J.head) {
      J.neck.updateWorldMatrix(true, false);
      const hw = this.headWorld(_v.set(0, 0, 0));
      const local = state.lookAt.clone().sub(hw);
      // into the neck's frame
      _m.copy(J.neck.matrixWorld).invert();
      const dir = local.clone().transformDirection(_m);
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = -Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
      const w = state.lookWeight ?? 0.8;
      headYaw += clamp(yaw, -1.0, 1.0) * 0.65 * w;
      headPitch += clamp(pitch, -0.5, 0.5) * 0.55 * w;
      eyeYaw += clamp(yaw - headYaw, -0.45, 0.45) * w;
      eyePitch += clamp(pitch - headPitch, -0.3, 0.3) * w;
    }
    setR('head', [headPitch, headYaw, p.head[2]]);
    setR('shoulderL', p.shoulderL); setR('shoulderR', p.shoulderR);
    setR('elbowL', p.elbowL); setR('elbowR', p.elbowR);
    setR('wristL', p.wristL); setR('wristR', p.wristR);
    setR('hipL', p.hipL); setR('hipR', p.hipR);
    setR('kneeL', p.kneeL); setR('kneeR', p.kneeR);
    setR('ankleL', p.ankleL); setR('ankleR', p.ankleR);
    if (J.handL && J.handL.userData.fingers) setHandCurl(J.handL, p.curlL);
    if (J.handR && J.handR.userData.fingers) {
      setHandCurl(J.handR, p.curlR);
      if (p.pointR) J.handR.userData.fingers[0].rotation.x = 0.05;
    }
    // swinging hair parts and capes lag behind motion
    const t = state.t ?? 0;
    for (const s of this.swingParts || []) {
      s.rotation.x = 0.12 + Math.sin(t * 2.1 + this.seed) * 0.05 - p.head[0] * 0.5 + (action === 'run' ? 0.5 : 0) + (action === 'jump' || action === 'cheer' ? Math.sin(t * 9) * 0.2 : 0);
      s.rotation.z = Math.sin(t * 1.7 + this.seed) * 0.06 - headYaw * 0.3;
    }
    if (J.cape) J.cape.rotation.x = (action === 'run' || action === 'fly' ? -0.6 : -0.05) + Math.sin(t * 3) * 0.04;
    if (J.wingL) { const f = p.wings ? Math.sin(t * 14) * 0.6 : Math.sin(t * 1.5) * 0.08; J.wingL.rotation.y = -0.5 - f; J.wingR.rotation.y = 0.5 + f; }
    if (this.tail) this.tail.rotation.y = Math.sin(t * (action === 'run' || state.emotion === 'happy' || state.emotion === 'excited' ? 9 : 2.5)) * 0.35;
    if (this.animate) this.animate(t, p, state);

    this.updateFace(state, p, eyeYaw, eyePitch);
  }

  updateFace(state, p, eyeYaw, eyePitch) {
    const F = this.face;
    if (!F) return;
    const t = state.t ?? 0;
    const expr = expressionFor(state.emotion, state.action);
    const base = state.prevEmotion && state.emotionBlend < 1 ? blendExpr(expressionFor(state.prevEmotion, state.action), expr, state.emotionBlend) : expr;
    const blink = Math.max(blinkAt(t, this.seed), p.eyesClosed);
    const talk = (state.talk ?? 0) * p.talkBoost;
    // eyes
    if (F.eyes) {
      for (const e of F.eyes) {
        e.ball.rotation.set(-eyePitch, eyeYaw, 0);
        let upper = base.upper + eyePitch * 0.4;
        let lower = base.lower - eyePitch * 0.2;
        const closedU = -0.18, closedL = 0.16;
        upper = lerp(upper, closedU, blink);
        lower = lerp(lower, closedL, blink * 0.6);
        e.upper.rotation.x = -upper;
        e.lower.rotation.x = lower;
        const side = e.eye.position.x < 0 ? -1 : 1;
        e.upper.rotation.z = side * (base.tilt || 0);
        e.lower.rotation.z = side * (base.tilt || 0) * 0.3;
      }
    }
    // brows
    if (F.browR) {
      const b = base.brow;
      const br = base.browR || b;
      const lift = talk * 0.025;
      F.browL.update({ innerY: b[0] + lift, outerY: b[1] + lift * 0.5, arch: b[2], squeeze: b[3] });
      F.browR.update({ innerY: br[0] + lift, outerY: br[1] + lift * 0.5, arch: br[2], squeeze: br[3] });
    }
    // mouth: expression + talking visemes
    if (F.mouth) {
      const v = visemeAt(t, talk, this.seed);
      const chew = p.chew ? Math.max(0, Math.sin(t * 10)) * 0.2 : 0;
      F.mouth.update({
        open: clamp(base.open * (1 - talk * 0.3) + v.open * 0.55 + chew),
        smile: base.smile * (1 - talk * 0.25),
        width: base.width * v.width,
        round: clamp(base.round + v.round),
        teethShow: 1,
      });
    }
    if (this.faceHook) this.faceHook(state, base, talk, blink);
  }
}

export { EXPRESSIONS };
