<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useGameStore, type BrewBarrel, type FarmPlot, type InventoryItem } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';

const game = useGameStore();

const currentDay = computed(() => game.calendar.year * 12 * 30 + game.calendar.monthIndex * 30 + game.calendar.day);
const seedPicker = reactive({
  open: false,
  plot: null as FarmPlot | null,
});
const pendingEarlyTapId = ref('');

const seedItems = computed(() =>
  game.inventory.filter(item => item.category === '杂物' && item.qty > 0 && (item.tags.includes('种子') || /种子|籽/.test(item.name))),
);

watch(
  () => game.farmPlots.map(plot => plot.id).join('|'),
  () => {
    if (seedPicker.plot && !game.farmPlots.some(plot => plot.id === seedPicker.plot?.id)) {
      seedPicker.open = false;
      seedPicker.plot = null;
    }
  },
);

const harvestTagPools = {
  vegetable: ['清甜', '水润', '紧实', '青味重', '辛烈', '泥土香', '易焦糖化', '苦涩', '水感', '香气集中'],
  fruit: ['果香浓', '酸甜', '清甜', '水润', '酒香', '涩感', '过熟', '发酵香', '蜜甜', '皮苦'],
  meat: ['脂肪丰厚', '肉质紧实', '肉质细嫩', '肉香浓', '野味重', '腥味轻', '腥味重', '血铁味', '柴硬', '厚鲜'],
  dairy: ['蛋香浓', '腥味轻', '蛋腥', '奶香厚', '脂感强', '清淡', '柔滑', '发酵酸', '陈香', '水感重'],
  strange: ['鱼鲜', '肉汤感', '烟熏香', '奶香', '酒香', '海潮气', '灶火余味', '菌菇香', '血铁味', '草本香'],
};

function pickFrom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function harvestPool(crop: string) {
  if (/果|莓|梨|苹果|樱桃|柑|番茄/.test(crop)) return harvestTagPools.fruit;
  if (/蛋|奶|酪|乳/.test(crop)) return harvestTagPools.dairy;
  if (/肉|鸡|羊|猪|牛|鹿|兔/.test(crop)) return harvestTagPools.meat;
  return harvestTagPools.vegetable;
}

function harvestTags(crop: string) {
  const pool = Math.random() < 0.12 ? [...harvestPool(crop), ...harvestTagPools.strange] : harvestPool(crop);
  const tags = new Set<string>();
  tags.add(pickFrom(pool));
  if (Math.random() < 0.18) tags.add(pickFrom(pool));
  return [...tags].slice(0, 2);
}

function batchName(baseName: string, tags: string[]) {
  if (!tags.length) return baseName;
  return `${tags.join('')}${baseName}`;
}

function cropFromSeed(seedName: string) {
  return seedName.replace(/种子|籽|小包|一袋|一把/g, '').trim() || seedName;
}

function expectedForCrop(crop: string) {
  if (/南瓜|番茄|甜薯|芋|瓜/.test(crop)) return '收获 8 ~ 14 份';
  if (/麦|稻|谷/.test(crop)) return '收获 40 ~ 60 束';
  if (/香草|药草|薄荷|鼠尾草/.test(crop)) return '收获 12 ~ 20 把';
  return '收获 10 ~ 18 份';
}

function expectedQty(text: string, fallback = 1) {
  const nums = [...text.matchAll(/\d+/g)].map(match => Number(match[0]));
  if (nums.length >= 2) return Math.max(1, Math.round((nums[0] + nums[1]) / 2));
  if (nums.length === 1) return Math.max(1, nums[0]);
  return fallback;
}

function dayLabel(dayNumber?: number) {
  if (!dayNumber) return '未记录';
  const year = Math.floor((dayNumber - 1) / 360);
  const rem = (dayNumber - 1) % 360;
  const month = Math.floor(rem / 30);
  const day = (rem % 30) + 1;
  return `${year}年 ${game.months[month] ?? `${month + 1}月`} ${day}日`;
}

function stageHint(stage: number) {
  return ['空畦', '初芽', '抽枝', '抽穗', '将熟', '成熟'][Math.min(stage, 5)] ?? '生长中';
}

function openSeedPicker(plot: FarmPlot) {
  seedPicker.plot = plot;
  seedPicker.open = true;
}

function plantPlot(seed: InventoryItem) {
  if (!seedPicker.plot || seed.qty <= 0) return;
  const plot = seedPicker.plot;
  const crop = cropFromSeed(seed.name);
  const expectedHarvest = expectedForCrop(crop);
  const result = game.dispatchAction({
    type: 'FARM_PLANT',
    plotId: plot.id,
    seedId: seed.id,
    crop,
    expectedHarvest,
    currentDay: currentDay.value,
  });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(`我在第${plot.id.slice(2)}号田畦播下「${seed.name}」，准备把它养成「${crop}」。预计${expectedHarvest}。（前端已结算：种子-1，田畦进入生长期。）`, { type: 'FARM_PLANT' });
  game.pushLog('提示', `播种 · ${crop} 已结算并加入行动框。`);
  seedPicker.open = false;
}

function expandPlot() {
  const result = game.dispatchAction({ type: 'FARM_EXPAND' });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(`我在后院或当前农田空间开拓第${result.summary || game.farmPlots.length}号新田畦，清理土面、翻土并整理边界。（前端已结算：新增空畦。）`, { type: 'FARM_EXPAND' });
  game.pushLog('提示', '开拓新畦已结算并加入行动框。');
}

function removePlot(plot: FarmPlot) {
  const result = game.dispatchAction({ type: 'FARM_REMOVE', plotId: plot.id });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(`我撤去第${plot.id.slice(2)}号田畦的「${plot.crop}」，整理土面和工具。（前端已结算：该空畦已撤去。）`, { type: 'FARM_REMOVE' });
  game.pushLog('提示', `撤去田畦 · ${plot.crop} 已结算并加入行动框。`);
}

function harvestPlot(plot: FarmPlot) {
  if (plot.stage < plot.stageMax) return;
  const qty = expectedQty(plot.expectedHarvest, 8);
  const tags = harvestTags(plot.crop);
  const name = batchName(plot.crop, tags);
  const crop = plot.crop;
  const result = game.dispatchAction({
    type: 'FARM_HARVEST',
    plotId: plot.id,
    resultName: name,
    quantity: qty,
    tags,
    priceCopper: 0,
  });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(`我收成第${plot.id.slice(2)}号田畦的「${crop}」，分拣后以「${name}」记入库房，约${qty}份，风味倾向为${tags.join('、') || '普通'}。（前端已结算：收成入库，田畦清空。）`, { type: 'FARM_HARVEST' });
  game.pushLog('提示', `收成 · ${name} 已结算并加入行动框。`);
}

function brewProgress(barrel: BrewBarrel) {
  const total = Math.max(1, barrel.matureDay - barrel.startedDay);
  const passed = Math.min(total, Math.max(0, currentDay.value - barrel.startedDay));
  return Math.round((passed / total) * 100);
}

function brewDaysLeft(barrel: BrewBarrel) {
  return Math.max(0, barrel.matureDay - currentDay.value);
}

function tapButtonText(barrel: BrewBarrel) {
  if (brewDaysLeft(barrel) === 0) return '开桶灌装';
  return pendingEarlyTapId.value === barrel.id ? '确认提前灌装' : '提前开桶灌装';
}

function tapBrew(barrel: BrewBarrel) {
  const daysLeft = brewDaysLeft(barrel);
  if (daysLeft > 0 && pendingEarlyTapId.value !== barrel.id) {
    pendingEarlyTapId.value = barrel.id;
    game.pushLog('提示', `${barrel.name} 还需要 ${daysLeft} 日才成熟。再次点击“确认提前灌装”才会提前开桶。`);
    return;
  }

  const bottles = daysLeft > 0 ? 4 : 8;
  const quality = daysLeft > 0 ? '提前开桶，风味偏薄' : barrel.expected.replace('预期: ', '');
  const result = game.dispatchAction({
    type: 'BREW_TAP',
    barrelId: barrel.id,
    bottles,
    quality,
    priceCopper: 0,
  });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  pendingEarlyTapId.value = '';
  game.appendDraft(`我开启酒窖里的「${barrel.name}」桶，灌装约${bottles}瓶。当前判断：${quality}。（前端已结算：酒水已入库，酒桶已移除。）`, { type: 'BREW_TAP' });
  game.pushLog('提示', `开桶灌装 · ${barrel.name} 已结算并加入行动框。`);
}
</script>

<template>
  <section id="page-farm" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="farm" :size="22" />
          农田与酒窖
        </h2>
        <div class="sub">田畦种植 · 桶中熟成 · 收成与灌装</div>
      </div>
    </header>

    <div class="pm-paper-body">
      <div class="pm-divider">— 农田 · 田畦展示 —</div>
      <div class="farm-actions">
        <span class="pm-dim">种子来自库房杂物，带“种子”或“籽”的物品可以播种。</span>
        <button class="pm-btn sm" @click="expandPlot">
          <PmIcon name="plus" :size="12" /> 开拓新畦
        </button>
      </div>

      <div class="farm-grid pm-grid auto-sm">
        <article v-for="plot in game.farmPlots" :key="plot.id" class="farm-plot pm-card">
          <div class="plot-h">
            <span class="plot-name">{{ plot.crop }}</span>
            <span class="pm-tag dim">{{ plot.season }}</span>
          </div>
          <div class="plot-stage">
            <span v-for="i in plot.stageMax" :key="i" class="stage-dot" :class="{ done: i <= plot.stage }"></span>
          </div>
          <div class="plot-stage-name pm-num">{{ stageHint(plot.stage) }} · {{ plot.stage }}/{{ plot.stageMax }}</div>
          <div v-if="plot.batchTags?.length" class="plot-tags">
            <span v-for="tag in plot.batchTags" :key="tag" class="pm-tag">{{ tag }}</span>
          </div>
          <div class="plot-exp pm-dim">{{ plot.expectedHarvest }}</div>
          <div v-if="plot.stage > 0" class="plot-dates">
            <span>播种 {{ dayLabel(plot.plantedDay) }}</span>
            <span>成熟 {{ dayLabel(plot.matureDay) }}</span>
          </div>
          <div class="plot-acts">
            <button v-if="plot.stage === 0" class="pm-btn sm" @click="openSeedPicker(plot)">
              <PmIcon name="plus" :size="11" /> 选择种子
            </button>
            <button v-if="plot.stage === 0" class="pm-btn sm ghost" @click="removePlot(plot)">
              <PmIcon name="x" :size="11" /> 删除
            </button>
            <button v-else-if="plot.stage >= plot.stageMax" class="pm-btn sm dark" @click="harvestPlot(plot)">
              <PmIcon name="check" :size="11" /> 收成
            </button>
            <button v-else class="pm-btn sm ghost" disabled>
              <PmIcon name="hourglass" :size="11" /> 等待成熟
            </button>
          </div>
        </article>
      </div>

      <div class="pm-divider">— 酒窖 · 桶中熟成 —</div>
      <div class="brew-actions">
        <span class="pm-dim">饮品、酱料和发酵物可以占用桶位；未成熟的酒桶需要二次确认才能提前灌装。</span>
        <span class="pm-tag dim">当前 {{ game.brews.length }} 桶</span>
      </div>

      <div class="brew-grid pm-grid auto">
        <article v-for="barrel in game.brews" :key="barrel.id" class="brew-card pm-card">
          <div class="brew-h">
            <span class="brew-name">{{ barrel.name }}</span>
            <span class="pm-tag dim">{{ barrel.expected }}</span>
          </div>
          <div class="brew-bar">
            <span class="pm-bar"><i :style="{ width: `${brewProgress(barrel)}%` }"></i></span>
            <span class="pm-num pct">{{ brewProgress(barrel) }}%</span>
          </div>
          <div class="brew-meta">
            <span class="pm-tag gold">{{ barrel.brewType ?? '酒水' }}</span>
            <span class="pm-tag">开始 {{ dayLabel(barrel.startedDay) }}</span>
            <span class="pm-tag">收获 {{ dayLabel(barrel.matureDay) }}</span>
            <span class="pm-tag">{{ barrel.filling }}</span>
            <span class="pm-tag" :class="brewDaysLeft(barrel) === 0 ? 'good' : 'warn'">
              {{ brewDaysLeft(barrel) === 0 ? '已可开桶' : `尚需 ${brewDaysLeft(barrel)} 日` }}
            </span>
          </div>
          <div v-if="pendingEarlyTapId === barrel.id && brewDaysLeft(barrel) > 0" class="early-warning">
            这桶还没成熟。确认后会提前灌装，产量和风味按偏薄处理。
          </div>
          <div class="brew-acts">
            <button class="pm-btn sm" :class="{ danger: pendingEarlyTapId === barrel.id && brewDaysLeft(barrel) > 0 }" @click="tapBrew(barrel)">
              <PmIcon name="coin" :size="11" /> {{ tapButtonText(barrel) }}
            </button>
          </div>
        </article>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="seedPicker.open" class="pm-modal-mask" @click.self="seedPicker.open = false">
        <div class="pm-modal">
          <header class="pm-modal-head">
            <h3><PmIcon name="farm" :size="16" /> 选择种子 · 第{{ seedPicker.plot?.id.slice(2) }}号畦</h3>
            <button class="pm-link" @click="seedPicker.open = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <div v-if="seedItems.length" class="seed-list">
              <button v-for="seed in seedItems" :key="seed.id" class="seed-card" @click="plantPlot(seed)">
                <strong>{{ seed.name }}</strong>
                <span class="pm-num">× {{ seed.qty }}</span>
                <small>{{ seed.desc }}</small>
              </button>
            </div>
            <div v-else class="pm-empty">库房里没有种子。去街坊商铺买到“种子”类杂物后，就能在这里播种。</div>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="seedPicker.open = false">取消</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.farm-actions,
.brew-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 6px 0 10px;
}
.farm-plot,
.brew-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.plot-h,
.brew-h {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.plot-name,
.brew-name {
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(14px * var(--pm-text-scale));
}
.plot-stage {
  display: flex;
  gap: 4px;
}
.stage-dot {
  width: 14px;
  height: 14px;
  border: 1px solid rgba(110, 80, 34, 0.5);
  border-radius: 50%;
  background: rgba(110, 80, 34, 0.25);
}
.stage-dot.done {
  border-color: #34532b;
  background: linear-gradient(180deg, #b8c98b, #5c8a52);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
.plot-stage-name,
.brew-bar .pct {
  color: var(--pm-ink-soft);
  font-size: calc(11.5px * var(--pm-text-scale));
}
.plot-exp {
  font-size: calc(11px * var(--pm-text-scale));
}
.plot-tags,
.brew-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.plot-dates {
  display: grid;
  gap: 2px;
  color: var(--pm-ink-dim);
  font-size: calc(10.5px * var(--pm-text-scale));
}
.plot-acts,
.brew-acts {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.brew-bar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}
.early-warning {
  padding: 7px 8px;
  border: 1px solid rgba(153, 83, 37, 0.42);
  border-radius: 4px;
  background: rgba(255, 231, 190, 0.55);
  color: #7b3f22;
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.45;
}
.seed-list {
  display: grid;
  gap: 8px;
}
.seed-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 8px;
  padding: 10px;
  border: 1px solid rgba(110, 80, 34, 0.45);
  border-radius: 4px;
  background: rgba(255, 248, 226, 0.62);
  color: var(--pm-ink);
  text-align: left;
}
.seed-card:hover {
  border-color: rgba(130, 84, 31, 0.9);
  background: linear-gradient(180deg, rgba(246, 222, 159, 0.78), rgba(209, 166, 82, 0.48));
}
.seed-card small {
  grid-column: 1 / -1;
  color: var(--pm-ink-dim);
  line-height: 1.45;
}
@media (max-width: 760px) {
  .farm-actions,
  .brew-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
