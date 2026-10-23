import * as THREE from 'three';

const MAX_STREET_LAMPS = 32;
const LAMP_BULB = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xffd58a }),
);
const VIEW_SPHERE = new THREE.Sphere(new THREE.Vector3(), 0.2);

export class NightLightsView {
  readonly object = new THREE.Group();
  private readonly lamps: THREE.Group[] = [];

  constructor() {
    for (let index = 0; index < MAX_STREET_LAMPS; index++) {
      const lamp = new THREE.Group();
      const bulb = LAMP_BULB.clone();
      bulb.position.y = 0.35;
      const light = new THREE.PointLight(0xffcf83, 2.5, 5, 2);
      light.position.y = 0.35;
      lamp.add(bulb, light);
      lamp.visible = false;
      this.lamps.push(lamp);
      this.object.add(lamp);
    }
    this.object.visible = false;
  }

  update(
    night: boolean,
    frustum: THREE.Frustum,
    cameraPosition: THREE.Vector3,
    streetLamps: readonly THREE.Vector3[],
  ): void {
    this.object.visible = night;
    if (!night) return;

    const visible = streetLamps
      .filter((position) => {
        VIEW_SPHERE.center.set(position.x, 0.35, position.z);
        return frustum.intersectsSphere(VIEW_SPHERE);
      })
      .sort((a, b) => a.distanceToSquared(cameraPosition) - b.distanceToSquared(cameraPosition))
      .slice(0, MAX_STREET_LAMPS);

    for (let index = 0; index < this.lamps.length; index++) {
      const lamp = this.lamps[index];
      const position = visible[index];
      lamp.visible = position !== undefined;
      if (position) lamp.position.set(position.x, position.y, position.z);
    }
  }
}
