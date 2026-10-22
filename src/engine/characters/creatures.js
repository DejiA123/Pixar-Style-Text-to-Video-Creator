// Placeholder until creature builders land; humans cover the first pass.
import { buildHuman } from './human.js';
export function buildCreature(cast) {
  return buildHuman({ ...cast, kind: 'human' });
}
