import * as THREE from 'three';
import { loadModel } from '../assets';
import type { GameMap, TilePos } from '../world/map';

// Sochy společnosti ve městech: obelisk z nature kitu na kamenném podstavci
export class StatuesView {
  readonly object = new THREE.Group();
  private key = '';
  private version = 0;

  constructor(private readonly map: GameMap) {}

  async sync(statues: Iterable<TilePos>): Promise<void> {
    const tiles = [...statues];
    const key = tiles.map((t) => `${t.x},${t.y}`).join('|');
    if (key === this.key) return;
    this.key = key;
    const version = ++this.version;
    const models = await Promise.all(tiles.map(() => loadModel('nature kit', 'statue_obelisk')));
    if (version !== this.version) return;
    this.object.clear();
    tiles.forEach((t, i) => {
      const ground = this.map.elevation(t.x, t.y);
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.08, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xb8ad98 }),
      );
      base.position.set(t.x + 0.5, ground + 0.04, t.y + 0.5);
      const statue = models[i];
      statue.scale.setScalar(0.9);
      statue.position.set(t.x + 0.5, ground + 0.08, t.y + 0.5);
      this.object.add(base, statue);
    });
  }
}
