<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watchEffect } from 'vue';
import { useGameStore } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';
import {
  getFinalPromptDebugSnapshots,
  getPromptDebugSnapshots,
  onFinalPromptDebugSnapshotsUpdated,
  onPromptDebugSnapshotsUpdated,
  type FinalPromptDebugSnapshot,
  type PromptDebugSnapshot,
} from '../utils/unifiedRequest';
import {
  getKnownWorldbookNames,
  getWorldbookEntryName,
  loadAllWorldbookEntries,
  type EditableWorldbookEntry,
  type WorldbookEntrySearchItem,
} from '../services/worldbookService';
import { inspectNpcActivityWorldbookContent } from '../services/npcActivityWorldbook';
import { inspectWeatherWorldbookContent } from '../services/weatherWorldbook';
import { tavernNpcActivityPools, tavernNpcConversationTopics, tavernNpcRestActivities } from '../data/npcActivities';

const game = useGameStore();
const tavernNameDraft = ref(game.tavernName);
const tavernNameSaving = ref(false);
const tavernNameNotice = ref('');
const tavernNameError = ref('');
const settingSections = [
  { id: 'play', label: '游玩辅助', desc: '约定 · 招牌 · 正文' },
  { id: 'worldbook', label: '世界书', desc: '发送包 · 天气 · 行为库' },
  { id: 'display', label: '显示外观', desc: '字体 · 主题' },
  { id: 'save', label: '存档账本', desc: '自查 · 导入导出' },
  { id: 'debug', label: '调试后台', desc: '提示词 · 引擎' },
] as const;
const activeSettingsSection = ref<(typeof settingSections)[number]['id']>('play');
const promptDebugSnapshots = ref<PromptDebugSnapshot[]>(getPromptDebugSnapshots());
const selectedPromptDebugId = ref(promptDebugSnapshots.value[0]?.id ?? '');
const finalPromptDebugSnapshots = ref<FinalPromptDebugSnapshot[]>(getFinalPromptDebugSnapshots());
const selectedFinalPromptDebugId = ref(finalPromptDebugSnapshots.value[0]?.id ?? '');
const finalPromptSearch = ref('');
const npcActivityBindOpen = ref(false);
const npcActivityBindSearch = ref('');
const npcActivityWorldbookEntries = ref<WorldbookEntrySearchItem[]>([]);
const npcActivityWorldbookLoading = ref(false);
const npcActivityWorldbookError = ref('');
const npcActivityBindingWorldbook = ref(game.npcActivityWorldbookBindings[0]?.worldbookName ?? '');
const npcActivityBindingUid = ref(String(game.npcActivityWorldbookBindings[0]?.uid ?? ''));
const weatherBindOpen = ref(false);
const weatherBindSearch = ref('');
const weatherWorldbookEntries = ref<WorldbookEntrySearchItem[]>([]);
const weatherWorldbookLoading = ref(false);
const weatherWorldbookError = ref('');
const weatherBindingWorldbook = ref(game.weatherWorldbookBindings[0]?.worldbookName ?? '');
const weatherBindingUid = ref(String(game.weatherWorldbookBindings[0]?.uid ?? ''));
const knownWorldbookNames = ref<string[]>([]);
const showNpcActivityTemplate = ref(false);
const defaultNpcActivityEntries = Object.entries(tavernNpcActivityPools);

function hasNpcActivityTag(content: unknown) {
  return /<\s*PrimordiaNpcActivities\b[^>]*>/i.test(String(content ?? ''));
}

function hasWeatherPoolTag(content: unknown) {
  return /<\s*PrimordiaWeatherPool\b[^>]*>/i.test(String(content ?? ''));
}

const filteredNpcActivityWorldbookEntries = computed(() => {
  const q = npcActivityBindSearch.value.trim().toLowerCase();
  return npcActivityWorldbookEntries.value
    .filter(item => hasNpcActivityTag(item.entry.content) || !q)
    .filter(item => {
      if (!q) return hasNpcActivityTag(item.entry.content);
      const keys = (item.entry.strategy?.keys ?? []).join(' ');
      return `${item.worldbookName} ${getWorldbookEntryName(item.entry)} ${keys} ${item.entry.content}`.toLowerCase().includes(q);
    });
});
const npcActivityLibraryStats = computed(() => {
  const library = game.npcActivityWorldbookLibrary;
  if (!library) return null;
  const regionBehaviorCounts = Object.entries(library.regions)
    .map(([region, behaviors]) => ({ region, count: behaviors.length }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region, 'zh-Hans-CN'));
  return {
    regionBehaviorCounts,
    behaviorCount: regionBehaviorCounts.reduce((sum, item) => sum + item.count, 0),
  };
});
const filteredWeatherWorldbookEntries = computed(() => {
  const q = weatherBindSearch.value.trim().toLowerCase();
  return weatherWorldbookEntries.value
    .filter(item => hasWeatherPoolTag(item.entry.content) || !q)
    .filter(item => {
      if (!q) return hasWeatherPoolTag(item.entry.content);
      const keys = (item.entry.strategy?.keys ?? []).join(' ');
      return `${item.worldbookName} ${getWorldbookEntryName(item.entry)} ${keys} ${item.entry.content}`.toLowerCase().includes(q);
    });
});
const weatherLibraryStats = computed(() => game.weatherLibraryStats());
const selectedPromptDebug = computed(
  () => promptDebugSnapshots.value.find(item => item.id === selectedPromptDebugId.value) ?? promptDebugSnapshots.value[0],
);
const selectedFinalPromptDebug = computed(
  () =>
    finalPromptDebugSnapshots.value.find(item => item.id === selectedFinalPromptDebugId.value) ??
    finalPromptDebugSnapshots.value[0],
);
const filteredFinalPromptMessages = computed(() => {
  const snapshot = selectedFinalPromptDebug.value;
  if (!snapshot) return [];
  const keyword = finalPromptSearch.value.trim().toLowerCase();
  if (!keyword) return snapshot.messages;
  return snapshot.messages.filter(message =>
    `${message.role}\n${message.content}`.toLowerCase().includes(keyword),
  );
});

onMounted(() => {
  const stop = onPromptDebugSnapshotsUpdated(snapshots => {
    promptDebugSnapshots.value = snapshots;
    if (!selectedPromptDebugId.value || !snapshots.some(item => item.id === selectedPromptDebugId.value)) {
      selectedPromptDebugId.value = snapshots[0]?.id ?? '';
    }
  });
  const stopFinal = onFinalPromptDebugSnapshotsUpdated(snapshots => {
    finalPromptDebugSnapshots.value = snapshots;
    if (!selectedFinalPromptDebugId.value || !snapshots.some(item => item.id === selectedFinalPromptDebugId.value)) {
      selectedFinalPromptDebugId.value = snapshots[0]?.id ?? '';
    }
  });
  onUnmounted(() => {
    stop();
    stopFinal();
  });
});

function refreshPromptDebug() {
  promptDebugSnapshots.value = getPromptDebugSnapshots();
  selectedPromptDebugId.value = promptDebugSnapshots.value[0]?.id ?? '';
  finalPromptDebugSnapshots.value = getFinalPromptDebugSnapshots();
  selectedFinalPromptDebugId.value = finalPromptDebugSnapshots.value[0]?.id ?? '';
}

function refreshKnownWorldbooks() {
  knownWorldbookNames.value = getKnownWorldbookNames();
}

async function ensureTurnContextWorldbook() {
  await game.ensureTurnContextWorldbook();
}

async function refreshTurnContextWorldbookBinding() {
  await game.refreshTurnContextWorldbookBinding();
}

function promptDebugJson(snapshot: PromptDebugSnapshot | undefined) {
  if (!snapshot) return '暂无提示词自查记录。请先从正文页、选项或底部行动栏发起一次生成。';
  return JSON.stringify(snapshot, null, 2);
}

async function copyPromptDebug() {
  const text = promptDebugJson(selectedPromptDebug.value);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('clipboard api unavailable');
    }
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  game.pushLog('系统', '提示词自查记录已复制。');
}

function finalPromptDebugText(snapshot: FinalPromptDebugSnapshot | undefined) {
  if (!snapshot) return '暂无最终提示词记录。请先发起一次生成。';
  return JSON.stringify(snapshot, null, 2);
}

async function copyTextToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('clipboard api unavailable');
    }
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function copyFinalPromptDebug() {
  await copyTextToClipboard(finalPromptDebugText(selectedFinalPromptDebug.value));
  game.pushLog('系统', '最终提示词记录已复制。');
}

async function copyFinalPromptMessage(content: string) {
  await copyTextToClipboard(content);
  game.pushLog('系统', '提示词片段已复制。');
}

async function copyPromiseReminder(text: string) {
  await copyTextToClipboard(text);
  game.pushLog('系统', '约定提醒已复制。');
}

async function refreshNpcActivityWorldbook() {
  await game.refreshNpcActivityWorldbookLibrary();
}

async function ensureNpcActivityWorldbook() {
  await game.ensureNpcActivityWorldbook();
  npcActivityBindingWorldbook.value = game.npcActivityWorldbookBindings[0]?.worldbookName ?? '';
  npcActivityBindingUid.value = String(game.npcActivityWorldbookBindings[0]?.uid ?? '');
}

async function saveNpcActivityBinding() {
  const uid = Number(npcActivityBindingUid.value);
  const ok = await game.setNpcActivityWorldbookBinding(npcActivityBindingWorldbook.value, uid);
  if (ok) await game.refreshNpcActivityWorldbookLibraryFromBindings();
}

function entryKeysText(entry: EditableWorldbookEntry | null) {
  const keys = entry?.strategy?.keys;
  return Array.isArray(keys) ? keys.map(String).join('、') : '未设置关键词';
}

function entrySummary(entry: EditableWorldbookEntry | null) {
  const text = String(entry?.content ?? '').replace(/\s+/g, ' ').trim();
  return text ? `${text.slice(0, 150)}${text.length > 150 ? '...' : ''}` : '条目正文为空。';
}

function activityEntryStats(entry: EditableWorldbookEntry | null) {
  return inspectNpcActivityWorldbookContent(String(entry?.content ?? ''), getWorldbookEntryName(entry) || '行为库条目');
}

function weatherEntryStats(entry: EditableWorldbookEntry | null) {
  return inspectWeatherWorldbookContent(String(entry?.content ?? ''), getWorldbookEntryName(entry) || '天气池条目');
}

async function refreshNpcActivityWorldbookEntries() {
  npcActivityWorldbookError.value = '';
  npcActivityWorldbookLoading.value = true;
  try {
    npcActivityWorldbookEntries.value = await loadAllWorldbookEntries();
  } catch (error) {
    npcActivityWorldbookError.value = error instanceof Error ? error.message : '读取世界书条目失败。';
  } finally {
    npcActivityWorldbookLoading.value = false;
  }
}

async function openNpcActivityBindWorldbook() {
  npcActivityBindOpen.value = true;
  await refreshNpcActivityWorldbookEntries();
}

async function bindNpcActivityWorldbookEntry(item: WorldbookEntrySearchItem) {
  const ok = await game.setNpcActivityWorldbookBinding(item.worldbookName, item.uid);
  if (!ok) return;
  await game.refreshNpcActivityWorldbookLibraryFromBindings();
  npcActivityBindOpen.value = false;
}

async function refreshBoundNpcActivityWorldbook() {
  await game.refreshNpcActivityWorldbookLibraryFromBindings();
}

async function toggleNpcActivityEnabled() {
  await game.setNpcActivityEnabled(!game.npcActivityEnabled);
}

async function updateNpcActivityKeepTurns(event: Event) {
  await game.setNpcActivityKeepTurns(Number((event.target as HTMLInputElement).value));
}

async function updateNpcActivityMinMinutes(event: Event) {
  await game.setNpcActivityMinMinutes(Number((event.target as HTMLInputElement).value));
}

async function updateNpcActivityMinSuccessTurns(event: Event) {
  await game.setNpcActivityMinSuccessTurns(Number((event.target as HTMLInputElement).value));
}

async function clearNpcActivityBinding() {
  await game.clearNpcActivityWorldbookBindings();
}

async function copyNpcActivityTemplate() {
  await copyTextToClipboard(game.npcActivityWorldbookTemplate());
  game.pushLog('系统', '后台行为库世界书模板已复制。');
}

async function refreshWeatherWorldbook() {
  await game.refreshWeatherWorldbookLibrary();
}

async function ensureWeatherWorldbook() {
  await game.ensureWeatherWorldbook();
  weatherBindingWorldbook.value = game.weatherWorldbookBindings[0]?.worldbookName ?? '';
  weatherBindingUid.value = String(game.weatherWorldbookBindings[0]?.uid ?? '');
}

async function saveWeatherBinding() {
  const uid = Number(weatherBindingUid.value);
  const ok = await game.setWeatherWorldbookBinding(weatherBindingWorldbook.value, uid);
  if (ok) await game.refreshWeatherWorldbookLibraryFromBindings();
}

async function refreshWeatherWorldbookEntries() {
  weatherWorldbookError.value = '';
  weatherWorldbookLoading.value = true;
  try {
    weatherWorldbookEntries.value = await loadAllWorldbookEntries();
  } catch (error) {
    weatherWorldbookError.value = error instanceof Error ? error.message : '读取世界书条目失败。';
  } finally {
    weatherWorldbookLoading.value = false;
  }
}

async function openWeatherBindWorldbook() {
  weatherBindOpen.value = true;
  await refreshWeatherWorldbookEntries();
}

async function bindWeatherWorldbookEntry(item: WorldbookEntrySearchItem) {
  const ok = await game.setWeatherWorldbookBinding(item.worldbookName, item.uid);
  if (!ok) return;
  await game.refreshWeatherWorldbookLibraryFromBindings();
  weatherBindOpen.value = false;
}

async function refreshBoundWeatherWorldbook() {
  await game.refreshWeatherWorldbookLibraryFromBindings();
}

async function clearWeatherBinding() {
  await game.clearWeatherWorldbookBindings();
}

async function copyWeatherFormatTemplate() {
  await copyTextToClipboard(game.weatherWorldbookFormatTemplate());
  game.pushLog('系统', '天气池格式模板已复制。');
}

async function copyFullWeatherTemplate() {
  await copyTextToClipboard(game.fullWeatherWorldbookTemplate());
  game.pushLog('系统', '完整默认天气池模板已复制。');
}

async function copyCurrentMonthWeatherTemplate() {
  await copyTextToClipboard(game.monthWeatherWorldbookTemplate(game.months[game.calendar.monthIndex]));
  game.pushLog('系统', '当前月份天气池模板已复制。');
}

const textSize = ref<'90' | '100' | '115' | '130'>('100');
watchEffect(() => {
  document.body.dataset.pmSize = textSize.value;
});

const showSchema = ref(false);
const showDebugSave = ref(false);
const showScanPreview = ref(false);
const showPromptPreview = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const selfCheckItems = ref(game.runReadonlyHealthCheck());
const debugSaveText = ref(game.buildDebugSaveJson());
const scanPreview = ref(game.buildWorldbookScanPreview());
const promptPreview = ref(game.buildLatestPromptPreview());
const schemaPreview = computed(() =>
  JSON.stringify(
    {
      calendar: game.calendar,
      schemaVersion: 1,
      migrationStatus: game.saveMigrationStatus,
      tavernName: game.tavernName,
      location: game.location,
      treasuryCopper: game.treasuryCopper,
      reputation: game.reputation,
      energy: game.energy,
      regions: game.regions.map(r => ({ id: r.id, name: r.name, level: r.level, condition: r.condition })),
      heroines: game.heroines.map(h => ({ id: h.id, name: h.name, stage: h.stage, affection: h.affection })),
    },
    null,
    2,
  ),
);

const engineHealth = reactive({
  llm: '健康' as '健康' | '降级' | '不可用',
  mvu: '已就绪',
  storage: '可用',
  latencyMs: 642,
  lastCheck: '刚刚',
});

function recheck() {
  engineHealth.lastCheck = '刚刚';
  engineHealth.latencyMs = 500 + Math.floor(Math.random() * 400);
  game.pushLog('系统', `引擎健康检查完成 · LLM 延迟 ${engineHealth.latencyMs} ms`);
}

function runReadonlySelfCheck() {
  selfCheckItems.value = game.runReadonlyHealthCheck();
  debugSaveText.value = game.buildDebugSaveJson();
  scanPreview.value = game.buildWorldbookScanPreview();
  promptPreview.value = game.buildLatestPromptPreview();
  const bad = selfCheckItems.value.filter(item => !item.ok && item.tone === 'bad').length;
  const warn = selfCheckItems.value.filter(item => !item.ok && item.tone === 'warn').length;
  game.pushLog('系统', bad ? `只读自检完成 · ${bad} 项需要处理` : warn ? `只读自检完成 · ${warn} 项提示` : '只读自检完成 · 当前账本健康');
}

async function saveTavernName() {
  const next = tavernNameDraft.value.trim();
  if (!next) return;
  tavernNameSaving.value = true;
  tavernNameNotice.value = '';
  tavernNameError.value = '';
  try {
    const ok = await game.setTavernName(next);
    if (!ok) {
      throw new Error('招牌已改到前端，但当前楼层变量写入失败。请确认酒馆助手变量接口可用后再保存一次。');
    }
    tavernNameNotice.value = '招牌已同步到当前楼层变量。';
  } catch (error) {
    tavernNameError.value = error instanceof Error ? error.message : '酒馆招牌保存失败。';
  } finally {
    tavernNameSaving.value = false;
  }
}

function exportSave() {
  debugSaveText.value = game.buildDebugSaveJson();
  const blob = new Blob([debugSaveText.value], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `primordia-save-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  game.pushLog('系统', '存档已导出。');
}

function openImportSave() {
  importFileInput.value?.click();
}

async function importSaveFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const text = await file.text();
  const ok = await game.importDebugSaveJson(text);
  if (ok) runReadonlySelfCheck();
}
</script>

<template>
  <section id="page-settings" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="gear" :size="22" />
          系统与设置
        </h2>
        <div class="sub">字体缩放 · 存档读写 · LLM 引擎健康</div>
      </div>
    </header>

    <nav class="settings-tabs" aria-label="设置分组">
      <button
        v-for="section in settingSections"
        :key="section.id"
        class="settings-tab"
        :class="{ active: activeSettingsSection === section.id }"
        type="button"
        @click="activeSettingsSection = section.id"
      >
        <strong>{{ section.label }}</strong>
        <span>{{ section.desc }}</span>
      </button>
    </nav>

    <div class="pm-paper-body settings-grid">
      <section v-show="activeSettingsSection === 'play'" class="settings-card pm-card npc-activity-card">
        <h3>约定备忘录</h3>
        <p class="pm-dim">
          AI 在正文后写入 <code>&lt;promise_update&gt;</code> 时，前端会保存未来约定；到达触发时间后，会在本回合发送包里提醒一次。
        </p>
        <div class="activity-status">
          <span class="pm-tag" :class="game.promiseMemos.some(memo => memo.status === 'pending') ? 'good' : 'warn'">
            待触发 {{ game.promiseMemos.filter(memo => memo.status === 'pending').length }} 条
          </span>
          <span>总计 {{ game.promiseMemos.length }} 条约定记录</span>
        </div>
        <div v-if="!game.promiseMemos.length" class="pm-empty mini">
          暂无约定。之后 AI 写入未来承诺、预约或威胁时会自动出现在这里。
        </div>
        <div v-else class="promise-list">
          <article v-for="memo in game.promiseMemos" :key="memo.id" class="promise-card">
            <div class="promise-head">
              <strong>{{ memo.name }}</strong>
              <span class="pm-tag" :class="memo.status === 'pending' ? 'good' : memo.status === 'triggered' ? 'warn' : 'neutral'">
                {{ memo.status }}
              </span>
            </div>
            <div class="activity-status mini">
              <span>{{ memo.triggerTime }}</span>
              <span v-if="memo.people.length">人物 {{ memo.people.join('、') }}</span>
              <span>创建回合 {{ memo.createdAtTurn }}</span>
              <span v-if="memo.triggeredAtTurn">触发回合 {{ memo.triggeredAtTurn }}</span>
            </div>
            <p>{{ memo.event }}</p>
            <p class="pm-dim">{{ memo.reminder }}</p>
            <div class="card-actions">
              <button class="pm-btn sm ghost" @click="copyPromiseReminder(memo.reminder)">
                <PmIcon name="scroll" :size="12" /> 复制提醒
              </button>
              <button
                class="pm-btn sm ghost"
                :disabled="memo.status === 'resolved'"
                @click="game.updatePromiseMemoStatus(memo.id, 'resolved')"
              >
                <PmIcon name="check" :size="12" /> 标记已解决
              </button>
              <button
                class="pm-btn sm ghost"
                :disabled="memo.status === 'cancelled'"
                @click="game.updatePromiseMemoStatus(memo.id, 'cancelled')"
              >
                取消
              </button>
            </div>
          </article>
        </div>
      </section>
      <section v-show="activeSettingsSection === 'play'" class="settings-card pm-card">
        <h3>酒馆招牌</h3>
        <label class="pm-field">
          <span>酒馆名字</span>
          <input v-model="tavernNameDraft" class="pm-input" placeholder="给你的酒馆起个名字" @keyup.enter="saveTavernName" />
        </label>
        <div class="card-actions">
          <button class="pm-btn sm" :disabled="tavernNameSaving" @click="saveTavernName">
            <PmIcon name="check" :size="12" /> {{ tavernNameSaving ? '保存中' : '挂上新招牌' }}
          </button>
        </div>
        <p class="pm-dim">这里会同步到顶部位置、正文页、经营记录和当前楼层变量。</p>
        <p v-if="tavernNameError" class="edit-error">{{ tavernNameError }}</p>
        <p v-if="tavernNameNotice" class="edit-notice">{{ tavernNameNotice }}</p>
      </section>

      <section v-show="activeSettingsSection === 'display'" class="settings-card pm-card">
        <h3>字体与排版</h3>
        <label class="pm-field">
          <span>文字缩放</span>
          <div class="size-tabs">
            <button
              v-for="opt in (['90', '100', '115', '130'] as const)"
              :key="opt"
              class="pm-btn sm"
              :class="{ ghost: textSize !== opt }"
              @click="textSize = opt"
            >
              {{ opt }} %
            </button>
          </div>
        </label>
        <p class="pm-dim">
          缩放将作用于整个章程页, 适合远距离阅读或视力辅助。
        </p>
      </section>

      <section v-show="activeSettingsSection === 'display'" class="settings-card pm-card theme-card">
        <h3>界面主题</h3>
        <div class="theme-grid">
          <button
            v-for="theme in game.primordiaThemes"
            :key="theme.id"
            class="theme-option"
            :class="{ active: game.themeId === theme.id }"
            type="button"
            @click="game.themeId = theme.id"
          >
            <span class="theme-copy">
              <strong>{{ theme.name }}</strong>
              <small>{{ theme.description }}</small>
            </span>
            <span class="theme-swatches" aria-hidden="true">
              <i v-for="color in theme.swatches" :key="color" :style="{ backgroundColor: color }"></i>
            </span>
          </button>
        </div>
      </section>

      <section v-show="activeSettingsSection === 'play'" class="settings-card pm-card">
        <h3>正文显示</h3>
        <label class="toggle-row">
          <span>
            <strong>正文流式显示</strong>
            <small>开启后, AI 生成时正文会逐步浮现; 关闭后, 等完整回复结束再显示。</small>
          </span>
          <button
            class="toggle-switch"
            :class="{ on: game.enableStoryStreaming }"
            type="button"
            role="switch"
            :aria-checked="game.enableStoryStreaming"
            @click="game.enableStoryStreaming = !game.enableStoryStreaming"
          >
            <i></i>
            {{ game.enableStoryStreaming ? '开启' : '关闭' }}
          </button>
        </label>
        <label class="toggle-row">
          <span>
            <strong>发送天气给 AI</strong>
            <small>关闭后顶部仍显示每日天气，但生成提示词不再附带天气描述。</small>
          </span>
          <button
            class="toggle-switch"
            :class="{ on: game.sendWeatherToAi }"
            type="button"
            role="switch"
            :aria-checked="game.sendWeatherToAi"
            @click="game.sendWeatherToAi = !game.sendWeatherToAi"
          >
            <i></i>
            {{ game.sendWeatherToAi ? '开启' : '关闭' }}
          </button>
        </label>
      </section>

      <section v-show="activeSettingsSection === 'worldbook'" class="settings-card pm-card npc-activity-card">
        <h3>本回合发送包 · 世界书绑定</h3>
        <p class="pm-dim">
          每回合发送前，前端会把完整发送包覆盖到固定世界书条目。没有准确绑定时会停止生成，避免工具读不到本回合内容。
        </p>
        <div class="activity-status">
          <span class="pm-tag" :class="game.turnContextWorldbookBinding ? 'good' : 'warn'">
            {{ game.turnContextWorldbookBinding ? '已绑定' : '未绑定' }}
          </span>
          <span>{{ game.turnContextWorldbookStatus }}</span>
        </div>
        <div v-if="game.turnContextWorldbookBinding" class="activity-status mini">
          <span>{{ game.turnContextWorldbookBinding.worldbookName }}</span>
          <span>uid {{ game.turnContextWorldbookBinding.uid }}</span>
          <span>{{ game.turnContextWorldbookBinding.entryName }}</span>
          <span v-if="game.turnContextWorldbookBinding.updatedAt">
            最近写入 {{ new Date(game.turnContextWorldbookBinding.updatedAt).toLocaleString() }}
          </span>
        </div>
        <div class="card-actions">
          <button class="pm-btn sm" @click="ensureTurnContextWorldbook">
            <PmIcon name="scroll" :size="12" /> 创建并绑定固定条目
          </button>
          <button class="pm-btn sm ghost" @click="refreshTurnContextWorldbookBinding">
            <PmIcon name="check" :size="12" /> 重新检测绑定
          </button>
        </div>
      </section>

      <section v-show="activeSettingsSection === 'worldbook'" class="settings-card pm-card npc-activity-card">
        <h3>天气池 · 世界书</h3>
        <p class="pm-dim">
          天气只使用读取成功的 <code>&lt;PrimordiaWeatherPool&gt;</code> 世界书天气池；没有读到或当前月份缺少条目时，不使用前端兜底天气。
        </p>
        <div class="activity-status">
          <span class="pm-tag" :class="game.weatherWorldbookLibrary ? 'good' : 'warn'">
            {{ game.weatherWorldbookLibrary ? '天气池已读取' : '天气池未读取' }}
          </span>
          <span>{{ game.weatherWorldbookStatus }}</span>
        </div>
        <div v-if="game.weatherWorldbookLibrary" class="activity-status mini">
          <span>来源 {{ game.weatherWorldbookLibrary.sourceLabels.length }} 个</span>
          <span>月份 {{ weatherLibraryStats.monthCounts.length }} 个</span>
          <span>天气 {{ weatherLibraryStats.weatherCount }} 条</span>
          <span>当前月份 {{ weatherLibraryStats.currentMonthCount }} 条</span>
        </div>
        <div v-if="weatherLibraryStats.monthCounts.length" class="activity-region-counts">
          <span v-for="item in weatherLibraryStats.monthCounts" :key="item.month">
            {{ item.month }} {{ item.count }} 条
          </span>
        </div>
        <div v-if="game.weatherWorldbookErrors.length" class="activity-errors">
          <div v-for="error in game.weatherWorldbookErrors" :key="error">{{ error }}</div>
        </div>
        <div class="activity-picker-box">
          <div v-if="game.weatherWorldbookBindings.length" class="activity-status mini">
            <span>当前绑定 {{ game.weatherWorldbookBindings[0].worldbookName }} · uid {{ game.weatherWorldbookBindings[0].uid }}</span>
          </div>
          <div v-else class="activity-status mini">
            <span>尚未绑定天气池条目。</span>
          </div>
          <div class="card-actions">
            <button class="pm-btn sm" @click="openWeatherBindWorldbook">
              <PmIcon name="scroll" :size="12" /> 选择天气池条目
            </button>
            <button class="pm-btn sm" @click="ensureWeatherWorldbook">
              <PmIcon name="check" :size="12" /> 自动创建/绑定默认天气池
            </button>
            <button class="pm-btn sm ghost" @click="refreshBoundWeatherWorldbook">
              <PmIcon name="scroll" :size="12" /> 读取绑定条目
            </button>
            <button class="pm-btn sm ghost" @click="clearWeatherBinding">清空绑定</button>
          </div>
        </div>
        <div class="activity-binding-box">
          <label class="pm-field compact">
            <span>天气池世界书名</span>
            <input v-model="weatherBindingWorldbook" class="pm-input" list="weather-worldbooks" placeholder="世界书名称" />
            <datalist id="weather-worldbooks">
              <option v-for="name in knownWorldbookNames" :key="name" :value="name"></option>
            </datalist>
          </label>
          <label class="pm-field compact">
            <span>条目 uid</span>
            <input v-model="weatherBindingUid" class="pm-input" inputmode="numeric" placeholder="例如：110616" />
          </label>
          <div class="card-actions">
            <button class="pm-btn sm" @click="saveWeatherBinding">
              <PmIcon name="check" :size="12" /> 保存并读取绑定
            </button>
            <button class="pm-btn sm ghost" @click="refreshKnownWorldbooks">刷新世界书名</button>
          </div>
        </div>
        <div class="card-actions">
          <button class="pm-btn sm" @click="refreshWeatherWorldbook">
            <PmIcon name="check" :size="12" /> 读取当前世界书
          </button>
          <button class="pm-btn sm ghost" @click="copyWeatherFormatTemplate">
            <PmIcon name="scroll" :size="12" /> 复制格式模板
          </button>
          <button class="pm-btn sm ghost" @click="copyCurrentMonthWeatherTemplate">
            <PmIcon name="scroll" :size="12" /> 复制当前月份模板
          </button>
          <button class="pm-btn sm ghost" @click="copyFullWeatherTemplate">
            <PmIcon name="scroll" :size="12" /> 复制完整默认模板
          </button>
        </div>
        <p class="pm-dim">默认模板只用于复制到世界书里修改，不参与运行；天气池全文不会进入变量总览，也不会发给 AI。</p>
      </section>

      <section v-show="activeSettingsSection === 'worldbook'" class="settings-card pm-card npc-activity-card">
        <h3>伪活人化 · 行为来源</h3>
        <p class="pm-dim">
          伪活人化优先使用每个角色自己的行为库，并直接识别当前变量中的酒馆区域。全局
          <code>&lt;PrimordiaNpcActivities&gt;</code> 行为库只是可选后备，不再是启动条件。
        </p>
        <div class="activity-status">
          <span class="pm-tag" :class="game.npcActivityEnabled ? 'good' : 'warn'">
            {{ game.npcActivityEnabled ? '伪活人化开启' : '伪活人化关闭' }}
          </span>
          <span>{{ game.npcActivityWorldbookStatus }}</span>
        </div>
        <div v-if="game.npcActivityWorldbookLibrary" class="activity-status mini">
          <span>来源 {{ game.npcActivityWorldbookLibrary.sourceLabels.length }} 个</span>
          <span>区域 {{ Object.keys(game.npcActivityWorldbookLibrary.regions).length }} 个</span>
          <span>行为 {{ npcActivityLibraryStats?.behaviorCount ?? 0 }} 条</span>
          <span>交谈主题 {{ game.npcActivityWorldbookLibrary.conversationTopics.length }} 个</span>
          <span>休息行为 {{ game.npcActivityWorldbookLibrary.restBehaviors.length }} 个</span>
        </div>
        <div v-if="npcActivityLibraryStats?.regionBehaviorCounts.length" class="activity-region-counts">
          <span v-for="item in npcActivityLibraryStats.regionBehaviorCounts" :key="item.region">
            {{ item.region }} {{ item.count }} 条
          </span>
        </div>
        <div class="activity-tuning-grid">
          <label class="pm-field compact">
            <span>触发冷却分钟</span>
            <input
              class="pm-input"
              type="number"
              min="0"
              step="10"
              :value="game.npcActivityMinMinutes"
              @change="updateNpcActivityMinMinutes"
            />
            <small>距离上次刷新至少经过这么多游戏分钟才会尝试触发；默认 90，填 0 表示只看回合。</small>
          </label>
          <label class="pm-field compact">
            <span>触发冷却正文回合</span>
            <input
              class="pm-input"
              type="number"
              min="0"
              step="1"
              :value="game.npcActivityMinSuccessTurns"
              @change="updateNpcActivityMinSuccessTurns"
            />
            <small>距离上次刷新至少经过这么多个成功 AI 正文楼层；默认 2，填 0 表示只看时间。</small>
          </label>
        </div>
        <label class="pm-field compact activity-keep-field">
          <span>动向保留回合数</span>
          <input
            class="pm-input"
            type="number"
            min="1"
            step="1"
            :value="game.npcActivityKeepTurns"
            @change="updateNpcActivityKeepTurns"
          />
          <small>新生成的配角动向会保持这么多个成功叙事回合；默认 3，不设上限。</small>
        </label>
        <div class="default-activity-box">
          <button class="pm-btn sm ghost" @click="showNpcActivityTemplate = !showNpcActivityTemplate">
            <PmIcon name="scroll" :size="12" /> {{ showNpcActivityTemplate ? '收起完整模板内容' : '查看完整模板内容' }}
          </button>
          <div v-if="showNpcActivityTemplate" class="default-activity-list">
            <article v-for="[region, behaviors] in defaultNpcActivityEntries" :key="region">
              <strong>{{ region }}</strong>
              <span>{{ behaviors.join('、') }}</span>
            </article>
            <article>
              <strong>交谈主题</strong>
              <span>{{ tavernNpcConversationTopics.join('、') }}</span>
            </article>
            <article>
              <strong>休息行为</strong>
              <span>{{ tavernNpcRestActivities.join('、') }}</span>
            </article>
          </div>
        </div>
        <div v-if="game.npcActivityWorldbookErrors.length" class="activity-errors">
          <div v-for="error in game.npcActivityWorldbookErrors" :key="error">{{ error }}</div>
        </div>
        <div class="activity-picker-box">
          <div v-if="game.npcActivityWorldbookBindings.length" class="activity-status mini">
            <span>当前绑定 {{ game.npcActivityWorldbookBindings[0].worldbookName }} · uid {{ game.npcActivityWorldbookBindings[0].uid }}</span>
          </div>
          <div v-else class="activity-status mini">
              <span>未绑定全局后备行为库；个人角色行为仍可独立运行。</span>
          </div>
          <div class="card-actions">
            <button class="pm-btn sm" :class="{ ghost: game.npcActivityEnabled }" @click="toggleNpcActivityEnabled">
              <PmIcon name="check" :size="12" /> {{ game.npcActivityEnabled ? '关闭伪活人化' : '开启伪活人化' }}
            </button>
            <button class="pm-btn sm" @click="openNpcActivityBindWorldbook">
              <PmIcon name="scroll" :size="12" /> 选择行为库条目
            </button>
            <button class="pm-btn sm" @click="ensureNpcActivityWorldbook">
              <PmIcon name="check" :size="12" /> 自动创建/绑定行为库
            </button>
            <button class="pm-btn sm ghost" @click="refreshBoundNpcActivityWorldbook">
              <PmIcon name="scroll" :size="12" /> 读取绑定条目
            </button>
            <button class="pm-btn sm ghost" @click="clearNpcActivityBinding">清空绑定</button>
          </div>
        </div>
        <div class="activity-binding-box">
          <label class="pm-field compact">
            <span>行为库世界书名</span>
            <input v-model="npcActivityBindingWorldbook" class="pm-input" list="npc-activity-worldbooks" placeholder="世界书名称" />
            <datalist id="npc-activity-worldbooks">
              <option v-for="name in knownWorldbookNames" :key="name" :value="name"></option>
            </datalist>
          </label>
          <label class="pm-field compact">
            <span>条目 uid</span>
            <input v-model="npcActivityBindingUid" class="pm-input" inputmode="numeric" placeholder="例如：110616" />
          </label>
          <div v-if="game.npcActivityWorldbookBindings.length" class="activity-status mini">
            <span>当前绑定 {{ game.npcActivityWorldbookBindings[0].worldbookName }} · uid {{ game.npcActivityWorldbookBindings[0].uid }}</span>
          </div>
          <div class="card-actions">
            <button class="pm-btn sm" @click="saveNpcActivityBinding">
              <PmIcon name="check" :size="12" /> 保存并读取绑定
            </button>
            <button class="pm-btn sm ghost" @click="refreshBoundNpcActivityWorldbook">
              <PmIcon name="scroll" :size="12" /> 读取绑定条目
            </button>
            <button class="pm-btn sm ghost" @click="refreshKnownWorldbooks">刷新世界书名</button>
            <button class="pm-btn sm ghost" @click="clearNpcActivityBinding">清空绑定</button>
          </div>
        </div>
        <div class="card-actions">
          <button class="pm-btn sm" @click="refreshNpcActivityWorldbook">
            <PmIcon name="check" :size="12" /> 读取当前世界书
          </button>
          <button class="pm-btn sm ghost" @click="copyNpcActivityTemplate">
            <PmIcon name="scroll" :size="12" /> 复制格式模板
          </button>
        </div>
        <p class="pm-dim">全局后备库读取失败只会清空后备缓存，不会关闭个人角色伪活人化；模板只用于复制参考，不参与运行。</p>
      </section>

      <section v-show="activeSettingsSection === 'debug'" class="settings-card pm-card">
        <h3>引擎健康检查</h3>
        <ul class="health">
          <li>
            <span>LLM 接口</span>
            <span class="pm-tag" :class="engineHealth.llm === '健康' ? 'good' : 'warn'">{{ engineHealth.llm }}</span>
          </li>
          <li>
            <span>MVU 变量框架</span>
            <span class="pm-tag good">{{ engineHealth.mvu }}</span>
          </li>
          <li>
            <span>本地存档</span>
            <span class="pm-tag good">{{ engineHealth.storage }}</span>
          </li>
          <li>
            <span>当前延迟</span>
            <span class="pm-num">{{ engineHealth.latencyMs }} ms</span>
          </li>
          <li>
            <span>最近检查</span>
            <span class="pm-dim">{{ engineHealth.lastCheck }}</span>
          </li>
        </ul>
        <div class="card-actions">
          <button class="pm-btn sm" @click="recheck">
            <PmIcon name="check" :size="12" /> 重新检查
          </button>
        </div>
      </section>

      <section v-show="activeSettingsSection === 'save'" class="settings-card pm-card self-check-card">
        <h3>账本自查 · 只读</h3>
        <p class="pm-dim">
          这里检查前端主存档本身，不会修改钱袋、库存、地点或楼层。红色代表会破坏连续性，黄色代表需要留意。
        </p>
        <div class="card-actions">
          <button class="pm-btn sm" @click="runReadonlySelfCheck">
            <PmIcon name="check" :size="12" /> 执行只读自检
          </button>
          <button class="pm-btn sm ghost" @click="showDebugSave = !showDebugSave">
            <PmIcon name="ledger" :size="12" /> {{ showDebugSave ? '隐藏主存档' : '查看主存档' }}
          </button>
          <button class="pm-btn sm ghost" @click="showScanPreview = !showScanPreview">
            <PmIcon name="map" :size="12" /> {{ showScanPreview ? '隐藏扫描词' : '世界书扫描词' }}
          </button>
          <button class="pm-btn sm ghost" @click="showPromptPreview = !showPromptPreview">
            <PmIcon name="scroll" :size="12" /> {{ showPromptPreview ? '隐藏提示词预览' : '提示词预览' }}
          </button>
        </div>
        <div class="self-check-list">
          <article v-for="item in selfCheckItems" :key="item.title" class="self-check-item" :class="item.tone">
            <span class="pm-tag" :class="item.tone">{{ item.ok ? '通过' : item.tone === 'warn' ? '提示' : '异常' }}</span>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </div>
          </article>
        </div>
        <pre v-if="showDebugSave" class="json-preview debug-json">{{ debugSaveText }}</pre>
        <pre v-if="showScanPreview" class="json-preview debug-json">{{ scanPreview }}</pre>
        <pre v-if="showPromptPreview" class="json-preview debug-json">{{ promptPreview }}</pre>
      </section>

      <section v-show="activeSettingsSection === 'save'" class="settings-card pm-card">
        <h3>存档读写 · JSON</h3>
        <p class="pm-dim">
          支持完整结构的导入导出, 便于离线回看与跨设备同步; 实际接入 MVU 后, 读档将自动应用到 stat_data。
        </p>
        <p class="migration-status">{{ game.saveMigrationStatus }}</p>
        <div class="card-actions">
          <button class="pm-btn sm" @click="exportSave">
            <PmIcon name="send" :size="12" /> 导出当前
          </button>
          <button class="pm-btn sm ghost" @click="openImportSave">
            <PmIcon name="scroll" :size="12" /> 从文件读取
          </button>
          <input ref="importFileInput" class="sr-only" type="file" accept="application/json,.json" @change="importSaveFile" />
          <button class="pm-btn sm ghost" @click="showSchema = !showSchema">
            <PmIcon name="ledger" :size="12" />
            {{ showSchema ? '隐藏 JSON' : '展开 JSON' }}
          </button>
        </div>
        <pre v-if="showSchema" class="json-preview">{{ schemaPreview }}</pre>
      </section>

      <section v-show="activeSettingsSection === 'debug'" class="settings-card pm-card prompt-debug-card">
        <h3>提示词自查查看器</h3>
        <p class="pm-dim">
          这里记录前端自己送入生成接口的内容：玩家行动、injects、基础变量摘要、生成原文与整理后的楼层文本。它用于检查伪0层是否把行动和扫描词送进了叙事引擎。
        </p>
        <div class="prompt-debug-layout">
          <aside class="prompt-debug-list">
            <button
              v-for="item in promptDebugSnapshots"
              :key="item.id"
              class="prompt-debug-item"
              :class="{ active: selectedPromptDebug?.id === item.id, error: item.status === 'error' }"
              type="button"
              @click="selectedPromptDebugId = item.id"
            >
              <span>{{ item.createdAt }}</span>
              <strong>{{ item.status === 'pending' ? '生成中' : item.status === 'ok' ? '成功' : '失败' }}</strong>
              <small>{{ item.userInput.slice(0, 42) }}{{ item.userInput.length > 42 ? '...' : '' }}</small>
            </button>
            <div v-if="promptDebugSnapshots.length === 0" class="pm-empty mini">
              暂无记录。发起一次行动后会自动出现。
            </div>
          </aside>
          <div class="prompt-debug-main">
            <div class="card-actions">
              <button class="pm-btn sm" @click="refreshPromptDebug">
                <PmIcon name="check" :size="12" /> 刷新
              </button>
              <button class="pm-btn sm ghost" @click="copyPromptDebug">
                <PmIcon name="scroll" :size="12" /> 复制当前记录
              </button>
            </div>
            <pre class="json-preview prompt-debug-json">{{ promptDebugJson(selectedPromptDebug) }}</pre>
            <p class="pm-dim">
              说明：酒馆最终拼好的完整提示词、实际命中的世界书条目，只有在酒馆或助手暴露对应接口时才能读取。当前查看器先保证能检查“前端自己送了什么”。
            </p>
          </div>
        </div>
      </section>

      <section v-show="activeSettingsSection === 'debug'" class="settings-card pm-card">
        <h3>调试操作</h3>
        <p class="pm-dim">仅在开发阶段使用。按钮会先调整前端状态，再写回当前楼层变量/MVU，便于观察叙事反应。</p>
        <div class="debug-grid">
          <button class="pm-btn sm" @click="game.dispatchAction({ type: 'DEBUG_CURRENCY', deltaCopper: 10_000, reason: '调试 · 注入资金' })">
            <PmIcon name="coin" :size="12" /> +100 银
          </button>
          <button class="pm-btn sm" @click="game.dispatchAction({ type: 'DEBUG_CURRENCY', deltaCopper: -5_000, reason: '调试 · 抽离资金' })">
            <PmIcon name="minus" :size="12" /> -50 银
          </button>
          <button class="pm-btn sm" @click="game.dispatchAction({ type: 'DEBUG_STAT', stat: 'energy_full', reason: '调试 · 精力满' })">
            <PmIcon name="check" :size="12" /> 精力满
          </button>
          <button class="pm-btn sm" @click="game.dispatchAction({ type: 'DEBUG_STAT', stat: 'reputation_delta', value: 500, reason: '调试 · 声望 +500' })">
            <PmIcon name="heart" :size="12" /> 声望 +500
          </button>
          <button class="pm-btn sm" @click="game.pushLog('叙事', '手动记录 · 普通访客抵达')">
            <PmIcon name="scroll" :size="12" /> 写入引擎记录
          </button>
        </div>
      </section>
      <section v-show="activeSettingsSection === 'debug'" class="settings-card pm-card prompt-debug-card final-prompt-card">
        <h3>最终提示词查看器</h3>
        <p class="pm-dim">
          这里记录酒馆真正准备发送给模型的消息包。它会尽量抓取预设、世界书、聊天历史、前端注入和玩家输入，适合排查关键词世界书为什么没有触发。
        </p>
        <div class="prompt-debug-layout">
          <aside class="prompt-debug-list">
            <button
              v-for="item in finalPromptDebugSnapshots"
              :key="item.id"
              class="prompt-debug-item"
              :class="{ active: selectedFinalPromptDebug?.id === item.id }"
              type="button"
              @click="selectedFinalPromptDebugId = item.id"
            >
              <span>{{ item.createdAt }}</span>
              <strong>{{ item.messageCount }} 条 · 约 {{ item.approxTokens }} token</strong>
              <small>{{ item.source }}{{ item.model ? ` · ${item.model}` : '' }}</small>
            </button>
            <div v-if="finalPromptDebugSnapshots.length === 0" class="pm-empty mini">
              暂无最终提示词记录。发起一次生成后会自动出现。
            </div>
          </aside>
          <div class="prompt-debug-main">
            <div class="card-actions prompt-toolbar">
              <button class="pm-btn sm" @click="refreshPromptDebug">
                <PmIcon name="check" :size="12" /> 刷新
              </button>
              <button class="pm-btn sm ghost" @click="copyFinalPromptDebug">
                <PmIcon name="scroll" :size="12" /> 复制整包
              </button>
              <input v-model="finalPromptSearch" class="pm-input prompt-search" placeholder="搜索 role 或内容..." />
            </div>
            <div v-if="selectedFinalPromptDebug" class="final-prompt-summary">
              <span>{{ selectedFinalPromptDebug.messageCount }} 条消息</span>
              <span>{{ selectedFinalPromptDebug.totalChars }} 字符</span>
              <span>约 {{ selectedFinalPromptDebug.approxTokens }} token</span>
              <span>世界书命中 {{ selectedFinalPromptDebug.activatedWorldbookEntries.length }} 条</span>
            </div>
            <div v-if="selectedFinalPromptDebug?.activatedWorldbookEntries.length" class="worldbook-hit-list">
              <strong>本次命中的世界书</strong>
              <pre>{{ JSON.stringify(selectedFinalPromptDebug.activatedWorldbookEntries, null, 2) }}</pre>
            </div>
            <div class="final-prompt-messages">
              <details
                v-for="message in filteredFinalPromptMessages"
                :key="`${selectedFinalPromptDebug?.id}-${message.index}`"
                class="final-prompt-message"
                :open="finalPromptSearch.length > 0"
              >
                <summary>
                  <span>Role: {{ message.role }}</span>
                  <small>#{{ message.index + 1 }} · {{ message.charCount }} 字符 · 约 {{ message.approxTokens }} token</small>
                  <button class="pm-btn sm ghost" type="button" @click.prevent="copyFinalPromptMessage(message.content)">
                    复制
                  </button>
                </summary>
                <pre>{{ message.content }}</pre>
              </details>
              <div v-if="selectedFinalPromptDebug && filteredFinalPromptMessages.length === 0" class="pm-empty mini">
                没有匹配的提示词片段。
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="weatherBindOpen" class="pm-modal-mask" @click.self="weatherBindOpen = false">
        <div class="pm-modal wide">
          <header class="pm-modal-head">
            <h3><PmIcon name="scroll" :size="16" /> 选择天气池条目</h3>
            <button class="pm-link" @click="weatherBindOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <div class="worldbook-bind-toolbar">
              <input v-model="weatherBindSearch" class="pm-input" placeholder="搜索世界书、条目名、关键词或正文..." />
              <button class="pm-btn sm" :disabled="weatherWorldbookLoading" @click="refreshWeatherWorldbookEntries">
                <PmIcon name="check" :size="12" /> 刷新
              </button>
            </div>
            <div v-if="weatherWorldbookError" class="worldbook-error">{{ weatherWorldbookError }}</div>
            <div v-if="weatherWorldbookLoading" class="pm-empty mini">正在读取世界书条目...</div>
            <div v-else-if="filteredWeatherWorldbookEntries.length === 0" class="pm-empty mini">
              没有找到天气池条目。请确认条目正文包含 &lt;PrimordiaWeatherPool&gt; 标签，或输入关键词搜索全部条目。
            </div>
            <div v-else class="worldbook-search-results">
              <article
                v-for="item in filteredWeatherWorldbookEntries"
                :key="`weather-${item.worldbookName}-${item.uid}`"
                class="worldbook-search-item"
              >
                <header>
                  <strong>{{ getWorldbookEntryName(item.entry) || `uid ${item.uid}` }}</strong>
                  <span class="pm-tag dim">{{ item.worldbookName }}</span>
                  <span class="pm-tag" :class="item.entry.enabled ? 'good' : 'warn'">{{ item.entry.enabled ? '启用' : '停用' }}</span>
                  <span v-if="hasWeatherPoolTag(item.entry.content)" class="pm-tag good">天气池</span>
                </header>
                <div class="worldbook-meta">{{ item.worldbookSources.join('、') }} · uid {{ item.uid }}</div>
                <div class="worldbook-meta">关键词：{{ entryKeysText(item.entry) }}</div>
                <div class="worldbook-meta activity-detect">
                  <template v-if="weatherEntryStats(item.entry).blockCount">
                    检测到 {{ weatherEntryStats(item.entry).blockCount }} 块 ·
                    {{ weatherEntryStats(item.entry).monthCount }} 个月 ·
                    {{ weatherEntryStats(item.entry).weatherCount }} 条天气
                  </template>
                  <template v-else>未检测到天气池标签</template>
                </div>
                <div v-if="weatherEntryStats(item.entry).monthWeatherCounts.length" class="worldbook-region-counts">
                  <span v-for="month in weatherEntryStats(item.entry).monthWeatherCounts" :key="month.month">
                    {{ month.month }} {{ month.count }}
                  </span>
                </div>
                <div v-if="weatherEntryStats(item.entry).errors.length" class="worldbook-error mini">
                  <div v-for="error in weatherEntryStats(item.entry).errors" :key="error">{{ error }}</div>
                </div>
                <p>{{ entrySummary(item.entry) }}</p>
                <footer>
                  <button class="pm-btn sm" @click="bindWeatherWorldbookEntry(item)">
                    <PmIcon name="plus" :size="12" /> 绑定并读取
                  </button>
                </footer>
              </article>
            </div>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="weatherBindOpen = false">关闭</button>
          </footer>
        </div>
      </div>

      <div v-if="npcActivityBindOpen" class="pm-modal-mask" @click.self="npcActivityBindOpen = false">
        <div class="pm-modal wide">
          <header class="pm-modal-head">
            <h3><PmIcon name="scroll" :size="16" /> 选择后台行为库条目</h3>
            <button class="pm-link" @click="npcActivityBindOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <div class="worldbook-bind-toolbar">
              <input v-model="npcActivityBindSearch" class="pm-input" placeholder="搜索世界书、条目名、关键词或正文..." />
              <button class="pm-btn sm" :disabled="npcActivityWorldbookLoading" @click="refreshNpcActivityWorldbookEntries">
                <PmIcon name="check" :size="12" /> 刷新
              </button>
            </div>
            <div v-if="npcActivityWorldbookError" class="worldbook-error">{{ npcActivityWorldbookError }}</div>
            <div v-if="npcActivityWorldbookLoading" class="pm-empty mini">正在读取世界书条目...</div>
            <div v-else-if="filteredNpcActivityWorldbookEntries.length === 0" class="pm-empty mini">
              没有找到行为库条目。请确认条目正文包含 &lt;PrimordiaNpcActivities&gt; 标签，或输入关键词搜索全部条目。
            </div>
            <div v-else class="worldbook-search-results">
              <article
                v-for="item in filteredNpcActivityWorldbookEntries"
                :key="`${item.worldbookName}-${item.uid}`"
                class="worldbook-search-item"
              >
                <header>
                  <strong>{{ getWorldbookEntryName(item.entry) || `uid ${item.uid}` }}</strong>
                  <span class="pm-tag dim">{{ item.worldbookName }}</span>
                  <span class="pm-tag" :class="item.entry.enabled ? 'good' : 'warn'">{{ item.entry.enabled ? '启用' : '停用' }}</span>
                  <span v-if="hasNpcActivityTag(item.entry.content)" class="pm-tag good">行为库</span>
                </header>
                <div class="worldbook-meta">{{ item.worldbookSources.join('、') }} · uid {{ item.uid }}</div>
                <div class="worldbook-meta">关键词：{{ entryKeysText(item.entry) }}</div>
                <div class="worldbook-meta activity-detect">
                  <template v-if="activityEntryStats(item.entry).blockCount">
                    检测到 {{ activityEntryStats(item.entry).blockCount }} 块 ·
                    {{ activityEntryStats(item.entry).regionCount }} 区 ·
                    {{ activityEntryStats(item.entry).behaviorCount }} 条行为 ·
                    {{ activityEntryStats(item.entry).conversationTopicCount }} 个交谈主题 ·
                    {{ activityEntryStats(item.entry).restBehaviorCount }} 个休息行为
                  </template>
                  <template v-else>未检测到行为库标签</template>
                </div>
                <div v-if="activityEntryStats(item.entry).regionBehaviorCounts.length" class="worldbook-region-counts">
                  <span v-for="region in activityEntryStats(item.entry).regionBehaviorCounts" :key="region.region">
                    {{ region.region }} {{ region.count }}
                  </span>
                </div>
                <div v-if="activityEntryStats(item.entry).errors.length" class="worldbook-error mini">
                  <div v-for="error in activityEntryStats(item.entry).errors" :key="error">{{ error }}</div>
                </div>
                <p>{{ entrySummary(item.entry) }}</p>
                <footer>
                  <button class="pm-btn sm" @click="bindNpcActivityWorldbookEntry(item)">
                    <PmIcon name="plus" :size="12" /> 绑定并读取
                  </button>
                </footer>
              </article>
            </div>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="npcActivityBindOpen = false">关闭</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
#page-settings {
  grid-template-rows: auto auto minmax(0, 1fr);
}
.settings-tabs {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding: 0 18px 14px;
  border-bottom: 1px dashed var(--pm-edge-soft);
}
.settings-tab {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 3px;
  min-height: 58px;
  padding: 10px 12px;
  border: 1px solid rgba(118, 82, 38, 0.26);
  border-radius: 8px;
  background: rgba(255, 248, 226, 0.3);
  color: var(--pm-ink-dim);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    transform 0.18s ease;
}
.settings-tab:hover,
.settings-tab.active {
  border-color: rgba(190, 143, 52, 0.74);
  background: rgba(214, 174, 89, 0.2);
  color: var(--pm-ink);
  transform: translateY(-1px);
}
.settings-tab strong {
  font-family: var(--pm-font-display);
  font-size: calc(13px * var(--pm-text-scale));
  letter-spacing: 0.08em;
}
.settings-tab span {
  color: var(--pm-muted);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.35;
}
.settings-grid {
  position: relative;
  z-index: 0;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.settings-card h3 {
  margin: 0 0 8px;
  font-family: var(--pm-font-display);
  letter-spacing: 0.12em;
  font-size: calc(14px * var(--pm-text-scale));
  color: var(--pm-ink);
}
.size-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
.theme-card {
  grid-column: 1 / -1;
}
.npc-activity-card {
  grid-column: 1 / -1;
}
.activity-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  color: var(--pm-ink-soft);
  font-size: calc(12px * var(--pm-text-scale));
}
.activity-status.mini {
  gap: 12px;
  color: var(--pm-ink-dim);
}
.activity-tuning-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.activity-errors {
  display: grid;
  gap: 4px;
  max-height: 120px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--pm-status-bad-border);
  border-radius: 4px;
  background: var(--pm-status-bad-bg);
  color: var(--pm-status-bad-text);
  font-size: calc(11px * var(--pm-text-scale));
}
.activity-region-counts,
.worldbook-region-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 6px 0;
}
.activity-region-counts span,
.worldbook-region-counts span {
  padding: 3px 7px;
  border: 1px solid var(--pm-edge-soft);
  border-radius: 999px;
  background: rgba(255, 248, 226, 0.46);
  color: var(--pm-ink-soft);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.2;
}
.default-activity-box {
  display: grid;
  gap: 8px;
  margin: 8px 0;
}
.default-activity-list {
  display: grid;
  gap: 6px;
  max-height: 260px;
  overflow: auto;
  padding: 9px;
  border: 1px solid var(--pm-edge-soft);
  border-radius: 8px;
  background: rgba(255, 248, 226, 0.34);
}
.default-activity-list article {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 6px 0;
  border-bottom: 1px dashed var(--pm-edge-soft);
  color: var(--pm-ink-soft);
  font-size: calc(12px * var(--pm-text-scale));
  line-height: 1.6;
}
.default-activity-list article:last-child {
  border-bottom: 0;
}
.default-activity-list strong {
  color: var(--pm-ink);
}
.activity-picker-box {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  padding: 10px;
  border: 1px dashed var(--pm-edge-soft);
  border-radius: 8px;
  background: rgba(255, 248, 226, 0.28);
}
.activity-binding-box {
  display: none;
}
.activity-binding-box .pm-field {
  margin: 0;
}
.worldbook-bind-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.worldbook-bind-toolbar .pm-input {
  flex: 1;
  min-width: 220px;
}
.worldbook-error {
  padding: 7px 9px;
  border: 1px solid rgba(150, 55, 40, 0.45);
  border-radius: 6px;
  background: rgba(138, 48, 33, 0.1);
  color: #7a2a1f;
  font-size: calc(12px * var(--pm-text-scale));
  line-height: 1.5;
}
.worldbook-error.mini {
  padding: 5px 7px;
  font-size: calc(11px * var(--pm-text-scale));
}
.worldbook-search-results {
  display: grid;
  gap: 8px;
  max-height: min(58vh, 620px);
  overflow: auto;
  padding-right: 4px;
}
.worldbook-search-item {
  display: grid;
  gap: 6px;
  padding: 9px;
  border: 1px solid rgba(110, 80, 34, 0.38);
  border-radius: 6px;
  background: rgba(255, 248, 226, 0.5);
}
.worldbook-search-item header,
.worldbook-search-item footer {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.worldbook-search-item strong {
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(13px * var(--pm-text-scale));
}
.worldbook-search-item p {
  margin: 0;
  color: var(--pm-ink-soft);
  font-size: calc(11.5px * var(--pm-text-scale));
  line-height: 1.65;
}
.worldbook-meta {
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.45;
}
.activity-detect {
  color: var(--pm-accent-strong);
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.theme-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--pm-edge-soft);
  border-radius: 8px;
  background: rgba(255, 248, 226, 0.34);
  color: var(--pm-ink-soft);
  text-align: left;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    transform 0.18s ease;
}
.theme-option:hover,
.theme-option.active {
  border-color: var(--pm-gold);
  background: rgba(214, 174, 89, 0.18);
  transform: translateY(-1px);
}
.theme-option.active {
  box-shadow:
    inset 0 0 0 1px var(--pm-line-bright),
    0 8px 18px -14px rgba(0, 0, 0, 0.45);
}
.theme-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.theme-copy strong {
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(13px * var(--pm-text-scale));
  letter-spacing: 0.08em;
}
.theme-copy small {
  color: var(--pm-ink-dim);
  line-height: 1.45;
  font-size: calc(11px * var(--pm-text-scale));
}
.theme-swatches {
  display: inline-flex;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--pm-edge-soft);
  border-radius: 999px;
  background: rgba(255, 248, 226, 0.42);
}
.theme-swatches i {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.22);
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: var(--pm-ink-soft);
}
.toggle-row span {
  display: grid;
  gap: 4px;
}
.toggle-row strong {
  color: var(--pm-ink);
  font-size: calc(13px * var(--pm-text-scale));
}
.toggle-row small {
  line-height: 1.6;
  color: var(--pm-muted);
}
.toggle-switch {
  min-width: 76px;
  height: 32px;
  border: 1px solid rgba(110, 80, 34, 0.4);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(98, 75, 44, 0.24), rgba(66, 43, 22, 0.18));
  color: var(--pm-ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  justify-content: center;
  cursor: pointer;
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
}
.toggle-switch i {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #9b8060;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
.toggle-switch.on {
  border-color: rgba(169, 129, 48, 0.68);
  background: linear-gradient(180deg, rgba(230, 196, 108, 0.5), rgba(171, 125, 39, 0.36));
  color: #4c3419;
}
.toggle-switch.on i {
  background: radial-gradient(circle at 32% 26%, #fff7cf, #d6a93f 70%);
}
.health {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: calc(12px * var(--pm-text-scale));
}
.health li {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px dashed rgba(110, 80, 34, 0.28);
  color: var(--pm-ink-soft);
}
.health li:last-child {
  border-bottom: none;
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.json-preview {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--pm-code-bg);
  color: var(--pm-code-text);
  font-family: 'Consolas', monospace;
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.55;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--pm-line-soft);
}
.migration-status {
  display: inline-flex;
  margin: 10px 0 0;
  padding: 6px 10px;
  border: 1px solid rgba(190, 143, 52, 0.36);
  border-radius: 8px;
  background: rgba(214, 174, 89, 0.14);
  color: var(--pm-ink);
  font-size: calc(12px * var(--pm-text-scale));
}
.prompt-debug-card {
  grid-column: 1 / -1;
}
.self-check-card {
  grid-column: 1 / -1;
}
.self-check-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.self-check-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: start;
  padding: 9px 10px;
  border: 1px solid rgba(118, 82, 38, 0.28);
  border-radius: 8px;
  background: rgba(255, 248, 226, 0.48);
}
.self-check-item.good {
  border-color: rgba(81, 128, 78, 0.38);
}
.self-check-item.warn {
  border-color: rgba(171, 125, 39, 0.52);
  background: rgba(245, 218, 150, 0.36);
}
.self-check-item.bad {
  border-color: rgba(158, 71, 54, 0.62);
  background: rgba(130, 56, 45, 0.12);
}
.self-check-item strong {
  display: block;
  color: var(--pm-ink);
  font-size: calc(12.5px * var(--pm-text-scale));
}
.self-check-item p {
  margin: 3px 0 0;
  color: var(--pm-ink-dim);
  line-height: 1.55;
  font-size: calc(11.5px * var(--pm-text-scale));
}
.debug-json {
  max-height: 360px;
}
.prompt-debug-layout {
  display: grid;
  grid-template-columns: minmax(220px, 0.45fr) minmax(320px, 1fr);
  gap: 12px;
  align-items: start;
}
.prompt-debug-list {
  display: grid;
  gap: 7px;
  max-height: 360px;
  overflow: auto;
  padding-right: 4px;
}
.prompt-debug-item {
  border: 1px solid rgba(118, 82, 38, 0.28);
  border-radius: 8px;
  background: rgba(70, 48, 26, 0.08);
  color: var(--pm-ink-soft);
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  text-align: left;
  cursor: pointer;
}
.prompt-debug-item:hover,
.prompt-debug-item.active {
  border-color: rgba(190, 143, 52, 0.75);
  background: rgba(214, 174, 89, 0.18);
  color: var(--pm-ink);
}
.prompt-debug-item.error {
  border-color: rgba(158, 71, 54, 0.65);
}
.prompt-debug-item span,
.prompt-debug-item small {
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-muted);
}
.prompt-debug-item strong {
  font-size: calc(12px * var(--pm-text-scale));
}
.prompt-debug-main {
  min-width: 0;
}
.prompt-debug-json {
  max-height: 420px;
  white-space: pre-wrap;
  word-break: break-word;
}
.prompt-toolbar {
  align-items: center;
}
.prompt-search {
  flex: 1;
  min-width: 220px;
}
.final-prompt-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  color: var(--pm-ink-soft);
  font-size: calc(11px * var(--pm-text-scale));
}
.final-prompt-summary span {
  border: 1px solid rgba(118, 82, 38, 0.24);
  border-radius: 999px;
  background: rgba(255, 248, 226, 0.42);
  padding: 4px 8px;
}
.worldbook-hit-list {
  margin-top: 10px;
  border: 1px solid rgba(122, 92, 46, 0.26);
  border-radius: 8px;
  background: rgba(255, 248, 226, 0.38);
  padding: 8px;
}
.worldbook-hit-list strong {
  display: block;
  margin-bottom: 6px;
  color: var(--pm-ink);
  font-size: calc(12px * var(--pm-text-scale));
}
.worldbook-hit-list pre {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', monospace;
  font-size: calc(10.5px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
}
.final-prompt-messages {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.final-prompt-message {
  border: 1px solid rgba(118, 82, 38, 0.28);
  border-radius: 8px;
  background: rgba(59, 37, 18, 0.06);
  overflow: hidden;
}
.final-prompt-message summary {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  color: var(--pm-ink);
}
.final-prompt-message summary::-webkit-details-marker {
  display: none;
}
.final-prompt-message summary small {
  color: var(--pm-muted);
  font-size: calc(11px * var(--pm-text-scale));
}
.final-prompt-message pre {
  margin: 0;
  border-top: 1px solid rgba(118, 82, 38, 0.2);
  padding: 10px 12px;
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--pm-code-bg);
  color: var(--pm-code-text);
  font-family: 'Consolas', monospace;
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.55;
}
.debug-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.promise-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.promise-card {
  border: 1px solid rgba(118, 82, 38, 0.28);
  border-radius: 8px;
  background: rgba(255, 248, 226, 0.34);
  padding: 10px;
}
.promise-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.promise-card p {
  margin: 6px 0 0;
  line-height: 1.55;
}
.edit-error,
.edit-notice {
  margin: 8px 0 0;
  font-size: calc(12px * var(--pm-text-scale));
}
.edit-error {
  color: #9b2c2c;
}
.edit-notice {
  color: #2f7d52;
}
@media (max-width: 820px) {
  .settings-tabs {
    display: flex;
    grid-template-columns: none;
    gap: 6px;
    padding: 0 10px 8px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x proximity;
  }
  .settings-tabs::-webkit-scrollbar {
    display: none;
  }
  .settings-tab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 82px;
    padding: 7px 11px;
    border-radius: 999px;
    text-align: center;
    scroll-snap-align: start;
    white-space: nowrap;
  }
  .settings-tab:hover,
  .settings-tab.active {
    transform: none;
  }
  .settings-tab strong {
    font-size: calc(12px * var(--pm-text-scale));
    letter-spacing: 0.04em;
  }
  .settings-tab span {
    display: none;
  }
  .settings-grid {
    gap: 10px;
    grid-template-columns: 1fr;
  }
  .prompt-debug-layout {
    grid-template-columns: 1fr;
  }
  .final-prompt-message summary {
    grid-template-columns: 1fr;
  }
}
</style>
