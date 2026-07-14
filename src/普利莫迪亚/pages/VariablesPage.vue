<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';

const game = useGameStore();

const copied = ref(false);
const saving = ref(false);
const refreshing = ref(false);
const cleaningLegacy = ref(false);
const editError = ref('');
const editNotice = ref('');
const selectedSection = ref('世界');
const variableText = ref('');

const snapshot = computed(() => game.getAuthoritativeMvuData());
const topEntries = computed(() => Object.entries(snapshot.value));

interface LeafEntry {
  path: string;
  value: unknown;
  kind: string;
  preview: string;
}

function stringifyVariables(value = snapshot.value) {
  return JSON.stringify(value, null, 2);
}

function resetEditor() {
  variableText.value = stringifyVariables();
  editError.value = '';
  editNotice.value = '';
}

watch(snapshot, resetEditor, { immediate: true, deep: true });

function valueKind(value: unknown) {
  if (Array.isArray(value)) return `数组 · ${value.length}项`;
  if (value && typeof value === 'object') return `对象 · ${Object.keys(value as Record<string, unknown>).length}项`;
  if (value === null) return '空值';
  return typeof value;
}

function preview(value: unknown) {
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : '[]';
  if (value && typeof value === 'object') return '';
  if (value === '') return '空';
  if (value === null) return 'null';
  return String(value);
}

function collectLeaves(value: unknown, path: string, out: LeafEntry[]) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ path, value, kind: valueKind(value), preview: '[]' });
      return;
    }
    value.forEach((child, index) => collectLeaves(child, `${path}.${index}`, out));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out.push({ path, value, kind: valueKind(value), preview: '{}' });
      return;
    }
    entries.forEach(([key, child]) => collectLeaves(child, `${path}.${key}`, out));
    return;
  }
  out.push({ path, value, kind: valueKind(value), preview: preview(value) });
}

const leaves = computed(() => {
  const out: LeafEntry[] = [];
  topEntries.value.forEach(([key, value]) => collectLeaves(value, key, out));
  return out;
});

function selectedSectionText(key: string) {
  const value = (snapshot.value as Record<string, unknown>)[key];
  return JSON.stringify(value ?? {}, null, 2);
}

function scrollToSection(key: string) {
  selectedSection.value = key;
  const el = document.getElementById(`variable-section-${key}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function focusLeaf(leaf: LeafEntry) {
  const root = leaf.path.split('.')[0] || '世界';
  scrollToSection(root);
  editNotice.value = `已定位：${leaf.path}`;
}

async function reloadCurrentMvu() {
  refreshing.value = true;
  editError.value = '';
  editNotice.value = '';
  try {
    const ok = game.loadFromMvu({ force: true });
    resetEditor();
    editNotice.value = ok ? '已根据当前楼层变量刷新前端数字。' : '当前楼层没有读到可用变量。';
  } catch (error) {
    editError.value = error instanceof Error ? error.message : '重新读取当前楼层变量失败。';
  } finally {
    refreshing.value = false;
  }
}

async function cleanupLegacyCharacters() {
  cleaningLegacy.value = true;
  editError.value = '';
  editNotice.value = '';
  try {
    const ok = await game.cleanupLegacyCharacterAlias();
    resetEditor();
    editNotice.value = ok
      ? '已清理旧人物字段，并按人物羁绊刷新前端。'
      : '没有发现需要清理的旧人物字段。';
  } catch (error) {
    editError.value = error instanceof Error ? error.message : '清理旧人物字段失败。';
  } finally {
    cleaningLegacy.value = false;
  }
}

async function saveVariables() {
  saving.value = true;
  editError.value = '';
  editNotice.value = '';
  try {
    const parsed = JSON.parse(variableText.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('变量必须是一整个 JSON 对象。');
    }
    const ok = await game.setFrontendMvuData(parsed as Record<string, unknown>);
    if (!ok) {
      throw new Error('前端状态已更新，但当前楼层变量写入失败。请确认酒馆助手变量接口可用后再保存一次。');
    }
    editNotice.value = '变量已保存到当前楼层。';
  } catch (error) {
    editError.value = error instanceof Error ? error.message : '变量 JSON 解析失败。';
  } finally {
    saving.value = false;
  }
}

async function copyVariables() {
  try {
    await navigator.clipboard.writeText(variableText.value);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1200);
  } catch {
    game.pushLog('提示', '复制失败，请从完整 JSON 区域手动复制。');
  }
}
</script>

<template>
  <section id="page-variables" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="ledger" :size="22" />
          变量总览
        </h2>
        <div class="sub">正式变量树 · 可以直接编辑整段变量并保存到当前楼层</div>
      </div>
      <div class="head-actions">
        <button class="pm-btn sm ghost" :disabled="refreshing || saving" @click="reloadCurrentMvu">
          <PmIcon name="refresh" :size="12" /> {{ refreshing ? '读取中' : '重读当前楼层变量' }}
        </button>
        <button class="pm-btn sm ghost" :disabled="cleaningLegacy || saving" @click="cleanupLegacyCharacters">
          <PmIcon name="check" :size="12" /> {{ cleaningLegacy ? '清理中' : '清理旧人物字段' }}
        </button>
        <button class="pm-btn sm" @click="copyVariables">
          <PmIcon name="copy" :size="12" /> {{ copied ? '已复制' : '复制当前变量' }}
        </button>
      </div>
    </header>

    <div class="pm-paper-body variables-layout">
      <aside class="summary-list">
        <article
          v-for="[key, value] in topEntries"
          :key="key"
          class="summary-card"
          :class="{ active: selectedSection === key }"
          @click="scrollToSection(key)"
        >
          <strong>{{ key }}</strong>
          <span>{{ valueKind(value) }}</span>
        </article>
      </aside>

      <main class="tree-panel">
        <section class="editor-card">
          <div class="editor-head">
            <div>
              <h3>编辑完整变量</h3>
              <p>可以直接修改下面这段文字。保存前会检查 JSON 格式；保存后会同步前端状态和当前楼层变量。</p>
            </div>
            <div class="editor-actions">
              <button class="pm-btn sm ghost" :disabled="saving" @click="resetEditor">
                <PmIcon name="refresh" :size="12" /> 还原当前值
              </button>
              <button class="pm-btn sm dark" :disabled="saving" @click="saveVariables">
                <PmIcon name="check" :size="12" /> {{ saving ? '保存中' : '保存修改' }}
              </button>
            </div>
          </div>
          <textarea v-model="variableText" class="full-editor" spellcheck="false"></textarea>
          <p v-if="editError" class="edit-error">{{ editError }}</p>
          <p v-if="editNotice" class="edit-notice">{{ editNotice }}</p>
        </section>

        <details v-for="[key, value] in topEntries" :id="`variable-section-${key}`" :key="key" open class="tree-group">
          <summary>
            <span>{{ key }}</span>
            <em>{{ valueKind(value) }}</em>
          </summary>
          <pre>{{ selectedSectionText(key) }}</pre>
        </details>
      </main>

      <aside class="leaf-panel">
        <h3>快速定位</h3>
        <button v-for="leaf in leaves" :key="leaf.path" class="leaf-row" @click="focusLeaf(leaf)">
          <span>{{ leaf.path }}</span>
          <em>{{ leaf.preview }}</em>
        </button>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.page {
  min-height: 100%;
}

.h-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.sub {
  margin-top: 4px;
  color: var(--pm-muted);
  font-size: 13px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.variables-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 260px;
  gap: 14px;
  align-items: start;
}

.summary-list,
.leaf-panel {
  position: sticky;
  top: 12px;
  display: grid;
  gap: 10px;
}

.summary-card,
.leaf-panel {
  border: 1px solid var(--pm-border);
  background: color-mix(in srgb, var(--pm-paper) 82%, transparent);
}

.summary-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  cursor: pointer;
}

.summary-card.active,
.summary-card:hover {
  border-color: var(--pm-accent);
  background: color-mix(in srgb, var(--pm-accent) 18%, var(--pm-paper));
}

.summary-card span,
.leaf-row em {
  color: var(--pm-muted);
  font-size: 12px;
  font-style: normal;
}

.tree-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.editor-card,
.tree-group {
  border: 1px solid var(--pm-border);
  background: color-mix(in srgb, var(--pm-paper) 86%, transparent);
}

.editor-card {
  padding: 14px;
}

.editor-head {
  position: sticky;
  top: 10px;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 0 0 12px;
  background: color-mix(in srgb, var(--pm-paper) 96%, transparent);
}

.editor-head h3 {
  margin: 0 0 4px;
}

.editor-head p {
  margin: 0;
  color: var(--pm-muted);
  font-size: 13px;
}

.editor-actions {
  display: flex;
  align-items: start;
  gap: 8px;
  flex-shrink: 0;
}

.full-editor {
  width: 100%;
  min-height: 360px;
  resize: vertical;
  padding: 12px;
  border: 1px solid var(--pm-border);
  background: var(--pm-paper-soft);
  color: var(--pm-ink);
  font: 13px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  tab-size: 2;
}

.edit-error,
.edit-notice {
  margin: 10px 0 0;
  padding: 8px 10px;
  border: 1px solid;
  font-size: 13px;
}

.edit-error {
  border-color: var(--pm-danger);
  color: var(--pm-danger);
}

.edit-notice {
  border-color: var(--pm-success);
  color: var(--pm-success);
}

.tree-group summary {
  display: flex;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  background: color-mix(in srgb, var(--pm-accent) 12%, transparent);
}

.tree-group summary em {
  color: var(--pm-muted);
  font-size: 12px;
  font-style: normal;
}

.tree-group pre {
  margin: 0;
  padding: 14px;
  overflow: auto;
  white-space: pre-wrap;
  font: 13px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.leaf-panel {
  max-height: calc(100vh - 170px);
  overflow: auto;
  padding: 12px;
}

.leaf-panel h3 {
  margin: 0 0 10px;
}

.leaf-row {
  width: 100%;
  display: grid;
  gap: 3px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid var(--pm-border);
  background: color-mix(in srgb, var(--pm-paper-soft) 78%, transparent);
  color: var(--pm-ink);
  text-align: left;
  cursor: pointer;
}

.leaf-row:hover {
  border-color: var(--pm-accent);
}

.leaf-row span {
  overflow-wrap: anywhere;
  font-size: 12px;
}

.leaf-row em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .variables-layout {
    grid-template-columns: 1fr;
  }

  .summary-list,
  .leaf-panel,
  .editor-head {
    position: static;
  }

  .summary-list {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
}
</style>
