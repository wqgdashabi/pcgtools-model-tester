/* eslint-disable */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Stats from 'stats.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'

let camera, scene, renderer, orbitControls
/** 仅保留一盏环境光，不可动态添加 */
let ambientLight = null
/** 动态光源条目：push 进数组，每个含 light + helper + lil-gui 子文件夹 */
let hemiLightEntries = []
let pointLightEntries = []
let directionalLightEntries = []
let sceneGui = null
let guiFolderHemi = null
let guiFolderPoint = null
let guiFolderDir = null
let rootObject = null
let selectedUuid = null
let selectionBoxHelper = null

const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
let pickDragStartX = 0
let pickDragStartY = 0
const PICK_DRAG_PX = 8

/** 虚拟材质槽节点 uuid：`meshUuid::__mat__::index`（非 Three 对象 id） */
const MAT_SLOT_SEP = '::__mat__::'
const stats = new Stats()
const textureLoader = new THREE.TextureLoader()
const fbxLoader = new FBXLoader()
const gltfLoader = new GLTFLoader()

let _onError = null
let _onModelLoaded = null
let _onTextureApplied = null
let _onSelectionChanged = null

function clearSelectionBoxHelper() {
  if (!selectionBoxHelper || !scene) return
  scene.remove(selectionBoxHelper)
  selectionBoxHelper.dispose?.()
  selectionBoxHelper = null
}

function updateSelectionBoxHelper(mesh) {
  clearSelectionBoxHelper()
  if (!mesh || !scene) return
  selectionBoxHelper = new THREE.BoxHelper(mesh, 0xffcc00)
  scene.add(selectionBoxHelper)
}

function handlePickPointerDown(e) {
  if (e.button !== 0) return
  pickDragStartX = e.clientX
  pickDragStartY = e.clientY
}

function handlePickPointerUp(e) {
  if (e.button !== 0) return
  if (!renderer || !rootObject || !camera) return
  const dx = e.clientX - pickDragStartX
  const dy = e.clientY - pickDragStartY
  if (dx * dx + dy * dy > PICK_DRAG_PX * PICK_DRAG_PX) return

  const rect = renderer.domElement.getBoundingClientRect()
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(pointerNdc, camera)
  const hits = raycaster.intersectObject(rootObject, true)
  const hit = hits.find((h) => h.object.isMesh || h.object.isSkinnedMesh)
  if (!hit) {
    setSelectedUuid(null)
    _onSelectionChanged && _onSelectionChanged(null)
    return
  }

  const mesh = hit.object
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  let uuid = mesh.uuid
  if (mats.length > 1 && hit.face && typeof hit.face.materialIndex === 'number') {
    uuid = `${mesh.uuid}${MAT_SLOT_SEP}${hit.face.materialIndex}`
  }
  setSelectedUuid(uuid)
  _onSelectionChanged && _onSelectionChanged(uuid)
}

function frameObject(obj) {
  if (!obj) return
  const box = new THREE.Box3().setFromObject(obj)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.01)
  const dist = maxDim * 2.2
  camera.position.set(center.x + dist * 0.6, center.y + dist * 0.35, center.z + dist * 0.6)
  orbitControls.target.copy(center)
  orbitControls.update()
}

function findFirstMesh(start) {
  if (!start) return null
  if (start.isMesh || start.isSkinnedMesh) return start
  for (const c of start.children) {
    const m = findFirstMesh(c)
    if (m) return m
  }
  return null
}

function findObjectByUuid(root, uuid) {
  let found = null
  root.traverse((o) => {
    if (o.uuid === uuid) found = o
  })
  return found
}

function parseMaterialSlotUuid(uuid) {
  if (!uuid) return { baseUuid: '', materialIndex: 0 }
  const i = uuid.indexOf(MAT_SLOT_SEP)
  if (i === -1) return { baseUuid: uuid, materialIndex: 0 }
  return {
    baseUuid: uuid.slice(0, i),
    materialIndex: parseInt(uuid.slice(i + MAT_SLOT_SEP.length), 10) || 0,
  }
}

/** 选中树节点 → 目标 Mesh + 材质槽索引（GLB/GLTF/gltf 逻辑相同） */
export function resolveMeshAndMaterialIndex(selUuid) {
  if (!rootObject || !selUuid) return { mesh: null, materialIndex: 0 }
  const { baseUuid, materialIndex } = parseMaterialSlotUuid(selUuid)
  const obj = findObjectByUuid(rootObject, baseUuid)
  if (!obj) return { mesh: findFirstMesh(rootObject), materialIndex: 0 }
  if (obj.isMesh || obj.isSkinnedMesh) return { mesh: obj, materialIndex }
  const mesh = findFirstMesh(obj) || findFirstMesh(rootObject)
  return { mesh, materialIndex: 0 }
}

function resolveTargetMesh(uuid) {
  return resolveMeshAndMaterialIndex(uuid).mesh
}

const TEX_KEYS_KEEP = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'lightMap', 'bumpMap']

function convertMaterialToStandard(first) {
  if (!first) return new THREE.MeshStandardMaterial()
  if (first.isMeshStandardMaterial) return first

  const std = new THREE.MeshStandardMaterial()
  if (first.color) std.color.copy(first.color)
  if (first.map) std.map = first.map
  if (first.normalMap) std.normalMap = first.normalMap
  if (first.roughness !== undefined) std.roughness = first.roughness
  if (first.metalness !== undefined) std.metalness = first.metalness
  if (first.emissive) std.emissive.copy(first.emissive)
  if (first.opacity !== undefined) std.opacity = first.opacity
  std.transparent = !!(first.transparent || (first.opacity !== undefined && first.opacity < 1))
  std.roughness = std.roughness ?? 0.55
  std.metalness = std.metalness ?? 0.05

  for (const k of TEX_KEYS_KEEP) {
    if (first[k] && !std[k]) std[k] = first[k]
  }

  for (const k of TEX_KEYS_KEEP) {
    if (first[k]) first[k] = null
  }
  first.dispose?.()
  return std
}

/** 保留材质数组，逐槽升级为 MeshStandard（不再合并成单个材质） */
function upgradeMeshMaterialsToStandard(mesh) {
  if (!mesh?.isMesh && !mesh?.isSkinnedMesh) return
  const wasArray = Array.isArray(mesh.material)
  const mats = wasArray ? mesh.material : [mesh.material]
  const next = mats.map((m) => convertMaterialToStandard(m))
  mesh.material = wasArray ? next : next[0]
}

function ensureStandardMaterialAt(mesh, materialIndex) {
  if (!mesh) return null
  upgradeMeshMaterialsToStandard(mesh)
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const idx = Math.min(Math.max(0, materialIndex | 0), mats.length - 1)
  const mat = mats[idx]
  return mat?.isMeshStandardMaterial ? mat : null
}

function setSelectionHighlight(selUuid) {
  if (!rootObject) return
  const { mesh: selectedMesh } = resolveMeshAndMaterialIndex(selUuid)
  rootObject.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return
    const highlight = !!(selectedMesh && child.uuid === selectedMesh.uuid)
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of mats) {
      if (!m?.isMeshStandardMaterial) continue
      if (highlight) {
        m.emissive.setHex(0x224422)
        m.emissiveIntensity = 0.35
      } else {
        m.emissive.setHex(0x000000)
        m.emissiveIntensity = 1
      }
    }
  })
}

function removeHemisphereEntry(entry) {
  const i = hemiLightEntries.indexOf(entry)
  if (i >= 0) hemiLightEntries.splice(i, 1)
  scene?.remove(entry.light)
  scene?.remove(entry.helper)
  entry.helper.dispose?.()
  entry.folder?.destroy?.()
}

function removePointEntry(entry) {
  const i = pointLightEntries.indexOf(entry)
  if (i >= 0) pointLightEntries.splice(i, 1)
  scene?.remove(entry.light)
  scene?.remove(entry.helper)
  entry.helper.dispose?.()
  entry.folder?.destroy?.()
}

function removeDirectionalEntry(entry) {
  const i = directionalLightEntries.indexOf(entry)
  if (i >= 0) directionalLightEntries.splice(i, 1)
  scene?.remove(entry.light.target)
  scene?.remove(entry.light)
  scene?.remove(entry.helper)
  entry.helper.dispose?.()
  entry.folder?.destroy?.()
}

function pushHemisphereLight() {
  const light = new THREE.HemisphereLight(0xffffff, 0xd7deea, 1.4)
  light.position.set(0, -0.6, 0.3)
  light.visible = true
  const helper = new THREE.HemisphereLightHelper(light, 1, 0x009900)
  helper.visible = true
  scene.add(light)
  scene.add(helper)

  const entry = { light, helper, folder: null, params: {} }
  hemiLightEntries.push(entry)

  const n = hemiLightEntries.length
  const folder = guiFolderHemi.addFolder(`半球光 #${n}`)
  entry.folder = folder

  entry.params = {
    visible: light.visible,
    intensity: light.intensity,
    skyColor: `#${light.color.getHexString()}`,
    groundColor: `#${light.groundColor.getHexString()}`,
    x: light.position.x,
    y: light.position.y,
    z: light.position.z,
    helperVisible: helper.visible,
    remove: () => removeHemisphereEntry(entry),
  }

  folder.add(entry.params, 'visible').name('light visible').onChange((v) => {
    light.visible = v
    helper.visible = v && entry.params.helperVisible
  })
  folder.add(entry.params, 'helperVisible').name('helper visible').onChange((v) => {
    entry.params.helperVisible = v
    helper.visible = v && light.visible
  })
  folder
    .add(entry.params, 'intensity', 0, 10, 0.1)
    .name('intensity')
    .onChange((v) => {
      light.intensity = v
    })
  folder.addColor(entry.params, 'skyColor').name('sky color').onChange((v) => {
    light.color.set(v)
    helper.update()
  })
  folder.addColor(entry.params, 'groundColor').name('ground color').onChange((v) => {
    light.groundColor.set(v)
    helper.update()
  })
  ;['x', 'y', 'z'].forEach((axis) => {
    folder
      .add(entry.params, axis, -20, 20, 0.1)
      .name(axis)
      .onChange((v) => {
        light.position[axis] = v
        helper.update()
      })
  })
  folder.add(entry.params, 'remove').name('移除此光')

  folder.open()
}

function pushPointLight() {
  const light = new THREE.PointLight(0xffffff, 2, 50)
  light.position.set(-12, 2, 8)
  light.visible = true
  const helper = new THREE.PointLightHelper(light, 0.6, 0xff5533)
  helper.visible = true
  scene.add(light)
  scene.add(helper)

  const entry = { light, helper, folder: null, params: {} }
  pointLightEntries.push(entry)

  const n = pointLightEntries.length
  const folder = guiFolderPoint.addFolder(`点光源 #${n}`)
  entry.folder = folder

  entry.params = {
    visible: light.visible,
    intensity: light.intensity,
    distance: light.distance,
    color: `#${light.color.getHexString()}`,
    x: light.position.x,
    y: light.position.y,
    z: light.position.z,
    helperVisible: helper.visible,
    remove: () => removePointEntry(entry),
  }

  folder.add(entry.params, 'visible').name('light visible').onChange((v) => {
    light.visible = v
    helper.visible = v && entry.params.helperVisible
  })
  folder.add(entry.params, 'helperVisible').name('helper visible').onChange((v) => {
    entry.params.helperVisible = v
    helper.visible = v && light.visible
  })
  folder
    .add(entry.params, 'intensity', 0, 20, 0.1)
    .name('intensity')
    .onChange((v) => {
      light.intensity = v
    })
  folder
    .add(entry.params, 'distance', 0, 200, 1)
    .name('distance')
    .onChange((v) => {
      light.distance = v
      helper.update()
    })
  folder.addColor(entry.params, 'color').name('color').onChange((v) => {
    light.color.set(v)
    helper.update()
  })
  ;['x', 'y', 'z'].forEach((axis) => {
    folder
      .add(entry.params, axis, -30, 30, 0.1)
      .name(axis)
      .onChange((v) => {
        light.position[axis] = v
        helper.update()
      })
  })
  folder.add(entry.params, 'remove').name('移除此光')

  folder.open()
}

function pushDirectionalLight() {
  const light = new THREE.DirectionalLight(0xffffff, 1)
  light.position.set(5, 5, -8)
  light.castShadow = true
  light.shadow.mapSize.width = 2048
  light.shadow.mapSize.height = 2048
  light.shadow.bias = -0.001
  light.shadow.camera.top = 18
  light.shadow.camera.bottom = -10
  light.shadow.camera.left = -12
  light.shadow.camera.right = 12
  light.visible = true

  const helper = new THREE.DirectionalLightHelper(light, 2, 0x00aaff)
  helper.visible = true
  scene.add(light.target)
  scene.add(light)
  scene.add(helper)

  const entry = { light, helper, folder: null, params: {} }
  directionalLightEntries.push(entry)

  const n = directionalLightEntries.length
  const folder = guiFolderDir.addFolder(`平行光 #${n}`)
  entry.folder = folder

  entry.params = {
    visible: light.visible,
    intensity: light.intensity,
    color: `#${light.color.getHexString()}`,
    x: light.position.x,
    y: light.position.y,
    z: light.position.z,
    castShadow: light.castShadow,
    helperVisible: helper.visible,
    remove: () => removeDirectionalEntry(entry),
  }

  folder.add(entry.params, 'visible').name('light visible').onChange((v) => {
    light.visible = v
    helper.visible = v && entry.params.helperVisible
  })
  folder.add(entry.params, 'helperVisible').name('helper visible').onChange((v) => {
    entry.params.helperVisible = v
    helper.visible = v && light.visible
  })
  folder.add(entry.params, 'castShadow').name('cast shadow').onChange((v) => {
    light.castShadow = v
  })
  folder
    .add(entry.params, 'intensity', 0, 10, 0.1)
    .name('intensity')
    .onChange((v) => {
      light.intensity = v
    })
  folder.addColor(entry.params, 'color').name('color').onChange((v) => {
    light.color.set(v)
    helper.update()
  })
  ;['x', 'y', 'z'].forEach((axis) => {
    folder
      .add(entry.params, axis, -30, 30, 0.1)
      .name(axis)
      .onChange((v) => {
        light.position[axis] = v
        helper.update()
      })
  })
  folder.add(entry.params, 'remove').name('移除此光')

  folder.open()
}

function setupLightGui(container) {
  if (!container) return

  const lightMap = {
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,

    ambientVisible: ambientLight.visible,
    ambientIntensity: ambientLight.intensity,
    ambientColor: `#${ambientLight.color.getHexString()}`,
  }

  sceneGui = new GUI({
    title: 'Controls',
    container,
    autoPlace: false,
  })
  sceneGui.domElement.style.width = '100%'
  sceneGui.domElement.style.maxWidth = '100%'

  sceneGui
    .add(lightMap, 'toneMapping', {
      No: THREE.NoToneMapping,
      Linear: THREE.LinearToneMapping,
      Reinhard: THREE.ReinhardToneMapping,
      Cineon: THREE.CineonToneMapping,
      ACESFilmic: THREE.ACESFilmicToneMapping,
      Custom: THREE.CustomToneMapping,
    })
    .onChange((value) => {
      renderer.toneMapping = value
    })
  sceneGui.add(lightMap, 'toneMappingExposure', 0, 2, 0.01).onChange((value) => {
    renderer.toneMappingExposure = value
  })

  const ambientFolder = sceneGui.addFolder('Ambient Light(环境光全局固定一个)')
  ambientFolder.add(lightMap, 'ambientVisible').name('visible').onChange((v) => {
    ambientLight.visible = v
  })
  ambientFolder
    .add(lightMap, 'ambientIntensity', 0, 10, 0.1)
    .name('intensity')
    .onChange((v) => {
      ambientLight.intensity = v
    })
  ambientFolder.addColor(lightMap, 'ambientColor').name('color').onChange((v) => {
    ambientLight.color.set(v)
  })

  guiFolderHemi = sceneGui.addFolder('Hemisphere Lights (半球光)')
  guiFolderHemi.add({ add: pushHemisphereLight }, 'add').name('+ 添加半球光')

  guiFolderPoint = sceneGui.addFolder('Point Lights (点光)')
  guiFolderPoint.add({ add: pushPointLight }, 'add').name('+ 添加点光源')

  guiFolderDir = sceneGui.addFolder('Directional Lights (平行光)')
  guiFolderDir.add({ add: pushDirectionalLight }, 'add').name('+ 添加平行光')

  ambientFolder.open()
  guiFolderHemi.open()
  guiFolderPoint.open()
  guiFolderDir.open()
  sceneGui.open()
}

export function main(DOM, { guiContainer, onError, onModelLoaded, onTextureApplied, onSelectionChanged } = {}) {
  _onError = onError ?? null
  _onModelLoaded = onModelLoaded ?? null
  _onTextureApplied = onTextureApplied ?? null
  _onSelectionChanged = onSelectionChanged ?? null

  const [width, height] = [DOM.clientWidth, DOM.clientHeight]

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  DOM.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)
  scene.fog = new THREE.Fog(0xa0a0a0, 160, 1000)

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000)
  camera.position.set(0, 2, 5)
  scene.add(camera)

  ambientLight = new THREE.AmbientLight(0xf0f0f0, 0.5)
  ambientLight.visible = true
  scene.add(ambientLight)

  hemiLightEntries = []
  pointLightEntries = []
  directionalLightEntries = []

  setupLightGui(guiContainer)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshBasicMaterial({ color: 0xfafafa, depthWrite: false })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const grid = new THREE.GridHelper(160, 60, 0x000000, 0x000000)
  grid.material.opacity = 0.2
  grid.material.transparent = true
  scene.add(grid)

  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.target.set(0, 1, 0)
  orbitControls.update()

  renderer.domElement.addEventListener('pointerdown', handlePickPointerDown)
  renderer.domElement.addEventListener('pointerup', handlePickPointerUp)

  const statContainer = document.getElementsByClassName('stat-container')[0]
  if (statContainer) statContainer.appendChild(stats.dom)

  render()
  window.addEventListener('resize', onResize)
}

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export async function loadModel(file) {
  const ext = extOf(file.name)
  const url = URL.createObjectURL(file)
  try {
    let result = null
    if (ext === '.fbx') {
      result = await new Promise((resolve, reject) => {
        fbxLoader.load(url, resolve, undefined, reject)
      })
    } else if (ext === '.glb' || ext === '.gltf') {
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load(url, resolve, undefined, reject)
      })
      result = gltf.scene || gltf.scenes?.[0]
    } else {
      _onError && _onError('仅支持 .fbx / .glb / .gltf')
      URL.revokeObjectURL(url)
      return
    }
    URL.revokeObjectURL(url)

    if (rootObject) {
      scene.remove(rootObject)
      rootObject.traverse((child) => {
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach((m) => m?.dispose?.())
        }
        if (child.geometry) child.geometry.dispose()
      })
    }

    rootObject = result
    rootObject.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = true
        child.receiveShadow = true
        upgradeMeshMaterialsToStandard(child)
      }
    })
    scene.add(rootObject)
    const firstMesh = findFirstMesh(rootObject)
    setSelectedUuid(firstMesh ? firstMesh.uuid : null)
    frameObject(rootObject)
    _onModelLoaded && _onModelLoaded(file.name)
  } catch (e) {
    URL.revokeObjectURL(url)
    _onError && _onError(`加载模型失败: ${e?.message ?? e}`)
  }
}

const SLOT_COLOR_SPACE = {
  map: THREE.SRGBColorSpace,
  emissiveMap: THREE.SRGBColorSpace,
  normalMap: THREE.NoColorSpace,
  roughnessMap: THREE.NoColorSpace,
  metalnessMap: THREE.NoColorSpace,
  aoMap: THREE.NoColorSpace,
}

export async function applyTextureToSelection(file, slot) {
  if (!rootObject) {
    _onError && _onError('请先上传模型')
    return
  }
  const { mesh, materialIndex } = resolveMeshAndMaterialIndex(selectedUuid)
  if (!mesh) {
    _onError && _onError('未找到可用网格')
    return
  }
  const mat = ensureStandardMaterialAt(mesh, materialIndex)
  if (!mat) return

  const texUrl = URL.createObjectURL(file)
  try {
    const tex = await new Promise((resolve, reject) => {
      textureLoader.load(texUrl, resolve, undefined, reject)
    })
    URL.revokeObjectURL(texUrl)

    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = SLOT_COLOR_SPACE[slot] ?? THREE.NoColorSpace
    tex.needsUpdate = true

    const old = mat[slot]
    if (old && old.isTexture) old.dispose()
    mat[slot] = tex

    if (slot === 'normalMap') mat.normalScale = new THREE.Vector2(1, 1)
    if (slot === 'aoMap' && mesh.geometry && !mesh.geometry.attributes.uv2) {
      _onError && _onError('AO 贴图需要 UV2，当前几何体可能无第二套 UV')
    }

    mat.needsUpdate = true
    setSelectionHighlight(selectedUuid)
    _onTextureApplied && _onTextureApplied(slot, file.name)
  } catch (e) {
    URL.revokeObjectURL(texUrl)
    _onError && _onError(`贴图加载失败: ${e?.message ?? e}`)
  }
}

export function setSelectedUuid(uuid) {
  selectedUuid = uuid ?? null
  setSelectionHighlight(selectedUuid)
  const { mesh } = selectedUuid ? resolveMeshAndMaterialIndex(selectedUuid) : { mesh: null }
  updateSelectionBoxHelper(mesh)
}

export function getSelectedUuid() {
  return selectedUuid
}

export function getMaterialPbr() {
  const { mesh, materialIndex } = resolveMeshAndMaterialIndex(selectedUuid)
  if (!mesh) return { roughness: 0.5, metalness: 0, valid: false }
  const mat = ensureStandardMaterialAt(mesh, materialIndex)
  if (!mat) return { roughness: 0.5, metalness: 0, valid: false }
  return { roughness: mat.roughness, metalness: mat.metalness, valid: true }
}

export function setMaterialRoughness(v) {
  const { mesh, materialIndex } = resolveMeshAndMaterialIndex(selectedUuid)
  if (!mesh) return
  const mat = ensureStandardMaterialAt(mesh, materialIndex)
  if (!mat) return
  mat.roughness = Math.min(1, Math.max(0, Number(v)))
  mat.needsUpdate = true
}

export function setMaterialMetalness(v) {
  const { mesh, materialIndex } = resolveMeshAndMaterialIndex(selectedUuid)
  if (!mesh) return
  const mat = ensureStandardMaterialAt(mesh, materialIndex)
  if (!mat) return
  mat.metalness = Math.min(1, Math.max(0, Number(v)))
  mat.needsUpdate = true
}

function buildTree(obj) {
  const kids = obj.children && obj.children.length ? obj.children.map(buildTree) : []
  if (obj.isMesh || obj.isSkinnedMesh) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    if (mats.length > 1) {
      for (let i = 0; i < mats.length; i++) {
        const slotName = mats[i]?.name ? String(mats[i].name) : `材质 ${i + 1}`
        kids.push({
          uuid: `${obj.uuid}${MAT_SLOT_SEP}${i}`,
          name: slotName,
          type: 'MaterialSlot',
          children: [],
        })
      }
    }
  }
  return {
    uuid: obj.uuid,
    name: obj.name || '',
    type: obj.type,
    children: kids,
  }
}

export function getModelTree() {
  if (!rootObject) return null
  return buildTree(rootObject)
}

/** 供外部（如 Vue 按钮）与 lil-gui 「+ 添加」共用：往场景与数组里追加光源 */
export { pushHemisphereLight, pushPointLight, pushDirectionalLight }

function render() {
  if (!renderer) return
  if (selectionBoxHelper) selectionBoxHelper.update()
  renderer.render(scene, camera)
  requestAnimationFrame(render)
  stats.update()
}

function onResize() {
  if (!renderer) return
  const rootDOM = renderer.domElement.parentNode
  const [width, height] = [rootDOM.clientWidth, rootDOM.clientHeight]
  renderer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  orbitControls.update()
}

export function dispose() {
  window.removeEventListener('resize', onResize)
  if (renderer?.domElement) {
    renderer.domElement.removeEventListener('pointerdown', handlePickPointerDown)
    renderer.domElement.removeEventListener('pointerup', handlePickPointerUp)
  }
  clearSelectionBoxHelper()
  _onSelectionChanged = null
  if (sceneGui) {
    sceneGui.destroy()
    sceneGui = null
  }
  guiFolderHemi = guiFolderPoint = guiFolderDir = null

  function releaseDynamicLightEntry(e) {
    if (!scene || !e) return
    if (e.light?.isDirectionalLight && e.light.target) {
      scene.remove(e.light.target)
    }
    scene.remove(e.light)
    scene.remove(e.helper)
    e.helper.dispose?.()
  }
  hemiLightEntries.forEach(releaseDynamicLightEntry)
  hemiLightEntries = []
  pointLightEntries.forEach(releaseDynamicLightEntry)
  pointLightEntries = []
  directionalLightEntries.forEach(releaseDynamicLightEntry)
  directionalLightEntries = []

  ambientLight = null
  if (scene) {
    scene.traverse((child) => {
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        mats.forEach((m) => {
          if (!m) return
          for (const k of Object.keys(m)) {
            const v = m[k]
            if (v && v.isTexture) v.dispose()
          }
          m.dispose?.()
        })
      }
      if (child.geometry) child.geometry.dispose()
    })
    scene.clear()
    scene = null
  }
  if (renderer) {
    renderer.forceContextLoss()
    renderer.dispose()
    renderer.domElement = null
    renderer = null
  }
  rootObject = null
  selectedUuid = null
  orbitControls = null
  camera = null
  _onError = null
  _onModelLoaded = null
  _onTextureApplied = null
}
