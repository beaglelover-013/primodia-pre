<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useGameStore, type PromiseMemo } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';
import {
  findNearestShopBefore,
  loadAssistantStoryIndex,
  loadLatestAssistantMaintext,
  parseMaintext,
  type LatestMaintextPayload,
  type ParsedOption,
  type StoryIndexItem,
} from '../utils/messageParser';
import {
  onPrimordiaStoryStreaming,
  onPrimordiaStoryUpdated,
  parseNarrativeMvuMessage,
  runUnifiedNarrativeRequest as runNarrativeRequest,
} from '../utils/unifiedRequest';
import { writePrimordiaStatData } from '../services/mvuDataBridge';

const game = useGameStore();
const latestMessage = ref<LatestMaintextPayload>({ maintext: '', options: [], sum: '' });
const storyIndex = ref<StoryIndexItem[]>([]);
const showOptions = ref(false);
const isReaderOpen = ref(false);
const isLoadOpen = ref(false);
const isFocusMode = ref(false);
const isPromiseRailOpen = ref(false);
const pendingLoadMessageId = ref<number | null>(game.loadedStoryCheckpoint?.messageId ?? null);
const contextMenu = ref<{ x: number; y: number } | null>(null);
const turnActionOpen = ref(false);
const turnActionText = ref('');
const turnActionError = ref('');
const visibleTurnActionMessageId = ref<number | undefined>(undefined);
const pendingTurnActionMessageId = ref<number | undefined>(undefined);
const editingMessage = ref<{
  messageId: number;
  currentText: string;
  fullMessage: string;
  mode: 'maintext' | 'all';
} | null>(null);
const editingTurnAction = ref<{
  userMessageId: number;
  originalText: string;
  currentText: string;
} | null>(null);
let longPressTimer: number | null = null;
let messageEventStops: EventOnReturn[] = [];
let storyStreamingStop: (() => void) | undefined;
let storyUpdatedStop: (() => void) | undefined;

const hasMaintext = computed(() => latestMessage.value.maintext.trim().length > 0);
const storyParagraphs = computed(() =>
  latestMessage.value.maintext
    .split(/\n\s*\n/)
    .map(line => line.trim())
    .filter(Boolean),
);
const parsedOptions = computed(() => latestMessage.value.options.slice(0, 4));
const chapterMark = computed(() =>
  latestMessage.value.messageId === undefined ? '' : `楼层 #${latestMessage.value.messageId}`,
);
const isViewingLoadedLayer = computed(() => pendingLoadMessageId.value !== null);
const isPendingTurnAction = computed(
  () =>
    hasMessageId(pendingTurnActionMessageId.value) &&
    (!hasMessageId(latestMessage.value.messageId) || pendingTurnActionMessageId.value > latestMessage.value.messageId),
);
const readerItems = computed(() => [...storyIndex.value].reverse());
const loadItems = computed(() => [...storyIndex.value].reverse());
const promiseTaskItems = computed(() =>
  game.promiseMemos
    .filter(memo => memo.status === 'pending')
    .slice()
    .sort((a, b) => {
      const dueDelta = Number(game.isPromiseMemoDue(b)) - Number(game.isPromiseMemoDue(a));
      return dueDelta || a.triggerTime.localeCompare(b.triggerTime, 'zh-Hans-CN') || a.name.localeCompare(b.name, 'zh-Hans-CN');
    }),
);

function promisePeopleText(memo: PromiseMemo) {
  return memo.people.length ? memo.people.join('、') : '未标注人物';
}

function promiseReminderPreview(memo: PromiseMemo) {
  const text = memo.reminder.trim() || memo.event.trim();
  return text.length > 84 ? `${text.slice(0, 84)}...` : text;
}

async function copyTextToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('clipboard api unavailable');
    }
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function copyPromiseReminder(memo: PromiseMemo) {
  await copyTextToClipboard(memo.reminder);
  game.pushLog('系统', '约定提醒已复制。');
}

function refreshMaintext(options: { keepLoadedView?: boolean } = {}) {
  if (options.keepLoadedView && (pendingLoadMessageId.value !== null || game.loadedStoryCheckpoint)) {
    if (game.loadedStoryCheckpoint) {
      latestMessage.value = game.loadedStoryCheckpoint;
      pendingLoadMessageId.value = game.loadedStoryCheckpoint.messageId;
    }
    storyIndex.value = loadAssistantStoryIndex();
    refreshTurnAction();
    return;
  }
  latestMessage.value = loadLatestAssistantMaintext();
  storyIndex.value = loadAssistantStoryIndex();
  pendingLoadMessageId.value = null;
  game.setLoadedStoryCheckpoint(null);
  showOptions.value = false;
  contextMenu.value = null;
  refreshTurnAction();
}

function restoreLoadedPreview() {
  if (!game.loadedStoryCheckpoint) return false;
  latestMessage.value = game.loadedStoryCheckpoint;
  pendingLoadMessageId.value = game.loadedStoryCheckpoint.messageId;
  storyIndex.value = loadAssistantStoryIndex();
  showOptions.value = false;
  contextMenu.value = null;
  return true;
}

function openReaderModal() {
  refreshMaintext();
  isReaderOpen.value = true;
}

function openLoadModal() {
  refreshMaintext();
  isLoadOpen.value = true;
}

function hasMessageId(messageId: number | undefined): messageId is number {
  return messageId !== undefined && messageId !== null;
}

function readUserMessageText(userMessageId?: number) {
  if (!hasMessageId(userMessageId)) return '';
  if (typeof getChatMessages !== 'function') return '';
  try {
    const message =
      getChatMessages(userMessageId, { role: 'user', hide_state: 'all' })?.[0] ??
      getChatMessages(userMessageId, { role: 'all', hide_state: 'all' })?.[0] ??
      getChatMessages(userMessageId, { role: 'user' })?.[0] ??
      getChatMessages(userMessageId)?.[0];
    return String(message?.message ?? '').trim();
  } catch {
    return '';
  }
}

function readLatestUserMessageAfter(messageId?: number): { messageId: number; text: string } | null {
  if (!hasMessageId(messageId) || typeof getLastMessageId !== 'function' || typeof getChatMessages !== 'function') return null;
  const lastMessageId = getLastMessageId();
  if (lastMessageId <= messageId) return null;
  try {
    const userMessages = [
      ...(getChatMessages(`${messageId + 1}-${lastMessageId}`, { role: 'user', hide_state: 'all' }) ?? []),
      ...(getChatMessages(`${messageId + 1}-${lastMessageId}`, { role: 'user' }) ?? []),
    ]
      .filter(message => typeof message?.message_id === 'number' && message.message_id > messageId)
      .sort((a, b) => a.message_id - b.message_id);
    const latestUser = userMessages.at(-1);
    if (!latestUser) return null;
    const text = readUserMessageText(latestUser.message_id);
    return text ? { messageId: latestUser.message_id, text } : null;
  } catch {
    return null;
  }
}

function refreshTurnAction() {
  const pendingUser = readLatestUserMessageAfter(latestMessage.value.messageId);
  const userMessageId = pendingUser?.messageId ?? latestMessage.value.userMessageId;
  const text = pendingUser?.text ?? readUserMessageText(userMessageId);
  const previousPendingId = pendingTurnActionMessageId.value;
  visibleTurnActionMessageId.value = userMessageId;
  pendingTurnActionMessageId.value = pendingUser?.messageId;
  turnActionText.value = text;
  turnActionError.value = hasMessageId(userMessageId) && !turnActionText.value ? '未找到本回合行动记录。' : '';
  if (pendingUser && previousPendingId !== pendingUser.messageId) turnActionOpen.value = true;
  if (!turnActionText.value) turnActionOpen.value = false;
}

async function writeUserMessageText(userMessageId: number, text: string, refresh: 'none' | 'affected' = 'none') {
  if (typeof setChatMessages !== 'function') throw new Error('当前环境没有提供楼层修改接口。');
  await setChatMessages([{ message_id: userMessageId, message: text }], { refresh });
}

function clearLongPressTimer() {
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function startLongPress(event: MouseEvent | TouchEvent) {
  if ('touches' in event) return;
  if (contextMenu.value || game.isGenerating || !hasMaintext.value || !hasMessageId(latestMessage.value.messageId))
    return;
  clearLongPressTimer();
  const point = 'touches' in event ? event.touches[0] : event;
  longPressTimer = window.setTimeout(() => {
    contextMenu.value = {
      x: Math.min(point.clientX, window.innerWidth - 220),
      y: Math.min(point.clientY, window.innerHeight - 130),
    };
    longPressTimer = null;
  }, 500);
}

function closeContextMenu() {
  contextMenu.value = null;
}

async function truncateChatAfter(messageId: number): Promise<boolean> {
  if (typeof getLastMessageId !== 'function' || typeof deleteChatMessages !== 'function') {
    game.pushLog('系统', '当前环境没有提供楼层删除接口，无法从旧楼层继续。');
    return false;
  }

  const lastMessageId = getLastMessageId();
  if (lastMessageId <= messageId) return true;

  const messageIds = Array.from({ length: lastMessageId - messageId }, (_, index) => messageId + index + 1);
  await deleteChatMessages(messageIds, { refresh: 'none' });
  await new Promise(resolve => {
    window.setTimeout(resolve, 250);
  });

  const nextLastMessageId = getLastMessageId();
  if (nextLastMessageId > messageId) {
    game.pushLog('系统', `读档覆盖失败：楼层仍停在 #${nextLastMessageId}，没有继续发送。`);
    return false;
  }

  return true;
}

async function ensureLoadedBranchForAction(): Promise<boolean> {
  const messageId = pendingLoadMessageId.value;
  if (messageId === null) return true;

  game.pushLog('系统', `从临时读档楼层 #${messageId} 继续，正在覆盖该楼层之后的记录。`);
  const canContinue = await game.continueFromLoadedCheckpoint();
  if (!canContinue) return false;
  pendingLoadMessageId.value = null;
  return true;
}

async function regenerateLatest(options: { authoritativeMessageId?: number } = {}) {
  const messageId = latestMessage.value.messageId;
  const userMessageId = latestMessage.value.userMessageId;
  if (!hasMessageId(messageId) || !hasMessageId(userMessageId)) {
    game.pushLog('系统', '无法重 roll：缺少楼层信息。');
    closeContextMenu();
    return false;
  }

  try {
    game.isGenerating = true;
    closeContextMenu();
    const userText = readUserMessageText(userMessageId);
    if (!userText) throw new Error('无法找到上一条玩家消息。');

    const canPreserveScene =
      /动作类型:\s*CUSTOM_ACTION/.test(userText) ||
      (/自由行动造成的库存、状态或地点变化|若行动自然影响库存/.test(userText) && !userText.includes('前端已结算:'));
    const result = await runNarrativeRequest(userText, {
      createUserMessage: false,
      authoritativeData: game.getAuthoritativeMvuData(options.authoritativeMessageId ?? userMessageId),
      turnContextWorldbookBinding: game.turnContextWorldbookBinding,
      worldbookScanText: game.buildWorldbookScanPreview(),
      enableStreamingMaintext: false,
      preserveNarrativeScene: canPreserveScene,
      onTurnContextWorldbookWritten: binding => {
        game.turnContextWorldbookBinding = { ...binding };
        game.turnContextWorldbookStatus = `最近写入：${new Date(binding.updatedAt ?? Date.now()).toLocaleString()} · ${binding.worldbookName} · uid ${binding.uid}`;
        game.pushLog('系统', '重 roll 已重新写入本回合发送包世界书。');
      },
    });
    if (!result.ok) throw new Error(result.error ?? '重新生成失败。');
    if (
      result.latest?.shop &&
      /动作类型:\s*(FIND_SHOP|VISIT_SHOP)|<shop>|请额外输出一个\s*<shop>|货架给9到10项|自由找店|寻找商铺/.test(
        userText,
      )
    ) {
      game.applyGeneratedShop(result.latest.shop);
      game.currentTab = 'shop';
    }
    await game.writeChatSave(result.latest);
    refreshMaintext();
    return true;
  } catch (error) {
    game.restoreAfterFailedRegeneration(userMessageId);
    refreshMaintext();
    game.pushLog('系统', error instanceof Error ? error.message : '重新生成失败。');
    return false;
  } finally {
    game.isGenerating = false;
  }
}

function openEditTurnAction() {
  const userMessageId = visibleTurnActionMessageId.value ?? latestMessage.value.userMessageId;
  if (false && isViewingLoadedLayer.value) {
    game.pushLog('系统', '旧楼层只能查看本回合行动，不能直接编辑重发。');
    return;
  }
  if (!hasMessageId(userMessageId)) {
    game.pushLog('系统', '无法编辑本回合行动：缺少玩家楼层信息。');
    return;
  }
  const text = readUserMessageText(userMessageId);
  if (!text) {
    game.pushLog('系统', '无法编辑本回合行动：未找到玩家楼层内容。');
    return;
  }
  editingTurnAction.value = { userMessageId, originalText: text, currentText: text };
}

async function saveTurnActionAndRegenerate() {
  if (!editingTurnAction.value) return;
  const editing = editingTurnAction.value;
  const nextText = editing.currentText.trim();
  if (!nextText) {
    game.pushLog('系统', '本回合行动不能为空。');
    return;
  }
  try {
    game.isGenerating = true;
    await writeUserMessageText(editing.userMessageId, nextText, 'none');
    editingTurnAction.value = null;
    const canContinue = await ensureLoadedBranchForAction();
    if (!canContinue) {
      await writeUserMessageText(editing.userMessageId, editing.originalText, 'none');
      refreshTurnAction();
      return;
    }
    const regenerated = await regenerateLatest({ authoritativeMessageId: editing.userMessageId });
    if (!regenerated) {
      await writeUserMessageText(editing.userMessageId, editing.originalText, 'none');
      refreshTurnAction();
      return;
    }
    refreshTurnAction();
    game.pushLog('系统', '本回合行动已修改，并重新生成正文。');
  } catch (error) {
    try {
      await writeUserMessageText(editing.userMessageId, editing.originalText, 'none');
    } catch {
      // 如果回滚失败，保留原错误提示，避免遮蔽真正的生成错误。
    }
    game.pushLog('系统', error instanceof Error ? error.message : '修改行动后重新生成失败。');
  } finally {
    game.isGenerating = false;
  }
}

function openEditMaintext() {
  const messageId = latestMessage.value.messageId;
  const fullMessage = latestMessage.value.fullMessage;
  if (!hasMessageId(messageId) || !fullMessage) {
    game.pushLog('系统', '无法编辑：缺少楼层正文。');
    closeContextMenu();
    return;
  }
  const maintext = parseMaintext(fullMessage);
  if (!maintext) {
    game.pushLog('系统', '无法编辑：没有找到 <maintext> 正文。');
    closeContextMenu();
    return;
  }
  editingMessage.value = { messageId, currentText: maintext, fullMessage, mode: 'maintext' };
  closeContextMenu();
}

function openEditFullMessage() {
  const messageId = latestMessage.value.messageId;
  const fullMessage = latestMessage.value.fullMessage;
  if (!hasMessageId(messageId) || !fullMessage) {
    game.pushLog('系统', '无法编辑：缺少楼层原文。');
    closeContextMenu();
    return;
  }
  editingMessage.value = { messageId, currentText: fullMessage, fullMessage, mode: 'all' };
  closeContextMenu();
}

async function saveEditingMessage() {
  if (!editingMessage.value) return;
  try {
    const editing = editingMessage.value;
    const updatedMessage =
      editing.mode === 'all'
        ? editing.currentText.trim()
        : editing.fullMessage.replace(
            /<maintext\b[^>]*>[\s\S]*?<\/maintext>/i,
            `<maintext>${editing.currentText.trim()}</maintext>`,
          );
    await setChatMessages([{ message_id: editing.messageId, message: updatedMessage }], { refresh: 'affected' });
    if (editing.mode === 'all') {
      const parsed = await parseNarrativeMvuMessage(updatedMessage, game.getAuthoritativeMvuData(editing.messageId));
      game.applyMvuStatData(parsed.mvuData, { restoreInventory: true });
      await writePrimordiaStatData(parsed.mvuData, { type: 'message', message_id: editing.messageId });
      parsed.latest.messageId = editing.messageId;
      await game.writeChatSave(parsed.latest);
    }
    editingMessage.value = null;
    refreshMaintext();
    game.pushLog('系统', '楼层文字已保存。');
  } catch (error) {
    game.pushLog('系统', error instanceof Error ? error.message : '保存文字失败。');
  }
}

async function choose(option: ParsedOption) {
  if (game.isGenerating) return;
  showOptions.value = false;
  game.pushLog('叙事', `已选择 ${option.id}: ${option.text}`);
  try {
    const canContinue = await ensureLoadedBranchForAction();
    if (!canContinue) {
      showOptions.value = true;
      return;
    }
    await game.executePseudoZeroAction(
      { type: 'CUSTOM_ACTION', text: `我选择：${option.text}`, title: `选项 ${option.id}` },
      {
        type: 'CUSTOM_ACTION',
        title: `选项 ${option.id}`,
        aiHint:
          '请承接当前楼层正文，叙述玩家选择该选项后的场景推进。若需要移动，只通过 MVU 地点补丁表达；没有地点补丁就保持原地点。',
        logText: `CUSTOM_ACTION · 选项 ${option.id}: ${option.text}`,
        autoSend: true,
        preserveLocalState: true,
      },
    );
  } catch (error) {
    game.pushLog('系统', error instanceof Error ? error.message : '生成失败。');
    showOptions.value = true;
  }
}

function loadStoryCheckpoint(item: StoryIndexItem) {
  isLoadOpen.value = false;
  latestMessage.value = item;
  pendingLoadMessageId.value = item.messageId;
  showOptions.value = false;
  contextMenu.value = null;
  const restoredFromSnapshot = game.restoreStorySnapshot(item.messageId);
  const restored = restoredFromSnapshot || game.loadFromMvu({ messageId: item.messageId, force: true });
  const recoveredShop =
    item.shop ??
    (game.generatedShop && game.isCurrentShopLocation(game.generatedShop.name)
      ? findNearestShopBefore(item.messageId, game.generatedShop.name)
      : undefined);
  if (item.shop) game.applyGeneratedShop(item.shop, { silent: true });
  game.setLoadedStoryCheckpoint(recoveredShop ? { ...item, shop: recoveredShop } : item);
  if (recoveredShop && game.isCurrentShopLocation(recoveredShop.name)) {
    latestMessage.value = { ...item, shop: recoveredShop };
    game.currentTab = 'shop';
  } else {
    const sceneType = game.currentSceneType;
    if (!game.isCurrentShopLocation()) game.clearGeneratedShop({ silent: true });
    if (sceneType === '商铺') game.currentTab = 'shop';
    else if (sceneType === '农田酒窖') game.currentTab = 'farm';
    else if (sceneType === '库房炉台') game.currentTab = 'inventory';
    else game.currentTab = 'chronicle';
  }
  game.pushLog('系统', `已临时读档到楼层 #${item.messageId}。发送新行动后，才会从这里创建分支。`);
  if (!restored) game.pushLog('系统', `楼层 #${item.messageId} 没有读到变量快照，当前变量暂未改变。`);
}

async function toggleFocusMode() {
  isFocusMode.value = !isFocusMode.value;
  document.body.classList.toggle('pm-focus-mode', isFocusMode.value);

  try {
    if (isFocusMode.value && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (!isFocusMode.value && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    // iframe 可能没有全屏权限，此时只保留页内宽屏阅读模式。
  }
}

onMounted(() => {
  isFocusMode.value = document.body.classList.contains('pm-focus-mode') || !!document.fullscreenElement;
  if (!restoreLoadedPreview()) refreshMaintext();
  storyUpdatedStop = onPrimordiaStoryUpdated(payload => {
    pendingLoadMessageId.value = null;
    game.setLoadedStoryCheckpoint(null);
    latestMessage.value = payload;
    storyIndex.value = loadAssistantStoryIndex();
    refreshTurnAction();
    showOptions.value = false;
  });
  storyStreamingStop = onPrimordiaStoryStreaming(maintext => {
    if (!game.enableStoryStreaming || !game.isGenerating || pendingLoadMessageId.value !== null) return;
    const text = maintext.trim();
    if (!text) return;
    latestMessage.value = {
      ...latestMessage.value,
      maintext: text,
      options: [],
    };
    showOptions.value = false;
  });
  if (typeof eventOn !== 'function' || typeof tavern_events === 'undefined') return;

  messageEventStops = [
    eventOn(tavern_events.USER_MESSAGE_RENDERED, () => refreshTurnAction()),
    eventOn(tavern_events.MESSAGE_RECEIVED, () => refreshMaintext({ keepLoadedView: true })),
    eventOn(tavern_events.MESSAGE_UPDATED, () => refreshMaintext({ keepLoadedView: true })),
    eventOn(tavern_events.MESSAGE_EDITED, () => refreshMaintext({ keepLoadedView: true })),
    eventOn(tavern_events.MESSAGE_SWIPED, () => refreshMaintext({ keepLoadedView: true })),
    eventOn(tavern_events.CHAT_CHANGED, () => refreshMaintext()),
    eventOn(tavern_events.GENERATION_ENDED, () => refreshMaintext({ keepLoadedView: true })),
    eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, () => refreshMaintext({ keepLoadedView: true })),
  ];
});

onUnmounted(() => {
  clearLongPressTimer();
  messageEventStops.forEach(stop => {
    if (typeof stop === 'function') stop();
    else stop.stop();
  });
  messageEventStops = [];
  storyUpdatedStop?.();
  storyUpdatedStop = undefined;
  storyStreamingStop?.();
  storyStreamingStop = undefined;
});

watch(
  () => latestMessage.value.userMessageId,
  () => refreshTurnAction(),
  { immediate: true },
);
</script>

<template>
  <section id="page-chronicle" class="chronicle-page" :class="{ 'focus-mode': isFocusMode }">
    <article class="story-sheet" :class="{ empty: !hasMaintext }">
      <div class="sheet-corner tl"></div>
      <div class="sheet-corner tr"></div>
      <div class="sheet-corner bl"></div>
      <div class="sheet-corner br"></div>

      <header class="page-tools">
        <button class="tool-btn" type="button" @click="openReaderModal">
          <PmIcon name="scroll" :size="15" />
          阅读模式
        </button>
        <button class="tool-btn" type="button" @click="openLoadModal">
          <PmIcon name="ledger" :size="15" />
          读档
        </button>
        <button class="tool-btn" type="button" @click="toggleFocusMode">
          <PmIcon name="map" :size="15" />
          {{ isFocusMode ? '退出宽屏' : '宽屏' }}
        </button>
      </header>

      <template v-if="hasMaintext">
        <header class="story-head">
          <div>
            <p class="kicker">{{ game.tavernName }} · {{ isViewingLoadedLayer ? '临时读档' : '本回合正文' }}</p>
            <h1>{{ isViewingLoadedLayer ? '临时读档记录' : '最新楼层记录' }}</h1>
          </div>
          <span v-if="chapterMark" class="chapter-mark">
            <PmIcon name="ledger" :size="18" />
            {{ chapterMark }}
          </span>
        </header>

        <section v-if="isViewingLoadedLayer" class="load-notice">
          <strong>正在查看旧楼层</strong>
          <span>这只是临时翻页。只有在这里写入行动或选择选项后，才会覆盖该楼层之后的记录并继续。</span>
          <button type="button" :disabled="game.isGenerating" @click="refreshMaintext()">回到最新楼层</button>
        </section>

        <section class="turn-action-card" :class="{ open: turnActionOpen }">
          <button class="turn-action-head" type="button" @click="turnActionOpen = !turnActionOpen">
            <span>
              <PmIcon name="scroll" :size="15" />
              本回合行动
            </span>
            <small>{{ turnActionText ? (isPendingTurnAction ? '等待正文' : turnActionOpen ? '收起' : '展开') : '未记录' }}</small>
          </button>
          <div v-if="turnActionOpen" class="turn-action-body">
            <p v-if="turnActionText">{{ turnActionText }}</p>
            <p v-else class="turn-action-empty">{{ turnActionError || '未找到本回合行动记录。' }}</p>
            <div v-if="turnActionText" class="turn-action-tools">
              <button type="button" @click="copyTextToClipboard(turnActionText)">复制</button>
              <button type="button" :disabled="game.isGenerating || isViewingLoadedLayer || isPendingTurnAction" @click="openEditTurnAction">
                {{ isViewingLoadedLayer || isPendingTurnAction ? '当前不可编辑' : '编辑后重发' }}
              </button>
            </div>
          </div>
        </section>

        <section
          class="story-body"
          :class="{ interactive: hasMessageId(latestMessage.messageId) }"
          @mousedown.prevent.stop="startLongPress($event)"
          @mouseup.stop="clearLongPressTimer"
          @mouseleave="clearLongPressTimer"
          @touchstart.stop="startLongPress($event)"
          @touchend="clearLongPressTimer"
          @touchcancel="clearLongPressTimer"
        >
          <p v-for="paragraph in storyParagraphs" :key="paragraph">{{ paragraph }}</p>
        </section>

        <section v-if="parsedOptions.length > 0" class="choice-panel" :class="{ open: showOptions }">
          <button class="choice-toggle" type="button" :disabled="game.isGenerating" @click="showOptions = !showOptions">
            <span>
              <PmIcon name="chevron-down" :size="14" />
              {{ showOptions ? '收起可选行动' : '展开可选行动' }}
            </span>
            <small>{{ parsedOptions.length }} 项</small>
          </button>

          <Transition name="choice-fold">
            <div v-if="showOptions" class="choice-list">
              <button
                v-for="option in parsedOptions"
                :key="option.id"
                class="choice-btn"
                :disabled="game.isGenerating"
                @click="choose(option)"
              >
                <span class="choice-letter">{{ option.id }}</span>
                <strong>{{ option.text }}</strong>
              </button>
            </div>
          </Transition>
        </section>

      </template>

      <section v-else class="story-empty-state">
        <PmIcon name="scroll" :size="22" />
        <h2>还没有可显示的正文</h2>
        <p>当前聊天里没有识别到正式的 <code>&lt;maintext&gt;</code> 开场白或叙事楼层。请使用固定开场白快速开局，或确认第 0 楼确实写入了正文标签。</p>
      </section>
    </article>

    <aside class="promise-rail" :class="{ open: isPromiseRailOpen, due: promiseTaskItems.some(memo => game.isPromiseMemoDue(memo)) }">
      <header class="promise-rail-head">
        <div>
          <p class="kicker">PROMISES</p>
          <h2>约定</h2>
        </div>
        <button class="promise-mobile-toggle" type="button" @click="isPromiseRailOpen = !isPromiseRailOpen">
          {{ isPromiseRailOpen ? '收起' : '查看' }}
        </button>
        <span>{{ promiseTaskItems.length }}</span>
      </header>

      <div v-if="promiseTaskItems.length === 0" class="promise-empty">
        暂无待办约定。
      </div>

      <div v-else class="promise-list">
        <article
          v-for="memo in promiseTaskItems"
          :key="memo.id"
          class="promise-task"
          :class="{ due: game.isPromiseMemoDue(memo) }"
        >
          <header>
            <h3>{{ memo.name }}</h3>
            <span>{{ game.isPromiseMemoDue(memo) ? '已到点' : '待触发' }}</span>
          </header>
          <p class="promise-time">{{ memo.triggerTime }}</p>
          <p class="promise-people">{{ promisePeopleText(memo) }}</p>
          <p class="promise-reminder">{{ promiseReminderPreview(memo) }}</p>
          <div class="promise-actions">
            <button type="button" @click="copyPromiseReminder(memo)">复制</button>
            <button type="button" @click="game.updatePromiseMemoStatus(memo.id, 'resolved')">解决</button>
            <button type="button" @click="game.updatePromiseMemoStatus(memo.id, 'cancelled')">取消</button>
          </div>
        </article>
      </div>
    </aside>

    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="story-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <header>
          <span>正文操作</span>
          <button type="button" @click="closeContextMenu"><PmIcon name="x" :size="14" /></button>
        </header>
        <button type="button" :disabled="game.isGenerating" @click="regenerateLatest">
          {{ game.isGenerating ? '处理中...' : '重 roll' }}
        </button>
        <button type="button" :disabled="game.isGenerating || isViewingLoadedLayer" @click="openEditTurnAction">修改本回合行动</button>
        <button type="button" :disabled="game.isGenerating" @click="openEditMaintext">编辑正文</button>
        <button type="button" :disabled="game.isGenerating" @click="openEditFullMessage">编辑全部文字</button>
      </div>

      <div v-if="contextMenu" class="context-backdrop" @click="closeContextMenu"></div>

      <div v-if="editingTurnAction" class="story-modal-mask" @click.self="editingTurnAction = null">
        <section class="story-modal edit-modal">
          <header>
            <div>
              <p>修改这回合实际写入的玩家行动</p>
              <h2>编辑本回合行动</h2>
            </div>
            <button type="button" @click="editingTurnAction = null"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="edit-body">
            <textarea v-model="editingTurnAction.currentText"></textarea>
            <div class="edit-actions">
              <button class="tool-btn" type="button" :disabled="game.isGenerating" @click="editingTurnAction = null">取消</button>
              <button class="tool-btn primary" type="button" :disabled="game.isGenerating" @click="saveTurnActionAndRegenerate">
                {{ game.isGenerating ? '重新生成中...' : '保存并重新生成' }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <div v-if="editingMessage" class="story-modal-mask" @click.self="editingMessage = null">
        <section class="story-modal edit-modal">
          <header>
            <div>
              <p>{{ editingMessage.mode === 'all' ? '修改当前楼层的完整原文' : '只修改当前楼层的正文' }}</p>
              <h2>{{ editingMessage.mode === 'all' ? '编辑全部文字' : '编辑正文' }}</h2>
            </div>
            <button type="button" @click="editingMessage = null"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="edit-body">
            <textarea v-model="editingMessage.currentText"></textarea>
            <div class="edit-actions">
              <button class="tool-btn" type="button" @click="editingMessage = null">取消</button>
              <button class="tool-btn primary" type="button" @click="saveEditingMessage">
                {{ editingMessage.mode === 'all' ? '保存全部文字' : '保存正文' }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <div v-if="isReaderOpen" class="story-modal-mask" @click.self="isReaderOpen = false">
        <section class="story-modal reader-modal">
          <header>
            <div>
              <p>按楼层回看</p>
              <h2>阅读模式</h2>
            </div>
            <button type="button" @click="isReaderOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="reader-list">
            <article v-for="item in readerItems" :key="item.messageId" class="reader-item">
              <strong>楼层 #{{ item.messageId }}</strong>
              <p v-for="paragraph in item.maintext.split(/\n\s*\n/).filter(Boolean)" :key="paragraph">
                {{ paragraph }}
              </p>
            </article>
          </div>
        </section>
      </div>

      <div v-if="isLoadOpen" class="story-modal-mask" @click.self="isLoadOpen = false">
        <section class="story-modal load-modal">
          <header>
            <div>
              <p>摘要优先显示</p>
              <h2>读档</h2>
            </div>
            <button type="button" @click="isLoadOpen = false"><PmIcon name="x" :size="16" /></button>
          </header>
          <div class="load-list">
            <p v-if="loadItems.length === 0" class="load-empty">
              还没有读到可用楼层。请确认最近的 assistant 楼层里有 &lt;maintext&gt; 正文。
            </p>
            <button
              v-for="item in loadItems"
              :key="item.messageId"
              class="load-item"
              type="button"
              :disabled="game.isGenerating"
              @click="loadStoryCheckpoint(item)"
            >
              <span>楼层 #{{ item.messageId }}</span>
              <strong>{{ item.sum || item.preview }}</strong>
              <small v-if="item.sum">正文：{{ item.preview }}</small>
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.chronicle-page {
  display: grid;
  grid-template-columns: minmax(0, 860px) minmax(240px, 320px);
  justify-content: center;
  align-items: start;
  gap: 16px;
  flex: 1;
  min-height: 0;
  padding: 34px 18px 26px;
}
.chronicle-page.focus-mode {
  height: 100%;
  overflow-y: auto;
  padding: 24px 24px 56px;
  scrollbar-gutter: stable;
}
.focus-mode .story-sheet {
  width: 100%;
  margin: 0 auto;
}
.story-sheet {
  position: relative;
  width: 100%;
  min-height: 420px;
  padding: 32px 34px 34px;
  color: #3d3328;
  background:
    radial-gradient(circle at 16% 8%, rgba(255, 255, 250, 0.96), transparent 28%),
    radial-gradient(circle at 86% 82%, rgba(188, 158, 112, 0.2), transparent 46%),
    linear-gradient(180deg, #f7f2e8, #efe3d1 58%, #e2d1b8);
  border: 1px solid rgba(185, 151, 101, 0.78);
  border-radius: 4px;
  box-shadow:
    0 24px 70px -34px rgba(0, 0, 0, 0.9),
    inset 0 0 0 1px rgba(255, 255, 250, 0.72),
    inset 0 0 42px rgba(116, 80, 38, 0.14);
}
.promise-rail {
  position: sticky;
  top: 18px;
  display: grid;
  gap: 10px;
  width: 100%;
  padding: 13px;
  color: var(--pm-dark-text);
  background:
    radial-gradient(circle at 16% 8%, rgba(214, 171, 83, 0.12), transparent 36%),
    var(--pm-dark-panel);
  border: 1px solid var(--pm-dark-panel-border);
  border-radius: 5px;
  box-shadow: inset 0 1px 0 rgba(255, 239, 196, 0.08);
}
.promise-rail-head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--pm-line-faint);
}
.promise-rail-head h2 {
  margin: 0;
  color: var(--pm-dark-text);
  font-size: calc(18px * var(--pm-text-scale));
  font-weight: 500;
}
.promise-rail-head > span {
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  color: var(--pm-text-on-gold);
  background: var(--pm-grad-gold);
  border: 1px solid var(--pm-line-soft);
  border-radius: 999px;
  font-weight: 700;
}
.promise-mobile-toggle {
  display: none;
}
.promise-empty {
  padding: 16px 12px;
  color: var(--pm-dark-faint);
  text-align: center;
  border: 1px dashed var(--pm-line-faint);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
}
.promise-list {
  display: grid;
  gap: 9px;
}
.promise-task {
  display: grid;
  gap: 7px;
  padding: 11px;
  color: var(--pm-dark-muted);
  background: var(--pm-dark-panel-solid);
  border: 1px solid var(--pm-dark-panel-border);
  border-radius: 5px;
}
.promise-task.due {
  border-color: rgba(234, 191, 91, 0.76);
  background:
    linear-gradient(90deg, rgba(197, 140, 37, 0.16), transparent),
    var(--pm-dark-panel-solid);
  box-shadow: 0 0 0 1px rgba(234, 191, 91, 0.1);
}
.promise-task header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 8px;
}
.promise-task h3 {
  margin: 0;
  color: var(--pm-dark-text);
  font-size: calc(14px * var(--pm-text-scale));
  font-weight: 600;
  line-height: 1.35;
}
.promise-task header span {
  flex: none;
  padding: 3px 7px;
  color: var(--pm-gold-bright);
  border: 1px solid var(--pm-line-soft);
  border-radius: 999px;
  font-size: calc(10px * var(--pm-text-scale));
}
.promise-task.due header span {
  color: #2f1d08;
  background: var(--pm-grad-gold);
  border-color: rgba(234, 191, 91, 0.88);
}
.promise-time,
.promise-people,
.promise-reminder {
  margin: 0;
  line-height: 1.55;
}
.promise-time {
  color: var(--pm-gold);
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.08em;
}
.promise-people {
  color: var(--pm-dark-faint);
  font-size: calc(11px * var(--pm-text-scale));
}
.promise-reminder {
  color: var(--pm-dark-muted);
  font-size: calc(12px * var(--pm-text-scale));
}
.promise-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding-top: 4px;
}
.promise-actions button {
  min-width: 0;
  padding: 6px 7px;
  color: var(--pm-dark-text);
  background: var(--pm-dark-panel-soft);
  border: 1px solid var(--pm-line-faint);
  border-radius: 4px;
  font-size: calc(11px * var(--pm-text-scale));
}
.promise-actions button:hover {
  color: var(--pm-gold-bright);
  border-color: var(--pm-line-soft);
}
.story-sheet.empty {
  min-height: 360px;
}
.story-empty-state {
  position: relative;
  z-index: 1;
  min-height: 250px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 12px;
  padding: 36px 26px;
  color: #7a6141;
  text-align: center;
}
.story-empty-state h2 {
  margin: 0;
  color: #5d421d;
  font-family: var(--pm-font-display);
  font-size: calc(21px * var(--pm-text-scale));
  letter-spacing: 0.04em;
}
.story-empty-state p {
  max-width: 520px;
  margin: 0;
  font-size: calc(13px * var(--pm-text-scale));
  line-height: 1.8;
}
.story-empty-state code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(132, 94, 42, 0.12);
  color: #5d421d;
}
.story-sheet::before {
  content: '';
  position: absolute;
  inset: 14px;
  border: 1px solid rgba(174, 139, 86, 0.36);
  pointer-events: none;
}
.sheet-corner {
  position: absolute;
  width: 26px;
  height: 26px;
  border-color: rgba(174, 139, 86, 0.76);
}
.sheet-corner.tl {
  top: 8px;
  left: 8px;
  border-top: 1px solid;
  border-left: 1px solid;
}
.sheet-corner.tr {
  top: 8px;
  right: 8px;
  border-top: 1px solid;
  border-right: 1px solid;
}
.sheet-corner.bl {
  bottom: 8px;
  left: 8px;
  border-bottom: 1px solid;
  border-left: 1px solid;
}
.sheet-corner.br {
  right: 8px;
  bottom: 8px;
  border-right: 1px solid;
  border-bottom: 1px solid;
}
.page-tools {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid rgba(132, 94, 42, 0.32);
  border-radius: 4px;
  color: #6f552e;
  background: rgba(255, 252, 240, 0.46);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.58);
  font-size: calc(12px * var(--pm-text-scale));
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease;
}
.tool-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(164, 112, 42, 0.58);
  background: rgba(255, 249, 223, 0.74);
}
.story-head {
  position: relative;
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: start;
  margin-bottom: 18px;
}
.kicker {
  margin: 0 0 6px;
  color: #9a753d;
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.18em;
}
h1 {
  margin: 0;
  font-family: var(--pm-font-body);
  font-size: calc(25px * var(--pm-text-scale));
  font-weight: 600;
  letter-spacing: 0;
  color: #35291d;
}
.chapter-mark {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border-radius: 3px;
  color: #6f552e;
  background: rgba(190, 158, 109, 0.16);
  border: 1px solid rgba(154, 117, 61, 0.28);
  font-size: calc(12px * var(--pm-text-scale));
  white-space: nowrap;
}
.load-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 18px;
  padding: 10px 12px;
  color: #6d4b1e;
  border: 1px solid rgba(176, 122, 35, 0.35);
  border-radius: 5px;
  background: linear-gradient(90deg, rgba(240, 212, 138, 0.28), rgba(255, 252, 240, 0.22)), rgba(255, 248, 218, 0.42);
  font-size: calc(12px * var(--pm-text-scale));
}
.load-notice strong {
  color: #8a5f19;
  white-space: nowrap;
}
.load-notice span {
  flex: 1;
  line-height: 1.55;
}
.load-notice button {
  padding: 6px 10px;
  white-space: nowrap;
  color: #5d421d;
  border: 1px solid rgba(132, 94, 42, 0.28);
  border-radius: 4px;
  background: rgba(255, 252, 240, 0.54);
}
.turn-action-card {
  position: relative;
  margin: -2px 0 18px;
  overflow: hidden;
  border: 1px solid rgba(154, 117, 61, 0.22);
  border-radius: 5px;
  background: linear-gradient(90deg, rgba(240, 212, 138, 0.16), rgba(255, 252, 240, 0.28));
}
.turn-action-card.open {
  border-color: rgba(154, 117, 61, 0.34);
  background: linear-gradient(90deg, rgba(240, 212, 138, 0.24), rgba(255, 252, 240, 0.42));
}
.turn-action-head {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 11px;
  color: #6f552e;
  background: transparent;
  border: 0;
  font-family: var(--pm-font-display);
  font-size: calc(12px * var(--pm-text-scale));
  letter-spacing: 0.06em;
}
.turn-action-head span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.turn-action-head small {
  color: #8d6a36;
  font-size: calc(11px * var(--pm-text-scale));
}
.turn-action-body {
  display: grid;
  gap: 10px;
  padding: 0 11px 11px;
  color: #5d4a35;
  font-size: calc(12px * var(--pm-text-scale));
  line-height: 1.65;
}
.turn-action-body p {
  max-height: 150px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
}
.turn-action-empty {
  color: #8c7150;
}
.turn-action-tools {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.turn-action-tools button {
  padding: 6px 10px;
  color: #5d421d;
  border: 1px solid rgba(132, 94, 42, 0.28);
  border-radius: 4px;
  background: rgba(255, 252, 240, 0.54);
  font-size: calc(11px * var(--pm-text-scale));
}
.turn-action-tools button:hover:not(:disabled) {
  border-color: rgba(164, 112, 42, 0.58);
  background: rgba(255, 249, 223, 0.74);
}
.turn-action-tools button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.story-body {
  position: relative;
  display: grid;
  gap: 12px;
  padding: 2px 0 24px;
  font-size: calc(17px * var(--pm-text-scale));
  line-height: 1.9;
  color: #4b4035;
}
.story-body.interactive {
  cursor: pointer;
  user-select: none;
}
.story-body.interactive:active {
  filter: sepia(0.08);
}
.choice-panel {
  position: relative;
  margin-top: 2px;
}
.choice-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(154, 117, 61, 0.24);
  border-radius: 4px;
  color: #6f552e;
  background: linear-gradient(90deg, transparent, rgba(190, 158, 109, 0.16), transparent), rgba(255, 255, 255, 0.24);
  font-size: calc(12px * var(--pm-text-scale));
  letter-spacing: 0.05em;
}
.choice-toggle span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.choice-toggle svg {
  transition: transform 0.18s ease;
}
.choice-panel.open .choice-toggle svg {
  transform: rotate(180deg);
}
.choice-toggle small {
  color: #8e6b36;
}
.choice-list {
  position: relative;
  display: grid;
  gap: 9px;
  padding-top: 10px;
}
.choice-fold-enter-active,
.choice-fold-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.choice-fold-enter-from,
.choice-fold-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.choice-btn {
  position: relative;
  display: grid;
  grid-template-columns: 46px 1fr;
  align-items: center;
  min-height: 44px;
  padding: 8px 14px;
  overflow: hidden;
  text-align: left;
  color: #4c3b26;
  background:
    radial-gradient(circle at 8% 50%, rgba(238, 203, 132, 0.42), transparent 34%),
    linear-gradient(180deg, rgba(255, 252, 239, 0.72), rgba(218, 194, 155, 0.58)), #e5d8c5;
  border: 1px solid rgba(132, 94, 42, 0.34);
  border-radius: 4px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    inset 0 -1px 0 rgba(113, 77, 31, 0.16),
    0 5px 14px rgba(82, 58, 30, 0.12);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}
.choice-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 0 32%, rgba(255, 245, 208, 0.48) 48%, transparent 64% 100%);
  transform: translateX(-120%);
  transition: transform 0.55s ease;
}
.choice-btn:hover {
  transform: translateY(-2px);
  border-color: rgba(164, 112, 42, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.78),
    0 12px 22px -12px rgba(74, 47, 18, 0.55);
}
.choice-btn:hover::before {
  transform: translateX(120%);
}
.choice-btn:active {
  transform: translateY(0);
}
.choice-letter {
  position: relative;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #4a3216;
  background: linear-gradient(180deg, #f1d58c, #bb8430);
  border: 1px solid rgba(96, 61, 22, 0.42);
  font-family: var(--pm-font-display);
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 244, 204, 0.76);
}
.choice-btn strong {
  position: relative;
  font-weight: 600;
  line-height: 1.6;
}
.context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4990;
  background: transparent;
}
.story-context-menu {
  position: fixed;
  z-index: 5010;
  width: 210px;
  overflow: hidden;
  color: var(--pm-parch);
  background:
    radial-gradient(circle at 20% 0%, rgba(243, 220, 162, 0.13), transparent 50%),
    linear-gradient(180deg, #2b2118, #130d08);
  border: 1px solid rgba(243, 220, 162, 0.34);
  border-radius: 6px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.54);
}
.story-context-menu header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-bottom: 1px dashed rgba(243, 220, 162, 0.22);
  font-family: var(--pm-font-display);
  color: var(--pm-gold-bright);
  letter-spacing: 0.08em;
}
.story-context-menu header button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: rgba(243, 220, 162, 0.82);
  border: 1px solid rgba(243, 220, 162, 0.22);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
}
.story-context-menu > button {
  width: 100%;
  padding: 11px 13px;
  text-align: left;
  color: rgba(243, 220, 162, 0.86);
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(243, 220, 162, 0.08);
}
.story-context-menu > button:hover {
  color: var(--pm-gold-bright);
  background: rgba(243, 220, 162, 0.08);
}
.story-context-menu > button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.story-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  place-items: center;
  padding: 18px;
  background: radial-gradient(circle at 50% 24%, rgba(179, 130, 54, 0.2), transparent 44%), rgba(12, 7, 3, 0.72);
  backdrop-filter: blur(3px);
}
.story-modal {
  width: min(900px, 100%);
  max-height: min(720px, 86vh);
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  color: #3d3328;
  background:
    radial-gradient(circle at 14% 0%, rgba(255, 255, 250, 0.92), transparent 30%),
    linear-gradient(180deg, #f3ead9, #dfc9a7);
  border: 1px solid rgba(185, 151, 101, 0.82);
  border-radius: 6px;
  box-shadow:
    0 26px 70px rgba(0, 0, 0, 0.56),
    inset 0 0 0 1px rgba(255, 250, 235, 0.58);
}
.story-modal > header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 15px 18px;
  border-bottom: 1px dashed rgba(132, 94, 42, 0.34);
  background: rgba(255, 255, 255, 0.25);
}
.story-modal header p {
  margin: 0 0 2px;
  color: #8d6a36;
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.16em;
}
.story-modal h2 {
  margin: 0;
  font-size: calc(20px * var(--pm-text-scale));
  color: #35291d;
}
.story-modal header button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(132, 94, 42, 0.32);
  border-radius: 4px;
  color: #6f552e;
  background: rgba(255, 252, 240, 0.5);
}
.reader-list,
.load-list {
  overflow: auto;
  padding: 14px;
}
.reader-list {
  display: grid;
  gap: 12px;
}
.reader-item {
  padding: 14px;
  border: 1px solid rgba(132, 94, 42, 0.22);
  border-radius: 5px;
  background: rgba(255, 252, 240, 0.48);
}
.reader-item strong {
  display: block;
  margin-bottom: 8px;
  color: #8a642b;
}
.reader-item p {
  margin: 0 0 8px;
  line-height: 1.8;
}
.load-list {
  display: grid;
  gap: 10px;
}
.load-empty {
  margin: 0;
  padding: 18px 16px;
  color: #806647;
  line-height: 1.7;
  border: 1px dashed rgba(132, 94, 42, 0.34);
  border-radius: 5px;
  background: rgba(255, 252, 240, 0.38);
}
.load-item {
  display: grid;
  gap: 4px;
  padding: 13px 14px;
  text-align: left;
  border: 1px solid rgba(132, 94, 42, 0.24);
  border-radius: 5px;
  color: #3f2f1f;
  background: linear-gradient(90deg, rgba(240, 212, 138, 0.18), transparent), rgba(255, 252, 240, 0.5);
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease;
}
.load-item:hover {
  transform: translateY(-1px);
  border-color: rgba(164, 112, 42, 0.6);
  background: linear-gradient(90deg, rgba(240, 212, 138, 0.32), transparent), rgba(255, 252, 240, 0.72);
}
.load-item:disabled {
  opacity: 0.54;
  cursor: not-allowed;
  transform: none;
}
.load-item span {
  color: #8a642b;
  font-size: calc(11px * var(--pm-text-scale));
}
.load-item strong {
  font-size: calc(14px * var(--pm-text-scale));
}
.load-item small {
  color: #806647;
  line-height: 1.55;
}
.edit-modal {
  width: min(820px, 100%);
}
.edit-body {
  display: grid;
  gap: 12px;
  padding: 16px;
}
.edit-body textarea {
  width: 100%;
  min-height: 360px;
  resize: vertical;
  padding: 13px;
  color: #3f2f1f;
  line-height: 1.75;
  border: 1px solid rgba(132, 94, 42, 0.36);
  border-radius: 5px;
  outline: none;
  background: rgba(255, 253, 242, 0.74);
  box-shadow: inset 0 1px 4px rgba(92, 58, 20, 0.12);
}
.edit-body textarea:focus {
  border-color: rgba(176, 121, 39, 0.78);
  box-shadow:
    inset 0 1px 4px rgba(92, 58, 20, 0.12),
    0 0 0 3px rgba(201, 160, 74, 0.18);
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.tool-btn.primary {
  color: #3f2b14;
  background: linear-gradient(180deg, #f0d48a, #b9802c);
  border-color: rgba(96, 61, 22, 0.48);
}
@media (max-width: 1120px) {
  .chronicle-page {
    grid-template-columns: 1fr;
    justify-content: stretch;
  }
  .promise-rail {
    position: static;
  }
}
@media (max-width: 680px) {
  .chronicle-page {
    padding: 14px 8px 16px;
  }
  .story-sheet {
    padding: 22px 18px;
  }
  .page-tools {
    justify-content: stretch;
    gap: 6px;
  }
  .page-tools .tool-btn {
    flex: 1 1 0;
    justify-content: center;
    min-width: 0;
    padding-inline: 7px;
  }
  .story-body.interactive {
    cursor: default;
    user-select: text;
  }
  .promise-rail {
    gap: 0;
    padding: 10px;
  }
  .promise-rail.due {
    border-color: rgba(234, 191, 91, 0.72);
  }
  .promise-rail-head {
    align-items: center;
    padding-bottom: 0;
    border-bottom: 0;
  }
  .promise-rail.open .promise-rail-head {
    padding-bottom: 10px;
    border-bottom: 1px dashed var(--pm-line-faint);
  }
  .promise-mobile-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    padding: 4px 9px;
    margin-left: auto;
    border: 1px solid var(--pm-line-soft);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.16);
    color: var(--pm-dark-text);
    font-family: var(--pm-font-display);
    font-size: calc(11px * var(--pm-text-scale));
  }
  .promise-rail:not(.open) .promise-empty,
  .promise-rail:not(.open) .promise-list {
    display: none;
  }
  .promise-rail:not(.open) .kicker {
    display: none;
  }
  .story-head {
    flex-direction: column;
  }
  .custom-row {
    grid-template-columns: 1fr;
  }
  .story-modal-mask {
    align-items: stretch;
    padding: 8px;
  }
  .story-modal {
    width: 100%;
    max-height: calc(100dvh - 16px);
  }
  .reader-modal {
    height: calc(100dvh - 16px);
  }
  .story-modal > header {
    padding: 11px 12px;
  }
  .reader-list {
    padding: 10px;
  }
  .reader-item {
    padding: 12px;
  }
  .reader-item p {
    font-size: calc(15px * var(--pm-text-scale));
    line-height: 1.85;
  }
}
</style>
