import {
  parseCraftResult,
  parseCharacterBehaviorUpdates,
  parseMaintext,
  parseOptions,
  parsePromiseUpdates,
  parseRegularGuestUpdates,
  parseShop,
  parseSum,
  type LatestMaintextPayload,
} from './messageParser';
import { parseGuestUpdates } from './messageParser';
import { hasLegacyCompatiblePathReference } from './legacyMojibake';
import { runNativeNarrativeTurn } from './sameFloor';
import {
  TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
  writeTurnContextWorldbookEntry,
  type TurnContextWorldbookBinding,
} from '../services/turnContextWorldbook';
import {
  getPrimordiaMvuData,
  readPrimordiaStatDataFromOptions,
  unwrapPrimordiaStatData,
  wrapPrimordiaMvuData,
  writePrimordiaStatData,
} from '../services/mvuDataBridge';

export interface UnifiedRequestCallbacks {
  onTurnContextWorldbookWritten?: (binding: TurnContextWorldbookBinding) => void;
  onStreamingMaintext?: (maintext: string) => void;
  createUserMessage?: boolean;
  authoritativeData?: Record<string, any>;
  turnContextWorldbookBinding?: Partial<TurnContextWorldbookBinding> | null;
  worldbookScanText?: string;
  enableStreamingMaintext?: boolean;
  preserveNarrativeScene?: boolean;
  allowGeneratedInventory?: boolean;
  allowGeneratedStats?: boolean;
}

export interface UnifiedRequestResult {
  ok: boolean;
  error?: string;
  latest?: LatestMaintextPayload;
  mvuData?: Record<string, any>;
  hasScenePatch?: boolean;
  hasVariablePatch?: boolean;
}

export interface PromptPreflightResult {
  ok: boolean;
  error?: string;
  snapshot?: FinalPromptDebugSnapshot;
}

export interface PromptDebugSnapshot {
  id: string;
  createdAt: string;
  status: 'pending' | 'ok' | 'error';
  userInput: string;
  baseDataSummary: string;
  injects: Array<Record<string, unknown>>;
  generatedText?: string;
  normalizedMessage?: string;
  error?: string;
}

export interface FinalPromptDebugMessage {
  index: number;
  role: string;
  content: string;
  charCount: number;
  approxTokens: number;
  raw: Record<string, unknown>;
}

export interface FinalPromptDebugSnapshot {
  id: string;
  createdAt: string;
  source: string;
  dryRun?: boolean;
  model?: string;
  totalChars: number;
  approxTokens: number;
  messageCount: number;
  messages: FinalPromptDebugMessage[];
  activatedWorldbookEntries: Array<Record<string, unknown>>;
}

const PRIMORDIA_STORY_UPDATED = 'primordia:story-updated';
const PRIMORDIA_STORY_STREAMING = 'primordia:story-streaming';
const PRIMORDIA_PROMPT_DEBUG_UPDATED = 'primordia:prompt-debug-updated';
const PRIMORDIA_FINAL_PROMPT_DEBUG_UPDATED = 'primordia:final-prompt-debug-updated';
const PROMPT_DEBUG_STORAGE_KEY = 'primordia.promptDebugSnapshots.v1';
const FINAL_PROMPT_DEBUG_STORAGE_KEY = 'primordia.finalPromptDebugSnapshots.v1';
const GLOBAL_WAIT_TIMEOUT_MS = 1200;
const PROMPT_DEBUG_LIMIT = 12;
const FINAL_PROMPT_DEBUG_LIMIT = 8;
const promptDebugSnapshots: PromptDebugSnapshot[] = loadDebugSnapshots<PromptDebugSnapshot>(
  PROMPT_DEBUG_STORAGE_KEY,
  PROMPT_DEBUG_LIMIT,
);
const finalPromptDebugSnapshots: FinalPromptDebugSnapshot[] = loadDebugSnapshots<FinalPromptDebugSnapshot>(
  FINAL_PROMPT_DEBUG_STORAGE_KEY,
  FINAL_PROMPT_DEBUG_LIMIT,
);
let finalPromptDebugSubscribed = false;
let latestWorldbookEntries: Array<Record<string, unknown>> = [];

declare const getVariables: undefined | ((options?: Record<string, any>) => any);
declare const updateVariablesWith:
  | undefined
  | ((updater: (variables: Record<string, any>) => Record<string, any> | void, options?: Record<string, any>) => Promise<void> | void);
declare const getCurrentMessageId: undefined | (() => number);
declare const getLastMessageId: undefined | (() => number);
declare const Mvu: any;

function summarizeBaseData(data: Record<string, any>): string {
  const keys = Object.keys(data ?? {});
  if (!keys.length) return 'No message/MVU base data was available.';
  return keys.slice(0, 24).join(', ') + (keys.length > 24 ? ` ... +${keys.length - 24}` : '');
}

function emitPromptDebugUpdated() {
  window.dispatchEvent(new CustomEvent(PRIMORDIA_PROMPT_DEBUG_UPDATED, { detail: getPromptDebugSnapshots() }));
}

function emitFinalPromptDebugUpdated() {
  window.dispatchEvent(
    new CustomEvent(PRIMORDIA_FINAL_PROMPT_DEBUG_UPDATED, { detail: getFinalPromptDebugSnapshots() }),
  );
}

function loadDebugSnapshots<T>(key: string, limit: number): T[] {
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

function persistDebugSnapshots<T>(key: string, snapshots: T[], limit: number) {
  try {
    let items = snapshots.slice(0, limit);
    while (items.length > 0) {
      try {
        window.localStorage?.setItem(key, JSON.stringify(items));
        return;
      } catch {
        items = items.slice(0, -1);
      }
    }
    window.localStorage?.removeItem(key);
  } catch {
    // Debug persistence must never block generation.
  }
}

function rememberPromptDebug(snapshot: PromptDebugSnapshot) {
  const existingIndex = promptDebugSnapshots.findIndex(item => item.id === snapshot.id);
  if (existingIndex >= 0) promptDebugSnapshots.splice(existingIndex, 1, snapshot);
  else promptDebugSnapshots.unshift(snapshot);
  promptDebugSnapshots.splice(PROMPT_DEBUG_LIMIT);
  persistDebugSnapshots(PROMPT_DEBUG_STORAGE_KEY, promptDebugSnapshots, PROMPT_DEBUG_LIMIT);
  emitPromptDebugUpdated();
}

function estimateTokens(text: string): number {
  const asciiWords = text.match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const otherChars = Math.max(0, text.length - cjkChars);
  return Math.max(1, Math.ceil(cjkChars * 0.8 + asciiWords * 1.25 + otherChars / 4));
}

function coercePromptContent(message: Record<string, unknown>): string {
  const content = message.content ?? message.message ?? message.prompt ?? '';
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? '');
  }
}

function normalizePromptMessages(messages: unknown): FinalPromptDebugMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((message, index) => {
    const raw =
      typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : { content: message };
    const content = coercePromptContent(raw);
    return {
      index,
      role: String(raw.role ?? raw.name ?? 'unknown'),
      content,
      charCount: content.length,
      approxTokens: estimateTokens(content),
      raw: { ...raw },
    };
  });
}

function rememberFinalPromptDebug(options: {
  source: string;
  messages: unknown;
  dryRun?: boolean;
  model?: string;
  activatedWorldbookEntries?: Array<Record<string, unknown>>;
}) {
  const normalized = normalizePromptMessages(options.messages);
  if (!normalized.length) return;
  const totalChars = normalized.reduce((sum, message) => sum + message.charCount, 0);
  const approxTokens = normalized.reduce((sum, message) => sum + message.approxTokens, 0);
  const snapshot = {
    id: `final-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toLocaleString(),
    source: options.source,
    dryRun: options.dryRun,
    model: options.model,
    totalChars,
    approxTokens,
    messageCount: normalized.length,
    messages: normalized,
    activatedWorldbookEntries: (options.activatedWorldbookEntries ?? latestWorldbookEntries).map(entry => ({
      ...entry,
    })),
  };
  finalPromptDebugSnapshots.unshift(snapshot);
  finalPromptDebugSnapshots.splice(FINAL_PROMPT_DEBUG_LIMIT);
  persistDebugSnapshots(FINAL_PROMPT_DEBUG_STORAGE_KEY, finalPromptDebugSnapshots, FINAL_PROMPT_DEBUG_LIMIT);
  emitFinalPromptDebugUpdated();
  return snapshot;
}

export function recordFinalPromptDebugSnapshot(options: {
  source: string;
  messages: unknown;
  dryRun?: boolean;
  model?: string;
  activatedWorldbookEntries?: Array<Record<string, unknown>>;
}) {
  ensureFinalPromptDebugSubscription();
  return rememberFinalPromptDebug(options);
}

function rememberTextCompletionPrompt(prompt: string, dryRun?: boolean) {
  if (!prompt?.trim()) return;
  rememberFinalPromptDebug({
    source: 'GENERATE_AFTER_COMBINE_PROMPTS',
    dryRun,
    messages: [{ role: 'prompt', content: prompt }],
  });
}

function expandWorldbookScanText(text: string): string {
  const source = text.trim();
  if (!source) return '';
  const aliases = new Set<string>();
  const placeMatches =
    source.match(
      /[\u3400-\u9fff]{2,}(?:镇|城|村|港|堡|郡|湾|丘|谷|门|渡|集|寨|岛|湖|河|山|原|林|矿|寺|院|铺|店|市|区)/g,
    ) ?? [];
  for (const place of placeMatches) {
    const stripped = place.replace(
      /(?:镇|城|村|港|堡|郡|湾|丘|谷|门|渡|集|寨|岛|湖|河|山|原|林|矿|寺|院|铺|店|市|区)$/u,
      '',
    );
    if (stripped.length >= 2 && stripped !== place) aliases.add(stripped);
  }
  if (!aliases.size) return source;
  return [source, '【关键词别名】', ...aliases].join('\n');
}

function buildGreenWorldbookScanText(parts: Array<string | undefined>) {
  return expandWorldbookScanText(parts.filter((text): text is string => Boolean(text?.trim())).join('\n'));
}

function ensureFinalPromptDebugSubscription() {
  if (finalPromptDebugSubscribed || typeof eventOn !== 'function' || typeof tavern_events === 'undefined') return;
  finalPromptDebugSubscribed = true;

  if (tavern_events.WORLD_INFO_ACTIVATED) {
    eventOn(tavern_events.WORLD_INFO_ACTIVATED, entries => {
      latestWorldbookEntries = Array.isArray(entries) ? entries.map(entry => ({ ...entry })) : [];
      const latest = finalPromptDebugSnapshots[0];
      if (latest) {
        latest.activatedWorldbookEntries = latestWorldbookEntries.map(entry => ({ ...entry }));
        emitFinalPromptDebugUpdated();
      }
    });
  }

  if (tavern_events.WORLDINFO_SCAN_DONE) {
    eventOn(tavern_events.WORLDINFO_SCAN_DONE, eventData => {
      const activatedEntries = eventData?.activated?.entries;
      const successfulEntries = eventData?.new?.successful;
      const entries =
        activatedEntries instanceof Map
          ? [...activatedEntries.values()]
          : Array.isArray(successfulEntries)
            ? successfulEntries
            : [];
      latestWorldbookEntries = entries.map(entry => ({ ...entry }));
      const latest = finalPromptDebugSnapshots[0];
      if (latest) {
        latest.activatedWorldbookEntries = latestWorldbookEntries.map(entry => ({ ...entry }));
        emitFinalPromptDebugUpdated();
      }
    });
  }

  if (tavern_events.CHAT_COMPLETION_PROMPT_READY) {
    eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, eventData => {
      rememberFinalPromptDebug({
        source: 'CHAT_COMPLETION_PROMPT_READY',
        dryRun: eventData?.dryRun,
        messages: eventData?.chat,
      });
    });
  }

  if (tavern_events.CHAT_COMPLETION_SETTINGS_READY) {
    eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, generateData => {
      rememberFinalPromptDebug({
        source: 'CHAT_COMPLETION_SETTINGS_READY',
        model: generateData?.model,
        messages: generateData?.messages,
      });
    });
  }

  if (tavern_events.GENERATE_AFTER_DATA) {
    eventOn(tavern_events.GENERATE_AFTER_DATA, (generateData, dryRun) => {
      rememberFinalPromptDebug({
        source: 'GENERATE_AFTER_DATA',
        dryRun,
        messages: generateData?.prompt,
      });
    });
  }

  if (tavern_events.GENERATE_AFTER_COMBINE_PROMPTS) {
    eventOn(tavern_events.GENERATE_AFTER_COMBINE_PROMPTS, result => {
      rememberTextCompletionPrompt(result?.prompt, result?.dryRun);
    });
  }
}

export function getPromptDebugSnapshots() {
  return promptDebugSnapshots.map(item => ({ ...item, injects: item.injects.map(inject => ({ ...inject })) }));
}

export function getFinalPromptDebugSnapshots() {
  ensureFinalPromptDebugSubscription();
  return finalPromptDebugSnapshots.map(item => ({
    ...item,
    messages: item.messages.map(message => ({ ...message, raw: { ...message.raw } })),
    activatedWorldbookEntries: item.activatedWorldbookEntries.map(entry => ({ ...entry })),
  }));
}

export function onPromptDebugSnapshotsUpdated(callback: (snapshots: PromptDebugSnapshot[]) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<PromptDebugSnapshot[]>).detail);
  window.addEventListener(PRIMORDIA_PROMPT_DEBUG_UPDATED, listener);
  return () => window.removeEventListener(PRIMORDIA_PROMPT_DEBUG_UPDATED, listener);
}

export function onFinalPromptDebugSnapshotsUpdated(callback: (snapshots: FinalPromptDebugSnapshot[]) => void) {
  ensureFinalPromptDebugSubscription();
  const listener = (event: Event) => callback((event as CustomEvent<FinalPromptDebugSnapshot[]>).detail);
  window.addEventListener(PRIMORDIA_FINAL_PROMPT_DEBUG_UPDATED, listener);
  return () => window.removeEventListener(PRIMORDIA_FINAL_PROMPT_DEBUG_UPDATED, listener);
}

async function scanWorldbookForPreflight(texts: string[]): Promise<Array<Record<string, unknown>>> {
  ensureFinalPromptDebugSubscription();
  latestWorldbookEntries = [];
  const cleanedTexts = texts.map(text => text.trim()).filter(Boolean);
  if (!cleanedTexts.length) return [];

  const context = (window as any).TavernHelper ?? (window as any).SillyTavern ?? {};
  const getWorldInfoPrompt = context.getWorldInfoPrompt ?? (window as any).getWorldInfoPrompt;
  if (typeof getWorldInfoPrompt !== 'function') return [];

  try {
    await getWorldInfoPrompt(cleanedTexts, 200_000, true);
    await new Promise(resolve => window.setTimeout(resolve, 80));
    return latestWorldbookEntries.map(entry => ({ ...entry }));
  } catch (error) {
    console.warn('[primordia] worldbook preflight scan failed:', error);
    return [];
  }
}

export async function previewUnifiedNarrativeRequest(
  userInput: string,
  callbacks: Pick<UnifiedRequestCallbacks, 'authoritativeData' | 'worldbookScanText'> = {},
): Promise<PromptPreflightResult> {
  const prompt = userInput.trim();
  if (!prompt) return { ok: false, error: '没有可预检的行动内容。' };

  try {
    const baseData = await readBaseMvuData();
    const authoritativeData = callbacks.authoritativeData
      ? mergeAuthoritativeData(baseData, callbacks.authoritativeData)
      : baseData;
    const visibleUserAction = extractVisibleUserAction(prompt);
    const promptForInject =
      /<玩家本回合行动>[\s\S]*?<\/玩家本回合行动>/.test(prompt) || isStructuredNarrationPrompt(prompt)
        ? prompt
        : `<玩家本回合行动>\n${prompt}\n</玩家本回合行动>`;
    const worldbookScanText = callbacks.worldbookScanText?.trim() ?? '';
    const greenWorldbookScanText = buildGreenWorldbookScanText([worldbookScanText, visibleUserAction || prompt]);
    const activatedWorldbookEntries = await scanWorldbookForPreflight([greenWorldbookScanText]);

    const snapshot = rememberFinalPromptDebug({
      source: '发送前预检',
      dryRun: true,
      messages: [
        greenWorldbookScanText
          ? {
              role: 'system',
              content: greenWorldbookScanText,
              position: 'none',
              depth: 0,
              should_scan: true,
              preview_note: '前端用于绿灯世界书扫描的文本',
            }
          : null,
        {
          role: 'system',
          content: promptForInject,
          position: 'worldbook',
          depth: 0,
          entry_name: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
          should_scan: false,
          preview_note: '前端完整发送包会写入固定世界书条目',
        },
        {
          role: 'user',
          content: visibleUserAction || prompt,
          preview_note: '将作为本回合 generate.user_input 的真实行动',
        },
        {
          role: 'system',
          content: JSON.stringify(authoritativeData, null, 2),
          preview_note: '本回合随 user 楼层保存的权威变量快照',
        },
      ].filter(Boolean),
      activatedWorldbookEntries,
    });

    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '提示词预检失败。' };
  }
}

async function waitGlobalBriefly(globalName: string): Promise<boolean> {
  if (typeof waitGlobalInitialized !== 'function') return false;
  try {
    await Promise.race([
      waitGlobalInitialized(globalName),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(`${globalName} 初始化超时`)), GLOBAL_WAIT_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

function stripThinkingBlocks(content: string): string {
  if (!content) return '';
  let cleaned = content.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*?<\/redacted_reasoning>/gi, '');

  const thinkingStart = cleaned.search(/<thinking\b[^>]*>/i);
  if (thinkingStart !== -1) cleaned = cleaned.slice(0, thinkingStart);

  const thinkStart = cleaned.search(/<think\b[^>]*>/i);
  if (thinkStart !== -1) cleaned = cleaned.slice(0, thinkStart);

  return cleaned.trim();
}

function extractLastTag(content: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const matches = [...content.matchAll(regex)];
  return matches.at(-1)?.[1]?.trim() ?? '';
}

async function readBaseMvuData(): Promise<Record<string, any>> {
  try {
    const mvuData = await getPrimordiaMvuData();
    const statData = unwrapPrimordiaStatData(mvuData);
    if (statData) return statData;

    const currentId =
      typeof getCurrentMessageId === 'function'
        ? getCurrentMessageId()
        : typeof getLastMessageId === 'function'
          ? getLastMessageId()
          : undefined;
    const latestId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
    const messageIds = [
      typeof currentId === 'number' ? currentId : undefined,
      typeof latestId === 'number' ? latestId : undefined,
      -1,
    ].filter((value, index, list): value is number => typeof value === 'number' && list.indexOf(value) === index);
    const options: Array<Record<string, any>> = [
      ...messageIds.map(message_id => ({ type: 'message', message_id })),
      { type: 'message' },
    ];
    const data = readPrimordiaStatDataFromOptions(options);
    if (data) return data;
    await waitGlobalBriefly('Mvu');
    return readPrimordiaStatDataFromOptions(options) ?? {};
  } catch {
    /* 使用空数据 */
  }

  return {};
}

async function writeMessageStatData(statData: Record<string, any>, messageId?: number): Promise<boolean> {
  const target = { type: 'message', message_id: typeof messageId === 'number' ? messageId : -1 };
  try {
    return await writePrimordiaStatData(cloneData(statData), target);
  } catch (error) {
    console.warn('[primordia] 写入 assistant stat_data 失败:', error);
  }
  return false;
}

function normalizeAssistantMessage(raw: string): {
  message: string;
  mvuMessage: string;
  latest: LatestMaintextPayload;
} {
  const cleaned = stripThinkingBlocks(raw);
  const craftResult = extractLastTag(cleaned, 'craft_result');
  const guestUpdate = extractLastTag(cleaned, 'guest_update');
  const regularGuestUpdate = extractLastTag(cleaned, 'regular_guest_update');
  const promiseUpdate = extractLastTag(cleaned, 'promise_update');
  const characterBehaviorUpdate = extractLastTag(cleaned, 'character_behavior_update');
  const shop = extractLastTag(cleaned, 'shop');
  let maintext = stripHiddenOutputTags(extractLastTag(cleaned, 'maintext') || extractLastTag(cleaned, 'NARRATIVE'));
  if (maintext && !hasRenderableStreamingText(maintext)) {
    maintext = '';
  }
  if (!maintext && craftResult) {
    maintext = '炉台旁的制作已经完成，结果被登记入册。';
  }
  if (!maintext && shop) {
    maintext = '新的店铺已经被找到，货架内容被登记入册。';
  }
  if (!maintext) {
    maintext = stripHiddenOutputTags(cleaned)
      .replace(/```[\w-]*\s*/g, '')
      .replace(/```/g, '')
      .replace(/^\s*(收到(?:命令|指令)?[，,。.！!：:]?|明白[，,。.！!：:]?|好的[，,。.！!：:]?)/, '')
      .replace(/^\s*(我(?:会|将)(?:严格)?(?:遵守|按照|根据)[\s\S]{0,80}?(?:执行|进行|回复)[，,。.！!：:]?)/, '')
      .trim();
    if (maintext && !hasRenderableStreamingText(maintext)) {
      maintext = '';
    }
  }
  if (!maintext) throw new Error('生成内容缺少 <maintext> 正文。');

  const option = extractLastTag(cleaned, 'option');
  const sum = extractLastTag(cleaned, 'sum');
  const updateVariable = extractLastTag(cleaned, 'UpdateVariable');
  const jsonPatch = extractLastTag(cleaned, 'JSONPatch');

  let message = `<maintext>${maintext}</maintext>`;
  if (option) message += `\n\n<option>\n${option}\n</option>`;
  if (sum) message += `\n\n<sum>\n${sum}\n</sum>`;
  if (shop) message += `\n\n<shop>\n${shop}\n</shop>`;
  if (craftResult) message += `\n\n<craft_result>\n${craftResult}\n</craft_result>`;
  if (guestUpdate) message += `\n\n<guest_update>\n${guestUpdate}\n</guest_update>`;
  if (regularGuestUpdate) message += `\n\n<regular_guest_update>\n${regularGuestUpdate}\n</regular_guest_update>`;
  if (promiseUpdate) message += `\n\n<promise_update>\n${promiseUpdate}\n</promise_update>`;
  if (characterBehaviorUpdate) message += `\n\n<character_behavior_update>\n${characterBehaviorUpdate}\n</character_behavior_update>`;

  let mvuMessage = message;
  if (updateVariable) mvuMessage += `\n\n<UpdateVariable>\n${updateVariable}\n</UpdateVariable>`;
  else if (jsonPatch) mvuMessage += `\n\n<UpdateVariable>\n<JSONPatch>\n${jsonPatch}\n</JSONPatch>\n</UpdateVariable>`;

  return {
    message,
    mvuMessage,
    latest: {
      maintext: parseMaintext(message),
      options: parseOptions(message),
      sum: parseSum(message),
      shop: parseShop(message),
      craftResult: parseCraftResult(message),
      guestUpdates: parseGuestUpdates(message),
      regularGuestUpdates: parseRegularGuestUpdates(message),
      promiseUpdates: parsePromiseUpdates(message),
      characterBehaviorUpdates: parseCharacterBehaviorUpdates(message),
      fullMessage: mvuMessage,
    },
  };
}

function stripHiddenOutputTags(content: string): string {
  return content
    .replace(/<shop\b[^>]*>[\s\S]*?<\/shop>/gi, '')
    .replace(/<craft_result\b[^>]*>[\s\S]*?<\/craft_result>/gi, '')
    .replace(/<guest_update\b[^>]*>[\s\S]*?<\/guest_update>/gi, '')
    .replace(/<regular_guest_update\b[^>]*>[\s\S]*?<\/regular_guest_update>/gi, '')
    .replace(/<promise_update\b[^>]*>[\s\S]*?<\/promise_update>/gi, '')
    .replace(/<character_behavior_update\b[^>]*>[\s\S]*?<\/character_behavior_update>/gi, '')
    .replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable>/gi, '')
    .replace(/<JSONPatch\b[^>]*>[\s\S]*?<\/JSONPatch>/gi, '')
    .replace(/<Analysis\b[^>]*>[\s\S]*?<\/Analysis>/gi, '')
    .replace(/<CONTEXT_conception\b[^>]*>[\s\S]*?<\/CONTEXT_conception>/gi, '')
    .trim();
}

function messageHasScenePatch(message: string): boolean {
  const text = message || '';
  const hasReadableScenePatch = [
    /世界[^<>{}\x5b\x5d\n]{0,20}当前地点[^<>{}\x5b\x5d\n]{0,20}(?:具体位置|地点|区域)/,
    /主角[^<>{}\x5b\x5d\n]{0,20}所在位置/,
  ].some(pattern => pattern.test(text));
  return hasReadableScenePatch || hasLegacyCompatiblePathReference(text, ['世界.当前地点', '主角.所在位置']);
}

function messageHasTimePatch(message: string): boolean {
  const text = message || '';
  const hasReadableTimePatch =
    /当前历法[^<>{}\x5b\x5d\n]{0,20}(?:年|月份序号|月序号|月份名|月|季节|日|时段|天气|时间|钟点|时|小时|分|分钟)/.test(
      text,
    );
  return hasReadableTimePatch || hasLegacyCompatiblePathReference(text, ['世界.当前历法']);
}

function messageHasVariablePatch(message: string): boolean {
  return Boolean(extractEmbeddedJsonPatch(message) || extractLastTag(message, 'UpdateVariable'));
}

function messageHasTopLevelPatch(message: string, topLevelName: string): boolean {
  const escaped = topLevelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = message || '';
  return [
    new RegExp(`["']?path["']?\\s*:\\s*["']/stat_data/${escaped}(?:/|["'])`),
    new RegExp(`["']?path["']?\\s*:\\s*["']/${escaped}(?:/|["'])`),
    new RegExp(`${escaped}\\.`),
  ].some(pattern => pattern.test(text));
}

async function parseMvuData(message: string, baseData: Record<string, any>): Promise<Record<string, any>> {
  if (extractEmbeddedJsonPatch(message)) return applyEmbeddedJsonPatch(message, baseData);

  let parsedData = baseData;
  try {
    await waitGlobalBriefly('Mvu');
    if (typeof Mvu !== 'undefined' && typeof Mvu.parseMessage === 'function') {
      const baseEnvelope = wrapPrimordiaMvuData(baseData);
      const parsedEnvelope = await Mvu.parseMessage(message, baseEnvelope);
      parsedData = unwrapPrimordiaStatData(parsedEnvelope) ?? parsedEnvelope?.stat_data ?? baseData;
    }
  } catch (error) {
    console.warn('[primordia] MVU 解析失败:', error);
  }
  return mergeData(baseData, parsedData);
}

function cloneData<T>(data: T): T {
  try {
    return structuredClone(data);
  } catch {
    return JSON.parse(JSON.stringify(data));
  }
}

function sameJsonValue(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return left === right;
  }
}

function summarizeNativeAssistantTurn(nativeTurn: { assistantMessage: Record<string, any>; streamedText: string }) {
  const message = nativeTurn.assistantMessage?.message;
  const preview = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
  };
  return {
    assistantMessageId: nativeTurn.assistantMessage?.message_id,
    assistantKeys: Object.keys(nativeTurn.assistantMessage ?? {}),
    messageType: typeof message,
    messageLength: typeof message === 'string' ? message.length : undefined,
    messagePreview: preview(message),
    streamedTextLength: nativeTurn.streamedText.length,
    streamedTextPreview: preview(nativeTurn.streamedText),
    extraKeys: Object.keys(nativeTurn.assistantMessage?.extra ?? {}),
    dataKeys:
      nativeTurn.assistantMessage?.data && typeof nativeTurn.assistantMessage.data === 'object'
        ? Object.keys(nativeTurn.assistantMessage.data)
        : [],
  };
}

function readGaugeCurrent(data: Record<string, any>, topLevel: string, gauge: string): number | undefined {
  const value = data?.[topLevel]?.[gauge];
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.当前值 ?? value.value : value;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = Number(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readGaugeMax(data: Record<string, any>, topLevel: string, gauge: string): number | undefined {
  const value = data?.[topLevel]?.[gauge];
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.上限 ?? value.最大值 ?? value.max : undefined;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = Number(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function writeGaugeCurrent(data: Record<string, any>, topLevel: string, gauge: string, value: number, maxFallback = 100) {
  if (!data[topLevel] || typeof data[topLevel] !== 'object' || Array.isArray(data[topLevel])) data[topLevel] = {};
  const parent = data[topLevel] as Record<string, any>;
  if (!parent[gauge] || typeof parent[gauge] !== 'object' || Array.isArray(parent[gauge])) {
    parent[gauge] = { 当前值: value, 上限: maxFallback };
    return;
  }
  parent[gauge].当前值 = value;
  if (parent[gauge].上限 === undefined && parent[gauge].最大值 === undefined && parent[gauge].max === undefined) {
    parent[gauge].上限 = maxFallback;
  }
}

function extractJsonPatchOperations(message: string): Array<Record<string, any>> {
  const patchText = extractEmbeddedJsonPatch(message);
  if (!patchText) return [];
  try {
    const parsed = JSON.parse(patchText);
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

function patchPathTargetsGauge(path: unknown, topLevel: string, gauge: string) {
  if (typeof path !== 'string') return false;
  const parts = parsePatchPath(path);
  if (parts[0] !== topLevel || parts[1] !== gauge) return false;
  return parts.length === 2 || ['当前值', 'value'].includes(parts[2] ?? '');
}

function explicitGaugeDeltaFromJsonPatch(message: string, topLevel: string, gauge: string): number | undefined {
  const operations = extractJsonPatchOperations(message);
  let delta = 0;
  let found = false;
  operations.forEach(operation => {
    if (operation.op !== 'delta' || !patchPathTargetsGauge(operation.path, topLevel, gauge)) return;
    const value = Number(operation.value ?? 0);
    if (!Number.isFinite(value)) return;
    delta += value;
    found = true;
  });
  return found ? delta : undefined;
}

function hasSevereGaugeDepletionReason(message: string, gauge: string) {
  const text = message || '';
  if (gauge === '精力') return /耗尽|力竭|脱力|虚脱|昏迷|晕倒|透支|倒下|精疲力尽|精力归零|精力耗尽/.test(text);
  if (gauge === '生命') return /濒死|死亡|致命|重伤|昏迷|生命垂危|生命归零/.test(text);
  return false;
}

function guardGeneratedGauge(
  parsedData: Record<string, any>,
  baseData: Record<string, any>,
  message: string,
  options: { topLevel: string; gauge: string; maxDrop: number },
) {
  const baseValue = readGaugeCurrent(baseData, options.topLevel, options.gauge);
  const parsedValue = readGaugeCurrent(parsedData, options.topLevel, options.gauge);
  if (baseValue === undefined || parsedValue === undefined) return;

  const maxValue = readGaugeMax(parsedData, options.topLevel, options.gauge) ?? readGaugeMax(baseData, options.topLevel, options.gauge) ?? 100;
  const clamp = (value: number) => Math.max(0, Math.min(Math.max(1, maxValue), Math.floor(value)));
  const explicitDelta = explicitGaugeDeltaFromJsonPatch(message, options.topLevel, options.gauge);
  if (explicitDelta !== undefined) {
    writeGaugeCurrent(parsedData, options.topLevel, options.gauge, clamp(baseValue + explicitDelta), maxValue);
    return;
  }

  const drop = baseValue - parsedValue;
  if (drop > options.maxDrop && !hasSevereGaugeDepletionReason(message, options.gauge)) {
    writeGaugeCurrent(parsedData, options.topLevel, options.gauge, clamp(baseValue), maxValue);
  }
}

function guardGeneratedCoreStats(parsedData: Record<string, any>, baseData: Record<string, any>, message: string) {
  const next = cloneData(parsedData);
  guardGeneratedGauge(next, baseData, message, { topLevel: '主角', gauge: '精力', maxDrop: 35 });
  guardGeneratedGauge(next, baseData, message, { topLevel: '主角', gauge: '生命', maxDrop: 45 });
  return next;
}

function mergeData(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const next = cloneData(target);
  const mergeInto = (left: Record<string, any>, right: Record<string, any>) => {
    Object.entries(right).forEach(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!left[key] || typeof left[key] !== 'object' || Array.isArray(left[key])) left[key] = {};
        mergeInto(left[key], value);
      } else {
        left[key] = value;
      }
    });
  };
  mergeInto(next, source);
  return next;
}

function mergeAuthoritativeData(
  target: Record<string, any>,
  source: Record<string, any>,
  options: {
    preserveNarrativeScene?: boolean;
    preserveNarrativeTime?: boolean;
    preserveNarrativeTavern?: boolean;
    preserveNarrativeRelationships?: boolean;
    preserveNarrativeFarmBrew?: boolean;
    preserveNarrativeStreetShop?: boolean;
    preserveNarrativeProtagonist?: boolean;
    keepGeneratedInventory?: boolean;
    keepGeneratedFarmBrew?: boolean;
    keepGeneratedProtagonistStats?: boolean;
  } = {},
): Record<string, any> {
  const next = mergeData(target, source);

  // Frontend-settled flows keep the frontend snapshot. Free-text inventory changes may
  // deliberately arrive through MVU/JSONPatch, so let the parsed target inventory survive
  // only when the caller has confirmed that this turn may use generated inventory.
  if (options.keepGeneratedInventory && target.库房 && typeof target.库房 === 'object') {
    next.库房 = cloneData(target.库房);
  } else if (source.库房 && typeof source.库房 === 'object') {
    next.库房 = cloneData(source.库房);
  }
  if (options.keepGeneratedInventory && target.行囊 && typeof target.行囊 === 'object') {
    next.行囊 = cloneData(target.行囊);
  } else if (source.行囊 && typeof source.行囊 === 'object') {
    next.行囊 = cloneData(source.行囊);
  }
  if (target.临时状态 && typeof target.临时状态 === 'object' && !sameJsonValue(source.临时状态, target.临时状态)) {
    next.临时状态 = cloneData(target.临时状态);
  } else if (source.临时状态 && typeof source.临时状态 === 'object') {
    next.临时状态 = cloneData(source.临时状态);
  }

  if (
    (options.keepGeneratedFarmBrew || options.preserveNarrativeFarmBrew) &&
    target.农田与酒窖 &&
    typeof target.农田与酒窖 === 'object'
  ) {
    next.农田与酒窖 = cloneData(target.农田与酒窖);
  } else if (source.农田与酒窖 && typeof source.农田与酒窖 === 'object') {
    next.农田与酒窖 = cloneData(source.农田与酒窖);
  }

  if (source.人物羁绊 && typeof source.人物羁绊 === 'object') {
    next.人物羁绊 =
      (options.preserveNarrativeRelationships || options.preserveNarrativeScene) &&
      target.人物羁绊 &&
      typeof target.人物羁绊 === 'object'
        ? mergeData(cloneData(source.人物羁绊), target.人物羁绊)
        : cloneData(source.人物羁绊);
  }
  if (next.人物羁绊 && typeof next.人物羁绊 === 'object') delete next.人物;

  if (source.酒馆 && typeof source.酒馆 === 'object') {
    next.酒馆 = {
      ...(next.酒馆 && typeof next.酒馆 === 'object' ? next.酒馆 : {}),
      ...cloneData(source.酒馆),
    };
    if (options.preserveNarrativeTavern && target.酒馆 && typeof target.酒馆 === 'object') {
      next.酒馆 = mergeData(next.酒馆, target.酒馆);
    }
  }

  // Let narrative-only turns keep explicit scene/inventory patches from MVU, while
  // frontend-settled flows still keep their settled resource snapshots.
  const targetWorld =
    (options.preserveNarrativeScene || options.preserveNarrativeTime) && target.世界 && typeof target.世界 === 'object'
      ? target.世界
      : undefined;
  const targetProtagonist =
    options.preserveNarrativeScene && target.主角 && typeof target.主角 === 'object' ? target.主角 : undefined;
  const targetStreetShop =
    options.preserveNarrativeScene && target.街坊商铺 && typeof target.街坊商铺 === 'object'
      ? target.街坊商铺
      : undefined;
  const targetSceneText = [
    typeof targetWorld?.当前地点 === 'string' ? targetWorld.当前地点 : '',
    targetWorld?.当前地点 && typeof targetWorld.当前地点 === 'object'
      ? `${targetWorld.当前地点.区域 ?? ''} ${targetWorld.当前地点.具体位置 ?? ''}`
      : '',
    typeof targetProtagonist?.所在位置 === 'string' ? targetProtagonist.所在位置 : '',
  ]
    .filter(Boolean)
    .join(' ');
  const targetHasExplicitScene = targetSceneText.trim().length > 0;
  const targetCurrentShop =
    targetStreetShop && typeof targetStreetShop.当前商铺 === 'string' ? targetStreetShop.当前商铺.trim() : '';
  const targetSceneLooksShop =
    Boolean(targetCurrentShop) || /街坊商铺|商铺|店铺|摊位|摊|市集|市场|货架/.test(targetSceneText);

  if (source.世界 && typeof source.世界 === 'object') {
    next.世界 = {
      ...(next.世界 && typeof next.世界 === 'object' ? next.世界 : {}),
      ...cloneData(source.世界),
    };
    if (targetWorld && Object.prototype.hasOwnProperty.call(targetWorld, '当前地点')) {
      next.世界.当前地点 = cloneData(targetWorld.当前地点);
    }
    if (options.preserveNarrativeTime && targetWorld && Object.prototype.hasOwnProperty.call(targetWorld, '当前历法')) {
      next.世界.当前历法 = cloneData(targetWorld.当前历法);
    }
  }
  if (source.主角 && typeof source.主角 === 'object') {
    next.主角 = {
      ...(next.主角 && typeof next.主角 === 'object' ? next.主角 : {}),
      ...cloneData(source.主角),
    };
    if (options.preserveNarrativeProtagonist && target.主角 && typeof target.主角 === 'object') {
      next.主角 = mergeData(next.主角, target.主角);
    }
    if (options.keepGeneratedProtagonistStats && target.主角 && typeof target.主角 === 'object') {
      const generatedProtagonist = target.主角 as Record<string, any>;
      if (Object.prototype.hasOwnProperty.call(generatedProtagonist, '精力')) {
        next.主角.精力 = cloneData(generatedProtagonist.精力);
      }
      if (Object.prototype.hasOwnProperty.call(generatedProtagonist, '生命')) {
        next.主角.生命 = cloneData(generatedProtagonist.生命);
      }
      if (Object.prototype.hasOwnProperty.call(generatedProtagonist, 'hp')) {
        next.主角.hp = cloneData(generatedProtagonist.hp);
      }
    }
    if (targetProtagonist && Object.prototype.hasOwnProperty.call(targetProtagonist, '所在位置')) {
      next.主角.所在位置 = cloneData(targetProtagonist.所在位置);
    }
  }
  if (source.街坊商铺 && typeof source.街坊商铺 === 'object') {
    next.街坊商铺 = {
      ...(next.街坊商铺 && typeof next.街坊商铺 === 'object' ? next.街坊商铺 : {}),
      ...cloneData(source.街坊商铺),
    };
    if (options.preserveNarrativeStreetShop && target.街坊商铺 && typeof target.街坊商铺 === 'object') {
      next.街坊商铺 = mergeData(next.街坊商铺, target.街坊商铺);
    }
    if (targetCurrentShop) {
      next.街坊商铺.当前商铺 = targetCurrentShop;
    } else if (
      targetSceneLooksShop &&
      targetStreetShop &&
      Object.prototype.hasOwnProperty.call(targetStreetShop, '当前商铺')
    ) {
      next.街坊商铺.当前商铺 = cloneData(targetStreetShop.当前商铺);
    } else if (targetHasExplicitScene && !targetSceneLooksShop) {
      next.街坊商铺.当前商铺 = '';
    }
  }

  return next;
}

function parsePatchPath(path: string): string[] {
  return path
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .filter((part, index) => !(index === 0 && part === 'stat_data'))
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function setPatchValue(target: Record<string, any>, path: string, value: any, insert = false) {
  const parts = parsePatchPath(path);
  if (!parts.length) return;
  let cursor: any = target;
  for (const part of parts.slice(0, -1)) {
    if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  const key = parts[parts.length - 1];
  if (Array.isArray(cursor)) {
    const index = key === '-' ? cursor.length : Number(key);
    if (insert) cursor.splice(Number.isFinite(index) ? index : cursor.length, 0, value);
    else cursor[Number.isFinite(index) ? index : cursor.length] = value;
    return;
  }
  cursor[key] = value;
}

function deltaPatchValue(target: Record<string, any>, path: string, value: number) {
  const parts = parsePatchPath(path);
  if (!parts.length) return;
  let cursor: any = target;
  for (const part of parts.slice(0, -1)) {
    if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  const key = parts[parts.length - 1];
  const current = cursor[key];
  const delta = Number(value ?? 0);
  if (!Number.isFinite(delta)) return;
  if (current && typeof current === 'object' && !Array.isArray(current) && Object.prototype.hasOwnProperty.call(current, '当前值')) {
    current.当前值 = Number(current.当前值 ?? 0) + delta;
    return;
  }
  if (current && typeof current === 'object') return;
  cursor[key] = Number(current ?? 0) + delta;
}

function removePatchValue(target: Record<string, any>, path: string) {
  const parts = parsePatchPath(path);
  if (!parts.length) return;
  let cursor: any = target;
  for (const part of parts.slice(0, -1)) {
    if (cursor[part] == null) return;
    cursor = cursor[part];
  }
  const key = parts[parts.length - 1];
  if (Array.isArray(cursor)) cursor.splice(Number(key), 1);
  else delete cursor[key];
}

function mirrorFarmBrewAliases(data: Record<string, any>) {
  const farmBrew =
    data.农田与酒窖 && typeof data.农田与酒窖 === 'object' && !Array.isArray(data.农田与酒窖)
      ? (data.农田与酒窖 as Record<string, any>)
      : {};
  if (data.农田 && typeof data.农田 === 'object' && !Array.isArray(data.农田)) {
    farmBrew.农田 = mergeData(
      farmBrew.农田 && typeof farmBrew.农田 === 'object' ? farmBrew.农田 : {},
      data.农田 as Record<string, any>,
    );
  }
  if (data.酒窖桶 && typeof data.酒窖桶 === 'object' && !Array.isArray(data.酒窖桶)) {
    farmBrew.酒窖桶 = mergeData(
      farmBrew.酒窖桶 && typeof farmBrew.酒窖桶 === 'object' ? farmBrew.酒窖桶 : {},
      data.酒窖桶 as Record<string, any>,
    );
  }
  if (Object.keys(farmBrew).length) data.农田与酒窖 = farmBrew;
}

function extractEmbeddedJsonPatch(message: string): string {
  return extractLastTag(message, 'JSONPatch') || extractLastTag(extractLastTag(message, 'UpdateVariable'), 'JSONPatch');
}

function applyEmbeddedJsonPatch(message: string, baseData: Record<string, any>): Record<string, any> {
  const patchText = extractEmbeddedJsonPatch(message);
  if (!patchText) return baseData;
  try {
    const operations = JSON.parse(patchText);
    if (!Array.isArray(operations)) return baseData;
    const nextData = cloneData(baseData);
    for (const operation of operations) {
      if (!operation || typeof operation !== 'object' || typeof operation.path !== 'string') continue;
      if (operation.path === '/编年摘要' || operation.path.startsWith('/编年摘要/')) continue;
      if (operation.op === 'replace' || operation.op === 'add')
        setPatchValue(nextData, operation.path, operation.value);
      else if (operation.op === 'insert') setPatchValue(nextData, operation.path, operation.value, true);
      else if (operation.op === 'delta') deltaPatchValue(nextData, operation.path, operation.value);
      else if (operation.op === 'remove' || operation.op === 'delete') removePatchValue(nextData, operation.path);
    }
    mirrorFarmBrewAliases(nextData);
    return nextData;
  } catch (error) {
    console.warn('[primordia] JSONPatch 兜底解析失败:', error);
    return baseData;
  }
}

function emitStoryUpdated(latest: LatestMaintextPayload) {
  window.dispatchEvent(new CustomEvent(PRIMORDIA_STORY_UPDATED, { detail: latest }));
}

function extractPartialTagBody(content: string, tagName: string): string {
  if (!content) return '';
  const openTag = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const openMatch = openTag.exec(content);
  if (!openMatch) return '';
  const start = openMatch.index + openMatch[0].length;
  const closeTag = new RegExp(`</${tagName}>`, 'i');
  const closeMatch = closeTag.exec(content.slice(start));
  const end = closeMatch ? start + closeMatch.index : content.length;
  return content.slice(start, end).trim();
}

function hasRenderableStreamingText(text: string): boolean {
  return text.replace(/[-—–_\s.。·・]+/g, '').trim().length > 0;
}

function extractStreamingMaintext(content: string): string {
  const cleaned = stripThinkingBlocks(content);
  const body = extractPartialTagBody(cleaned, 'maintext') || extractPartialTagBody(cleaned, 'NARRATIVE');
  if (!body) return '';
  const text = stripHiddenOutputTags(body)
    .replace(/<[^>\n]*$/g, '')
    .replace(/```[\w-]*\s*/g, '')
    .replace(/```/g, '')
    .trim();
  return hasRenderableStreamingText(text) ? text : '';
}

function emitStoryStreaming(maintext: string) {
  if (!maintext.trim()) return;
  window.dispatchEvent(new CustomEvent(PRIMORDIA_STORY_STREAMING, { detail: maintext }));
}

function extractVisibleUserAction(prompt: string): string {
  const userTag = extractLastTag(prompt, 'user');
  if (userTag) {
    return userTag
      .split(/\r?\n/)
      .filter(line => !/^\s*当前地点\s*[:：]/.test(line))
      .join('\n')
      .trim();
  }
  const firstSection = prompt.split(/【叙述者权限边界】|【当前权威局势】|【本回合标准结算单】/)[0] ?? prompt;
  return firstSection
    .replace(/<\/?玩家本回合行动>/g, '')
    .replace(/^\s*当前地点\s*[:：].*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function isStructuredNarrationPrompt(prompt: string): boolean {
  return /【叙述者权限边界】|【当前权威局势】|【本回合标准结算单】|【当前前端场景】/.test(prompt);
}

export function onPrimordiaStoryUpdated(callback: (latest: LatestMaintextPayload) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<LatestMaintextPayload>).detail);
  window.addEventListener(PRIMORDIA_STORY_UPDATED, listener);
  return () => window.removeEventListener(PRIMORDIA_STORY_UPDATED, listener);
}

export function onPrimordiaStoryStreaming(callback: (maintext: string) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<string>).detail);
  window.addEventListener(PRIMORDIA_STORY_STREAMING, listener);
  return () => window.removeEventListener(PRIMORDIA_STORY_STREAMING, listener);
}

export async function parseNarrativeMvuMessage(
  rawMessage: string,
  baseData: Record<string, any> = {},
): Promise<{
  latest: LatestMaintextPayload;
  mvuData: Record<string, any>;
  hasScenePatch: boolean;
  hasVariablePatch: boolean;
  normalizedMessage: string;
}> {
  const { message, mvuMessage, latest } = normalizeAssistantMessage(rawMessage);
  const mvuData = await parseMvuData(mvuMessage, baseData);
  return {
    latest,
    mvuData,
    hasScenePatch: messageHasScenePatch(mvuMessage),
    hasVariablePatch: messageHasVariablePatch(mvuMessage),
    normalizedMessage: message,
  };
}

export async function runUnifiedNarrativeRequest(
  userInput: string,
  callbacks: UnifiedRequestCallbacks = {},
): Promise<UnifiedRequestResult> {
  const prompt = userInput.trim();
  if (!prompt) return { ok: false, error: '没有可发送的行动内容。' };

  let uninjectScanPrompts: (() => void) | undefined;

  try {
    const baseData = await readBaseMvuData();
    const userMessageData = callbacks.authoritativeData
      ? mergeAuthoritativeData(baseData, callbacks.authoritativeData)
      : baseData;
    const shouldCreateUserMessage = callbacks.createUserMessage !== false;
    const debugId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const turnId = `primordia-turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const visibleUserAction = extractVisibleUserAction(prompt);
    const promptForInject =
      /<玩家本回合行动>[\s\S]*?<\/玩家本回合行动>/.test(prompt) || isStructuredNarrationPrompt(prompt)
        ? prompt
        : `<玩家本回合行动>\n${prompt}\n</玩家本回合行动>`;
    const worldbookScanText = callbacks.worldbookScanText?.trim();
    const greenWorldbookScanText = buildGreenWorldbookScanText([worldbookScanText, visibleUserAction || prompt]);
    const injects: Array<Record<string, unknown>> = [];
    if (greenWorldbookScanText) {
      injects.push({
        role: 'system',
        content: greenWorldbookScanText,
        position: 'none',
        depth: 0,
        should_scan: true,
      });
    }

    if (greenWorldbookScanText && typeof injectPrompts === 'function') {
      const injected = injectPrompts(
        [
          {
            id: `${turnId}-worldbook-scan`,
            role: 'system',
            content: greenWorldbookScanText,
            position: 'none',
            depth: 0,
            should_scan: true,
          },
        ],
        { once: true },
      );
      uninjectScanPrompts = injected.uninject;
    }

    rememberPromptDebug({
      id: debugId,
      createdAt: new Date().toLocaleString(),
      status: 'pending',
      userInput: visibleUserAction || prompt,
      baseDataSummary: summarizeBaseData(baseData),
      injects: [
        ...injects,
        {
          role: 'user',
          content: promptForInject,
          position: 'worldbook',
          depth: 0,
          entry_name: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
          preview_note: '本回合完整发送包会覆盖到固定世界书条目',
        },
      ],
    });

    let turnContextBinding: TurnContextWorldbookBinding;
    try {
      turnContextBinding = await writeTurnContextWorldbookEntry(callbacks.turnContextWorldbookBinding, {
        turnId,
        playerAction: visibleUserAction || prompt,
        fullPrompt: promptForInject,
      });
    } catch (error) {
      console.warn('[primordia] 本回合发送包世界书写入失败:', error);
      throw new Error('本回合发送包条目未绑定或写入失败，已停止生成。');
    }
    callbacks.onTurnContextWorldbookWritten?.(turnContextBinding);

    const nativeTurn = await runNativeNarrativeTurn(visibleUserAction || prompt, {
      createUserMessage: shouldCreateUserMessage,
      forceGenerateStreaming: callbacks.enableStreamingMaintext === true,
      userMessageData: wrapPrimordiaMvuData(userMessageData),
      userMessageExtra: {
        primordia: {
          turnId,
          type: 'player_action',
          savedAt: Date.now(),
        },
      },
      onStreamingText: text => {
        if (callbacks.enableStreamingMaintext === false) return;
        const maintext = extractStreamingMaintext(text);
        if (!maintext) return;
        callbacks.onStreamingMaintext?.(maintext);
        emitStoryStreaming(maintext);
      },
    });
    const generatedText = nativeTurn.assistantMessage.message?.trim() || nativeTurn.streamedText.trim();
    if (!generatedText) {
      const nativeSummary = summarizeNativeAssistantTurn(nativeTurn);
      rememberPromptDebug({
        id: debugId,
        createdAt: new Date().toLocaleString(),
        status: 'error',
        userInput: visibleUserAction || prompt,
        baseDataSummary: summarizeBaseData(baseData),
        injects: [
          ...injects,
          {
            role: 'assistant',
            content: JSON.stringify(nativeSummary, null, 2),
            position: 'debug',
            depth: 0,
            preview_note: 'ST 原生生成结束了，但 assistant.message 和流式文本都是空的。',
          },
        ],
        generatedText: JSON.stringify(nativeSummary, null, 2),
        error: '生成结果不是文本。',
      });
      throw new Error(
        `生成结果不是文本。assistant楼层 #${nativeSummary.assistantMessageId ?? '未知'}，message类型 ${nativeSummary.messageType}，流式长度 ${nativeSummary.streamedTextLength}。`,
      );
    }
    const userMessageId = nativeTurn.userMessageId;
    const assistantId = nativeTurn.assistantMessage.message_id;

    const { message, mvuMessage, latest } = normalizeAssistantMessage(generatedText);
    const hasScenePatch = messageHasScenePatch(mvuMessage);
    const hasTimePatch = messageHasTimePatch(mvuMessage);
    const hasTavernPatch = messageHasTopLevelPatch(mvuMessage, '酒馆');
    const hasRelationshipPatch = messageHasTopLevelPatch(mvuMessage, '人物羁绊');
    const hasFarmBrewPatch = messageHasTopLevelPatch(mvuMessage, '农田与酒窖');
    const hasStreetShopPatch = messageHasTopLevelPatch(mvuMessage, '街坊商铺');
    const hasProtagonistPatch = messageHasTopLevelPatch(mvuMessage, '主角');
    const parsedFinalData = guardGeneratedCoreStats(await parseMvuData(mvuMessage, userMessageData), userMessageData, mvuMessage);
    const shouldPreserveNarrativeScene = callbacks.preserveNarrativeScene === true || hasScenePatch;
    const generatedInventoryChanged =
      callbacks.allowGeneratedInventory === true &&
      (!sameJsonValue(userMessageData?.库房, parsedFinalData?.库房) ||
        !sameJsonValue(userMessageData?.行囊, parsedFinalData?.行囊));
    const generatedFarmBrewChanged =
      callbacks.allowGeneratedInventory === true &&
      (!sameJsonValue(userMessageData?.农田与酒窖, parsedFinalData?.农田与酒窖) ||
        !sameJsonValue(userMessageData?.农田, parsedFinalData?.农田) ||
        !sameJsonValue(userMessageData?.酒窖桶, parsedFinalData?.酒窖桶));
    const generatedProtagonistStatsChanged =
      callbacks.allowGeneratedStats === true &&
      (!sameJsonValue(userMessageData?.主角?.精力, parsedFinalData?.主角?.精力) ||
        !sameJsonValue(userMessageData?.主角?.生命, parsedFinalData?.主角?.生命) ||
        !sameJsonValue(userMessageData?.主角?.hp, parsedFinalData?.主角?.hp));
    const finalData = callbacks.authoritativeData
      ? mergeAuthoritativeData(parsedFinalData, callbacks.authoritativeData, {
          preserveNarrativeScene: shouldPreserveNarrativeScene,
          preserveNarrativeTime: hasTimePatch,
          preserveNarrativeTavern: hasTavernPatch,
          preserveNarrativeRelationships: hasRelationshipPatch,
          preserveNarrativeFarmBrew: hasFarmBrewPatch,
          preserveNarrativeStreetShop: hasStreetShopPatch,
          preserveNarrativeProtagonist: hasProtagonistPatch,
          keepGeneratedInventory: generatedInventoryChanged,
          keepGeneratedFarmBrew: generatedFarmBrewChanged,
          keepGeneratedProtagonistStats: generatedProtagonistStatsChanged,
        })
      : parsedFinalData;

    rememberPromptDebug({
      id: debugId,
      createdAt: new Date().toLocaleString(),
      status: 'ok',
      userInput: visibleUserAction || prompt,
      baseDataSummary: summarizeBaseData(baseData),
      injects: [
        ...injects,
        {
          role: 'user',
          content: promptForInject,
          position: 'worldbook',
          depth: 0,
          entry_name: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
          preview_note: '本回合完整发送包已覆盖到固定世界书条目',
        },
      ],
      generatedText,
      normalizedMessage: message,
    });

    await setChatMessages(
      [
        {
          message_id: assistantId,
          data: wrapPrimordiaMvuData(finalData),
          extra: {
            ...(nativeTurn.assistantMessage.extra ?? {}),
            primordia: {
              turnId,
              type: 'ai_narration',
              userMessageId,
              savedAt: Date.now(),
            },
          },
        },
      ],
      { refresh: 'none' },
    );

    latest.messageId = assistantId;
    if (typeof userMessageId === 'number') latest.userMessageId = userMessageId;

    await writeMessageStatData(finalData, assistantId);

    emitStoryUpdated(latest);
    return {
      ok: true,
      latest,
      mvuData: finalData,
      hasScenePatch,
      hasVariablePatch: messageHasVariablePatch(mvuMessage),
    };
  } catch (error) {
    rememberPromptDebug({
      id: `prompt-error-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toLocaleString(),
      status: 'error',
      userInput: prompt,
      baseDataSummary: 'Request failed before the debug snapshot was finalized.',
      injects: [],
      error: error instanceof Error ? error.message : '生成失败。',
    });
    return { ok: false, error: error instanceof Error ? error.message : '生成失败。' };
  } finally {
    uninjectScanPrompts?.();
  }
}
