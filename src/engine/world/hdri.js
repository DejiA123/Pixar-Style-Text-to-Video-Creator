// Real-world image-based lighting from CC0 Poly Haven HDRIs (assets/hdri):
// soft bounce light and reflections that procedural skies can't give.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const cache = new Map();
const NATURE = ['forest', 'park', 'meadow', 'jungle', 'garden', 'farm', 'beach', 'mountain', 'desert', 'lake', 'river', 'camp'];

export function pickHDRI(setting, time, interior) {
  if (interior) return setting === 'church' ? 'small_cathedral' : 'lebombo';
  const nature = NATURE.some((n) => setting.includes(n));
  if (time === 'dawn') return 'kiara_1_dawn';
  if (time === 'sunset') return 'venice_sunset';
  if (time === 'night') return nature ? 'moonless_golf' : 'shanghai_bund';
  return nature ? 'forest_slope' : 'potsdamer_platz';
}

// Resolves to { texture (PMREM), mean } — mean luminance lets callers normalise brightness.
export function loadHDRI(renderer, name) {
  if (cache.has(name)) return cache.get(name);
  const url = new URL(`../../../assets/hdri/${name}.hdr`, import.meta.url).href;
  const p = new HDRLoader().setDataType(THREE.FloatType).loadAsync(url).then((tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const d = tex.image.data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) { sum += Math.min(20, 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); n++; }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const texture = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    return { texture, mean: sum / Math.max(1, n) };
  }).catch((e) => { console.warn('HDRI load failed', name, e.message); return null; });
  cache.set(name, p);
  return p;
}
