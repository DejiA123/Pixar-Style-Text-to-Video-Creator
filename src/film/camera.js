// Cinematography: compute a camera pose for a shot at normalized time u.
import * as THREE from 'three';
import { easeInOut, lerp, noise1, clamp } from '../util.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// subjects: { focus: {head, chest, feet, height}, target: {...}|null, group: {center, width, height} }
export function cameraFor(shot, u, subjects, aspect, seed = 1) {
  const type = shot.type;
  const e = easeInOut(clamp(u));
  const F = subjects.focus;
  const G = subjects.group;
  const fovV = 34;
  const fitDist = (width, height, fov = fovV) => {
    const vf = THREE.MathUtils.degToRad(fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    return Math.max(height / 2 / Math.tan(vf / 2), width / 2 / Math.tan(hf / 2));
  };
  let pos, look, fov = fovV, aperture = 0.3, focus;
  const side = (seed % 2 ? 1 : -1);
  if (!F) {
    // no characters: scenic pan
    pos = v3(Math.sin(u * 0.4) * 2, 2.2, 9 - e * 1.5);
    look = v3(0, 1.4, -6);
    return finish(pos, look, 40, 0.0, 10, u, seed);
  }
  switch (type) {
    case 'establishing': {
      const d = fitDist(G.width + 5, G.height + 3.5, 38) + 2.5;
      const yaw = side * 0.35;
      pos = v3(G.center.x + Math.sin(yaw) * d * lerp(1.25, 1.0, e), lerp(4.2, 2.0, e), G.center.z + Math.cos(yaw) * d * lerp(1.25, 1.0, e));
      look = v3(G.center.x, lerp(1.6, 1.15, e), G.center.z - 1.5);
      fov = 38; aperture = 0.08; focus = pos.distanceTo(G.center);
      break;
    }
    case 'wide': {
      const d = fitDist(G.width + 2.4, G.height + 1.2, 36);
      const yaw = side * 0.22 + (u - 0.5) * 0.12;
      pos = v3(G.center.x + Math.sin(yaw) * d, 1.55, G.center.z + Math.cos(yaw) * d);
      look = v3(G.center.x, G.height * 0.5, G.center.z);
      fov = 36; aperture = 0.18; focus = d;
      break;
    }
    case 'tracking': {
      const d = fitDist(2.6, F.height * 1.35, 36);
      pos = v3(F.chest.x - 0.6 * side, F.chest.y + 0.15, F.chest.z + d);
      look = v3(F.chest.x + 0.35, F.chest.y, F.chest.z);
      aperture = 0.3; focus = d;
      break;
    }
    case 'lowangle': {
      const d = fitDist(1.6, F.height * 1.6, 40) * 0.9;
      pos = v3(F.feet.x + side * 0.8, 0.35, F.feet.z + d);
      look = v3(F.head.x, F.head.y - F.height * 0.2, F.head.z);
      fov = 40; aperture = 0.25; focus = pos.distanceTo(F.chest);
      break;
    }
    case 'closeup': {
      const d = fitDist(0.62, 0.55, 30) * lerp(1.06, 0.97, e);
      const yaw = (F.facing ?? 0) + side * 0.32;
      pos = v3(F.head.x + Math.sin(yaw) * d, F.head.y + 0.02, F.head.z + Math.cos(yaw) * d);
      look = v3(F.head.x, F.head.y - 0.04, F.head.z);
      fov = 30; aperture = 0.65; focus = d;
      break;
    }
    case 'over-shoulder': {
      const T = subjects.target;
      if (T && T.head.distanceTo(F.head) < 3.2) {
        // behind the listener's shoulder, looking at the speaker's face
        const toSpeaker = F.head.clone().sub(T.head).setY(0).normalize();
        const perp = v3(-toSpeaker.z, 0, toSpeaker.x);
        const sgn = perp.z > 0 ? 1 : -1; // keep the camera on the +z side of the action
        pos = T.head.clone().addScaledVector(toSpeaker, -0.75).addScaledVector(perp, 0.42 * sgn).add(v3(0, 0.02, 0));
        look = F.head.clone().add(v3(0, -0.05, 0)).addScaledVector(perp, -0.1 * sgn);
        pos.addScaledVector(toSpeaker, e * 0.12);
        fov = 32; aperture = 0.7; focus = pos.distanceTo(F.head);
      } else {
        return cameraFor({ ...shot, type: 'closeup' }, u, subjects, aspect, seed);
      }
      break;
    }
    case 'two-shot': {
      const T = subjects.target || F;
      const mid = F.chest.clone().add(T.chest).multiplyScalar(0.5);
      const w = F.chest.distanceTo(T.chest) + 1.2;
      const d = fitDist(w, F.height * 0.75, 34);
      pos = v3(mid.x + side * 0.4, mid.y + 0.15, mid.z + d);
      look = mid.clone().add(v3(0, 0.15, 0));
      aperture = 0.35; focus = d;
      break;
    }
    case 'medium':
    default: {
      const d = fitDist(1.3, F.height * 0.62, 34) * lerp(1.05, 0.96, e);
      const yaw = (F.facing ?? 0) * 0.5 + side * 0.28;
      const tgt = F.head.clone().add(v3(0, -F.height * 0.18, 0));
      pos = v3(tgt.x + Math.sin(yaw) * d, tgt.y + 0.05, tgt.z + Math.cos(yaw) * d);
      look = tgt;
      aperture = 0.42; focus = d;
    }
  }
  return finish(pos, look, fov, aperture, focus ?? pos.distanceTo(look), u, seed);
}

function finish(pos, look, fov, aperture, focus, u, seed) {
  // gentle handheld drift
  const t = u * 6 + seed;
  pos = pos.clone().add(v3(noise1(t * 0.5, seed) * 0.02, noise1(t * 0.45, seed + 1) * 0.015, 0));
  return { pos, look, fov, aperture, focus };
}
