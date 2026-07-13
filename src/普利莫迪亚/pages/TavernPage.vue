<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useGameStore, formatCopper, type Heroine, type TavernRegion, type TavernRoom, type TemporaryStateDisplay } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';

const game = useGameStore();

const selectedRegionId = ref('main-hall');
const selectedRegion = computed(() => game.regions.find(r => r.id === selectedRegionId.value) ?? game.regions[0]);
const selectedWorkerId = ref<string | null>(null);
const selectedWorker = computed(() => game.heroines.find(h => h.id === selectedWorkerId.value) ?? null);
const regionList = computed(() => game.regions);
const compactRegions = computed(() => regionList.value.length > 12);
const manyRegions = computed(() => regionList.value.length > 20);
const tavernOverviewText = computed(() => {
  const overview = String(game.tavernOverview ?? '').trim();
  if (overview) return overview;
  const names = regionList.value.map(region => region.name).slice(0, 6).join('、');
  return names
    ? `${game.tavernName}当前已形成 ${regionList.value.length} 处可记录空间：${names}${regionList.value.length > 6 ? '等' : ''}。`
    : `${game.tavernName}的空间仍等待玩家在正文中整理、命名和拓展。`;
});
const tavernTemporaryStates = computed<TemporaryStateDisplay[]>(() =>
  game.flattenTemporaryStates().filter(state => state.targetType === '酒馆'),
);
const selectedRegionTemporaryStates = computed<TemporaryStateDisplay[]>(() => {
  const regionName = selectedRegion.value?.name;
  if (!regionName) return [];
  return game.flattenTemporaryStates().filter(state => state.targetType === '酒馆区域' && state.targetName === regionName);
});

const addOpen = ref(false);
const addTarget = ref<TavernRegion | null>(null);
const addRoomTarget = ref<TavernRoom | null>(null);
const newFacility = reactive({
  name: '',
  style: '',
  costCopper: 800,
  note: '',
});
function openAddFacility(r: TavernRegion, room?: TavernRoom) {
  addTarget.value = r;
  addRoomTarget.value = room ?? null;
  newFacility.name = '';
  newFacility.style = '';
  newFacility.costCopper = room ? 500 : 800;
  newFacility.note = '';
  addOpen.value = true;
}
async function applyAddFacility() {
  if (!addTarget.value || !newFacility.name.trim()) return;
  const targetName = addRoomTarget.value ? `${addTarget.value.name} · ${addRoomTarget.value.name}` : addTarget.value.name;
  const result = await game.executePseudoZeroAction({
    type: 'FACILITY_ADD',
    regionId: addTarget.value.id,
    roomId: addRoomTarget.value?.id,
    facility: {
      name: newFacility.name.trim(),
      style: newFacility.style.trim() || '自定',
      condition: '良好' as const,
      description: newFacility.note.trim() || '由玩家添置的新设施。',
      priceCopper: Math.max(0, Math.floor(newFacility.costCopper || 0)),
    },
  }, {
    type: 'FACILITY_ADD',
    title: `添置设施 · ${newFacility.name.trim()}`,
    aiHint: `请承接本回合上下文，叙述玩家在「${targetName}」安排添置「${newFacility.name.trim()}」的当下过程。不要额外添加设施、改随身钱袋/钱匣或改世界书；若需要移动，只通过 MVU 地点补丁表达。`,
    logText: `FACILITY_ADD · ${targetName} · ${newFacility.name.trim()}`,
    autoSend: false,
    preserveLocalState: true,
  });
  if (!result.ok) {
    return;
  }
  addOpen.value = false;
}

const fastForward = reactive({
  open: false,
  hours: 4,
  intensity: '正常' as '低调' | '正常' | '热闹' | '通宵',
});
function openFastForward() {
  fastForward.open = true;
}
async function runFastForward() {
  const hours = Math.max(1, Math.floor(Number(fastForward.hours) || 1));
  const intensity = fastForward.intensity;
  const result = game.dispatchAction({
    type: 'TAVERN_FAST_FORWARD',
    hours,
    intensity,
  });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(
    `我让「${game.tavernName}」开始营业，并连续经营约${hours}小时，营业风格偏「${intensity}」。观察客流、点单、收入、疲惫和酒馆里的气氛变化。（前端已结算：时间、钱匣收入、声望和精力变化。）`,
    { type: 'TAVERN_FAST_FORWARD' },
  );
  game.pushLog('提示', `经营快进 · ${intensity} · ${hours}小时 已结算并加入行动框。`);
  fastForward.open = false;
}
function toggleBusinessOpen() {
  const open = !game.isBusinessOpen;
  const result = game.dispatchAction({
    type: 'BUSINESS_TOGGLE',
    open,
  });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(
    open
      ? `我打开「${game.tavernName}」开始营业，整理柜台、炉火和主厅，准备接待今天的第一批客人。（前端已结算：营业状态已开启。）`
      : `我让「${game.tavernName}」歇业收店，收拾桌面、安顿店内事务并关上门。（前端已结算：营业状态已关闭，当前客流记录已清空。）`,
    { type: 'BUSINESS_TOGGLE' },
  );
  game.pushLog('提示', `${open ? '开始营业' : '歇业收店'} 已结算并加入行动框。`);
}
function updateGuestCap(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  game.setBusinessGuestCap(value);
}
function updateVisitorChance(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  game.setBusinessVisitorChance(value);
}

function conditionTone(c: TavernRegion['condition']) {
  return `condition-${c}`;
}

function needsCleaning(c: TavernRegion['condition']) {
  return !['崭新', '整洁', '良好'].includes(c);
}

function dispatchClean(r: TavernRegion) {
  const previousCondition = r.condition;
  const result = game.dispatchAction({ type: 'REGION_CLEAN', regionId: r.id });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(`我清扫并维护「${r.name}」，整理现场、擦洗污痕并检查设施状态。`, {
    type: 'REGION_CLEAN',
    undoPatch: {
      type: 'REGION_CLEAN',
      regionId: r.id,
      previousCondition,
    },
  });
  game.pushLog('提示', `清扫维护 · ${r.name} 已结算并加入行动框。`);
}

const facilityCount = computed(() => game.regions.reduce((acc, r) => acc + r.facilities.length + (r.rooms?.reduce((sum, room) => sum + room.facilities.length, 0) ?? 0), 0));
const dirtyCount = computed(() => game.regions.filter(r => needsCleaning(r.condition)).length);
function regionFacilityCount(r: TavernRegion) {
  return r.facilities.length + (r.rooms?.reduce((sum, room) => sum + room.facilities.length, 0) ?? 0);
}
function assignedRegionFor(h: Heroine) {
  return game.regions.find(r => r.staff?.includes(h.name));
}
const regionNpcActivities = computed(() => selectedRegion.value ? game.npcActivitiesForRegion(selectedRegion.value.name) : []);
const selectedRegionStaff = computed(() => selectedRegion.value?.staff ? selectedRegion.value.staff.split(/[、,，\s]+/).filter(Boolean) : []);
const selectedRegionVisitors = computed(() => {
  if (!selectedRegion.value) return [];
  const staff = new Set(selectedRegionStaff.value);
  const activityByHeroine = new Map(regionNpcActivities.value.map(activity => [activity.heroineId, activity]));
  return game.heroines
    .filter(h => game.resolveTavernNpcRegion(h.located) === selectedRegion.value!.name && !staff.has(h.name))
    .map(h => ({ heroine: h, activity: activityByHeroine.get(h.id) }));
});
function activityRemainingText(activity: { expiresTurn?: number } | undefined) {
  if (!activity?.expiresTurn) return '';
  return ` · 剩${Math.max(1, activity.expiresTurn - game.successfulNarrationTurn)}回合`;
}
function assignWorkerToRegion(r: TavernRegion) {
  if (!selectedWorker.value) return;
  const worker = selectedWorker.value;
  const previousLocated = worker.located;
  const previousRegion = game.regions.find(item => item.staff?.includes(worker.name));
  const previousTargetStaff = r.staff;
  const result = game.dispatchAction({
    type: 'WORKER_ASSIGN',
    heroineId: worker.id,
    regionId: r.id,
  });
  if (!result.ok) {
    game.pushLog('提示', result.message);
    return;
  }
  game.appendDraft(`我安排 ${worker.name} 前往「${r.name}」当值，观察她的反应和空间里的气氛变化。`, {
    type: 'WORKER_ASSIGN',
    undoPatch: {
      type: 'WORKER_ASSIGN',
      heroineId: worker.id,
      previousLocated,
      targetRegionId: r.id,
      previousTargetStaff,
      previousRegionId: previousRegion?.id,
      previousRegionStaff: previousRegion?.staff,
    },
  });
  game.pushLog('提示', `员工分配 · ${worker.name} -> ${r.name} 已结算并加入行动框。`);
}
</script>

<template>
  <section id="page-tavern" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="tavern" :size="22" />
          {{ game.tavernName }} · 成长空间
        </h2>
        <div class="sub">已添置 {{ facilityCount }} 项 · 待清洁 {{ dirtyCount }} 处</div>
      </div>
      <div class="head-actions">
        <div class="business-strip" :class="{ open: game.isBusinessOpen }">
          <span class="business-state">{{ game.isBusinessOpen ? '营业中' : '未营业' }}</span>
          <span title="普通客流占座">{{ game.currentGuests }}/{{ game.guestCap }}</span>
          <input
            class="guest-cap"
            type="number"
            min="1"
            :value="game.guestCap"
            title="客流上限"
            @change="updateGuestCap"
          />
          <label class="visitor-chance">
            <span>互动访客率</span>
            <input
              type="number"
              min="0"
              max="100"
              :value="game.visitorChance"
              title="每回合生成可互动访客的概率"
              @change="updateVisitorChance"
            />
            <span>%</span>
          </label>
        </div>
        <button class="pm-btn" :class="{ dark: game.isBusinessOpen, ghost: !game.isBusinessOpen }" @click="toggleBusinessOpen">
          <PmIcon :name="game.isBusinessOpen ? 'x' : 'tavern'" :size="14" />
          {{ game.isBusinessOpen ? '歇业' : '开始营业' }}
        </button>
        <button id="btn-fast-forward" class="pm-btn dark" @click="openFastForward">
          <PmIcon name="hourglass" :size="14" />
          经营快进
        </button>
      </div>
    </header>

    <div class="pm-paper-body tavern-board">
      <section class="region-panel" aria-label="酒馆成长空间">
        <article class="tavern-overview">
          <div class="overview-kicker">当前酒馆概况</div>
          <p>{{ tavernOverviewText }}</p>
        </article>
        <section v-if="tavernTemporaryStates.length" class="tavern-temp-board">
          <div class="overview-kicker">当前经营效果</div>
          <div class="temp-state-list">
            <span
              v-for="state in tavernTemporaryStates"
              :key="`tavern-${state.名称}-${state.描述}`"
              class="temp-state-chip"
              :title="state.描述"
            >
              <strong>{{ state.名称 }}</strong>
              <em>剩 {{ state.剩余回合 }} 回合</em>
              <small v-if="state.来源物品">{{ state.来源物品 }}</small>
            </span>
          </div>
        </section>
        <div v-if="manyRegions" class="region-overflow-note">
          空间记录已经很多了，可以在剧情里让角色整理、合并或重新命名区域，但不会阻止继续新增。
        </div>
        <div class="region-list" :class="{ compact: compactRegions }">
        <button
          v-for="region in regionList"
          :key="region.id"
          class="region-card"
          :class="{ active: selectedRegionId === region.id, worn: needsCleaning(region.condition) }"
          @click="selectedRegionId = region.id"
        >
          <span class="region-card-icon"><PmIcon :name="region.icon" :size="18" /></span>
          <strong>{{ region.name }}</strong>
          <span>{{ region.subtitle }}</span>
          <em>{{ regionFacilityCount(region) }}项设施 · {{ region.staff ?? (region.rooms?.length ? `${region.rooms.length}房间` : region.condition) }}</em>
        </button>
        </div>
        <div v-if="regionList.length === 0" class="pm-empty compact">还没有记录到可用空间。</div>
      </section>

      <aside v-if="selectedRegion" class="region-detail">
        <header class="rg-head">
          <div class="rg-emblem">
            <PmIcon :name="selectedRegion.icon" :size="22" />
          </div>
          <div class="rg-title">
            <h3>{{ selectedRegion.name }}</h3>
            <div class="rg-sub">{{ selectedRegion.subtitle }}</div>
          </div>
          <span class="pm-tag" :class="conditionTone(selectedRegion.condition)">{{ selectedRegion.condition }}</span>
        </header>

        <p class="rg-desc">{{ selectedRegion.description }}</p>
        <section v-if="selectedRegionTemporaryStates.length" class="region-temp-board">
          <div class="rg-fac-title">区域临时效果</div>
          <div class="temp-state-list">
            <span
              v-for="state in selectedRegionTemporaryStates"
              :key="`region-${selectedRegion.id}-${state.名称}-${state.描述}`"
              class="temp-state-chip"
              :title="state.描述"
            >
              <strong>{{ state.名称 }}</strong>
              <em>剩 {{ state.剩余回合 }} 回合</em>
              <small v-if="state.来源物品">{{ state.来源物品 }}</small>
            </span>
          </div>
        </section>

        <section v-if="game.lastVisitorSeed" class="visitor-note">
          <span>最近互动访客</span>
          <strong>{{ game.lastVisitorSeed }}</strong>
        </section>
        <section v-if="game.lastBackgroundFlow" class="visitor-note">
          <span>最近普通客流</span>
          <strong>{{ game.lastBackgroundFlow }}</strong>
        </section>

        <div class="rg-meta">
          <span class="pm-tag">{{ selectedRegion.style }}</span>
          <span v-if="selectedRegion.staff" class="pm-tag dim">{{ selectedRegion.staff }}</span>
          <span class="pm-tag dim">{{ regionFacilityCount(selectedRegion) }} 项设施</span>
        </div>

        <div class="rg-actions">
          <button class="pm-btn sm" @click="openAddFacility(selectedRegion)">
            <PmIcon name="hammer" :size="12" /> 添置设施
          </button>
          <button v-if="needsCleaning(selectedRegion.condition)" class="pm-btn sm ghost" @click="dispatchClean(selectedRegion)">
            <PmIcon name="check" :size="12" /> 派工清洁
          </button>
        </div>

        <section class="presence-board">
          <div class="rg-fac-title">当前在此的人</div>
          <div v-if="selectedRegionStaff.length || selectedRegionVisitors.length" class="presence-list">
            <div v-if="selectedRegionStaff.length" class="presence-group">
              <span class="presence-label">当值员工</span>
              <span v-for="name in selectedRegionStaff" :key="name" class="presence-chip staff">{{ name }}</span>
            </div>
            <div v-if="selectedRegionVisitors.length" class="presence-group">
              <span class="presence-label">在场配角</span>
              <span v-for="item in selectedRegionVisitors" :key="item.heroine.id" class="presence-chip">
                {{ item.heroine.name }}
                <small v-if="item.activity">· {{ item.activity.behaviors.join('、') }}{{ activityRemainingText(item.activity) }}</small>
              </span>
            </div>
          </div>
          <div v-else class="pm-empty compact">暂时没有记录到在场配角。</div>
        </section>

        <section class="staff-board">
          <div class="rg-fac-title">员工分配</div>
          <div class="staff-grid">
            <button
              v-for="h in game.heroines"
              :key="h.id"
              class="staff-chip"
              :class="{ active: selectedWorkerId === h.id }"
              @click="selectedWorkerId = h.id"
            >
              <span>{{ h.name }}</span>
              <small>{{ assignedRegionFor(h)?.name ?? h.located }}</small>
            </button>
          </div>
          <button class="pm-btn sm staff-assign" :disabled="!selectedWorker" @click="assignWorkerToRegion(selectedRegion)">
            <PmIcon name="pin" :size="12" /> 分配到当前区域
          </button>
        </section>

        <section class="rg-fac">
          <div class="rg-fac-title">设施清单</div>
          <div v-for="f in selectedRegion.facilities" :key="f.id" class="rg-fac-item">
            <div class="rg-fac-top">
              <span class="rg-fac-name">{{ f.name }}</span>
              <span class="pm-tag" :class="conditionTone(f.condition)">{{ f.condition }}</span>
              <span v-if="f.priceCopper" class="pm-tag dim">{{ formatCopper(f.priceCopper) }}</span>
            </div>
            <p class="rg-fac-desc">{{ f.description }}</p>
          </div>
        </section>

        <section v-if="selectedRegion.rooms?.length" class="room-list">
          <div class="rg-fac-title">独立房间</div>
          <article v-for="room in selectedRegion.rooms" :key="room.id" class="room-card">
            <header class="room-head">
              <div>
                <strong>{{ room.name }}</strong>
                <span>{{ room.type }} · {{ formatCopper(room.priceCopper) }}/天</span>
              </div>
              <button class="pm-btn sm ghost" @click="openAddFacility(selectedRegion, room)">添置</button>
            </header>
            <div class="room-stats">
              <span>舒适 {{ room.comfort }}</span>
              <span>隐私 {{ room.privacy }}</span>
              <span>清洁 {{ room.cleanliness }}</span>
            </div>
            <div v-if="room.facilities.length" class="room-facs">
              <span v-for="f in room.facilities" :key="f.id" class="pm-tag">{{ f.name }}</span>
            </div>
            <div v-else class="pm-empty compact">暂无独立设施，等待玩家亲自添置。</div>
          </article>
        </section>
      </aside>
    </div>

    <!-- 添置设施弹窗 -->
    <Teleport to="body">
      <div v-if="addOpen" class="pm-modal-mask" @click.self="addOpen = false">
        <div class="pm-modal">
          <header class="pm-modal-head">
            <h3>
              <PmIcon name="hammer" :size="16" />
              添置设施 · {{ addRoomTarget ? `${addTarget?.name} · ${addRoomTarget.name}` : addTarget?.name }}
            </h3>
            <button class="pm-link" @click="addOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <label class="pm-field">
              <span>设施名称</span>
              <input v-model="newFacility.name" class="pm-input" placeholder="例如: 厚窗帘、写字桌、香料柜、告示板" />
            </label>
            <label class="pm-field">
              <span>外观 / 材质</span>
              <input v-model="newFacility.style" class="pm-input" placeholder="例如: 烟熏橡木、黄铜包角、深绿绒布" />
            </label>
            <label class="pm-field">
              <span>花费铜币</span>
              <input v-model.number="newFacility.costCopper" type="number" min="0" class="pm-input" />
            </label>
            <label class="pm-field">
              <span>叙事备注</span>
              <textarea
                v-model="newFacility.note"
                class="pm-textarea"
                placeholder="这件设施会让区域发生什么变化？例如: 让雨夜旅人一推门就看见炉火。"
              ></textarea>
            </label>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="addOpen = false">取消</button>
            <button class="pm-btn" @click="applyAddFacility">写入添置行动</button>
          </footer>
        </div>
      </div>
    </Teleport>

    <!-- 经营快进弹窗 -->
    <Teleport to="body">
      <div v-if="fastForward.open" class="pm-modal-mask" @click.self="fastForward.open = false">
        <div class="pm-modal">
          <header class="pm-modal-head">
            <h3>
              <PmIcon name="hourglass" :size="16" />
              经营快进 · 客流与收成结算
            </h3>
            <button class="pm-link" @click="fastForward.open = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="pm-modal-body">
            <label class="pm-field">
              <span>时长 (小时)</span>
              <div class="ff-row">
                <input v-model.number="fastForward.hours" type="number" min="1" max="12" class="pm-input small" />
                <span class="pm-dim">推荐 2 ~ 6 小时</span>
              </div>
            </label>
            <label class="pm-field">
              <span>营业风格</span>
              <div class="ff-tabs">
                <button
                  v-for="opt in ['低调', '正常', '热闹', '通宵']"
                  :key="opt"
                  class="pm-btn sm"
                  :class="{ ghost: fastForward.intensity !== opt }"
                  @click="fastForward.intensity = opt as any"
                >
                  {{ opt }}
                </button>
              </div>
            </label>
            <div class="pm-divider">预算估算</div>
            <ul class="ff-est">
              <li>预计客流: <strong>{{ Math.floor(fastForward.hours * 7 * (({ '低调': 0.6, '正常': 1, '热闹': 1.5, '通宵': 2.2 } as Record<string, number>)[fastForward.intensity])) }}</strong> 位</li>
              <li>预计净收入: <strong>{{ Math.floor(fastForward.hours * 1200 * (({ '低调': 0.6, '正常': 1, '热闹': 1.5, '通宵': 2.2 } as Record<string, number>)[fastForward.intensity])) }}</strong> 铜</li>
              <li>预计精力消耗: <strong>{{ Math.floor(fastForward.hours * 4 * (({ '低调': 0.6, '正常': 1, '热闹': 1.5, '通宵': 2.2 } as Record<string, number>)[fastForward.intensity])) }}</strong></li>
            </ul>
          </div>
          <footer class="pm-modal-foot">
            <button class="pm-btn ghost" @click="fastForward.open = false">取消</button>
            <button class="pm-btn" @click="runFastForward">开始营业</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.business-strip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--pm-line-soft);
  border-radius: 4px;
  background: var(--pm-dark-panel-soft);
  color: var(--pm-muted);
  font-size: 12px;
}
.business-strip.open {
  border-color: rgba(94, 142, 82, 0.62);
  color: var(--pm-ink);
}
.business-state {
  font-weight: 700;
  color: var(--pm-gold);
}
.guest-cap {
  width: 54px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--pm-line-soft);
  border-radius: 4px;
  background: var(--pm-parch-bright);
  color: var(--pm-ink);
}
.visitor-chance {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--pm-muted);
  white-space: nowrap;
}
.visitor-chance input {
  width: 46px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--pm-line-soft);
  border-radius: 4px;
  background: var(--pm-parch-bright);
  color: var(--pm-ink);
}
.visitor-note {
  display: grid;
  gap: 4px;
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px dashed var(--pm-line-soft);
  border-radius: 4px;
  background: var(--pm-dark-panel-soft);
}
.visitor-note span {
  font-size: 11px;
  color: var(--pm-muted);
}
.visitor-note strong {
  font-weight: 500;
  line-height: 1.7;
}

.tavern-board {
  display: grid;
  grid-template-columns: minmax(360px, 0.95fr) minmax(340px, 1.05fr);
  gap: 14px;
  align-items: start;
}
.region-panel {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 2px solid rgba(80, 52, 24, 0.46);
  border-radius: 4px;
  background:
    radial-gradient(circle at 20% 10%, rgba(255, 255, 255, 0.26), transparent 36%),
    linear-gradient(180deg, rgba(255, 245, 215, 0.82), rgba(212, 186, 136, 0.58));
  box-shadow: inset 0 0 0 1px rgba(255, 245, 215, 0.4);
}
.tavern-overview {
  padding: 12px;
  border: 1px solid rgba(110, 80, 34, 0.36);
  border-radius: 4px;
  background: rgba(255, 248, 226, 0.5);
}
.overview-kicker {
  margin-bottom: 6px;
  color: var(--pm-gold);
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.tavern-overview p {
  margin: 0;
  color: var(--pm-ink-soft);
  font-size: calc(13px * var(--pm-text-scale));
  line-height: 1.8;
}
.tavern-temp-board,
.region-temp-board {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed rgba(153, 104, 44, 0.48);
  border-radius: 4px;
  background:
    linear-gradient(180deg, rgba(255, 241, 202, 0.62), rgba(207, 168, 88, 0.24)),
    rgba(255, 248, 226, 0.36);
}
.region-temp-board {
  margin-top: -2px;
}
.temp-state-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.temp-state-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid rgba(132, 84, 31, 0.48);
  border-radius: 4px;
  background: rgba(80, 52, 24, 0.1);
  color: var(--pm-ink);
  font-size: calc(12px * var(--pm-text-scale));
  line-height: 1.4;
}
.temp-state-chip strong,
.temp-state-chip em,
.temp-state-chip small {
  min-width: 0;
}
.temp-state-chip strong {
  font-weight: 700;
}
.temp-state-chip em {
  color: var(--pm-gold);
  font-style: normal;
  white-space: nowrap;
}
.temp-state-chip small {
  max-width: 120px;
  overflow: hidden;
  color: var(--pm-ink-dim);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.region-overflow-note {
  padding: 8px 10px;
  border: 1px dashed rgba(153, 104, 44, 0.46);
  border-radius: 4px;
  background: rgba(255, 236, 180, 0.45);
  color: var(--pm-ink-dim);
  font-size: calc(12px * var(--pm-text-scale));
  line-height: 1.6;
}
.region-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  gap: 8px;
}
.region-list.compact {
  grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
}
.region-card {
  position: relative;
  display: grid;
  grid-template-columns: 28px 1fr;
  grid-template-rows: auto auto auto;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  min-height: 92px;
  padding: 10px;
  border: 1px solid rgba(87, 57, 26, 0.54);
  border-radius: 4px;
  background: rgba(255, 248, 226, 0.52);
  color: var(--pm-ink);
  text-align: left;
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.52);
}
.region-card:hover,
.region-card.active {
  border-color: rgba(130, 84, 31, 0.92);
  background: linear-gradient(180deg, rgba(246, 222, 159, 0.86), rgba(209, 166, 82, 0.64));
}
.region-card.worn::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-top: 1px dashed rgba(92, 47, 28, 0.4);
  transform: rotate(-10deg);
  pointer-events: none;
}
.region-card-icon {
  grid-row: 1 / 4;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: rgba(80, 52, 24, 0.12);
  color: var(--pm-gold);
}
.region-card strong {
  font-family: var(--pm-font-display);
  font-size: calc(15px * var(--pm-text-scale));
  letter-spacing: 0.08em;
  min-width: 0;
}
.region-card span:not(.region-card-icon),
.region-card em {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  font-style: normal;
}
.region-detail {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(110, 80, 34, 0.44);
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(255, 245, 215, 0.78), rgba(212, 186, 136, 0.54));
}
.rg-head {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 10px;
}
.region-detail :deep(.pm-tag.condition-宕柊),
.rg-fac-item :deep(.pm-tag.condition-宕柊) {
  background: var(--pm-grad-gold);
  border-color: var(--pm-gold-dim);
  color: var(--pm-text-on-gold);
}
.region-detail :deep(.pm-tag.condition-鏁存磥),
.rg-fac-item :deep(.pm-tag.condition-鏁存磥) {
  background: var(--pm-status-clean-bg);
  border-color: var(--pm-status-clean-border);
  color: var(--pm-status-clean-text);
}
.region-detail :deep(.pm-tag.condition-鑹ソ),
.rg-fac-item :deep(.pm-tag.condition-鑹ソ) {
  background: var(--pm-status-good-bg);
  border-color: var(--pm-status-good-border);
  color: var(--pm-status-good-text);
}
.region-detail :deep(.pm-tag.condition-蹇欎贡),
.rg-fac-item :deep(.pm-tag.condition-蹇欎贡) {
  background: var(--pm-status-warn-bg);
  border-color: var(--pm-status-warn-border);
  color: var(--pm-status-warn-text);
}
.region-detail :deep(.pm-tag.condition-鑲剰),
.rg-fac-item :deep(.pm-tag.condition-鑲剰) {
  background: var(--pm-status-neutral-bg);
  border-color: var(--pm-status-neutral-border);
  color: var(--pm-status-neutral-text);
}
.region-detail :deep(.pm-tag.condition-鐮存崯),
.rg-fac-item :deep(.pm-tag.condition-鐮存崯) {
  background: var(--pm-status-bad-bg);
  border-color: var(--pm-status-bad-border);
  color: var(--pm-status-bad-text);
}
.region-detail :deep(.pm-tag.condition-鍋滅敤),
.rg-fac-item :deep(.pm-tag.condition-鍋滅敤) {
  background: var(--pm-status-neutral-bg);
  border-color: var(--pm-status-neutral-border);
  color: var(--pm-status-neutral-text);
}
.region-detail :deep(.pm-tag.condition-升级中),
.rg-fac-item :deep(.pm-tag.condition-升级中) {
  background: var(--pm-status-magic-bg);
  border-color: var(--pm-status-magic-border);
  color: var(--pm-status-magic-text);
}
.rg-emblem {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 245, 215, 0.6), transparent 60%),
    var(--pm-grad-gold);
  border: 1px solid rgba(110, 80, 34, 0.6);
  color: var(--pm-text-on-gold);
  display: grid;
  place-items: center;
  box-shadow: inset 0 1px 0 rgba(255, 245, 215, 0.45);
}
.rg-title h3 {
  margin: 0;
  font-family: var(--pm-font-display);
  font-size: calc(15px * var(--pm-text-scale));
  letter-spacing: 0.06em;
  color: var(--pm-ink);
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.rg-title .lv {
  font-family: var(--pm-font-num);
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-ink-dim);
}
.rg-sub {
  font-size: calc(11.5px * var(--pm-text-scale));
  color: var(--pm-ink-dim);
}
.rg-desc {
  font-size: calc(12.5px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
  line-height: 1.7;
}
.rg-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.presence-board {
  padding: 8px;
  border: 1px dashed rgba(110, 80, 34, 0.38);
  border-radius: 4px;
  background: rgba(255, 248, 226, 0.36);
}
.presence-list,
.presence-group {
  display: grid;
  gap: 6px;
}
.presence-group {
  grid-template-columns: 74px 1fr;
  align-items: start;
}
.presence-label {
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 24px;
}
.presence-chip {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid rgba(110, 80, 34, 0.34);
  border-radius: 999px;
  background: rgba(255, 252, 239, 0.68);
  color: var(--pm-ink);
  font-size: calc(11.5px * var(--pm-text-scale));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
.presence-chip.staff {
  background: rgba(232, 199, 124, 0.48);
  border-color: rgba(122, 84, 31, 0.5);
}
.presence-chip small {
  color: var(--pm-ink-soft);
}
.staff-board {
  padding: 8px;
  border: 1px dashed rgba(110, 80, 34, 0.42);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.42);
}
.staff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 6px;
}
.staff-chip {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgba(110, 80, 34, 0.42);
  border-radius: 4px;
  background: rgba(255, 248, 226, 0.58);
  color: var(--pm-ink);
  text-align: left;
}
.staff-chip:hover,
.staff-chip.active {
  border-color: rgba(130, 84, 31, 0.9);
  background: linear-gradient(180deg, rgba(246, 222, 159, 0.82), rgba(209, 166, 82, 0.56));
}
.staff-chip span,
.staff-chip small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.staff-chip span {
  font-weight: 700;
}
.staff-chip small {
  color: var(--pm-ink-dim);
  font-size: calc(10.5px * var(--pm-text-scale));
}
.staff-assign {
  width: 100%;
  justify-content: center;
  margin-top: 7px;
}

.rg-fac {
  margin-top: 0;
  padding: 8px;
  border-radius: 10px;
  border: 1px dashed rgba(110, 80, 34, 0.45);
  background: rgba(255, 245, 215, 0.45);
}
.rg-fac-title {
  font-family: var(--pm-font-display);
  letter-spacing: 0.16em;
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-ink-dim);
  text-transform: uppercase;
  margin-bottom: 6px;
}
.rg-fac-item {
  padding: 6px 0;
  border-bottom: 1px dashed rgba(110, 80, 34, 0.25);
}
.rg-fac-item:last-child {
  border-bottom: none;
}
.rg-fac-top {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.rg-fac-name {
  font-weight: 600;
  color: var(--pm-ink);
}
.rg-fac-desc {
  margin-top: 3px;
  font-size: calc(11.5px * var(--pm-text-scale));
  color: var(--pm-ink-dim);
  line-height: 1.55;
}
.add-line {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 7px 10px;
  border: 1px dashed rgba(110, 80, 34, 0.55);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.38);
  color: var(--pm-ink-soft);
  font-weight: 700;
}
.room-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.room-card {
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid rgba(110, 80, 34, 0.34);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.5);
}
.room-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
.room-head div {
  display: grid;
  gap: 2px;
}
.room-head strong {
  color: var(--pm-ink);
}
.room-head span,
.room-stats {
  color: var(--pm-ink-dim);
  font-size: calc(11px * var(--pm-text-scale));
}
.room-stats,
.room-facs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pm-empty.compact {
  padding: 6px;
  min-height: 0;
  font-size: calc(11px * var(--pm-text-scale));
}

.big-lv {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-family: var(--pm-font-display);
  font-size: calc(20px * var(--pm-text-scale));
  letter-spacing: 0.1em;
  color: var(--pm-ink);
}
.big-lv .cur {
  color: var(--pm-ink-fade);
}
.big-lv .new {
  color: var(--pm-gold-dim);
  text-shadow: 0 0 12px rgba(201, 160, 74, 0.5);
}

.ff-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.pm-input.small {
  width: 90px;
}
.ff-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ff-est {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 6px;
  font-size: calc(13px * var(--pm-text-scale));
  color: var(--pm-ink);
}
.ff-est strong {
  font-family: var(--pm-font-num);
  color: var(--pm-gold-dim);
}
@media (max-width: 1100px) {
  .tavern-board {
    grid-template-columns: 1fr;
  }
  .region-detail {
    position: static;
  }
}
@media (max-width: 720px) {
  #page-tavern :deep(.pm-paper-head) {
    display: grid;
    gap: 10px;
    padding: 12px 12px 10px;
  }
  #page-tavern :deep(.pm-paper-head > div:first-child) {
    min-width: 0;
  }
  .head-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    width: 100%;
    gap: 7px;
  }
  .business-strip {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: auto auto 48px minmax(0, 1fr);
    gap: 6px;
    width: 100%;
    min-height: 32px;
    padding: 5px 7px;
    overflow: hidden;
  }
  .business-strip,
  .visitor-chance {
    font-size: calc(10.5px * var(--pm-text-scale));
  }
  .guest-cap,
  .visitor-chance input {
    width: 42px;
    height: 22px;
    padding: 0 4px;
  }
  .head-actions > .pm-btn {
    width: 100%;
    min-width: 0;
    justify-content: center;
    padding-inline: 8px;
  }
  .tavern-board {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .region-panel {
    padding: 9px;
    border-width: 1px;
  }
  .tavern-overview {
    padding: 9px;
  }
  .region-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }
  .region-list::-webkit-scrollbar {
    display: none;
  }
  .region-card {
    flex: 0 0 142px;
    min-height: 78px;
    padding: 8px;
    border-width: 1px;
    grid-template-columns: 24px 1fr;
  }
  .region-card-icon {
    width: 24px;
    height: 24px;
  }
  .region-card strong {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: calc(12px * var(--pm-text-scale));
    letter-spacing: 0;
  }
  .region-card span:not(.region-card-icon),
  .region-card em {
    font-size: calc(10px * var(--pm-text-scale));
  }
  .region-card em,
  .region-card.worn::after {
    display: none;
  }
  .region-detail {
    padding: 9px;
    gap: 7px;
  }
  .rg-head {
    grid-template-columns: 34px minmax(0, 1fr) auto;
    gap: 7px;
  }
  .rg-emblem {
    width: 34px;
    height: 34px;
    border-radius: 9px;
  }
  .rg-title h3 {
    font-size: calc(13.5px * var(--pm-text-scale));
  }
  .rg-desc {
    font-size: calc(11.5px * var(--pm-text-scale));
    line-height: 1.55;
    margin: 0;
  }
  .presence-group {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .staff-grid {
    grid-template-columns: 1fr;
  }
  .room-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
