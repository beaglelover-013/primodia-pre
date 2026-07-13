<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore, formatCopper, type InventoryItem, type InventorySource } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';

const game = useGameStore();

type Cat = '全部' | InventoryItem['category'];
const categories: Cat[] = ['全部', '食材', '调料', '成品', '酒水', '杂物'];
const currentCat = ref<Cat>('全部');
const inventoryView = ref<InventorySource>('satchel');

interface SlotEntry {
  itemId: string;
  qty: number;
}
type CraftMode = 'cooking' | 'sauce' | 'drink';

const slots = ref<SlotEntry[]>([]);
const slotLogIds = ref<string[]>([]);
const selectedServeGuestId = ref('');
const craftMode = ref<CraftMode>('cooking');
type MoveDirection = 'to_storage' | 'to_satchel';
const activeMove = ref<{ itemId: string; direction: MoveDirection; qty: number } | null>(null);
const activeUse = ref<{ itemId: string; source: InventorySource; target: string } | null>(null);
const craftModeLabels: Record<CraftMode, string> = {
  cooking: '做菜',
  sauce: '做酱',
  drink: '做饮品',
};
const isSatchelView = computed(() => inventoryView.value === 'satchel');
const canUseStorageHere = computed(() => ['酒馆', '库房炉台', '农田酒窖'].includes(game.currentSceneType));
const canUseActiveInventory = computed(() => isSatchelView.value || canUseStorageHere.value);
const activeInventory = computed(() => (isSatchelView.value ? game.satchel : game.inventory));
const visibleItems = computed(() => (currentCat.value === '全部' ? activeInventory.value : activeInventory.value.filter(i => i.category === currentCat.value)));
const organizeAllLabel = computed(() => (currentCat.value === '全部' ? '全部整理入库' : `${currentCat.value}全入库`));
const groupedByCat = computed(() => {
  const out: Record<string, InventoryItem[]> = {};
  for (const it of visibleItems.value) {
    if (!out[it.category]) out[it.category] = [];
    out[it.category].push(it);
  }
  return out;
});
const basketSummary = computed(() => summarizeSlots(slots.value));
const serveTotal = computed(() =>
  slots.value.reduce((total, slot) => {
    const item = findItem(slot.itemId);
    return total + game.salePriceForItem(item) * slot.qty;
  }, 0),
);
const serveSelection = computed(() => selectedCraftItems());
const canServeSelection = computed(() =>
  serveSelection.value.length > 0 && serveSelection.value.every(item => ['食材', '调料', '成品', '酒水'].includes(item.category)),
);
const serveHasRawItems = computed(() => serveSelection.value.some(item => item.category === '食材' || item.category === '调料'));
const serveGuests = computed(() => game.orderableGuestGroups());
const selectedServeGuest = computed(() => serveGuests.value.find(group => group.id === selectedServeGuestId.value));
const mustSelectServeGuest = computed(() => serveGuests.value.length > 0);
const itemUseTargets = computed(() => [
  { type: '自己', name: game.protagonist.name || '主角', value: `主角：${game.protagonist.name || '主角'}` },
  ...game.heroines.map(heroine => ({
    type: '人物',
    name: heroine.name,
    value: `人物：${heroine.name}`,
  })),
  ...game.regions.map(region => ({
    type: '区域',
    name: region.name,
    value: `酒馆区域：${region.name}`,
  })),
]);
watch(
  serveGuests,
  guests => {
    if (!guests.length) {
      selectedServeGuestId.value = '';
      return;
    }
    if (!guests.some(group => group.id === selectedServeGuestId.value)) {
      selectedServeGuestId.value = guests[0]?.id ?? '';
    }
  },
  { immediate: true },
);
watch(
  () => game.inventory.map(item => `${item.id}:${item.qty}`).join('|'),
  () => {
    slots.value = slots.value
      .map(slot => {
        const item = findItem(slot.itemId);
        if (!item || item.qty <= 0) return null;
        return { ...slot, qty: Math.min(slot.qty, item.qty) };
      })
      .filter((slot): slot is SlotEntry => slot !== null);
    if (slots.value.length === 0) clearSlotLogs();
  },
);

function findItem(id: string) {
  return game.inventory.find(i => i.id === id);
}

function summarizeSlots(slots: SlotEntry[]) {
  return slots
    .map(slot => {
      const item = findItem(slot.itemId);
      return item ? `${item.name}×${slot.qty}` : '';
    })
    .filter(Boolean)
    .join('、');
}

function isServeItem(it: InventoryItem) {
  return ['食材', '调料', '成品', '酒水'].includes(it.category);
}

function handleTileClick(it: InventoryItem) {
  if (isSatchelView.value) {
    game.pushLog('提示', '行囊里的物品可以点“使用”或“整理入库”。');
    return;
  }
  addToSlots(it);
}

function moveItemCategory(it: InventoryItem, category: InventoryItem['category']) {
  game.dispatchAction({
    type: 'INVENTORY_MOVE_CATEGORY',
    itemId: it.id,
    category,
  });
}

function moveItemCategoryFromEvent(it: InventoryItem, event: Event) {
  const category = (event.target as HTMLSelectElement).value as InventoryItem['category'];
  moveItemCategory(it, category);
}

function canSaveRecipe(it: InventoryItem) {
  return Boolean(it.recipeSource?.ingredients?.length) && ['成品', '酒水', '调料'].includes(it.category);
}

function isPendingCraft(it: InventoryItem) {
  return it.name.startsWith('待命名') || it.tags.includes('待判定');
}

function recipeButtonText(it: InventoryItem) {
  if (!canSaveRecipe(it)) return '缺少材料记录';
  return game.isRecipeSavedForItem(it) ? '已保存' : '保存配方';
}

function saveRecipe(it: InventoryItem) {
  if (!canSaveRecipe(it)) {
    game.pushLog('提示', `「${it.name}」缺少材料记录，不能保存为配方。`);
    return;
  }
  game.saveRecipeFromInventoryItem(it.id);
}

function retryPendingCraft(it: InventoryItem) {
  if (!isPendingCraft(it)) return;
  game.retryPendingCraftResult();
}

function discardPendingCraft(it: InventoryItem) {
  if (!isPendingCraft(it)) return;
  game.discardPendingCraftItem(it.id);
}

function openMovePanel(it: InventoryItem, direction: MoveDirection) {
  activeMove.value = { itemId: it.id, direction, qty: Math.min(1, Math.max(1, it.qty)) };
}

function isMovePanelOpen(it: InventoryItem, direction: MoveDirection) {
  return activeMove.value?.itemId === it.id && activeMove.value.direction === direction;
}

function setMoveQty(it: InventoryItem, qty: number) {
  if (!activeMove.value || activeMove.value.itemId !== it.id) return;
  activeMove.value.qty = Math.max(1, Math.min(Math.max(1, it.qty), Math.floor(Number(qty) || 1)));
}

function setMoveQtyFromEvent(it: InventoryItem, event: Event) {
  setMoveQty(it, Number((event.target as HTMLInputElement).value));
}

function stepMoveQty(it: InventoryItem, delta: number) {
  setMoveQty(it, (activeMove.value?.qty ?? 1) + delta);
}

function maxMoveQty(it: InventoryItem) {
  setMoveQty(it, it.qty);
}

function openUsePanel(it: InventoryItem, source: InventorySource) {
  if (source === 'storage' && !canUseStorageHere.value) {
    game.pushLog('提示', '当前不在酒馆内，不能直接使用库房物品。请使用个人行囊里的物品，或先回酒馆。');
    return;
  }
  activeMove.value = null;
  activeUse.value = {
    itemId: it.id,
    source,
    target: itemUseTargets.value[0]?.value ?? `主角：${game.protagonist.name || '主角'}`,
  };
}

function isUsePanelOpen(it: InventoryItem) {
  return activeUse.value?.itemId === it.id && activeUse.value.source === inventoryView.value;
}

function setUseTarget(value: string) {
  if (!activeUse.value) return;
  activeUse.value.target = value;
}

async function confirmMove(it: InventoryItem) {
  if (!activeMove.value || activeMove.value.itemId !== it.id) return;
  if (activeMove.value.direction === 'to_storage') await organizeToStorage(it, activeMove.value.qty);
  else await takeToSatchel(it, activeMove.value.qty);
}

async function organizeToStorage(it: InventoryItem, qty: number) {
  if (!isSatchelView.value) return;
  const result = await game.executePseudoZeroAction({
    type: 'INVENTORY_MOVE_TO_STORAGE',
    itemId: it.id,
    qty,
  }, {
    type: 'INVENTORY_MOVE_TO_STORAGE',
    title: '整理入库',
    logText: `整理入库 · ${it.name} ×${qty}`,
    queueDraft: true,
  });
  if (result.ok) activeMove.value = null;
  else game.pushLog('提示', result.message);
}

async function organizeAllVisibleToStorage() {
  if (!isSatchelView.value || visibleItems.value.length === 0) return;
  activeMove.value = null;
  const targets = visibleItems.value.map(item => ({ id: item.id, name: item.name }));
  let movedCount = 0;
  for (const target of targets) {
    const current = game.satchel.find(item => item.id === target.id);
    if (!current || current.qty <= 0) continue;
    const qty = current.qty;
    const result = await game.executePseudoZeroAction({
      type: 'INVENTORY_MOVE_TO_STORAGE',
      itemId: current.id,
      qty,
    }, {
      type: 'INVENTORY_MOVE_TO_STORAGE',
      title: '整理入库',
      logText: `整理入库 · ${current.name} ×${qty}`,
      queueDraft: true,
    });
    if (result.ok) movedCount += 1;
    else game.pushLog('提示', result.message);
  }
  if (movedCount > 0) {
    game.pushLog('提示', `${organizeAllLabel.value}已加入本回合行动，共 ${movedCount} 类。`, {
      source: 'engine',
      authoritative: true,
      tone: 'cyan',
      actionType: 'INVENTORY_MOVE_TO_STORAGE',
    });
  }
}

async function takeToSatchel(it: InventoryItem, qty: number) {
  if (isSatchelView.value) return;
  const result = await game.executePseudoZeroAction({
    type: 'INVENTORY_MOVE_TO_SATCHEL',
    itemId: it.id,
    qty,
  }, {
    type: 'INVENTORY_MOVE_TO_SATCHEL',
    title: '取出到行囊',
    logText: `取出到行囊 · ${it.name} ×${qty}`,
    queueDraft: true,
  });
  if (result.ok) activeMove.value = null;
  else game.pushLog('提示', result.message);
}

async function useInventoryItem(it: InventoryItem, source: InventorySource) {
  const target = activeUse.value?.itemId === it.id ? activeUse.value.target : itemUseTargets.value[0]?.value;
  if (source === 'storage' && !canUseStorageHere.value) {
    game.pushLog('提示', '当前不在酒馆内，不能直接使用库房物品。请使用个人行囊里的物品，或先回酒馆。');
    return;
  }
  const result = await game.executePseudoZeroAction({
    type: 'USE_ITEM',
    itemId: it.id,
    source,
    target,
  }, {
    type: 'USE_ITEM',
    title: `使用${it.name}`,
    aiHint: `请叙述玩家对「${target || '主角'}」使用该物品的过程；若产生明确短期影响，请按本回合提示写入对应目标的临时状态。`,
    logText: `使用物品 · ${source === 'satchel' ? '行囊' : '库房'} · ${it.name} · ${target || '主角'}`,
    queueDraft: true,
  });
  if (result.ok) activeUse.value = null;
  else game.pushLog('提示', result.message);
}

function addToSlots(it: InventoryItem) {
  if (it.qty <= 0) {
    game.pushLog('提示', `${it.name} 已无库存。`);
    return;
  }
  const existed = slots.value.find(s => s.itemId === it.id);
  if (existed) {
    if (existed.qty < it.qty) existed.qty += 1;
  } else {
    slots.value.push({ itemId: it.id, qty: 1 });
  }
  slotLogIds.value.push(game.pushLog('提示', `${it.name} 已放入本次选择。`));
}

function decSlot(idx: number) {
  const slot = slots.value[idx];
  if (!slot) return;
  slot.qty -= 1;
  if (slot.qty <= 0) slots.value.splice(idx, 1);
  if (slots.value.length === 0) clearSlotLogs();
}

function clearSlotLogs() {
  game.removeLogs(slotLogIds.value);
  slotLogIds.value = [];
}

function clearSlots() {
  slots.value = [];
  clearSlotLogs();
}

function selectedCraftItems() {
  return slots.value
    .map(slot => {
      const item = findItem(slot.itemId);
      if (!item) return null;
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        qty: slot.qty,
        tags: item.tags,
        priceCopper: item.priceCopper,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

async function recordCraftAction(mode: CraftMode) {
  if (!basketSummary.value) return;
  craftMode.value = mode;
  const summaryBeforeAction = basketSummary.value;
  const result = await game.executePseudoZeroAction({
    type: 'COOK_DISH',
    mode,
    items: selectedCraftItems(),
  }, {
    type: 'COOK_DISH',
    title: craftModeLabels[mode],
    inputText: `玩家用这些材料${craftModeLabels[mode]}：${summaryBeforeAction}。`,
    aiHint: '请按对应生成引擎叙述制作过程, 并输出 <craft_result> 隐藏数据块供前端入库。',
    logText: `${craftModeLabels[mode]} · ${summaryBeforeAction}`,
    preserveLocalState: true,
  });
  if (!result.ok) {
    return;
  }
  clearSlots();
}

function makeCooking() {
  if (!basketSummary.value) return;
  recordCraftAction('cooking');
}

function makeSauce() {
  if (!basketSummary.value) return;
  recordCraftAction('sauce');
}

function makeDrink() {
  if (!basketSummary.value) return;
  recordCraftAction('drink');
}

async function serveItems() {
  if (!basketSummary.value) return;
  if (!canServeSelection.value) {
    game.pushLog('提示', '本次选择里有不能上桌的杂物。食材、调料、成品和酒水可以上菜。');
    return;
  }
  if (mustSelectServeGuest.value && !selectedServeGuest.value) {
    game.pushLog('提示', '请选择要上菜的客人或桌。');
    return;
  }
  const summaryBeforeAction = basketSummary.value;
  const totalBeforeAction = serveTotal.value;
  const guest = selectedServeGuest.value;
  const targetText = guest ? `给「${guest.label}」` : '普通上菜';
  const rawServeHint = serveHasRawItems.value
    ? '本次包含食材或调料，请按冷盘、佐食、直接可入口的食材、客人要求的原料或小份试吃来叙述，不要假装已经额外烹饪。'
    : '';
  const result = await game.executePseudoZeroAction({
    type: 'SERVE_DISH',
    items: selectedCraftItems(),
    guestId: guest?.id,
  }, {
    type: 'SERVE_DISH',
    title: '上菜',
    aiHint: guest
      ? `玩家把本次上菜送到「${guest.label}」。那桌是${guest.guests || '未记录客人'}，之前点了「${guest.order || '未记录点单'}」。${rawServeHint}请叙述上菜与客人反应，不要重新计算价格，不要改变库存、随身钱袋或钱匣。`
      : `${rawServeHint}请叙述上菜、客人反应和酒馆气氛，不要重新计算价格，不要改变库存、随身钱袋或钱匣。`,
    logText: `上菜 · ${targetText} · ${summaryBeforeAction} · ${formatCopper(totalBeforeAction)}`,
    preserveLocalState: true,
  });
  if (!result.ok) {
    return;
  }
  clearSlots();
}
function qualityTone(q?: InventoryItem['quality']) {
  if (q === '奇迹' || q === '绝佳搭配') return 'gold';
  if (q === '经典搭配') return 'good';
  if (q === '轻微冲突') return 'warn';
  if (q === '严重冲突' || q === '灾难级') return 'bad';
  if (q === '无冲突') return 'violet';
  return undefined;
}
</script>

<template>
  <section id="page-inventory" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="pot" :size="22" />
          行囊与库房
        </h2>
        <div class="sub">行囊使用与入库 · 库房做菜或上菜 · 让叙事判断结果</div>
      </div>
      <div class="head-actions">
        <button
          v-if="isSatchelView"
          class="pm-btn ghost"
          :disabled="visibleItems.length === 0"
          @click="organizeAllVisibleToStorage"
        >
          <PmIcon name="check" :size="12" /> {{ organizeAllLabel }}
        </button>
        <button class="pm-btn ghost" @click="currentCat = '全部'">
          <PmIcon name="flourish" :size="12" /> 全部
        </button>
      </div>
    </header>

    <div class="pm-paper-body inv-layout">
      <div class="inv-left">
        <div class="inventory-mode-tabs" aria-label="库存视图切换">
          <button class="mode-tab" :class="{ active: inventoryView === 'satchel' }" @click="inventoryView = 'satchel'">
            <PmIcon name="ledger" :size="13" /> 个人行囊
          </button>
          <button class="mode-tab" :class="{ active: inventoryView === 'storage' }" @click="inventoryView = 'storage'">
            <PmIcon name="pot" :size="13" /> 库房
          </button>
        </div>
        <div class="inv-tabs">
          <button v-for="cat in categories" :key="cat" class="inv-tab" :class="{ active: currentCat === cat }" @click="currentCat = cat">
            {{ cat }}
          </button>
        </div>

        <div v-for="(items, cat) in groupedByCat" :key="cat" class="inv-block">
          <div class="inv-block-head">
            <PmIcon name="chevron-down" :size="14" />
            <span>{{ cat }}</span>
            <span class="pm-dim">· {{ items.length }} 项</span>
          </div>
          <div class="inv-tiles">
            <article
              v-for="it in items"
              :key="it.id"
              class="inv-tile"
              :class="{ compact: !isServeItem(it), clickable: !isSatchelView }"
              :title="isSatchelView ? '行囊物品可使用或整理入库' : '加入本次选择'"
              @click="handleTileClick(it)"
            >
              <div class="inv-tile-top">
                <span class="inv-tile-name">{{ it.name }}</span>
                <span v-if="it.quality" class="pm-tag" :class="qualityTone(it.quality)">{{ it.quality }}</span>
              </div>

              <div v-if="it.tags.length" class="inv-tile-tags">
                <span v-for="t in it.tags.slice(0, 5)" :key="t" class="pm-tag">{{ t }}</span>
              </div>
              <p v-if="it.desc" class="inv-tile-desc">{{ it.desc }}</p>

              <footer class="inv-tile-foot">
                <span class="pm-num inv-tile-qty">× {{ it.qty }}</span>
                <span class="price">{{ formatCopper(it.priceCopper ?? 0) }}</span>
              </footer>
              <label v-if="!isSatchelView" class="category-mover" title="整理到其他分类" @click.stop>
                <span>整理</span>
                <select :value="it.category" @change="moveItemCategoryFromEvent(it, $event)">
                  <option v-for="categoryName in categories.filter(c => c !== '全部')" :key="categoryName" :value="categoryName">{{ categoryName }}</option>
                </select>
              </label>
              <div class="item-actions">
                <button
                  class="recipe-save"
                  :disabled="!canUseActiveInventory"
                  :title="canUseActiveInventory ? '使用这件物品' : '当前不在酒馆内，不能直接使用库房物品'"
                  @click.stop="openUsePanel(it, inventoryView)"
                >
                  使用
                </button>
                <button v-if="isSatchelView" class="recipe-save" @click.stop="openMovePanel(it, 'to_storage')">
                  整理入库
                </button>
                <button v-else class="recipe-save" @click.stop="openMovePanel(it, 'to_satchel')">
                  取出
                </button>
              </div>
              <div v-if="isUsePanelOpen(it)" class="move-popover use-popover" @click.stop>
                <div class="use-target">
                  <span class="move-label">使用目标</span>
                  <div class="use-target-list">
                    <button
                      v-for="target in itemUseTargets"
                      :key="target.value"
                      type="button"
                      class="use-target-option"
                      :class="{ active: activeUse?.target === target.value }"
                      @click="setUseTarget(target.value)"
                    >
                      <span>{{ target.type }}</span>
                      <strong>{{ target.name }}</strong>
                    </button>
                  </div>
                </div>
                <div class="move-actions">
                  <button class="ghost" @click="activeUse = null">取消</button>
                  <button @click="useInventoryItem(it, inventoryView)">确认使用</button>
                </div>
              </div>
              <div
                v-if="isMovePanelOpen(it, isSatchelView ? 'to_storage' : 'to_satchel')"
                class="move-popover"
                @click.stop
              >
                <span class="move-label">{{ isSatchelView ? '入库数量' : '取出数量' }}</span>
                <div class="move-controls">
                  <button :disabled="(activeMove?.qty ?? 1) <= 1" @click="stepMoveQty(it, -1)">-</button>
                  <input
                    type="number"
                    min="1"
                    :max="it.qty"
                    :value="activeMove?.qty ?? 1"
                    @input="setMoveQtyFromEvent(it, $event)"
                  />
                  <button :disabled="(activeMove?.qty ?? 1) >= it.qty" @click="stepMoveQty(it, 1)">+</button>
                </div>
                <div class="move-actions">
                  <button class="ghost" @click="maxMoveQty(it)">全部</button>
                  <button class="ghost" @click="activeMove = null">取消</button>
                  <button @click="confirmMove(it)">确认</button>
                </div>
              </div>
              <button
                v-if="!isSatchelView && isPendingCraft(it)"
                class="recipe-save"
                @click.stop="retryPendingCraft(it)"
              >
                重读结果
              </button>
              <button
                v-if="!isSatchelView && isPendingCraft(it)"
                class="recipe-save muted"
                @click.stop="discardPendingCraft(it)"
              >
                丢弃占位
              </button>
              <button
                v-if="!isSatchelView && !isPendingCraft(it) && ['成品', '酒水', '调料'].includes(it.category)"
                class="recipe-save"
                :class="{ muted: !canSaveRecipe(it), saved: game.isRecipeSavedForItem(it) }"
                :disabled="!canSaveRecipe(it)"
                @click.stop="saveRecipe(it)"
              >
                {{ recipeButtonText(it) }}
              </button>
            </article>
          </div>
        </div>
        <div v-if="visibleItems.length === 0" class="pm-empty inv-empty">
          {{ isSatchelView ? '个人行囊里暂时没有东西。去商铺购买后会先放在这里。' : '库房里暂时没有这个分类的物品。' }}
        </div>
      </div>

      <aside class="inv-right">
        <div class="bench">
          <header class="bench-head">
            <div>
              <h3>本次选择</h3>
              <div class="pm-dim">{{ isSatchelView ? '行囊物品先整理进库房，再用于炉台。' : '库房物品能放进来，再决定做菜或上桌。' }}</div>
            </div>
            <button class="pm-btn sm ghost" :disabled="slots.length === 0" @click="clearSlots">一键清空</button>
          </header>

          <section class="selected-box">
            <div v-if="slots.length === 0" class="pm-empty">{{ isSatchelView ? '切到库房后，可以点选材料做菜或上菜。' : '点击任意库存卡片即可加入, 点一次加一份。' }}</div>
            <div v-for="(slot, idx) in slots" v-else :key="slot.itemId" class="selected-line">
              <span>{{ findItem(slot.itemId)?.name }}×{{ slot.qty }}</span>
              <button title="减少一份" @click="decSlot(idx)"><PmIcon name="minus" :size="12" /></button>
            </div>
          </section>

          <section class="craft-board">
            <div class="craft-head">
              <div class="craft-label">制作</div>
              <div class="craft-tabs">
                <button
                  v-for="mode in (['cooking', 'sauce', 'drink'] as CraftMode[])"
                  :key="mode"
                  class="craft-tab"
                  :class="{ active: craftMode === mode }"
                  @click="craftMode = mode"
                >
                  {{ craftModeLabels[mode] }}
                </button>
              </div>
            </div>
          </section>

          <div class="cook-preview">
            <span class="label">将写入</span>
            <p>{{ basketSummary ? `用这些材料${craftModeLabels[craftMode]}「${basketSummary}」。` : '选择物品后会生成一句行动记录。' }}</p>
          </div>

          <div class="serve-total">
            <span>上菜应收</span>
            <strong>{{ formatCopper(serveTotal) }}</strong>
            <small>声望 {{ game.reputationSaleText() }}</small>
          </div>

          <div v-if="serveGuests.length" class="serve-target">
            <span>上菜对象</span>
            <div class="serve-target-list">
              <button
                v-for="guest in serveGuests"
                :key="guest.id"
                type="button"
                class="serve-target-option"
                :class="{ active: selectedServeGuestId === guest.id }"
                @click="selectedServeGuestId = guest.id"
              >
                <strong>{{ guest.label }}</strong>
                <small>{{ guest.order || guest.guests || '等待上菜' }}</small>
              </button>
            </div>
            <p v-if="selectedServeGuest" class="serve-target-detail">
              {{ selectedServeGuest.guests }}
              <template v-if="selectedServeGuest.order"> · 点单: {{ selectedServeGuest.order }}</template>
            </p>
          </div>

          <div class="bench-actions">
            <button class="pm-btn dark" :class="{ ghost: craftMode !== 'sauce' }" :disabled="slots.length === 0" @click="makeSauce">
              <PmIcon name="pot" :size="13" /> 做酱
            </button>
            <button class="pm-btn dark" :class="{ ghost: craftMode !== 'drink' }" :disabled="slots.length === 0" @click="makeDrink">
              <PmIcon name="coin" :size="13" /> 做饮品
            </button>
            <button class="pm-btn dark" :class="{ ghost: craftMode !== 'cooking' }" :disabled="slots.length === 0" @click="makeCooking">
              <PmIcon name="fire" :size="13" /> 做菜
            </button>
            <button class="pm-btn dark" :disabled="!canServeSelection || (serveGuests.length > 0 && !selectedServeGuestId)" @click="serveItems">
              <PmIcon name="check" :size="13" /> 上菜
            </button>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.inv-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.82fr);
  gap: 14px;
  align-items: start;
}
.inventory-mode-tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  margin-bottom: 10px;
  border: 1px solid rgba(110, 80, 34, 0.42);
  border-radius: 6px;
  background: rgba(255, 245, 215, 0.48);
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.48);
}
.mode-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 5px 13px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--pm-ink-soft);
  font-size: calc(12px * var(--pm-text-scale));
  font-weight: 700;
  letter-spacing: 0.04em;
}
.mode-tab.active {
  color: var(--pm-ink);
  border-color: rgba(110, 80, 34, 0.56);
  background: linear-gradient(180deg, #f3da90, #c9a04a);
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.6);
}
.inv-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.inv-tab {
  padding: 4px 12px;
  border: 1px solid rgba(110, 80, 34, 0.4);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.55);
  color: var(--pm-ink-soft);
  font-size: calc(12px * var(--pm-text-scale));
  font-weight: 600;
}
.inv-tab.active {
  background: linear-gradient(180deg, #f3da90, #c9a04a);
  color: var(--pm-ink);
}
.inv-block {
  margin-bottom: 12px;
}
.inv-block-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--pm-ink-dim);
  font-family: var(--pm-font-display);
  font-size: calc(12px * var(--pm-text-scale));
  letter-spacing: 0.06em;
}
.inv-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(154px, 1fr));
  gap: 8px;
}
.inv-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 122px;
  padding: 9px 10px;
  border: 1px solid rgba(110, 80, 34, 0.4);
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(255, 245, 215, 0.78), rgba(212, 186, 136, 0.5));
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.6);
}
.inv-tile.clickable {
  cursor: pointer;
}
.inv-tile.clickable:hover {
  border-color: rgba(167, 121, 45, 0.82);
  background: linear-gradient(180deg, rgba(255, 247, 222, 0.94), rgba(219, 190, 137, 0.68));
}
.inv-tile.compact {
  min-height: 82px;
}
.inv-tile-top {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.inv-tile-name {
  color: var(--pm-ink);
  font-size: calc(13px * var(--pm-text-scale));
  font-weight: 700;
}
.inv-tile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.inv-tile-desc {
  margin: 0;
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.5;
}
.inv-tile-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
}
.inv-tile-qty {
  color: var(--pm-ink-soft);
  font-weight: 700;
}
.price {
  margin-right: auto;
  color: var(--pm-gold-dim);
  font-size: calc(11px * var(--pm-text-scale));
  font-weight: 700;
}
.category-mover {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 8px;
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
}
.category-mover select {
  min-width: 72px;
  height: 26px;
  color: var(--pm-ink);
  background: rgba(255, 248, 225, 0.72);
  border: 1px solid rgba(165, 126, 68, 0.45);
  border-radius: 4px;
  outline: none;
}
.recipe-save {
  width: 100%;
  min-height: 28px;
  border: 1px solid rgba(131, 92, 34, 0.5);
  border-radius: 4px;
  background: rgba(255, 246, 218, 0.66);
  color: var(--pm-ink);
  font-size: calc(11px * var(--pm-text-scale));
  font-weight: 700;
}
.recipe-save:not(:disabled):hover {
  border-color: rgba(167, 121, 45, 0.9);
  background: linear-gradient(180deg, #f3da90, #c9a04a);
}
.recipe-save:disabled {
  color: var(--pm-ink-faint);
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(131, 92, 34, 0.24);
  cursor: not-allowed;
}
.recipe-save.saved {
  color: var(--pm-status-good-text);
  background: var(--pm-status-good-bg);
  border-color: var(--pm-status-good-border);
}
.recipe-save.muted {
  color: var(--pm-ink-faint);
  background: rgba(255, 255, 255, 0.24);
  cursor: not-allowed;
}
.item-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 6px;
  margin-top: 6px;
}
.move-popover {
  display: grid;
  gap: 7px;
  margin-top: 6px;
  padding: 8px;
  border: 1px solid rgba(131, 92, 34, 0.48);
  border-radius: 4px;
  background: rgba(255, 248, 225, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.62);
}
.move-label {
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  font-weight: 700;
}
.move-controls,
.move-actions {
  display: grid;
  grid-template-columns: 28px minmax(48px, 1fr) 28px;
  gap: 5px;
  align-items: center;
}
.move-actions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.use-popover .move-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.use-target {
  display: grid;
  gap: 5px;
}
.use-target-list {
  display: grid;
  gap: 4px;
  max-height: 138px;
  overflow-y: auto;
  padding: 3px;
  border: 1px solid rgba(131, 92, 34, 0.34);
  border-radius: 4px;
  background: rgba(255, 252, 238, 0.45);
}
.use-target-option {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  min-height: 30px;
  padding: 5px 7px;
  border: 1px solid rgba(131, 92, 34, 0.28);
  border-radius: 4px;
  background: rgba(255, 248, 225, 0.66);
  color: var(--pm-ink);
  text-align: left;
}
.use-target-option:hover {
  border-color: rgba(170, 121, 45, 0.72);
  background: rgba(246, 221, 158, 0.68);
}
.use-target-option.active {
  border-color: rgba(167, 121, 45, 0.9);
  background: linear-gradient(180deg, #f3da90, #c9a04a);
  box-shadow: inset 0 1px 0 rgba(255, 248, 218, 0.82);
}
.use-target-option span {
  color: var(--pm-ink-dim);
  font-size: calc(10px * var(--pm-text-scale));
  font-weight: 700;
}
.use-target-option strong {
  min-width: 0;
  overflow: hidden;
  color: var(--pm-ink);
  font-size: calc(12px * var(--pm-text-scale));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.move-controls input {
  width: 100%;
  height: 28px;
  min-width: 0;
  text-align: center;
  color: var(--pm-ink);
  border: 1px solid rgba(131, 92, 34, 0.45);
  border-radius: 4px;
  background: rgba(255, 252, 238, 0.78);
}
.move-controls button,
.move-actions button {
  min-height: 28px;
  border: 1px solid rgba(131, 92, 34, 0.48);
  border-radius: 4px;
  color: var(--pm-ink);
  font-size: calc(11px * var(--pm-text-scale));
  font-weight: 700;
  background: linear-gradient(180deg, #ead19a, #bd8e43);
}
.move-actions button.ghost,
.move-controls button:disabled {
  color: var(--pm-ink-dim);
  background: rgba(255, 246, 218, 0.52);
}
.move-controls button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.selected-line button {
  display: grid;
  place-items: center;
  border: 1px solid rgba(110, 80, 34, 0.45);
  border-radius: 4px;
  background: linear-gradient(180deg, #ead19a, #bd8e43);
  color: var(--pm-ink);
}
.bench {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(110, 80, 34, 0.5);
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(255, 245, 215, 0.76), rgba(204, 174, 122, 0.5));
}
.bench-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--pm-ink);
}
.bench-head h3 {
  margin: 0;
  font-size: calc(16px * var(--pm-text-scale));
}
.selected-box {
  display: grid;
  gap: 6px;
  min-height: 96px;
  padding: 10px;
  border: 1px dashed rgba(110, 80, 34, 0.45);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.46);
}
.selected-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  padding: 7px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.26);
  color: var(--pm-ink);
  font-weight: 700;
}
.selected-line button {
  width: 24px;
  height: 24px;
}
.craft-board {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(110, 80, 34, 0.32);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.35);
}
.craft-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.craft-label {
  color: var(--pm-ink-dim);
  font-family: var(--pm-font-display);
  font-size: calc(12px * var(--pm-text-scale));
  font-weight: 700;
}
.craft-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 2px;
  border: 1px solid rgba(110, 80, 34, 0.32);
  border-radius: 4px;
  background: rgba(43, 29, 16, 0.08);
}
.craft-tab {
  padding: 4px 8px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--pm-ink-dim);
  font-weight: 700;
  font-size: calc(11px * var(--pm-text-scale));
}
.craft-tab.active {
  background: linear-gradient(180deg, #f3da90, #b88135);
  color: var(--pm-ink);
}
.cook-preview {
  padding: 10px;
  border-radius: 4px;
  background: rgba(43, 29, 16, 0.86);
  color: var(--pm-parch);
}
.cook-preview .label {
  color: var(--pm-gold-bright);
  font-size: calc(11px * var(--pm-text-scale));
}
.cook-preview p {
  margin: 4px 0 0;
  line-height: 1.6;
}
.serve-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(43, 29, 16, 0.82);
  color: var(--pm-parch);
}
.serve-total strong {
  color: var(--pm-gold-bright);
}
.serve-total small {
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
}
.serve-target {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px dashed var(--pm-line-soft);
  border-radius: 4px;
  background: rgba(255, 250, 232, 0.42);
}
.serve-target span {
  color: var(--pm-ink-dim);
  font-size: calc(12px * var(--pm-text-scale));
  font-weight: 700;
}
.serve-target-list {
  display: grid;
  gap: 5px;
  max-height: 150px;
  overflow-y: auto;
  padding: 3px;
  border: 1px solid rgba(131, 92, 34, 0.32);
  border-radius: 4px;
  background: rgba(255, 252, 238, 0.4);
}
.serve-target-option {
  display: grid;
  gap: 3px;
  min-height: 42px;
  padding: 7px 8px;
  border: 1px solid rgba(131, 92, 34, 0.28);
  border-radius: 4px;
  background: rgba(255, 248, 225, 0.64);
  color: var(--pm-ink);
  text-align: left;
}
.serve-target-option:hover {
  border-color: rgba(170, 121, 45, 0.74);
  background: rgba(246, 221, 158, 0.66);
}
.serve-target-option.active {
  border-color: rgba(167, 121, 45, 0.92);
  background: linear-gradient(180deg, #f3da90, #c9a04a);
  box-shadow: inset 0 1px 0 rgba(255, 248, 218, 0.82);
}
.serve-target-option strong {
  min-width: 0;
  overflow: hidden;
  color: var(--pm-ink);
  font-size: calc(12px * var(--pm-text-scale));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.serve-target-option small {
  display: -webkit-box;
  overflow: hidden;
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.serve-target p {
  margin: 0;
  color: var(--pm-ink-soft);
  line-height: 1.5;
  font-size: calc(12px * var(--pm-text-scale));
}
.bench-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 1100px) {
  .inv-layout {
    grid-template-columns: 1fr;
  }
  .bench {
    position: static;
  }
}

@media (max-width: 760px) {
  .inv-tabs,
  .craft-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .inv-tab {
    flex: 0 0 auto;
  }
  .inv-tiles {
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 7px;
  }
  .inv-tile {
    min-height: 96px;
    padding: 8px;
  }
  .inv-tile.compact {
    min-height: 68px;
  }
  .inv-tile-desc {
    display: none;
  }
  .craft-head,
  .bench-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .craft-tabs {
    width: 100%;
  }
  .craft-tab {
    flex: 1;
  }
}
</style>
