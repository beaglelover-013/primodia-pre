<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useGameStore, formatCopper, type CraftMode, type RecipeEntry } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';

const game = useGameStore();

type RecipeFilter = '全部' | CraftMode;

const filters: Array<{ id: RecipeFilter; label: string }> = [
  { id: '全部', label: '全部' },
  { id: 'cooking', label: '菜品' },
  { id: 'sauce', label: '酱料' },
  { id: 'drink', label: '饮品' },
];

const modeLabels: Record<CraftMode, string> = {
  cooking: '菜品',
  sauce: '酱料',
  drink: '饮品',
};

const currentFilter = ref<RecipeFilter>('全部');
const searchText = ref('');
const copiesByRecipe = reactive<Record<string, number>>({});
const shortageRecipeId = ref<string | null>(null);

const visibleRecipes = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  return game.recipes.filter(recipe => {
    if (currentFilter.value !== '全部' && recipe.mode !== currentFilter.value) return false;
    if (!keyword) return true;
    const haystack = [
      recipe.name,
      recipe.outputName,
      recipe.outputCategory,
      ...recipe.outputTags,
      ...recipe.ingredients.flatMap(item => [item.name, item.category, ...item.tags]),
    ].join(' ').toLowerCase();
    return haystack.includes(keyword);
  });
});

function copiesFor(recipe: RecipeEntry) {
  return Math.max(1, Math.floor(Number(copiesByRecipe[recipe.id]) || 1));
}

function shortageFor(recipe: RecipeEntry) {
  return game.recipeShortages(recipe, copiesFor(recipe));
}

function isMissingIngredient(recipe: RecipeEntry, ingredientName: string) {
  return shortageRecipeId.value === recipe.id && shortageFor(recipe).some(entry => entry.ingredient.name === ingredientName);
}

function makeRecipe(recipe: RecipeEntry) {
  const result = game.craftRecipe(recipe.id, copiesFor(recipe));
  shortageRecipeId.value = result.ok ? null : recipe.id;
}

function recipeSummary(recipe: RecipeEntry) {
  const tags = recipe.outputTags.length ? recipe.outputTags.join('、') : '无标签';
  return `${recipe.outputCategory} · ${tags}`;
}
</script>

<template>
  <section id="page-recipes" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="ledger" :size="22" />
          配方簿
        </h2>
        <div class="sub">前端保存 · 纯本地复刻 · 不发送给 AI</div>
      </div>
      <div class="head-actions">
        <input v-model="searchText" class="pm-input recipe-search" placeholder="搜索配方、材料或标签" />
      </div>
    </header>

    <div class="pm-paper-body recipe-page">
      <aside class="recipe-filter">
        <button
          v-for="filter in filters"
          :key="filter.id"
          class="filter-btn"
          :class="{ active: currentFilter === filter.id }"
          @click="currentFilter = filter.id"
        >
          <span>{{ filter.label }}</span>
          <small>{{ filter.id === '全部' ? game.recipes.length : game.recipes.filter(r => r.mode === filter.id).length }}</small>
        </button>
      </aside>

      <section class="recipe-list">
        <div v-if="visibleRecipes.length === 0" class="pm-empty recipe-empty">
          还没有可用配方。先在库房制作出正式成品，再把带材料记录的成品保存为配方。
        </div>

        <article v-for="recipe in visibleRecipes" :key="recipe.id" class="recipe-card">
          <header class="recipe-card-head">
            <div>
              <h3>{{ recipe.name }}</h3>
              <p>{{ modeLabels[recipe.mode] }} · {{ recipeSummary(recipe) }}</p>
            </div>
            <button class="pm-link danger" @click="game.deleteRecipe(recipe.id)">删除</button>
          </header>

          <div class="recipe-output">
            <span class="pm-tag gold">{{ recipe.outputName }}</span>
            <span v-if="recipe.outputQuality" class="pm-tag">{{ recipe.outputQuality }}</span>
            <span class="pm-tag dim">产出 {{ recipe.yieldQty }} 份</span>
            <span class="pm-tag dim">{{ formatCopper(recipe.outputPriceCopper ?? 0) }}</span>
          </div>

          <div v-if="recipe.outputTags.length" class="recipe-tag-cloud">
            <span v-for="tag in recipe.outputTags" :key="tag" class="pm-tag">{{ tag }}</span>
          </div>

          <p v-if="recipe.note" class="recipe-note">{{ recipe.note }}</p>

          <section class="ingredient-list">
            <h4>单次用料</h4>
            <div
              v-for="ingredient in recipe.ingredients"
              :key="`${ingredient.name}-${ingredient.category}-${ingredient.tags.join('|')}`"
              class="ingredient-line"
              :class="{ missing: isMissingIngredient(recipe, ingredient.name) }"
            >
              <span>
                {{ ingredient.name }} × {{ ingredient.qty }}
                <em>{{ ingredient.category }}</em>
              </span>
              <small v-if="!ingredient.tags.length">无标签</small>
              <div v-else class="ingredient-tags">
                <span v-for="tag in ingredient.tags" :key="tag" class="pm-tag dim">{{ tag }}</span>
              </div>
            </div>
          </section>

          <div v-if="shortageRecipeId === recipe.id && shortageFor(recipe).length" class="shortage-box">
            <strong>缺少材料</strong>
            <span v-for="entry in shortageFor(recipe)" :key="entry.ingredient.name">
              {{ entry.ingredient.name }} 缺 {{ entry.missing }} 份
            </span>
          </div>

          <footer class="recipe-actions">
            <label>
              <span>复刻份数</span>
              <input v-model.number="copiesByRecipe[recipe.id]" type="number" min="1" max="99" class="pm-input copies-input" />
            </label>
            <button class="pm-btn dark" @click="makeRecipe(recipe)">
              <PmIcon name="fire" :size="13" />
              制作
            </button>
          </footer>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.recipe-search {
  min-width: 260px;
}
.recipe-page {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.recipe-filter {
  position: sticky;
  top: 12px;
  display: grid;
  gap: 8px;
}
.filter-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid rgba(110, 80, 34, 0.45);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.55);
  color: var(--pm-ink);
  font-weight: 700;
}
.filter-btn small {
  color: var(--pm-ink-dim);
}
.filter-btn.active {
  border-color: rgba(167, 121, 45, 0.86);
  background: var(--pm-grad-gold);
  color: var(--pm-text-on-gold);
}
.recipe-list {
  display: grid;
  gap: 12px;
}
.recipe-empty {
  min-height: 180px;
}
.recipe-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(110, 80, 34, 0.42);
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(255, 245, 215, 0.78), rgba(212, 186, 136, 0.5));
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.58);
}
.recipe-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.recipe-card h3 {
  margin: 0;
  color: var(--pm-ink);
  font-size: calc(18px * var(--pm-text-scale));
}
.recipe-card p {
  margin: 4px 0 0;
  color: var(--pm-ink-dim);
  line-height: 1.5;
}
.pm-link.danger {
  color: var(--pm-status-bad-text);
}
.recipe-output {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.recipe-tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.recipe-note {
  padding: 8px 10px;
  border-left: 3px solid rgba(167, 121, 45, 0.62);
  background: rgba(255, 255, 255, 0.22);
}
.ingredient-list {
  display: grid;
  gap: 6px;
}
.ingredient-list h4 {
  margin: 0;
  color: var(--pm-ink-soft);
  font-size: calc(13px * var(--pm-text-scale));
}
.ingredient-line {
  display: grid;
  grid-template-columns: minmax(160px, auto) minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 7px 9px;
  border: 1px solid rgba(110, 80, 34, 0.28);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.22);
  color: var(--pm-ink);
}
.ingredient-line em {
  margin-left: 6px;
  color: var(--pm-ink-dim);
  font-style: normal;
  font-size: calc(11px * var(--pm-text-scale));
}
.ingredient-line small {
  color: var(--pm-ink-dim);
  text-align: right;
}
.ingredient-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}
.ingredient-line.missing {
  border-color: var(--pm-status-bad-border);
  background: var(--pm-status-bad-bg);
  color: var(--pm-status-bad-text);
}
.shortage-box {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--pm-status-bad-border);
  border-radius: 4px;
  background: var(--pm-status-bad-bg);
  color: var(--pm-status-bad-text);
}
.recipe-actions {
  display: flex;
  align-items: end;
  justify-content: flex-end;
  gap: 10px;
}
.recipe-actions label {
  display: grid;
  gap: 4px;
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
}
.copies-input {
  width: 88px;
}
@media (max-width: 860px) {
  .recipe-page {
    grid-template-columns: 1fr;
  }
  .recipe-filter {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ingredient-line {
    grid-template-columns: 1fr;
  }
  .ingredient-line small,
  .ingredient-tags {
    justify-content: flex-start;
    text-align: left;
  }
}
</style>
