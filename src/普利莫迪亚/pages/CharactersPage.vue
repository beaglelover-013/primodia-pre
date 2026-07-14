<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatCopper, useGameStore, type Heroine, type InventoryItem, type TemporaryStateDisplay } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';
import {
  canCreateWorldbookEntry,
  createAndBindWorldbookEntry,
  getActiveWorldbookNames,
  getWorldbookEntryName,
  isWorldbookApiAvailable,
  loadActiveWorldbookEntries,
  loadWorldbookEntry,
  loadWorldbookEntryByName,
  saveWorldbookEntry,
  stringifyEntryJson,
  type EditableWorldbookEntry,
  type WorldbookEntrySearchItem,
} from '../services/worldbookService';
import {
  appendCapturedWardrobe,
  describeWardrobeEntry,
  ensureCharacterWardrobeEntries,
  generateWardrobeOutfit,
  loadCharacterWardrobeLibrary,
  saveVisibleWardrobeOutfit,
  wardrobeItemCount,
  wardrobeLibraryEntryName,
  wardrobeVisibleEntryName,
  type WardrobeLibrary,
} from '../services/wardrobeWorldbook';
import { isCharacterBehaviorEntryName } from '../services/characterBehaviorWorldbook';

const game = useGameStore();

const visibleHeroines = computed(() => game.heroines);

const selectedId = computed({
  get: () => game.selectedHeroineId ?? visibleHeroines.value[0]?.id ?? null,
  set: v => (game.selectedHeroineId = v),
});
const selected = computed(() => visibleHeroines.value.find(h => h.id === selectedId.value) ?? visibleHeroines.value[0] ?? null);
const selectedWorldbookBindings = computed(() => (selected.value ? (game.characterWorldbookBindings[selected.value.id] ?? []) : []));
const selectedBehaviorLibrary = computed(() => (selected.value ? game.characterBehaviorLibraries[selected.value.id] ?? null : null));
const selectedBehaviorBinding = computed(() =>
  selectedWorldbookBindings.value.find(binding => {
    const id = String(binding.id ?? '');
    const label = String(binding.label ?? '');
    return id.startsWith('character-behavior:') || isCharacterBehaviorEntryName(label) || label.includes('角色行为库');
  }),
);
const pendingCharacterDelete = ref<Heroine | null>(null);
const pendingBehaviorDelete = ref<{ id: string; behavior: string } | null>(null);
const selectedBehaviorId = ref('');
const cgRatingTab = ref<'sfw' | 'nsfw'>('sfw');
interface PresetCgSlot {
  title?: string;
  url: string;
  note?: string;
  unlocked?: boolean;
}
const PRESET_CHARACTER_CG: Record<string, Partial<Record<'sfw' | 'nsfw', PresetCgSlot[]>>> = {
  橘柒: {
    sfw: [
      {
        title: 'CG 1',
        url: 'https://files.catbox.moe/0ld4p2.png',
        unlocked: true,
        note: '固定开场立绘。',
      },
      {
        title: 'CG 2',
        url: 'https://files.catbox.moe/21zsbn.png',
        unlocked: true,
        note: '橘柒预设 CG。',
      },
    ],
  },
  绵暖: {
    sfw: [
      {
        title: 'CG 1',
        url: 'https://files.catbox.moe/j42erz.png',
        unlocked: true,
        note: '固定开场立绘。',
      },
    ],
  },
};
const cgPreview = ref<{ title: string; url: string; note?: string } | null>(null);
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
const selectedBehaviorItem = computed(() => {
  if (!selectedBehaviorId.value) return null;
  for (const group of selectedBehaviorGroups.value) {
    const item = group.items.find(behavior => behavior.id === selectedBehaviorId.value);
    if (item) return { ...item, groupRegion: group.region };
  }
  return null;
});
const selectedCgSlots = computed(() => {
  if (!selected.value) return [];
  const baseSlots = selected.value.cgSlots?.length
    ? selected.value.cgSlots
    : Array.from({ length: 6 }, (_, idx) => ({
        id: `${selected.value?.id}-cg-${idx + 1}`,
        title: `CG ${idx + 1}`,
        unlocked: idx === 0,
        rating: 'sfw' as const,
        note: '之后把图床链接填到角色数据的 url 字段。',
      }));
  const presetBook = PRESET_CHARACTER_CG[selected.value.name] ?? {};
  return baseSlots.map((slot, index) => {
    const rating = (slot.rating ?? 'sfw') as 'sfw' | 'nsfw';
    const preset = presetBook[rating]?.[index];
    return {
      ...slot,
      rating,
      title: preset?.title?.trim() || slot.title,
      url: preset?.url?.trim() || slot.url,
      unlocked: preset?.unlocked ?? slot.unlocked,
      note: preset?.note?.trim() || slot.note,
      slotIndex: index,
    };
  });
});
const visibleCgSlots = computed(() => selectedCgSlots.value.filter(item => (item.rating ?? 'sfw') === cgRatingTab.value));
const selectedCgCounts = computed(() => ({
  sfw: selectedCgSlots.value.filter(item => (item.rating ?? 'sfw') === 'sfw').length,
  nsfw: selectedCgSlots.value.filter(item => item.rating === 'nsfw').length,
}));

function temporaryStatesForHeroine(h: Heroine): TemporaryStateDisplay[] {
  return game.flattenTemporaryStates().filter(state => state.targetType === '人物' && state.targetName === h.name);
}

watch(selectedId, () => {
  cgRatingTab.value = 'sfw';
  selectedBehaviorId.value = '';
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

function openCgPreview(cg: { title: string; url?: string; note?: string; unlocked?: boolean }) {
  if (!cg.url || !cg.unlocked) return;
  cgPreview.value = { title: cg.title, url: cg.url, note: cg.note };
}

/* 互动 */
function startChat(h: Heroine) {
  game.appendDraft(`我去找${h.name}交谈，留意她此刻的表情、语气和身体状态。${aiStateLine(h)}`);
  game.pushLog('提示', `交谈 · ${h.name} 已加入行动框。`);
}
const giftOpen = ref(false);
const giftTarget = ref<Heroine | null>(null);
const giftInventoryItems = computed(() => game.inventory.filter(item => item.qty > 0));
function giftAffectionGain(item: InventoryItem) {
  const price = Math.max(0, Math.floor(Number(item.priceCopper) || 0));
  const qualityBonus = item.quality && ['经典搭配', '绝佳搭配', '奇迹'].includes(item.quality) ? 2 : 0;
  const categoryBonus = item.category === '成品' || item.category === '酒水' ? 1 : 0;
  return Math.max(1, Math.min(8, 2 + Math.floor(price / 800) + qualityBonus + categoryBonus));
}
function openGift(h: Heroine) {
  giftTarget.value = h;
  giftOpen.value = true;
}
async function sendGift(item: InventoryItem) {
  if (!giftTarget.value) return;
  const h = giftTarget.value;
  const inc = giftAffectionGain(item);
  await game.executePseudoZeroAction({
    type: 'CHARACTER_GIFT',
    heroineId: h.id,
    itemId: item.id,
    itemName: item.name,
    qty: 1,
    affectionGain: inc,
    stateLine: aiStateLine(h),
  }, {
    type: 'CHARACTER_GIFT',
    title: `赠礼 · ${h.name}`,
    aiHint: `请承接当前位置和${h.name}当前状态，叙述玩家从库房取出「${item.name}」送给她时的反应。库房扣除以前端结算为准；若礼物自然影响羁绊或状态，请通过 MVU/变量体现。`,
    logText: `CHARACTER_GIFT · ${h.name} · ${item.name}`,
    autoSend: true,
  });
  giftOpen.value = false;
}

async function deleteCharacter(h: Heroine) {
  pendingCharacterDelete.value = h;
}

async function confirmDeleteCharacter() {
  const target = pendingCharacterDelete.value;
  if (!target) return;
  pendingCharacterDelete.value = null;
  await game.deleteHeroine(target.id);
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
const wardrobeWorldbookName = ref('');
const wardrobeCaptureText = ref('');
const wardrobeLoading = ref(false);
const wardrobeError = ref('');
const wardrobeNotice = ref('');
const wardrobeLibrary = ref<WardrobeLibrary>({});
const wardrobeLibraryEntryLabel = ref('尚未读取');
const wardrobeVisibleEntryLabel = ref('尚未读取');
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
const wardrobeCategoryStats = computed(() =>
  Object.entries(wardrobeLibrary.value)
    .map(([category, items]) => ({ category, count: items.length }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'zh-Hans-CN')),
);
const wardrobeTotalCount = computed(() => wardrobeItemCount(wardrobeLibrary.value));

function bindingCacheKey(worldbookName: string, uid: number) {
  return `${worldbookName}::${uid}`;
}

function defaultWardrobeWorldbookName() {
  return wardrobeWorldbookName.value || activeWorldbooks.value[0]?.name || '';
}

function ensureWardrobeWorldbookName() {
  if (!wardrobeWorldbookName.value) wardrobeWorldbookName.value = defaultWardrobeWorldbookName();
  return wardrobeWorldbookName.value;
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
    wardrobeWorldbookName.value = defaultWardrobeWorldbookName();
    wardrobeCaptureText.value = '';
    wardrobeError.value = '';
    wardrobeNotice.value = '';
    wardrobeLibrary.value = {};
    wardrobeLibraryEntryLabel.value = '尚未读取';
    wardrobeVisibleEntryLabel.value = '尚未读取';
    if (!game.characterBehaviorLibraries[heroineId]) void game.loadCharacterBehaviorLibraryForHeroine(heroineId);
  },
  { immediate: true },
);

watch(
  () => activeWorldbooks.value.map(book => book.name).join('|'),
  () => {
    if (!wardrobeWorldbookName.value) wardrobeWorldbookName.value = activeWorldbooks.value[0]?.name ?? '';
  },
  { immediate: true },
);

async function refreshBehaviorLibrary() {
  if (!selected.value) return;
  await game.loadCharacterBehaviorLibraryForHeroine(selected.value.id);
  await refreshBoundWorldbookEntries();
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
  await refreshBoundWorldbookEntries();
}

async function createWardrobeForSelected() {
  if (!selected.value) return;
  const worldbookName = ensureWardrobeWorldbookName();
  if (!worldbookName) {
    wardrobeError.value = '请先选择目标世界书。';
    return;
  }
  wardrobeLoading.value = true;
  wardrobeError.value = '';
  wardrobeNotice.value = '';
  try {
    const result = await ensureCharacterWardrobeEntries(worldbookName, selected.value.name);
    await game.bindCharacterWorldbookEntry(selected.value.id, {
      worldbookName,
      uid: result.libraryEntry.uid,
      label: wardrobeLibraryEntryName(selected.value.name),
    });
    await game.bindCharacterWorldbookEntry(selected.value.id, {
      worldbookName,
      uid: result.visibleEntry.uid,
      label: wardrobeVisibleEntryName(selected.value.name),
    });
    wardrobeLibraryEntryLabel.value = describeWardrobeEntry(result.libraryEntry);
    wardrobeVisibleEntryLabel.value = describeWardrobeEntry(result.visibleEntry);
    wardrobeLibrary.value = {};
    wardrobeNotice.value = `已创建/绑定 ${selected.value.name} 的衣柜库和今日穿搭条目。`;
    await refreshWorldbookEntries();
  } catch (error) {
    wardrobeError.value = error instanceof Error ? error.message : '创建衣柜条目失败。';
  } finally {
    wardrobeLoading.value = false;
  }
}

async function refreshWardrobeForSelected() {
  if (!selected.value) return;
  const worldbookName = ensureWardrobeWorldbookName();
  if (!worldbookName) {
    wardrobeError.value = '请先选择目标世界书。';
    return;
  }
  wardrobeLoading.value = true;
  wardrobeError.value = '';
  wardrobeNotice.value = '';
  try {
    const loaded = await loadCharacterWardrobeLibrary(worldbookName, selected.value.name);
    wardrobeLibrary.value = loaded.library;
    wardrobeLibraryEntryLabel.value = describeWardrobeEntry(loaded.entry);
    const visible = await loadWorldbookEntryByName(worldbookName, wardrobeVisibleEntryName(selected.value.name));
    wardrobeVisibleEntryLabel.value = visible ? describeWardrobeEntry(visible) : wardrobeVisibleEntryName(selected.value.name);
    wardrobeNotice.value = `已读取衣柜库：${wardrobeTotalCount.value} 件。`;
  } catch (error) {
    wardrobeError.value = error instanceof Error ? error.message : '读取衣柜失败。';
  } finally {
    wardrobeLoading.value = false;
  }
}

async function captureWardrobeForSelected() {
  if (!selected.value || !wardrobeCaptureText.value.trim()) return;
  const worldbookName = ensureWardrobeWorldbookName();
  if (!worldbookName) {
    wardrobeError.value = '请先选择目标世界书。';
    return;
  }
  wardrobeLoading.value = true;
  wardrobeError.value = '';
  wardrobeNotice.value = '';
  try {
    const result = await appendCapturedWardrobe(worldbookName, selected.value.name, wardrobeCaptureText.value);
    wardrobeLibrary.value = result.library;
    wardrobeLibraryEntryLabel.value = describeWardrobeEntry(result.entry);
    wardrobeNotice.value = `捕捉到 ${result.capturedCount} 件，新增 ${result.addedCount} 件到衣柜库。`;
    wardrobeCaptureText.value = '';
    await refreshWorldbookEntries();
  } catch (error) {
    wardrobeError.value = error instanceof Error ? error.message : '捕捉衣服失败。';
  } finally {
    wardrobeLoading.value = false;
  }
}

async function generateTodayWardrobeForSelected(reroll = false) {
  if (!selected.value) return;
  const worldbookName = ensureWardrobeWorldbookName();
  if (!worldbookName) {
    wardrobeError.value = '请先选择目标世界书。';
    return;
  }
  wardrobeLoading.value = true;
  wardrobeError.value = '';
  wardrobeNotice.value = '';
  try {
    const loaded = await loadCharacterWardrobeLibrary(worldbookName, selected.value.name);
    wardrobeLibrary.value = loaded.library;
    if (wardrobeItemCount(loaded.library) === 0) throw new Error('衣柜库为空，请先捕捉或添加衣服。');
    const outfit = generateWardrobeOutfit({
      characterName: selected.value.name,
      library: loaded.library,
      dateLabel: game.dateText,
      daySerial: game.currentCalendarDay(),
      weatherText: game.calendar.weather,
      rerollSalt: reroll ? String(Date.now()) : '',
    });
    const entry = await saveVisibleWardrobeOutfit(worldbookName, selected.value.name, outfit);
    wardrobeVisibleEntryLabel.value = describeWardrobeEntry(entry);
    await game.setFrontendMvuValue(`人物羁绊.${selected.value.name}.一句话穿着`, outfit.summary);
    wardrobeNotice.value = `${reroll ? '已重抽' : '已生成'}今日穿搭：${outfit.summary}`;
    await refreshWorldbookEntries();
  } catch (error) {
    wardrobeError.value = error instanceof Error ? error.message : '生成今日穿搭失败。';
  } finally {
    wardrobeLoading.value = false;
  }
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
  await refreshBoundWorldbookEntries();
}

async function deleteBehaviorLibraryItem(item: { id: string; behavior: string }) {
  if (!selected.value) return;
  pendingBehaviorDelete.value = item;
}

async function confirmDeleteBehaviorLibraryItem() {
  if (!selected.value || !pendingBehaviorDelete.value) return;
  const target = pendingBehaviorDelete.value;
  pendingBehaviorDelete.value = null;
  await game.deleteCharacterBehavior(selected.value.id, target.id);
  await refreshBoundWorldbookEntries();
}

function closeDeleteConfirm() {
  pendingCharacterDelete.value = null;
  pendingBehaviorDelete.value = null;
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
            <p>
              <b>个人资金</b>{{ formatCopper(h.personalFundsCopper ?? 0) }} ·
              {{ h.income?.职业 || h.title }}{{ h.income?.日收入折合铜币 ? ` · 日入${formatCopper(h.income.日收入折合铜币)}` : '' }}
            </p>
            <p><b>一句话穿着</b>{{ h.outfit || '衣着暂未记录。' }}</p>
            <p><b>备注</b>{{ h.bio || '暂无备注。' }}</p>
          </div>

          <div v-if="temporaryStatesForHeroine(h).length" class="char-temp-states">
            <span
              v-for="state in temporaryStatesForHeroine(h)"
              :key="`${h.id}-${state.名称}-${state.描述}`"
              class="pm-tag gold"
              :title="state.描述"
            >
              {{ state.名称 }} · {{ state.剩余回合 }}回合
            </span>
          </div>

          <footer class="char-acts">
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
              <span><b>个人资金</b>{{ formatCopper(selected.personalFundsCopper ?? 0) }}</span>
              <span><b>收入</b>{{ selected.income?.职业 || selected.title }}{{ selected.income?.日收入折合铜币 ? ` · 日入${formatCopper(selected.income.日收入折合铜币)}` : '' }}</span>
              <span><b>好感</b>{{ selected.affection }}/{{ selected.affectionMax }}</span>
              <span><b>心情</b>{{ selected.mood }}</span>
              <span><b>所在位置</b>{{ selected.located }}</span>
              <span><b>一句话穿着</b>{{ selected.outfit || '衣着暂未记录。' }}</span>
            </div>
            <div v-if="temporaryStatesForHeroine(selected).length" class="selected-temp-states">
              <span
                v-for="state in temporaryStatesForHeroine(selected)"
                :key="`${selected.id}-${state.名称}-${state.描述}`"
                class="pm-tag gold"
                :title="state.描述"
              >
                {{ state.名称 }} · {{ state.剩余回合 }}回合
              </span>
            </div>
            <div class="pm-line"></div>
          </template>
          <div v-else class="pm-empty">点击左侧卡片选择一位角色, 查看专属阶段图谱。</div>
        </div>

        <div class="side-card pm-card behavior-card">
          <h3>角色行为库 · {{ selected?.name ?? '未选择' }}</h3>
          <template v-if="selected">
            <p class="pm-dim">
              这里记录这个角色逐渐学会的习惯、职责和长期互动倾向。条目默认写入专属世界书，但不会直接启用进提示词。
            </p>
            <div class="worldbook-meta">
              个人行为库：
              <span class="pm-tag" :class="selectedBehaviorBinding ? 'good' : 'warn'">
                {{ selectedBehaviorBinding ? '已绑定' : '未绑定' }}
              </span>
              <span v-if="selectedBehaviorBinding">
                {{ selectedBehaviorBinding.worldbookName }} · uid {{ selectedBehaviorBinding.uid }}
              </span>
            </div>
            <div class="card-actions behavior-actions">
              <button class="pm-btn sm ghost" @click="refreshBehaviorLibrary">
                <PmIcon name="check" :size="12" /> 重新读取
              </button>
            </div>
            <div v-if="selectedBehaviorGroups.length === 0" class="pm-empty mini">
              暂无行为记忆。AI 学到稳定习惯后会自动写入，也可以在下面手动添加。
            </div>
            <div v-else class="behavior-group-list compact">
              <section v-for="group in selectedBehaviorGroups" :key="group.region" class="behavior-group">
                <header>
                  <strong>{{ group.region }}</strong>
                  <span class="pm-tag dim">{{ group.items.length }} 条</span>
                </header>
                <div class="behavior-chip-grid">
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    class="behavior-chip"
                    :class="{ active: selectedBehaviorId === item.id }"
                    type="button"
                    @click="selectedBehaviorId = selectedBehaviorId === item.id ? '' : item.id"
                  >
                    {{ item.behavior }}
                  </button>
                </div>
              </section>
              <article v-if="selectedBehaviorItem" class="behavior-detail">
                <header>
                  <span>{{ selectedBehaviorItem.groupRegion }}</span>
                  <button class="behavior-detail-close" type="button" @click="selectedBehaviorId = ''">×</button>
                </header>
                <p>{{ selectedBehaviorItem.behavior }}</p>
                <small v-if="selectedBehaviorItem.protagonistFeel">主角可感受到：{{ selectedBehaviorItem.protagonistFeel }}</small>
                <footer>
                  <button class="pm-btn sm ghost" @click="editBehaviorLibraryItem(selectedBehaviorItem)">
                    <PmIcon name="scroll" :size="12" /> 编辑
                  </button>
                  <button class="pm-btn sm danger" @click="deleteBehaviorLibraryItem(selectedBehaviorItem)">
                    <PmIcon name="x" :size="12" /> 删除
                  </button>
                </footer>
              </article>
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

        <div class="side-card pm-card wardrobe-card">
          <h3>衣柜 · {{ selected?.name ?? '未选择' }}</h3>
          <template v-if="selected">
            <p class="pm-dim">
              前端维护完整衣柜库；AI 只读取「{{ selected.name }}_衣柜」里的今日一套穿搭。
            </p>
            <div v-if="wardrobeError" class="worldbook-error">{{ wardrobeError }}</div>
            <p v-if="wardrobeNotice" class="edit-notice">{{ wardrobeNotice }}</p>
            <label class="pm-field">
              <span>目标世界书</span>
              <select v-model="wardrobeWorldbookName" class="pm-input" :disabled="wardrobeLoading">
                <option v-for="book in activeWorldbooks" :key="book.name" :value="book.name">
                  {{ book.name }} · {{ book.sources.join('、') }}
                </option>
              </select>
            </label>
            <div class="wardrobe-entry-status">
              <span><b>衣柜库</b>{{ wardrobeLibraryEntryLabel }}</span>
              <span><b>今日穿搭</b>{{ wardrobeVisibleEntryLabel }}</span>
            </div>
            <div class="card-actions wardrobe-actions">
              <button class="pm-btn sm" :disabled="wardrobeLoading || !worldbookApiReady || !wardrobeWorldbookName" @click="createWardrobeForSelected">
                <PmIcon name="plus" :size="12" /> 创建/绑定
              </button>
              <button class="pm-btn sm ghost" :disabled="wardrobeLoading || !worldbookApiReady || !wardrobeWorldbookName" @click="refreshWardrobeForSelected">
                <PmIcon name="check" :size="12" /> 读取衣柜
              </button>
            </div>
            <div class="wardrobe-stats">
              <span class="pm-tag gold">共 {{ wardrobeTotalCount }} 件</span>
              <span v-for="item in wardrobeCategoryStats" :key="item.category" class="pm-tag dim">
                {{ item.category }} {{ item.count }}
              </span>
            </div>
            <textarea
              v-model="wardrobeCaptureText"
              class="pm-textarea wardrobe-capture"
              placeholder="粘贴同类型衣柜格式，例如 <WORLD_main_characters_橘柒_衣柜> ... </WORLD_main_characters_橘柒_衣柜>"
            ></textarea>
            <div class="card-actions wardrobe-actions">
              <button class="pm-btn sm" :disabled="wardrobeLoading || !wardrobeCaptureText.trim()" @click="captureWardrobeForSelected">
                <PmIcon name="plus" :size="12" /> 捕捉衣服
              </button>
              <button class="pm-btn sm dark" :disabled="wardrobeLoading || wardrobeTotalCount === 0" @click="generateTodayWardrobeForSelected(false)">
                <PmIcon name="check" :size="12" /> 生成今日穿搭
              </button>
              <button class="pm-btn sm ghost" :disabled="wardrobeLoading || wardrobeTotalCount === 0" @click="generateTodayWardrobeForSelected(true)">
                <PmIcon name="refresh" :size="12" /> 重抽
              </button>
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
            <article v-for="cg in visibleCgSlots" :key="cg.id" class="cg-slot" :class="{ locked: !cg.unlocked, clickable: cg.url && cg.unlocked }">
              <button class="cg-thumb" type="button" :disabled="!cg.url || !cg.unlocked" @click="openCgPreview(cg)">
                <img v-if="cg.url" :src="cg.url" :alt="cg.title" />
                <div v-else class="cg-placeholder">
                  <PmIcon name="flourish" :size="18" />
                  <span>{{ cg.unlocked ? '待填链接' : '未解锁' }}</span>
                </div>
              </button>
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

    <Teleport to="body">
      <div v-if="cgPreview" class="cg-preview-mask" @click.self="cgPreview = null">
        <figure class="cg-preview-panel">
          <button class="pm-link cg-preview-close" type="button" @click="cgPreview = null">
            <PmIcon name="x" :size="18" />
          </button>
          <img :src="cgPreview.url" :alt="cgPreview.title" />
          <figcaption>
            <strong>{{ cgPreview.title }}</strong>
            <span v-if="cgPreview.note">{{ cgPreview.note }}</span>
          </figcaption>
        </figure>
      </div>
    </Teleport>

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
            <div v-if="giftInventoryItems.length" class="gift-grid">
              <button v-for="item in giftInventoryItems" :key="item.id" class="gift-card" @click="sendGift(item)">
                <span class="gift-tag">{{ item.category }}</span>
                <span class="gift-name">{{ item.name }}</span>
                <span class="gift-cost pm-num">库存 ×{{ item.qty }}</span>
                <span class="gift-tip">
                  {{ item.quality ? `${item.quality} · ` : '' }}羁绊 +{{ giftAffectionGain(item) }}
                </span>
              </button>
            </div>
            <div v-else class="pm-empty mini">库房里暂时没有可赠送的物品。</div>
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

    <Teleport to="body">
      <div v-if="pendingCharacterDelete || pendingBehaviorDelete" class="pm-modal-mask" @click.self="closeDeleteConfirm">
        <div class="pm-modal delete-confirm-modal">
          <header class="pm-modal-head">
            <h3><PmIcon name="x" :size="16" /> 确认删除</h3>
            <button class="pm-link" @click="closeDeleteConfirm"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <template v-if="pendingCharacterDelete">
              <p>删除配角「{{ pendingCharacterDelete.name }}」吗？</p>
              <p class="pm-dim">
                这会从当前变量和人物羁绊列表里移除，并同步清理她的世界书绑定和行为库缓存。
              </p>
            </template>
            <template v-else-if="pendingBehaviorDelete">
              <p>删除这条行为记忆吗？</p>
              <p class="pm-dim">{{ pendingBehaviorDelete.behavior }}</p>
            </template>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="closeDeleteConfirm">取消</button>
            <button
              class="pm-btn danger"
              @click="pendingCharacterDelete ? confirmDeleteCharacter() : confirmDeleteBehaviorLibraryItem()"
            >
              删除
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
.char-temp-states {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
.selected-temp-states {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: -3px 0 10px;
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
  width: 100%;
  border: 0;
  padding: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, rgba(43, 29, 16, 0.78), rgba(97, 70, 35, 0.7));
  color: var(--pm-parch-soft);
  cursor: default;
}
.cg-slot.clickable .cg-thumb {
  cursor: zoom-in;
}
.cg-slot.clickable .cg-thumb:hover img {
  transform: scale(1.035);
  filter: saturate(1.06) brightness(1.05);
}
.cg-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.18s ease, filter 0.18s ease;
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

.cg-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(20, 12, 7, 0.72);
  backdrop-filter: blur(5px);
}
.cg-preview-panel {
  position: relative;
  width: min(86vw, 920px);
  max-height: 88vh;
  margin: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid rgba(228, 183, 82, 0.55);
  border-radius: 8px;
  background: rgba(36, 24, 14, 0.96);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.46);
}
.cg-preview-panel img {
  width: 100%;
  max-height: calc(88vh - 72px);
  object-fit: contain;
  background: rgba(12, 8, 5, 0.72);
}
.cg-preview-panel figcaption {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  color: var(--pm-parch);
  background: linear-gradient(180deg, rgba(54, 34, 17, 0.92), rgba(33, 22, 13, 0.96));
}
.cg-preview-panel figcaption span {
  color: rgba(245, 222, 172, 0.72);
  font-size: calc(12px * var(--pm-text-scale));
}
.cg-preview-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: rgba(23, 14, 8, 0.72);
  color: var(--pm-parch);
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
.worldbook-card,
.wardrobe-card {
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
.behavior-group-list.compact {
  gap: 7px;
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
.behavior-chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.behavior-chip {
  max-width: 100%;
  border: 1px solid rgba(112, 81, 30, 0.34);
  border-radius: 999px;
  padding: 5px 10px;
  background: linear-gradient(180deg, rgba(255, 250, 222, 0.9), rgba(221, 195, 121, 0.52));
  color: var(--pm-ink-soft);
  font: inherit;
  font-size: calc(11.5px * var(--pm-text-scale));
  line-height: 1.35;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.44);
}
.behavior-chip:hover,
.behavior-chip.active {
  border-color: rgba(112, 81, 30, 0.68);
  background: linear-gradient(180deg, rgba(245, 217, 135, 0.95), rgba(151, 106, 42, 0.84));
  color: #2c1c08;
}
.behavior-detail {
  display: grid;
  gap: 6px;
  position: sticky;
  bottom: 0;
  padding: 8px;
  border: 1px solid rgba(110, 80, 34, 0.4);
  border-radius: 7px;
  background: rgba(255, 248, 226, 0.96);
  box-shadow: 0 -8px 18px rgba(60, 38, 12, 0.08);
}
.behavior-detail header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
}
.behavior-detail p {
  color: var(--pm-ink-soft);
  font-size: calc(12px * var(--pm-text-scale));
  line-height: 1.65;
}
.behavior-detail small {
  color: var(--pm-ink-dim);
  font-size: calc(10.5px * var(--pm-text-scale));
  line-height: 1.5;
}
.behavior-detail footer {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.behavior-detail-close {
  width: 24px;
  height: 24px;
  border: 1px solid rgba(110, 80, 34, 0.32);
  border-radius: 999px;
  background: rgba(255, 248, 226, 0.72);
  color: var(--pm-ink-soft);
  cursor: pointer;
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
.wardrobe-actions,
.worldbook-bind-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.wardrobe-entry-status {
  display: grid;
  gap: 4px;
  padding: 7px 8px;
  border: 1px dashed rgba(110, 80, 34, 0.3);
  border-radius: 6px;
  background: rgba(255, 248, 226, 0.36);
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.5;
}
.wardrobe-entry-status b {
  display: inline-block;
  min-width: 64px;
  color: var(--pm-ink);
}
.wardrobe-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.wardrobe-capture {
  min-height: 150px;
  line-height: 1.65;
  font-family: var(--pm-font-num), ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: calc(11px * var(--pm-text-scale));
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
.delete-confirm-modal {
  width: min(430px, 100%);
}
.delete-confirm-modal .pm-modal-body {
  display: grid;
  gap: 8px;
  line-height: 1.7;
}
.delete-confirm-modal .pm-modal-body p {
  margin: 0;
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
  .behavior-group-list {
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
  .behavior-chip {
    flex: 1 1 calc(50% - 6px);
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: normal;
    text-align: center;
  }
  .behavior-detail {
    position: static;
  }
}

@media (max-width: 600px) {
  #page-characters {
    display: block;
    overflow: visible;
  }
  #page-characters > .pm-paper-body {
    max-height: none;
    overflow: visible;
    padding: 10px;
  }
  .char-layout {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: auto;
    align-items: stretch;
  }
  .char-side {
    order: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .char-list {
    order: 2;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .char-card,
  .side-card {
    padding: 10px;
  }
  .char-head {
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 8px;
  }
  .portrait {
    width: 42px;
    height: 42px;
  }
  .char-meta h3,
  .loc-name {
    flex-wrap: wrap;
    font-size: calc(15px * var(--pm-text-scale));
  }
  .bar-line {
    grid-template-columns: 46px minmax(0, 1fr);
    gap: 6px;
  }
  .bar-line > span:last-child {
    grid-column: 2;
    justify-self: start;
  }
  .state-capsules {
    padding-left: 0;
  }
  .char-notes p {
    display: grid;
    gap: 2px;
  }
  .char-notes b,
  .selected-fields b {
    min-width: 0;
  }
  .selected-fields span {
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: start;
  }
  .stage-h,
  .selected-temp-states,
  .char-acts {
    position: static;
  }
  .stage-h {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    line-height: 1.5;
  }
  .stage-list li {
    grid-template-columns: 54px minmax(0, 1fr);
  }
  .char-acts .pm-btn {
    flex: 1 1 calc(50% - 6px);
    justify-content: center;
  }
  .behavior-chip {
    flex-basis: 100%;
  }
  .cg-grid-side,
  .cg-rating-tabs,
  .worldbook-editor-grid {
    grid-template-columns: 1fr;
  }
  .worldbook-bind-toolbar .pm-input {
    min-width: 0;
    width: 100%;
  }
}
</style>
