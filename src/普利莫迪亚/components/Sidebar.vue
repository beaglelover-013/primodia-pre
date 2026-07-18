<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore, type TabId } from '../stores/game';
import PmIcon from './PmIcon.vue';

const game = useGameStore();

interface NavItem {
  id: TabId;
  name: string;
  icon: string;
  badge?: string;
  status?: 'ready' | 'dev';
  sub?: string;
  quiet?: boolean;
}

interface NavGroup {
  id: string;
  name: string;
  icon: string;
  sub: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    id: 'chronicles',
    name: '编年录',
    icon: 'ledger',
    sub: '正文 · 约定',
    items: [
      { id: 'chronicle', name: '编年录', icon: 'ledger', sub: '正文 · 选择', status: 'ready' },
    ],
  },
  {
    id: 'tavern',
    name: '酒馆经营',
    icon: 'tavern',
    sub: '区域 · 商铺 · 账单',
    items: [
      { id: 'tavern', name: '酒馆', icon: 'tavern', sub: '主厅 · 房间 · 经营', status: 'ready' },
      { id: 'operations', name: '经营附录', icon: 'ledger', sub: '状态 · 维持 · 约定', status: 'ready' },
      { id: 'regularGuests', name: '常客簿', icon: 'people', sub: '老面孔 · 团体 · 回访', status: 'ready' },
      { id: 'shop', name: '街坊商铺', icon: 'coin', sub: '店铺 · 货架 · 购买', status: 'ready' },
      { id: 'ledger', name: '账单', icon: 'ledger', sub: '历史足迹 · 资产', status: 'ready' },
    ],
  },
  {
    id: 'people',
    name: '人物',
    icon: 'people',
    sub: '主角 · 配角',
    items: [
      { id: 'protagonist', name: '主角档案', icon: 'heart', sub: '状态 · 厨艺', status: 'ready' },
      { id: 'characters', name: '人物羁绊', icon: 'people', sub: '配角 · 羁绊', status: 'ready' },
    ],
  },
  {
    id: 'craft',
    name: '物资工坊',
    icon: 'pot',
    sub: '行囊 · 配方 · 农酿',
    items: [
      { id: 'inventory', name: '行囊与库房', icon: 'pot', sub: '使用 · 入库 · 炉台', status: 'ready' },
      { id: 'recipes', name: '配方簿', icon: 'ledger', sub: '复刻 · 记录', status: 'ready' },
      { id: 'farm', name: '农田与酒窖', icon: 'farm', sub: '种植 · 陈酿', status: 'ready' },
    ],
  },
  {
    id: 'world',
    name: '世界与资料',
    icon: 'map',
    sub: '地图 · 图册 · 后台',
    items: [
      { id: 'map', name: '大地图', icon: 'map', sub: '普利莫迪亚 · 节点', status: 'ready' },
      { id: 'gallery', name: '图册画廊', icon: 'map', sub: 'CG · 图床 · 收藏', status: 'ready' },
      { id: 'variables', name: '变量总览', icon: 'ledger', sub: '正式变量 · 检查', status: 'ready', quiet: true },
      { id: 'settings', name: '系统与设置', icon: 'gear', sub: '字体 · 存档 · 健康', status: 'ready', quiet: true },
    ],
  },
];

function groupForTab(id: TabId) {
  return navGroups.find(group => group.items.some(item => item.id === id)) ?? navGroups[0];
}

const activeGroupId = ref(groupForTab(game.currentTab).id);
const activeGroup = computed(() => navGroups.find(group => group.id === activeGroupId.value) ?? groupForTab(game.currentTab));
const tavernReputationStage = computed(() => game.reputationSaleStage);
const tavernReputationValue = computed(() => Math.max(0, Math.floor(Number(game.reputation) || 0)));
const tavernReputationCap = computed(() => {
  const stage = tavernReputationStage.value;
  return stage.index >= 5 ? `${stage.min}+` : String(stage.max);
});
const tavernReputationProgress = computed(() => {
  const stage = tavernReputationStage.value;
  if (stage.index >= 5) return 100;
  const span = Math.max(1, stage.max - stage.min);
  return Math.max(0, Math.min(100, ((tavernReputationValue.value - stage.min) / span) * 100));
});

watch(
  () => game.currentTab,
  tab => {
    activeGroupId.value = groupForTab(tab).id;
  },
);

function selectGroup(group: NavGroup) {
  activeGroupId.value = group.id;
  if (group.items.length === 1 || window.matchMedia?.('(max-width: 760px)').matches) {
    switchTab(group.items[0].id);
  }
}

function switchTab(id: TabId) {
  game.currentTab = id;
}
</script>

<template>
  <aside class="sidebar">
    <div class="scroll-top">
      <div class="scroll-band">普利莫迪亚</div>
    </div>

    <nav class="nav">
      <button
        v-for="group in navGroups"
        :id="`nav-group-${group.id}`"
        :key="group.id"
        class="nav-item nav-group"
        :class="{ active: activeGroup.id === group.id }"
        @click="selectGroup(group)"
      >
        <span class="nav-icon">
          <PmIcon :name="group.icon" :size="20" />
        </span>
        <span class="nav-text">
          <span class="nav-name">{{ group.name }}</span>
          <span class="nav-sub">{{ group.sub }}</span>
        </span>
        <span class="nav-cursor"></span>
      </button>

      <div class="sub-nav">
        <button
          v-for="item in activeGroup.items"
          :id="`nav-${item.id}`"
          :key="item.id"
          class="nav-item sub-item"
          :class="{ active: game.currentTab === item.id, quiet: item.quiet }"
          @click="switchTab(item.id)"
        >
          <span class="nav-icon">
            <PmIcon :name="item.icon" :size="17" />
          </span>
          <span class="nav-text">
            <span class="nav-name">{{ item.name }}</span>
            <span class="nav-sub">{{ item.sub }}</span>
          </span>
          <span v-if="item.status === 'dev'" class="nav-badge dev">开发中</span>
          <span class="nav-cursor"></span>
        </button>
      </div>
    </nav>

    <div class="scroll-foot">
      <div class="tavern-status" aria-label="酒馆声望">
        <div class="tavern-status-name">{{ game.tavernName }}</div>
        <div class="tavern-status-rank">{{ tavernReputationStage.label }}</div>
        <div class="tavern-status-meter" aria-hidden="true">
          <span :style="{ width: `${tavernReputationProgress}%` }"></span>
        </div>
        <div class="tavern-status-row">
          <span>声望 {{ tavernReputationValue }} / {{ tavernReputationCap }}</span>
          <span>售价 ×{{ tavernReputationStage.multiplier }}</span>
        </div>
      </div>
      <div class="scroll-band">CHRONICLES</div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--pm-side-bg);
  border: none;
  border-radius: 0;
  box-shadow:
    inset -1px 0 0 var(--pm-line-faint),
    0 12px 30px -16px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}

.scroll-top,
.scroll-foot {
  padding: 12px 12px;
  background: linear-gradient(180deg, var(--pm-dark-panel-soft), transparent);
  border-bottom: 1px dashed var(--pm-line-soft);
}
.scroll-foot {
  margin-top: auto;
  border-top: 1px dashed var(--pm-line-soft);
  border-bottom: none;
  background: linear-gradient(0deg, var(--pm-dark-panel-soft), transparent);
}
.scroll-band {
  font-family: var(--pm-font-display);
  letter-spacing: 0.2em;
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-parch-soft);
  text-align: center;
}
.tavern-status {
  font-family: var(--pm-font-body);
  margin-bottom: 10px;
  padding: 10px 10px 9px;
  border: 1px solid rgba(243, 220, 162, 0.18);
  border-radius: 4px;
  background:
    linear-gradient(180deg, rgba(243, 220, 162, 0.08), rgba(0, 0, 0, 0.08)),
    rgba(12, 8, 4, 0.18);
}
.tavern-status-name {
  font-family: var(--pm-font-display);
  font-size: calc(12px * var(--pm-text-scale));
  letter-spacing: 0.18em;
  color: var(--pm-parch-soft);
  text-align: center;
}
.tavern-status-rank {
  margin-top: 3px;
  font-family: var(--pm-font-display);
  font-size: calc(14px * var(--pm-text-scale));
  letter-spacing: 0.12em;
  color: var(--pm-gold-bright);
  text-align: center;
}
.tavern-status-meter {
  height: 4px;
  margin: 8px 0 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(243, 220, 162, 0.13);
}
.tavern-status-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(185, 131, 35, 0.88), rgba(243, 220, 162, 0.9));
}
.tavern-status-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: calc(10.5px * var(--pm-text-scale));
  color: rgba(243, 220, 162, 0.7);
  line-height: 1.35;
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 4px;
  overflow-y: auto;
}

.sub-nav {
  display: grid;
  gap: 4px;
  margin: 4px 0 8px 14px;
  padding: 6px 0 6px 9px;
  border-left: 1px dashed rgba(243, 220, 162, 0.2);
}

.nav-item {
  position: relative;
  display: grid;
  grid-template-columns: 34px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 10px;
  text-align: left;
  border-radius: 4px;
  background: transparent;
  color: var(--pm-parch-soft);
  transition: 0.18s ease;
}
.nav-item:hover {
  background: var(--pm-dark-panel-soft);
  color: var(--pm-parch-bright);
}
.nav-item.active {
  background:
    linear-gradient(180deg, var(--pm-dark-panel-soft), rgba(0, 0, 0, 0.02)),
    var(--pm-dark-panel);
  color: var(--pm-gold-bright);
  box-shadow:
    inset 0 1px 0 var(--pm-line-soft),
    inset 0 0 0 1px var(--pm-line-soft),
    0 8px 18px -10px rgba(0, 0, 0, 0.55);
}
.nav-item.active .nav-name {
  color: var(--pm-gold-bright);
}
.nav-item.active .nav-icon {
  color: var(--pm-gold-bright);
  background: var(--pm-grad-gold);
  border-color: var(--pm-line-bright);
}

.nav-icon {
  width: 34px;
  height: 34px;
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(243, 220, 162, 0.12), rgba(243, 220, 162, 0.04));
  border: 1px solid rgba(243, 220, 162, 0.22);
  display: grid;
  place-items: center;
  color: rgba(243, 220, 162, 0.85);
}
.nav-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.nav-name {
  font-family: var(--pm-font-display);
  font-size: calc(13.5px * var(--pm-text-scale));
  letter-spacing: 0.12em;
  font-weight: 600;
}
.nav-sub {
  font-size: calc(10.5px * var(--pm-text-scale));
  color: rgba(243, 220, 162, 0.55);
  letter-spacing: 0.05em;
}

.nav-badge {
  font-size: calc(10px * var(--pm-text-scale));
  padding: 2px 7px;
  border-radius: 999px;
  background: linear-gradient(180deg, #6a4f23, #2a1c11);
  border: 1px solid rgba(243, 220, 162, 0.35);
  color: rgba(243, 220, 162, 0.85);
  letter-spacing: 0.1em;
}
.nav-cursor {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 60%;
  background: linear-gradient(180deg, transparent, var(--pm-gold-bright), transparent);
  border-radius: 999px;
  transition: transform 0.25s ease;
}
.nav-item.active .nav-cursor {
  transform: translateY(-50%) scaleY(1);
}

.nav-group {
  min-height: 48px;
}

.sub-item {
  grid-template-columns: 28px 1fr auto;
  padding: 6px 8px;
  opacity: 0.92;
}

.sub-item .nav-icon {
  width: 28px;
  height: 28px;
}

.sub-item .nav-name {
  font-size: calc(12.5px * var(--pm-text-scale));
  letter-spacing: 0.08em;
}

.sub-item.quiet {
  opacity: 0.62;
}

.sub-item.quiet:not(.active) .nav-icon {
  background: rgba(255, 255, 255, 0.025);
}

@media (max-width: 980px) {
  .sidebar {
    flex-direction: row;
    overflow-x: auto;
    border-radius: 0;
    scrollbar-width: thin;
  }
  .scroll-top,
  .scroll-foot {
    display: none;
  }
  .nav {
    flex-direction: row;
    flex-wrap: nowrap;
    padding: 7px 8px;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .nav-item {
    grid-template-columns: 28px auto;
    flex: 0 0 auto;
    min-width: 0;
    padding: 6px 8px;
  }
  .sub-nav {
    display: contents;
  }
  .sub-item {
    border-style: dashed;
  }
  .nav-icon {
    width: 28px;
    height: 28px;
  }
  .nav-name {
    font-size: calc(12px * var(--pm-text-scale));
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .nav-sub {
    display: none;
  }
}

@media (max-width: 760px) {
  .sidebar {
    flex: 0 0 auto;
    min-height: 96px;
    max-height: 96px;
    width: 100%;
    overflow: hidden;
    border-top: 1px solid var(--pm-line-soft);
    box-shadow:
      inset 0 1px 0 var(--pm-line-faint),
      0 -10px 18px -14px rgba(0, 0, 0, 0.7);
  }
  .nav {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    grid-template-rows: 44px 34px;
    gap: 4px;
    padding: 5px 7px 6px;
    overflow: hidden;
  }
  .nav-item {
    grid-template-columns: 1fr;
    width: auto;
    min-width: 0;
    min-height: 44px;
    justify-items: center;
    justify-content: center;
    gap: 3px;
    padding: 5px 2px;
    border-radius: 4px;
  }
  .nav-item.active {
    box-shadow:
      inset 0 0 0 1px var(--pm-line-soft),
      0 8px 16px -12px rgba(0, 0, 0, 0.65);
  }
  .nav-cursor {
    left: 50%;
    top: auto;
    bottom: 0;
    width: 54%;
    height: 3px;
    transform: translateX(-50%) scaleX(0);
    background: linear-gradient(90deg, transparent, var(--pm-gold-bright), transparent);
  }
  .nav-item.active .nav-cursor {
    transform: translateX(-50%) scaleX(1);
  }
  .nav-icon {
    width: 27px;
    height: 25px;
  }
  .nav-text {
    display: block;
    text-align: center;
    max-width: 100%;
  }
  .nav-name {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: clip;
    white-space: nowrap;
    font-size: calc(10px * var(--pm-text-scale));
    letter-spacing: 0;
    line-height: 1.1;
  }
  .sub-nav {
    grid-column: 1 / -1;
    display: flex;
    min-width: 0;
    gap: 5px;
    margin: 0;
    padding: 1px 0 0;
    overflow-x: auto;
    border-left: 0;
    scrollbar-width: none;
  }
  .sub-nav::-webkit-scrollbar {
    display: none;
  }
  .sub-nav .nav-item {
    display: inline-flex;
    flex: 0 0 auto;
    width: auto;
    min-height: 30px;
    max-width: 104px;
    grid-template-columns: none;
    align-items: center;
    justify-content: center;
    padding: 4px 8px;
    border: 1px solid rgba(243, 220, 162, 0.22);
    background: rgba(12, 24, 10, 0.36);
  }
  .sub-nav .nav-item.active {
    border-color: rgba(214, 177, 84, 0.62);
    background: rgba(214, 177, 84, 0.18);
  }
  .sub-nav .nav-icon,
  .sub-nav .nav-sub,
  .sub-nav .nav-cursor {
    display: none;
  }
  .sub-nav .nav-name {
    max-width: 88px;
    font-size: calc(10.5px * var(--pm-text-scale));
    line-height: 1.15;
    text-overflow: ellipsis;
  }
  .nav-sub {
    display: none;
  }
}
</style>
