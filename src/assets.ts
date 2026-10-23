import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Kit =
  | 'city kit commercial'
  | 'city kit suburban'
  | 'city kit industrial'
  | 'train kit'
  | 'car kit'
  | 'blocky characters'
  | 'nature kit';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

// Načte GLB z kitu (s cache), vrácená scéna je sdílená a nesmí se měnit
export function loadScene(kit: Kit, name: string): Promise<THREE.Group> {
  const url = `/${encodeURIComponent(kit)}/${encodeURIComponent(name)}.glb`;
  let pending = cache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then((gltf) => gltf.scene);
    cache.set(url, pending);
  }
  return pending;
}

// Načte GLB z kitu a vrátí nezávislý klon
export async function loadModel(kit: Kit, name: string): Promise<THREE.Group> {
  return (await loadScene(kit, name)).clone(true);
}
