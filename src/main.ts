import * as THREE from 'three';
import './style.css';
import { loadModel } from './assets';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d8);

// Izometrická ortografická kamera
const viewSize = 10;
const camera = new THREE.OrthographicCamera();
camera.position.set(20, 20, 20);
camera.lookAt(0, 0, 0);

function resize(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -viewSize * aspect;
  camera.right = viewSize * aspect;
  camera.top = viewSize;
  camera.bottom = -viewSize;
  camera.near = -1000;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(10, 20, 5);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x5f9e3c }),
);
scene.add(ground);

// Ověření načítání assetů
loadModel('train kit', 'train-locomotive-a').then((model) => scene.add(model));

renderer.setAnimationLoop(() => renderer.render(scene, camera));
