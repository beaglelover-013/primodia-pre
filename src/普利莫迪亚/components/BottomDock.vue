<script setup lang="ts">
import { useGameStore, type EngineLog } from '../stores/game';
import PmIcon from './PmIcon.vue';

const game = useGameStore();
const logsRef = ref<HTMLElement | null>(null);
const logsOpen = ref(false);
const mobileDetailsOpen = ref(false);

const visibleLogs = computed(() => game.engineLogs.slice(0, 12));
const hasAttentionLog = computed(() => visibleLogs.value.some(log => log.tone === 'red' || log.tone === 'amber' || log.kind === '提示'));

function clearDraft() {
  game.clearDraftActions();
  game.playerInput = '';
}

function removeLog(id: string) {
  game.removeLog(id);
}

async function send() {
  await game.sendActionDraft();
}

async function handlePlayerInputKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  if (game.isGenerating || !game.turnContextWorldbookReady || (!game.actionDraft.trim() && !game.playerInput.trim())) return;
  await send();
}

async function previewBeforeSend() {
  await game.previewActionDraftBeforeSend();
}

function logKindClass(kind: EngineLog['kind']) {
  switch (kind) {
    case '结算':
      return 'good';
    case '扣减':
      return 'bad';
    case '奖励':
      return 'good';
    case '叙事':
      return 'violet';
    case '提示':
      return 'warn';
    default:
      return 'dim';
  }
}

function logSourceLabel(log: EngineLog) {
  if (log.source === 'player') return '玩家';
  if (log.source === 'engine') return '规则';
  if (log.source === 'ai') return 'AI';
  return '系统';
}

function logSourceClass(log: EngineLog) {
  if (log.authoritative === false) return 'violet';
  if (log.source === 'player') return 'gold';
  if (log.tone === 'red') return 'bad';
  if (log.tone === 'amber') return 'warn';
  if (log.tone === 'green') return 'good';
  return 'dim';
}

function logTitle(log: EngineLog) {
  return log.authoritative === false ? 'AI叙事: 只用于呈现，不作为规则存档。' : '前端权威记录: 由玩家提交或脚本结算。';
}
</script>

<template>
  <footer class="dock" :class="{ 'logs-open': logsOpen, 'mobile-details-open': mobileDetailsOpen }">
    <!-- 左侧引擎日志 -->
    <section class="dock-logs" :class="{ collapsed: !logsOpen }">
      <button class="log-toggle" :class="{ attention: hasAttentionLog }" type="button" @click="logsOpen = !logsOpen">
        <PmIcon name="scroll" :size="14" />
        <span>{{ logsOpen ? '收起日志' : '日志' }}</span>
        <i>{{ game.engineLogs.length }}</i>
      </button>
      <div v-if="logsOpen" ref="logsRef" class="logs">
        <div v-for="log in visibleLogs" :key="log.id" class="log-line">
          <span class="log-time">{{ log.at }}</span>
          <span class="pm-tag" :class="logKindClass(log.kind)">{{ log.kind }}</span>
          <span class="pm-tag source" :class="logSourceClass(log)" :title="logTitle(log)">{{ logSourceLabel(log) }}</span>
          <span class="log-text" :title="logTitle(log)">{{ log.text }}</span>
          <button class="log-remove" title="删除这条记录" @click="removeLog(log.id)">×</button>
        </div>
      </div>
    </section>

    <!-- 右侧行动草稿 + 玩家输入 -->
    <section class="dock-input">
      <div class="dock-head">
        <PmIcon name="flourish" :size="14" />
        <span>你决定做些什么</span>
        <button class="mobile-panel-toggle" :class="{ attention: hasAttentionLog }" type="button" @click="mobileDetailsOpen = !mobileDetailsOpen">
          {{ mobileDetailsOpen ? '收起' : '详情' }}
        </button>
        <button v-if="game.draftActions.length || game.playerInput" id="dock-clear-draft" class="pm-link" @click="clearDraft">清空</button>
      </div>
      <div id="dock-draft" class="draft-list" :class="{ empty: game.draftActions.length === 0 }">
        <article v-for="action in game.draftActions" :key="action.id" class="draft-line">
          <span>{{ action.text }}</span>
          <button :disabled="game.isGenerating" title="删除并撤销这条行动" @click="game.removeDraftAction(action.id)">×</button>
        </article>
        <div v-if="game.draftActions.length === 0" class="draft-empty">每一次选择、采购、做菜、交谈都会写到这里。发送后，叙事会根据这些决定继续。</div>
      </div>

      <div class="dock-row">
        <label class="dock-input-wrap pm-field">
          <textarea
            id="dock-player"
            v-model="game.playerInput"
            class="pm-textarea narrate"
            :disabled="game.isGenerating"
            placeholder="你还想补充什么……"
            @keydown="handlePlayerInputKeydown"
          ></textarea>
        </label>
        <div class="dock-actions">
          <button id="dock-preflight" class="pm-btn big" :disabled="game.isGenerating || (!game.actionDraft.trim() && !game.playerInput.trim())" @click="previewBeforeSend">
            <PmIcon name="scroll" :size="14" />
            <span>发送前预检</span>
          </button>
          <button id="dock-send" class="pm-btn dark big" :disabled="game.isGenerating || !game.turnContextWorldbookReady || (!game.actionDraft.trim() && !game.playerInput.trim())" @click="send">
            <PmIcon name="send" :size="14" />
            <span>{{ game.isGenerating ? '生成中' : '发出决定' }}</span>
          </button>
          <div class="dock-tips">
            <div v-if="!game.turnContextWorldbookReady"><span class="pm-tag warn">提示</span>本回合发送包条目未绑定，请到设置页创建并绑定固定条目。</div>
            <div><span class="pm-tag dim">提示</span>这里负责记录<strong>你决定做什么</strong>。</div>
            <div><span class="pm-tag dim">提示</span>正文会在下一回合继续展开。</div>
          </div>
        </div>
      </div>
    </section>
  </footer>
</template>

<style scoped>
.dock {
  position: relative;
  display: grid;
  grid-template-columns: 86px 1fr;
  gap: 0;
  max-height: 260px;
  min-height: 205px;
  overflow: hidden;
  background: var(--pm-dock-bg);
  border-top: 1px solid var(--pm-edge-soft);
  box-shadow: 0 -10px 22px -10px rgba(0, 0, 0, 0.55);
  color: var(--pm-parch);
}
.dock.logs-open {
  grid-template-columns: minmax(260px, 0.85fr) 1.4fr;
}
.dock::before {
  content: '';
  position: absolute;
  top: 4px;
  left: 22px;
  right: 22px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--pm-line-bright), transparent);
  pointer-events: none;
}

.dock-logs,
.dock-input {
  min-height: 0;
  padding: 10px 18px 12px;
}
.dock-logs {
  border-right: 1px dashed var(--pm-line-soft);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
}
.dock-logs.collapsed {
  padding: 10px 8px 12px;
  align-items: center;
  justify-content: center;
}
.log-toggle {
  min-height: 36px;
  border: 1px solid var(--pm-line-soft);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  color: var(--pm-parch-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 10px;
  cursor: pointer;
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.08em;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
}
.log-toggle:hover,
.log-toggle.attention {
  border-color: var(--pm-line-bright);
  background: rgba(201, 160, 74, 0.16);
  color: var(--pm-gold-bright);
}
.log-toggle i {
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.22);
  font-family: var(--pm-font-num);
  font-size: calc(10px * var(--pm-text-scale));
  font-style: normal;
}

.dock-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-family: var(--pm-font-display);
  letter-spacing: 0.18em;
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-parch-soft);
  text-transform: uppercase;
}
.dock-head .pm-link {
  margin-left: auto;
  color: var(--pm-gold-bright);
}
.mobile-panel-toggle {
  display: none;
}

.logs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: calc(12px * var(--pm-text-scale));
  color: var(--pm-parch-soft);
  max-height: 128px;
  overflow-y: auto;
  padding-right: 4px;
}
.log-line {
  display: grid;
  grid-template-columns: 92px 60px 52px 1fr 24px;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--pm-line-faint);
}
.pm-tag.source {
  min-width: 42px;
  justify-content: center;
}
.log-time {
  font-family: var(--pm-font-num);
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-parch-soft);
  letter-spacing: 0.04em;
}
.log-text {
  color: var(--pm-parch);
  line-height: 1.5;
}
.log-remove {
  width: 22px;
  height: 22px;
  border: 1px solid var(--pm-line-faint);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
  color: var(--pm-parch-soft);
  cursor: pointer;
  opacity: 0.72;
}
.log-remove:hover {
  border-color: var(--pm-line-bright);
  color: var(--pm-gold-bright);
  background: var(--pm-dark-panel-soft);
}

/* 草稿区 */
.dock-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.draft-list {
  min-height: 44px;
  max-height: 68px;
  overflow-y: auto;
  display: grid;
  gap: 4px;
  padding: 6px;
  background: var(--pm-dark-panel-soft);
  color: var(--pm-parch-bright);
  border: 1px solid var(--pm-line-soft);
  border-radius: 4px;
  font-family: var(--pm-font-body);
  font-size: calc(12.5px * var(--pm-text-scale));
}
.draft-empty {
  color: var(--pm-parch-soft);
  font-style: italic;
  line-height: 1.6;
}
.dock-input-wrap .narrate:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.draft-line {
  display: grid;
  grid-template-columns: 1fr 24px;
  gap: 6px;
  align-items: start;
  padding: 5px 6px;
  border: 1px solid var(--pm-line-faint);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
  color: var(--pm-parch);
  line-height: 1.45;
}
.draft-line button {
  width: 22px;
  height: 22px;
  border: 1px solid var(--pm-line-faint);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
  color: var(--pm-parch-soft);
  cursor: pointer;
}
.draft-line button:hover {
  border-color: var(--pm-line-bright);
  color: var(--pm-gold-bright);
  background: var(--pm-dark-panel-soft);
}
.draft-line button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dock-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: stretch;
  min-height: 0;
}
.dock-input-wrap {
  position: relative;
  margin: 0;
  min-height: 0;
}
.dock-input-wrap .narrate {
  min-height: 48px;
  max-height: 74px;
  background: var(--pm-dark-panel-soft);
  color: var(--pm-parch);
  border: 1px dashed var(--pm-line-soft);
}
.dock-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: space-between;
  min-width: 180px;
}
.pm-btn.big {
  font-size: calc(13.5px * var(--pm-text-scale));
  padding: 10px 14px;
  justify-content: center;
}
.dock-tips {
  display: grid;
  gap: 4px;
  font-size: calc(11px * var(--pm-text-scale));
  color: rgba(243, 220, 162, 0.6);
  line-height: 1.5;
}
.dock-tips strong {
  color: var(--pm-gold-bright);
}

@media (max-width: 720px) {
  .dock {
    grid-template-columns: 1fr;
    min-height: 0;
    max-height: 48vh;
  }
  .dock.logs-open {
    grid-template-columns: 1fr;
  }
  .dock-logs {
    border-right: none;
    border-bottom: 1px dashed rgba(243, 220, 162, 0.2);
  }
  .dock-logs.collapsed {
    display: none;
  }
  .dock.mobile-details-open .dock-logs.collapsed {
    display: flex;
    align-items: flex-start;
    padding: 7px 10px 0;
  }
  .dock-input {
    padding: 8px 10px 10px;
    gap: 6px;
  }
  .dock-head {
    width: 100%;
    margin-bottom: 0;
    letter-spacing: 0.08em;
    font-size: calc(10.5px * var(--pm-text-scale));
  }
  .mobile-panel-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 26px;
    margin-left: auto;
    padding: 3px 8px;
    border: 1px solid var(--pm-line-soft);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.16);
    color: var(--pm-parch-soft);
    font-family: var(--pm-font-display);
    font-size: calc(10px * var(--pm-text-scale));
  }
  .mobile-panel-toggle.attention {
    color: var(--pm-gold-bright);
    border-color: var(--pm-line-bright);
    background: rgba(201, 160, 74, 0.14);
  }
  .dock-head .pm-link {
    margin-left: 0;
  }
  .dock:not(.mobile-details-open) .draft-list,
  .dock:not(.mobile-details-open) #dock-preflight,
  .dock:not(.mobile-details-open) .dock-tips {
    display: none;
  }
  .dock.mobile-details-open .draft-list {
    max-height: 92px;
  }
  .dock-row {
    grid-template-columns: 1fr auto;
    gap: 7px;
  }
  .dock-input-wrap .narrate {
    min-height: 42px;
    max-height: 42px;
    padding: 9px 10px;
    resize: none;
  }
  .dock-actions {
    min-width: 84px;
    gap: 6px;
  }
  .dock-actions .pm-btn.big {
    min-height: 42px;
    padding: 8px 10px;
    font-size: calc(12px * var(--pm-text-scale));
  }
  .log-line {
    grid-template-columns: 92px 56px 48px 1fr;
  }
}
</style>
