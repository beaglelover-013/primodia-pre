<script setup lang="ts">
import { computed, ref } from 'vue';
import PmIcon from '../components/PmIcon.vue';
import { formatCopper, useGameStore, type BusinessAgreement, type TavernStateFormula } from '../stores/game';

const game = useGameStore();
type Section = 'library' | 'maintenance' | 'agreements' | 'records';
const section = ref<Section>('library');

const tabs: Array<{ id: Section; label: string }> = [
  { id: 'library', label: '状态库' },
  { id: 'maintenance', label: '当前维持' },
  { id: 'agreements', label: '长期约定' },
  { id: 'records', label: '经营流水' },
];

const activeMaintenance = computed(() => game.tavernMaintenance.filter(item => item.enabled));
const formulaById = computed(() => new Map(game.tavernStateFormulas.map(item => [item.id, item])));

function maintenanceFor(formula: TavernStateFormula) {
  return game.tavernMaintenance.find(item => item.formulaId === formula.id);
}

function requirementText(formula: TavernStateFormula) {
  return formula.requirements.map(item => `${item.name} ×${item.qty}`).join('、');
}

function agreementKind(agreement: BusinessAgreement) {
  return ({ wage: '员工工资', rent: '房客房费', delivery: '定期送货', sideBusiness: '副业收支' } as const)[agreement.kind];
}

function moneyText(value: number) {
  if (!value) return '无资金变化';
  return `${value > 0 ? '收入' : '支出'} ${formatCopper(Math.abs(value))}`;
}

function inventoryText(agreement: BusinessAgreement) {
  if (!agreement.inventoryChanges.length) return '';
  return agreement.inventoryChanges.map(item => `${item.name} ${item.qty > 0 ? '+' : ''}${item.qty}`).join('、');
}

function recordDate(daySerial: number) {
  const adjusted = Math.max(0, Math.floor(daySerial) - 1);
  const year = Math.floor(adjusted / 360);
  const withinYear = adjusted % 360;
  const monthIndex = Math.floor(withinYear / 30);
  const day = (withinYear % 30) + 1;
  return `${year}年 · ${game.months[monthIndex] ?? '未知月'} · 第${day}日`;
}
</script>

<template>
  <section id="page-operations" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title"><PmIcon name="ledger" :size="22" /> 经营附录</h2>
        <div class="sub">解锁状态 · 维持消耗 · 每日约定 · 收支记录</div>
      </div>
      <div class="operation-summary">
        <span>已解锁 <strong>{{ game.tavernStateFormulas.length }}</strong></span>
        <span>维持中 <strong>{{ activeMaintenance.length }}</strong></span>
        <span>约定 <strong>{{ game.businessAgreements.filter(item => item.enabled).length }}</strong></span>
        <button class="pm-btn sm ghost" type="button" @click="game.refreshCapturedFormatsFromLatestMessage('tavernState')">
          <PmIcon name="refresh" :size="12" /> 刷新状态
        </button>
        <button class="pm-btn sm ghost" type="button" @click="game.refreshCapturedFormatsFromLatestMessage('businessAgreement')">
          <PmIcon name="refresh" :size="12" /> 刷新经营约定
        </button>
      </div>
    </header>

    <div class="pm-paper-body operations-body">
      <nav class="operations-tabs" aria-label="经营附录分类">
        <button v-for="tab in tabs" :key="tab.id" :class="{ active: section === tab.id }" @click="section = tab.id">
          {{ tab.label }}
        </button>
      </nav>

      <section v-if="section === 'library'" class="entry-list">
        <div v-if="!game.tavernStateFormulas.length" class="pm-empty">
          还没有解锁经营状态。把库房物品用于酒馆区域，并在故事中形成可持续效果后，会自动收录在这里。
        </div>
        <article v-for="formula in game.tavernStateFormulas" :key="formula.id" class="operation-entry">
          <header>
            <div><h3>{{ formula.name }}</h3><span class="pm-tag gold">{{ formula.targetRegion }}</span></div>
            <label class="switch-line">
              <input type="checkbox" :checked="maintenanceFor(formula)?.enabled" @change="game.setMaintenanceEnabled(maintenanceFor(formula)?.id ?? '', ($event.target as HTMLInputElement).checked)" />
              <span>{{ maintenanceFor(formula)?.enabled ? '维持中' : '未启用' }}</span>
            </label>
          </header>
          <p>{{ formula.description }}</p>
          <div class="entry-meta"><span>每回合用料</span><strong>{{ requirementText(formula) }}</strong></div>
          <div v-if="formula.guestResponseHint" class="guest-hint">客人感受：{{ formula.guestResponseHint }}</div>
          <footer><button class="pm-link danger" @click="game.deleteTavernStateFormula(formula.id)">删除记录</button></footer>
        </article>
      </section>

      <section v-else-if="section === 'maintenance'" class="entry-list">
        <div v-if="!activeMaintenance.length" class="pm-empty">当前没有主动维持的酒馆状态。</div>
        <article v-for="entry in activeMaintenance" :key="entry.id" class="operation-entry" :class="entry.status">
          <header>
            <div><h3>{{ formulaById.get(entry.formulaId)?.name ?? '失效记录' }}</h3><span class="pm-tag">{{ formulaById.get(entry.formulaId)?.targetRegion }}</span></div>
            <span class="status-text">{{ entry.status === 'shortage' ? '物资不足' : '正常维持' }}</span>
          </header>
          <p>{{ formulaById.get(entry.formulaId)?.description }}</p>
          <div class="entry-meta"><span>下回合消耗</span><strong>{{ formulaById.get(entry.formulaId) ? requirementText(formulaById.get(entry.formulaId)!) : '未知' }}</strong></div>
          <div v-if="entry.pauseReason" class="shortage-note">{{ entry.pauseReason }}</div>
          <footer><button class="pm-btn sm ghost" @click="game.setMaintenanceEnabled(entry.id, false)">停止维持</button></footer>
        </article>
      </section>

      <section v-else-if="section === 'agreements'" class="entry-list">
        <div v-if="!game.businessAgreements.length" class="pm-empty">还没有长期约定。故事中明确谈妥工资、房费、送货或副业收支后，会记录在这里。</div>
        <article v-for="agreement in game.businessAgreements" :key="agreement.id" class="operation-entry" :class="{ disabled: !agreement.enabled }">
          <header>
            <div><h3>{{ agreement.name }}</h3><span class="pm-tag gold">{{ agreementKind(agreement) }}</span></div>
            <label class="switch-line"><input type="checkbox" :checked="agreement.enabled" @change="game.setBusinessAgreementEnabled(agreement.id, ($event.target as HTMLInputElement).checked)" /><span>{{ agreement.enabled ? '执行中' : '已暂停' }}</span></label>
          </header>
          <p>{{ agreement.reminder }}</p>
          <div class="agreement-grid">
            <span><small>约定对象</small><strong>{{ agreement.counterparty }}</strong></span>
            <span><small>周期</small><strong>每日一次</strong></span>
            <span><small>钱匣</small><strong>{{ moneyText(agreement.cashboxDeltaCopper) }}</strong></span>
            <span v-if="inventoryText(agreement)"><small>库房</small><strong>{{ inventoryText(agreement) }}</strong></span>
          </div>
          <footer><button class="pm-link danger" @click="game.deleteBusinessAgreement(agreement.id)">删除约定</button></footer>
        </article>
      </section>

      <section v-else class="record-list">
        <div v-if="!game.businessSettlementRecords.length" class="pm-empty">还没有经营流水。</div>
        <article v-for="record in game.businessSettlementRecords" :key="record.id" class="record-line" :class="record.status">
          <span class="record-mark"><PmIcon :name="record.status === 'success' ? 'check' : 'x'" :size="13" /></span>
          <div><strong>{{ record.text }}</strong><small>{{ recordDate(record.daySerial) }} · 回合 {{ record.turn }}</small></div>
          <div class="record-values">
            <span v-if="record.moneyDeltaCopper">{{ record.moneyDeltaCopper > 0 ? '+' : '-' }}{{ formatCopper(Math.abs(record.moneyDeltaCopper)) }}</span>
            <span v-for="change in record.inventoryChanges" :key="`${change.name}-${change.qty}`">{{ change.name }} {{ change.qty > 0 ? '+' : '' }}{{ change.qty }}</span>
          </div>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.operations-body { display: grid; gap: 12px; }
.operation-summary { display: flex; flex-wrap: wrap; gap: 8px; }
.operation-summary span { padding: 6px 9px; border: 1px solid rgba(110,80,34,.35); border-radius: 4px; color: var(--pm-ink-dim); }
.operations-tabs { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); border-bottom: 1px solid rgba(110,80,34,.35); }
.operations-tabs button { min-height: 42px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: var(--pm-ink-dim); font-weight: 700; }
.operations-tabs button.active { border-bottom-color: var(--pm-gold); color: var(--pm-ink); background: rgba(202,153,55,.12); }
.entry-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
.operation-entry { display: grid; gap: 9px; padding: 13px; border: 1px solid rgba(110,80,34,.38); border-radius: 4px; background: rgba(255,247,222,.42); }
.operation-entry header, .operation-entry header > div, .operation-entry footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.operation-entry header > div { justify-content: flex-start; flex-wrap: wrap; }
.operation-entry h3, .operation-entry p { margin: 0; }
.operation-entry h3 { font-size: calc(17px * var(--pm-text-scale)); }
.operation-entry p { color: var(--pm-ink-soft); line-height: 1.55; }
.operation-entry.shortage { border-color: var(--pm-status-bad-border); }
.operation-entry.disabled { opacity: .7; }
.switch-line { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; color: var(--pm-ink-dim); }
.entry-meta, .guest-hint, .shortage-note { padding: 7px 9px; background: rgba(255,255,255,.22); border-left: 3px solid rgba(167,121,45,.55); }
.entry-meta { display: flex; justify-content: space-between; gap: 10px; }
.entry-meta span, .agreement-grid small { color: var(--pm-ink-dim); }
.guest-hint { color: var(--pm-ink-soft); }
.shortage-note, .status-text { color: var(--pm-status-bad-text); }
.agreement-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; }
.agreement-grid > span { display: grid; gap: 3px; padding: 7px 9px; border: 1px solid rgba(110,80,34,.24); }
.record-list { display: grid; gap: 6px; }
.record-line { display: grid; grid-template-columns: 30px minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 9px 10px; border-bottom: 1px solid rgba(110,80,34,.28); }
.record-line.skipped { color: var(--pm-status-bad-text); }
.record-line > div { display: grid; gap: 3px; }
.record-line small { color: var(--pm-ink-dim); }
.record-values { display: flex !important; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.record-values span { padding: 3px 6px; border: 1px solid rgba(110,80,34,.3); border-radius: 4px; }
@media (max-width: 860px) {
  .entry-list { grid-template-columns: 1fr; }
  .operations-tabs { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .record-line { grid-template-columns: 26px minmax(0,1fr); }
  .record-values { grid-column: 2; justify-content: flex-start; }
}
</style>
