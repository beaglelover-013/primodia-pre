<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PmIcon from '../components/PmIcon.vue';
import { useGameStore } from '../stores/game';
import { buildFixedOpeningPreset } from '../services/openingWorkshop';

const game = useGameStore();

const worldbooks = ref<string[]>([]);
const worldbookName = ref('');
const loading = ref('');
const notice = ref('');
const error = ref('');

const openings = computed(() => [
  {
    id: 'fox-applicant',
    title: '小狐狸来应聘',
    badge: '已完成',
    enabled: true,
    summary: '清晨的铁壶酒馆还没正式营业，橘柒推门进来，问门口那句“招人”还算不算数。',
    details: ['克斯', '铁壶酒馆', '橘柒', '共栖历1303年'],
  },
  {
    id: 'opening-2',
    title: '第二个开场',
    badge: '待加入',
    enabled: false,
    summary: '这里先留给你之后发来的第二套开场白、变量和人物设定。',
    details: ['预留位置'],
  },
  {
    id: 'opening-3',
    title: '第三个开场',
    badge: '待加入',
    enabled: false,
    summary: '这里先留给你之后发来的第三套开场白、变量和人物设定。',
    details: ['预留位置'],
  },
]);

function refreshWorldbooks() {
  worldbooks.value = game.availableOpeningWorldbooks();
  worldbookName.value = worldbookName.value || game.defaultOpeningWorldbookName() || worldbooks.value[0] || '';
}

async function chooseOpening(id: string) {
  error.value = '';
  notice.value = '';
  if (id !== 'fox-applicant') {
    notice.value = '这个开场还没有加入，等你给我第二、第三个内容后会放到这里。';
    return;
  }
  if (!worldbookName.value) {
    error.value = '请先选择要写入的世界书。';
    return;
  }

  loading.value = '正在创建小狐狸开场';
  try {
    const { draft, bundle } = buildFixedOpeningPreset(worldbookName.value);
    await game.confirmOpeningWorkshop(draft, bundle);
    notice.value = '小狐狸开场已创建，已经进入编年录。';
  } catch (err) {
    error.value = err instanceof Error ? err.message : '开场创建失败。';
  } finally {
    loading.value = '';
  }
}

onMounted(refreshWorldbooks);
</script>

<template>
  <section id="page-opening" class="opening-select-page page pm-paper">
    <div class="pm-page-orn tl"></div>
    <div class="pm-page-orn tr"></div>
    <div class="pm-page-orn bl"></div>
    <div class="pm-page-orn br"></div>

    <header class="opening-select-head">
      <div>
        <p>OPENING</p>
        <h1><PmIcon name="ledger" :size="22" /> 开场选择</h1>
        <span>先选一个开场进入故事。现在只有小狐狸开场可用，另外两个位置先留出来。</span>
      </div>
      <label class="worldbook-picker">
        <span>写入世界书</span>
        <select v-model="worldbookName" class="pm-input">
          <option value="">请选择</option>
          <option v-for="name in worldbooks" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
    </header>

    <div v-if="error" class="opening-message bad">{{ error }}</div>
    <div v-if="notice" class="opening-message good">{{ notice }}</div>
    <div v-if="loading" class="opening-message">{{ loading }}...</div>

    <div class="opening-card-grid">
      <article
        v-for="item in openings"
        :key="item.id"
        class="opening-choice-card pm-card"
        :class="{ disabled: !item.enabled }"
      >
        <div class="choice-top">
          <span class="pm-tag" :class="item.enabled ? 'good' : 'warn'">{{ item.badge }}</span>
          <PmIcon name="ledger" :size="18" />
        </div>
        <h2>{{ item.title }}</h2>
        <p>{{ item.summary }}</p>
        <div class="choice-tags">
          <span v-for="detail in item.details" :key="detail">{{ detail }}</span>
        </div>
        <button class="pm-btn" :disabled="!!loading || !item.enabled" type="button" @click="chooseOpening(item.id)">
          {{ item.enabled ? '使用这个开场' : '等待补充' }}
        </button>
      </article>
    </div>
  </section>
</template>

<style scoped>
.opening-select-page {
  min-height: 100%;
  padding: 22px;
}

.opening-select-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--pm-line-soft);
}

.opening-select-head p {
  margin: 0 0 6px;
  color: var(--pm-muted);
  font-family: var(--pm-font-display);
  letter-spacing: 0.18em;
  font-size: calc(11px * var(--pm-text-scale));
}

.opening-select-head h1 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(26px * var(--pm-text-scale));
}

.opening-select-head span {
  color: var(--pm-muted);
  line-height: 1.7;
}

.worldbook-picker {
  min-width: 260px;
  display: grid;
  gap: 8px;
  color: var(--pm-muted);
  font-size: calc(13px * var(--pm-text-scale));
}

.opening-message {
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--pm-line-soft);
  border-radius: 6px;
  background: rgba(255, 248, 225, 0.7);
  color: var(--pm-ink);
}

.opening-message.good {
  border-color: rgba(90, 132, 76, 0.45);
  color: #355a2d;
}

.opening-message.bad {
  border-color: rgba(147, 67, 55, 0.45);
  color: #7a3027;
}

.opening-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.opening-choice-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 260px;
}

.opening-choice-card.disabled {
  opacity: 0.65;
}

.choice-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--pm-muted);
}

.opening-choice-card h2 {
  margin: 0;
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(20px * var(--pm-text-scale));
}

.opening-choice-card p {
  flex: 1;
  margin: 0;
  color: var(--pm-muted);
  line-height: 1.75;
}

.choice-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.choice-tags span {
  padding: 4px 8px;
  border: 1px solid var(--pm-line-soft);
  border-radius: 999px;
  background: rgba(255, 248, 225, 0.55);
  color: var(--pm-ink);
  font-size: calc(12px * var(--pm-text-scale));
}

@media (max-width: 980px) {
  .opening-card-grid {
    grid-template-columns: 1fr;
  }

  .opening-select-head {
    flex-direction: column;
  }

  .worldbook-picker {
    width: 100%;
    min-width: 0;
  }
}
</style>
