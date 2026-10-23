import * as THREE from 'three';

// Čas animace v sekundách, sdílený všemi materiály s vodou
const time = { value: 0 };

const VERTEX = /* glsl */ `
varying vec3 vWaterPosition;
varying float vWaterUp;
`;

// Vlnky z několika posunutých sinusů ve světových souřadnicích (dlaždice = 1) a záblesky na hřebenech;
// při oddálení, kdy by vlnky byly menší než pár pixelů, se ztlumí, aby se netřpytily
const FRAGMENT = /* glsl */ `
uniform float waterTime;
varying vec3 vWaterPosition;
varying float vWaterUp;

void applyWater(inout vec3 color) {
  vec2 p = vWaterPosition.xz;
  float t = waterTime;
  float wave =
    sin(p.x * 5.0 + t * 1.1 + sin(p.y * 3.0 + t * 0.6) * 1.5) +
    sin(p.y * 6.0 - t * 0.9 + sin(p.x * 2.5 - t * 0.5) * 1.5);
  // Drobné záblesky slunce v menším měřítku než vlnky, zdeformované vlnou, aby netvořily mřížku
  vec2 g = p + wave * 0.12;
  float glint = sin(g.x * 11.0 + g.y * 7.0 + t * 1.7) * sin(g.y * 9.0 - g.x * 5.0 - t * 1.3);
  float detail = smoothstep(0.25, 0.06, length(fwidth(p)));
  color *= 1.0 + wave * 0.04 * detail;
  color = mix(color, vec3(0.8, 0.9, 0.97), smoothstep(0.88, 0.98, glint) * smoothstep(0.5, 1.5, wave) * 0.4 * detail);
}
`;

// Doplní materiálu animovanou hladinu na vodorovné plochy pod úrovní surfaceY
export function withWater(material: THREE.Material, surfaceY: number): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.vertexShader =
      VERTEX +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWaterUp = normal.y;',
      );
    shader.fragmentShader =
      FRAGMENT +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\nif (vWaterUp > 0.5 && vWaterPosition.y < ${surfaceY.toFixed(4)}) applyWater(diffuseColor.rgb);`,
      );
  };
  material.customProgramCacheKey = () => 'water';
  return material;
}

// Posune animaci vody; stačí jednou za snímek
export function updateWater(seconds: number): void {
  time.value = seconds;
}
