import * as THREE from 'three';

// Čas animace v sekundách, sdílený všemi materiály s vodou
const time = { value: 0 };
// Zamrznutí hladiny 0 (voda) až 1 (celá pod ledem)
const ice = { value: 0 };

const VERTEX = /* glsl */ `
varying vec3 vWaterPosition;
varying float vWaterUp;
`;

// Vlnky z několika posunutých sinusů ve světových souřadnicích (dlaždice = 1) a záblesky na hřebenech;
// při oddálení, kdy by vlnky byly menší než pár pixelů, se ztlumí, aby se netřpytily.
// V zimě hladinu překryje led: čirý modravý na hloubce, zasněžený u břehu, s prasklinami mezi krami.
// Zamrzá po ostrůvcích od břehu; pod souvislým ledem se vlnky vůbec nepočítají.
const FRAGMENT = /* glsl */ `
uniform float waterTime;
uniform float waterIce;
varying vec3 vWaterPosition;
varying float vWaterUp;

float iceHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 iceHash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

float iceNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(iceHash(i), iceHash(i + vec2(1.0, 0.0)), u.x),
    mix(iceHash(i + vec2(0.0, 1.0)), iceHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Vzdálenost k hraně nejbližší Voronoiovy buňky, hrany tvoří praskliny mezi krami
float iceCracks(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float d = length(g + iceHash2(i + g) - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return d2 - d1;
}

// Prasklina šířky width, vyhlazená podle velikosti pixelu ve světových souřadnicích
float iceCrackLine(vec2 p, float scale, float width, float pixel) {
  float aa = pixel * scale * 1.5;
  return 1.0 - smoothstep(width, width + aa, iceCracks(p * scale));
}

vec3 iceColor(vec2 p, float shallow, float detail, float pixel) {
  float drift = iceNoise(p * 1.3) * 0.6 + iceNoise(p * 4.1) * 0.4;
  float snow = clamp(shallow * 0.55 + smoothstep(0.5, 0.82, drift) * 0.75, 0.0, 1.0);
  vec3 color = mix(vec3(0.36, 0.53, 0.67), vec3(0.72, 0.81, 0.87), snow);
  // Šmouhy a bublinky zamrzlé v ledu
  color *= 1.0 + (iceNoise(vec2(p.x * 9.0 + p.y * 2.0, p.y * 1.7)) - 0.5) * 0.1 * detail;
  float cracks = iceCrackLine(p, 1.4, 0.035, pixel) * 0.7 + iceCrackLine(p, 4.2, 0.02, pixel) * 0.18 * detail;
  return mix(color, vec3(0.2, 0.33, 0.47), clamp(cracks, 0.0, 1.0) * (1.0 - snow * 0.7));
}

void applyWater(inout vec3 color) {
  vec2 p = vWaterPosition.xz;
  float t = waterTime;
  float pixel = length(fwidth(p));
  float detail = smoothstep(0.25, 0.06, pixel);
  // Mělčina u břehu je světlejší než hloubka
  float shallow = smoothstep(0.22, 0.34, dot(color, vec3(1.0 / 3.0)));
  float frozen = 0.0;
  if (waterIce > 0.0) {
    float freezeOrder = iceNoise(p * 0.35) * 0.7 + (1.0 - shallow) * 0.3;
    frozen = smoothstep(0.0, 0.1, waterIce * 1.1 - freezeOrder);
  }
  if (frozen < 1.0) {
    float wave =
      sin(p.x * 5.0 + t * 1.1 + sin(p.y * 3.0 + t * 0.6) * 1.5) +
      sin(p.y * 6.0 - t * 0.9 + sin(p.x * 2.5 - t * 0.5) * 1.5);
    // Drobné záblesky slunce v menším měřítku než vlnky, zdeformované vlnou, aby netvořily mřížku
    vec2 g = p + wave * 0.12;
    float glint = sin(g.x * 11.0 + g.y * 7.0 + t * 1.7) * sin(g.y * 9.0 - g.x * 5.0 - t * 1.3);
    float open = (1.0 - frozen) * detail;
    color *= 1.0 + wave * 0.04 * open;
    color = mix(color, vec3(0.8, 0.9, 0.97), smoothstep(0.88, 0.98, glint) * smoothstep(0.5, 1.5, wave) * 0.4 * open);
  }
  if (frozen > 0.0) color = mix(color, iceColor(p, shallow, detail, pixel), frozen);
}
`;

// Doplní materiálu animovanou hladinu na vodorovné plochy pod úrovní surfaceY
export function withWater(material: THREE.Material, surfaceY: number): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.waterIce = ice;
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

// Zamrznutí všech vodních ploch 0 až 1
export function setWaterIce(amount: number): void {
  ice.value = amount;
}
