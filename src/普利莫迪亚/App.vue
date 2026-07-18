<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useGameStore } from './stores/game';
import TopHud from './components/TopHud.vue';
import Sidebar from './components/Sidebar.vue';
import BottomDock from './components/BottomDock.vue';
import PmIcon from './components/PmIcon.vue';
import ServiceTray from './components/ServiceTray.vue';
import OpeningWorkshop from './components/OpeningWorkshop.vue';

import ChroniclePage from './pages/ChroniclePage.vue';
import TavernPage from './pages/TavernPage.vue';
import OperationsPage from './pages/OperationsPage.vue';
import RegularGuestsPage from './pages/RegularGuestsPage.vue';
import ProtagonistPage from './pages/ProtagonistPage.vue';
import InventoryPage from './pages/InventoryPage.vue';
import RecipesPage from './pages/RecipesPage.vue';
import CharactersPage from './pages/CharactersPage.vue';
import GalleryPage from './pages/GalleryPage.vue';
import MapPage from './pages/MapPage.vue';
import ShopPage from './pages/ShopPage.vue';
import LedgerPage from './pages/LedgerPage.vue';
import FarmBrewPage from './pages/FarmBrewPage.vue';
import VariablesPage from './pages/VariablesPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import { activateSameFloorMode } from './utils/sameFloor';

const game = useGameStore();

let hostFrameObserver: ResizeObserver | null = null;
let hostFrameRaf = 0;
let deactivateSameFloorMode: (() => void) | undefined;
let authoritativeRefreshTimers: number[] = [];
const mvuEventStops: EventOnReturn[] = [];
let mvuEventsRegistered = false;

function stopEventListeners(stops: EventOnReturn[]) {
  stops.forEach(stop => {
    const maybeFunction = stop as unknown as () => void;
    if (typeof maybeFunction === 'function') maybeFunction();
    else stop.stop();
  });
  stops.length = 0;
}

async function refreshAuthoritativeState(options: { clearMissingShop?: boolean } = {}) {
  if (game.isGenerating) return;
  if (typeof waitGlobalInitialized === 'function') {
    try {
      await Promise.race([
        waitGlobalInitialized('Mvu'),
        new Promise(resolve => window.setTimeout(resolve, 800)),
      ]);
    } catch {
      // MVU may be absent on empty/new chats; fall through to the normal recovery paths.
    }
  }
  const loadedFromSave = game.restoreFromChatSave();
  const loadedFromMvu = game.loadFromMvu({ force: true });
  const loadedFromLatestPatch = await game.loadFromLatestAssistantPatch({ force: true });
  game.evaluateOpeningRequirement({ loadedFromMvu, loadedFromLatestPatch, loadedFromSave });
  game.restoreGeneratedShopFromLatestMessage({ clearWhenMissing: options.clearMissingShop });
  nextTick(scheduleHostFrameSize);
}

function syncHostFrameSize() {
  if (document.fullscreenElement || document.body.classList.contains('pm-focus-mode')) return;
  const frame = window.frameElement as HTMLElement | null;
  if (!frame) return;

  const frameWidth =
    frame.getBoundingClientRect().width ||
    frame.parentElement?.getBoundingClientRect().width ||
    document.documentElement.clientWidth ||
    900;
  const targetHeight = Math.round(Math.max(760, Math.min(1180, frameWidth * 1.05)));
  frame.style.display = 'block';
  frame.style.width = '100%';
  frame.style.maxWidth = '100%';
  frame.style.height = `${targetHeight}px`;
  frame.style.minHeight = '0';
  frame.style.border = '0';
  frame.style.overflow = 'hidden';
}

function scheduleHostFrameSize() {
  cancelAnimationFrame(hostFrameRaf);
  hostFrameRaf = requestAnimationFrame(syncHostFrameSize);
}

function scheduleAuthoritativeStateRetries() {
  authoritativeRefreshTimers.forEach(timer => window.clearTimeout(timer));
  authoritativeRefreshTimers = [120, 420, 1000, 1800].map(delay =>
    window.setTimeout(() => {
      refreshAuthoritativeState({ clearMissingShop: true });
    }, delay),
  );
}

async function registerMvuStateSyncEvents() {
  if (mvuEventsRegistered || typeof eventOn !== 'function') return;

  try {
    const mvu = typeof waitGlobalInitialized === 'function'
      ? await Promise.race([
          waitGlobalInitialized<typeof Mvu>('Mvu'),
          new Promise<undefined>(resolve => window.setTimeout(() => resolve(undefined), 2500)),
        ])
      : (typeof Mvu !== 'undefined' ? Mvu : undefined);

    if (!mvu?.events) return;
    mvuEventsRegistered = true;
    mvuEventStops.push(
      eventOn(mvu.events.VARIABLE_INITIALIZED, () => {
        refreshAuthoritativeState({ clearMissingShop: true });
      }),
      eventOn(mvu.events.VARIABLE_UPDATE_ENDED, () => {
        refreshAuthoritativeState({ clearMissingShop: true });
      }),
    );
  } catch (error) {
    console.warn('[primordia] MVU 状态同步事件注册失败:', error);
  }
}

function canScrollInDirection(element: HTMLElement, deltaY: number) {
  const style = window.getComputedStyle(element);
  if (!/(auto|scroll)/.test(style.overflowY)) return false;
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  if (deltaY > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  if (deltaY < 0) return element.scrollTop > 0;
  return false;
}

function findNestedScrollable(target: EventTarget | null, deltaY: number) {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element.id !== 'pm-app') {
    if (canScrollInDirection(element, deltaY)) return element;
    element = element.parentElement;
  }
  return null;
}

function scrollElementBy(element: HTMLElement | null | undefined, event: WheelEvent) {
  if (!element) return false;
  const beforeTop = element.scrollTop;
  const beforeLeft = element.scrollLeft;
  element.scrollTop += event.deltaY;
  element.scrollLeft += event.deltaX;
  return element.scrollTop !== beforeTop || element.scrollLeft !== beforeLeft;
}

function scrollLocalDocument(event: WheelEvent) {
  const target = (document.scrollingElement as HTMLElement | null) ?? document.documentElement ?? document.body;
  return scrollElementBy(target, event);
}

function scrollParentDocument(event: WheelEvent) {
  try {
    const parentDoc = window.parent?.document;
    if (!parentDoc || parentDoc === document) return false;
    const target = (parentDoc.scrollingElement as HTMLElement | null) ?? parentDoc.documentElement ?? parentDoc.body;
    return scrollElementBy(target, event);
  } catch {
    return false;
  }
}

function handleAppWheel(event: WheelEvent) {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target || target.closest('input, textarea, select, [contenteditable="true"]')) return;

  const nested = findNestedScrollable(target, event.deltaY);
  if (nested && scrollElementBy(nested, event)) {
    event.preventDefault();
    return;
  }

  const content = document.querySelector<HTMLElement>('.pm-content');
  if (scrollElementBy(content, event)) {
    event.preventDefault();
    return;
  }

  if (content && content.contains(target)) {
    event.preventDefault();
    return;
  }

  let curr = target;
  while (curr && curr.id !== 'pm-app') {
    const style = window.getComputedStyle(curr);
    if (/(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX)) {
      event.preventDefault();
      return;
    }
    curr = curr.parentElement;
  }

  if (scrollLocalDocument(event) || scrollParentDocument(event)) {
    event.preventDefault();
  }
}

onMounted(() => {
  deactivateSameFloorMode = activateSameFloorMode();
  window.addEventListener('wheel', handleAppWheel, { capture: true, passive: false });
  window.addEventListener('resize', scheduleHostFrameSize, { passive: true });
  nextTick(() => {
    const app = document.getElementById('pm-app');
    if (app && typeof ResizeObserver !== 'undefined') {
      hostFrameObserver = new ResizeObserver(scheduleHostFrameSize);
      hostFrameObserver.observe(app);
      const shell = document.querySelector<HTMLElement>('.pm-shell');
      if (shell) hostFrameObserver.observe(shell);
    }
    scheduleHostFrameSize();
  });
  refreshAuthoritativeState({ clearMissingShop: true });
  scheduleAuthoritativeStateRetries();
  void registerMvuStateSyncEvents();
  if (typeof eventOn !== 'function' || typeof tavern_events === 'undefined') return;
  eventOn(tavern_events.USER_MESSAGE_RENDERED, refreshAuthoritativeState);
  eventOn(tavern_events.MESSAGE_RECEIVED, refreshAuthoritativeState);
  eventOn(tavern_events.MESSAGE_UPDATED, refreshAuthoritativeState);
  eventOn(tavern_events.MESSAGE_EDITED, refreshAuthoritativeState);
  eventOn(tavern_events.MESSAGE_SWIPED, () => refreshAuthoritativeState({ clearMissingShop: true }));
  eventOn(tavern_events.CHAT_CHANGED, () => refreshAuthoritativeState({ clearMissingShop: true }));
  eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, refreshAuthoritativeState);
});

onUnmounted(() => {
  deactivateSameFloorMode?.();
  deactivateSameFloorMode = undefined;
  window.removeEventListener('wheel', handleAppWheel, { capture: true });
  window.removeEventListener('resize', scheduleHostFrameSize);
  authoritativeRefreshTimers.forEach(timer => window.clearTimeout(timer));
  authoritativeRefreshTimers = [];
  stopEventListeners(mvuEventStops);
  mvuEventsRegistered = false;
  cancelAnimationFrame(hostFrameRaf);
  hostFrameObserver?.disconnect();
  hostFrameObserver = null;
});

const tabComponent = computed(() => {
  switch (game.currentTab) {
    case 'opening':
      return OpeningWorkshop;
    case 'chronicle':
      return ChroniclePage;
    case 'tavern':
      return TavernPage;
    case 'operations':
      return OperationsPage;
    case 'regularGuests':
      return RegularGuestsPage;
    case 'protagonist':
      return ProtagonistPage;
    case 'inventory':
      return InventoryPage;
    case 'recipes':
      return RecipesPage;
    case 'characters':
      return CharactersPage;
    case 'gallery':
      return GalleryPage;
    case 'map':
      return MapPage;
    case 'shop':
      return ShopPage;
    case 'ledger':
      return LedgerPage;
    case 'farm':
      return FarmBrewPage;
    case 'variables':
      return VariablesPage;
    case 'settings':
      return SettingsPage;
    default:
      return InventoryPage;
  }
});

const tabTitle = computed(
  () =>
    ({
      opening: '开场选择',
      chronicle: '编年录 · 正文',
      tavern: '酒馆 · 八区域',
      operations: '经营附录',
      regularGuests: '常客簿',
      protagonist: '主角档案',
      inventory: '行囊与库房',
      recipes: '配方簿',
      characters: '人物羁绊',
      gallery: '图册画廊',
      map: '大地图 · 普利莫迪亚',
      shop: '街坊商铺',
      ledger: '账单',
      farm: '农田与酒窖',
      variables: '变量总览',
      settings: '系统与设置',
    })[game.currentTab],
);
</script>

<template>
  <div id="pm-app" class="pm-app">
    <!-- 角花装饰 -->
    <svg class="pm-corner tl" viewBox="0 0 64 64">
      <path
        d="M2 2h14c0 6 4 10 10 10h6c0-6 4-10 10-10h20v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10H2V2z"
        fill="currentColor"
      />
    </svg>
    <svg class="pm-corner tr" viewBox="0 0 64 64">
      <path
        d="M2 2h14c0 6 4 10 10 10h6c0-6 4-10 10-10h20v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10H2V2z"
        fill="currentColor"
      />
    </svg>
    <svg class="pm-corner bl" viewBox="0 0 64 64">
      <path
        d="M2 2h14c0 6 4 10 10 10h6c0-6 4-10 10-10h20v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10H2V2z"
        fill="currentColor"
      />
    </svg>
    <svg class="pm-corner br" viewBox="0 0 64 64">
      <path
        d="M2 2h14c0 6 4 10 10 10h6c0-6 4-10 10-10h20v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10v6c-6 0-10 4-10 10H2V2z"
        fill="currentColor"
      />
    </svg>

    <div class="pm-shell">
      <TopHud />

      <div class="pm-main">
        <Sidebar />
        <div class="pm-content">
          <!-- 面包屑 + 章节标题 -->
          <div class="crumbs">
            <span class="crumb-dot">
              <PmIcon name="flourish" :size="14" />
            </span>
            <span class="crumb">普利莫迪亚编年录</span>
            <span class="sep">›</span>
            <span class="crumb dim">{{ game.tavernName }} · 墨迹页</span>
            <span class="sep">›</span>
            <span class="crumb gold">{{ tabTitle }}</span>
          </div>

          <Transition name="pm-fade" mode="out-in">
            <component :is="tabComponent" :key="game.currentTab" />
          </Transition>
        </div>
      </div>

      <BottomDock />
    </div>

    <ServiceTray />
  </div>
</template>

<style scoped>
.crumbs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--pm-dark-panel);
  border: 1px solid var(--pm-dark-panel-border);
  width: max-content;
  max-width: 100%;
  font-family: var(--pm-font-display);
  font-size: calc(12px * var(--pm-text-scale));
  letter-spacing: 0.08em;
  color: var(--pm-parch);
  align-self: flex-start;
}
.crumb-dot {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: var(--pm-dark-panel-solid);
  border: 1px solid var(--pm-dark-panel-border);
  display: grid;
  place-items: center;
  color: var(--pm-gold-bright);
}
.crumb {
  color: var(--pm-parch);
}
.crumb.dim {
  color: var(--pm-parch-soft);
}
.crumb.gold {
  color: var(--pm-gold-bright);
}
.sep {
  color: var(--pm-line-soft);
}

@media (max-width: 760px) {
  .crumbs {
    display: none;
  }
}
</style>
