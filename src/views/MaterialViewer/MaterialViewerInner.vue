<template>
  <section class="wrapper">
    <div class="canvas-mount" ref="mountRef"></div>
    <div class="stat-container"></div>

    <button
      class="panel-tab left-tab"
      :style="{ left: leftOpen ? LEFT_W + 32 + 'px' : '8px' }"
      type="button"
      @click="leftOpen = !leftOpen"
      :title="leftOpen ? '关闭层级面板' : '打开层级面板'"
    >
      {{ leftOpen ? '◀' : '▶' }}
    </button>

    <button
      class="panel-tab right-tab"
      :style="{ right: rightOpen ? RIGHT_W + 32 + 'px' : '8px' }"
      type="button"
      @click="rightOpen = !rightOpen"
      :title="rightOpen ? '关闭文件面板' : '打开文件面板'"
    >
      {{ rightOpen ? '▶' : '◀' }}
    </button>

    <aside class="scene-panel" :class="{ 'panel-hidden': !leftOpen }">
      <div class="left-section lights-block">
        <p class="subpanel-title">灯光</p>
        <div class="gui-container" ref="guiContainerRef"></div>
      </div>

      <div class="left-section hierarchy-block">
        <div class="hierarchy-head">
          <p class="subpanel-title">场景层级</p>
          <div v-if="modelFile" class="tree-toolbar">
            <button type="button" class="mini-btn" @click="expandAllNodes">展开</button>
            <button type="button" class="mini-btn" @click="collapseAllNodes">折叠</button>
          </div>
        </div>
        <p class="hierarchy-hint">
          GLB 与独立 .gltf 只是封装格式，场景结构一致。若只有 Scene→单个 Mesh，多半是 DCC
          导出时合并了几何体；角色骨架 FBX 仍会有多层 Bone。多材质网格会在下列出「材质槽」子节点。
          在画布上<strong>单击</strong>模型可选中并显示黄色包围盒线框（拖拽旋转视角；点击空白取消选中）。
        </p>
        <div v-if="!modelFile" class="hint center-hint">暂无模型，上传后将展示完整父子层级</div>
        <template v-else>
          <div class="tree-meta">共 {{ flatNodes.length }} 个节点</div>
          <div class="tree-scroll">
            <div
              v-for="node in flatNodes"
              :key="node.uuid"
              class="tree-node"
              :class="{ highlighted: node.uuid === selectedTreeUuid }"
              :style="{ paddingLeft: node.depth * 14 + 8 + 'px' }"
              @click="onPickNode(node)"
            >
              <span
                v-if="node.hasChildren"
                class="tree-arrow"
                @click.stop="toggleCollapse(node.uuid)"
                >{{ collapsedSet.has(node.uuid) ? '▶' : '▼' }}</span
              >
              <span v-else class="tree-arrow-placeholder"></span>
              <span class="node-badge" :class="`badge-${getTypeBadge(node.type)}`">
                {{ getTypeBadge(node.type) }}
              </span>
              <span class="node-name" :title="displayNodeLabel(node)">{{ displayNodeLabel(node) }}</span>
            </div>
          </div>
        </template>
      </div>
    </aside>

    <aside class="file-panel" :class="{ 'panel-hidden': !rightOpen }">
      <p class="panel-title">文件列表</p>

      <div class="panel-section">
        <span class="section-label">模型</span>
        <n-button size="tiny" type="info" @click="triggerModelUpload" :loading="modelLoading">
          上传模型 FBX / GLB
        </n-button>
        <input
          ref="modelInputRef"
          type="file"
          accept=".fbx,.glb,.gltf"
          class="hidden-input"
          @change="onModelFileChange"
        />
        <div
          class="drop-zone"
          :class="{ active: modelDragOver, disabled: modelLoading }"
          @dragenter.prevent="onModelDragEnter"
          @dragover.prevent="onModelDragEnter"
          @dragleave.prevent="onModelDragLeave"
          @drop.prevent="onDropModel"
        >
          拖拽 .fbx / .glb / .gltf 到这里上传
        </div>
        <div v-if="modelFile" class="file-item model-item">
          <span class="dot dot-model"></span>{{ modelFile }}
        </div>
      </div>

      <div class="panel-section pbr-section">
        <span class="section-label">PBR — MeshStandard</span>
        <p class="texture-hint">作用于左侧当前选中的网格或材质槽：调节粗糙度与金属度。</p>
        <div class="pbr-row">
          <span class="texture-label">roughness</span>
          <n-slider
            :value="pbrRoughness"
            :min="0"
            :max="1"
            :step="0.01"
            :disabled="!modelFile || !pbrValid"
            @update:value="onPbrRoughness"
          />
        </div>
        <div class="pbr-row">
          <span class="texture-label">metalness</span>
          <n-slider
            :value="pbrMetalness"
            :min="0"
            :max="1"
            :step="0.01"
            :disabled="!modelFile || !pbrValid"
            @update:value="onPbrMetalness"
          />
        </div>
      </div>

      <div class="panel-section texture-section">
        <span class="section-label">贴图 (作用于选中网格)</span>
        <p class="texture-hint">在左侧层级中点击要编辑的网格或材质槽；贴图写入对应 MeshStandard 槽位。</p>
        <div v-for="row in textureRows" :key="row.slot" class="texture-row">
          <div class="texture-row-head">
            <span class="texture-label">{{ row.label }}</span>
            <n-button size="tiny" type="success" tertiary :disabled="!modelFile" @click="triggerTexUpload(row.slot)">
              上传
            </n-button>
          </div>
          <input
            :ref="(el) => setTexInputRef(row.slot, el)"
            type="file"
            accept="image/*"
            class="hidden-input"
            @change="(e) => onTexFileChange(e, row.slot)"
          />
          <div
            class="drop-zone drop-zone-compact"
            :class="{ active: texDragSlot === row.slot, disabled: !modelFile || texLoading }"
            @dragenter.prevent="onTexDragEnter(row.slot)"
            @dragover.prevent="onTexDragEnter(row.slot)"
            @dragleave.prevent="onTexDragLeave(row.slot, $event)"
            @drop.prevent="(e) => onDropTex(e, row.slot)"
          >
            拖入图片
          </div>
          <p v-if="texNames[row.slot]" class="tex-file-name">
            <span class="dot dot-tex"></span>{{ texNames[row.slot] }}
          </p>
        </div>
        <p v-if="!modelFile" class="hint">请先上传模型</p>
      </div>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useMessage } from 'naive-ui'
import {
  main,
  dispose,
  loadModel,
  getModelTree,
  applyTextureToSelection,
  setSelectedUuid,
  getSelectedUuid,
  getMaterialPbr,
  setMaterialRoughness,
  setMaterialMetalness,
} from './materialPlayer.js'

const LEFT_W = 300
const RIGHT_W = 260

const message = useMessage()

const mountRef = ref<HTMLElement | null>(null)
const guiContainerRef = ref<HTMLElement | null>(null)
const modelInputRef = ref<HTMLInputElement | null>(null)
const texInputRefs = ref<Record<string, HTMLInputElement | null>>({})

const leftOpen = ref(true)
const rightOpen = ref(true)

const modelFile = ref('')
const modelLoading = ref(false)
const modelDragOver = ref(false)

const modelTree = ref<ReturnType<typeof getModelTree>>(null)
const collapsedUUIDs = ref(new Set<string>())
const selectedTreeUuid = ref<string | null>(null)

const texNames = ref<Record<string, string>>({})
const texDragSlot = ref<string | null>(null)
const texLoading = ref(false)

const pbrRoughness = ref(0.5)
const pbrMetalness = ref(0)
const pbrValid = ref(false)

function refreshPbr() {
  const p = getMaterialPbr()
  pbrValid.value = p.valid
  if (p.valid) {
    pbrRoughness.value = p.roughness
    pbrMetalness.value = p.metalness
  }
}

function onPbrRoughness(v: number) {
  pbrRoughness.value = v
  setMaterialRoughness(v)
}

function onPbrMetalness(v: number) {
  pbrMetalness.value = v
  setMaterialMetalness(v)
}

const textureRows = [
  { slot: 'map', label: '漫反射 (BaseColor)' },
  { slot: 'normalMap', label: '法线 (Normal)' },
  { slot: 'roughnessMap', label: '粗糙度 (R)' },
  { slot: 'metalnessMap', label: '金属度 (M)' },
  { slot: 'aoMap', label: '环境光遮蔽 (AO)' },
] as const

const collapsedSet = computed(() => collapsedUUIDs.value)

function flattenVisible(
  node: { uuid: string; name: string; type: string; children: unknown[] },
  depth: number,
  collapsed: Set<string>
) {
  const items: Array<{
    uuid: string
    name: string
    type: string
    depth: number
    hasChildren: boolean
  }> = []
  const children = (node.children ?? []) as typeof node[]
  const hasChildren = children.length > 0
  items.push({ uuid: node.uuid, name: node.name, type: node.type, depth, hasChildren })
  if (hasChildren && !collapsed.has(node.uuid)) {
    for (const child of children) {
      items.push(...flattenVisible(child, depth + 1, collapsed))
    }
  }
  return items
}

const flatNodes = computed(() => {
  if (!modelTree.value) return []
  return flattenVisible(modelTree.value as Parameters<typeof flattenVisible>[0], 0, collapsedUUIDs.value)
})

function toggleCollapse(uuid: string) {
  const s = new Set(collapsedUUIDs.value)
  s.has(uuid) ? s.delete(uuid) : s.add(uuid)
  collapsedUUIDs.value = s
}

const TYPE_BADGE: Record<string, string> = {
  Bone: 'B',
  SkinnedMesh: 'S',
  Mesh: 'M',
  Group: 'G',
  Scene: 'SC',
  Object3D: 'O',
  Line: 'L',
  LineSegments: 'LS',
  LineLoop: 'LL',
  Points: 'P',
  Sprite: 'Sp',
  PerspectiveCamera: 'C',
  OrthographicCamera: 'C',
  MaterialSlot: 'MT',
}
function getTypeBadge(type: string) {
  return TYPE_BADGE[type] ?? (type.length <= 3 ? type.toUpperCase() : type.charAt(0).toUpperCase())
}

/** 与参考图一致：类型徽章旁展示节点名（父子缩进由 depth 控制） */
function displayNodeLabel(node: { name: string; type: string }) {
  return node.name?.trim() ? node.name : '(unnamed)'
}

interface TreeNode {
  uuid: string
  name: string
  type: string
  children: TreeNode[]
}

function walkCollectExpandableUuids(node: TreeNode, acc: Set<string>) {
  if (node.children?.length) {
    acc.add(node.uuid)
    for (const c of node.children) walkCollectExpandableUuids(c, acc)
  }
}

function expandAllNodes() {
  collapsedUUIDs.value = new Set()
}

function collapseAllNodes() {
  if (!modelTree.value) return
  const s = new Set<string>()
  walkCollectExpandableUuids(modelTree.value as TreeNode, s)
  collapsedUUIDs.value = s
}

function setTexInputRef(slot: string, el: unknown) {
  const input = el as HTMLInputElement | null
  if (input) texInputRefs.value[slot] = input
  else delete texInputRefs.value[slot]
}

onMounted(() => {
  nextTick(() => {
    main(mountRef.value, {
      guiContainer: guiContainerRef.value ?? undefined,
      onError: (msg: string) =>
        message.error(msg, {
          duration: 5000,
        }),
      onModelLoaded: (name: string) => {
        modelFile.value = name
        texNames.value = {}
        collapsedUUIDs.value = new Set()
        modelTree.value = getModelTree()
        selectedTreeUuid.value = getSelectedUuid()
        refreshPbr()
        message.success(`模型已加载: ${name}`)
      },
      onTextureApplied: (slot: string, fileName: string) => {
        texNames.value = { ...texNames.value, [slot]: fileName }
        message.success(`已更新贴图: ${fileName}`)
      },
      onSelectionChanged: (uuid: string | null) => {
        selectedTreeUuid.value = uuid
        refreshPbr()
      },
    })
  })
})

onBeforeUnmount(() => dispose())

function onPickNode(node: { uuid: string }) {
  selectedTreeUuid.value = node.uuid
  setSelectedUuid(node.uuid)
  refreshPbr()
}

function triggerModelUpload() {
  if (modelInputRef.value) modelInputRef.value.value = ''
  modelInputRef.value?.click()
}

function triggerTexUpload(slot: string) {
  const el = texInputRefs.value[slot]
  if (el) el.value = ''
  el?.click()
}

function filterModelFiles(fileList: FileList | null) {
  return Array.from(fileList ?? []).filter((f) => {
    const n = f.name.toLowerCase()
    return n.endsWith('.fbx') || n.endsWith('.glb') || n.endsWith('.gltf')
  })
}

function filterImageFiles(fileList: FileList | null) {
  return Array.from(fileList ?? []).filter((f) => f.type.startsWith('image/'))
}

async function uploadModel(file: File) {
  modelLoading.value = true
  modelDragOver.value = false
  await loadModel(file)
  modelLoading.value = false
}

async function uploadTexture(file: File, slot: string) {
  texLoading.value = true
  texDragSlot.value = null
  await applyTextureToSelection(file, slot)
  texLoading.value = false
}

function onModelDragEnter() {
  if (modelLoading.value) return
  modelDragOver.value = true
}

function onModelDragLeave(e: DragEvent) {
  if (e.currentTarget instanceof HTMLElement && e.currentTarget.contains(e.relatedTarget as Node)) return
  modelDragOver.value = false
}

async function onDropModel(e: DragEvent) {
  if (modelLoading.value) return
  modelDragOver.value = false
  const [file] = filterModelFiles(e.dataTransfer?.files ?? null)
  if (!file) {
    message.warning('请拖入 .fbx / .glb / .gltf')
    return
  }
  await uploadModel(file)
}

async function onModelFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const [file] = filterModelFiles(input.files)
  if (!file) return
  await uploadModel(file)
}

function onTexDragEnter(slot: string) {
  if (!modelFile.value || texLoading.value) return
  texDragSlot.value = slot
}

function onTexDragLeave(slot: string, e: DragEvent) {
  if (e.currentTarget instanceof HTMLElement && e.currentTarget.contains(e.relatedTarget as Node)) return
  if (texDragSlot.value === slot) texDragSlot.value = null
}

async function onDropTex(e: DragEvent, slot: string) {
  if (!modelFile.value || texLoading.value) return
  texDragSlot.value = null
  const [file] = filterImageFiles(e.dataTransfer?.files ?? null)
  if (!file) {
    message.warning('请拖入图片文件')
    return
  }
  await uploadTexture(file, slot)
}

async function onTexFileChange(e: Event, slot: string) {
  const input = e.target as HTMLInputElement
  const [file] = filterImageFiles(input.files)
  if (!file) return
  await uploadTexture(file, slot)
}
</script>

<style scoped>
.wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.canvas-mount {
  width: 100%;
  height: 100%;
}

.stat-container {
  position: absolute;
  top: 0;
  left: 0;
}

.panel-tab {
  position: absolute;
  top: 20px;
  z-index: 20;
  width: 24px;
  height: 48px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 6px;
  background: rgb(20 20 26 / 0.9);
  color: #aaa;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    left 0.25s ease,
    right 0.25s ease,
    color 0.15s;
  padding: 0;
}

.panel-tab:hover {
  color: #fff;
  background: rgb(40 40 50 / 0.95);
}

.scene-panel,
.file-panel {
  position: absolute;
  top: 16px;
  bottom: 16px;
  z-index: 10;
  background: rgb(18 18 22 / 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 0;
  color: #d0d0d0;
  font-size: 12px;
  user-select: none;
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.scene-panel {
  left: 16px;
  width: 300px;
}

.left-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.lights-block {
  flex-shrink: 0;
  border-bottom: 1px solid rgb(255 255 255 / 0.1);
}

.hierarchy-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.subpanel-title {
  margin: 0;
  padding: 10px 12px 6px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.hierarchy-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-right: 8px;
}

.hierarchy-head .subpanel-title {
  padding-bottom: 4px;
}

.tree-toolbar {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.mini-btn {
  padding: 2px 8px;
  font-size: 10px;
  color: #aaa;
  background: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 4px;
  cursor: pointer;
}

.mini-btn:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.1);
}

.hierarchy-hint {
  margin: 0 12px 8px;
  font-size: 10px;
  line-height: 1.45;
  color: #666;
  flex-shrink: 0;
}

.tree-meta {
  padding: 0 12px 6px;
  font-size: 10px;
  color: #555;
  flex-shrink: 0;
}

.gui-container {
  flex-shrink: 0;
  max-height: 38vh;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 4px 10px 8px;
  scrollbar-width: thin;
  scrollbar-color: rgb(255 255 255 / 0.12) transparent;
}

.gui-container :deep(.lil-gui) {
  --name-width: 42%;
  width: 100%;
}

.scene-panel.panel-hidden {
  transform: translateX(calc(-100% - 24px));
  opacity: 0;
  pointer-events: none;
}

.file-panel {
  right: 16px;
  width: 260px;
}

.file-panel.panel-hidden {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  pointer-events: none;
}

.panel-title {
  margin: 0;
  padding: 12px 12px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-bottom: 1px solid rgb(255 255 255 / 0.1);
  flex-shrink: 0;
}

.tree-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-height: 0;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgb(255 255 255 / 0.1) transparent;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding-right: 8px;
  border-radius: 3px;
  transition: background 0.1s;
  cursor: pointer;
  white-space: nowrap;
}

.tree-node:hover {
  background: rgb(255 255 255 / 0.06);
}

.tree-node.highlighted {
  background: rgb(74 179 255 / 0.2);
  color: #9fd6ff;
}

.tree-arrow {
  width: 14px;
  font-size: 9px;
  color: #666;
  cursor: pointer;
  flex-shrink: 0;
  text-align: center;
  line-height: 22px;
}

.tree-arrow:hover {
  color: #ccc;
}

.tree-arrow-placeholder {
  width: 14px;
  flex-shrink: 0;
}

.node-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 3px;
  border-radius: 3px;
  letter-spacing: 0.02em;
  line-height: 1;
}

.badge-B {
  color: #ffb347;
  background: rgb(255 179 71 / 0.15);
}

.badge-S {
  color: #4ab3ff;
  background: rgb(74 179 255 / 0.15);
}

.badge-M {
  color: #00d4d4;
  background: rgb(0 212 212 / 0.15);
}

.badge-G {
  color: #aaa;
  background: rgb(170 170 170 / 0.1);
}

.badge-SC {
  color: #c084fc;
  background: rgb(192 132 252 / 0.15);
}

.badge-O {
  color: #ccc;
  background: rgb(200 200 200 / 0.08);
}

.node-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
}

.badge-LS,
.badge-SC,
.badge-Sp,
.badge-MT {
  font-size: 8px;
  padding: 1px 2px;
}

.center-hint {
  padding: 24px 12px;
  text-align: center;
}

.pbr-section .pbr-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.pbr-section .pbr-row:last-child {
  margin-bottom: 0;
}

.pbr-section :deep(.n-slider) {
  margin-top: 2px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
}

.texture-section {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #666;
  font-weight: 600;
}

.texture-hint {
  margin: 0 0 4px;
  font-size: 10px;
  line-height: 1.45;
  color: #666;
}

.texture-row {
  margin-bottom: 8px;
}

.texture-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.texture-label {
  font-size: 11px;
  color: #aaa;
}

.hidden-input {
  display: none;
}

.drop-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 8px;
  border: 1px dashed rgb(255 255 255 / 0.16);
  border-radius: 6px;
  background: rgb(255 255 255 / 0.02);
  color: #777;
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
  transition:
    border-color 0.15s,
    background 0.15s,
    color 0.15s;
}

.drop-zone-compact {
  min-height: 36px;
  padding: 4px 6px;
  font-size: 10px;
}

.drop-zone.active {
  border-color: rgb(93 255 150 / 0.7);
  background: rgb(93 255 150 / 0.08);
  color: #9bffc0;
}

.drop-zone.disabled {
  opacity: 0.45;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  background: rgb(255 255 255 / 0.04);
  word-break: break-all;
  line-height: 1.4;
  font-size: 12px;
}

.tex-file-name {
  margin: 2px 0 0;
  font-size: 11px;
  color: #8c8;
  display: flex;
  align-items: center;
  gap: 6px;
  word-break: break-all;
}

.dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.dot-model {
  background: #4ab3ff;
}

.dot-tex {
  background: #5dff96;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: #555;
  font-style: italic;
}
</style>
