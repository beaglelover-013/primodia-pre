<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGameStore } from '../stores/game';
import CalendarPopover from './CalendarPopover.vue';
import PmIcon from './PmIcon.vue';

const game = useGameStore();

const weatherTone = computed(() => {
  switch (game.calendar.weatherIcon) {
    case 'sun':
      return '#f0d488';
    case 'cloud':
      return '#c9c2b3';
    case 'rain':
      return '#8db7c9';
    case 'snow':
      return '#dde6ec';
    case 'moon':
      return '#bcaedd';
    default:
      return '#f0d488';
  }
});
const placeText = computed(() => {
  return game.location.place || '主厅';
});
const canRerollWeather = computed(() => game.weatherLibraryStats().currentMonthCount > 0);
const activeTemporaryStates = computed(() => game.flattenTemporaryStates().slice(0, 4));
const isCalendarOpen = ref(false);
const calendarAnchor = ref<HTMLElement | null>(null);

function closeCalendar() {
  isCalendarOpen.value = false;
}

function handleDocumentClick(event: MouseEvent) {
  if (!isCalendarOpen.value) return;
  const target = event.target;
  if (target instanceof Node && calendarAnchor.value?.contains(target)) return;
  closeCalendar();
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') closeCalendar();
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleEscape);
});
</script>

<template>
  <header class="hud">
    <!-- 左: Logo + 日期 -->
    <div class="hud-left">
      <div class="hud-brand">
        <span class="brand-emblem" aria-hidden="true">
          <PmIcon name="flourish" :size="22" />
        </span>
        <div class="brand-text">
          <span class="brand-title">普利莫迪亚 编年录</span>
          <span class="brand-sub">PRIMORDIA · CHRONICLES</span>
        </div>
      </div>
      <div ref="calendarAnchor" class="hud-date-shell">
      <button
        class="hud-date"
        type="button"
        :title="`${game.clockText} · 打开日历`"
        @click.stop="isCalendarOpen = !isCalendarOpen"
      >
        <PmIcon name="sun" :size="14" />
        <span>{{ game.dateText }}</span>
        <span v-if="game.isMarketDay" class="market-day-tag">市日</span>
        <small>{{ game.clockText }}</small>
      </button>
      <CalendarPopover v-if="isCalendarOpen" class="hud-calendar-popover" />
      </div>
    </div>

    <!-- 中: 天气 + 位置 -->
    <div class="hud-center">
      <div class="hud-pill weather" :style="{ color: weatherTone }" :title="game.calendar.weatherDescription || game.calendar.weather">
        <PmIcon :name="game.calendar.weatherIcon" :size="16" />
        <span>{{ game.calendar.weather }}</span>
        <button
          class="weather-roll"
          type="button"
          :title="canRerollWeather ? '重骰今日天气' : '当前月份缺少世界书天气池'"
          aria-label="重骰今日天气"
          :disabled="!canRerollWeather"
          @click.stop="game.rerollTodayWeather()"
        >
          <PmIcon name="dice" :size="13" />
        </button>
      </div>
      <div class="hud-pill">
        <PmIcon name="pin" :size="16" />
        <span>{{ game.location.region }} · {{ placeText }}</span>
      </div>
      <div v-if="activeTemporaryStates.length" class="state-strip" title="当前有效临时状态">
        <span
          v-for="state in activeTemporaryStates"
          :key="`${state.targetType}-${state.targetName}-${state.名称}`"
          class="state-chip"
        >
          {{ state.名称 }} · {{ state.targetName }} · {{ state.剩余回合 }}回合
        </span>
      </div>
    </div>

    <!-- 右: 多币种 + 声望 + 精力 -->
    <div class="hud-right">
      <div id="hud-currency" class="coins" :title="`随身钱袋 ${game.walletText}；钱匣 ${game.cashboxText}；合计 ${game.treasuryText}`">
        <span class="fund-chip wallet">
          <PmIcon name="coin" :size="13" />
          随身 {{ game.walletText }}
        </span>
        <span class="fund-chip cashbox">
          <PmIcon name="ledger" :size="13" />
          钱匣 {{ game.cashboxText }}
        </span>
        <span class="coin mithril" :class="{ empty: !game.treasuryParts.mithril }" title="秘银">
          <i></i>{{ game.treasuryParts.mithril }}
        </span>
        <span class="coin platinum" :class="{ empty: !game.treasuryParts.platinum }" title="铂金">
          <i></i>{{ game.treasuryParts.platinum }}
        </span>
        <span class="coin gold" :class="{ empty: !game.treasuryParts.gold }" title="金">
          <i></i>{{ game.treasuryParts.gold }}
        </span>
        <span class="coin silver" :class="{ empty: !game.treasuryParts.silver }" title="银">
          <i></i>{{ game.treasuryParts.silver }}
        </span>
        <span class="coin copper" title="铜">
          <i></i>{{ game.treasuryParts.copper }}
        </span>
      </div>

    </div>
  </header>
</template>

<style scoped>
.hud {
  position: relative;
  z-index: 6200;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr);
  align-items: center;
  gap: 18px;
  padding: 10px 22px;
  background: var(--pm-top-bg);
  border-bottom: 1px solid var(--pm-edge-soft);
  box-shadow:
    inset 0 -1px 0 var(--pm-line-faint),
    0 6px 18px -8px rgba(0, 0, 0, 0.55);
  color: var(--pm-parch);
  font-family: var(--pm-font-body);
}
.hud::before,
.hud::after {
  content: '';
  position: absolute;
  height: 1px;
  left: 22px;
  right: 22px;
  background: linear-gradient(90deg, transparent, var(--pm-line-bright), transparent);
  pointer-events: none;
}
.hud::before {
  top: 4px;
}
.hud::after {
  bottom: 4px;
}

/* 左: 品牌 + 日期 */
.hud-left {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.hud-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-emblem {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--pm-grad-gold);
  border: 1px solid var(--pm-line-bright);
  color: var(--pm-gold-bright);
  box-shadow:
    inset 0 1px 0 var(--pm-line-soft),
    0 6px 18px -6px rgba(0, 0, 0, 0.65);
  animation: pmCandle 5.5s ease-in-out infinite;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.brand-title {
  font-family: var(--pm-font-display);
  font-size: calc(18px * var(--pm-text-scale));
  letter-spacing: 0.18em;
  color: var(--pm-gold-bright);
}
.brand-sub {
  font-family: var(--pm-font-display);
  font-size: calc(10px * var(--pm-text-scale));
  letter-spacing: 0.45em;
  color: var(--pm-gold);
}

.hud-date-shell {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.hud-date {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  color: var(--pm-parch-soft);
  background: transparent;
  border: 0;
  font: inherit;
  font-size: calc(12.5px * var(--pm-text-scale));
  letter-spacing: 0.04em;
  cursor: pointer;
  text-align: left;
}
.hud-date:hover {
  color: var(--pm-gold-bright);
}
.hud-calendar-popover {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 6300;
}
.hud-date small {
  padding-left: 2px;
  font-size: calc(10.5px * var(--pm-text-scale));
  color: var(--pm-parch-soft);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.market-day-tag {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--pm-gold-bright) 58%, transparent);
  border-radius: 999px;
  background:
    radial-gradient(circle at 22% 18%, rgba(255, 244, 182, 0.65), transparent 36%),
    color-mix(in srgb, var(--pm-gold) 36%, var(--pm-dark-panel-solid));
  color: var(--pm-gold-bright);
  box-shadow:
    inset 0 1px 0 rgba(255, 243, 191, 0.25),
    0 1px 6px rgba(0, 0, 0, 0.18);
  font-family: var(--pm-font-display);
  font-size: calc(10px * var(--pm-text-scale));
  font-weight: 700;
  letter-spacing: 0.14em;
  white-space: nowrap;
}

/* 中: 天气 + 位置 */
.hud-center {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.hud-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--pm-dark-panel-soft);
  border: 1px solid var(--pm-line-soft);
  font-size: calc(12.5px * var(--pm-text-scale));
  color: var(--pm-parch);
  letter-spacing: 0.04em;
}
.hud-pill.weather {
  background: var(--pm-dark-panel-soft);
}
.weather-roll {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin: -3px -7px -3px 2px;
  border: 1px solid var(--pm-line-soft);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.16);
  color: currentColor;
  cursor: pointer;
}
.weather-roll:hover {
  background: var(--pm-dark-panel-soft);
  border-color: var(--pm-line-bright);
}
.weather-roll:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.state-strip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(520px, 46vw);
  overflow-x: auto;
  scrollbar-width: none;
}
.state-strip::-webkit-scrollbar {
  display: none;
}
.state-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--pm-gold) 48%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--pm-gold) 16%, var(--pm-dark-panel-soft));
  color: var(--pm-gold-bright);
  font-size: calc(11px * var(--pm-text-scale));
  white-space: nowrap;
}

/* 右: 货币 + 状态条 */
.hud-right {
  display: flex;
  align-items: center;
  gap: 14px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.coins {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.coin {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px 3px 6px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.55);
  background: var(--pm-dark-panel);
  font-family: var(--pm-font-num);
  font-size: calc(12.5px * var(--pm-text-scale));
  color: var(--pm-parch-bright);
  letter-spacing: 0.04em;
  transition:
    opacity 0.18s ease,
    filter 0.18s ease,
    border-color 0.18s ease;
}
.fund-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--pm-gold) 44%, transparent);
  background: color-mix(in srgb, var(--pm-dark-panel-solid) 82%, var(--pm-gold) 18%);
  color: var(--pm-gold-bright);
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  white-space: nowrap;
}
.fund-chip.cashbox {
  color: var(--pm-parch-bright);
  border-color: color-mix(in srgb, var(--pm-parch-soft) 28%, transparent);
}
.coin.empty {
  opacity: 0.46;
  filter: saturate(0.65);
  border-color: var(--pm-line-faint);
}
.coin i {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.45);
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.6), rgba(0, 0, 0, 0) 60%),
    linear-gradient(180deg, var(--c1), var(--c2));
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
  flex: none;
}
.coin.copper {
  --c1: #d2884d;
  --c2: #8b4a1e;
}
.coin.silver {
  --c1: #e8e6e0;
  --c2: #9aa0a4;
}
.coin.gold {
  --c1: #f3da90;
  --c2: #c9a04a;
}
.coin.platinum {
  --c1: #fff8ea;
  --c2: #d8c7a8;
}
.coin.mithril {
  --c1: #e6f4ff;
  --c2: #6d9bd4;
}

@media (max-width: 1080px) {
  .hud {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px 12px;
    padding: 8px 14px;
    text-align: left;
  }
  .hud-center {
    grid-column: 1 / -1;
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .hud-left {
    grid-column: 1 / -1;
    min-width: 0;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .hud-right {
    justify-content: flex-end;
    flex-wrap: nowrap;
  }
  .brand-text {
    align-items: flex-start;
  }
  .hud-date-shell {
    flex-basis: 100%;
    padding-left: 50px;
  }
}

@media (max-width: 760px) {
  .hud {
    grid-template-columns: 1fr;
    gap: 5px;
    padding: 7px 9px;
  }
  .hud::before,
  .hud::after {
    left: 9px;
    right: 9px;
  }
  .hud-left {
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    min-width: 0;
  }
  .hud-brand {
    min-width: 0;
    flex: 0 1 auto;
  }
  .hud-right {
    justify-content: flex-start;
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
  }
  .hud-right::-webkit-scrollbar,
  .hud-center::-webkit-scrollbar {
    display: none;
  }
  .hud-center {
    justify-content: flex-start;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 6px;
    padding-bottom: 0;
  }
  .brand-emblem {
    width: 30px;
    height: 30px;
  }
  .brand-title {
    max-width: 170px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: calc(13px * var(--pm-text-scale));
    letter-spacing: 0.06em;
  }
  .brand-sub {
    display: none;
  }
  .hud-date-shell {
    min-width: 0;
    padding-left: 0;
  }
  .hud-date {
    width: 100%;
    overflow: hidden;
    font-size: calc(10.5px * var(--pm-text-scale));
    white-space: normal;
    line-height: 1.35;
    text-overflow: ellipsis;
  }
  .hud-calendar-popover {
    position: fixed;
    top: auto;
    left: 10px;
  }
  .hud-date small {
    font-size: calc(10px * var(--pm-text-scale));
  }
  .hud-pill {
    padding: 4px 9px;
    font-size: calc(11px * var(--pm-text-scale));
    white-space: nowrap;
  }
  .state-strip {
    max-width: none;
  }
  .fund-chip {
    min-height: 22px;
    padding: 2px 7px;
    font-size: calc(10px * var(--pm-text-scale));
  }
  .coin {
    display: none;
    padding: 2px 7px 2px 5px;
  }
}
</style>
