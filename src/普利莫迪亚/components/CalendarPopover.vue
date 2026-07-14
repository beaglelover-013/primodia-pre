<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGameStore, type PromiseMemo } from '../stores/game';

const game = useGameStore();
const selectedDay = ref(game.calendar.day);

const monthDays = Array.from({ length: 30 }, (_, index) => index + 1);
const weekHeaders = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function parseTriggerTime(triggerTime: string) {
  const match = triggerTime.trim().match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const year = Math.max(1, Math.floor(Number(match[1]) || 0));
  const monthIndex = Math.max(0, Math.min(11, Math.floor(Number(match[2]) || 1) - 1));
  const day = Math.max(1, Math.min(30, Math.floor(Number(match[3]) || 1)));
  const hour = Math.max(0, Math.min(23, Math.floor(Number(match[4]) || 0)));
  const minute = Math.max(0, Math.min(59, Math.floor(Number(match[5]) || 0)));
  return {
    year,
    monthIndex,
    day,
    clock: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    serialMinute: (year * 12 * 30 + monthIndex * 30 + day) * 24 * 60 + hour * 60 + minute,
  };
}

function serialDayOf(day: number) {
  return game.calendar.year * 12 * 30 + game.calendar.monthIndex * 30 + day;
}

function weekIndexOf(day: number) {
  return Math.max(0, (serialDayOf(day) - 1) % 7);
}

function isMarketDayOf(day: number) {
  return weekIndexOf(day) === 4;
}

const leadingBlankDays = computed(() => Array.from({ length: weekIndexOf(1) }, (_, index) => index));

const currentSerialMinute = computed(() => {
  const [hourText, minuteText] = game.calendar.clock.split(':');
  const hour = Math.max(0, Math.min(23, Math.floor(Number(hourText) || 0)));
  const minute = Math.max(0, Math.min(59, Math.floor(Number(minuteText) || 0)));
  return (game.calendar.year * 12 * 30 + game.calendar.monthIndex * 30 + game.calendar.day) * 24 * 60 + hour * 60 + minute;
});

const pendingMemos = computed(() => game.promiseMemos.filter(memo => memo.status === 'pending'));

const normalizedMemos = computed(() =>
  pendingMemos.value.map(memo => ({ memo, trigger: parseTriggerTime(memo.triggerTime) })),
);

const currentMonthMemos = computed(() =>
  normalizedMemos.value.filter(item =>
    item.trigger &&
    item.trigger.year === game.calendar.year &&
    item.trigger.monthIndex === game.calendar.monthIndex,
  ),
);

const futureMemos = computed(() =>
  normalizedMemos.value
    .filter(item => item.trigger && item.trigger.serialMinute > currentSerialMinute.value)
    .filter(item => item.trigger!.year !== game.calendar.year || item.trigger!.monthIndex !== game.calendar.monthIndex)
    .sort((a, b) => a.trigger!.serialMinute - b.trigger!.serialMinute)
    .slice(0, 8),
);

const invalidMemos = computed(() => normalizedMemos.value.filter(item => !item.trigger));

const selectedDayMemos = computed(() =>
  currentMonthMemos.value
    .filter(item => item.trigger?.day === selectedDay.value)
    .sort((a, b) => a.trigger!.serialMinute - b.trigger!.serialMinute),
);

const selectedDayEvents = computed(() => game.calendarEventsForDay(game.calendar.monthIndex, selectedDay.value));

function memosForDay(day: number) {
  return currentMonthMemos.value.filter(item => item.trigger?.day === day);
}

function eventsForDay(day: number) {
  return game.calendarEventsForDay(game.calendar.monthIndex, day);
}

function calendarItemCount(day: number) {
  return memosForDay(day).length + eventsForDay(day).length;
}

function isDayDue(day: number) {
  return memosForDay(day).some(item => item.trigger && item.trigger.serialMinute <= currentSerialMinute.value);
}

function peopleText(memo: PromiseMemo) {
  return memo.people.length ? memo.people.join('、') : '未标注人物';
}

function reminderPreview(memo: PromiseMemo, limit = 72) {
  const text = (memo.reminder || memo.event || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function formatTrigger(item: { trigger: ReturnType<typeof parseTriggerTime> }) {
  if (!item.trigger) return '时间未定位';
  return `${item.trigger.year}-${String(item.trigger.monthIndex + 1).padStart(2, '0')}-${String(item.trigger.day).padStart(2, '0')} ${item.trigger.clock}`;
}

async function copyMemo(memo: PromiseMemo) {
  const text = memo.reminder || memo.event;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error('clipboard unavailable');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  game.pushLog('系统', '约定提醒已复制。');
}
</script>

<template>
  <section class="calendar-popover" aria-label="约定日历">
    <header class="calendar-head">
      <div>
        <p>CALENDAR</p>
        <h2>{{ game.months[game.calendar.monthIndex] }} · 第 {{ game.calendar.day }} 日</h2>
      </div>
      <span>{{ game.calendar.year }}</span>
    </header>

    <div class="calendar-grid">
      <div
        v-for="(header, index) in weekHeaders"
        :key="header"
        class="calendar-weekday"
        :class="{ market: index === 4 }"
      >
        <span>{{ header }}</span>
        <small v-if="index === 4">市日</small>
      </div>
      <div
        v-for="blank in leadingBlankDays"
        :key="`blank-${blank}`"
        class="calendar-blank"
        aria-hidden="true"
      />
      <button
        v-for="day in monthDays"
        :key="day"
        class="calendar-day"
        :class="{
          today: day === game.calendar.day,
          selected: day === selectedDay,
          has: calendarItemCount(day) > 0,
          due: isDayDue(day),
          market: isMarketDayOf(day),
        }"
        type="button"
        @click="selectedDay = day"
      >
        <span>{{ day }}</span>
        <em v-if="isMarketDayOf(day)">市日</em>
        <em v-if="eventsForDay(day).length">{{ eventsForDay(day)[0].name }}</em>
        <b v-if="day === game.calendar.day && game.calendar.weather !== '未设天气'">{{ game.calendar.weather }}</b>
        <small v-if="calendarItemCount(day)">{{ calendarItemCount(day) }}</small>
      </button>
    </div>

    <div class="calendar-panels">
      <section class="calendar-panel">
        <h3>第 {{ selectedDay }} 日 · {{ weekHeaders[weekIndexOf(selectedDay)] }}{{ isMarketDayOf(selectedDay) ? ' · 市日' : '' }}</h3>
        <p v-if="!selectedDayMemos.length && !selectedDayEvents.length" class="calendar-empty">这一天暂无待处理约定或日历事件。</p>
        <article
          v-for="event in selectedDayEvents"
          :key="event.id"
          class="calendar-memo festival"
        >
          <header>
            <strong>{{ event.name }}</strong>
            <span>{{ event.kind }}</span>
          </header>
          <p class="calendar-time">{{ game.months[event.monthIndex] }} 第{{ event.day }}日 · {{ event.source }}</p>
          <p>{{ reminderPreview({ reminder: event.reminder, event: event.event } as PromiseMemo, 140) }}</p>
        </article>
        <article
          v-for="item in selectedDayMemos"
          :key="item.memo.id"
          class="calendar-memo"
          :class="{ due: item.trigger && item.trigger.serialMinute <= currentSerialMinute }"
        >
          <header>
            <strong>{{ item.memo.name }}</strong>
            <span>{{ item.trigger && item.trigger.serialMinute <= currentSerialMinute ? '已到点' : '待触发' }}</span>
          </header>
          <p class="calendar-time">{{ formatTrigger(item) }} · {{ peopleText(item.memo) }}</p>
          <p>{{ reminderPreview(item.memo, 120) }}</p>
          <div class="calendar-actions">
            <button type="button" @click="copyMemo(item.memo)">复制</button>
            <button type="button" @click="game.updatePromiseMemoStatus(item.memo.id, 'resolved')">解决</button>
            <button type="button" @click="game.updatePromiseMemoStatus(item.memo.id, 'cancelled')">取消</button>
          </div>
        </article>
      </section>

      <section class="calendar-panel compact">
        <h3>后续约定</h3>
        <p v-if="!futureMemos.length" class="calendar-empty">暂无更远日期的待处理约定。</p>
        <article v-for="item in futureMemos" :key="item.memo.id" class="calendar-mini">
          <strong>{{ item.memo.name }}</strong>
          <span>{{ formatTrigger(item) }}</span>
          <p>{{ reminderPreview(item.memo) }}</p>
        </article>
      </section>

      <section v-if="invalidMemos.length" class="calendar-panel compact warn">
        <h3>未定位约定</h3>
        <article v-for="item in invalidMemos" :key="item.memo.id" class="calendar-mini">
          <strong>{{ item.memo.name }}</strong>
          <span>{{ item.memo.triggerTime || '缺少触发时间' }}</span>
          <p>{{ reminderPreview(item.memo) }}</p>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.calendar-popover {
  position: relative;
  z-index: 1;
  isolation: isolate;
  width: min(760px, calc(100vw - 28px));
  max-height: min(78vh, 720px);
  overflow: auto;
  padding: 14px;
  color: var(--pm-ink);
  background:
    radial-gradient(circle at 16% 8%, rgba(255, 255, 255, 0.22), transparent 34%),
    linear-gradient(180deg, var(--pm-parch-bright), var(--pm-parch)),
    var(--pm-paper-bg);
  border: 1px solid var(--pm-line);
  border-radius: 8px;
  box-shadow:
    0 28px 70px rgba(0, 0, 0, 0.68),
    0 0 0 1px color-mix(in srgb, var(--pm-gold) 20%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--pm-parch-bright) 74%, transparent),
    inset 0 0 42px color-mix(in srgb, var(--pm-shadow-warm) 22%, transparent);
}
.calendar-popover::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--pm-line-faint) 16%, transparent) 25%, transparent 25%) 0 0 / 12px 12px,
    linear-gradient(225deg, color-mix(in srgb, var(--pm-line-faint) 12%, transparent) 25%, transparent 25%) 0 0 / 12px 12px,
    var(--pm-parch);
}
.calendar-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--pm-line-faint);
}
.calendar-head p,
.calendar-head h2 {
  margin: 0;
}
.calendar-head p {
  color: var(--pm-gold);
  font-size: calc(10px * var(--pm-text-scale));
  letter-spacing: 0.28em;
  font-weight: 800;
}
.calendar-head h2 {
  margin-top: 3px;
  font-family: var(--pm-font-display);
  font-size: calc(20px * var(--pm-text-scale));
  color: var(--pm-ink);
  font-weight: 700;
}
.calendar-head > span {
  padding: 4px 9px;
  color: var(--pm-text-on-gold);
  background: var(--pm-grad-gold);
  border-radius: 999px;
  font-weight: 700;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  margin: 12px 0;
}
.calendar-weekday {
  display: grid;
  min-height: 30px;
  place-items: center;
  gap: 1px;
  color: var(--pm-ink);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--pm-gold) 34%, var(--pm-parch-bright)), color-mix(in srgb, var(--pm-gold) 22%, var(--pm-parch)));
  border: 1px solid color-mix(in srgb, var(--pm-line) 72%, transparent);
  border-radius: 5px;
  font-size: calc(12px * var(--pm-text-scale));
  font-weight: 700;
}
.calendar-weekday small {
  color: var(--pm-gold-dim);
  font-size: calc(10px * var(--pm-text-scale));
  font-weight: 800;
}
.calendar-weekday.market {
  color: var(--pm-text-on-gold);
  background: var(--pm-grad-gold);
  border-color: color-mix(in srgb, var(--pm-gold-bright) 70%, transparent);
}
.calendar-blank {
  min-height: 54px;
  border: 1px dashed var(--pm-line-faint);
  border-radius: 6px;
  background: color-mix(in srgb, var(--pm-parch-bright) 42%, transparent);
}
.calendar-day {
  position: relative;
  display: grid;
  align-content: start;
  gap: 3px;
  min-height: 62px;
  padding: 8px;
  color: var(--pm-ink-soft);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--pm-parch-bright) 86%, white), var(--pm-parch));
  border: 1px solid var(--pm-line-soft);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--pm-parch-bright) 80%, transparent);
}
.calendar-day > span {
  color: var(--pm-ink-dim);
  font-weight: 650;
}
.calendar-day:hover,
.calendar-day.selected {
  border-color: var(--pm-gold);
  background:
    radial-gradient(circle at 20% 10%, color-mix(in srgb, var(--pm-gold-bright) 24%, transparent), transparent 36%),
    linear-gradient(180deg, color-mix(in srgb, var(--pm-gold) 20%, var(--pm-parch-bright)), var(--pm-parch));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--pm-gold) 30%, transparent),
    0 0 0 1px color-mix(in srgb, var(--pm-gold) 12%, transparent);
}
.calendar-day.today span {
  color: var(--pm-ink);
  font-weight: 800;
}
.calendar-day.market {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--pm-gold) 16%, var(--pm-parch-bright)), var(--pm-parch));
}
.calendar-day.has::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 7px;
  height: 3px;
  border-radius: 999px;
  background: var(--pm-gold);
}
.calendar-day.due {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--pm-status-warn-bg) 70%, var(--pm-gold)), var(--pm-parch-bright));
}
.calendar-day em,
.calendar-day b {
  justify-self: start;
  max-width: 100%;
  padding: 1px 5px;
  overflow: hidden;
  color: var(--pm-gold-dim);
  background: color-mix(in srgb, var(--pm-gold) 18%, var(--pm-parch-bright));
  border: 1px solid color-mix(in srgb, var(--pm-gold) 48%, transparent);
  border-radius: 999px;
  font-size: calc(10px * var(--pm-text-scale));
  font-style: normal;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calendar-day b {
  color: var(--pm-ink-soft);
  background: color-mix(in srgb, var(--pm-parch-bright) 72%, var(--pm-line-faint));
  border-color: var(--pm-line-soft);
}
.calendar-day small {
  position: absolute;
  right: 7px;
  top: 7px;
  min-width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--pm-text-on-gold);
  background: var(--pm-grad-gold);
  border-radius: 999px;
  font-size: 11px;
}
.calendar-panels {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(220px, 0.85fr);
  gap: 10px;
}
.calendar-panel {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 10px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--pm-parch-bright) 82%, transparent), color-mix(in srgb, var(--pm-parch) 88%, transparent));
  border: 1px solid var(--pm-line-soft);
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pm-parch-bright) 56%, transparent);
}
.calendar-panel h3 {
  margin: 0;
  color: var(--pm-ink);
  font-size: calc(15px * var(--pm-text-scale));
}
.calendar-panel.warn {
  grid-column: 1 / -1;
}
.calendar-empty,
.calendar-memo p,
.calendar-mini p {
  margin: 0;
  color: var(--pm-ink-dim);
  line-height: 1.55;
}
.calendar-memo,
.calendar-mini {
  display: grid;
  gap: 6px;
  padding: 9px;
  background: color-mix(in srgb, var(--pm-parch-bright) 68%, transparent);
  border: 1px solid var(--pm-line-faint);
  border-radius: 5px;
}
.calendar-memo.due {
  border-color: color-mix(in srgb, var(--pm-gold) 68%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--pm-gold) 18%, transparent);
}
.calendar-memo.festival {
  border-color: color-mix(in srgb, var(--pm-gold) 62%, transparent);
  background:
    radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--pm-gold-bright) 22%, transparent), transparent 42%),
    color-mix(in srgb, var(--pm-parch-bright) 74%, transparent);
}
.calendar-memo header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.calendar-memo header span {
  flex: none;
  padding: 2px 7px;
  color: var(--pm-gold-strong);
  border: 1px solid rgba(202, 139, 36, 0.45);
  border-radius: 999px;
  font-size: 11px;
}
.calendar-time,
.calendar-mini span {
  color: var(--pm-ink-fade);
  font-size: calc(12px * var(--pm-text-scale));
}
.calendar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.calendar-actions button {
  padding: 4px 9px;
  color: var(--pm-ink);
  background: color-mix(in srgb, var(--pm-parch-bright) 72%, transparent);
  border: 1px solid var(--pm-line-soft);
  border-radius: 999px;
  cursor: pointer;
}
.calendar-actions button:hover {
  border-color: var(--pm-gold);
}

@media (max-width: 760px) {
  .calendar-popover {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(78px + env(safe-area-inset-bottom, 0px));
    width: auto;
    max-height: min(72vh, 620px);
    border-radius: 12px;
  }
  .calendar-grid {
    gap: 4px;
  }
  .calendar-weekday {
    min-height: 28px;
    font-size: calc(10px * var(--pm-text-scale));
  }
  .calendar-weekday small {
    display: none;
  }
  .calendar-day,
  .calendar-blank {
    min-height: 48px;
  }
  .calendar-day {
    padding: 6px;
  }
  .calendar-day em,
  .calendar-day b {
    max-width: 52px;
    font-size: calc(9px * var(--pm-text-scale));
  }
  .calendar-panels {
    grid-template-columns: 1fr;
  }
}
</style>
