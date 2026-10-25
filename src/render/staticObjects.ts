import type * as THREE from 'three';

// Zmrazí matice statického podstromu: spočtou se teď jednou a renderer je pak každý snímek nepřepočítává.
// Animované části (userData.updateAnimation) i s potomky zůstávají živé.
export function freezeStatic(object: THREE.Object3D): void {
  if (object.userData.updateAnimation) return;
  object.updateMatrix();
  object.matrixAutoUpdate = false;
  for (const child of object.children) freezeStatic(child);
}
