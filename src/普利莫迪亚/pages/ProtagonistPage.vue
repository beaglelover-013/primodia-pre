<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';

const game = useGameStore();
const p = game.protagonist;

const cookingLevels = ['烧火工', '守灶童', '灶台学徒', '行炉工', '持勺匠', '灶台师傅', '首席灶师', '灶火宗师'];
const currentCookingTitle = computed(() => `${p.cookingLevel}级 · ${cookingLevels[p.cookingLevel - 1] ?? cookingLevels[0]}`);
const cookingProgressText = computed(() => {
  if (p.cookingLevel >= 8) return '已达灶火宗师';
  return `${p.cookingExp}/${p.cookingExpMax} 次`;
});

const energyValue = computed(() => Math.max(0, Math.floor(Number(game.energy.value) || 0)));
const energyMax = computed(() => Math.max(1, Math.floor(Number(game.energy.max) || 100)));
const energyPercent = computed(() => `${Math.max(0, Math.min(100, (energyValue.value / energyMax.value) * 100))}%`);
const protagonistTemporaryStates = computed(() =>
  game.flattenTemporaryStates().filter(state => state.targetType === '主角'),
);

function trainCooking() {
  game.appendDraft('我在炉台旁练习基础火候、刀工和手感，想把厨艺磨得更稳一些。');
  game.pushLog('提示', '厨艺练习已加入行动框。');
}
</script>

<template>
  <section id="page-protagonist" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="heart" :size="22" />
          主角档案
        </h2>
        <div class="sub">酒馆主人 · 厨艺等级 · 当前状态</div>
      </div>
    </header>

    <div class="pm-paper-body hero-layout">
      <section class="hero-card">
        <div class="hero-sigil">
          <PmIcon name="tavern" :size="34" />
        </div>
        <div>
          <h3>{{ p.name }}</h3>
          <div class="pm-dim">{{ game.tavernName }} · {{ p.title }} · {{ p.located }}</div>
          <div class="hero-facts">
            <span><b>当前状态</b>{{ p.mood }}</span>
            <span><b>一句话穿着</b>{{ p.outfit || '衣着暂未记录。' }}</span>
          </div>
          <div v-if="protagonistTemporaryStates.length" class="temp-states">
            <span
              v-for="state in protagonistTemporaryStates"
              :key="`protagonist-${state.名称}-${state.描述}`"
              class="temp-chip"
              :title="state.描述"
            >
              {{ state.名称 }} · {{ state.剩余回合 }}回合
            </span>
          </div>
          <p>{{ p.bio }}</p>
        </div>
      </section>

      <section class="stat-grid">
        <article class="stat-card">
          <span>生命</span>
          <strong>{{ p.hp }}/{{ p.hpMax }}</strong>
          <em>{{ game.lifePhase(p.hp, p.hpMax) }}</em>
          <span class="pm-bar hp"><i :style="{ width: `${(p.hp / p.hpMax) * 100}%` }"></i></span>
        </article>
        <article class="stat-card">
          <span>精力</span>
          <strong>{{ energyValue }}/{{ energyMax }}</strong>
          <em>{{ game.energyPhase(energyValue, energyMax) }}</em>
          <span class="pm-bar energy"><i :style="{ width: energyPercent }"></i></span>
        </article>
        <article class="stat-card wide">
          <span>厨艺</span>
          <strong>{{ currentCookingTitle }}</strong>
          <em>{{ cookingProgressText }}</em>
          <em>下级所需 {{ p.cookingExpMax }} 次</em>
          <span class="pm-bar affection"><i :style="{ width: `${(p.cookingExp / p.cookingExpMax) * 100}%` }"></i></span>
          <button class="pm-btn sm dark" @click="trainCooking">
            <PmIcon name="fire" :size="13" /> 练习
          </button>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.hero-layout {
  display: grid;
  gap: 14px;
}
.hero-card {
  display: grid;
  grid-template-columns: 82px 1fr;
  gap: 14px;
  align-items: center;
  padding: 16px;
  border: 1px solid rgba(110, 80, 34, 0.42);
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(255, 245, 215, 0.76), rgba(212, 186, 136, 0.48));
}
.hero-sigil {
  width: 82px;
  height: 82px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid rgba(110, 80, 34, 0.5);
  background: radial-gradient(circle at 35% 25%, rgba(255, 245, 215, 0.55), transparent 68%), linear-gradient(180deg, #8b6330, #2a1c11);
  color: var(--pm-parch-bright);
}
.hero-card h3 {
  margin: 0 0 4px;
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(22px * var(--pm-text-scale));
}
.hero-card p {
  margin: 8px 0 0;
  color: var(--pm-ink-soft);
  line-height: 1.7;
}
.hero-facts {
  display: grid;
  gap: 5px;
  margin-top: 10px;
}
.hero-facts span {
  display: grid;
  grid-template-columns: 82px 1fr;
  gap: 8px;
  color: var(--pm-ink-soft);
  font-size: calc(12px * var(--pm-text-scale));
  line-height: 1.55;
}
.hero-facts b {
  color: var(--pm-ink-dim);
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
}
.temp-states {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.temp-chip {
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid rgba(158, 111, 35, 0.44);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(242, 214, 132, 0.72), rgba(173, 126, 50, 0.45));
  color: #4a2f12;
  font-size: calc(11px * var(--pm-text-scale));
  font-family: var(--pm-font-display);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.stat-card {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(110, 80, 34, 0.38);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.55);
}
.stat-card span:first-child {
  color: var(--pm-ink-dim);
  font-family: var(--pm-font-display);
  font-weight: 700;
}
.stat-card strong {
  color: var(--pm-ink);
  font-size: calc(18px * var(--pm-text-scale));
}
.stat-card em {
  color: var(--pm-ink-dim);
  font-style: normal;
  font-size: calc(12px * var(--pm-text-scale));
}
@media (max-width: 860px) {
  .hero-card,
  .stat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
