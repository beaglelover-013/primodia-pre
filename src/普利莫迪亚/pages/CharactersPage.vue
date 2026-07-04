<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatCopper, useGameStore, type Heroine } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';
import {
  canCreateWorldbookEntry,
  createAndBindWorldbookEntry,
  getActiveWorldbookNames,
  getWorldbookEntryName,
  isWorldbookApiAvailable,
  loadActiveWorldbookEntries,
  loadWorldbookEntry,
  saveWorldbookEntry,
  stringifyEntryJson,
  type EditableWorldbookEntry,
  type WorldbookEntrySearchItem,
} from '../services/worldbookService';

const game = useGameStore();
const giftCosts = { 橙皮陈酿: 180, 泥金蜂蜜小罐: 1_500, 银烛台: 5_400 } as const;

const visibleHeroines = computed(() => game.heroines);

const selectedId = computed({
  get: () => game.selectedHeroineId ?? visibleHeroines.value[0]?.id ?? null,
  set: v => (game.selectedHeroineId = v),
});
const selected = computed(() => visibleHeroines.value.find(h => h.id === selectedId.value) ?? visibleHeroines.value[0] ?? null);
const selectedWorldbookBindings = computed(() => (selected.value ? (game.characterWorldbookBindings[selected.value.id] ?? []) : []));
const selectedBehaviorLibrary = computed(() => (selected.value ? game.characterBehaviorLibraries[selected.value.id] ?? null : null));
const cgRatingTab = ref<'sfw' | 'nsfw'>('sfw');
const selectedBehaviorGroups = computed(() => {
  const library = selectedBehaviorLibrary.value;
  if (!library) return [];
  const groups = new Map<string, Array<(typeof library.behaviors)[number]>>();
  for (const item of library.behaviors) {
    const region = item.region || '未定位';
    groups.set(region, [...(groups.get(region) ?? []), item]);
  }
  if (library.unlocatedBehaviors.length) groups.set('未定位行为', library.unlocatedBehaviors);
  return [...groups.entries()].map(([region, items]) => ({ region, items }));
});
const selectedCgSlots = computed(() => {
  if (!selected.value) return [];
  return selected.value.cgSlots?.length
    ? selected.value.cgSlots
    : Array.from({ length: 6 }, (_, idx) => ({
        id: `${selected.value?.id}-cg-${idx + 1}`,
        title: `CG ${idx + 1}`,
        unlocked: idx === 0,
        note: '之后把图床链接填到角色数据的 url 字段。',
      }));
});
const visibleCgSlots = computed(() => selectedCgSlots.value.filter(item => (item.rating ?? 'sfw') === cgRatingTab.value));
const selectedCgCounts = computed(() => ({
  sfw: selectedCgSlots.value.filter(item => (item.rating ?? 'sfw') === 'sfw').length,
  nsfw: selectedCgSlots.value.filter(item => item.rating === 'nsfw').length,
}));

watch(selectedId, () => {
  cgRatingTab.value = 'sfw';
});

function hpPhase(h: Heroine) {
  return game.lifePhase(h.hp, h.hpMax);
}

function energyPhase(h: Heroine) {
  return game.energyPhase(h.energy, h.energyMax);
}

function bladderPhase(h: Heroine) {
  return game.bladderPhase(h.bladder, h.bladderMax);
}

function aiStateLine(h: Heroine) {
  return `当前状态: 生命「${hpPhase(h)}」, 精力「${energyPhase(h)}」, 膀胱「${bladderPhase(h)}」。`;
}

/* 互动 */
function startChat(h: Heroine) {
  game.appendDraft(`我去找${h.name}交谈，留意她此刻的表情、语气和身体状态。${aiStateLine(h)}`);
  game.pushLog('提示', `交谈 · ${h.name} 已加入行动框。`);
}
const giftOpen = ref(false);
const giftTarget = ref<Heroine | null>(null);
function openGift(h: Heroine) {
  giftTarget.value = h;
  giftOpen.value = true;
}
async function sendGift(item: '橙皮陈酿' | '泥金蜂蜜小罐' | '银烛台') {
  if (!giftTarget.value) return;
  const h = giftTarget.value;
  const cost = giftCosts[item];
  const inc = Math.min(8, Math.floor(cost / 800) + 3);
  await game.executePseudoZeroAction({
    type: 'CHARACTER_GIFT',
    heroineId: h.id,
    itemName: item,
    costCopper: cost,
    affectionGain: inc,
    stateLine: aiStateLine(h),
  }, {
    type: 'CHARACTER_GIFT',
    title: `赠礼 · ${h.name}`,
    aiHint: `请承接当前位置和${h.name}当前状态, 叙述玩家送出「${item}」时她的反应。花费以前端结算为准；若礼物自然影响羁绊或状态, 请通过 MVU/变量体现。`,
    logText: `CHARACTER_GIFT · ${h.name} · ${item}`,
    autoSend: true,
  });
  giftOpen.value = false;
}

async function deleteCharacter(h: Heroine) {
  if (!window.confirm(`确定删除配角「${h.name}」吗？这会从当前变量和人物羁绊列表里移除。`)) return;
  if (!window.confirm(`再次确认删除「${h.name}」？删除后会同步移除她的世界书绑定和行为库缓存。`)) return;
  await game.deleteHeroine(h.id);
}

const memoryOpen = ref(false);
const memoryTarget = ref<Heroine | null>(null);
function openMemory(h: Heroine) {
  memoryTarget.value = h;
  memoryOpen.value = true;
}

const worldbookLoading = ref(false);
const worldbookError = ref('');
const worldbookEntries = ref<WorldbookEntrySearchItem[]>([]);
const boundWorldbookEntryCache = ref<Record<string, EditableWorldbookEntry | null>>({});
const bindOpen = ref(false);
const bindSearch = ref('');
const editOpen = ref(false);
const editingWorldbookName = ref('');
const editingEntry = ref<EditableWorldbookEntry | null>(null);
const editingJson = ref('');
const editingName = ref('');
const editingEnabled = ref(true);
const editingContent = ref('');
const editingKeys = ref('');
const editingProbability = ref(100);
const editingPositionType = ref('');
const editingDepth = ref(0);
const editingOrder = ref(100);
const createOpen = ref(false);
const createWorldbookName = ref('');
const createEntryName = ref('');
const createEntryContent = ref('');
const behaviorRegion = ref('');
const behaviorText = ref('');
const behaviorFeel = ref('');

const worldbookApiReady = computed(() => isWorldbookApiAvailable());
const activeWorldbooks = computed(() => getActiveWorldbookNames());
const searchableWorldbookEntries = computed(() => {
  const q = bindSearch.value.trim().toLowerCase();
  const boundKeys = new Set(selectedWorldbookBindings.value.map(binding => `${binding.worldbookName}:${binding.uid}`));
  return worldbookEntries.value
    .filter(item => !boundKeys.has(`${item.worldbookName}:${item.uid}`))
    .filter(item => {
      if (!q) return true;
      const keys = (item.entry.strategy?.keys ?? []).join(' ');
      return `${item.worldbookName} ${getWorldbookEntryName(item.entry)} ${keys} ${item.entry.content}`.toLowerCase().includes(q);
    });
});
const boundWorldbookCards = computed(() =>
  selectedWorldbookBindings.value.map(binding => ({
    binding,
    entry:
      boundWorldbookEntryCache.value[bindingCacheKey(binding.worldbookName, binding.uid)] ??
      worldbookEntries.value.find(item => item.worldbookName === binding.worldbookName && item.uid === binding.uid)?.entry ??
      null,
  })),
);

function bindingCacheKey(worldbookName: string, uid: number) {
  return `${worldbookName}::${uid}`;
}

async function refreshBoundWorldbookEntries() {
  if (!worldbookApiReady.value || selectedWorldbookBindings.value.length === 0) {
    boundWorldbookEntryCache.value = {};
    return;
  }
  const next: Record<string, EditableWorldbookEntry | null> = {};
  await Promise.all(
    selectedWorldbookBindings.value.map(async binding => {
      const key = bindingCacheKey(binding.worldbookName, binding.uid);
      try {
        next[key] = await loadWorldbookEntry(binding);
      } catch {
        next[key] = null;
      }
    }),
  );
  boundWorldbookEntryCache.value = next;
}

watch(
  () => selectedWorldbookBindings.value.map(binding => `${binding.worldbookName}:${binding.uid}`).join('|'),
  () => {
    void refreshBoundWorldbookEntries();
  },
  { immediate: true },
);

watch(
  () => selected.value?.id,
  heroineId => {
    if (!heroineId) return;
    behaviorRegion.value = selected.value?.located ?? '';
    if (!game.characterBehaviorLibraries[heroineId]) void game.loadCharacterBehaviorLibraryForHeroine(heroineId);
  },
  { immediate: true },
);

async function refreshBehaviorLibrary() {
  if (!selected.value) return;
  await game.loadCharacterBehaviorLibraryForHeroine(selected.value.id);
}

async function addBehaviorLibraryItem() {
  if (!selected.value || !behaviorText.value.trim()) return;
  await game.addCharacterBehavior(selected.value.id, {
    region: behaviorRegion.value.trim() || selected.value.located,
    behavior: behaviorText.value.trim(),
    protagonistFeel: behaviorFeel.value.trim(),
    trigger: 'manual',
    source: '玩家手动维护',
  });
  behaviorText.value = '';
  behaviorFeel.value = '';
}

async function editBehaviorLibraryItem(item: { id: string; behavior: string; region: string; protagonistFeel: string }) {
  if (!selected.value) return;
  const nextBehavior = window.prompt('修改这条行为', item.behavior);
  if (nextBehavior === null) return;
  const nextFeel = window.prompt('主角能感受到什么？', item.protagonistFeel ?? '');
  await game.updateCharacterBehavior(selected.value.id, item.id, {
    behavior: nextBehavior.trim() || item.behavior,
    protagonistFeel: nextFeel?.trim() ?? item.protagonistFeel,
  });
}

async function deleteBehaviorLibraryItem(item: { id: string; behavior: string }) {
  if (!selected.value) return;
  if (!window.confirm(`删除这条行为记忆吗？\n${item.behavior}`)) return;
  await game.deleteCharacterBehavior(selected.value.id, item.id);
}

function entryKeysText(entry: EditableWorldbookEntry | null) {
  const keys = entry?.strategy?.keys;
  return Array.isArray(keys) ? keys.map(String).join('、') : '未设置关键词';
}

function entrySummary(entry: EditableWorldbookEntry | null) {
  const text = String(entry?.content ?? '').replace(/\s+/g, ' ').trim();
  return text ? `${text.slice(0, 120)}${text.length > 120 ? '...' : ''}` : '条目正文为空。';
}

async function refreshWorldbookEntries() {
  worldbookError.value = '';
  if (!worldbookApiReady.value) {
    worldbookError.value = '当前环境不支持世界书读写。';
    return;
  }
  worldbookLoading.value = true;
  try {
    worldbookEntries.value = await loadActiveWorldbookEntries();
    await refreshBoundWorldbookEntries();
  } catch (error) {
    worldbookError.value = error instanceof Error ? error.message : '读取世界书失败。';
  } finally {
    worldbookLoading.value = false;
  }
}

async function openBindWorldbook() {
  bindOpen.value = true;
  await refreshWorldbookEntries();
}

async function bindWorldbookEntry(item: WorldbookEntrySearchItem) {
  if (!selected.value) return;
  await game.bindCharacterWorldbookEntry(selected.value.id, {
    worldbookName: item.worldbookName,
    uid: item.uid,
    label: getWorldbookEntryName(item.entry),
  });
  boundWorldbookEntryCache.value = {
    ...boundWorldbookEntryCache.value,
    [bindingCacheKey(item.worldbookName, item.uid)]: item.entry,
  };
  game.pushLog('系统', `已为 ${selected.value.name} 绑定世界书条目「${getWorldbookEntryName(item.entry)}」。`);
}

async function unbindWorldbook(binding: { worldbookName: string; uid: number }) {
  if (!selected.value) return;
  await game.unbindCharacterWorldbookEntry(selected.value.id, binding.worldbookName, binding.uid);
  const nextCache = { ...boundWorldbookEntryCache.value };
  delete nextCache[bindingCacheKey(binding.worldbookName, binding.uid)];
  boundWorldbookEntryCache.value = nextCache;
  game.pushLog('系统', `已取消 ${selected.value.name} 的世界书条目绑定。`);
}

async function editWorldbook(binding: { worldbookName: string; uid: number; label?: string }) {
  worldbookError.value = '';
  try {
    const entry = await loadWorldbookEntry(binding);
    if (!entry) {
      worldbookError.value = `绑定失效：世界书「${binding.worldbookName}」中找不到 uid=${binding.uid} 的条目。`;
      return;
    }
    editingWorldbookName.value = binding.worldbookName;
    editingEntry.value = entry;
    editingJson.value = stringifyEntryJson(entry);
    editingName.value = getWorldbookEntryName(entry);
    editingEnabled.value = Boolean(entry.enabled);
    editingContent.value = entry.content ?? '';
    editingKeys.value = Array.isArray(entry.strategy?.keys) ? entry.strategy.keys.map(String).join('\n') : '';
    editingProbability.value = Number(entry.probability ?? 100);
    editingPositionType.value = String(entry.position?.type ?? '');
    editingDepth.value = Number(entry.position?.depth ?? 0);
    editingOrder.value = Number(entry.position?.order ?? 100);
    editOpen.value = true;
  } catch (error) {
    worldbookError.value = error instanceof Error ? error.message : '读取条目失败。';
  }
}

function buildEditedWorldbookEntry() {
  const parsed = JSON.parse(editingJson.value) as EditableWorldbookEntry;
  parsed.name = editingName.value.trim() || parsed.name;
  parsed.enabled = editingEnabled.value;
  parsed.content = editingContent.value;
  parsed.probability = Number.isFinite(Number(editingProbability.value)) ? Number(editingProbability.value) : parsed.probability;
  parsed.strategy = {
    ...(parsed.strategy ?? {}),
    keys: editingKeys.value
      .split(/\n+/)
      .map(item => item.trim())
      .filter(Boolean),
  };
  parsed.position = {
    ...(parsed.position ?? {}),
    type: editingPositionType.value || parsed.position?.type || 'before_author_note',
    depth: Number.isFinite(Number(editingDepth.value)) ? Number(editingDepth.value) : (parsed.position?.depth ?? 0),
    order: Number.isFinite(Number(editingOrder.value)) ? Number(editingOrder.value) : (parsed.position?.order ?? 100),
  };
  return parsed;
}

async function saveEditingWorldbook() {
  if (!selected.value || !editingEntry.value) return;
  worldbookError.value = '';
  try {
    const saved = await saveWorldbookEntry(editingWorldbookName.value, buildEditedWorldbookEntry());
    await game.touchCharacterWorldbookBinding(selected.value.id, editingWorldbookName.value, saved.uid, getWorldbookEntryName(saved));
    boundWorldbookEntryCache.value = {
      ...boundWorldbookEntryCache.value,
      [bindingCacheKey(editingWorldbookName.value, saved.uid)]: saved,
    };
    game.pushLog('系统', `已同步世界书条目「${getWorldbookEntryName(saved)}」。`);
    editOpen.value = false;
    await refreshWorldbookEntries();
  } catch (error) {
    worldbookError.value = error instanceof Error ? error.message : '保存世界书条目失败。';
  }
}

function openCreateWorldbookEntry() {
  const firstBook = activeWorldbooks.value[0]?.name ?? '';
  createWorldbookName.value = createWorldbookName.value || firstBook;
  createEntryName.value = selected.value ? `${selected.value.name} · 新设定` : '新的设定条目';
  createEntryContent.value = '';
  createOpen.value = true;
}

async function createWorldbookEntryForSelected() {
  if (!selected.value) return;
  worldbookError.value = '';
  try {
    const entry = await createAndBindWorldbookEntry(createWorldbookName.value, {
      name: createEntryName.value.trim() || `${selected.value.name} · 新设定`,
      content: createEntryContent.value,
      enabled: true,
    });
    await game.bindCharacterWorldbookEntry(selected.value.id, {
      worldbookName: createWorldbookName.value,
      uid: entry.uid,
      label: getWorldbookEntryName(entry),
    });
    boundWorldbookEntryCache.value = {
      ...boundWorldbookEntryCache.value,
      [bindingCacheKey(createWorldbookName.value, entry.uid)]: entry,
    };
    game.pushLog('系统', `已创建并绑定世界书条目「${getWorldbookEntryName(entry)}」。`);
    createOpen.value = false;
    await refreshWorldbookEntries();
  } catch (error) {
    worldbookError.value = error instanceof Error ? error.message : '创建世界书条目失败。';
  }
}
</script>

<template>
  <section id="page-characters" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="people" :size="22" />
          人物羁绊
        </h2>
        <div class="sub">配角关系 · 交谈 · 赠礼 · 同场动向</div>
      </div>
      <div class="head-actions">
        <span class="pm-tag gold">配角档案</span>
      </div>
    </header>

    <div class="pm-paper-body char-layout">
      <!-- 卡片列表 -->
      <div class="char-list">
        <article
          v-for="h in visibleHeroines"
          :key="h.id"
          class="char-card"
          :class="{ selected: selectedId === h.id }"
          @click="selectedId = h.id"
        >
          <header class="char-head">
            <div
              class="portrait"
              :style="{ background: `radial-gradient(circle at 30% 30%, rgba(255,245,215,0.55), transparent 65%), linear-gradient(180deg, ${h.portraitColor}, #2a1c11)` }"
            >
              <PmIcon name="heart" :size="20" />
            </div>
            <div class="char-meta">
              <h3>
                {{ h.name }}
                <span class="pm-tag dim">配角</span>
              </h3>
              <div class="char-role">{{ h.title }} · {{ h.race }}</div>
              <div class="char-loc"><PmIcon name="pin" :size="12" /> {{ h.located }} · {{ h.mood }}</div>
            </div>
          </header>

          <!-- 状态进度 -->
          <div class="bars">
            <div class="bar-line">
              <span class="bar-label">生命</span>
              <span class="pm-bar hp"><i :style="{ width: `${(h.hp / h.hpMax) * 100}%` }"></i></span>
              <span class="pm-num">{{ h.hp }}/{{ h.hpMax }}</span>
            </div>
            <div class="bar-line">
              <span class="bar-label">精力</span>
              <span class="pm-bar energy"><i :style="{ width: `${(h.energy / h.energyMax) * 100}%` }"></i></span>
              <span class="pm-num">{{ h.energy }}/{{ h.energyMax }}</span>
            </div>
            <div class="bar-line">
              <span class="bar-label">膀胱</span>
              <span class="pm-bar bladder"><i :style="{ width: `${(h.bladder / h.bladderMax) * 100}%` }"></i></span>
              <span class="pm-num">{{ h.bladder }}/{{ h.bladderMax }}</span>
            </div>
            <div class="bar-line">
              <span class="bar-label">羁绊</span>
              <span class="pm-bar affection"><i :style="{ width: `${(h.affection / h.affectionMax) * 100}%` }"></i></span>
              <span class="pm-num">
                {{ h.affection }}/{{ h.affectionMax }} · 第{{ h.stage }}阶段
              </span>
            </div>
          </div>

          <div class="char-notes">
            <p><b>一句话穿着</b>{{ h.outfit || '衣着暂未记录。' }}</p>
            <p><b>备注</b>{{ h.bio || '暂无备注。' }}</p>
          </div>

          <footer class="char-acts">
            <button class="pm-btn sm" @click.stop="startChat(h)">
              <PmIcon name="chat" :size="12" /> 发起交谈
            </button>
            <button class="pm-btn sm dark" @click.stop="openGift(h)">
              <PmIcon name="gift" :size="12" /> 赠送 / 投喂
            </button>
            <button class="pm-btn sm danger" @click.stop="deleteCharacter(h)">
              <PmIcon name="x" :size="12" /> 删除
            </button>
          </footer>
        </article>
      </div>

      <!-- 右侧: 阶段图谱 -->
      <aside class="char-side">
        <div class="side-card pm-card">
          <h3>羁绊阶段 · 当前角色</h3>
          <template v-if="selected">
            <div class="stage-h">
              {{ selected.name }} · <span class="pm-tag gold">第 {{ selected.stage }} 阶段</span>
              <span class="pm-tag dim">{{ selected.stageName }}</span>
            </div>
            <div class="selected-fields">
              <span><b>种族</b>{{ selected.race }}</span>
              <span><b>身份</b>{{ selected.title }}</span>
              <span><b>好感</b>{{ selected.affection }}/{{ selected.affectionMax }}</span>
              <span><b>心情</b>{{ selected.mood }}</span>
              <span><b>所在位置</b>{{ selected.located }}</span>
              <span><b>一句话穿着</b>{{ selected.outfit || '衣着暂未记录。' }}</span>
            </div>
            <ol class="stage-list">
              <li
                v-for="(name, idx) in game.stageNames"
                :key="name"
                :class="{ done: idx + 1 < selected.stage, cur: idx + 1 === selected.stage }"
              >
                <span class="stage-idx">第{{ idx + 1 }}阶</span>
                <span class="stage-name">{{ name }}</span>
              </li>
            </ol>
            <div class="pm-line"></div>
            <div class="pm-dim">推荐: 关注精力, 适时赠送「{{ selected.gift ?? '一壶热茶' }}」推进。</div>
          </template>
          <div v-else class="pm-empty">点击左侧卡片选择一位角色, 查看专属阶段图谱。</div>
        </div>

        <div class="side-card pm-card behavior-card">
          <h3>角色行为库 · {{ selected?.name ?? '未选择' }}</h3>
          <template v-if="selected">
            <p class="pm-dim">
              这里记录这个角色逐渐学会的习惯、职责和长期互动倾向。条目默认写入专属世界书，但不会直接启用进提示词。
            </p>
            <div class="card-actions behavior-actions">
              <button class="pm-btn sm ghost" @click="refreshBehaviorLibrary">
                <PmIcon name="check" :size="12" /> 重新读取
              </button>
            </div>
            <div v-if="selectedBehaviorGroups.length === 0" class="pm-empty mini">
              暂无行为记忆。AI 学到稳定习惯后会自动写入，也可以在下面手动添加。
            </div>
            <div v-else class="behavior-group-list">
              <section v-for="group in selectedBehaviorGroups" :key="group.region" class="behavior-group">
                <header>
                  <strong>{{ group.region }}</strong>
                  <span class="pm-tag dim">{{ group.items.length }} 条</span>
                </header>
                <article v-for="item in group.items" :key="item.id" class="behavior-item">
                  <p>{{ item.behavior }}</p>
                  <small v-if="item.protagonistFeel">主角可感受到：{{ item.protagonistFeel }}</small>
                  <footer>
                    <button class="pm-btn sm ghost" @click="editBehaviorLibraryItem(item)">
                      <PmIcon name="scroll" :size="12" /> 编辑
                    </button>
                    <button class="pm-btn sm danger" @click="deleteBehaviorLibraryItem(item)">
                      <PmIcon name="x" :size="12" /> 删除
                    </button>
                  </footer>
                </article>
              </section>
            </div>
            <div class="behavior-form">
              <input v-model="behaviorRegion" class="pm-input" placeholder="区域，例如：主厅接待区" />
              <textarea v-model="behaviorText" class="pm-textarea compact" placeholder="行为，例如：会主动擦桌子并整理歪掉的椅子。"></textarea>
              <input v-model="behaviorFeel" class="pm-input" placeholder="主角感受，可选" />
              <button class="pm-btn sm" :disabled="!behaviorText.trim()" @click="addBehaviorLibraryItem">
                <PmIcon name="plus" :size="12" /> 添加行为
              </button>
            </div>
          </template>
          <div v-else class="pm-empty mini">先选择一位配角。</div>
        </div>

        <div class="side-card pm-card worldbook-card">
          <h3>世界书设定 · {{ selected?.name ?? '未选择' }}</h3>
          <template v-if="selected">
            <div v-if="worldbookError" class="worldbook-error">{{ worldbookError }}</div>
            <div class="card-actions worldbook-actions">
              <button class="pm-btn sm" :disabled="worldbookLoading || !worldbookApiReady" @click="openBindWorldbook">
                <PmIcon name="plus" :size="12" /> 添加条目
              </button>
              <button class="pm-btn sm ghost" :disabled="worldbookLoading || !worldbookApiReady" @click="refreshWorldbookEntries">
                <PmIcon name="check" :size="12" /> 刷新
              </button>
              <button class="pm-btn sm ghost" :disabled="worldbookLoading || !canCreateWorldbookEntry() || activeWorldbooks.length === 0" @click="openCreateWorldbookEntry">
                <PmIcon name="scroll" :size="12" /> 新建条目
              </button>
            </div>
            <div v-if="!worldbookApiReady" class="pm-empty mini">当前环境不支持世界书读写。</div>
            <div v-else-if="selectedWorldbookBindings.length === 0" class="pm-empty mini">
              还没有绑定世界书条目。点击“添加条目”后，从当前启用世界书里选择。
            </div>
            <div v-else class="bound-worldbook-list">
              <article v-for="card in boundWorldbookCards" :key="`${card.binding.worldbookName}-${card.binding.uid}`" class="bound-worldbook-item">
                <header>
                  <strong>{{ card.entry?.name ?? card.binding.label ?? `uid ${card.binding.uid}` }}</strong>
                  <span class="pm-tag" :class="card.entry?.enabled === false ? 'warn' : 'good'">
                    {{ card.entry ? (card.entry.enabled ? '启用' : '停用') : '失效' }}
                  </span>
                </header>
                <div class="worldbook-meta">{{ card.binding.worldbookName }} · uid {{ card.binding.uid }}</div>
                <div class="worldbook-meta">关键词：{{ entryKeysText(card.entry) }}</div>
                <p>{{ entrySummary(card.entry) }}</p>
                <footer>
                  <button class="pm-btn sm" @click="editWorldbook(card.binding)">
                    <PmIcon name="scroll" :size="12" /> 编辑
                  </button>
                  <button class="pm-btn sm ghost" @click="unbindWorldbook(card.binding)">
                    <PmIcon name="x" :size="12" /> 取消绑定
                  </button>
                </footer>
              </article>
            </div>
          </template>
          <div v-else class="pm-empty mini">先选择一位配角。</div>
        </div>

        <div class="side-card pm-card">
          <h3>CG 收纳 · {{ selected?.name ?? '未选择' }}</h3>
          <div class="cg-rating-tabs" role="tablist" aria-label="CG 分区">
            <button type="button" :class="{ active: cgRatingTab === 'sfw' }" @click="cgRatingTab = 'sfw'">
              SFW <span>{{ selectedCgCounts.sfw }}</span>
            </button>
            <button type="button" :class="{ active: cgRatingTab === 'nsfw' }" @click="cgRatingTab = 'nsfw'">
              NSFW <span>{{ selectedCgCounts.nsfw }}</span>
            </button>
          </div>
          <div v-if="selected" class="cg-grid-side">
            <article v-for="cg in visibleCgSlots" :key="cg.id" class="cg-slot" :class="{ locked: !cg.unlocked }">
              <div class="cg-thumb">
                <img v-if="cg.url" :src="cg.url" :alt="cg.title" />
                <div v-else class="cg-placeholder">
                  <PmIcon name="flourish" :size="18" />
                  <span>{{ cg.unlocked ? '待填链接' : '未解锁' }}</span>
                </div>
              </div>
              <div class="cg-info">
                <strong>{{ cg.title }}</strong>
                <span>{{ cg.note ?? '图床链接可稍后补入。' }}</span>
              </div>
            </article>
          </div>
        </div>

        <div class="side-card pm-card">
          <h3>同场角色</h3>
          <ul class="here-list">
            <li v-for="h in game.heroines" :key="h.id">
              <span class="here-dot" :style="{ background: h.portraitColor }"></span>
              <span class="here-name">{{ h.name }}</span>
              <span class="here-loc pm-dim">{{ h.located }}</span>
            </li>
          </ul>
        </div>
      </aside>
    </div>

    <!-- 赠送模态 -->
    <Teleport to="body">
      <div v-if="giftOpen" class="pm-modal-mask" @click.self="giftOpen = false">
        <div class="pm-modal">
          <header class="pm-modal-head">
            <h3><PmIcon name="gift" :size="16" /> 赠送 · {{ giftTarget?.name }}</h3>
            <button class="pm-link" @click="giftOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <p class="pm-dim">
              当前好感阶段 · {{ giftTarget?.stageName }} · 第 {{ giftTarget?.stage }} 阶段
            </p>
            <div class="gift-grid">
              <button class="gift-card" @click="sendGift('橙皮陈酿')">
                <span class="gift-tag">温酒</span>
                <span class="gift-name">橙皮陈酿</span>
                <span class="gift-cost pm-num">{{ formatCopper(giftCosts.橙皮陈酿) }}</span>
                <span class="gift-tip">日常关怀 · 羁绊 +3</span>
              </button>
              <button class="gift-card" @click="sendGift('泥金蜂蜜小罐')">
                <span class="gift-tag">珍品</span>
                <span class="gift-name">泥金蜂蜜小罐</span>
                <span class="gift-cost pm-num">{{ formatCopper(giftCosts.泥金蜂蜜小罐) }}</span>
                <span class="gift-tip">心动一瞬 · 羁绊 +5</span>
              </button>
              <button class="gift-card" @click="sendGift('银烛台')">
                <span class="gift-tag">名贵</span>
                <span class="gift-name">银烛台</span>
                <span class="gift-cost pm-num">{{ formatCopper(giftCosts.银烛台) }}</span>
                <span class="gift-tip">郑重承诺 · 羁绊 +8</span>
              </button>
            </div>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="giftOpen = false">取消</button>
          </footer>
        </div>
      </div>
    </Teleport>

    <!-- 记忆回鸣画卷 -->
    <Teleport to="body">
      <div v-if="memoryOpen" class="pm-modal-mask" @click.self="memoryOpen = false">
        <div class="pm-modal wide">
          <header class="pm-modal-head">
            <h3><PmIcon name="flourish" :size="16" /> 记忆回鸣画卷 · {{ memoryTarget?.name }}</h3>
            <button class="pm-link" @click="memoryOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <div class="cg-strip">
              <div v-for="i in 4" :key="i" class="cg-frame" :class="{ locked: (memoryTarget?.stage ?? 1) <= i }">
                <div class="cg-inner" :style="{ background: memoryTarget?.portraitColor }">
                  <span class="cg-no">画 {{ i }}</span>
                </div>
                <div class="cg-cap">
                  {{
                    [
                      '初次照面 · 雨夜投店',
                      '相依相熟 · 炉火与橘皮香',
                      '互诉衷肠 · 雪檐月夜',
                      '生死相托 · 深界归来',
                    ][i - 1]
                  }}
                </div>
              </div>
            </div>
            <p class="pm-dim" style="margin-top: 8px">
              继续推进剧情可解锁后续画卷; 已解锁的画卷将永久收录于章程末页, 可随时回望。
            </p>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn" @click="memoryOpen = false">合卷</button>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="bindOpen" class="pm-modal-mask" @click.self="bindOpen = false">
        <div class="pm-modal wide">
          <header class="pm-modal-head">
            <h3><PmIcon name="scroll" :size="16" /> 绑定世界书条目 · {{ selected?.name }}</h3>
            <button class="pm-link" @click="bindOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <div class="worldbook-bind-toolbar">
              <input v-model="bindSearch" class="pm-input" placeholder="搜索世界书、条目名、关键词或正文" />
              <button class="pm-btn sm" :disabled="worldbookLoading" @click="refreshWorldbookEntries">
                <PmIcon name="check" :size="12" /> 刷新
              </button>
            </div>
            <div v-if="worldbookError" class="worldbook-error">{{ worldbookError }}</div>
            <div v-if="worldbookLoading" class="pm-empty mini">正在读取当前启用世界书...</div>
            <div v-else-if="searchableWorldbookEntries.length === 0" class="pm-empty mini">没有可绑定的条目。</div>
            <div v-else class="worldbook-search-results">
              <article v-for="item in searchableWorldbookEntries" :key="`${item.worldbookName}-${item.uid}`" class="worldbook-search-item">
                <header>
                  <strong>{{ getWorldbookEntryName(item.entry) || `uid ${item.uid}` }}</strong>
                  <span class="pm-tag dim">{{ item.worldbookName }}</span>
                  <span class="pm-tag" :class="item.entry.enabled ? 'good' : 'warn'">{{ item.entry.enabled ? '启用' : '停用' }}</span>
                </header>
                <div class="worldbook-meta">{{ item.worldbookSources.join('、') }} · uid {{ item.uid }}</div>
                <div class="worldbook-meta">关键词：{{ entryKeysText(item.entry) }}</div>
                <p>{{ entrySummary(item.entry) }}</p>
                <footer>
                  <button class="pm-btn sm" @click="bindWorldbookEntry(item)">
                    <PmIcon name="plus" :size="12" /> 绑定到 {{ selected?.name }}
                  </button>
                </footer>
              </article>
            </div>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="bindOpen = false">关闭</button>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="editOpen" class="pm-modal-mask" @click.self="editOpen = false">
        <div class="pm-modal worldbook-editor-modal">
          <header class="pm-modal-head">
            <h3><PmIcon name="scroll" :size="16" /> 编辑世界书条目</h3>
            <button class="pm-link" @click="editOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body worldbook-editor">
            <div class="worldbook-meta">世界书：{{ editingWorldbookName }} · uid {{ editingEntry?.uid }}</div>
            <div v-if="worldbookError" class="worldbook-error">{{ worldbookError }}</div>
            <label class="pm-field">
              <span>条目名</span>
              <input v-model="editingName" class="pm-input" />
            </label>
            <label class="toggle-row compact">
              <span><strong>启用条目</strong><small>关闭后该世界书条目不会触发。</small></span>
              <button class="toggle-switch" :class="{ on: editingEnabled }" type="button" @click="editingEnabled = !editingEnabled">
                <i></i>
                {{ editingEnabled ? '启用' : '停用' }}
              </button>
            </label>
            <div class="worldbook-editor-grid">
              <label class="pm-field">
                <span>概率</span>
                <input v-model.number="editingProbability" class="pm-input" type="number" min="0" max="100" />
              </label>
              <label class="pm-field">
                <span>插入位置</span>
                <input v-model="editingPositionType" class="pm-input" placeholder="before_author_note / at_depth..." />
              </label>
              <label class="pm-field">
                <span>深度</span>
                <input v-model.number="editingDepth" class="pm-input" type="number" />
              </label>
              <label class="pm-field">
                <span>顺序</span>
                <input v-model.number="editingOrder" class="pm-input" type="number" />
              </label>
            </div>
            <label class="pm-field">
              <span>关键词，每行一个</span>
              <textarea v-model="editingKeys" class="pm-textarea compact"></textarea>
            </label>
            <label class="pm-field">
              <span>正文内容</span>
              <textarea v-model="editingContent" class="pm-textarea worldbook-content"></textarea>
            </label>
            <details class="raw-json-editor">
              <summary>原始 JSON 高级编辑</summary>
              <textarea v-model="editingJson" class="pm-textarea json-edit"></textarea>
              <p class="pm-dim">保存时会以 JSON 为底稿，并用上方常用字段覆盖同名字段。</p>
            </details>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="editOpen = false">取消</button>
            <button class="pm-btn" @click="saveEditingWorldbook">
              <PmIcon name="check" :size="12" /> 保存到世界书
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="createOpen" class="pm-modal-mask" @click.self="createOpen = false">
        <div class="pm-modal">
          <header class="pm-modal-head">
            <h3><PmIcon name="plus" :size="16" /> 新建世界书条目 · {{ selected?.name }}</h3>
            <button class="pm-link" @click="createOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body worldbook-editor">
            <div v-if="worldbookError" class="worldbook-error">{{ worldbookError }}</div>
            <label class="pm-field">
              <span>目标世界书</span>
              <select v-model="createWorldbookName" class="pm-input">
                <option v-for="book in activeWorldbooks" :key="book.name" :value="book.name">
                  {{ book.name }} · {{ book.sources.join('、') }}
                </option>
              </select>
            </label>
            <label class="pm-field">
              <span>条目名</span>
              <input v-model="createEntryName" class="pm-input" />
            </label>
            <label class="pm-field">
              <span>正文内容</span>
              <textarea v-model="createEntryContent" class="pm-textarea worldbook-content"></textarea>
            </label>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="createOpen = false">取消</button>
            <button class="pm-btn" :disabled="!createWorldbookName" @click="createWorldbookEntryForSelected">
              <PmIcon name="check" :size="12" /> 创建并绑定
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.char-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr);
  gap: 14px;
  align-items: start;
}

.char-list {
  display: grid;
  gap: 10px;
}
.char-card {
  position: relative;
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(110, 80, 34, 0.34);
  background: linear-gradient(180deg, rgba(255, 248, 226, 0.72), rgba(220, 196, 145, 0.42));
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.5);
  transition: 0.2s ease;
  cursor: pointer;
}
.char-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 26px -14px rgba(50, 30, 10, 0.45);
}
.char-card.selected {
  outline: 1.5px solid var(--pm-gold-dim);
  outline-offset: 2px;
  box-shadow:
    inset 0 1px 0 rgba(255, 245, 215, 0.6),
    0 12px 26px -14px rgba(50, 30, 10, 0.5);
}

.char-head {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 10px;
  align-items: center;
}
.portrait {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.4);
  color: var(--pm-parch-bright);
  display: grid;
  place-items: center;
  box-shadow:
    inset 0 1px 0 rgba(255, 245, 215, 0.4),
    0 6px 14px -8px rgba(0, 0, 0, 0.5);
}
.char-meta h3 {
  margin: 0;
  font-family: var(--pm-font-display);
  font-size: calc(17px * var(--pm-text-scale));
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--pm-ink);
}
.char-role {
  font-size: calc(12px * var(--pm-text-scale));
  color: var(--pm-ink-dim);
  margin-top: 2px;
}
.char-loc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: calc(11.5px * var(--pm-text-scale));
  color: var(--pm-ink-fade);
}

.bars {
  display: grid;
  gap: 5px;
  padding: 8px 0;
  border-block: 1px dashed rgba(110, 80, 34, 0.22);
}
.bar-line {
  display: grid;
  grid-template-columns: 42px minmax(110px, 1fr) 92px;
  align-items: center;
  gap: 8px;
  font-size: calc(11.5px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
}
.bar-label {
  font-family: var(--pm-font-display);
  letter-spacing: 0.08em;
  color: var(--pm-ink-dim);
  font-size: calc(10px * var(--pm-text-scale));
}
.state-capsules {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-left: 48px;
}
.state-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid rgba(110, 80, 34, 0.38);
  border-radius: 4px;
  background: rgba(255, 248, 226, 0.58);
  color: var(--pm-ink-soft);
  font-size: calc(11px * var(--pm-text-scale));
}
.state-chip b {
  font-family: var(--pm-font-display);
  font-size: calc(10px * var(--pm-text-scale));
  color: var(--pm-ink-dim);
  letter-spacing: 0.08em;
}
.state-chip.bladder {
  border-color: rgba(88, 113, 122, 0.45);
  background: rgba(218, 235, 232, 0.48);
}
.char-notes {
  display: grid;
  gap: 5px;
  color: var(--pm-ink-soft);
}
.char-notes p {
  font-size: calc(11.5px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
  line-height: 1.6;
  margin: 0;
}
.char-notes b {
  display: inline-block;
  min-width: 70px;
  margin-right: 6px;
  color: var(--pm-ink-dim);
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
}
.char-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 2px;
}
.char-acts .pm-btn.danger {
  border-color: rgba(133, 56, 42, 0.45);
  color: #6d2f24;
  background: rgba(132, 51, 34, 0.08);
}
.char-acts .pm-btn.danger:hover:not(:disabled) {
  border-color: rgba(160, 60, 42, 0.68);
  background: rgba(132, 51, 34, 0.15);
}

/* 侧栏 */
.char-side {
  display: grid;
  gap: 10px;
  position: sticky;
  top: 12px;
}
.side-card h3 {
  margin: 0 0 8px;
  font-family: var(--pm-font-display);
  letter-spacing: 0.1em;
  font-size: calc(14px * var(--pm-text-scale));
  color: var(--pm-ink);
}
.stage-h {
  margin-bottom: 8px;
  font-family: var(--pm-font-display);
  letter-spacing: 0.06em;
  color: var(--pm-ink-soft);
}
.selected-fields {
  display: grid;
  gap: 5px;
  margin-bottom: 10px;
  padding: 8px 0;
  border-block: 1px dashed rgba(110, 80, 34, 0.24);
  color: var(--pm-ink-soft);
  font-size: calc(11.5px * var(--pm-text-scale));
}
.selected-fields span {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 7px;
}
.selected-fields b {
  color: var(--pm-ink-dim);
  font-family: var(--pm-font-display);
}
.stage-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: calc(11.5px * var(--pm-text-scale));
}
.stage-list li {
  display: grid;
  grid-template-columns: 50px 1fr;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.32);
  border: 1px solid rgba(110, 80, 34, 0.16);
  color: var(--pm-ink-soft);
}
.stage-list li.done {
  background: rgba(216, 230, 200, 0.55);
  color: var(--pm-ink);
}
.stage-list li.cur {
  background: linear-gradient(180deg, #f3da90, #c9a04a);
  color: var(--pm-ink);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.6);
}
.stage-idx {
  font-family: var(--pm-font-num);
  letter-spacing: 0.04em;
}

.here-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 4px;
}
.here-list li {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: 6px;
  font-size: calc(12px * var(--pm-text-scale));
  padding: 4px 6px;
  border-radius: 6px;
}
.here-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}
.here-name {
  color: var(--pm-ink);
}
.here-loc {
  font-size: calc(10.5px * var(--pm-text-scale));
}

.cg-grid-side {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.cg-rating-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin: 8px 0 10px;
}
.cg-rating-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  border-radius: 6px;
  border: 1px solid rgba(110, 80, 34, 0.42);
  background: rgba(255, 245, 215, 0.42);
  color: var(--pm-ink-dim);
  font-weight: 700;
  cursor: pointer;
}
.cg-rating-tabs button.active {
  color: var(--pm-ink);
  border-color: rgba(170, 121, 37, 0.7);
  background: linear-gradient(180deg, rgba(249, 221, 143, 0.95), rgba(153, 103, 36, 0.68));
  box-shadow: 0 8px 18px -14px rgba(54, 31, 10, 0.7);
}
.cg-rating-tabs span {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(47, 30, 14, 0.18);
  font-size: calc(10px * var(--pm-text-scale));
}
.cg-slot {
  overflow: hidden;
  border: 1px solid rgba(110, 80, 34, 0.42);
  border-radius: 6px;
  background: rgba(255, 245, 215, 0.48);
}
.cg-slot.locked {
  opacity: 0.68;
}
.cg-thumb {
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, rgba(43, 29, 16, 0.78), rgba(97, 70, 35, 0.7));
  color: var(--pm-parch-soft);
}
.cg-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cg-placeholder {
  display: grid;
  place-items: center;
  gap: 5px;
  font-size: calc(11px * var(--pm-text-scale));
  color: rgba(243, 220, 162, 0.78);
}
.cg-info {
  display: grid;
  gap: 2px;
  padding: 6px 7px;
}
.cg-info strong {
  color: var(--pm-ink);
  font-size: calc(12px * var(--pm-text-scale));
}
.cg-info span {
  color: var(--pm-ink-dim);
  font-size: calc(10.5px * var(--pm-text-scale));
  line-height: 1.45;
}

.gift-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.gift-card {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(255, 245, 215, 0.8), rgba(212, 186, 136, 0.55));
  border: 1px solid rgba(110, 80, 34, 0.45);
  cursor: pointer;
  transition: 0.16s ease;
  text-align: left;
}
.gift-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 22px -12px rgba(50, 30, 10, 0.45);
}
.gift-tag {
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-gold-dim);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.gift-name {
  font-weight: 700;
  font-size: calc(14px * var(--pm-text-scale));
  color: var(--pm-ink);
}
.gift-cost {
  color: var(--pm-ink-soft);
  font-size: calc(13px * var(--pm-text-scale));
}
.gift-tip {
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-ink-dim);
}

.behavior-card,
.worldbook-card {
  display: grid;
  gap: 8px;
}
.behavior-card p {
  margin: 0;
}
.behavior-group-list {
  display: grid;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
  padding-right: 4px;
}
.behavior-group {
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(110, 80, 34, 0.34);
  border-radius: 6px;
  background: rgba(255, 248, 226, 0.42);
}
.behavior-group header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.behavior-group strong {
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(13px * var(--pm-text-scale));
}
.behavior-item {
  display: grid;
  gap: 5px;
  padding: 7px;
  border-radius: 5px;
  background: rgba(255, 245, 215, 0.58);
  border: 1px dashed rgba(110, 80, 34, 0.24);
}
.behavior-item p {
  color: var(--pm-ink-soft);
  font-size: calc(11.5px * var(--pm-text-scale));
  line-height: 1.6;
}
.behavior-item small {
  color: var(--pm-ink-dim);
  font-size: calc(10.5px * var(--pm-text-scale));
  line-height: 1.5;
}
.behavior-item footer,
.behavior-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.behavior-form {
  display: grid;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px dashed rgba(110, 80, 34, 0.28);
}
.worldbook-actions,
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
.bound-worldbook-list,
.worldbook-search-results {
  display: grid;
  gap: 8px;
}
.worldbook-search-results {
  max-height: min(58vh, 620px);
  overflow: auto;
  padding-right: 4px;
}
.bound-worldbook-item,
.worldbook-search-item {
  display: grid;
  gap: 6px;
  padding: 9px;
  border: 1px solid rgba(110, 80, 34, 0.38);
  border-radius: 6px;
  background: rgba(255, 248, 226, 0.5);
}
.bound-worldbook-item header,
.worldbook-search-item header {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.bound-worldbook-item strong,
.worldbook-search-item strong {
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(13px * var(--pm-text-scale));
}
.bound-worldbook-item p,
.worldbook-search-item p {
  margin: 0;
  color: var(--pm-ink-soft);
  font-size: calc(11.5px * var(--pm-text-scale));
  line-height: 1.65;
}
.bound-worldbook-item footer,
.worldbook-search-item footer {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.worldbook-meta {
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.45;
}
.worldbook-editor-modal {
  width: min(980px, 100%);
}
.worldbook-editor {
  display: grid;
  gap: 10px;
}
.worldbook-editor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}
.pm-textarea.compact {
  min-height: 78px;
}
.worldbook-content {
  min-height: 210px;
  line-height: 1.7;
}
.raw-json-editor {
  border: 1px dashed rgba(110, 80, 34, 0.36);
  border-radius: 6px;
  padding: 8px;
  background: rgba(255, 248, 226, 0.36);
}
.raw-json-editor summary {
  cursor: pointer;
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
}
.json-edit {
  min-height: 260px;
  font-family: var(--pm-font-num), ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: calc(11px * var(--pm-text-scale));
}
.toggle-row.compact {
  padding: 7px 8px;
  border: 1px dashed rgba(110, 80, 34, 0.32);
  border-radius: 6px;
  background: rgba(255, 248, 226, 0.38);
}

.pm-modal.wide {
  width: min(820px, 100%);
}
.cg-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.cg-frame {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(110, 80, 34, 0.45);
  background: rgba(255, 245, 215, 0.55);
  transition: 0.2s ease;
}
.cg-frame.locked {
  filter: grayscale(0.7) brightness(0.85);
  opacity: 0.6;
}
.cg-inner {
  height: 110px;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 245, 215, 0.4), transparent 70%),
    linear-gradient(180deg, currentColor, #1f130a);
  position: relative;
  display: grid;
  place-items: center;
  color: var(--pm-parch-bright);
}
.cg-no {
  font-family: var(--pm-font-display);
  letter-spacing: 0.18em;
  font-size: calc(14px * var(--pm-text-scale));
  color: rgba(255, 245, 215, 0.85);
}
.cg-cap {
  padding: 6px 8px;
  font-size: calc(11.5px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
  border-top: 1px dashed rgba(110, 80, 34, 0.35);
}

@media (max-width: 1100px) {
  #page-characters {
    min-height: 0;
  }
  #page-characters > .pm-paper-body {
    max-height: calc(100vh - 235px);
    overflow: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .char-layout {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 0;
  }
  .char-list,
  .char-side {
    position: static;
    overflow: visible;
  }
}
</style>

