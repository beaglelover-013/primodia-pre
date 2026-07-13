<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import PmIcon from '../components/PmIcon.vue';
import { useGameStore } from '../stores/game';
import type { RegularGuestType, RegularGuestUnit } from '../services/regularGuestWorldbook';

const game = useGameStore();

type EditSource = 'confirmed' | 'pending' | 'new';

const editingSource = ref<EditSource>('new');
const editingId = ref('');

const draft = reactive<RegularGuestUnit>({
  id: '',
  name: '',
  type: '个人',
  sizeText: '',
  identity: '',
  relationship: '陌生人',
  memoryHook: '',
  likes: '',
  dislikes: '',
  habits: '',
  messageTendency: '',
  notes: '',
  createdAtTurn: 0,
  updatedAt: 0,
});

const confirmedCount = computed(() => game.regularGuests.length);
const pendingCount = computed(() => game.pendingRegularGuestUpdates.length);

function resetDraft() {
  editingSource.value = 'new';
  editingId.value = '';
  Object.assign(draft, {
    id: '',
    name: '',
    type: '个人' as RegularGuestType,
    sizeText: '',
    identity: '',
    relationship: '陌生人',
    memoryHook: '',
    likes: '',
    dislikes: '',
    habits: '',
    messageTendency: '',
    notes: '',
    createdAtTurn: game.successfulNarrationTurn,
    updatedAt: Date.now(),
  });
}

function editGuest(guest: RegularGuestUnit, source: EditSource) {
  editingSource.value = source;
  editingId.value = guest.id;
  Object.assign(draft, { ...guest });
}

async function confirmGuest(guest: RegularGuestUnit) {
  await game.confirmRegularGuest(guest.id);
  if (editingId.value === guest.id) resetDraft();
}

async function discardGuest(guest: RegularGuestUnit) {
  await game.discardPendingRegularGuest(guest.id);
  if (editingId.value === guest.id) resetDraft();
}

async function removeGuest(guest: RegularGuestUnit) {
  await game.removeRegularGuest(guest.id);
  if (editingId.value === guest.id) resetDraft();
}

async function saveDraft(confirm = false) {
  if (!draft.name.trim()) return;
  await game.saveRegularGuest({ ...draft, type: draft.type as RegularGuestType }, { confirm: confirm || editingSource.value !== 'pending' });
  resetDraft();
}

resetDraft();
</script>

<template>
  <section id="page-regular-guests" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="people" :size="22" />
          常客簿
        </h2>
        <div class="sub">老面孔、团体熟客和 AI 建议候选都在这里确认。</div>
      </div>
      <div class="head-actions">
        <span class="pm-tag dim">已入簿 {{ confirmedCount }} 条</span>
        <span class="pm-tag" :class="{ warn: pendingCount > 0 }">待确认 {{ pendingCount }} 条</span>
      </div>
    </header>

    <div class="pm-paper-body regular-layout">
      <section class="regular-column">
        <article class="pm-card regular-panel">
          <div class="panel-head">
            <h3>待确认常客</h3>
            <span class="pm-tag dim">{{ game.regularGuestBookWorldbookStatus }}</span>
          </div>
          <div v-if="!game.pendingRegularGuestUpdates.length" class="empty">还没有 AI 提出的常客候选。</div>
          <div v-for="guest in game.pendingRegularGuestUpdates" :key="guest.id" class="guest-row pending">
            <div class="guest-main">
              <strong>{{ guest.name }}</strong>
              <span>{{ guest.type }} · {{ guest.relationship || '陌生人' }}</span>
              <p>{{ guest.identity || guest.memoryHook || '尚未填写身份或记忆钩子。' }}</p>
            </div>
            <div class="row-actions">
              <button class="pm-btn small" @click="editGuest(guest, 'pending')">编辑</button>
              <button class="pm-btn small primary" @click="confirmGuest(guest)">确认入簿</button>
              <button class="pm-btn small ghost" @click="discardGuest(guest)">丢弃</button>
            </div>
          </div>
        </article>

        <article class="pm-card regular-panel">
          <div class="panel-head">
            <h3>已确认常客</h3>
            <button class="pm-btn small" @click="resetDraft">新增</button>
          </div>
          <div v-if="!game.regularGuests.length" class="empty">常客簿还是空的。互动访客会继续走现有陌生访客引擎。</div>
          <div v-for="guest in game.regularGuests" :key="guest.id" class="guest-row">
            <div class="guest-main">
              <strong>{{ guest.name }}</strong>
              <span>{{ guest.type }} · {{ guest.relationship }}</span>
              <p>{{ guest.memoryHook || guest.identity || '没有记忆钩子。' }}</p>
            </div>
            <div class="row-actions">
              <button class="pm-btn small" @click="editGuest(guest, 'confirmed')">编辑</button>
              <button class="pm-btn small ghost" @click="removeGuest(guest)">移除</button>
            </div>
          </div>
        </article>
      </section>

      <aside class="pm-card regular-editor">
        <div class="panel-head">
          <h3>{{ editingSource === 'pending' ? '编辑候选' : editingSource === 'confirmed' ? '编辑常客' : '新增常客' }}</h3>
          <span class="pm-tag dim">回访率 8%</span>
        </div>

        <label>
          名称
          <input v-model="draft.name" class="pm-input" placeholder="矿工三人组" />
        </label>
        <div class="form-grid">
          <label>
            类型
            <select v-model="draft.type" class="pm-input">
              <option value="个人">个人</option>
              <option value="团体">团体</option>
            </select>
          </label>
          <label>
            关系
            <input v-model="draft.relationship" class="pm-input" placeholder="陌生人 / 熟脸 / 老客 / 自己人" />
          </label>
        </div>
        <label>
          人数描述
          <input v-model="draft.sizeText" class="pm-input" placeholder="通常三人，偶尔少一人" />
        </label>
        <label>
          身份
          <input v-model="draft.identity" class="pm-input" placeholder="附近矿场下工后的熟客" />
        </label>
        <label>
          记忆钩子
          <textarea v-model="draft.memoryHook" class="pm-input" rows="3" />
        </label>
        <div class="form-grid">
          <label>
            偏好
            <textarea v-model="draft.likes" class="pm-input" rows="3" />
          </label>
          <label>
            忌口
            <textarea v-model="draft.dislikes" class="pm-input" rows="3" />
          </label>
        </div>
        <label>
          习惯
          <textarea v-model="draft.habits" class="pm-input" rows="3" />
        </label>
        <label>
          消息倾向
          <textarea v-model="draft.messageTendency" class="pm-input" rows="3" />
        </label>
        <label>
          备注
          <textarea v-model="draft.notes" class="pm-input" rows="3" />
        </label>

        <div class="editor-actions">
          <button class="pm-btn" @click="resetDraft">清空</button>
          <button v-if="editingSource === 'pending'" class="pm-btn primary" :disabled="!draft.name.trim()" @click="saveDraft(true)">编辑后确认</button>
          <button v-else class="pm-btn primary" :disabled="!draft.name.trim()" @click="saveDraft(true)">保存入簿</button>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.regular-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 16px;
}

.regular-column {
  display: grid;
  gap: 16px;
  align-content: start;
}

.regular-panel,
.regular-editor {
  display: grid;
  gap: 12px;
}

.panel-head,
.guest-row,
.editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-head h3 {
  margin: 0;
  font-size: 16px;
}

.guest-row {
  padding: 12px;
  border: 1px solid rgba(102, 78, 39, 0.25);
  border-radius: 8px;
  background: rgba(255, 248, 225, 0.36);
}

.guest-row.pending {
  border-color: rgba(184, 134, 11, 0.4);
}

.guest-main {
  min-width: 0;
}

.guest-main strong,
.guest-main span,
.guest-main p {
  display: block;
}

.guest-main span,
.guest-main p,
.empty {
  color: rgba(84, 61, 32, 0.72);
}

.guest-main p {
  margin: 4px 0 0;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.regular-editor label {
  display: grid;
  gap: 6px;
  color: rgba(78, 56, 29, 0.86);
  font-size: 13px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.pm-input {
  width: 100%;
  min-width: 0;
}

textarea.pm-input {
  resize: vertical;
}

.pm-tag.warn {
  border-color: rgba(184, 134, 11, 0.55);
}

@media (max-width: 980px) {
  .regular-layout,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .guest-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .row-actions {
    justify-content: flex-start;
  }
}
</style>
