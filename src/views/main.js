/* eslint-disable */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export function run(DOM = null) {
  init(DOM);
}

let scene, camera, renderer, controls
let groundMesh, groundMaterial
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

const groundVertexShader = /* glsl */ `
  varying vec2 vWorldXZ;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldXZ = worldPos.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const groundFragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform float uBaseAlpha;
  uniform vec3 uRingColor;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uThickness;
  uniform float uOpacity;
  varying vec2 vWorldXZ;

  void main() {
    float d = length(vWorldXZ - uCenter);
    float ringDist = abs(d - uRadius);
    float aa = fwidth(d) * 1.5;
    float ring = 1.0 - smoothstep(uThickness * 0.5 - aa, uThickness * 0.5 + aa, ringDist);

    vec3 color = mix(uBaseColor, uRingColor, ring);
    float alpha = mix(uBaseAlpha, 1.0, ring);
    gl_FragColor = vec4(color, alpha);
  }
`

function init(DOM) {

  const [width, height] = [DOM.clientWidth, DOM.clientHeight];
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  DOM.appendChild(renderer.domElement);

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xa0a0a0)
  scene.fog = new THREE.Fog(0xa0a0a0, 120, 1000)

  camera = new THREE.PerspectiveCamera(45, width / height, 1, 4000);
  camera.position.set(0, 0, 15)
  scene.add(camera);

  const material = new THREE.MeshNormalMaterial({
    flatShading: true, // 方便我们看到每个面的颜色
  });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  groundMaterial = new THREE.ShaderMaterial({
    vertexShader: groundVertexShader,
    fragmentShader: groundFragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBaseColor: { value: new THREE.Color(0xf0f0f0) },
      uBaseAlpha: { value: 0.7 },
      uRingColor: { value: new THREE.Color(0xff3333) },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRadius: { value: 0.3 },
      uThickness: { value: 0.01 },
      uOpacity: { value: 0.0 },
    },
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), groundMaterial)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  scene.add(mesh)
  groundMesh = mesh

  const grid = new THREE.GridHelper(40, 40, 0x000000, 0x000000)
  grid.material.opacity = 0.1
  grid.material.transparent = true
  scene.add(grid)


  controls = new OrbitControls(camera, renderer.domElement);

  renderer.domElement.addEventListener("mousemove", onPointerMove);
  renderer.domElement.addEventListener("click", onClick);

  render();
  window.addEventListener("resize", onResize);
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function intersectGround(event) {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(groundMesh, false);
  return hits[0] || null;
}

function onPointerMove(event) {
  const hit = intersectGround(event);
  if (hit) {
    groundMaterial.uniforms.uCenter.value.set(hit.point.x, hit.point.z);
    groundMaterial.uniforms.uOpacity.value = 1.0;
  } else {
    groundMaterial.uniforms.uOpacity.value = 0.0;
  }
}

function onClick(event) {
  const hit = intersectGround(event);
  if (hit) {
    console.log("World coords:", hit.point.x, hit.point.y, hit.point.z);
  }
}

function render() {
  if (!renderer) return
  renderer.render(scene, camera)
  requestAnimationFrame(render)
}


function onResize() {
  let rootDOM = renderer.domElement.parentNode
  const [width, height] = [rootDOM.clientWidth, rootDOM.clientHeight];
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  controls.update();
}

export function dispose() {
  window.removeEventListener("resize", onResize);
  if (renderer) {
    renderer.domElement.removeEventListener("mousemove", onPointerMove);
    renderer.domElement.removeEventListener("click", onClick);
  }
  if (scene) {
    scene.traverse((child) => {
      if (child.material) {
        child.material.dispose();
      }
      if (child.geometry) {
        child.geometry.dispose();
      }
      child = null;
    });
    scene.clear();
    scene = null;
  }
  if (renderer) {
    renderer.forceContextLoss();
    renderer.dispose();
    renderer.domElement = null;
    renderer = null;
  }
}
