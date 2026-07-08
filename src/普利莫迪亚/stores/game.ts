/**
 * 普利莫迪亚编年录主状态。
 * 前端负责读取酒馆变量、保存本局状态、结算硬规则，并把权威局势交给 AI 叙述。
 */
import { defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { mapNodeDetails } from '../data/mapDetails';
import { mapTrafficRoutes } from '../data/mapTraffic';
import { tavernNpcRegionAliases } from '../data/npcActivities';
import {
  DEFAULT_PRIMORDIA_THEME,
  PRIMORDIA_THEME_STORAGE_KEY,
  isPrimordiaThemeId,
  primordiaThemes,
  type PrimordiaThemeId,
} from '../data/themes';
import { inferWeatherIcon } from '../data/weather';
import { rollVisitorSeed, type VisitorSeed } from '../data/visitors';
import routeDistanceTableText from '../../../普利莫迪亚地图相邻路线距离表.md?raw';
import { dispatchByType } from '../engine/dispatcher';
import { inferSceneType, isGenericStreetEntrance, isShopLikePlace, normalizeScenePlaceName, type SceneType } from '../engine/location';
import { getAdvancedGameMinutes } from '../engine/time';
import { normalizeChatSaveMeta, PRIMORDIA_CHAT_SAVE_KEY, PRIMORDIA_CHAT_SAVE_VERSION } from '../services/save';
import {
  formatOpeningAssistantMessage,
  writeOpeningWorldbook,
  type OpeningGenerationBundle,
  type OpeningWorkshopDraft,
  type OpeningWorldbookResult,
  availableOpeningWorldbooks,
  defaultOpeningWorldbookName,
  generateAndWriteOpeningTemplates,
  generateOpeningCharacterProfile,
  generateOpeningStory,
  generateOpeningStoryWithInitvar,
  generateOpeningTavernProfile,
  inspectOpeningTemplates,
  resetOpeningProfileEntries,
  saveOpeningTemplateContent,
  writeOpeningProfileEntry,
  type OpeningGeneratedProfile,
  type OpeningStoryDraft,
} from '../services/openingWorkshop';
import {
  applyCharacterBehaviorUpdatesToLibrary,
  characterBehaviorEntryName,
  createEmptyCharacterBehaviorLibrary,
  ensureCharacterBehaviorWorldbookEntry,
  isCharacterBehaviorEntryName,
  loadCharacterBehaviorLibraryFromEntry,
  saveCharacterBehaviorLibraryToEntry,
  type CharacterBehaviorItem,
  type CharacterBehaviorLibrary,
} from '../services/characterBehaviorWorldbook';
import {
  ensureNpcActivityWorldbookBinding,
  loadNpcActivityLibraryFromBoundWorldbookEntries,
  loadNpcActivityLibraryFromActiveWorldbooks,
  npcActivityWorldbookTemplate,
  type NpcActivityWorldbookLibrary,
} from '../services/npcActivityWorldbook';
import {
  normalizeMessageVariableOption,
  readPrimordiaStatDataFromOptions,
  writePrimordiaStatData,
} from '../services/mvuDataBridge';
import {
  ensureWeatherWorldbookBinding,
  fullWeatherWorldbookTemplate,
  loadWeatherLibraryFromActiveWorldbooks,
  loadWeatherLibraryFromBoundWorldbookEntries,
  monthWeatherWorldbookTemplate,
  weatherWorldbookFormatTemplate,
  type WeatherWorldbookLibrary,
} from '../services/weatherWorldbook';
import type { WorldbookEntryRef } from '../services/worldbookService';
import {
  TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
  ensureTurnContextWorldbookBinding,
  validateTurnContextWorldbookBinding,
  type TurnContextWorldbookBinding,
} from '../services/turnContextWorldbook';
import { readChatVariable, writeChatVariable } from '../services/variables';
import type { ActionResultBase, LocationSnapshot } from '../types/domain';
import { legacyPathAliases } from '../utils/legacyMojibake';
import { parseNarrativeMvuMessage, previewUnifiedNarrativeRequest, runUnifiedNarrativeRequest } from '../utils/unifiedRequest';
import {
  findNearestShopBefore,
  loadAssistantStoryIndex,
  loadLatestAssistantMaintext,
  type GuestUpdateStatus,
  type ParsedCraftResult,
  type ParsedCharacterBehaviorUpdate,
  type ParsedGuestUpdate,
  type ParsedPromiseUpdate,
  type ParsedShop,
  type StoryIndexItem,
} from '../utils/messageParser';

/* ---------- 常量与类型 ---------- */
export const COIN_PER_SILVER = 100;
export const SILVER_PER_GOLD = 10;
export const GOLD_PER_PLATINUM = 500;
export const PLATINUM_PER_MITHRIL = 500;

export interface CurrencyParts {
  mithril: number;
  platinum: number;
  gold: number;
  silver: number;
  copper: number;
}

export function copperToParts(copper: number): CurrencyParts {
  let c = Math.max(0, Math.floor(copper));
  const silver = Math.floor(c / COIN_PER_SILVER);
  c -= silver * COIN_PER_SILVER;
  let s = silver;
  const gold = Math.floor(s / SILVER_PER_GOLD);
  s -= gold * SILVER_PER_GOLD;
  let g = gold;
  const platinum = Math.floor(g / GOLD_PER_PLATINUM);
  g -= platinum * GOLD_PER_PLATINUM;
  let p = platinum;
  const mithril = Math.floor(p / PLATINUM_PER_MITHRIL);
  p -= mithril * PLATINUM_PER_MITHRIL;
  return { mithril, platinum: p, gold: g, silver: s, copper: c };
}

export function formatCopper(copper: number): string {
  const p = copperToParts(copper);
  const segs: string[] = [];
  if (p.mithril) segs.push(`${p.mithril}秘银`);
  if (p.platinum) segs.push(`${p.platinum}铂金`);
  if (p.gold) segs.push(`${p.gold}金`);
  if (p.silver) segs.push(`${p.silver}银`);
  if (p.copper || segs.length === 0) segs.push(`${p.copper}铜`);
  return segs.join(' ');
}

export interface RegionFacility {
  id: string;
  name: string;
  level?: number;
  style: string;
  condition: '崭新' | '整洁' | '良好' | '忙乱' | '肮脏' | '破损' | '停用' | '升级中';
  description: string;
  priceCopper?: number;
}

export interface TavernRoom {
  id: string;
  name: string;
  type: string;
  priceCopper: number;
  comfort: number;
  privacy: number;
  cleanliness: number;
  guest?: string | null;
  facilities: RegionFacility[];
}

export interface TavernRegion {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  level: number;
  style: string;
  condition: RegionFacility['condition'];
  description: string;
  staff?: string;
  facilities: RegionFacility[];
  rooms?: TavernRoom[];
}

export interface InventoryItem {
  id: string;
  name: string;
  category: '食材' | '调料' | '成品' | '杂物' | '酒水';
  qty: number;
  tags: string[];
  quality?: '灾难级' | '严重冲突' | '轻微冲突' | '无冲突' | '经典搭配' | '绝佳搭配' | '奇迹';
  desc?: string;
  priceCopper?: number;
  recipeSource?: RecipeSource;
}

export type InventorySource = 'satchel' | 'storage';
export type MoneyAccount = 'wallet' | 'cashbox';

export interface TemporaryState {
  名称: string;
  剩余回合: number;
  描述: string;
  来源物品?: string;
}

export interface TemporaryStateTree {
  主角: TemporaryState[];
  酒馆: TemporaryState[];
  酒馆区域: Record<string, TemporaryState[]>;
  人物: Record<string, TemporaryState[]>;
}

export interface TemporaryStateDisplay extends TemporaryState {
  targetType: '主角' | '酒馆' | '酒馆区域' | '人物';
  targetName: string;
}

export type PromiseMemoStatus = 'pending' | 'triggered' | 'cancelled' | 'resolved';

export interface PromiseMemo {
  id: string;
  name: string;
  triggerTime: string;
  people: string[];
  event: string;
  reminder: string;
  status: PromiseMemoStatus;
  createdAtTurn: number;
  triggeredAtTurn?: number;
}

export type CraftMode = 'cooking' | 'sauce' | 'drink';

export interface RecipeIngredient {
  name: string;
  category: InventoryItem['category'];
  qty: number;
  tags: string[];
  priceCopper?: number;
}

export interface RecipeSource {
  mode: CraftMode;
  technique: string;
  ingredients: RecipeIngredient[];
}

export interface RecipeEntry extends RecipeSource {
  id: string;
  name: string;
  outputName: string;
  outputCategory: InventoryItem['category'];
  outputTags: string[];
  outputQuality?: InventoryItem['quality'];
  outputPriceCopper?: number;
  yieldQty: number;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

export interface CharacterCg {
  id: string;
  title: string;
  url?: string;
  unlocked: boolean;
  rating?: 'sfw' | 'nsfw';
  note?: string;
}

export interface TavernNpcActivity {
  heroineId: string;
  heroineName: string;
  fromRegion: string;
  toRegion: string;
  behavior: string;
  behaviors: string[];
  updatedAt: number;
  createdTurn?: number;
  expiresTurn?: number;
  source?: 'auto' | 'manual_assign';
}

interface TavernNpcActivityPlan {
  entries: TavernNpcActivity[];
  serialMinute: number;
}

const NPC_ACTIVITY_MIN_MINUTES = 90;
const NPC_ACTIVITY_MIN_SUCCESS_TURNS = 2;
const DEFAULT_NPC_ACTIVITY_KEEP_TURNS = 3;

export interface Heroine {
  id: string;
  name: string;
  race: string;
  title: string;
  stage: number;
  stageName: string;
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
  bladder: number;
  bladderMax: number;
  affection: number;
  affectionMax: number;
  isMain: boolean;
  mood: string;
  located: string;
  outfit: string;
  gift?: string;
  portraitColor: string;
  bio: string;
  cgSlots?: CharacterCg[];
}

export interface Protagonist {
  name: string;
  race: string;
  title: string;
  cookingLevel: number;
  cookingExp: number;
  cookingExpMax: number;
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
  mood: string;
  located: string;
  outfit: string;
  bio: string;
}

export interface MapNode {
  id: string;
  name: string;
  region: string;
  x: number;
  y: number;
  type: '都市' | '城市' | '城镇' | '村落' | '村庄' | '关隘' | '秘境' | '深界入口' | '特殊地点';
  desc: string;
  faction?: string;
  mainTag?: string;
  subTags?: string[];
  terrain?: string;
  specialTerrain?: string;
  neighbors: string[];
}

export interface ShopProduct {
  id: string;
  name: string;
  shop: string;
  category: string;
  priceCopper: number;
  stock: number;
  tags: string[];
  desc?: string;
}

export interface StreetShop {
  id: string;
  name: string;
  kind: '食材' | '调料' | '成品' | '酒水' | '杂物' | '服务' | '情报';
  keeper: string;
  greeting: string;
  atmosphere: string;
  tags: string[];
}

export interface FarmPlot {
  id: string;
  crop: string;
  stage: number;
  stageMax: number;
  season: string;
  expectedHarvest: string;
  batchTags?: string[];
  plantedDay?: number;
  matureDay?: number;
  readyNotified?: boolean;
}

export interface BrewBarrel {
  id: string;
  name: string;
  startedDay: number;
  matureDay: number;
  expected: string;
  filling: string;
  brewType?: string;
  readyNotified?: boolean;
}

export type TabId =
  | 'opening'
  | 'chronicle'
  | 'tavern'
  | 'protagonist'
  | 'inventory'
  | 'recipes'
  | 'characters'
  | 'gallery'
  | 'map'
  | 'shop'
  | 'ledger'
  | 'farm'
  | 'variables'
  | 'settings';

export interface CharacterWorldbookBinding {
  id: string;
  worldbookName: string;
  uid: number;
  label?: string;
  boundAt: number;
  updatedAt?: number;
}

export interface EngineLog {
  id: string;
  at: string;
  kind: '结算' | '扣减' | '奖励' | '叙事' | '提示' | '系统';
  text: string;
  source?: 'player' | 'engine' | 'ai' | 'system';
  authoritative?: boolean;
  tone?: 'green' | 'amber' | 'red' | 'cyan' | 'violet' | 'neutral';
  actionType?: string;
  payload?: Record<string, unknown>;
}

export type DraftUndoPatch =
  | {
      type: 'WORKER_ASSIGN';
      heroineId: string;
      previousLocated: string;
      targetRegionId: string;
      previousTargetStaff?: string;
      previousRegionId?: string;
      previousRegionStaff?: string;
    }
  | {
      type: 'REGION_CLEAN';
      regionId: string;
      previousCondition: RegionFacility['condition'];
    }
  | {
      type: 'LOCAL_SETTLEMENT';
      snapshot: LocalSettlementSnapshot;
      reason: string;
      actionType?: string;
    };

export interface DraftAction {
  id: string;
  text: string;
  type?: GameAction['type'] | 'CUSTOM_ACTION' | 'TEXT';
  undoPatch?: DraftUndoPatch;
}

export interface GuestGroup {
  id: string;
  label: string;
  guests: string;
  status: GuestUpdateStatus;
  order: string;
  note: string;
  createdAtTurn: number;
  updatedAtTurn: number;
}

export type StoryActionType =
  | 'CUSTOM_ACTION'
  | 'FIND_SHOP'
  | 'VISIT_SHOP'
  | 'LEAVE_SHOP'
  | 'BUY_ITEMS'
  | 'INVENTORY_MOVE_TO_STORAGE'
  | 'INVENTORY_MOVE_TO_SATCHEL'
  | 'MONEY_TRANSFER'
  | 'USE_ITEM'
  | 'COOK_DISH'
  | 'SERVE_DISH';

export interface StoryActionInput {
  type: StoryActionType;
  title: string;
  fact: string;
  settledFact?: string;
  aiHint: string;
  timeChange?: ActionResult['timeChange'];
  logText?: string;
  autoSend?: boolean;
  preserveLocalState?: boolean;
  settled?: boolean;
  undoPatch?: DraftUndoPatch;
}

export interface PseudoZeroNarrativeOptions {
  type?: StoryActionType;
  title: string;
  aiHint?: string;
  logText?: string;
  autoSend?: boolean;
  preserveLocalState?: boolean;
  settled?: boolean;
}

export interface BuyActionItem {
  id: string;
  name: string;
  category: string;
  priceCopper: number;
  stock: number;
  qty: number;
  tags?: string[];
  desc?: string;
}

export interface CraftActionItem {
  id: string;
  name: string;
  category: InventoryItem['category'];
  qty: number;
  tags?: string[];
  priceCopper?: number;
}

export type GameAction =
  | {
      type: 'FIND_SHOP';
      target: string;
      origin: string;
      streetEntrance: string;
    }
  | {
      type: 'VISIT_SHOP';
      shopName: string;
      keeper?: string;
      origin: string;
      products: Array<Pick<BuyActionItem, 'name' | 'priceCopper' | 'stock'>>;
    }
  | {
      type: 'LEAVE_SHOP';
      shopName: string;
      destination: string;
    }
  | {
      type: 'FARM_PLANT';
      plotId: string;
      seedId: string;
      crop: string;
      expectedHarvest: string;
      currentDay: number;
    }
  | {
      type: 'FARM_EXPAND';
    }
  | {
      type: 'FARM_REMOVE';
      plotId: string;
    }
  | {
      type: 'FARM_HARVEST';
      plotId: string;
      resultName: string;
      quantity: number;
      tags: string[];
      priceCopper?: number;
    }
  | {
      type: 'BREW_TAP';
      barrelId: string;
      bottles: number;
      quality: string;
      priceCopper: number;
    }
  | {
      type: 'FACILITY_ADD';
      regionId: string;
      roomId?: string | null;
      facility: Omit<RegionFacility, 'id'> & { id?: string };
    }
  | {
      type: 'TAVERN_FAST_FORWARD';
      hours: number;
      intensity: '低调' | '正常' | '热闹' | '通宵';
    }
  | {
      type: 'BUSINESS_TOGGLE';
      open: boolean;
    }
  | {
      type: 'REGION_CLEAN';
      regionId: string;
    }
  | {
      type: 'WORKER_ASSIGN';
      heroineId: string;
      regionId: string;
    }
  | {
      type: 'MAP_TRAVEL';
      fromId: string;
      toId: string;
      routeKm: number;
      horseText: string;
      horseDays: number;
      routeType: string;
    }
  | {
      type: 'CHARACTER_CHAT';
      heroineId: string;
      stateLine: string;
    }
  | {
      type: 'CHARACTER_GIFT';
      heroineId: string;
      itemName: string;
      costCopper: number;
      affectionGain: number;
      stateLine: string;
    }
  | {
      type: 'PROTAGONIST_TRAIN_COOKING';
      expGain: number;
    }
  | {
      type: 'CUSTOM_ACTION';
      text: string;
      title?: string;
    }
  | {
      type: 'DEBUG_CURRENCY';
      deltaCopper: number;
      reason: string;
      account?: MoneyAccount;
    }
  | {
      type: 'MONEY_TRANSFER';
      direction: 'wallet_to_cashbox' | 'cashbox_to_wallet';
      amountCopper: number;
    }
  | {
      type: 'DEBUG_STAT';
      stat: 'energy_full' | 'reputation_delta';
      value?: number;
      reason: string;
    }
  | {
      type: 'BUY_ITEMS';
      shopName: string;
      keeper?: string;
      items: BuyActionItem[];
    }
  | {
      type: 'INVENTORY_MOVE_TO_STORAGE';
      itemId: string;
      qty?: number;
    }
  | {
      type: 'INVENTORY_MOVE_TO_SATCHEL';
      itemId: string;
      qty?: number;
    }
  | {
      type: 'USE_ITEM';
      itemId: string;
      source: InventorySource;
      qty?: number;
      target?: string;
      note?: string;
    }
  | {
      type: 'COOK_DISH';
      mode: 'cooking' | 'sauce' | 'drink';
      technique: string;
      items: CraftActionItem[];
    }
  | {
      type: 'SERVE_DISH';
      items: CraftActionItem[];
      guestId?: string;
    }
  | {
      type: 'INVENTORY_MOVE_CATEGORY';
      itemId: string;
      category: InventoryItem['category'];
    };

export interface ActionResult extends ActionResultBase {
  shouldAskAI?: boolean;
  paidCopper?: number;
  summary?: string;
  narrativeFact?: string;
  settledFact?: string;
  aiHint?: string;
  stockDeltas?: Record<string, number>;
  craftId?: string;
  logs?: Array<{ kind: EngineLog['kind']; text: string }>;
}

export interface HealthCheckItem {
  ok: boolean;
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'bad';
}

type PrimordiaStatData = Record<string, any>;

declare const getVariables: undefined | ((options?: Record<string, any>) => any);
declare const getCurrentMessageId: undefined | (() => number);
declare const updateVariablesWith:
  | undefined
  | ((updater: (variables: Record<string, any>) => Record<string, any> | void, options?: Record<string, any>) => Promise<void> | void);
declare const createChatMessages:
  | undefined
  | ((messages: Array<Record<string, any>>, options?: Record<string, any>) => Promise<unknown>);

interface OpeningSaveSnapshot {
  completed: boolean;
  openingMessageId?: number;
  fingerprint?: string;
  worldbookName?: string;
  gameInfoUid?: number;
  turnContextWorldbookBinding?: TurnContextWorldbookBinding;
  moduleResults?: OpeningWorldbookResult['moduleResults'];
  completedAt?: number;
  characterSummary?: string;
  tavernSummary?: string;
  theme?: string;
  era?: string;
  region?: string;
  tavernCity?: string;
  tavernPlace?: string;
}

interface TavernBusinessState {
  isOpen: boolean;
  currentGuests: number;
  guestCap: number;
  visitorChance: number;
  lastVisitorSeed: string;
}

interface TavernBusinessVisitorPlan {
  seed: VisitorSeed | null;
  nextGuests: number;
  shouldInject: boolean;
  reason: 'closed' | 'full' | 'hit' | 'miss';
}

interface PrimordiaSaveBody {
  schemaVersion: number;
  savedAt: number;
  lastTickAt?: number;
  lastShopRefreshDay?: number;
  lastMessageId?: number;
  currentMessageId?: number;
  messageSignature?: string;
  branchBaseMessageId?: number | null;
  calendar: CalendarSnapshot;
  location: { region: string; place: string; protagonistLocated: string; sceneType?: SceneType; relatedName?: string };
  tavernName: string;
  treasuryCopper: number;
  walletCopper?: number;
  cashboxCopper?: number;
  reputation: number;
  energy: { value: number; max: number };
  protagonist: Protagonist;
  business?: TavernBusinessState;
  guestGroups?: GuestGroup[];
  heroines?: Heroine[];
  tavernNpcActivities?: TavernNpcActivity[];
  lastNpcActivityMinute?: number;
  lastNpcActivityTurn?: number;
  successfulNarrationTurn?: number;
  npcActivityKeepTurns?: number;
  npcActivityEnabled?: boolean;
  npcActivityWorldbookLibrary?: NpcActivityWorldbookLibrary | null;
  npcActivityWorldbookBindings?: WorldbookEntryRef[];
  weatherWorldbookLibrary?: WeatherWorldbookLibrary | null;
  weatherWorldbookBindings?: WorldbookEntryRef[];
  weatherWorldbookStatus?: string;
  weatherWorldbookErrors?: string[];
  turnContextWorldbookBinding?: TurnContextWorldbookBinding | null;
  turnContextWorldbookStatus?: string;
  characterWorldbookBindings?: Record<string, CharacterWorldbookBinding[]>;
  characterBehaviorLibraries?: Record<string, CharacterBehaviorLibrary>;
  inventory: InventoryItem[];
  satchel?: InventoryItem[];
  temporaryStates?: TemporaryStateTree;
  promiseMemos?: PromiseMemo[];
  recipes?: RecipeEntry[];
  engineLogs: EngineLog[];
  generatedShop: StreetShop | null;
  generatedShopProducts: ShopProduct[];
  draftActions?: DraftAction[];
  farmPlots?: FarmPlot[];
  brews?: BrewBarrel[];
  latestStory?: Pick<LatestMaintextPayload, 'maintext' | 'options' | 'sum' | 'messageId' | 'userMessageId'>;
  systemJudgement?: SystemJudgementSnapshot;
  opening?: OpeningSaveSnapshot;
}

interface PrimordiaChatSaveSnapshot extends PrimordiaSaveBody {
  floorSnapshots?: Record<string, PrimordiaSaveBody>;
}

interface LocalSettlementSnapshot {
  calendar: CalendarSnapshot;
  location: { region: string; place: string; protagonistLocated: string; sceneType?: SceneType; relatedName?: string };
  tavernName: string;
  treasuryCopper: number;
  walletCopper: number;
  cashboxCopper: number;
  reputation: number;
  energy: { value: number; max: number };
  protagonist: Protagonist;
  business: TavernBusinessState;
  guestGroups: GuestGroup[];
  regions: TavernRegion[];
  heroines: Heroine[];
  tavernNpcActivities: TavernNpcActivity[];
  lastNpcActivityMinute: number;
  lastNpcActivityTurn: number;
  successfulNarrationTurn: number;
  npcActivityKeepTurns: number;
  npcActivityEnabled: boolean;
  npcActivityWorldbookLibrary: NpcActivityWorldbookLibrary | null;
  npcActivityWorldbookBindings: WorldbookEntryRef[];
  weatherWorldbookLibrary: WeatherWorldbookLibrary | null;
  weatherWorldbookBindings: WorldbookEntryRef[];
  weatherWorldbookStatus: string;
  weatherWorldbookErrors: string[];
  turnContextWorldbookBinding: TurnContextWorldbookBinding | null;
  turnContextWorldbookStatus: string;
  characterWorldbookBindings: Record<string, CharacterWorldbookBinding[]>;
  characterBehaviorLibraries: Record<string, CharacterBehaviorLibrary>;
  inventory: InventoryItem[];
  satchel: InventoryItem[];
  temporaryStates: TemporaryStateTree;
  promiseMemos: PromiseMemo[];
  recipes: RecipeEntry[];
  generatedShop: StreetShop | null;
  generatedShopProducts: ShopProduct[];
  farmPlots: FarmPlot[];
  brews: BrewBarrel[];
  pendingCraftSources: Array<{ craftId: string; source: RecipeSource; createdAt: number }>;
  lastShopRefreshDay: number;
  currentTab: TabId;
}

interface CalendarSnapshot {
  year: number;
  monthIndex: number;
  day: number;
  timeOfDay: string;
  clock: string;
  weather: string;
  weatherIcon: 'sun' | 'cloud' | 'rain' | 'snow' | 'moon';
  weatherDescription?: string;
  weatherDaySerial?: number;
}

function clonePlain<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function readPath<T = any>(source: any, path: string, fallback?: T): T {
  const value = path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
  return (value ?? fallback) as T;
}

function readFirstPath<T = any>(source: any, paths: string[], fallback?: T): T {
  for (const path of paths) {
    const value = readPath<T | undefined>(source, path, undefined);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value as T;
  }
  return fallback as T;
}

function readRecordPath(source: any, paths: string[]) {
  const value = readFirstPath<any>(source, paths, undefined);
  return asRecord(value);
}

function readNumberPath(source: any, paths: string[], fallback?: number): number | undefined {
  const value = readFirstPath<any>(source, paths, undefined);
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') return fallback;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugId(input: string, fallback: string) {
  const normalized = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function asRecord(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeCondition(value: string | undefined): RegionFacility['condition'] {
  const text = String(value ?? '').trim();
  const allowed: RegionFacility['condition'][] = ['崭新', '整洁', '良好', '忙乱', '肮脏', '破损', '停用', '升级中'];
  if (allowed.includes(text as RegionFacility['condition'])) return text as RegionFacility['condition'];
  if (/一尘不染|洁净|干净|清洁|清爽|收拾妥当|刚打扫|打扫完|明亮/.test(text)) return '整洁';
  if (/全新|新修|刚建|刚装|焕然一新|完美/.test(text)) return '崭新';
  if (/良好|正常|尚可|可用|稳定|平稳/.test(text)) return '良好';
  if (/忙乱|杂乱|凌乱|拥挤|混乱|狼藉|略乱|待整理/.test(text)) return '忙乱';
  if (/肮脏|脏|油污|污渍|灰尘|污泥|发臭|恶臭|霉/.test(text)) return '肮脏';
  if (/破损|损坏|裂|漏水|坏|松动|磨损|需要修缮|待修|修理/.test(text)) return '破损';
  if (/停用|不可用|关闭|封闭|瘫痪/.test(text)) return '停用';
  if (/升级|施工|改建|扩建|翻修/.test(text)) return '升级中';
  return '良好';
}

function normalizeLooseName(value: string | undefined) {
  return String(value ?? '')
    .trim()
    .replace(/[·・•\s\u3000_\-—路]/g, '')
    .replace(/区域|区|房间|房|门面|接待|餐食|储藏|生活|交通/g, '');
}

function findTavernRegionByMvuName(regionList: TavernRegion[], rawName: string) {
  const key = normalizeLooseName(rawName);
  if (!key) return undefined;
  const aliases: Record<string, string[]> = {
    'front-door': ['前门', '门口', '门廊', '门面', '招牌', '入口'],
    'main-hall': ['主厅', '大厅', '前厅', '接待', '壁炉', '长桌'],
    bar: ['柜台', '吧台', '酒水', '收银', '账台'],
    kitchen: ['厨房', '后厨', '灶房', '灶台', '备餐', '餐食'],
    rooms: ['客房', '房间', '住宿', '住客'],
    cellar: ['地窖', '酒窖', '储藏', '储物', '地下室'],
    yard: ['后院', '院子', '菜地', '井边', '杂务'],
    stable: ['马厩', '车棚', '装卸', '牲口', '货车'],
  };
  const exact = regionList.find(region => {
    const idKey = normalizeLooseName(region.id);
    const nameKey = normalizeLooseName(region.name);
    return key === idKey || key === nameKey;
  });
  if (exact) return exact;
  return regionList.find(region => (aliases[region.id] ?? []).some(alias => key === normalizeLooseName(alias)));
}

function tavernRegionIconFromName(name: string) {
  if (/厨房|灶|炉|餐|食|烹/.test(name)) return 'fire';
  if (/柜台|酒|账|钱|吧台/.test(name)) return 'coin';
  if (/客房|卧|睡|宿|床/.test(name)) return 'moon';
  if (/后院|菜|田|棚|柴|井|园/.test(name)) return 'farm';
  if (/马|车|厩|路|门|入口/.test(name)) return 'pin';
  if (/地窖|储藏|仓|库/.test(name)) return 'pot';
  return 'candle';
}

function createTavernRegionFromMvuRecord(regionName: string, record: Record<string, any>, fallbackIndex: number): TavernRegion {
  const name = regionName.trim() || `新空间${fallbackIndex + 1}`;
  return {
    id: slugId(name, `region-${fallbackIndex + 1}`),
    name,
    subtitle: String(readFirstPath(record, ['副标题', '类型', '功能', 'subtitle'], '故事中形成的空间') || '故事中形成的空间'),
    icon: String(readFirstPath(record, ['图标', 'icon'], tavernRegionIconFromName(name)) || tavernRegionIconFromName(name)),
    level: Math.max(1, Math.floor(readNumberPath(record, ['等级', 'level'], 1) ?? 1)),
    style: String(readFirstPath(record, ['风格', 'style'], '待整理') || '待整理'),
    condition: normalizeCondition(String(readFirstPath(record, ['状态', 'condition'], '良好') || '良好')),
    description: String(readFirstPath(record, ['描述', 'description'], `${name}是剧情中逐渐形成的酒馆空间。`) || `${name}是剧情中逐渐形成的酒馆空间。`),
    staff: String(readFirstPath(record, ['分配员工', 'staff'], '') ?? '').trim() || undefined,
    facilities: [],
  };
}

function ensureTavernRegionFromMvuName(regionList: TavernRegion[], regionName: string, record: Record<string, any>) {
  const existing = findTavernRegionByMvuName(regionList, regionName);
  if (existing) return existing;
  const region = createTavernRegionFromMvuRecord(regionName, record, regionList.length);
  regionList.push(region);
  return region;
}

function normalizeInventoryCategory(value: string): InventoryItem['category'] {
  if (['食材', '调料', '成品', '杂物', '酒水'].includes(value)) return value as InventoryItem['category'];
  return '杂物';
}

function normalizeShopKind(value: string): StreetShop['kind'] {
  if (['食材', '调料', '成品', '酒水', '杂物', '服务', '情报'].includes(value)) return value as StreetShop['kind'];
  return '杂物';
}

function parseCopperText(raw: unknown, fallback = 0) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  if (raw && typeof raw === 'object') return fallback;
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  const mithril = text.match(/(\d+)\s*秘银/);
  const platinum = text.match(/(\d+)\s*铂金/);
  const gold = text.match(/(\d+)\s*金/);
  const silver = text.match(/(\d+)\s*银/);
  const copper = text.match(/(\d+)\s*铜/);
  const total =
    (mithril ? Number(mithril[1]) * 1_000_000 : 0) +
    (platinum ? Number(platinum[1]) * 10_000 : 0) +
    (gold ? Number(gold[1]) * 1_000 : 0) +
    (silver ? Number(silver[1]) * 100 : 0) +
    (copper ? Number(copper[1]) : 0);
  return total > 0 ? total : fallback;
}

function readLooseNumber(record: Record<string, any>, keys: string[], fallback = 0): number {
  return readNumberPath(record, keys, fallback) ?? fallback;
}

function readCopperValue(record: Record<string, any>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = readPath(record, key, undefined);
    if (value === undefined || value === null) continue;
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? parseCopperText(value, Number.NaN)
          : Number.NaN;
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return fallback;
}

function normalizeQuality(value: string | undefined): InventoryItem['quality'] {
  const allowed: NonNullable<InventoryItem['quality']>[] = [
    '灾难级',
    '严重冲突',
    '轻微冲突',
    '无冲突',
    '经典搭配',
    '绝佳搭配',
    '奇迹',
  ];
  return allowed.includes(value as NonNullable<InventoryItem['quality']>) ? (value as InventoryItem['quality']) : undefined;
}

function normalizeItemQualityLabel(value: string | undefined): InventoryItem['quality'] {
  return normalizeQuality(value);
}

function normalizeMapType(value: string | undefined): MapNode['type'] {
  const text = String(value ?? '').trim();
  const allowed: MapNode['type'][] = ['都市', '城市', '城镇', '村落', '村庄', '关隘', '秘境', '深界入口', '特殊地点'];
  return allowed.includes(text as MapNode['type']) ? (text as MapNode['type']) : '城镇';
}

const MAP_COORD_OVERRIDES: Record<string, [number, number]> = {
  纳维里斯: [0, 0],
  克朗港: [-4125, 1050],
  白崖城: [-4625, -650],
  绿谷: [-3450, 450],
  铁炉镇: [-3600, 1050],
  盐脊堡: [-3850, 1700],
  雾港: [-4750, -1650],
  风磨丘: [-3650, -1250],
  杉影镇: [-3150, 1500],
  布拉姆维克: [-3350, -1075],
  费尔马克: [-3050, -900],
  王冠堡: [-400, 2325],
  铁砧渡: [-1300, 1625],
  麦穗原: [300, 1900],
  白石修道院: [-825, 3200],
  忠风城: [3950, 2450],
  翡叶城: [-300, -6200],
  金曦城: [-4200, -2950],
  灶安城: [1550, -450],
};

const LEGACY_MAP_ID_ALIASES: Record<string, string> = {
  naviris: '纳维里斯',
  bramvic: '布拉姆维克',
  fairmark: '费尔马克',
};

const MAP_FACTION_CENTERS: Record<string, [number, number]> = {
  '韦斯托利亚（人类）': [-3700, -250],
  '卡尔德里亚（人类）': [-450, 2100],
  '阿尔登马克（人类）': [2300, 1850],
  '矮人（杜尔加德联山国）': [-1350, 4300],
  '暗精灵（多卡海姆）': [-1500, 3300],
  '兽族联邦·犬邦（鸣原）': [3900, 2400],
  '兽族联邦·狼邦（嗥原）': [4700, 3300],
  '兽族联邦·狐邦（萩岭）': [4550, 1450],
  '兽族联邦·猫邦（霞丘）': [5200, 950],
  '兽族联邦·薮猫邦（影丘）': [5050, 50],
  '兽族联邦·狸猫邦（迷原）': [4300, -850],
  '兽族联邦·鸟邦（翠峰）': [3400, 3600],
  '兽族联邦·熊猫邦（翠屏）': [3300, 950],
  '兽族联邦·兔邦（露泽）': [3350, -550],
  '兽族联邦·鹿邦（幽泽）': [2500, -1100],
  '兽族联邦·羊邦（牧坡）': [2700, 800],
  '兽族联邦·牛邦（原泽）': [2550, -250],
  '兽族联邦·狮邦（烈原）': [4250, -1850],
  '兽族联邦·鳄邦（沼泽三角洲）': [3300, -2100],
  '兽族联邦·蜥蜴邦（石鳞地）': [5000, -2600],
  '精灵（翡叶永森）': [-350, -5850],
  '龙裔（阿什卡纳尔）': [-3800, -3300],
  '拉弥亚（奥菲迪亚）': [-1450, -3300],
  '那伽（帕塔拉）': [-350, -4150],
  '半人马（阿斯特拉原野）': [1600, -2400],
  '珑族（灶丘）': [1550, -650],
};

function parseMapRouteEdges(text: string): Array<[string, string]> {
  return text
    .split(/\r?\n/)
    .map(line => line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => [match[1].trim(), match[2].trim()] as [string, string])
    .filter(([from, to]) => from !== '起点' && !from.includes('---') && Boolean(from) && Boolean(to));
}

function buildPrimordiaMapNodes(): MapNode[] {
  const entries = Object.entries(mapNodeDetails);
  const knownNames = new Set(entries.map(([name]) => name));
  const groupIndexes = new Map<string, number>();
  const groupTotals = new Map<string, number>();
  entries.forEach(([, detail]) => {
    const faction = detail.faction ?? '其他';
    groupTotals.set(faction, (groupTotals.get(faction) ?? 0) + 1);
  });

  const nodes = entries.map(([name, detail], index) => {
    const faction = detail.faction ?? '其他';
    const groupIndex = groupIndexes.get(faction) ?? 0;
    groupIndexes.set(faction, groupIndex + 1);
    const [cx, cy] = MAP_FACTION_CENTERS[faction] ?? [
      Math.round(Math.cos(index * 1.9) * 5200),
      Math.round(Math.sin(index * 1.9) * 5200),
    ];
    const total = groupTotals.get(faction) ?? 1;
    const ring = Math.floor(groupIndex / 8);
    const radius = total <= 2 ? 150 : 220 + ring * 190;
    const angle = (Math.PI * 2 * (groupIndex % 8)) / Math.min(8, Math.max(total, 1)) + ring * 0.35;
    const override = MAP_COORD_OVERRIDES[name];
    const x = override ? override[0] : Math.round(cx + Math.cos(angle) * radius);
    const y = override ? override[1] : Math.round(cy + Math.sin(angle) * radius);
    return {
      id: name,
      name,
      region: detail.region ?? detail.faction ?? '普利莫迪亚',
      x,
      y,
      type: normalizeMapType(detail.type),
      desc: detail.desc ?? `${name} 是普利莫迪亚的一处地点。`,
      faction: detail.faction,
      mainTag: detail.mainTag,
      subTags: detail.subTags ?? [],
      terrain: detail.terrain,
      specialTerrain: detail.specialTerrain,
      neighbors: [],
    } satisfies MapNode;
  });

  const adjacency = new Map<string, Set<string>>();
  nodes.forEach(node => adjacency.set(node.id, new Set()));
  const addEdge = (from: string, to: string) => {
    if (!knownNames.has(from) || !knownNames.has(to) || from === to) return;
    adjacency.get(from)?.add(to);
    adjacency.get(to)?.add(from);
  };

  parseMapRouteEdges(routeDistanceTableText).forEach(([from, to]) => addEdge(from, to));
  mapTrafficRoutes.forEach(route => {
    route.nodes.forEach((name, index) => {
      if (index > 0) addEdge(route.nodes[index - 1], name);
    });
  });

  const byFaction = new Map<string, MapNode[]>();
  nodes.forEach(node => {
    const faction = node.faction ?? '其他';
    byFaction.set(faction, [...(byFaction.get(faction) ?? []), node]);
  });
  nodes.forEach(node => {
    const neighbors = adjacency.get(node.id);
    if (!neighbors || neighbors.size > 0) return;
    const nearby = (byFaction.get(node.faction ?? '其他') ?? nodes)
      .filter(item => item.id !== node.id)
      .map(item => ({ item, distance: Math.hypot(item.x - node.x, item.y - node.y) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    nearby.forEach(({ item }) => addEdge(node.id, item.id));
  });

  return nodes.map(node => ({ ...node, neighbors: Array.from(adjacency.get(node.id) ?? []).sort() }));
}

function normalizeMapNodeId(idOrName: string | undefined): string {
  const text = String(idOrName ?? '').trim();
  return LEGACY_MAP_ID_ALIASES[text] ?? text;
}

interface SystemJudgementSnapshot {
  authority: 'frontend-system';
  version: number;
  judgedAt: number;
  scene: LocationSnapshot;
  currentTab: TabId;
  moneyCopper: number;
  walletCopper: number;
  cashboxCopper: number;
  inventoryItemCount: number;
  activeShopName: string;
  activeShopProductCount: number;
  lastActionSummary: string;
  finalRule: string;
}

function readMessageStatData(preferredMessageId?: number): PrimordiaStatData | null {
  try {
    const latestMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
    const currentMessageId = typeof getCurrentMessageId === 'function' ? getCurrentMessageId() : undefined;
    const latestAssistantMessageId =
      preferredMessageId === undefined && typeof getChatMessages === 'function'
        ? getChatMessages(-1, { role: 'assistant' })?.at(-1)?.message_id
        : undefined;
    const messageIds = [
      preferredMessageId,
      typeof latestAssistantMessageId === 'number' ? latestAssistantMessageId : undefined,
      typeof latestMessageId === 'number' ? latestMessageId : undefined,
      typeof currentMessageId === 'number' ? currentMessageId : undefined,
      -1,
    ].filter((value, index, list): value is number => typeof value === 'number' && list.indexOf(value) === index);
    const options: Array<Record<string, any>> = [
      ...messageIds.map(message_id => ({ type: 'message', message_id })),
      { type: 'message' },
    ];
    return readPrimordiaStatDataFromOptions(options) as PrimordiaStatData | null;
  } catch (error) {
    console.warn('[primordia] 读取 MVU 变量失败:', error);
  }
  return null;
}

function readPlainPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function normalizeOpeningFingerprintPart(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function buildOpeningFingerprint(parts: Array<unknown>) {
  return parts.map(normalizeOpeningFingerprintPart).join('|');
}

/* ---------- 常量与类型 ---------- */
type TimeOfDay = '拂晓' | '清晨' | '上午' | '正午' | '午后' | '黄昏' | '入夜' | '深夜';

function timeOfDayFromClock(clock: string): TimeOfDay | undefined {
  const hour = Number(clock.match(/^(\d{1,2})/)?.[1]);
  if (!Number.isFinite(hour)) return undefined;
  const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
  if (normalizedHour < 3) return '深夜';
  if (normalizedHour < 6) return '拂晓';
  if (normalizedHour < 9) return '清晨';
  if (normalizedHour < 12) return '上午';
  if (normalizedHour < 15) return '正午';
  if (normalizedHour < 18) return '午后';
  if (normalizedHour < 21) return '黄昏';
  return '入夜';
}

export const useGameStore = defineStore('primordia', () => {
  const storedTheme = localStorage.getItem(PRIMORDIA_THEME_STORAGE_KEY);
  const themeId = ref<PrimordiaThemeId>(isPrimordiaThemeId(storedTheme) ? storedTheme : DEFAULT_PRIMORDIA_THEME);
  function applyTheme(nextTheme: PrimordiaThemeId) {
    document.documentElement.dataset.pmTheme = nextTheme;
  }
  applyTheme(themeId.value);
  watch(themeId, value => {
    localStorage.setItem(PRIMORDIA_THEME_STORAGE_KEY, value);
    applyTheme(value);
  });

  const sendWeatherToAi = ref(localStorage.getItem('primordia.sendWeatherToAi') !== 'false');
  watch(sendWeatherToAi, value => {
    localStorage.setItem('primordia.sendWeatherToAi', String(value));
  });
  const enableStoryStreaming = ref(localStorage.getItem('primordia.enableStoryStreaming') !== 'false');
  watch(enableStoryStreaming, value => {
    localStorage.setItem('primordia.enableStoryStreaming', String(value));
  });
  const openingRequired = ref(false);
  const openingCompleted = ref(false);
  const openingSave = ref<OpeningSaveSnapshot | null>(null);
  const openingWorkshopForced = ref(false);
  const openingWorkshopEnabled = ref(localStorage.getItem('primordia.openingWorkshopEnabled') === 'true');

  /* HUD: 历法与位置 */
  const calendar = reactive({
    year: 1303,
    monthIndex: 4, // 0~11
    day: 17,
    timeOfDay: '黄昏' as TimeOfDay,
    clock: '18:24',
    weather: '未设天气' as string,
    weatherIcon: 'sun' as 'sun' | 'cloud' | 'rain' | 'snow' | 'moon',
    weatherDescription: '',
    weatherDaySerial: 0,
  });
  const months = [
    '冰封月',
    '残雪月',
    '解冻月',
    '花萌月',
    '绿涨月',
    '长日月',
    '炎阳月',
    '收获月',
    '金叶月',
    '落穗月',
    '霜降月',
    '暗夜月',
  ];
  const seasons = ['隆冬', '冬末', '初春', '仲春', '暮春', '初夏', '盛夏', '暮夏', '初秋', '仲秋', '暮秋', '初冬'];
  const weekDays = ['一日', '二日', '三日', '四日', '市日', '六日', '七日'];
  const seasonText = computed(() => seasons[calendar.monthIndex] ?? '');
  const weekDayIndex = computed(() => Math.max(0, (currentCalendarDay() - 1) % 7));
  const weekDayName = computed(() => weekDays[weekDayIndex.value] ?? '一日');
  const isMarketDay = computed(() => weekDayIndex.value === 4);
  const currentTimeOfDay = computed(() => timeOfDayFromClock(calendar.clock) ?? calendar.timeOfDay);
  const shouldShowOpeningWorkshop = computed(
    () => openingWorkshopForced.value || (openingWorkshopEnabled.value && openingRequired.value && !openingCompleted.value),
  );
  const dateText = computed(() => `共栖历 ${calendar.year} 年 · ${months[calendar.monthIndex]}（${seasonText.value}）第 ${calendar.day} 日 · ${weekDayName.value} · ${currentTimeOfDay.value}`);
  const clockText = computed(() => `约 ${calendar.clock}`);
  const lastTickAt = ref(Date.now());
  const lastShopRefreshDay = ref(calendar.year * 12 * 30 + calendar.monthIndex * 30 + calendar.day);

  function currentCalendarDay() {
    return calendar.year * 12 * 30 + calendar.monthIndex * 30 + calendar.day;
  }

  function currentSerialMinute() {
    return currentCalendarDay() * 24 * 60 + clockToMinutes(calendar.clock);
  }

  function currentMonthName() {
    return months[calendar.monthIndex] ?? '绿涨月';
  }

  function currentWeatherPool() {
    return weatherWorldbookLibrary.value?.months?.[currentMonthName()] ?? [];
  }

  function pickWeatherFromPool(pool: Array<{ name: string; description: string }>, serialDay: number, random = false) {
    if (!pool.length) return undefined;
    if (random) return pool[Math.floor(Math.random() * pool.length)];
    const seed = Math.abs(Math.floor(serialDay * 1103515245 + currentMonthName().length * 12345));
    return pool[seed % pool.length];
  }

  function applyWeatherEntry(entry: { name: string; description: string } | undefined, serialDay = currentCalendarDay()) {
    if (!entry) return false;
    calendar.weather = entry.name;
    calendar.weatherDescription = entry.description;
    calendar.weatherIcon = inferWeatherIcon(`${entry.name} ${entry.description}`);
    calendar.weatherDaySerial = serialDay;
    return true;
  }

  function clearWeatherForDay(serialDay = currentCalendarDay()) {
    calendar.weather = '未设天气';
    calendar.weatherDescription = '';
    calendar.weatherIcon = 'sun';
    calendar.weatherDaySerial = serialDay;
  }

  function ensureWeatherForToday() {
    const today = currentCalendarDay();
    if (!weatherWorldbookLibrary.value) return;
    if (calendar.weatherDaySerial === today && calendar.weather && calendar.weatherDescription && calendar.weather !== '未设天气') return;
    if (!applyWeatherEntry(pickWeatherFromPool(currentWeatherPool(), today), today)) clearWeatherForDay(today);
  }

  function rerollTodayWeather() {
    const ok = applyWeatherEntry(pickWeatherFromPool(currentWeatherPool(), currentCalendarDay(), true), currentCalendarDay());
    if (!ok) {
      pushLog('提示', `没有找到「${currentMonthName()}」的世界书天气池。`, { source: 'engine', authoritative: true, tone: 'amber' });
      return;
    }
    markLocalStateDirty();
    void writeChatSave();
    pushLog('系统', `今日天气已重骰为「${calendar.weather}」。`, { source: 'engine', authoritative: true, tone: 'cyan' });
  }

  function percentLabel(value: number, max: number, labels: [string, string, string, string, string]) {
    const pct = max > 0 ? (Number(value) / Number(max)) * 100 : 0;
    if (pct <= 20) return labels[0];
    if (pct <= 40) return labels[1];
    if (pct <= 60) return labels[2];
    if (pct <= 80) return labels[3];
    return labels[4];
  }

  function lifePhase(value: number, max: number) {
    return percentLabel(value, max, ['濒危', '重伤', '受伤', '安好', '饱满']);
  }

  function energyPhase(value: number, max: number) {
    return percentLabel(value, max, ['脱力', '疲倦', '尚可', '充沛', '神采奕奕']);
  }

  function bladderPhase(value: number, max: number) {
    return percentLabel(value, max, ['无压力', '略有感觉', '需要留意', '明显忍耐', '非常急迫']);
  }

  function lifePromptPart(value: number, max: number) {
    const safeValue = Math.max(0, Number(value) || 0);
    const safeMax = Math.max(1, Number(max) || 1);
    return safeValue >= safeMax ? '' : `生命「${lifePhase(safeValue, safeMax)}」`;
  }

  function protagonistStateSummary() {
    return [
      lifePromptPart(protagonist.hp, protagonist.hpMax),
      `精力「${energyPhase(energy.value, energy.max)}」`,
    ]
      .filter(Boolean)
      .join('，');
  }

  function relationshipStateSummary(limit = 6) {
    return heroines.value
      .slice(0, limit)
      .map(
        h => {
          const parts = [
            lifePromptPart(h.hp, h.hpMax),
            `精力「${energyPhase(h.energy, h.energyMax)}」`,
            `膀胱「${bladderPhase(h.bladder, h.bladderMax)}」`,
            `心情「${h.mood}」`,
            `位置「${h.located}」`,
          ].filter(Boolean);
          return `${h.name}: ${parts.join('，')}`;
        },
      )
      .join('\n');
  }

  function normalizeTavernNpcText(value: string) {
    return normalizeScenePlaceName(value)
      .replace(new RegExp(tavernName.value, 'g'), '')
      .replace(/铁壶酒馆|克斯的酒馆|酒馆|旅店|客栈/g, '')
      .replace(/[·\s-]/g, '')
      .trim();
  }

  function effectiveNpcActivityPools() {
    if (!npcActivityEnabled.value || !npcActivityWorldbookLibrary.value) return {};
    return Object.fromEntries(
      Object.entries(npcActivityWorldbookLibrary.value.regions ?? {})
        .map(([regionName, behaviors]) => [regionName, [...behaviors].filter(Boolean)])
        .filter(([, behaviors]) => behaviors.length),
    );
  }

  function effectiveNpcConversationTopics() {
    if (!npcActivityEnabled.value || !npcActivityWorldbookLibrary.value) return [];
    return [...(npcActivityWorldbookLibrary.value.conversationTopics ?? [])].filter(Boolean);
  }

  function effectiveNpcRestActivities() {
    if (!npcActivityEnabled.value || !npcActivityWorldbookLibrary.value) return [];
    return [...(npcActivityWorldbookLibrary.value.restBehaviors ?? [])].filter(Boolean);
  }

  function tavernRegionNames() {
    const pools = effectiveNpcActivityPools();
    const personalRegions = new Set(
      Object.values(characterBehaviorLibraries.value)
        .flatMap(library => library.behaviors ?? [])
        .map(item => item.region)
        .filter(Boolean),
    );
    return regions.value
      .map(region => region.name)
      .filter(name => name && (pools[name] || personalRegions.has(name)));
  }

  function resolveTavernNpcRegion(value: string) {
    const normalized = normalizeTavernNpcText(value);
    if (!normalized) return '';
    for (const regionName of tavernRegionNames()) {
      const candidates = [regionName, ...(tavernNpcRegionAliases[regionName] ?? [])].map(normalizeTavernNpcText).filter(Boolean);
      if (candidates.some(candidate => normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized))) {
        return regionName;
      }
    }
    return '';
  }

  function pickRandom<T>(list: T[]) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function normalizeNpcBehaviorCandidate(value: unknown) {
    const text = String(value ?? '')
      .trim()
      .replace(/^[-*•\d.、\s]+/, '')
      .replace(/[。.!！?？；;]+$/g, '');
    if (!text) return '';
    if (text.length <= 10) return text;
    const keywordPatterns = [
      /打扫卫生/g,
      /整理桌椅/g,
      /整理桌子/g,
      /整理椅子/g,
      /擦桌(?:子)?/g,
      /摆椅(?:子)?/g,
      /收杯(?:子)?/g,
      /洗杯(?:子)?/g,
      /洗碗/g,
      /扫地/g,
      /拖地/g,
      /擦柜台/g,
      /看锅/g,
      /添柴/g,
      /端菜/g,
      /招呼客人/g,
      /整理床铺/g,
      /铺床/g,
    ];
    for (const pattern of keywordPatterns) {
      const matched = text.match(pattern)?.[0];
      if (matched) return matched;
    }
    return text
      .split(/[、,，/／；;。.!！?？]|并且|以及|然后|同时|会|能|主动|不再/)
      .map(part => part.trim())
      .filter(part => part.length >= 2 && part.length <= 10)
      .at(0) ?? text.slice(0, 10);
  }

  function isRestNpcActivity(behavior: string) {
    return effectiveNpcRestActivities().some(rest => behavior.includes(rest));
  }

  function isLowActivityTime() {
    const tod = currentTimeOfDay.value;
    return tod === '入夜' || tod === '深夜';
  }

  function npcActivityTargetRegions() {
    const names = tavernRegionNames();
    if (!isLowActivityTime()) return names;
    const preferred = ['客房', '厨房餐食区', '柜台酒水区', '主厅接待区'].filter(name => names.includes(name));
    return preferred.length ? preferred : names;
  }

  function isHeroineLockedForNpcActivity(heroine: Heroine, actionText: string) {
    if (!heroine.name.trim()) return true;
    if (actionText.includes(heroine.name) || actionText.includes(heroine.title)) return true;
    const heroineRegion = resolveTavernNpcRegion(heroine.located);
    const protagonistRegion = resolveTavernNpcRegion(protagonist.located || location.place);
    return Boolean(heroineRegion && protagonistRegion && heroineRegion === protagonistRegion);
  }

  function safeNpcActivityKeepTurns(value = npcActivityKeepTurns.value) {
    return Math.max(1, Math.floor(Number(value) || DEFAULT_NPC_ACTIVITY_KEEP_TURNS));
  }

  function normalizeNpcActivity(activity: Partial<TavernNpcActivity>, fallbackTurn = successfulNarrationTurn.value): TavernNpcActivity | null {
    const heroineId = String(activity.heroineId ?? '').trim();
    const heroine = heroines.value.find(item => item.id === heroineId);
    const heroineName = String(activity.heroineName ?? heroine?.name ?? '').trim();
    const toRegion = String(activity.toRegion ?? '').trim();
    const behavior = String(activity.behavior ?? activity.behaviors?.[0] ?? '').trim();
    const behaviors = Array.isArray(activity.behaviors)
      ? activity.behaviors.map(item => String(item).trim()).filter(Boolean)
      : behavior
        ? [behavior]
        : [];
    if (!heroineId || !heroineName || !toRegion || !behavior || !behaviors.length) return null;
    const createdTurn = Math.max(0, Math.floor(Number(activity.createdTurn) || fallbackTurn));
    const expiresTurn = Math.max(createdTurn + 1, Math.floor(Number(activity.expiresTurn) || (createdTurn + safeNpcActivityKeepTurns())));
    return {
      heroineId,
      heroineName,
      fromRegion: String(activity.fromRegion ?? toRegion).trim() || toRegion,
      toRegion,
      behavior,
      behaviors,
      updatedAt: Math.floor(Number(activity.updatedAt) || Date.now()),
      createdTurn,
      expiresTurn,
      source: activity.source === 'manual_assign' ? 'manual_assign' : 'auto',
    };
  }

  function normalizeNpcActivities(list: unknown, fallbackTurn = successfulNarrationTurn.value) {
    if (!Array.isArray(list)) return [];
    return list
      .map(item => normalizeNpcActivity(item as Partial<TavernNpcActivity>, fallbackTurn))
      .filter((item): item is TavernNpcActivity => Boolean(item));
  }

  function activeNpcActivities(referenceTurn = successfulNarrationTurn.value) {
    if (!npcActivityEnabled.value || !npcActivityWorldbookLibrary.value) return [];
    return tavernNpcActivities.value
      .map(item => normalizeNpcActivity(item, referenceTurn))
      .filter((item): item is TavernNpcActivity => Boolean(item) && (item.expiresTurn ?? 0) > referenceTurn);
  }

  function pruneExpiredNpcActivities(referenceTurn = successfulNarrationTurn.value) {
    const active = activeNpcActivities(referenceTurn);
    if (active.length !== tavernNpcActivities.value.length) {
      tavernNpcActivities.value = active;
      markLocalStateDirty();
    }
    return active;
  }

  function buildNpcActivityEntry(heroine: Heroine, fromRegion: string, toRegion: string, source: TavernNpcActivity['source'] = 'auto') {
    const personalPool = (characterBehaviorLibraries.value[heroine.id]?.behaviors ?? [])
      .filter(item => item.region === toRegion && item.behavior)
      .map(item => normalizeNpcBehaviorCandidate(item.behavior))
      .filter(Boolean);
    const globalPool = (effectiveNpcActivityPools()[toRegion] ?? [])
      .map(normalizeNpcBehaviorCandidate)
      .filter(Boolean);
    const pool = personalPool.length ? personalPool : globalPool;
    const behavior = pickRandom(pool);
    if (!behavior) return null;
    return {
      heroineId: heroine.id,
      heroineName: heroine.name,
      fromRegion,
      toRegion,
      behavior,
      behaviors: [behavior],
      updatedAt: Date.now(),
      source,
    } satisfies TavernNpcActivity;
  }

  function prepareTavernNpcActivityPlan(actionText: string): TavernNpcActivityPlan | null {
    if (!npcActivityEnabled.value || !npcActivityWorldbookLibrary.value) return null;
    const nowMinute = currentSerialMinute();
    if (nowMinute - lastNpcActivityMinute.value < NPC_ACTIVITY_MIN_MINUTES) return null;
    if (successfulNarrationTurn.value - lastNpcActivityTurn.value < NPC_ACTIVITY_MIN_SUCCESS_TURNS) return null;

    const targetRegions = npcActivityTargetRegions();
    if (!targetRegions.length) return null;
    const busyHeroineIds = new Set(activeNpcActivities().map(entry => entry.heroineId));

    let candidates = heroines.value
      .map(heroine => ({ heroine, fromRegion: resolveTavernNpcRegion(heroine.located) }))
      .filter(item => item.fromRegion && !busyHeroineIds.has(item.heroine.id) && !isHeroineLockedForNpcActivity(item.heroine, actionText));

    if (isLowActivityTime() && candidates.length > 2) {
      candidates = [...candidates].sort(() => Math.random() - 0.5).slice(0, Math.max(1, Math.ceil(candidates.length / 3)));
    }

    const entries = candidates.map(({ heroine, fromRegion }) => {
      const toRegion = pickRandom(targetRegions) ?? fromRegion;
      return buildNpcActivityEntry(heroine, fromRegion, toRegion, 'auto');
    }).filter((entry): entry is TavernNpcActivity => Boolean(entry));

    const byRegion = new Map<string, TavernNpcActivity[]>();
    entries.forEach(entry => {
      const group = byRegion.get(entry.toRegion) ?? [];
      group.push(entry);
      byRegion.set(entry.toRegion, group);
    });
    byRegion.forEach(group => {
      const canTalk = group.filter(entry => !isRestNpcActivity(entry.behavior));
      if (canTalk.length < 2) return;
      const topic = pickRandom(effectiveNpcConversationTopics());
      if (!topic) return;
      canTalk.forEach(entry => {
        entry.behaviors = [entry.behavior, `交谈:${topic}`];
      });
    });

    return entries.length ? { entries, serialMinute: nowMinute } : null;
  }

  function formatNpcActivityLines(entries: TavernNpcActivity[], referenceTurn = successfulNarrationTurn.value) {
    return entries.map(entry => {
      const behaviors = entry.behaviors
        .map(item => normalizeNpcBehaviorCandidate(item).replace(/^交谈[:：]/, '闲谈'))
        .filter(Boolean);
      const remaining = Math.max(1, (entry.expiresTurn ?? (referenceTurn + safeNpcActivityKeepTurns())) - referenceTurn);
      return `${entry.heroineName}在${entry.toRegion}${behaviors.join('、')}（剩余${remaining}回合）。`;
    });
  }

  function formatTavernNpcActivityPlan(plan: TavernNpcActivityPlan | null) {
    const existing = activeNpcActivities();
    const planEntries = plan?.entries ?? [];
    const merged = [...existing, ...planEntries.filter(entry => !existing.some(item => item.heroineId === entry.heroineId))];
    if (!merged.length) return '';
    return [
      ...formatNpcActivityLines(merged),
    ].join('\n');
  }

  function commitTavernNpcActivityPlan(plan: TavernNpcActivityPlan | null, completedTurn = successfulNarrationTurn.value) {
    pruneExpiredNpcActivities(completedTurn);
    if (!plan?.entries.length) return false;
    const keepTurns = safeNpcActivityKeepTurns();
    const normalizedEntries = plan.entries
      .map(entry => normalizeNpcActivity({
        ...entry,
        createdTurn: completedTurn,
        expiresTurn: completedTurn + keepTurns,
        updatedAt: Date.now(),
      }, completedTurn))
      .filter((entry): entry is TavernNpcActivity => Boolean(entry));
    if (!normalizedEntries.length) return false;
    const byHeroineId = new Map(normalizedEntries.map(entry => [entry.heroineId, entry]));
    heroines.value.forEach(heroine => {
      const entry = byHeroineId.get(heroine.id);
      if (entry) heroine.located = entry.toRegion;
    });
    const remaining = tavernNpcActivities.value.filter(entry => !byHeroineId.has(entry.heroineId));
    tavernNpcActivities.value = [...normalizedEntries.map(entry => clonePlain(entry)), ...remaining].slice(0, 48);
    lastNpcActivityMinute.value = plan.serialMinute;
    lastNpcActivityTurn.value = completedTurn;
    markLocalStateDirty();
    pushLog('系统', `配角动向已刷新 ${normalizedEntries.length} 位。`, {
      source: 'engine',
      authoritative: true,
      tone: 'cyan',
      actionType: 'NPC_ACTIVITY',
    });
    return true;
  }

  function commitManualWorkerAssignNpcActivities(completedTurn = successfulNarrationTurn.value) {
    if (!npcActivityEnabled.value || !npcActivityWorldbookLibrary.value) return false;
    const manualEntries = draftActions.value
      .filter(action => action.type === 'WORKER_ASSIGN' && action.undoPatch?.type === 'WORKER_ASSIGN')
      .map(action => {
        const patch = action.undoPatch as Extract<DraftUndoPatch, { type: 'WORKER_ASSIGN' }>;
        const heroine = heroines.value.find(item => item.id === patch.heroineId);
        const region = regions.value.find(item => item.id === patch.targetRegionId);
        if (!heroine || !region) return null;
        return buildNpcActivityEntry(heroine, resolveTavernNpcRegion(patch.previousLocated) || patch.previousLocated || region.name, region.name, 'manual_assign');
      })
      .filter((entry): entry is TavernNpcActivity => Boolean(entry))
      .map(entry => normalizeNpcActivity({
        ...entry,
        createdTurn: completedTurn,
        expiresTurn: completedTurn + safeNpcActivityKeepTurns(),
        updatedAt: Date.now(),
      }, completedTurn))
      .filter((entry): entry is TavernNpcActivity => Boolean(entry));

    if (!manualEntries.length) return false;
    const byHeroineId = new Map(manualEntries.map(entry => [entry.heroineId, entry]));
    const remaining = activeNpcActivities(completedTurn).filter(entry => !byHeroineId.has(entry.heroineId));
    tavernNpcActivities.value = [...manualEntries.map(entry => clonePlain(entry)), ...remaining].slice(0, 48);
    markLocalStateDirty();
    pushLog('系统', `手动分配已生成配角动向 ${manualEntries.length} 条。`, {
      source: 'engine',
      authoritative: true,
      tone: 'cyan',
      actionType: 'NPC_ACTIVITY',
    });
    return true;
  }

  function npcActivitiesForRegion(regionName: string) {
    return pruneExpiredNpcActivities().filter(entry => {
      if (entry.toRegion !== regionName) return false;
      const heroine = heroines.value.find(item => item.id === entry.heroineId);
      return !heroine || resolveTavernNpcRegion(heroine.located) === regionName;
    });
  }

  async function refreshNpcActivityWorldbookLibrary() {
    try {
      const result = await loadNpcActivityLibraryFromActiveWorldbooks();
      npcActivityWorldbookErrors.value = result.errors;
      npcActivityWorldbookStatus.value = result.message;
      if (result.ok && result.library) {
        npcActivityWorldbookLibrary.value = clonePlain(result.library);
        markLocalStateDirty();
        await writeChatSave();
        pushLog('系统', `后台行为库已从世界书读取：${result.library.sourceLabels.length} 个块。`, {
          source: 'engine',
          authoritative: true,
          tone: 'cyan',
          actionType: 'NPC_ACTIVITY_WORLDBOOK',
        });
        return true;
      }
      npcActivityWorldbookLibrary.value = null;
      npcActivityEnabled.value = false;
      markLocalStateDirty();
      await writeChatSave();
      pushLog('提示', result.message, {
        source: 'engine',
        authoritative: true,
        tone: result.errors.length ? 'red' : 'amber',
        actionType: 'NPC_ACTIVITY_WORLDBOOK',
      });
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取世界书行为库失败。';
      npcActivityWorldbookStatus.value = message;
      npcActivityWorldbookErrors.value = [message];
      npcActivityWorldbookLibrary.value = null;
      npcActivityEnabled.value = false;
      markLocalStateDirty();
      await writeChatSave();
      pushLog('提示', message, {
        source: 'engine',
        authoritative: true,
        tone: 'red',
        actionType: 'NPC_ACTIVITY_WORLDBOOK',
      });
      return false;
    }
  }

  async function refreshNpcActivityWorldbookLibraryFromBindings() {
    try {
      const bindings = npcActivityWorldbookBindings.value.filter(binding => binding.worldbookName.trim() && Number.isFinite(binding.uid));
      if (!bindings.length) {
        const message = '尚未绑定后台行为库世界书条目。';
        npcActivityWorldbookStatus.value = message;
        npcActivityWorldbookErrors.value = [];
        npcActivityWorldbookLibrary.value = null;
        npcActivityEnabled.value = false;
        markLocalStateDirty();
        await writeChatSave();
        pushLog('提示', message, {
          source: 'engine',
          authoritative: true,
          tone: 'amber',
          actionType: 'NPC_ACTIVITY_WORLDBOOK',
        });
        return false;
      }

      const result = await loadNpcActivityLibraryFromBoundWorldbookEntries(bindings);
      npcActivityWorldbookErrors.value = result.errors;
      npcActivityWorldbookStatus.value = result.message;
      if (result.ok && result.library) {
        npcActivityWorldbookLibrary.value = clonePlain(result.library);
        markLocalStateDirty();
        await writeChatSave();
        pushLog('系统', `后台行为库已从手动绑定条目读取：${result.library.sourceLabels.length} 个块。`, {
          source: 'engine',
          authoritative: true,
          tone: 'cyan',
          actionType: 'NPC_ACTIVITY_WORLDBOOK',
        });
        return true;
      }
      npcActivityWorldbookLibrary.value = null;
      npcActivityEnabled.value = false;
      markLocalStateDirty();
      await writeChatSave();
      pushLog('提示', result.message, {
        source: 'engine',
        authoritative: true,
        tone: result.errors.length ? 'red' : 'amber',
        actionType: 'NPC_ACTIVITY_WORLDBOOK',
      });
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取手动绑定行为库失败。';
      npcActivityWorldbookStatus.value = message;
      npcActivityWorldbookErrors.value = [message];
      npcActivityWorldbookLibrary.value = null;
      npcActivityEnabled.value = false;
      markLocalStateDirty();
      await writeChatSave();
      pushLog('提示', message, {
        source: 'engine',
        authoritative: true,
        tone: 'red',
        actionType: 'NPC_ACTIVITY_WORLDBOOK',
      });
      return false;
    }
  }

  async function setNpcActivityWorldbookBinding(worldbookName: string, uid: number) {
    const cleanName = String(worldbookName || '').trim();
    const cleanUid = Math.floor(Number(uid));
    if (!cleanName || !Number.isFinite(cleanUid)) return false;
    npcActivityWorldbookBindings.value = [{ worldbookName: cleanName, uid: cleanUid }];
    markLocalStateDirty();
    await writeChatSave();
    return true;
  }

  async function ensureNpcActivityWorldbook(worldbookName = openingSave.value?.worldbookName || '') {
    try {
      const binding = await ensureNpcActivityWorldbookBinding(worldbookName);
      npcActivityWorldbookBindings.value = [{
        worldbookName: binding.worldbookName,
        uid: binding.uid,
      }];
      npcActivityWorldbookStatus.value = `伪活人化行为库条目已创建/绑定：${binding.worldbookName} · uid ${binding.uid}`;
      npcActivityWorldbookErrors.value = [];
      const ok = await refreshNpcActivityWorldbookLibraryFromBindings();
      if (ok) npcActivityEnabled.value = true;
      markLocalStateDirty();
      await writeChatSave();
      pushLog('系统', `伪活人化行为库已自动创建/绑定 · ${binding.worldbookName} · uid ${binding.uid}`, {
        source: 'engine',
        authoritative: true,
        tone: 'cyan',
        actionType: 'NPC_ACTIVITY_WORLDBOOK',
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '伪活人化行为库自动创建/绑定失败。';
      npcActivityWorldbookStatus.value = message;
      npcActivityWorldbookErrors.value = [message];
      pushLog('提示', message, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
        actionType: 'NPC_ACTIVITY_WORLDBOOK',
      });
      await writeChatSave();
      return false;
    }
  }

  async function clearNpcActivityWorldbookBindings() {
    npcActivityWorldbookBindings.value = [];
    npcActivityWorldbookLibrary.value = null;
    npcActivityEnabled.value = false;
    npcActivityWorldbookStatus.value = '伪活人化已关闭：未绑定世界书行为库。';
    npcActivityWorldbookErrors.value = [];
    markLocalStateDirty();
    await writeChatSave();
  }

  async function setNpcActivityEnabled(enabled: boolean) {
    if (enabled && !npcActivityWorldbookLibrary.value) {
      npcActivityEnabled.value = false;
      npcActivityWorldbookStatus.value = '伪活人化未开启：请先成功读取一个世界书行为库。';
      markLocalStateDirty();
      await writeChatSave();
      pushLog('提示', npcActivityWorldbookStatus.value, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
        actionType: 'NPC_ACTIVITY_WORLDBOOK',
      });
      return false;
    }
    npcActivityEnabled.value = enabled;
    npcActivityWorldbookStatus.value = enabled ? '伪活人化已开启。' : '伪活人化已关闭。';
    markLocalStateDirty();
    await writeChatSave();
    pushLog('系统', npcActivityWorldbookStatus.value, {
      source: 'engine',
      authoritative: true,
      tone: enabled ? 'cyan' : 'amber',
      actionType: 'NPC_ACTIVITY_WORLDBOOK',
    });
    return true;
  }

  async function setNpcActivityKeepTurns(value: number) {
    npcActivityKeepTurns.value = safeNpcActivityKeepTurns(value);
    markLocalStateDirty();
    await writeChatSave();
  }

  function weatherLibraryStats(library = weatherWorldbookLibrary.value) {
    const monthCounts = Object.entries(library?.months ?? {})
      .map(([month, entries]) => ({ month, count: entries.length }))
      .sort((a, b) => a.month.localeCompare(b.month, 'zh-Hans-CN'));
    return {
      monthCounts,
      weatherCount: monthCounts.reduce((sum, item) => sum + item.count, 0),
      currentMonthCount: library?.months?.[currentMonthName()]?.length ?? 0,
    };
  }

  function refreshWeatherForLoadedLibrary(force = false) {
    if (!weatherWorldbookLibrary.value) return;
    if (force) calendar.weatherDaySerial = 0;
    ensureWeatherForToday();
  }

  async function refreshWeatherWorldbookLibrary() {
    try {
      const result = await loadWeatherLibraryFromActiveWorldbooks();
      weatherWorldbookErrors.value = result.errors;
      weatherWorldbookStatus.value = result.message;
      if (result.ok && result.library) {
        weatherWorldbookLibrary.value = clonePlain(result.library);
        refreshWeatherForLoadedLibrary(true);
        markLocalStateDirty();
        await writeChatSave();
        const stats = weatherLibraryStats(result.library);
        pushLog('系统', `天气池已从世界书读取：${stats.monthCounts.length} 个月，${stats.weatherCount} 条天气。`, {
          source: 'engine',
          authoritative: true,
          tone: 'cyan',
        });
      } else {
        weatherWorldbookLibrary.value = null;
        clearWeatherForDay();
        markLocalStateDirty();
        await writeChatSave();
        pushLog('提示', result.message, {
          source: 'engine',
          authoritative: true,
          tone: 'amber',
        });
      }
      return result.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取世界书天气池失败。';
      weatherWorldbookStatus.value = message;
      weatherWorldbookErrors.value = [message];
      weatherWorldbookLibrary.value = null;
      clearWeatherForDay();
      markLocalStateDirty();
      await writeChatSave();
      pushLog('提示', message, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
      });
      return false;
    }
  }

  async function refreshWeatherWorldbookLibraryFromBindings() {
    try {
      const bindings = weatherWorldbookBindings.value.filter(binding => binding.worldbookName.trim() && Number.isFinite(binding.uid));
      if (!bindings.length) {
        const message = '尚未绑定天气池世界书条目。';
        weatherWorldbookStatus.value = message;
        weatherWorldbookErrors.value = [];
        weatherWorldbookLibrary.value = null;
        clearWeatherForDay();
        markLocalStateDirty();
        await writeChatSave();
        pushLog('提示', message, {
          source: 'engine',
          authoritative: true,
          tone: 'amber',
        });
        return false;
      }

      const result = await loadWeatherLibraryFromBoundWorldbookEntries(bindings);
      weatherWorldbookErrors.value = result.errors;
      weatherWorldbookStatus.value = result.message;
      if (result.ok && result.library) {
        weatherWorldbookLibrary.value = clonePlain(result.library);
        refreshWeatherForLoadedLibrary(true);
        markLocalStateDirty();
        await writeChatSave();
        const stats = weatherLibraryStats(result.library);
        pushLog('系统', `天气池已从手动绑定条目读取：${stats.monthCounts.length} 个月，${stats.weatherCount} 条天气。`, {
          source: 'engine',
          authoritative: true,
          tone: 'cyan',
        });
      } else {
        weatherWorldbookLibrary.value = null;
        clearWeatherForDay();
        markLocalStateDirty();
        await writeChatSave();
        pushLog('提示', result.message, {
          source: 'engine',
          authoritative: true,
          tone: 'amber',
        });
      }
      return result.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取手动绑定天气池失败。';
      weatherWorldbookStatus.value = message;
      weatherWorldbookErrors.value = [message];
      weatherWorldbookLibrary.value = null;
      clearWeatherForDay();
      markLocalStateDirty();
      await writeChatSave();
      pushLog('提示', message, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
      });
      return false;
    }
  }

  async function setWeatherWorldbookBinding(worldbookName: string, uid: number) {
    const cleanName = String(worldbookName || '').trim();
    const cleanUid = Number(uid);
    if (!cleanName || !Number.isFinite(cleanUid)) {
      pushLog('提示', '天气池绑定需要世界书名和有效 uid。', { source: 'engine', authoritative: true, tone: 'amber' });
      return false;
    }
    weatherWorldbookBindings.value = [{ worldbookName: cleanName, uid: cleanUid }];
    markLocalStateDirty();
    await writeChatSave();
    return true;
  }

  async function ensureWeatherWorldbook(worldbookName = openingSave.value?.worldbookName || '') {
    try {
      const binding = await ensureWeatherWorldbookBinding(worldbookName);
      weatherWorldbookBindings.value = [{
        worldbookName: binding.worldbookName,
        uid: binding.uid,
      }];
      weatherWorldbookStatus.value = `天气池条目已创建/绑定：${binding.worldbookName} · uid ${binding.uid}`;
      weatherWorldbookErrors.value = [];
      const ok = await refreshWeatherWorldbookLibraryFromBindings();
      markLocalStateDirty();
      await writeChatSave();
      pushLog('系统', `天气池已自动创建/绑定 · ${binding.worldbookName} · uid ${binding.uid}`, {
        source: 'engine',
        authoritative: true,
        tone: ok ? 'cyan' : 'amber',
      });
      return ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : '天气池自动创建/绑定失败。';
      weatherWorldbookStatus.value = message;
      weatherWorldbookErrors.value = [message];
      clearWeatherForDay();
      pushLog('提示', message, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
      });
      await writeChatSave();
      return false;
    }
  }

  async function clearWeatherWorldbookBindings() {
    weatherWorldbookBindings.value = [];
    weatherWorldbookLibrary.value = null;
    weatherWorldbookStatus.value = '尚未读取世界书天气池。';
    weatherWorldbookErrors.value = [];
    clearWeatherForDay();
    markLocalStateDirty();
    await writeChatSave();
  }

  async function ensureDefaultWorldbookModules(worldbookName = openingSave.value?.worldbookName || '') {
    const targetWorldbook = String(worldbookName || '').trim();
    if (!targetWorldbook) return false;

    let weatherOk = false;
    let npcActivityOk = false;

    try {
      const binding = await ensureWeatherWorldbookBinding(targetWorldbook);
      weatherWorldbookBindings.value = [{
        worldbookName: binding.worldbookName,
        uid: binding.uid,
      }];
      weatherWorldbookStatus.value = `天气池条目已绑定：${binding.worldbookName} · uid ${binding.uid}`;
      weatherWorldbookErrors.value = [];
      weatherOk = await refreshWeatherWorldbookLibraryFromBindings();
      markLocalStateDirty();
    } catch (error) {
      weatherOk = weatherWorldbookBindings.value.length > 0
        ? await refreshWeatherWorldbookLibraryFromBindings()
        : await ensureWeatherWorldbook(targetWorldbook);
    }

    try {
      const binding = await ensureNpcActivityWorldbookBinding(targetWorldbook);
      npcActivityWorldbookBindings.value = [{
        worldbookName: binding.worldbookName,
        uid: binding.uid,
      }];
      npcActivityWorldbookStatus.value = `伪活人化行为库条目已绑定：${binding.worldbookName} · uid ${binding.uid}`;
      npcActivityWorldbookErrors.value = [];
      npcActivityOk = await refreshNpcActivityWorldbookLibraryFromBindings();
      if (npcActivityOk && !npcActivityEnabled.value) {
        npcActivityEnabled.value = true;
        npcActivityWorldbookStatus.value = '伪活人化已默认开启。';
      }
      markLocalStateDirty();
    } catch (error) {
      if (npcActivityWorldbookBindings.value.length > 0) {
        npcActivityOk = await refreshNpcActivityWorldbookLibraryFromBindings();
        if (npcActivityOk && !npcActivityEnabled.value) {
          npcActivityEnabled.value = true;
          npcActivityWorldbookStatus.value = '伪活人化已默认开启。';
          markLocalStateDirty();
        }
      } else {
        npcActivityOk = await ensureNpcActivityWorldbook(targetWorldbook);
      }
    }

    if (weatherOk || npcActivityOk) await writeChatSave();
    return weatherOk || npcActivityOk;
  }

  async function ensureTurnContextWorldbook() {
    try {
      const binding = await ensureTurnContextWorldbookBinding(openingSave.value?.worldbookName || '');
      turnContextWorldbookBinding.value = clonePlain(binding);
      turnContextWorldbookStatus.value = `本回合发送包条目已绑定：${binding.worldbookName} · uid ${binding.uid}`;
      if (openingSave.value) openingSave.value = { ...openingSave.value, turnContextWorldbookBinding: clonePlain(binding) };
      markLocalStateDirty();
      await writeChatSave();
      pushLog('系统', `本回合发送包条目已创建/绑定 · ${binding.worldbookName} · uid ${binding.uid}`, {
        source: 'engine',
        authoritative: true,
        tone: 'cyan',
        actionType: 'TURN_CONTEXT_WORLDBOOK_BIND',
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '本回合发送包条目创建/绑定失败。';
      turnContextWorldbookStatus.value = message;
      pushLog('提示', message, { source: 'engine', authoritative: true, tone: 'red', actionType: 'TURN_CONTEXT_WORLDBOOK_BIND' });
      await writeChatSave();
      return false;
    }
  }

  async function refreshTurnContextWorldbookBinding() {
    try {
      const { worldbookName, uid } = await validateTurnContextWorldbookBinding(turnContextWorldbookBinding.value);
      turnContextWorldbookStatus.value = `本回合发送包条目绑定正常：${worldbookName} · uid ${uid}`;
      pushLog('系统', turnContextWorldbookStatus.value, {
        source: 'engine',
        authoritative: true,
        tone: 'green',
        actionType: 'TURN_CONTEXT_WORLDBOOK_CHECK',
      });
      await writeChatSave();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '本回合发送包条目绑定检测失败。';
      turnContextWorldbookStatus.value = message;
      pushLog('提示', message, { source: 'engine', authoritative: true, tone: 'red', actionType: 'TURN_CONTEXT_WORLDBOOK_CHECK' });
      await writeChatSave();
      return false;
    }
  }

  function dayNumberFromValue(value: unknown, fallback?: number) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value !== 'string') return fallback;
    const text = value.trim();
    if (!text) return fallback;
    if (/^\d+$/.test(text)) return Number(text);
    const match = text.match(/(\d+)\s*年\s*[·\s-]*([^\s·第]+月)\s*第\s*(\d+)\s*日/);
    if (!match) return fallback;
    const year = Number(match[1]);
    const monthIndex = months.indexOf(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || monthIndex < 0 || !Number.isFinite(day)) return fallback;
    return year * 12 * 30 + monthIndex * 30 + day;
  }

  function setCalendarFromSerialDay(serialDay: number) {
    const safeDay = Math.max(1, Math.floor(serialDay));
    const zeroBased = safeDay - 1;
    calendar.year = Math.floor(zeroBased / 360);
    const rem = zeroBased % 360;
    calendar.monthIndex = Math.max(0, Math.min(11, Math.floor(rem / 30)));
    calendar.day = (rem % 30) + 1;
  }

  function clockToMinutes(clock: string) {
    const match = clock.match(/^(\d{1,2})(?::(\d{1,2}))?/);
    if (!match) return 0;
    const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
    const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
    return hour * 60 + minute;
  }

  function advanceCalendarByMinutes(minutes: number) {
    const totalMinutes = Math.max(0, Math.floor(minutes));
    if (totalMinutes <= 0) return { beforeDay: currentCalendarDay(), afterDay: currentCalendarDay(), advancedDays: 0 };
    const beforeDay = currentCalendarDay();
    const previousMinuteOfDay = clockToMinutes(calendar.clock);
    const nextTotalMinutes = previousMinuteOfDay + totalMinutes;
    const advancedDays = Math.floor(nextTotalMinutes / (24 * 60));
    const minuteOfDay = nextTotalMinutes % (24 * 60);
    if (advancedDays > 0) setCalendarFromSerialDay(beforeDay + advancedDays);
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    calendar.clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    calendar.timeOfDay = timeOfDayFromClock(calendar.clock) ?? calendar.timeOfDay;
    return { beforeDay, afterDay: currentCalendarDay(), advancedDays };
  }

  const tavernName = ref('铁壶酒馆');
  const location = reactive({
    region: '布拉姆维克',
    place: '厨房餐食区',
  });

  /* 财富: 底层以铜币储存。旧 treasuryCopper 作为总额兼容口保留。 */
  const walletCopper = ref(173_482);
  const cashboxCopper = ref(0);
  const treasuryCopper = computed({
    get: () => walletCopper.value + cashboxCopper.value,
    set: value => {
      walletCopper.value = Math.max(0, Math.floor(Number(value) || 0));
      cashboxCopper.value = 0;
    },
  });
  const walletParts = computed(() => copperToParts(walletCopper.value));
  const cashboxParts = computed(() => copperToParts(cashboxCopper.value));
  const treasuryParts = computed(() => copperToParts(treasuryCopper.value));
  const walletText = computed(() => formatCopper(walletCopper.value));
  const cashboxText = computed(() => formatCopper(cashboxCopper.value));
  const treasuryText = computed(() => formatCopper(treasuryCopper.value));

  /* 声望与精力 */
  const reputation = ref(62);
  const energy = reactive({ value: 78, max: 100 });
  const protagonist = reactive<Protagonist>({
    name: '<user>',
    race: '人类',
    title: '酒馆老板',
    cookingLevel: 3,
    cookingExp: 42,
    cookingExpMax: 100,
    hp: 100,
    hpMax: 100,
    energy: 78,
    energyMax: 100,
    mood: '准备营业',
    located: '厨房餐食区',
    outfit: '身着耐洗的亚麻衬衣，下着深色长裤，外系一条带旧油痕的厨房围裙。',
    bio: '普利莫迪亚编年录的执笔者与酒馆主人。你决定今日走向何处，也决定炉火最终烧成什么味道。',
  });

  function syncProtagonistEnergyFromStore() {
    const nextMax = Number(energy.max);
    const nextValue = Number(energy.value);
    protagonist.energyMax = Math.max(1, Math.floor(Number.isFinite(nextMax) ? nextMax : protagonist.energyMax || 100));
    protagonist.energy = Math.max(0, Math.min(protagonist.energyMax, Math.floor(Number.isFinite(nextValue) ? nextValue : protagonist.energy || 0)));
  }

  /* 酒馆成长空间 */
  const tavernOverview = ref('铁壶酒馆刚刚开张，只有主厅、厨房、柜台和几间能住人的客房真正能用；其余空间仍在故事中慢慢整理出来。');
  const regions = ref<TavernRegion[]>([
    {
      id: 'main-hall',
      name: '主厅接待区',
      subtitle: '壁炉、长桌、接待核心',
      icon: 'candle',
      level: 1,
      style: '橡木与石墙',
      condition: '良好',
      description: '客人停留最久的大厅，也是传闻、交易、争吵和热汤香气最容易聚集的地方。',
      staff: undefined,
      facilities: [],
    },
    {
      id: 'bar',
      name: '柜台酒水区',
      subtitle: '收钱、倒酒、账本',
      icon: 'coin',
      level: 1,
      style: '深色橡木',
      condition: '良好',
      description: '柜台负责点单、收钱、倒酒和记账。这里的设施会影响酒水售卖与客人结算。',
      staff: undefined,
      facilities: [],
    },
    {
      id: 'kitchen',
      name: '厨房餐食区',
      subtitle: '灶台、备餐、烹饪',
      icon: 'fire',
      level: 1,
      style: '石灶与铁锅',
      condition: '良好',
      description: '处理食材、做菜、做酱和准备餐食的地方。库房里的东西会在这里变成可以端上桌的成品。',
      staff: undefined,
      facilities: [],
    },
    {
      id: 'rooms',
      name: '客房',
      subtitle: '住客、房间、休憩',
      icon: 'moon',
      level: 1,
      style: '木梁与粗布',
      condition: '良好',
      description: '客人过夜和长期住客休息的区域。每间房可以拥有独立设施。',
      staff: undefined,
      facilities: [],
      rooms: [
        { id: 'room-1', name: '一号房', type: '普通单人间', priceCopper: 80, comfort: 30, privacy: 30, cleanliness: 70, guest: null, facilities: [] },
        { id: 'room-2', name: '二号房', type: '普通双人间', priceCopper: 120, comfort: 35, privacy: 32, cleanliness: 70, guest: null, facilities: [] },
        { id: 'room-3', name: '三号房', type: '便宜小房', priceCopper: 45, comfort: 20, privacy: 40, cleanliness: 60, guest: null, facilities: [] },
        { id: 'room-4', name: '四号房', type: '上等客房', priceCopper: 220, comfort: 55, privacy: 55, cleanliness: 78, guest: null, facilities: [] },
      ],
    },
  ]);

  /* 库存 */
  const inventory = ref<InventoryItem[]>([]);
  const satchel = ref<InventoryItem[]>([]);
  const temporaryStates = ref<TemporaryStateTree>({
    主角: [],
    酒馆: [],
    酒馆区域: {},
    人物: {},
  });
  const promiseMemos = ref<PromiseMemo[]>([]);
  const recipes = ref<RecipeEntry[]>([]);
  const pendingCraftSources = ref<Array<{ craftId: string; source: RecipeSource; createdAt: number }>>([]);
  const DEFAULT_BUSINESS_VISITOR_CHANCE = 30;
  const DEFAULT_BUSINESS_GUEST_CAP = 12;
  const isBusinessOpen = ref(false);
  const currentGuests = ref(0);
  const guestCap = ref(DEFAULT_BUSINESS_GUEST_CAP);
  const visitorChance = ref(DEFAULT_BUSINESS_VISITOR_CHANCE);
  const lastVisitorSeed = ref('');
  const guestGroups = ref<GuestGroup[]>([]);

  /* 女主羁绊 */
  const stageNames = ['初识', '熟悉', '信任', '牵挂', '亲近', '默契', '羁绊', '生死相托'];
  const heroines = ref<Heroine[]>([]);
  const characterWorldbookBindings = ref<Record<string, CharacterWorldbookBinding[]>>({});
  const characterBehaviorLibraries = ref<Record<string, CharacterBehaviorLibrary>>({});
  const heroinePortraitColors = ['#8f5d3f', '#7b6a42', '#6f5f93', '#4d7a72', '#9a5a63', '#80613a'];
  const tavernNpcActivities = ref<TavernNpcActivity[]>([]);
  const lastNpcActivityMinute = ref(currentSerialMinute());
  const lastNpcActivityTurn = ref(0);
  const successfulNarrationTurn = ref(0);
  const npcActivityKeepTurns = ref(DEFAULT_NPC_ACTIVITY_KEEP_TURNS);
  const npcActivityEnabled = ref(false);
  const npcActivityWorldbookLibrary = ref<NpcActivityWorldbookLibrary | null>(null);
  const npcActivityWorldbookBindings = ref<WorldbookEntryRef[]>([]);
  const npcActivityWorldbookStatus = ref('尚未读取世界书行为库。');
  const npcActivityWorldbookErrors = ref<string[]>([]);
  const weatherWorldbookLibrary = ref<WeatherWorldbookLibrary | null>(null);
  const weatherWorldbookBindings = ref<WorldbookEntryRef[]>([]);
  const weatherWorldbookStatus = ref('尚未读取世界书天气池。');
  const weatherWorldbookErrors = ref<string[]>([]);
  const turnContextWorldbookBinding = ref<TurnContextWorldbookBinding | null>(null);
  const turnContextWorldbookStatus = ref('本回合发送包条目尚未绑定。');
  const turnContextWorldbookReady = computed(
    () =>
      !!turnContextWorldbookBinding.value?.worldbookName &&
      Number.isFinite(Number(turnContextWorldbookBinding.value?.uid)) &&
      turnContextWorldbookBinding.value?.entryName === TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
  );
  watch(() => currentCalendarDay(), () => ensureWeatherForToday(), { immediate: true });

  /* 地图 */
  const mapNodes = ref<MapNode[]>(buildPrimordiaMapNodes());
  const currentMapId = ref('布拉姆维克');

  /* 街坊商铺 */
  const shops = ref<StreetShop[]>([]);
  const shopProducts = ref<ShopProduct[]>([]);

  const generatedShop = ref<StreetShop | null>(null);
  const generatedShopProducts = ref<ShopProduct[]>([]);
  const currentVariableShopName = ref('');
  const currentVariablePlaceText = ref('');

  /* 农田 */
  const farmPlots = ref<FarmPlot[]>([]);

  /* 酒窖 */
  const brews = ref<BrewBarrel[]>([]);

  /* ---------- 常量与类型 ---------- */
  const engineLogs = ref<EngineLog[]>([
    { id: 'e-1', at: '当下', kind: '系统', text: '《普利莫迪亚编年录》引擎已就绪。', source: 'system', authoritative: true, tone: 'neutral' },
  ]);
  const draftActions = ref<DraftAction[]>([]);
  const actionDraft = computed({
    get: () => draftActions.value.map(action => action.text).join('\n'),
    set: value => {
      draftActions.value = value
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((text, index) => ({ id: `draft-manual-${Date.now()}-${index}`, text, type: 'TEXT' }));
    },
  });
  const playerInput = ref<string>('');
  const isGenerating = ref(false);
  const localStateDirty = ref(false);
  const loadedStoryCheckpoint = ref<StoryIndexItem | null>(null);
  const storyContinuityOverride = ref<StoryIndexItem | null>(null);
  const saveMigrationStatus = ref('当前主存档已按最新结构读取。');

  /* 选中状态 */
  const currentTab = ref<TabId>('chronicle');
  const selectedHeroineId = ref<string | null>('h-juqi');
  const selectedRegionId = ref<string | null>(null);

  /* ---------- 常量与类型 ---------- */
  function appendDraft(line: string, options: { type?: DraftAction['type']; undoPatch?: DraftUndoPatch } = {}) {
    if (!line.trim()) return;
    draftActions.value.push({
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: line.trim(),
      type: options.type ?? 'TEXT',
      undoPatch: options.undoPatch,
    });
  }
  function clearActionDraft() {
    draftActions.value = [];
  }
  async function applyDraftUndoPatch(patch?: DraftUndoPatch) {
    if (!patch) return false;
    if (patch.type === 'WORKER_ASSIGN') {
      const heroine = heroines.value.find(item => item.id === patch.heroineId);
      const targetRegion = regions.value.find(item => item.id === patch.targetRegionId);
      const previousRegion = patch.previousRegionId ? regions.value.find(item => item.id === patch.previousRegionId) : undefined;
      if (targetRegion) targetRegion.staff = patch.previousTargetStaff;
      if (previousRegion && previousRegion.id !== targetRegion?.id) previousRegion.staff = patch.previousRegionStaff;
      if (heroine) heroine.located = patch.previousLocated;
      markLocalStateDirty();
      void writeChatSave();
      return true;
    }
    if (patch.type === 'REGION_CLEAN') {
      const region = regions.value.find(item => item.id === patch.regionId);
      if (region) region.condition = patch.previousCondition;
      markLocalStateDirty();
      void writeChatSave();
      return Boolean(region);
    }
    if (patch.type === 'LOCAL_SETTLEMENT') {
      await restoreLocalSettlement(patch.snapshot, patch.reason);
      return true;
    }
    return false;
  }
  async function removeDraftAction(id: string) {
    const index = draftActions.value.findIndex(action => action.id === id);
    if (index < 0) return;
    const [removed] = draftActions.value.splice(index, 1);
    if (await applyDraftUndoPatch(removed.undoPatch)) {
      pushLog('提示', `已撤销草稿行动 · ${removed.text.slice(0, 24)}${removed.text.length > 24 ? '...' : ''}`, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
      });
    }
  }
  function clearDraftActions(options: { undo?: boolean } = { undo: true }) {
    const actions = [...draftActions.value].reverse();
    draftActions.value = [];
    if (options.undo !== false) void Promise.all(actions.map(action => applyDraftUndoPatch(action.undoPatch)));
  }
  function appendPlayerInput(line: string) {
    if (!line.trim()) return;
    playerInput.value = playerInput.value
      ? `${playerInput.value.replace(/\s+$/, '')}\n${line.trim()}`
      : line.trim();
  }
  function currentSceneLabel() {
    sanitizeCurrentLocation();
    const region = location.region || '';
    const place = location.place || protagonist.located || '';
    if (region && place.startsWith(`${region} 路`)) return place;
    return [region, place].filter(Boolean).join(' · ') || '当前地点';
  }

  function sanitizeCurrentLocation() {
    const place = normalizeScenePlaceName(location.place);
    const located = normalizeScenePlaceName(protagonist.located);
    if (place && place !== location.place) location.place = place;
    if (located && located !== protagonist.located) protagonist.located = located;
  }

  const currentSceneType = computed<SceneType>(() => {
    sanitizeCurrentLocation();
    if (generatedShop.value && isCurrentShopLocation(generatedShop.value.name)) return '商铺';
    return inferSceneType(`${location.place} ${protagonist.located}`);
  });

  function setCurrentPlace(rawPlace: string, options: { region?: string; keepShop?: boolean } = {}) {
    const nextPlace = normalizeScenePlaceName(rawPlace);
    if (!nextPlace) return false;
    if (options.region?.trim()) location.region = options.region.trim();
    const changed = location.place !== nextPlace || protagonist.located !== nextPlace;
    location.place = nextPlace;
    protagonist.located = nextPlace;
    if (!options.keepShop && !isShopLikePlace(nextPlace)) clearGeneratedShop({ silent: true });
    sanitizeCurrentLocation();
    return changed;
  }

  function currentPlaceText() {
    return [location.region, location.place, protagonist.located].filter(Boolean).join(' ');
  }

  function compactShopCompareText(value: string) {
    return normalizeScenePlaceName(value)
      .replace(/^(?:街坊商铺|当前商铺|商铺|店铺|摊位|货架)\s*[·:：\-—\s]*/g, '')
      .replace(/[·:：\-—「」“”"'`\s]+/g, '')
      .trim();
  }

  function lastShopNameSegment(value: string) {
    return normalizeScenePlaceName(value)
      .replace(/^(?:街坊商铺|当前商铺|商铺|店铺|摊位|货架)\s*[·:：\-—\s]*/g, '')
      .split(/[·:：\-—\\]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .at(-1);
  }

  function shopNameMatchesPlace(shopName: string | undefined, placeText = currentPlaceText()) {
    const expectedName = shopName?.trim();
    if (!expectedName) return false;
    if (placeText.includes(expectedName)) return true;
    const placeLooksShop = isShopLikePlace(placeText);
    const expectedCompact = compactShopCompareText(expectedName);
    const placeCompact = compactShopCompareText(placeText);
    if (expectedCompact && placeCompact && (placeCompact.includes(expectedCompact) || (placeLooksShop && expectedCompact.includes(placeCompact)))) {
      return true;
    }
    const lastSegment = lastShopNameSegment(expectedName);
    return Boolean(lastSegment && placeLooksShop && placeText.includes(lastSegment));
  }

  function variablePlaceMatchesShopName(shopName: string | undefined, placeText: string | undefined) {
    const expectedName = normalizeScenePlaceName(shopName ?? '');
    const variablePlace = normalizeScenePlaceName(placeText ?? '');
    if (!expectedName || !variablePlace) return false;
    if (variablePlace === expectedName || variablePlace.includes(expectedName)) return true;
    const expectedCompact = compactShopCompareText(expectedName);
    const placeCompact = compactShopCompareText(variablePlace);
    return Boolean(expectedCompact && placeCompact && placeCompact.includes(expectedCompact));
  }

  function currentSceneCanHostShop(shopName?: string) {
    const text = currentPlaceText();
    if (shopNameMatchesPlace(shopName, text)) return true;
    const sceneType = inferSceneType(text);
    return sceneType === '商铺';
  }

  function currentSceneHasExactShop(shopName?: string) {
    return shopNameMatchesPlace(shopName);
  }

  function currentShopNameFromLocation() {
    const activeShopName = generatedShop.value?.name?.trim() ?? '';
    if (activeShopName && shopNameMatchesPlace(activeShopName)) return activeShopName;
    const place = normalizeScenePlaceName(location.place || protagonist.located || '');
    const located = normalizeScenePlaceName(protagonist.located || location.place || '');
    if (activeShopName && (place === activeShopName || located === activeShopName)) return activeShopName;
    if (isGenericStreetEntrance(`${place} ${located}`)) return '';
    return place || located;
  }

  function protagonistEnergyStateLabel() {
    return energyPhase(energy.value, Math.max(1, energy.max || protagonist.energyMax || 100));
  }

  function aiAuthorityBoundary(settledFact?: string) {
    return [
      '请只负责 AIRP 正文叙事、角色互动、NPC反应、场景气氛和感官描写。',
      settledFact
        ? `前端已结算: ${settledFact}`
        : '自由行动造成的库存、状态或地点变化，请用隐藏 MVU/变量补丁表达；没有变量补丁就保持不变。',
      '不要在正文里展示 JSON、变量命令、规则分析、提示词或自检过程。',
    ].join('\n');
  }

  function businessStateSnapshot(): TavernBusinessState {
    return {
      isOpen: isBusinessOpen.value,
      currentGuests: Math.max(0, Math.floor(currentGuests.value || 0)),
      guestCap: Math.max(1, Math.floor(guestCap.value || DEFAULT_BUSINESS_GUEST_CAP)),
      visitorChance: Math.max(0, Math.min(100, Math.floor(Number.isFinite(visitorChance.value) ? visitorChance.value : DEFAULT_BUSINESS_VISITOR_CHANCE))),
      lastVisitorSeed: lastVisitorSeed.value.trim(),
    };
  }

  function normalizeBusinessState(source: unknown): TavernBusinessState {
    const record = asRecord(source);
    const rawVisitorChance = Number(record.visitorChance);
    return {
      isOpen: Boolean(record.isOpen),
      currentGuests: Math.max(0, Math.floor(Number(record.currentGuests) || 0)),
      guestCap: Math.max(1, Math.floor(Number(record.guestCap) || DEFAULT_BUSINESS_GUEST_CAP)),
      visitorChance: Math.max(0, Math.min(100, Math.floor(Number.isFinite(rawVisitorChance) ? rawVisitorChance : DEFAULT_BUSINESS_VISITOR_CHANCE))),
      lastVisitorSeed: String(record.lastVisitorSeed || '').trim(),
    };
  }

  function prepareBusinessVisitorPlan(): TavernBusinessVisitorPlan | null {
    if (!isBusinessOpen.value) return null;
    const cap = Math.max(1, Math.floor(guestCap.value || DEFAULT_BUSINESS_GUEST_CAP));
    const guests = Math.max(0, Math.floor(currentGuests.value || 0));
    if (guests >= cap) return { seed: null, nextGuests: guests, shouldInject: false, reason: 'full' };
    const chance = Math.max(0, Math.min(100, Math.floor(Number.isFinite(visitorChance.value) ? visitorChance.value : DEFAULT_BUSINESS_VISITOR_CHANCE))) / 100;
    if (Math.random() >= chance) {
      return { seed: null, nextGuests: Math.max(0, guests - 1), shouldInject: false, reason: 'miss' };
    }
    const seed = rollVisitorSeed();
    return {
      seed,
      nextGuests: Math.min(cap, guests + seed.count),
      shouldInject: true,
      reason: 'hit',
    };
  }

  function formatBusinessVisitorPlan(plan: TavernBusinessVisitorPlan | null) {
    if (!plan?.shouldInject || !plan.seed) return '';
    return [
      `酒馆门口新来的动静：${plan.seed.text}`,
      '如果这批客人实际进店、点单或留下需求，请在正文后追加 <guest_update> JSON 数组，供前端服务托盘记录。',
    ].join('\n');
  }

  function commitBusinessVisitorPlan(plan: TavernBusinessVisitorPlan | null) {
    if (!plan || !isBusinessOpen.value) return false;
    currentGuests.value = Math.max(0, Math.min(Math.max(1, guestCap.value), plan.nextGuests));
    if (plan.seed) {
      lastVisitorSeed.value = plan.seed.text;
      pushLog('叙事', `营业访客 · ${plan.seed.text}`, {
        source: 'engine',
        authoritative: true,
        tone: 'cyan',
        actionType: 'BUSINESS_VISITOR',
      });
    }
    markLocalStateDirty();
    return true;
  }

  function setBusinessOpen(open: boolean) {
    isBusinessOpen.value = open;
    if (!open) {
      currentGuests.value = 0;
      lastVisitorSeed.value = '';
    }
    markLocalStateDirty();
    void writeChatSave();
    pushLog('系统', open ? '酒馆开始营业，后续回合会尝试生成访客动向。' : '酒馆已歇业，客流记录已清空。', {
      source: 'engine',
      authoritative: true,
      tone: open ? 'green' : 'amber',
      actionType: 'BUSINESS_TOGGLE',
    });
  }

  function setBusinessGuestCap(value: number) {
    guestCap.value = Math.max(1, Math.floor(Number(value) || DEFAULT_BUSINESS_GUEST_CAP));
    currentGuests.value = Math.min(currentGuests.value, guestCap.value);
    markLocalStateDirty();
    void writeChatSave();
  }

  function setBusinessVisitorChance(value: number) {
    const next = Number(value);
    visitorChance.value = Math.max(0, Math.min(100, Math.floor(Number.isFinite(next) ? next : DEFAULT_BUSINESS_VISITOR_CHANCE)));
    markLocalStateDirty();
    void writeChatSave();
  }

  function normalizeGuestGroupStatus(value: unknown): GuestUpdateStatus {
    if (value === '刚进店' || value === '等待点单' || value === '已点单' || value === '待上菜' || value === '用餐中' || value === '已离开') {
      return value;
    }
    return '刚进店';
  }

  function normalizeGuestGroups(source: unknown): GuestGroup[] {
    if (!Array.isArray(source)) return [];
    return source
      .map((entry, index) => {
        const record = asRecord(entry);
        const id = String(record.id || `table-${index + 1}`).trim();
        const turn = Math.max(0, Math.floor(Number(record.updatedAtTurn ?? record.createdAtTurn) || successfulNarrationTurn.value || 0));
        return {
          id,
          label: String(record.label || `第${index + 1}桌`).trim(),
          guests: String(record.guests || '').trim(),
          status: normalizeGuestGroupStatus(record.status),
          order: String(record.order || '').trim(),
          note: String(record.note || '').trim(),
          createdAtTurn: Math.max(0, Math.floor(Number(record.createdAtTurn) || turn)),
          updatedAtTurn: turn,
        };
      })
      .filter(entry => entry.id && (entry.guests || entry.order || entry.note));
  }

  function nextGuestGroupId() {
    let index = 1;
    const used = new Set(guestGroups.value.map(group => group.id));
    while (used.has(`table-${index}`)) index += 1;
    return `table-${index}`;
  }

  function applyGuestUpdates(updates: ParsedGuestUpdate[] | undefined, turn = successfulNarrationTurn.value) {
    if (!updates?.length) return false;
    let changed = false;
    for (const update of updates) {
      const id = update.id?.trim() || nextGuestGroupId();
      const existed = guestGroups.value.find(group => group.id === id);
      const next: GuestGroup = {
        id,
        label: update.label?.trim() || existed?.label || `第${guestGroups.value.length + 1}桌`,
        guests: update.guests?.trim() || existed?.guests || '',
        status: normalizeGuestGroupStatus(update.status || existed?.status),
        order: update.order?.trim() || existed?.order || '',
        note: update.note?.trim() || existed?.note || '',
        createdAtTurn: existed?.createdAtTurn ?? turn,
        updatedAtTurn: turn,
      };
      if (existed) Object.assign(existed, next);
      else guestGroups.value.push(next);
      changed = true;
    }
    if (changed) {
      markLocalStateDirty();
      pushLog('系统', `服务托盘已更新 ${updates.length} 条客人记录。`, {
        source: 'ai',
        authoritative: false,
        tone: 'cyan',
        actionType: 'GUEST_UPDATE',
      });
    }
    return changed;
  }

  function activeGuestGroups() {
    return guestGroups.value.filter(group => group.status !== '已离开');
  }

  function orderableGuestGroups() {
    return activeGuestGroups().filter(group => group.status === '已点单' || group.status === '待上菜');
  }

  function findGuestGroup(id?: string) {
    return id ? guestGroups.value.find(group => group.id === id) : undefined;
  }

  function updateGuestGroup(id: string, patch: Partial<Omit<GuestGroup, 'id' | 'createdAtTurn' | 'updatedAtTurn'>>) {
    const group = findGuestGroup(id);
    if (!group) return false;
    if (patch.label !== undefined) group.label = patch.label.trim() || group.label;
    if (patch.guests !== undefined) group.guests = patch.guests.trim();
    if (patch.status !== undefined) group.status = normalizeGuestGroupStatus(patch.status);
    if (patch.order !== undefined) group.order = patch.order.trim();
    if (patch.note !== undefined) group.note = patch.note.trim();
    group.updatedAtTurn = successfulNarrationTurn.value;
    markLocalStateDirty();
    void writeChatSave();
    return true;
  }

  function addGuestGroup(partial: Partial<Omit<GuestGroup, 'id' | 'createdAtTurn' | 'updatedAtTurn'>> = {}) {
    const turn = successfulNarrationTurn.value;
    const group: GuestGroup = {
      id: nextGuestGroupId(),
      label: partial.label?.trim() || `第${guestGroups.value.length + 1}桌`,
      guests: partial.guests?.trim() || '',
      status: normalizeGuestGroupStatus(partial.status || '等待点单'),
      order: partial.order?.trim() || '',
      note: partial.note?.trim() || '',
      createdAtTurn: turn,
      updatedAtTurn: turn,
    };
    guestGroups.value.push(group);
    markLocalStateDirty();
    void writeChatSave();
    return group;
  }

  function removeGuestGroup(id: string) {
    const before = guestGroups.value.length;
    guestGroups.value = guestGroups.value.filter(group => group.id !== id);
    if (guestGroups.value.length === before) return false;
    markLocalStateDirty();
    void writeChatSave();
    return true;
  }

  function markGuestGroupServed(id?: string) {
    if (!id) return false;
    return updateGuestGroup(id, { status: '用餐中' });
  }

  function formatGuestGroupLine(group: GuestGroup) {
    return [
      `${group.id} / ${group.label}`,
      group.guests ? `客人: ${group.guests}` : '',
      `状态: ${group.status}`,
      group.order ? `点单: ${group.order}` : '',
      group.note ? `备注: ${group.note}` : '',
    ]
      .filter(Boolean)
      .join('；');
  }

  function formatServiceTrayPromptBlock() {
    const active = activeGuestGroups();
    if (!active.length) return '';
    return ['当前服务托盘:', ...active.slice(0, 8).map(formatGuestGroupLine)].join('\n');
  }

  function buildAuthoritativeSituationSummary() {
    ensureWeatherForToday();
    const weatherLine =
      sendWeatherToAi.value && weatherWorldbookLibrary.value && calendar.weather && calendar.weather !== '未设天气'
        ? `今日天气: ${calendar.weather}。${calendar.weatherDescription || '天气细节暂未记录。'}`
        : '';
    const relationLine = relationshipStateSummary();
    return [
      '完整正式变量树已附加在本层消息 data/stat_data；库存、货架、农田、人物与酒馆结构以 stat_data 为准。',
      `当前日期时间: ${calendar.year}年 ${currentMonthName()}（${seasonText.value}）第${calendar.day}日 · ${weekDayName.value}${isMarketDay.value ? '（集市日）' : ''} · ${currentTimeOfDay.value} · ${clockText.value}。`,
      isMarketDay.value
        ? '今日是市日：街坊、集市、摊位、临时货车与外来小贩更活跃；若本回合涉及采购或找店，商品来源与类型可以比平日更丰富。'
        : '',
      weatherLine,
      `主角状态: ${protagonistStateSummary()}；当前状态「${protagonist.mood}」；所在位置「${protagonist.located}」；穿着「${protagonist.outfit}」。`,
      relationLine ? `配角状态:\n${relationLine}` : '',
      formatTemporaryStatePromptBlock(),
      `资金: 随身钱袋 ${walletText.value}；钱匣 ${cashboxText.value}；合计 ${treasuryText.value}。外出采购、送礼、路上消费优先使用随身钱袋；酒馆收入进入钱匣；建设维护使用钱匣。余额不足就是余额不足，不要赊账或自动混用另一处资金。`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  function buildInteractionContextBlock() {
    const sceneLines: string[] = [];

    if (generatedShop.value && isCurrentShopLocation(generatedShop.value.name)) {
      sceneLines.push(
        `当前商铺: ${generatedShop.value.name}`,
        `店主: ${generatedShop.value.keeper}`,
        `商铺描述: ${generatedShop.value.atmosphere}`,
      );
    }

    return sceneLines.join('\n');
  }

  function formatCharacterBehaviorMemoryBlock() {
    return '';
  }

  function buildSystemJudgementSnapshot(lastActionSummary = ''): SystemJudgementSnapshot {
    const activeShop = generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? generatedShop.value : null;
    return {
      authority: 'frontend-system',
      version: 1,
      judgedAt: Date.now(),
      scene: snapshotLocation(),
      currentTab: currentTab.value,
      moneyCopper: treasuryCopper.value,
      walletCopper: walletCopper.value,
      cashboxCopper: cashboxCopper.value,
      inventoryItemCount: inventory.value.filter(item => item.qty > 0).length + satchel.value.filter(item => item.qty > 0).length,
      activeShopName: activeShop?.name ?? '',
      activeShopProductCount: activeShop ? generatedShopProducts.value.length : 0,
      lastActionSummary: lastActionSummary.trim(),
      finalRule:
        '前端结算快照为本回合界面状态准绳。地点只按 MVU 地点变量变化；自由行动里的库存、行囊、临时状态和资金增减可由 MVU/变量补丁同步；前端已硬结算的随身钱袋、钱匣、货架、农田酒窖、设施和人物状态不得被正文反改。',
    };
  }

  function formatSystemJudgementBlock(lastActionSummary = '') {
    const judgement = buildSystemJudgementSnapshot(lastActionSummary);
    return [
      `最终权威: ${judgement.authority}`,
      `判定版本: ${judgement.version}`,
      `场景类型: ${judgement.scene.sceneType}`,
      judgement.scene.relatedName ? `关联对象: ${judgement.scene.relatedName}` : '',
      `前端页签: ${judgement.currentTab}`,
      `随身钱袋铜币: ${judgement.walletCopper}`,
      `钱匣铜币: ${judgement.cashboxCopper}`,
      `资金合计铜币: ${judgement.moneyCopper}`,
      `库存条目: ${judgement.inventoryItemCount}`,
      judgement.activeShopName ? `有效商铺: ${judgement.activeShopName} / 货架${judgement.activeShopProductCount}项` : '有效商铺: 无',
      judgement.lastActionSummary ? `本回合行动: ${judgement.lastActionSummary}` : '',
      judgement.finalRule,
    ]
      .filter(Boolean)
      .join('\n');
  }

  function buildOutputFormatInstruction(aiHint?: string, options: { allowGuestUpdate?: boolean } = {}) {
    const hint = aiHint?.trim() ?? '';
    const needsShop = /<shop>|货架|商铺名|店名/.test(hint);
    const needsCraft = /<craft_result>|待命名|成品名|搭配判定/.test(hint);
    const needsGuestUpdate = options.allowGuestUpdate || /<guest_update>|客人|点单|上菜|服务托盘|访客/.test(hint);
    return [
      '必须输出 <maintext>...</maintext> 正文叙述。',
      '正文写角色行动、场景描写或 NPC 反应，不要写“以下是正文”“根据要求”等元话语。',
      '如果需要选项，可以在正文后输出 <option>...</option>，每行一个选项，最多4个。',
      '如果需要读档摘要，可以在最后输出 <sum>...</sum>，用1-2句话概括时间、地点、人物、事件。',
      '如本回合需要修改变量，可在正文后输出隐藏 <UpdateVariable> 或 <JSONPatch>；这些内容不得出现在 <maintext> 正文中。',
      '如果正文中产生未来承诺、预约、威胁、约好再见、某人说稍后回来等内容，请在正文后输出 <promise_update>...</promise_update> 严格 JSON 数组；trigger_time 必须换算成明确游戏时间 YYYY-MM-DD HH:mm，字段必须包含 action、name、trigger_time、people、event、reminder；不要写自然语言格式，不要把约定记录写进 <maintext>。',
      [
        '如果配角在某个酒馆区域学会、承担或表现出以后可反复做的后台小动作，请在正文后输出 <character_behavior_update>...</character_behavior_update> 严格 JSON 数组。',
        '这个块用于维护“每个配角自己的伪活人化行为池”：让不在主角当前镜头里的配角以后也能被前端随机安排事情做。',
        '只写短行为词或短行为组，例如“擦桌”“摆椅”“看锅”“收杯”“整理床铺”；不要写长总结、心理成长、主角感受或完整句子。',
        '如果只是一次性动作、临时情绪、普通路过、偶然帮忙、路人行为、或没有可重复价值，则不要输出这个块。',
        'region 必须使用当前已经存在的酒馆区域名；不能确定时写空字符串。这个块不创建新人物、不创建新区域、不替代 MVU 变量。',
        '完整格式示例：<character_behavior_update>[{"action":"learn","character":"橘柒","region":"主厅接待区","behaviors":["擦桌","摆椅","收杯"]}]</character_behavior_update>',
        'action 只允许 learn/remove/update；character 写角色正式姓名；优先使用 behaviors 数组，每个行为控制在 2-8 个字。',
      ].join('\n'),
      needsShop ? '本回合要求生成商铺时，必须在 <maintext> 后输出 <shop>...</shop>。' : '',
      needsCraft ? '本回合要求生成制作结果时，必须在 <maintext> 后输出 <craft_result>...</craft_result>。' : '',
      needsGuestUpdate ? '本回合若新增客人、点单、上菜反馈或客人离开，请在正文后输出 <guest_update>...</guest_update> JSON 数组，供前端服务托盘读取。' : '',
      !needsShop && !needsCraft ? '除非本回合明确要求，不要输出 <shop> 或 <craft_result>。' : '',
      '不要输出 <NARRATIVE>、<CONTEXT_conception>、<Analysis>、规则推演或任何可见自检文字。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  function buildNarrationPrompt(options: {
    userText: string;
    settledFact?: string;
    actionType?: string;
    actionTitle?: string;
    timeChange?: ActionResult['timeChange'];
    aiHint?: string;
    npcActivityPlan?: TavernNpcActivityPlan | null;
    businessVisitorPlan?: TavernBusinessVisitorPlan | null;
  }) {
    const rawUserText = options.userText.trim();
    const structuredText = /<user>[\s\S]*?<\/user>|【前端权威事实】/.test(rawUserText) ? rawUserText : `<user>${rawUserText}</user>`;
    const hasFrontendSettlement = /前端已结算/.test(rawUserText);
    const timeLine = options.settledFact && options.timeChange
      ? `时间变化: ${options.timeChange.from} -> ${options.timeChange.to}（推进${options.timeChange.minutes}分钟）`
      : '';

    return [
      '<玩家本回合行动>',
      structuredText,
      '</玩家本回合行动>',
      '',
      '【叙述者权限边界】',
      aiAuthorityBoundary(options.settledFact),
      '',
      buildRecentStoryContinuitySummary(),
      '',
      '【当前权威局势】',
      buildAuthoritativeSituationSummary(),
      timeLine,
      '',
      '【交互上下文】',
      [
        buildInteractionContextBlock(),
        formatServiceTrayPromptBlock(),
        formatCharacterBehaviorMemoryBlock(),
        formatTavernNpcActivityPlan(options.npcActivityPlan ?? null),
        formatBusinessVisitorPlan(options.businessVisitorPlan ?? null),
      ]
        .filter(Boolean)
        .join('\n'),
      '',
      '【输出格式】',
      buildOutputFormatInstruction(options.aiHint, {
        allowGuestUpdate: Boolean(options.businessVisitorPlan?.shouldInject || activeGuestGroups().length),
      }),
      '',
      '【本回合叙述任务】',
      [
        '承接上一楼层正文末尾，写出本回合行动造成的连续剧情。',
        '不要重启场景；地点变化只通过 MVU 地点补丁表达。',
        hasFrontendSettlement ? '标注“前端已结算”的内容已经由前端扣减或改状态，不要再为这些内容输出库存、农田或酒窖变量补丁。' : '',
        options.aiHint?.trim() ? options.aiHint.trim() : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ]
      .filter(section => section !== '')
      .join('\n');
  }

  function promptAcceptsGeneratedShop(prompt: string) {
    return /动作类型:\s*(FIND_SHOP|VISIT_SHOP)|本回合要求生成商铺|请额外输出一个\s*<shop>|<shop>|货架给9到10项|店名:\s*商铺名|自由找店|寻找商铺/.test(prompt);
  }

  function sanitizeContinuityText(text: string) {
    return text
      .replace(new RegExp('<StatusPlaceHolderImpl\\s*/?>', 'gi'), '')
      .replace(/<StatusPlaceHolder\b[^>]*\/?>/gi, '')
      .replace(/StatusPlaceHolderImpl/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildRecentStoryContinuitySummary() {
    const latest = storyContinuityOverride.value ?? loadedStoryCheckpoint.value ?? loadLatestAssistantMaintext();
    const summary = sanitizeContinuityText(latest.sum ?? '');
    const maintext = sanitizeContinuityText(latest.maintext ?? '');
    const tail = maintext.slice(-320);
    if (!summary && !tail) return '';
    return [
      '上一楼层承接:',
      summary ? `上一楼层摘要: ${summary}` : '',
      tail ? `上一楼层正文末尾: ${tail}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  function wrapUserAction(action: string, target?: string) {
    const targetLine = target ? `目标/操作区域: 「${target}」。` : '';
    return `<user>${targetLine}${action}。请承接上一段行动；如需移动，只通过 MVU 地点补丁更新。</user>`;
  }
  function markLocalStateDirty() {
    localStateDirty.value = true;
  }
  function setLoadedStoryCheckpoint(item: StoryIndexItem | null) {
    loadedStoryCheckpoint.value = item;
  }

  async function truncateChatAfterLoadedCheckpoint(messageId: number): Promise<boolean> {
    if (typeof getLastMessageId !== 'function' || typeof deleteChatMessages !== 'function') {
      pushLog('系统', '当前环境没有提供楼层删除接口，无法从读档楼层继续。');
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
      pushLog('系统', `读档覆盖失败：楼层仍停在 #${nextLastMessageId}，没有继续发送。`);
      return false;
    }

    return true;
  }

  async function continueFromLoadedCheckpoint(): Promise<boolean> {
    const checkpoint = loadedStoryCheckpoint.value;
    const messageId = checkpoint?.messageId;
    if (messageId === undefined || messageId === null) return true;

    pushLog('系统', `从临时读档楼层 #${messageId} 继续，正在覆盖该楼层之后的记录。`);
    const truncated = await truncateChatAfterLoadedCheckpoint(messageId);
    if (!truncated) return false;
    if (!restoreStorySnapshot(messageId)) loadFromMvu({ messageId, force: true });
    loadedStoryCheckpoint.value = null;
    return true;
  }
  function defaultLogMeta(kind: EngineLog['kind']): Pick<EngineLog, 'source' | 'authoritative' | 'tone'> {
    if (kind === '叙事') return { source: 'ai', authoritative: false, tone: 'violet' };
    if (kind === '提示') return { source: 'engine', authoritative: true, tone: 'amber' };
    if (kind === '系统') return { source: 'system', authoritative: true, tone: 'neutral' };
    if (kind === '扣减') return { source: 'engine', authoritative: true, tone: 'red' };
    if (kind === '奖励') return { source: 'engine', authoritative: true, tone: 'green' };
    return { source: 'engine', authoritative: true, tone: 'cyan' };
  }

  function pushLog(kind: EngineLog['kind'], text: string, meta: Partial<Omit<EngineLog, 'id' | 'at' | 'kind' | 'text'>> = {}) {
    const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const defaults = defaultLogMeta(kind);
    engineLogs.value.unshift({
      id,
      at: `${currentTimeOfDay.value} · ${calendar.clock}`,
      kind,
      text,
      ...defaults,
      ...meta,
    });
    if (engineLogs.value.length > 50) engineLogs.value.length = 50;
    return id;
  }
  function removeLog(id: string) {
    const index = engineLogs.value.findIndex(log => log.id === id);
    if (index >= 0) engineLogs.value.splice(index, 1);
  }
  function removeLogs(ids: string[]) {
    if (!ids.length) return;
    const idSet = new Set(ids);
    engineLogs.value = engineLogs.value.filter(log => !idSet.has(log.id));
  }
  function normalizeCopperValue(value: unknown) {
    return Math.max(0, Math.floor(Number(value) || 0));
  }
  function moneyAccountRef(account: MoneyAccount) {
    return account === 'cashbox' ? cashboxCopper : walletCopper;
  }
  function moneyAccountLabel(account: MoneyAccount) {
    return account === 'cashbox' ? '钱匣' : '随身钱袋';
  }
  function moneyAccountText(account: MoneyAccount) {
    return formatCopper(moneyAccountRef(account).value);
  }
  function canSpendCopper(account: MoneyAccount, amount: number) {
    return normalizeCopperValue(amount) <= moneyAccountRef(account).value;
  }
  function spendFromAccount(account: MoneyAccount, amount: number, reason: string, options: { save?: boolean; log?: boolean } = {}) {
    const safeAmount = normalizeCopperValue(amount);
    const target = moneyAccountRef(account);
    if (safeAmount > target.value) {
      const message = `${moneyAccountLabel(account)}余额不足。本次需要 ${formatCopper(safeAmount)}，当前只有 ${formatCopper(target.value)}。`;
      if (options.log !== false) pushLog('提示', message, { tone: 'red' });
      return { ok: false as const, message };
    }
    target.value -= safeAmount;
    if (options.save !== false) {
      markLocalStateDirty();
      void writeChatSave();
    }
    if (options.log !== false) pushLog('扣减', `${reason} · ${moneyAccountLabel(account)} -${formatCopper(safeAmount)}`);
    return { ok: true as const, message: '' };
  }
  function earnToAccount(account: MoneyAccount, amount: number, reason: string, options: { save?: boolean; log?: boolean } = {}) {
    const safeAmount = normalizeCopperValue(amount);
    moneyAccountRef(account).value += safeAmount;
    if (options.save !== false) {
      markLocalStateDirty();
      void writeChatSave();
    }
    if (options.log !== false) pushLog('奖励', `${reason} · ${moneyAccountLabel(account)} +${formatCopper(safeAmount)}`);
  }
  function spendCopper(amount: number, reason: string) {
    const result = spendFromAccount('wallet', amount, reason, { save: false, log: false });
    if (!result.ok) return;
    markLocalStateDirty();
    void writeChatSave();
    pushLog('扣减', `${reason} -${formatCopper(amount)}`);
  }
  function earnCopper(amount: number, reason: string) {
    earnToAccount('cashbox', amount, reason, { save: false, log: false });
    markLocalStateDirty();
    void writeChatSave();
    pushLog('奖励', `${reason} +${formatCopper(amount)}`);
  }

  function updateFarmGrowthByDay(dayNumber: number) {
    const logs: Array<{ kind: EngineLog['kind']; text: string }> = [];
    farmPlots.value.forEach(plot => {
      if (plot.stage <= 0 || plot.crop === '空畦' || plot.plantedDay === undefined || plot.matureDay === undefined) return;
      const totalDays = Math.max(1, plot.matureDay - plot.plantedDay);
      const passedDays = Math.max(0, Math.min(totalDays, dayNumber - plot.plantedDay));
      const nextStage = Math.max(1, Math.min(plot.stageMax, 1 + Math.floor((passedDays / totalDays) * (plot.stageMax - 1))));
      if (nextStage !== plot.stage) {
        plot.stage = nextStage;
        plot.season = plot.stage >= plot.stageMax ? '成熟可收' : '生长中';
      }
      if (plot.stage >= plot.stageMax && !plot.readyNotified) {
        plot.readyNotified = true;
        logs.push({ kind: '提示', text: `第${plot.id.slice(2)}号畦「${plot.crop}」已经成熟，可以收获。` });
      }
    });
    return logs;
  }

  function updateBrewMaturityByDay(dayNumber: number) {
    const logs: Array<{ kind: EngineLog['kind']; text: string }> = [];
    brews.value.forEach(barrel => {
      if (dayNumber >= barrel.matureDay && !barrel.readyNotified) {
        barrel.readyNotified = true;
        logs.push({ kind: '提示', text: `酒窖里的「${barrel.name}」已经到成熟日，可以开桶。` });
      }
    });
    return logs;
  }

  function updateMarketRefreshByDay(dayNumber: number) {
    if (dayNumber <= lastShopRefreshDay.value) return [];
    lastShopRefreshDay.value = dayNumber;
    if (generatedShop.value && !isCurrentShopLocation(generatedShop.value.name)) clearGeneratedShop({ silent: true });
    return [{ kind: '提示' as const, text: '街坊商铺已经过了一次日常换货时点，下次探店会以当前地点重新读取货架。' }];
  }

  function runTimedSystems(beforeDay: number, afterDay: number) {
    if (afterDay < beforeDay) return [];
    return [
      ...updateFarmGrowthByDay(afterDay),
      ...updateBrewMaturityByDay(afterDay),
      ...updateMarketRefreshByDay(afterDay),
    ];
  }

  function commitTickLogs(logs: Array<{ kind: EngineLog['kind']; text: string }>, options: { silent?: boolean } = {}) {
    if (!logs.length) return;
    logs.forEach(log => {
      if (!options.silent) pushLog(log.kind, log.text);
    });
    markLocalStateDirty();
    void writeChatSave();
  }

  function tickSave(options: { now?: number; reason?: string; silent?: boolean } = {}) {
    const now = options.now ?? Date.now();
    const previous = lastTickAt.value || now;
    const { advancedMinutes } = getAdvancedGameMinutes(previous, now);
    lastTickAt.value = now;
    if (advancedMinutes <= 0) return { advancedMinutes: 0, logs: [] as Array<{ kind: EngineLog['kind']; text: string }> };
    const { beforeDay, afterDay, advancedDays } = advanceCalendarByMinutes(advancedMinutes);
    const logs = runTimedSystems(beforeDay, afterDay);
    if (advancedDays > 0) {
      logs.unshift({
        kind: '系统',
        text: `${options.reason ?? '世界心跳'} · 时间推进 ${advancedDays} 日，当前为 ${months[calendar.monthIndex]} 第${calendar.day}日 · ${calendar.timeOfDay}`,
      });
    }
    commitTickLogs(logs, { silent: options.silent });
    if (advancedMinutes > 0 && !logs.length) {
      markLocalStateDirty();
      void writeChatSave();
    }
    return { advancedMinutes, logs };
  }

  function advanceWorldTimeByGameHours(hours: number, reason: string) {
    const minutes = Math.max(0, Math.floor(hours * 60));
    if (minutes <= 0) return { advancedMinutes: 0, logs: [] as Array<{ kind: EngineLog['kind']; text: string }> };
    const { beforeDay, afterDay, advancedDays } = advanceCalendarByMinutes(minutes);
    lastTickAt.value = Date.now();
    const logs = runTimedSystems(beforeDay, afterDay);
    logs.unshift({
      kind: '系统',
      text: `${reason} · 时间推进 ${hours} 小时${advancedDays > 0 ? `，跨过 ${advancedDays} 日` : ''}。`,
    });
    commitTickLogs(logs);
    return { advancedMinutes: minutes, logs };
  }

  function addInventoryBatch(item: {
    name: string;
    category: InventoryItem['category'];
    qty: number;
    tags?: string[];
    desc?: string;
    priceCopper?: number;
    quality?: InventoryItem['quality'];
  }) {
    const tags = item.tags ?? [];
    const existing = inventory.value.find(entry => entry.name === item.name && entry.category === item.category);
    if (existing) {
      existing.qty += item.qty;
      existing.tags = [...new Set([...existing.tags, ...tags])];
      if (item.desc) existing.desc = item.desc;
      if (item.priceCopper) existing.priceCopper = item.priceCopper;
      if (item.quality) existing.quality = item.quality;
      return existing;
    }
    const next: InventoryItem = {
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: item.name,
      category: item.category,
      qty: item.qty,
      tags,
      ...(item.desc ? { desc: item.desc } : {}),
      ...(item.priceCopper ? { priceCopper: item.priceCopper } : {}),
      ...(item.quality ? { quality: item.quality } : {}),
    };
    inventory.value.unshift(next);
    return next;
  }

  function normalizeActionTags(item: BuyActionItem, category: InventoryItem['category']) {
    const tags = (item.tags ?? []).map(tag => tag.trim()).filter(Boolean);
    if (category === '杂物' && item.category && item.category !== '杂物') tags.push(item.category);
    return [...new Set(tags)];
  }

  function sameTagSet(a: string[], b: string[]) {
    return [...new Set(a)].sort().join('|') === [...new Set(b)].sort().join('|');
  }

  function emptyTemporaryStates(): TemporaryStateTree {
    return { 主角: [], 酒馆: [], 酒馆区域: {}, 人物: {} };
  }

  function normalizeTemporaryState(raw: unknown): TemporaryState | null {
    const record = asRecord(raw);
    const name = String(record['名称'] ?? record['name'] ?? '').trim();
    const desc = String(record['描述'] ?? record['desc'] ?? '').trim();
    const turns = Math.max(0, Math.floor(readLooseNumber(record, ['剩余回合', 'turns', 'remaining'], 0)));
    if (!name || turns <= 0) return null;
    return {
      名称: name,
      剩余回合: turns,
      描述: desc || name,
      ...(record['来源物品'] || record['sourceItem'] ? { 来源物品: String(record['来源物品'] ?? record['sourceItem']) } : {}),
    };
  }

  function normalizeTemporaryStateList(raw: unknown): TemporaryState[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeTemporaryState).filter((state): state is TemporaryState => state !== null);
  }

  function normalizeTemporaryStateTree(raw: unknown): TemporaryStateTree {
    const source = asRecord(raw);
    const regionSource = asRecord(source['酒馆区域']);
    const personSource = asRecord(source['人物']);
    return {
      主角: normalizeTemporaryStateList(source['主角']),
      酒馆: normalizeTemporaryStateList(source['酒馆']),
      酒馆区域: Object.fromEntries(
        Object.entries(regionSource)
          .map(([name, list]) => [name, normalizeTemporaryStateList(list)] as const)
          .filter(([, list]) => list.length > 0),
      ),
      人物: Object.fromEntries(
        Object.entries(personSource)
          .map(([name, list]) => [name, normalizeTemporaryStateList(list)] as const)
          .filter(([, list]) => list.length > 0),
      ),
    };
  }

  function temporaryStateKey(targetType: TemporaryStateDisplay['targetType'], targetName: string, state: TemporaryState) {
    return `${targetType}::${targetName}::${state.名称}::${state.描述}::${state.来源物品 ?? ''}`;
  }

  function flattenTemporaryStates(tree = temporaryStates.value): TemporaryStateDisplay[] {
    const out: TemporaryStateDisplay[] = [];
    tree.主角.forEach(state => out.push({ ...state, targetType: '主角', targetName: protagonist.name || '主角' }));
    tree.酒馆.forEach(state => out.push({ ...state, targetType: '酒馆', targetName: tavernName.value || '酒馆' }));
    Object.entries(tree.酒馆区域).forEach(([targetName, list]) => {
      list.forEach(state => out.push({ ...state, targetType: '酒馆区域', targetName }));
    });
    Object.entries(tree.人物).forEach(([targetName, list]) => {
      list.forEach(state => out.push({ ...state, targetType: '人物', targetName }));
    });
    return out.filter(state => state.剩余回合 > 0);
  }

  function captureTemporaryStateKeys() {
    return new Set(flattenTemporaryStates().map(state => temporaryStateKey(state.targetType, state.targetName, state)));
  }

  function decrementExistingTemporaryStates(previousKeys: Set<string>) {
    const before = JSON.stringify(temporaryStates.value);
    const tickList = (targetType: TemporaryStateDisplay['targetType'], targetName: string, list: TemporaryState[]) =>
      list
        .map(state => {
          const key = temporaryStateKey(targetType, targetName, state);
          return previousKeys.has(key) ? { ...state, 剩余回合: state.剩余回合 - 1 } : state;
        })
        .filter(state => state.剩余回合 > 0);

    temporaryStates.value = {
      主角: tickList('主角', protagonist.name || '主角', temporaryStates.value.主角),
      酒馆: tickList('酒馆', tavernName.value || '酒馆', temporaryStates.value.酒馆),
      酒馆区域: Object.fromEntries(
        Object.entries(temporaryStates.value.酒馆区域)
          .map(([name, list]) => [name, tickList('酒馆区域', name, list)] as const)
          .filter(([, list]) => list.length > 0),
      ),
      人物: Object.fromEntries(
        Object.entries(temporaryStates.value.人物)
          .map(([name, list]) => [name, tickList('人物', name, list)] as const)
          .filter(([, list]) => list.length > 0),
      ),
    };
    const changed = before !== JSON.stringify(temporaryStates.value);
    if (changed) markLocalStateDirty();
    return changed;
  }

  function formatTemporaryStatePromptBlock() {
    const active = flattenTemporaryStates();
    const rules = [
      '临时状态回合规则:',
      '- 上方“还剩X回合”表示该状态在本回合叙述中仍然有效，正文必须承认它的影响。',
      '- 本回合生成完成后，前端会自动把回合开始前已经存在的临时状态剩余回合 -1；AI不要为了普通时间推进输出“剩余回合减1”的变量补丁，避免重复扣减。',
      '- 只有状态被本回合行动提前解除、覆盖、刷新持续时间，或新增状态时，才输出对应 <UpdateVariable>/<JSONPatch>。',
      '- 新增临时状态必须写清 名称、剩余回合、描述、来源物品；剩余回合必须是正整数。',
    ];
    if (!active.length) return ['当前临时状态: 无。', ...rules].join('\n');
    return [
      '当前临时状态:',
      ...active.map(state => `- ${state.targetName}处于「${state.名称}」，还剩${state.剩余回合}回合。${state.描述}${state.来源物品 ? ` 来源物品: ${state.来源物品}。` : ''}`),
      ...rules,
    ].join('\n');
  }

  function parsePromiseTriggerTime(triggerTime: string) {
    const match = triggerTime.trim().match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})$/);
    if (!match) return null;
    const year = Math.max(1, Math.floor(Number(match[1]) || 0));
    const month = Math.max(1, Math.min(12, Math.floor(Number(match[2]) || 1)));
    const day = Math.max(1, Math.min(30, Math.floor(Number(match[3]) || 1)));
    const hour = Math.max(0, Math.min(23, Math.floor(Number(match[4]) || 0)));
    const minute = Math.max(0, Math.min(59, Math.floor(Number(match[5]) || 0)));
    return {
      year,
      monthIndex: month - 1,
      day,
      clock: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      serialMinute: (year * 12 * 30 + (month - 1) * 30 + day) * 24 * 60 + hour * 60 + minute,
    };
  }

  function normalizePromiseMemo(raw: unknown): PromiseMemo | null {
    const record = asRecord(raw);
    const name = String(record.name ?? record['名称'] ?? '').trim();
    const triggerTime = String(record.triggerTime ?? record.trigger_time ?? record['触发时间'] ?? '').trim();
    const reminder = String(record.reminder ?? record['提醒'] ?? '').trim();
    const event = String(record.event ?? record['事件'] ?? reminder).trim();
    if (!name || !triggerTime || !reminder || !parsePromiseTriggerTime(triggerTime)) return null;
    const statusText = String(record.status ?? 'pending');
    const status: PromiseMemoStatus =
      statusText === 'triggered' || statusText === 'cancelled' || statusText === 'resolved' ? statusText : 'pending';
    const peopleRaw = Array.isArray(record.people) ? record.people : Array.isArray(record['人物']) ? record['人物'] : [];
    return {
      id: String(record.id ?? `promise-${name}-${triggerTime}`).trim(),
      name,
      triggerTime,
      people: peopleRaw.map(item => String(item).trim()).filter(Boolean),
      event,
      reminder,
      status,
      createdAtTurn: Math.max(0, Math.floor(Number(record.createdAtTurn) || 0)),
      ...(Number.isFinite(Number(record.triggeredAtTurn)) ? { triggeredAtTurn: Math.max(0, Math.floor(Number(record.triggeredAtTurn))) } : {}),
    };
  }

  function normalizePromiseMemoList(raw: unknown): PromiseMemo[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizePromiseMemo).filter((memo): memo is PromiseMemo => memo !== null);
  }

  function promiseMemoKey(name: string, triggerTime: string) {
    return `${name.trim()}::${triggerTime.trim()}`;
  }

  function currentPromiseSerialMinute() {
    return currentSerialMinute();
  }

  function duePromiseMemos() {
    const now = currentPromiseSerialMinute();
    return promiseMemos.value.filter(memo => {
      if (memo.status !== 'pending') return false;
      const trigger = parsePromiseTriggerTime(memo.triggerTime);
      return Boolean(trigger && now >= trigger.serialMinute);
    });
  }

  function isPromiseMemoDue(memo: PromiseMemo) {
    if (memo.status !== 'pending') return false;
    const trigger = parsePromiseTriggerTime(memo.triggerTime);
    return Boolean(trigger && currentPromiseSerialMinute() >= trigger.serialMinute);
  }

  function formatDuePromiseMemoPromptBlock(memos = duePromiseMemos()) {
    if (!memos.length) return '';
    return [
      '【本回合触发的约定】',
      ...memos.map(memo => {
        const people = memo.people.length ? `相关人物: ${memo.people.join('、')}。` : '';
        return `- ${memo.name}: ${memo.reminder}${people ? ` ${people}` : ''}`;
      }),
      '这些是前端保存的未来事件提醒；请自然承接，不要把本段标题或说明文字写进正文。',
    ].join('\n');
  }

  function appendDuePromiseMemoBlock(prompt: string, memos: PromiseMemo[]) {
    const block = formatDuePromiseMemoPromptBlock(memos);
    return block ? `${prompt}\n\n${block}` : prompt;
  }

  function applyPromiseUpdates(updates: ParsedPromiseUpdate[] | undefined) {
    if (!updates?.length) return false;
    let changed = false;
    updates.forEach(update => {
      const normalizedTrigger = update.triggerTime.trim();
      const matchIndex = promiseMemos.value.findIndex(memo =>
        (update.id && memo.id === update.id) ||
        promiseMemoKey(memo.name, memo.triggerTime) === promiseMemoKey(update.name, normalizedTrigger),
      );

      if (update.action === 'cancel' || update.action === 'resolve') {
        if (matchIndex >= 0) {
          promiseMemos.value[matchIndex] = {
            ...promiseMemos.value[matchIndex],
            status: update.action === 'cancel' ? 'cancelled' : 'resolved',
          };
          changed = true;
        }
        return;
      }

      if (!parsePromiseTriggerTime(normalizedTrigger)) {
        pushLog('提示', `约定时间格式无效，已忽略：${update.name} · ${update.triggerTime}`, {
          source: 'ai',
          authoritative: false,
          tone: 'amber',
          actionType: 'PROMISE_MEMO',
        });
        return;
      }

      const next: PromiseMemo = {
        id: update.id || (matchIndex >= 0 ? promiseMemos.value[matchIndex].id : `promise-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        name: update.name,
        triggerTime: normalizedTrigger,
        people: update.people,
        event: update.event,
        reminder: update.reminder,
        status: 'pending',
        createdAtTurn: matchIndex >= 0 ? promiseMemos.value[matchIndex].createdAtTurn : successfulNarrationTurn.value + 1,
      };
      if (matchIndex >= 0) promiseMemos.value[matchIndex] = next;
      else promiseMemos.value.unshift(next);
      changed = true;
    });
    if (changed) {
      markLocalStateDirty();
      pushLog('系统', `约定备忘录已更新 ${updates.length} 条。`, {
        source: 'ai',
        authoritative: false,
        tone: 'violet',
        actionType: 'PROMISE_MEMO',
      });
    }
    return changed;
  }

  function markPromiseMemosTriggered(ids: string[], turn: number) {
    if (!ids.length) return false;
    let changed = false;
    const idSet = new Set(ids);
    promiseMemos.value = promiseMemos.value.map(memo => {
      if (!idSet.has(memo.id) || memo.status !== 'pending') return memo;
      changed = true;
      return { ...memo, status: 'triggered', triggeredAtTurn: turn };
    });
    if (changed) markLocalStateDirty();
    return changed;
  }

  function updatePromiseMemoStatus(id: string, status: PromiseMemoStatus) {
    const index = promiseMemos.value.findIndex(memo => memo.id === id);
    if (index < 0) return;
    promiseMemos.value[index] = {
      ...promiseMemos.value[index],
      status,
      ...(status === 'triggered' ? { triggeredAtTurn: successfulNarrationTurn.value } : {}),
    };
    markLocalStateDirty();
    void writeChatSave();
  }

  function addItemToCollection(collection: InventoryItem[], item: BuyActionItem | InventoryItem) {
    const category = normalizeInventoryCategory(item.category);
    const tags = 'tags' in item ? [...new Set((item.tags ?? []).map(tag => String(tag).trim()).filter(Boolean))] : [];
    const existed = collection.find(stored => stored.name === item.name && stored.category === category && sameTagSet(stored.tags, tags));
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    if (qty <= 0) return;
    if (existed) {
      existed.qty += qty;
      if (!existed.desc && item.desc) existed.desc = item.desc;
      if (!existed.priceCopper && item.priceCopper) existed.priceCopper = item.priceCopper;
      return;
    }
    collection.push({
      id: 'id' in item && item.id ? item.id : `i-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: item.name,
      category,
      qty,
      tags,
      desc: item.desc,
      priceCopper: item.priceCopper,
      ...('quality' in item && item.quality ? { quality: item.quality } : {}),
      ...('recipeSource' in item && item.recipeSource ? { recipeSource: clonePlain(item.recipeSource) } : {}),
    });
  }

  function itemSourceLabel(source: InventorySource) {
    return source === 'satchel' ? '个人行囊' : '库房';
  }

  function collectionForSource(source: InventorySource) {
    return source === 'satchel' ? satchel.value : inventory.value;
  }

  function canUseStorageInventoryHere() {
    return ['酒馆', '库房炉台', '农田酒窖'].includes(currentSceneType.value);
  }

  function makeRecipeIngredient(item: CraftActionItem): RecipeIngredient {
    return {
      name: item.name,
      category: item.category,
      qty: Math.max(1, Math.floor(Number(item.qty) || 1)),
      tags: [...new Set(item.tags ?? [])],
      ...(item.priceCopper ? { priceCopper: item.priceCopper } : {}),
    };
  }

  function recipeIngredientKey(item: Pick<RecipeIngredient, 'name' | 'category' | 'tags'>) {
    return `${item.name}|${item.category}|${[...new Set(item.tags)].sort().join(',')}`;
  }

  function recipeSignature(input: Pick<RecipeEntry, 'mode' | 'technique' | 'outputName' | 'outputCategory' | 'ingredients'>) {
    const ingredients = input.ingredients
      .map(item => `${recipeIngredientKey(item)}x${item.qty}`)
      .sort()
      .join(';');
    return `${input.mode}|${input.technique}|${input.outputName}|${input.outputCategory}|${ingredients}`;
  }

  function findInventoryForRecipeIngredient(ingredient: RecipeIngredient) {
    return inventory.value.find(
      item =>
        item.name === ingredient.name &&
        item.category === ingredient.category &&
        sameTagSet(item.tags, ingredient.tags),
    );
  }

  function addInventoryFromAction(item: BuyActionItem) {
    const category = normalizeInventoryCategory(item.category);
    const tags = normalizeActionTags(item, category);
    const existed = inventory.value.find(stored => stored.name === item.name && stored.category === category && sameTagSet(stored.tags, tags));
    if (existed) {
      existed.qty += item.qty;
      if (!existed.desc && item.desc) existed.desc = item.desc;
      if (!existed.priceCopper && item.priceCopper) existed.priceCopper = item.priceCopper;
      return;
    }

    inventory.value.push({
      id: `i-shop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: item.name,
      category,
      qty: item.qty,
      tags,
      desc: item.desc,
      priceCopper: item.priceCopper,
    });
  }

  function addSatchelFromAction(item: BuyActionItem) {
    const category = normalizeInventoryCategory(item.category);
    const tags = normalizeActionTags(item, category);
    addItemToCollection(satchel.value, { ...item, category, tags });
  }

  function moveInventoryItemBetweenCollections(from: InventoryItem[], to: InventoryItem[], itemId: string, qty?: number) {
    const item = from.find(entry => entry.id === itemId);
    if (!item) return { ok: false as const, message: '没有找到这件物品。' };
    const moveQty = Math.max(1, Math.min(item.qty, Math.floor(Number(qty) || item.qty)));
    addItemToCollection(to, { ...item, qty: moveQty });
    item.qty = Math.max(0, item.qty - moveQty);
    const compacted = from.filter(entry => entry.qty > 0);
    from.splice(0, from.length, ...compacted);
    return { ok: true as const, item, qty: moveQty };
  }

  function consumeItemFromSource(source: InventorySource, itemId: string, qty?: number) {
    const collection = collectionForSource(source);
    const item = collection.find(entry => entry.id === itemId);
    if (!item) return { ok: false as const, message: `${itemSourceLabel(source)}里找不到这件物品。` };
    const consumeQty = Math.max(1, Math.min(item.qty, Math.floor(Number(qty) || 1)));
    const consumedItem = clonePlain({ ...item, qty: consumeQty });
    item.qty = Math.max(0, item.qty - consumeQty);
    if (source === 'satchel') satchel.value = satchel.value.filter(entry => entry.qty > 0);
    else inventory.value = inventory.value.filter(entry => entry.qty > 0);
    return { ok: true as const, item: consumedItem, qty: consumeQty };
  }

  function craftModeLabel(mode: Extract<GameAction, { type: 'COOK_DISH' }>['mode']) {
    if (mode === 'sauce') return '做酱';
    if (mode === 'drink') return '做饮品';
    return '做菜';
  }

  function craftResultCategory(mode: Extract<GameAction, { type: 'COOK_DISH' }>['mode']): InventoryItem['category'] {
    return mode === 'drink' ? '酒水' : '成品';
  }

  function normalizeCraftItems(items: CraftActionItem[]) {
    return items
      .map(item => ({
        ...item,
        qty: Math.max(0, Math.floor(Number(item.qty) || 0)),
      }))
      .filter(item => item.qty > 0);
  }

  function validateInventorySelection(items: CraftActionItem[], options: { serveOnly?: boolean } = {}) {
    const normalized = normalizeCraftItems(items);
    if (normalized.length === 0) return { ok: false as const, message: '还没有选择可用物品。', items: normalized };
    for (const item of normalized) {
      const stored = inventory.value.find(entry => entry.id === item.id);
      if (!stored) return { ok: false as const, message: `库房里找不到「${item.name}」。`, items: normalized };
      if (options.serveOnly && !['成品', '酒水'].includes(stored.category)) {
        return { ok: false as const, message: `「${stored.name}」还不是可上桌的成品或酒水。`, items: normalized };
      }
      if (stored.qty < item.qty) {
        return { ok: false as const, message: `「${stored.name}」只剩 ${stored.qty} 份。`, items: normalized };
      }
    }
    return { ok: true as const, message: '', items: normalized };
  }

  function removeInventoryItems(items: CraftActionItem[]) {
    items.forEach(item => {
      const stored = inventory.value.find(entry => entry.id === item.id);
      if (!stored) return;
      stored.qty = Math.max(0, stored.qty - item.qty);
    });
    inventory.value = inventory.value.filter(item => item.qty > 0);
  }

  function addPendingCraftItem(
    craftId: string,
    mode: Extract<GameAction, { type: 'COOK_DISH' }>['mode'],
    technique: string,
    summary: string,
    ingredients: RecipeIngredient[],
  ) {
    const pendingName =
      mode === 'drink' ? '待命名饮品' : mode === 'sauce' ? '待命名酱料' : '待命名菜品';
    const recipeSource: RecipeSource = {
      mode,
      technique,
      ingredients: clonePlain(ingredients),
    };
    pendingCraftSources.value.unshift({ craftId, source: clonePlain(recipeSource), createdAt: Date.now() });
    pendingCraftSources.value = pendingCraftSources.value.slice(0, 12);
    inventory.value.push({
      id: craftId,
      name: pendingName,
      category: craftResultCategory(mode),
      qty: 1,
      tags: ['待判定', technique],
      quality: '无冲突',
      desc: `前端已扣除材料，等待 AI 按生成引擎命名与判定。原料：${summary}`,
      priceCopper: 0,
      recipeSource,
    });
  }

  function isPendingCraftItem(item: InventoryItem) {
    return item.name.startsWith('待命名') || item.tags.includes('待判定');
  }

  function normalizeCraftIdValue(value?: string) {
    return (value || '').replace(/[「」“”"'`\s]/g, '').trim();
  }

  function findPendingCraftItem(craftId?: string) {
    const pendingItems = inventory.value.filter(isPendingCraftItem);
    if (pendingItems.length === 0) return undefined;

    const normalizedCraftId = normalizeCraftIdValue(craftId);
    if (normalizedCraftId) {
      const exact = pendingItems.find(item => normalizeCraftIdValue(item.id) === normalizedCraftId);
      if (exact) return exact;
    }

    return pendingItems[pendingItems.length - 1];
  }

  function findPendingCraftSource(craftId?: string) {
    const normalizedCraftId = normalizeCraftIdValue(craftId);
    if (normalizedCraftId) {
      const exact = pendingCraftSources.value.find(entry => normalizeCraftIdValue(entry.craftId) === normalizedCraftId);
      if (exact) return clonePlain(exact.source);
    }
    return pendingCraftSources.value[0]?.source ? clonePlain(pendingCraftSources.value[0].source) : undefined;
  }

  function clearPendingCraftItems(exceptId?: string) {
    inventory.value = inventory.value.filter(item => !isPendingCraftItem(item) || item.id === exceptId);
  }

  function resolveCookDish(action: Extract<GameAction, { type: 'COOK_DISH' }>): ActionResult {
    const checked = validateInventorySelection(action.items);
    if (!checked.ok) return { ok: false, tone: 'red', message: checked.message };
    const summary = checked.items.map(item => `${item.name}×${item.qty}`).join('、');
    const craftId = `craft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const recipeIngredients = checked.items.map(makeRecipeIngredient);

    clearPendingCraftItems();
    removeInventoryItems(checked.items);
    addPendingCraftItem(craftId, action.mode, action.technique, summary, recipeIngredients);
    if (protagonist.cookingLevel < 8) {
      protagonist.cookingExp += 1;
      if (protagonist.cookingExp >= protagonist.cookingExpMax) {
        protagonist.cookingLevel = Math.min(8, protagonist.cookingLevel + 1);
        protagonist.cookingExp = 0;
        protagonist.cookingExpMax = Math.max(3, Math.ceil(protagonist.cookingExpMax * 1.35));
      }
    }
    markLocalStateDirty();
    void writeChatSave();

    const modeLabel = craftModeLabel(action.mode);
    pushLog('结算', `${modeLabel}材料已扣除 · ${action.technique} · ${summary}`);
    return {
      ok: true,
      tone: 'green',
      message: `${modeLabel}已记录，材料已扣除。`,
      shouldAskAI: true,
      summary,
      craftId,
      narrativeFact: `当前地点为「${currentSceneLabel()}」。玩家用「${action.technique}」${modeLabel}: ${summary}。前端已完成硬规则结算: 对应材料已经从库房扣除，并生成编号为「${craftId}」的待命名成品占位。`,
      aiHint: [
        `请根据玩家使用的做法与材料，按对应生成引擎叙述${modeLabel}过程。`,
        '请不要重新扣材料，不要改变随身钱袋或钱匣。',
        '输出顺序必须是: <maintext>制作过程叙述</maintext>，然后再输出下面的隐藏数据块，供前端把占位成品改成正式结果:',
        '<craft_result>',
        `编号: ${craftId}`,
        `类型: ${action.mode === 'drink' ? '饮品' : action.mode === 'sauce' ? '酱料' : '菜品'}`,
        '名称: 这里填写成品名',
        action.mode === 'sauce' ? '去向: 成品 / 调料 / 酒窖桶' : action.mode === 'drink' ? '去向: 酒水 / 酒窖桶' : '去向: 成品',
        '数量: 1',
        '搭配判定: 灾难级 / 严重冲突 / 轻微冲突 / 无冲突 / 经典搭配 / 绝佳搭配 / 奇迹',
        '标签: 用逗号分隔',
        '气味标签: 用逗号分隔',
        '价格: 例如 3银80铜',
        '是否可上菜: 是 / 否',
        action.mode === 'sauce' || action.mode === 'drink' ? '桶名: 若去向为酒窖桶则填写' : '',
        action.mode === 'sauce' || action.mode === 'drink' ? '开始日: 若去向为酒窖桶则填写' : '',
        action.mode === 'sauce' || action.mode === 'drink' ? '预计收获日: 若去向为酒窖桶则填写' : '',
        '描述: 一句话说明',
        '</craft_result>',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  function resolveServeDish(action: Extract<GameAction, { type: 'SERVE_DISH' }>): ActionResult {
    const checked = validateInventorySelection(action.items, { serveOnly: true });
    if (!checked.ok) return { ok: false, tone: 'red', message: checked.message };
    const targetGuest = findGuestGroup(action.guestId);
    const total = checked.items.reduce((sum, item) => {
      const stored = inventory.value.find(entry => entry.id === item.id);
      return sum + Math.max(0, stored?.priceCopper ?? item.priceCopper ?? 0) * item.qty;
    }, 0);
    const summary = checked.items.map(item => `${item.name}×${item.qty}`).join('、');
    const guestLabel = targetGuest ? `「${targetGuest.label}」` : '';
    const guestDesc = targetGuest
      ? `目标客人: ${targetGuest.label}；客人: ${targetGuest.guests || '未记录'}；此前点单: ${targetGuest.order || '未记录'}。`
      : '';

    removeInventoryItems(checked.items);
    cashboxCopper.value += total;
    if (targetGuest) {
      targetGuest.status = '用餐中';
      targetGuest.updatedAtTurn = successfulNarrationTurn.value;
      if (!targetGuest.order) targetGuest.order = summary;
    }
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `上菜完成${guestLabel ? ` · ${guestLabel}` : ''} · ${summary} · 收入 ${formatCopper(total)}，已入钱匣`);

    return {
      ok: true,
      tone: 'green',
      message: `上菜完成${guestLabel ? `，已送到${guestLabel}` : ''}，已收取 ${formatCopper(total)}。`,
      shouldAskAI: true,
      paidCopper: total,
      summary,
      narrativeFact: `当前地点为「${currentSceneLabel()}」。玩家将 ${summary} ${targetGuest ? `送到「${targetGuest.label}」` : '上桌'}。${guestDesc}前端已完成硬规则结算: 对应成品或酒水已从库房扣除，收入 ${formatCopper(total)} 已进入钱匣。`,
      aiHint: '请只叙述上菜、客人反应、气氛和酒馆里的反馈。不要重新计算价格，不要改变库房、随身钱袋或钱匣。如需要更新这桌客人的状态或备注，请输出 <guest_update> JSON 数组。',
    };
  }

  function resolveInventoryMoveCategory(action: Extract<GameAction, { type: 'INVENTORY_MOVE_CATEGORY' }>): ActionResult {
    const item = inventory.value.find(entry => entry.id === action.itemId);
    if (!item) return { ok: false, tone: 'red', message: '库房里找不到这件物品。' };
    const nextCategory = normalizeInventoryCategory(action.category);
    if (item.category === nextCategory) {
      return { ok: true, tone: 'neutral', message: `「${item.name}」已经在「${nextCategory}」。`, shouldAskAI: false };
    }

    const oldCategory = item.category;
    const existed = inventory.value.find(
      entry => entry.id !== item.id && entry.name === item.name && entry.category === nextCategory && sameTagSet(entry.tags, item.tags),
    );
    if (existed) {
      existed.qty += item.qty;
      if (!existed.priceCopper && item.priceCopper) existed.priceCopper = item.priceCopper;
      if (!existed.desc && item.desc) existed.desc = item.desc;
      inventory.value = inventory.value.filter(entry => entry.id !== item.id);
    } else {
      item.category = nextCategory;
    }

    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `整理库房 · ${item.name} · ${oldCategory} → ${nextCategory}`, {
      source: 'engine',
      authoritative: true,
      tone: 'cyan',
      actionType: 'INVENTORY_MOVE_CATEGORY',
    });
    return {
      ok: true,
      tone: 'cyan',
      message: `已把「${item.name}」整理到「${nextCategory}」。`,
      shouldAskAI: false,
      narrativeFact: `前端整理库房：「${item.name}」从「${oldCategory}」移到「${nextCategory}」。`,
    };
  }

  function applyCraftResult(result?: ParsedCraftResult) {
    if (!result?.name) return false;
    const isBarrel = /酒窖|桶|熟成|发酵|陈放/.test(result.destination);
    const pending = findPendingCraftItem(result.craftId);
    const recipeSource = pending?.recipeSource ? clonePlain(pending.recipeSource) : findPendingCraftSource(result.craftId);
    const tags = [...new Set([...result.tags, ...result.aromaTags])];

    if (isBarrel) {
      if (pending) pending.qty = 0;
      inventory.value = inventory.value.filter(item => item.qty > 0 && !isPendingCraftItem(item));
      brews.value.push({
        id: `b-craft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: result.barrelName || `${result.name}桶`,
        startedDay: calendar.day,
        matureDay: calendar.day + 3,
        expected: result.name,
        filling: `${result.type} · ${tags.join('、') || '待熟成'}`,
        brewType: result.type || '酒水',
      });
      pushLog('结算', `生成结果已入酒窖桶 · ${result.barrelName || result.name}`);
      markLocalStateDirty();
      void writeChatSave();
      return true;
    }

    const category: InventoryItem['category'] = /酒水|饮品|酒/.test(result.destination)
      ? '酒水'
      : /调料|酱料/.test(result.destination)
        ? '调料'
        : '成品';
    const quality = normalizeItemQualityLabel(result.quality);
    const item: InventoryItem = {
      id: pending?.id || `i-craft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: result.name,
      category,
      qty: result.quantity,
      tags: tags.length ? tags : ['AI生成'],
      ...(quality ? { quality } : {}),
      desc: result.description,
      priceCopper: result.priceCopper || pending?.priceCopper || undefined,
      ...(recipeSource ? { recipeSource } : {}),
    };

    if (pending) {
      Object.assign(pending, item);
      clearPendingCraftItems(pending.id);
    } else {
      clearPendingCraftItems();
      const existed = inventory.value.find(stored => stored.name === item.name && stored.category === item.category && sameTagSet(stored.tags, item.tags));
      if (existed) {
        existed.qty += item.qty;
        if (!existed.recipeSource && item.recipeSource) existed.recipeSource = clonePlain(item.recipeSource);
      }
      else inventory.value.push(item);
    }
    pushLog('结算', `生成结果已入库 · ${result.name}`);
    markLocalStateDirty();
    void writeChatSave();
    return true;
  }

  function buildRecipeFromInventoryItem(item: InventoryItem): RecipeEntry | null {
    if (!item.recipeSource?.ingredients?.length) return null;
    const now = Date.now();
    return {
      id: `recipe-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: item.name,
      mode: item.recipeSource.mode,
      technique: item.recipeSource.technique,
      ingredients: clonePlain(item.recipeSource.ingredients),
      outputName: item.name,
      outputCategory: item.category,
      outputTags: clonePlain(item.tags),
      ...(item.quality ? { outputQuality: item.quality } : {}),
      ...(item.priceCopper ? { outputPriceCopper: item.priceCopper } : {}),
      yieldQty: 1,
      createdAt: now,
      updatedAt: now,
      note: item.desc,
    };
  }

  function isRecipeSavedForItem(item: InventoryItem) {
    const recipe = buildRecipeFromInventoryItem(item);
    if (!recipe) return false;
    const signature = recipeSignature(recipe);
    return recipes.value.some(saved => recipeSignature(saved) === signature);
  }

  function saveRecipeFromInventoryItem(itemId: string) {
    const item = inventory.value.find(entry => entry.id === itemId);
    if (!item) return { ok: false as const, message: '库房里找不到这件成品。' };
    const recipe = buildRecipeFromInventoryItem(item);
    if (!recipe) return { ok: false as const, message: '这件成品缺少材料记录，暂时不能保存为配方。' };

    const signature = recipeSignature(recipe);
    const existing = recipes.value.find(saved => recipeSignature(saved) === signature);
    if (existing) {
      Object.assign(existing, {
        ...recipe,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      });
      pushLog('系统', `配方已更新 · ${recipe.name}`, { source: 'engine', authoritative: true, tone: 'cyan' });
    } else {
      recipes.value.unshift(recipe);
      pushLog('系统', `配方已保存 · ${recipe.name}`, { source: 'engine', authoritative: true, tone: 'green' });
    }
    markLocalStateDirty();
    void writeChatSave();
    return { ok: true as const, message: '配方已保存。' };
  }

  function recipeShortages(recipe: RecipeEntry, copies = 1) {
    const safeCopies = Math.max(1, Math.floor(Number(copies) || 1));
    return recipe.ingredients
      .map(ingredient => {
        const stored = findInventoryForRecipeIngredient(ingredient);
        const need = ingredient.qty * safeCopies;
        const have = stored?.qty ?? 0;
        return {
          ingredient,
          need,
          have,
          missing: Math.max(0, need - have),
        };
      })
      .filter(entry => entry.missing > 0);
  }

  function craftRecipe(recipeId: string, copies = 1) {
    const recipe = recipes.value.find(entry => entry.id === recipeId);
    if (!recipe) return { ok: false as const, message: '没有找到这条配方。', shortages: [] as ReturnType<typeof recipeShortages> };
    const safeCopies = Math.max(1, Math.floor(Number(copies) || 1));
    const shortages = recipeShortages(recipe, safeCopies);
    if (shortages.length) {
      pushLog('提示', `配方材料不足 · ${recipe.name}`, { source: 'engine', authoritative: true, tone: 'amber' });
      return { ok: false as const, message: '材料不足。', shortages };
    }

    recipe.ingredients.forEach(ingredient => {
      const stored = findInventoryForRecipeIngredient(ingredient);
      if (stored) stored.qty = Math.max(0, stored.qty - ingredient.qty * safeCopies);
    });
    inventory.value = inventory.value.filter(item => item.qty > 0);

    const outputTags = clonePlain(recipe.outputTags);
    const existed = inventory.value.find(
      item =>
        item.name === recipe.outputName &&
        item.category === recipe.outputCategory &&
        sameTagSet(item.tags, outputTags),
    );
    const outputQty = Math.max(1, recipe.yieldQty) * safeCopies;
    const recipeSource: RecipeSource = {
      mode: recipe.mode,
      technique: recipe.technique,
      ingredients: clonePlain(recipe.ingredients),
    };
    if (existed) {
      existed.qty += outputQty;
      if (recipe.outputQuality) existed.quality = recipe.outputQuality;
      if (recipe.outputPriceCopper) existed.priceCopper = recipe.outputPriceCopper;
      if (!existed.recipeSource) existed.recipeSource = recipeSource;
    } else {
      inventory.value.push({
        id: `i-recipe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: recipe.outputName,
        category: recipe.outputCategory,
        qty: outputQty,
        tags: outputTags,
        ...(recipe.outputQuality ? { quality: recipe.outputQuality } : {}),
        ...(recipe.outputPriceCopper ? { priceCopper: recipe.outputPriceCopper } : {}),
        ...(recipe.note ? { desc: recipe.note } : {}),
        recipeSource,
      });
    }
    pushLog('结算', `配方复刻 · ${recipe.name} ×${safeCopies}`, { source: 'engine', authoritative: true, tone: 'green' });
    markLocalStateDirty();
    void writeChatSave();
    return { ok: true as const, message: '制作完成。', shortages: [] as ReturnType<typeof recipeShortages> };
  }

  function deleteRecipe(recipeId: string) {
    const before = recipes.value.length;
    recipes.value = recipes.value.filter(entry => entry.id !== recipeId);
    if (recipes.value.length !== before) {
      pushLog('系统', '配方已删除。', { source: 'engine', authoritative: true, tone: 'neutral' });
      markLocalStateDirty();
      void writeChatSave();
    }
  }

  function resolveBuyItems(action: Extract<GameAction, { type: 'BUY_ITEMS' }>): ActionResult {
    if (!action.shopName.trim()) {
      return { ok: false, tone: 'red', message: '没有确认当前商铺。' };
    }
    if (!isCurrentShopLocation(action.shopName)) {
      return { ok: false, tone: 'red', message: `当前并不在「${action.shopName}」，不能从这里结账。` };
    }

    const items = action.items
      .map(item => ({
        ...item,
        qty: Math.max(0, Math.floor(Number(item.qty) || 0)),
        stock: Math.max(0, Math.floor(Number(item.stock) || 0)),
        priceCopper: Math.max(0, Math.floor(Number(item.priceCopper) || 0)),
      }))
      .filter(item => item.qty > 0);
    if (items.length === 0) return { ok: false, tone: 'amber', message: '还没有选择要购买的东西。' };

    const shortStock = items.find(item => item.qty > item.stock);
    if (shortStock) {
      return {
        ok: false,
        tone: 'red',
        message: `「${shortStock.name}」货架上只剩 ${shortStock.stock} 份。`,
      };
    }

    const total = items.reduce((sum, item) => sum + item.priceCopper * item.qty, 0);
    if (!canSpendCopper('wallet', total)) {
      return {
        ok: false,
        tone: 'red',
        message: `随身钱袋余额不足。本次需要 ${formatCopper(total)}，当前只有 ${walletText.value}。`,
      };
    }

    const stockDeltas: Record<string, number> = {};
    const summary = items.map(item => `${item.name}×${item.qty}`).join('、');
    walletCopper.value = Math.max(0, walletCopper.value - total);
    items.forEach(item => {
      addSatchelFromAction(item);
      const nextStock = Math.max(0, item.stock - item.qty);
      stockDeltas[item.id] = nextStock;
      const generatedProduct = generatedShopProducts.value.find(product => product.id === item.id);
      if (generatedProduct) generatedProduct.stock = nextStock;
    });
    markLocalStateDirty();
    void writeChatSave();

    pushLog('扣减', `采购付款 · 随身钱袋 -${formatCopper(total)}`);
    pushLog('结算', `采购装入行囊 · ${summary} · ${formatCopper(total)}`);

    const keeper = action.keeper?.trim() || '店主';
    const scene = currentSceneLabel();
    return {
      ok: true,
      tone: 'green',
      message: `已在「${action.shopName}」完成采购。`,
      shouldAskAI: true,
      paidCopper: total,
      summary,
      stockDeltas,
      narrativeFact: `当前地点仍为「${scene}」。玩家在「${action.shopName}」向${keeper}买下：${summary}；共付 ${formatCopper(total)}。前端已完成结算：随身钱袋扣除 ${formatCopper(total)}，购买物品已先装入个人行囊，尚未整理进库房；对应货架数量已减少。`,
    };
  }

  function resolveInventoryMoveToStorage(action: Extract<GameAction, { type: 'INVENTORY_MOVE_TO_STORAGE' }>): ActionResult {
    const moved = moveInventoryItemBetweenCollections(satchel.value, inventory.value, action.itemId, action.qty);
    if (!moved.ok) return { ok: false, tone: 'red', message: `个人行囊里找不到这件物品。` };
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `整理入库 · ${moved.item.name} ×${moved.qty}`);
    return {
      ok: true,
      tone: 'green',
      message: `已将「${moved.item.name}」整理入库。`,
      shouldAskAI: true,
      summary: `${moved.item.name}×${moved.qty}`,
      narrativeFact: `把行囊里的「${moved.item.name}」×${moved.qty}整理入库。`,
      settledFact: `当前位置为「${currentSceneLabel()}」。玩家把个人行囊里的「${moved.item.name}」×${moved.qty}带回并整理进库房。前端已完成结算：个人行囊减少，库房增加。`,
      aiHint: '请承接上一楼层描写动作过程；不要重新计算库存数量、随身钱袋或钱匣。',
    };
  }

  function resolveInventoryMoveToSatchel(action: Extract<GameAction, { type: 'INVENTORY_MOVE_TO_SATCHEL' }>): ActionResult {
    const moved = moveInventoryItemBetweenCollections(inventory.value, satchel.value, action.itemId, action.qty);
    if (!moved.ok) return { ok: false, tone: 'red', message: `库房里找不到这件物品。` };
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `取出到行囊 · ${moved.item.name} ×${moved.qty}`);
    return {
      ok: true,
      tone: 'green',
      message: `已将「${moved.item.name}」取出到行囊。`,
      shouldAskAI: true,
      summary: `${moved.item.name}×${moved.qty}`,
      narrativeFact: `从库房取出「${moved.item.name}」×${moved.qty}，装进行囊。`,
      settledFact: `当前位置为「${currentSceneLabel()}」。玩家从库房取出「${moved.item.name}」×${moved.qty}并装入个人行囊。前端已完成结算：库房减少，个人行囊增加。`,
      aiHint: '请承接上一楼层描写动作过程；不要重新计算库存数量、随身钱袋或钱匣。',
    };
  }

  function resolveUseItem(action: Extract<GameAction, { type: 'USE_ITEM' }>): ActionResult {
    const source = action.source;
    if (source === 'storage' && !canUseStorageInventoryHere()) {
      return {
        ok: false,
        tone: 'red',
        message: '当前不在酒馆内，不能直接使用库房物品。请使用个人行囊里的物品，或先回酒馆。',
      };
    }
    const consumed = consumeItemFromSource(source, action.itemId, action.qty);
    if (!consumed.ok) return { ok: false, tone: 'red', message: consumed.message };
    const item = consumed.item;
    const target = action.target?.trim() || protagonist.name || '主角';
    const note = action.note?.trim();
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `使用物品 · ${itemSourceLabel(source)} · ${item.name} ×${consumed.qty}`);
    return {
      ok: true,
      tone: 'green',
      message: `已使用「${item.name}」。`,
      shouldAskAI: true,
      summary: `${item.name}×${consumed.qty}`,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家从${itemSourceLabel(source)}使用「${item.name}」×${consumed.qty}，目标是「${target}」。前端已完成结算：对应物品数量已减少。${note ? `玩家补充意图：${note}` : ''}`,
      aiHint: [
        '请承接上一楼层，叙述使用物品的动作、感受和现场反应。',
        '如果该物品产生明确短期影响，请在 <UpdateVariable> 的 <JSONPatch> 中插入临时状态。',
        '临时状态只使用字段: 名称、剩余回合、描述、来源物品。',
        '剩余回合表示从当前回合开始还能持续几个叙事回合，必须写正整数；回合结束后的倒计时由前端自动处理，不要手动给已有状态减回合。',
        `示例: { "op": "insert", "path": "/临时状态/主角/-", "value": { "名称": "力大如牛", "剩余回合": 3, "描述": "${target}短时间内力量明显增强。", "来源物品": "${item.name}" } }`,
        '可写入路径: /临时状态/主角/-、/临时状态/酒馆/-、/临时状态/酒馆区域/区域名/-、/临时状态/人物/人物名/-。',
        '普通吃喝、试用或没有持续影响时，可以只叙事，不必强行生成状态。',
      ].join('\n'),
    };
  }

  function snapshotLocation(): LocationSnapshot {
    return {
      region: location.region,
      place: location.place,
      protagonistLocated: protagonist.located,
      sceneType: currentSceneType.value,
      relatedName: generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? generatedShop.value.name : undefined,
    };
  }

  function inventoryQuantityMap() {
    const map = new Map<string, { id: string; name: string; category: InventoryItem['category']; qty: number }>();
    inventory.value.forEach(item => {
      const key = `${item.id}::${item.category}::${item.name}`;
      map.set(key, { id: item.id, name: item.name, category: item.category, qty: item.qty });
    });
    return map;
  }

  function summarizeInventoryChanges(before: Map<string, { id: string; name: string; category: InventoryItem['category']; qty: number }>) {
    const after = inventoryQuantityMap();
    const keys = new Set([...before.keys(), ...after.keys()]);
    return [...keys]
      .map(key => {
        const oldItem = before.get(key);
        const newItem = after.get(key);
        const delta = (newItem?.qty ?? 0) - (oldItem?.qty ?? 0);
        if (!delta) return null;
        return {
          id: newItem?.id ?? oldItem?.id,
          name: newItem?.name ?? oldItem?.name ?? key,
          category: newItem?.category ?? oldItem?.category,
          delta,
        };
      })
      .filter(Boolean) as NonNullable<ActionResult['inventoryChanges']>;
  }

  function pageSuggestionForAction(action: GameAction): TabId | undefined {
    if (['FIND_SHOP', 'VISIT_SHOP', 'BUY_ITEMS'].includes(action.type)) return 'shop';
    if (['FARM_PLANT', 'FARM_EXPAND', 'FARM_REMOVE', 'FARM_HARVEST', 'BREW_TAP'].includes(action.type)) return 'farm';
    if (['COOK_DISH', 'SERVE_DISH', 'INVENTORY_MOVE_CATEGORY', 'INVENTORY_MOVE_TO_STORAGE', 'INVENTORY_MOVE_TO_SATCHEL', 'USE_ITEM'].includes(action.type)) return 'inventory';
    if (['FACILITY_ADD', 'TAVERN_FAST_FORWARD', 'BUSINESS_TOGGLE', 'REGION_CLEAN', 'WORKER_ASSIGN'].includes(action.type)) return 'tavern';
    if (['MONEY_TRANSFER', 'DEBUG_CURRENCY'].includes(action.type)) return 'ledger';
    if (['MAP_TRAVEL'].includes(action.type)) return 'map';
    if (['CHARACTER_CHAT', 'CHARACTER_GIFT'].includes(action.type)) return 'characters';
    if (['PROTAGONIST_TRAIN_COOKING'].includes(action.type)) return 'protagonist';
    return undefined;
  }

  function snapshotTime() {
    const daySerial = currentCalendarDay();
    const clockMinutes = clockToMinutes(calendar.clock);
    const month = months[calendar.monthIndex] ?? '';
    return {
      absoluteMinutes: daySerial * 24 * 60 + clockMinutes,
      label: `${month} 第${calendar.day}日 · ${currentTimeOfDay.value} · ${calendar.clock}`,
    };
  }

  function enrichActionResult(action: GameAction, result: ActionResult, before: {
    money: number;
    wallet: number;
    cashbox: number;
    inventory: Map<string, { id: string; name: string; category: InventoryItem['category']; qty: number }>;
    location: LocationSnapshot;
    time: ReturnType<typeof snapshotTime>;
  }): ActionResult {
    const moneyDeltaCopper = treasuryCopper.value - before.money;
    const inventoryChanges = summarizeInventoryChanges(before.inventory);
    const afterLocation = snapshotLocation();
    const afterTime = snapshotTime();
    const timeDelta = Math.max(0, afterTime.absoluteMinutes - before.time.absoluteMinutes);
    const locationChanged =
      before.location.region !== afterLocation.region ||
      before.location.place !== afterLocation.place ||
      before.location.protagonistLocated !== afterLocation.protagonistLocated ||
      before.location.sceneType !== afterLocation.sceneType ||
      before.location.relatedName !== afterLocation.relatedName;

    return {
      ...result,
      actionType: result.actionType ?? action.type,
      pageSuggestion: result.pageSuggestion ?? pageSuggestionForAction(action),
      moneyDeltaCopper: result.moneyDeltaCopper ?? (moneyDeltaCopper || undefined),
      timeAdvancedMinutes: result.timeAdvancedMinutes ?? (timeDelta || undefined),
      timeChange: result.timeChange ?? (timeDelta ? { minutes: timeDelta, from: before.time.label, to: afterTime.label } : undefined),
      inventoryChanges: result.inventoryChanges ?? (inventoryChanges.length ? inventoryChanges : undefined),
      locationChange: result.locationChange ?? (locationChanged ? { from: before.location, to: afterLocation } : undefined),
    };
  }

  function dispatchAction(action: GameAction): ActionResult {
    const timeBefore = snapshotTime();
    lastTickAt.value = Date.now();
    const before = {
      money: treasuryCopper.value,
      wallet: walletCopper.value,
      cashbox: cashboxCopper.value,
      inventory: inventoryQuantityMap(),
      location: snapshotLocation(),
      time: timeBefore,
    };
    const result = dispatchByType<GameAction, ActionResult>(
      action,
      {
        FIND_SHOP: resolveFindShop,
        VISIT_SHOP: resolveVisitShop,
        LEAVE_SHOP: resolveLeaveShop,
        FARM_PLANT: resolveFarmPlant,
        FARM_EXPAND: () => resolveFarmExpand(),
        FARM_REMOVE: resolveFarmRemove,
        FARM_HARVEST: resolveFarmHarvest,
        BREW_TAP: resolveBrewTap,
        FACILITY_ADD: resolveFacilityAdd,
        TAVERN_FAST_FORWARD: resolveTavernFastForward,
        BUSINESS_TOGGLE: resolveBusinessToggle,
        REGION_CLEAN: resolveRegionClean,
        WORKER_ASSIGN: resolveWorkerAssign,
        MAP_TRAVEL: resolveMapTravel,
        CHARACTER_CHAT: resolveCharacterChat,
        CHARACTER_GIFT: resolveCharacterGift,
        PROTAGONIST_TRAIN_COOKING: resolveProtagonistTrainCooking,
        CUSTOM_ACTION: resolveCustomAction,
        MONEY_TRANSFER: resolveMoneyTransfer,
        DEBUG_CURRENCY: resolveDebugCurrency,
        DEBUG_STAT: resolveDebugStat,
        BUY_ITEMS: resolveBuyItems,
        INVENTORY_MOVE_TO_STORAGE: resolveInventoryMoveToStorage,
        INVENTORY_MOVE_TO_SATCHEL: resolveInventoryMoveToSatchel,
        USE_ITEM: resolveUseItem,
        COOK_DISH: resolveCookDish,
        SERVE_DISH: resolveServeDish,
        INVENTORY_MOVE_CATEGORY: resolveInventoryMoveCategory,
      },
      () => ({ ok: false, tone: 'red', message: '未知动作。' }),
    );
    return enrichActionResult(action, result, before);
  }

  function snapshotLocalSettlement(): LocalSettlementSnapshot {
    syncProtagonistEnergyFromStore();
    return {
      calendar: {
        year: calendar.year,
        monthIndex: calendar.monthIndex,
        day: calendar.day,
        timeOfDay: calendar.timeOfDay,
        clock: calendar.clock,
        weather: calendar.weather,
        weatherIcon: calendar.weatherIcon,
        weatherDescription: calendar.weatherDescription,
        weatherDaySerial: calendar.weatherDaySerial,
      },
      location: snapshotLocation(),
      tavernName: tavernName.value,
      treasuryCopper: treasuryCopper.value,
      walletCopper: walletCopper.value,
      cashboxCopper: cashboxCopper.value,
      reputation: reputation.value,
      energy: { value: energy.value, max: energy.max },
      protagonist: clonePlain(protagonist),
      business: businessStateSnapshot(),
      guestGroups: clonePlain(guestGroups.value),
      regions: clonePlain(regions.value),
      heroines: clonePlain(heroines.value),
      tavernNpcActivities: clonePlain(tavernNpcActivities.value),
      lastNpcActivityMinute: lastNpcActivityMinute.value,
      lastNpcActivityTurn: lastNpcActivityTurn.value,
      successfulNarrationTurn: successfulNarrationTurn.value,
      npcActivityKeepTurns: npcActivityKeepTurns.value,
      npcActivityEnabled: npcActivityEnabled.value,
      npcActivityWorldbookLibrary: npcActivityWorldbookLibrary.value ? clonePlain(npcActivityWorldbookLibrary.value) : null,
      npcActivityWorldbookBindings: clonePlain(npcActivityWorldbookBindings.value),
      weatherWorldbookLibrary: weatherWorldbookLibrary.value ? clonePlain(weatherWorldbookLibrary.value) : null,
      weatherWorldbookBindings: clonePlain(weatherWorldbookBindings.value),
      weatherWorldbookStatus: weatherWorldbookStatus.value,
      weatherWorldbookErrors: clonePlain(weatherWorldbookErrors.value),
      turnContextWorldbookBinding: turnContextWorldbookBinding.value ? clonePlain(turnContextWorldbookBinding.value) : null,
      turnContextWorldbookStatus: turnContextWorldbookStatus.value,
      characterWorldbookBindings: clonePlain(characterWorldbookBindings.value),
      characterBehaviorLibraries: clonePlain(characterBehaviorLibraries.value),
      inventory: clonePlain(inventory.value),
      satchel: clonePlain(satchel.value),
      temporaryStates: clonePlain(temporaryStates.value),
      promiseMemos: clonePlain(promiseMemos.value),
      recipes: clonePlain(recipes.value),
      generatedShop: generatedShop.value ? clonePlain(generatedShop.value) : null,
      generatedShopProducts: clonePlain(generatedShopProducts.value),
      farmPlots: clonePlain(farmPlots.value),
      brews: clonePlain(brews.value),
      pendingCraftSources: clonePlain(pendingCraftSources.value),
      lastShopRefreshDay: lastShopRefreshDay.value,
      currentTab: currentTab.value,
    };
  }

  async function restoreLocalSettlement(snapshot: LocalSettlementSnapshot, reason: string) {
    calendar.year = snapshot.calendar.year;
    calendar.monthIndex = snapshot.calendar.monthIndex;
    calendar.day = snapshot.calendar.day;
    calendar.timeOfDay = snapshot.calendar.timeOfDay as TimeOfDay;
    calendar.clock = snapshot.calendar.clock;
    calendar.weather = snapshot.calendar.weather;
    calendar.weatherIcon = snapshot.calendar.weatherIcon;
    calendar.weatherDescription = snapshot.calendar.weatherDescription ?? calendar.weatherDescription;
    calendar.weatherDaySerial = snapshot.calendar.weatherDaySerial ?? calendar.weatherDaySerial;
    location.region = snapshot.location.region;
    location.place = snapshot.location.place;
    tavernName.value = snapshot.tavernName;
    walletCopper.value = normalizeCopperValue(snapshot.walletCopper ?? snapshot.treasuryCopper);
    cashboxCopper.value = normalizeCopperValue(snapshot.cashboxCopper ?? 0);
    reputation.value = snapshot.reputation;
    energy.value = snapshot.energy.value;
    energy.max = snapshot.energy.max;
    Object.assign(protagonist, clonePlain(snapshot.protagonist));
    protagonist.race = protagonist.race || '人类';
    syncProtagonistEnergyFromStore();
    const business = normalizeBusinessState(snapshot.business);
    isBusinessOpen.value = business.isOpen;
    guestCap.value = business.guestCap;
    visitorChance.value = business.visitorChance;
    currentGuests.value = Math.min(business.currentGuests, business.guestCap);
    lastVisitorSeed.value = business.lastVisitorSeed;
    guestGroups.value = normalizeGuestGroups(snapshot.guestGroups);
    regions.value = clonePlain(snapshot.regions);
    heroines.value = clonePlain(snapshot.heroines);
    tavernNpcActivities.value = clonePlain(snapshot.tavernNpcActivities);
    lastNpcActivityMinute.value = snapshot.lastNpcActivityMinute;
    lastNpcActivityTurn.value = snapshot.lastNpcActivityTurn;
    successfulNarrationTurn.value = snapshot.successfulNarrationTurn;
    npcActivityKeepTurns.value = safeNpcActivityKeepTurns(snapshot.npcActivityKeepTurns);
    npcActivityEnabled.value = snapshot.npcActivityEnabled;
    npcActivityWorldbookLibrary.value = snapshot.npcActivityWorldbookLibrary ? clonePlain(snapshot.npcActivityWorldbookLibrary) : null;
    npcActivityWorldbookBindings.value = clonePlain(snapshot.npcActivityWorldbookBindings);
    weatherWorldbookLibrary.value = snapshot.weatherWorldbookLibrary ? clonePlain(snapshot.weatherWorldbookLibrary) : null;
    weatherWorldbookBindings.value = clonePlain(snapshot.weatherWorldbookBindings);
    weatherWorldbookStatus.value = snapshot.weatherWorldbookStatus;
    weatherWorldbookErrors.value = clonePlain(snapshot.weatherWorldbookErrors);
    turnContextWorldbookBinding.value = snapshot.turnContextWorldbookBinding ? clonePlain(snapshot.turnContextWorldbookBinding) : null;
    turnContextWorldbookStatus.value = snapshot.turnContextWorldbookStatus;
    characterWorldbookBindings.value = clonePlain(snapshot.characterWorldbookBindings);
    characterBehaviorLibraries.value = clonePlain(snapshot.characterBehaviorLibraries);
    inventory.value = clonePlain(snapshot.inventory);
    satchel.value = clonePlain(snapshot.satchel);
    temporaryStates.value = normalizeTemporaryStateTree(snapshot.temporaryStates);
    promiseMemos.value = normalizePromiseMemoList(snapshot.promiseMemos);
    recipes.value = clonePlain(snapshot.recipes);
    generatedShop.value = snapshot.generatedShop ? clonePlain(snapshot.generatedShop) : null;
    generatedShopProducts.value = clonePlain(snapshot.generatedShopProducts);
    farmPlots.value = clonePlain(snapshot.farmPlots);
    brews.value = clonePlain(snapshot.brews);
    pendingCraftSources.value = clonePlain(snapshot.pendingCraftSources ?? []);
    lastShopRefreshDay.value = snapshot.lastShopRefreshDay;
    currentTab.value = snapshot.currentTab;
    markLocalStateDirty();
    await writeChatSave();
    pushLog('提示', reason, {
      source: 'engine',
      authoritative: true,
      tone: 'amber',
      actionType: 'BUY_ITEMS_ROLLBACK',
    });
  }

  async function executePseudoZeroAction(action: GameAction, narrative?: PseudoZeroNarrativeOptions): Promise<ActionResult> {
    const rollbackSnapshot = narrative?.autoSend || narrative?.preserveLocalState ? snapshotLocalSettlement() : null;
    const result = dispatchAction(action);
    if (!result.ok) {
      pushLog('提示', result.message, {
        source: 'engine',
        authoritative: true,
        tone: 'red',
        actionType: action.type,
      });
      return result;
    }

    await writeChatSave();
    if (!narrative) return result;
    if (result.shouldAskAI === false) return result;

    const resultHint = result.aiHint?.trim() === '无需生成正文。' && narrative.aiHint?.trim() ? '' : (result.aiHint?.trim() ?? '');
    const narrativeHint = narrative.aiHint?.trim() ?? '';
    const combinedAiHint =
      [resultHint, narrativeHint].filter(Boolean).join('\n\n补充要求:\n') ||
      '请承接上一楼层进行 AIRP 叙述。若行动自然影响状态，请通过 MVU/变量体现；地点变化只通过 MVU 地点补丁表达。';

    const isCustomNarrative = action.type === 'CUSTOM_ACTION';
    const narrativeOk = await runStoryAction({
      type: narrative.type ?? (action.type as StoryActionType),
      title: narrative.title,
      fact: isCustomNarrative ? result.summary ?? result.message : result.narrativeFact ?? result.message,
      settledFact: result.settledFact,
      aiHint: combinedAiHint,
      timeChange: result.timeChange,
      logText: narrative.logText,
      autoSend: narrative.autoSend,
      preserveLocalState: narrative.preserveLocalState,
      settled: narrative.settled ?? !isCustomNarrative,
      undoPatch:
        rollbackSnapshot && !narrative.autoSend
          ? {
              type: 'LOCAL_SETTLEMENT',
              snapshot: rollbackSnapshot,
              reason: '已撤销本回合前端结算：库房、行囊、资金、客人状态和临时成品已恢复到行动前。',
              actionType: action.type,
            }
          : undefined,
    });
    if (rollbackSnapshot && !narrativeOk) {
      const rollbackReason =
        action.type === 'BUY_ITEMS'
          ? 'AI生成失败，采购结算已撤销：随身钱袋、行囊和货架已恢复到付款前。'
          : 'AI生成失败，本回合前端预结算已撤销，状态已恢复到发送前。';
      await restoreLocalSettlement(rollbackSnapshot, rollbackReason);
      return {
        ...result,
        ok: false,
        tone: 'red',
        message: rollbackReason,
      };
    }
    return result;
  }

  function isCurrentShopLocation(shopName?: string) {
    const expectedName = shopName?.trim();
    const currentShopName = generatedShop.value?.name?.trim();
    const variableShopName = currentVariableShopName.value.trim();
    const variablePlaceText = currentVariablePlaceText.value.trim();
    const placeText = currentPlaceText();

    if (variableShopName) {
      if (expectedName) return expectedName === variableShopName || variablePlaceMatchesShopName(expectedName, variableShopName);
      if (currentShopName) return currentShopName === variableShopName || variablePlaceMatchesShopName(currentShopName, variableShopName);
      return true;
    }
    if (variablePlaceText) {
      if (expectedName) return variablePlaceMatchesShopName(expectedName, variablePlaceText);
      if (currentShopName) return variablePlaceMatchesShopName(currentShopName, variablePlaceText);
      return false;
    }
    if (expectedName && shopNameMatchesPlace(expectedName, placeText)) return true;
    if (!expectedName && currentShopName && shopNameMatchesPlace(currentShopName, placeText)) return true;
    if (expectedName) return false;
    return isShopLikePlace(placeText);
  }

  function syncGeneratedShopWithLocation(messageId?: number) {
    sanitizeCurrentLocation();
    if (!generatedShop.value) return false;
    if (isCurrentShopLocation(generatedShop.value.name)) return true;

    const staleShopName = generatedShop.value.name;
    clearGeneratedShop({ silent: true });
    if (messageId !== undefined) {
      pushLog('系统', `楼层 #${messageId} 的地点已不在「${staleShopName}」，临时货架已隐藏。`, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
        actionType: 'SYNC_SHOP_LOCATION',
      });
    }
    return false;
  }

  function normalizeStreetEntranceLabel(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '街坊街口';
    const region = location.region || '';
    return region && trimmed.startsWith(`${region} ·`) ? trimmed.replace(`${region} ·`, '').trim() : trimmed;
  }

  function resolveFindShop(action: Extract<GameAction, { type: 'FIND_SHOP' }>): ActionResult {
    const target = action.target.trim();
    if (!target) return { ok: false, tone: 'amber', message: '还没有写想找什么地方。' };
    const destination = normalizeStreetEntranceLabel(action.streetEntrance);
    setCurrentPlace(destination);
    markLocalStateDirty();
    void writeChatSave();

    const fact = `去找${target}。`;
    const shelfRange = isMarketDay.value ? '12到16项' : '6到10项';
    const marketShopHint = isMarketDay.value
      ? '今天是市日：可以加入临时摊位、外来商贩、货车、季节货、路过行商带来的少量异地货；货架应比平日更丰富，但仍围绕玩家寻找目标。'
      : '今天不是市日：货架保持日常规模，商品集中围绕玩家寻找目标，不要铺得过满。';
    return {
      ok: true,
      tone: 'green',
      message: `正在街坊里寻找「${target}」。`,
      shouldAskAI: true,
      summary: target,
      narrativeFact: fact,
      aiHint: [
        `本回合重点: 玩家正在寻找与「${target}」相关的店铺、摊位、临时货车或可交易场所。`,
        marketShopHint,
        '正文里可以写发现、靠近、打招呼、观察货架或场所气氛，但必须自然承接上一楼层末尾。',
        '请额外输出一个 <shop> 数据块供前端读取。',
        `必须严格使用下面格式，货架给${shelfRange}:`,
        '<shop>',
        '店名: 商铺名',
        '店主: 店主名',
        '描述: 一句话描述商铺环境',
        '货架:',
        '- 商品名 | 分类 | 价格 | 余数量 | 标签: 标签1、标签2 | 描述: 一句话商品描述',
        '</shop>',
        '分类只能写: 食材、调料、酒水、成品、杂物。价格例: 76铜、1银20铜。',
      ].join('\n'),
    };
  }

  function resolveVisitShop(action: Extract<GameAction, { type: 'VISIT_SHOP' }>): ActionResult {
    const shopName = action.shopName.trim();
    if (!shopName) return { ok: false, tone: 'amber', message: '没有确认要去的商铺。' };
    const keeper = action.keeper?.trim() || '店主';
    setCurrentPlace(shopName, { keepShop: true });
    markLocalStateDirty();
    void writeChatSave();

    return {
      ok: true,
      tone: 'green',
      message: `已进入「${shopName}」。`,
      shouldAskAI: true,
      summary: shopName,
      narrativeFact: `玩家承接上一楼层与当前场景，已进入「${shopName}」。前端已将当前位置结算为「${currentSceneLabel()}」。店主是${keeper}。完整货架以本层 stat_data.街坊商铺 为准。`,
      aiHint: `本回合重点: 描写玩家进入「${shopName}」后的环境、${keeper}的招呼，并自然引导玩家挑选。不要刷新货架，不要改变随身钱袋、钱匣或库房。`,
    };
  }

  function resolveLeaveShop(action: Extract<GameAction, { type: 'LEAVE_SHOP' }>): ActionResult {
    const destination = normalizeStreetEntranceLabel(action.destination);
    clearGeneratedShop({ silent: true });
    setCurrentPlace(destination);
    markLocalStateDirty();
    void writeChatSave();
    return {
      ok: true,
      tone: 'green',
      message: `已离开「${action.shopName}」。`,
      shouldAskAI: false,
      narrativeFact: `玩家离开「${action.shopName}」，回到「${destination}」。接下来的行动承接当前位置，不是从酒馆或其他默认地点重新出门。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveFarmPlant(action: Extract<GameAction, { type: 'FARM_PLANT' }>): ActionResult {
    const plot = farmPlots.value.find(item => item.id === action.plotId);
    const seed = inventory.value.find(item => item.id === action.seedId);
    if (!plot) return { ok: false, tone: 'red', message: '没有找到这块田畦。' };
    if (!seed || seed.qty <= 0) return { ok: false, tone: 'red', message: '这份种子已经没有了。' };
    const plantedDay = currentCalendarDay();
    seed.qty -= 1;
    plot.crop = action.crop;
    plot.stage = 1;
    plot.expectedHarvest = action.expectedHarvest;
    plot.season = '新播种';
    plot.batchTags = seed.tags ?? [];
    plot.plantedDay = plantedDay;
    plot.matureDay = plantedDay + Math.max(1, plot.stageMax - plot.stage);
    plot.readyNotified = false;
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `播种完成 · 第${plot.id.slice(2)}号畦 · ${seed.name}`);
    return {
      ok: true,
      tone: 'green',
      message: `第${plot.id.slice(2)}号畦已播下「${seed.name}」。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家在农田与酒窖的第${plot.id.slice(2)}号畦播下「${seed.name}」，种子消耗1份，记为「${action.crop}」。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveFarmExpand(): ActionResult {
    const next = farmPlots.value.length + 1;
    farmPlots.value.push({
      id: `f-${next}`,
      crop: '空畦',
      stage: 0,
      stageMax: 5,
      season: '尚未种植',
      expectedHarvest: '选择种子播种',
      batchTags: [],
      plantedDay: undefined,
      matureDay: undefined,
    });
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `后院新增第${next}号空畦。`);
    return {
      ok: true,
      tone: 'green',
      message: `已开拓第${next}号新畦。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家在农田与酒窖开拓第${next}号新畦，暂未播种。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveFarmRemove(action: Extract<GameAction, { type: 'FARM_REMOVE' }>): ActionResult {
    const plot = farmPlots.value.find(item => item.id === action.plotId);
    if (!plot) return { ok: false, tone: 'red', message: '没有找到这块田畦。' };
    if (plot.stage !== 0) return { ok: false, tone: 'red', message: '只有空畦可以撤去。' };
    farmPlots.value = farmPlots.value.filter(item => item.id !== action.plotId);
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `已撤去第${plot.id.slice(2)}号空畦。`);
    return {
      ok: true,
      tone: 'green',
      message: `已撤去第${plot.id.slice(2)}号空畦。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家撤去第${plot.id.slice(2)}号空畦，暂时不再使用这块种植位。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveFarmHarvest(action: Extract<GameAction, { type: 'FARM_HARVEST' }>): ActionResult {
    const plot = farmPlots.value.find(item => item.id === action.plotId);
    if (!plot) return { ok: false, tone: 'red', message: '没有找到这块田畦。' };
    if (plot.stage < plot.stageMax) return { ok: false, tone: 'amber', message: '这块田畦还没到收获的时候。' };
    const sourceCrop = plot.crop;
    addInventoryBatch({
      name: action.resultName,
      category: '食材',
      qty: action.quantity,
      tags: ['菜园收成', ...action.tags],
      desc: `从第${plot.id.slice(2)}号畦刚收下的自产批次。原食材：${sourceCrop}；批次标签：${action.tags.join('、')}；${plot.expectedHarvest}。标签只影响风味倾向，不改变食材分类。`,
      priceCopper: action.priceCopper,
    });
    plot.stage = 0;
    plot.crop = '空畦';
    plot.expectedHarvest = '点击翻土播种';
    plot.season = '尚未种植';
    plot.batchTags = [];
    plot.plantedDay = undefined;
    plot.matureDay = undefined;
    markLocalStateDirty();
    void writeChatSave();
    pushLog('奖励', `${action.resultName}×${action.quantity} 已同步入库 · 标签: ${action.tags.join('、')}`);
    return {
      ok: true,
      tone: 'green',
      message: `已收获「${action.resultName}」×${action.quantity}。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家收成农田与酒窖第${plot.id.slice(2)}号畦的「${sourceCrop}」${action.quantity}份，同批带有「${action.tags.join('」「')}」倾向，抖去泥土后以「${action.resultName}」记入库房。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveBrewTap(action: Extract<GameAction, { type: 'BREW_TAP' }>): ActionResult {
    const barrel = brews.value.find(item => item.id === action.barrelId);
    if (!barrel) return { ok: false, tone: 'red', message: '没有找到这只酒桶。' };
    addInventoryBatch({
      name: barrel.name,
      category: '酒水',
      qty: action.bottles,
      tags: ['酒窖开桶', '可上桌'],
      quality: '无冲突',
      desc: `从酒窖开桶灌装。${action.quality}。`,
      priceCopper: action.priceCopper,
    });
    brews.value = brews.value.filter(item => item.id !== action.barrelId);
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `${barrel.name}×${action.bottles} 已同步入库。`);
    return {
      ok: true,
      tone: 'green',
      message: `${barrel.name} 已开桶灌装。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家在农田与酒窖开启「${barrel.name}」桶，灌装${action.bottles}瓶后送入库房。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveFacilityAdd(action: Extract<GameAction, { type: 'FACILITY_ADD' }>): ActionResult {
    const region = regions.value.find(item => item.id === action.regionId);
    if (!region) return { ok: false, tone: 'red', message: '没有找到目标区域。' };
    const room = action.roomId ? region.rooms?.find(item => item.id === action.roomId) : undefined;
    if (action.roomId && !room) return { ok: false, tone: 'red', message: '没有找到目标房间。' };
    const priceCopper = Math.max(0, Math.floor(action.facility.priceCopper ?? 0));
    if (!canSpendCopper('cashbox', priceCopper)) {
      return { ok: false, tone: 'red', message: `钱匣余额不足。本次需要 ${formatCopper(priceCopper)}，当前只有 ${cashboxText.value}。` };
    }
    const facility: RegionFacility = {
      id: action.facility.id || `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: action.facility.name,
      style: action.facility.style,
      condition: action.facility.condition,
      description: action.facility.description,
      priceCopper,
    };
    if (room) room.facilities.push(facility);
    else region.facilities.push(facility);
    if (priceCopper) cashboxCopper.value = Math.max(0, cashboxCopper.value - priceCopper);
    markLocalStateDirty();
    void writeChatSave();
    const targetName = room ? `${region.name} · ${room.name}` : region.name;
    pushLog('结算', `添置完成 · ${targetName} · ${facility.name} · ${formatCopper(priceCopper)}`);
    return {
      ok: true,
      tone: 'green',
      message: `已在「${targetName}」添置「${facility.name}」。`,
      shouldAskAI: false,
      paidCopper: priceCopper,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家在「${targetName}」添置新设施「${facility.name}」，花费 ${formatCopper(priceCopper)}，由钱匣支出。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveTavernFastForward(action: Extract<GameAction, { type: 'TAVERN_FAST_FORWARD' }>): ActionResult {
    const factor = { 低调: 0.6, 正常: 1, 热闹: 1.5, 通宵: 2.2 }[action.intensity] ?? 1;
    const customers = Math.floor(action.hours * 7 * factor);
    const incomeCopper = Math.floor(action.hours * 1_200 * factor);
    const timeResult = advanceWorldTimeByGameHours(action.hours, `经营快进 · ${action.intensity}`);
    cashboxCopper.value += incomeCopper;
    reputation.value = Math.min(100, reputation.value + Math.floor(factor * 2));
    energy.value = Math.max(0, energy.value - Math.floor(action.hours * 4 * factor));
    protagonist.energy = energy.value;
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `经营快进 ${action.hours} 小时 · ${action.intensity} · 钱匣 +${formatCopper(incomeCopper)}`);
    return {
      ok: true,
      tone: 'green',
      message: `经营快进完成，净入约 ${formatCopper(incomeCopper)}。`,
      shouldAskAI: false,
      paidCopper: incomeCopper,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。「${tavernName.value}」经历 ${action.hours} 小时的「${action.intensity}」经营，统一时间心跳已推进 ${timeResult.advancedMinutes} 分钟，估接待 ${customers} 位访客，净入约 ${formatCopper(incomeCopper)} 并进入钱匣，声望小幅上升。${timeResult.logs.length > 1 ? `同时发生: ${timeResult.logs.slice(1).map(log => log.text).join('；')}` : ''}`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveBusinessToggle(action: Extract<GameAction, { type: 'BUSINESS_TOGGLE' }>): ActionResult {
    const wasOpen = isBusinessOpen.value;
    isBusinessOpen.value = action.open;
    if (!action.open) {
      currentGuests.value = 0;
      lastVisitorSeed.value = '';
    }
    markLocalStateDirty();
    void writeChatSave();
    const stateText = action.open ? '开始营业' : '歇业收店';
    pushLog('结算', `${tavernName.value} · ${stateText}`);
    return {
      ok: true,
      tone: action.open ? 'green' : 'amber',
      message: action.open ? '酒馆已开始营业。' : '酒馆已歇业。',
      shouldAskAI: false,
      narrativeFact: action.open
        ? `当前位置为「${currentSceneLabel()}」。玩家正式打开「${tavernName.value}」开始营业。前端已把营业状态切换为开启，当前客流 ${currentGuests.value}/${guestCap.value}，来客率 ${visitorChance.value}%。此前营业状态为${wasOpen ? '已营业' : '未营业'}。`
        : `当前位置为「${currentSceneLabel()}」。玩家让「${tavernName.value}」歇业收店。前端已把营业状态切换为关闭，并清空当前客流记录。此前营业状态为${wasOpen ? '已营业' : '未营业'}。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveRegionClean(action: Extract<GameAction, { type: 'REGION_CLEAN' }>): ActionResult {
    const region = regions.value.find(item => item.id === action.regionId);
    if (!region) return { ok: false, tone: 'red', message: '没有找到目标区域。' };
    region.condition = '整洁';
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `清扫维护完成 · ${region.name}`);
    return {
      ok: true,
      tone: 'green',
      message: `已为「${region.name}」做基础清扫与维护。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。后勤为「${region.name}」做了基础清扫与维护，状态恢复整洁。此为派工结算，不代表玩家本人被强制移动。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveWorkerAssign(action: Extract<GameAction, { type: 'WORKER_ASSIGN' }>): ActionResult {
    const heroine = heroines.value.find(item => item.id === action.heroineId);
    const region = regions.value.find(item => item.id === action.regionId);
    if (!heroine || !region) return { ok: false, tone: 'red', message: '没有找到员工或目标区域。' };
    const previous = regions.value.find(item => item.staff?.includes(heroine.name));
    if (previous && previous.id !== region.id) previous.staff = undefined;
    region.staff = heroine.name;
    heroine.located = region.name;
    markLocalStateDirty();
    void writeChatSave();
    const facilityCount = region.facilities.length + (region.rooms?.reduce((sum, room) => sum + room.facilities.length, 0) ?? 0);
    pushLog('结算', `${heroine.name} 已分配到 ${region.name}。`);
    return {
      ok: true,
      tone: 'green',
      message: `${heroine.name} 已分配到「${region.name}」。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家安排${heroine.name}前往「${region.name}」当值。当前空间有${facilityCount}项设施：${region.facilities.map(f => f.name).join('、') || '暂无设施'}。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveMapTravel(action: Extract<GameAction, { type: 'MAP_TRAVEL' }>): ActionResult {
    const originId = normalizeMapNodeId(action.fromId);
    const targetId = normalizeMapNodeId(action.toId);
    const origin = mapNodes.value.find(item => item.id === originId);
    const target = mapNodes.value.find(item => item.id === targetId);
    if (!origin || !target) return { ok: false, tone: 'red', message: '没有找到旅行地点。' };
    if (!origin.neighbors.includes(target.id)) {
      return { ok: false, tone: 'amber', message: `${target.name} 与当前地点未直接邻接，需要先到中转点。` };
    }
    const energyCost = Math.max(8, Math.round(action.horseDays * 8));
    energy.value = Math.max(0, energy.value - energyCost);
    protagonist.energy = energy.value;
    setCurrentPlace(target.name, { region: target.region });
    currentMapId.value = target.id;
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `已抵达 ${target.name} (${target.region}) · 精力 -${energyCost}`);
    return {
      ok: true,
      tone: 'green',
      message: `已抵达「${target.name}」。`,
      shouldAskAI: false,
      narrativeFact: `从「${origin.name}」出发，经${action.routeType}前往「${target.name}」，典型路程约${action.routeKm}公里，骑马约${action.horseText}。当前位置已更新为「${target.region} · ${target.name}」。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveCharacterChat(action: Extract<GameAction, { type: 'CHARACTER_CHAT' }>): ActionResult {
    const heroine = heroines.value.find(item => item.id === action.heroineId);
    if (!heroine) return { ok: false, tone: 'red', message: '没有找到这位角色。' };
    energy.value = Math.max(0, energy.value - 4);
    protagonist.energy = energy.value;
    heroine.affection = Math.min(heroine.affectionMax, heroine.affection + 2);
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `已发起与 ${heroine.name} 的一次交谈，羁绊 +2。`);
    return {
      ok: true,
      tone: 'green',
      message: `已发起与 ${heroine.name} 的交谈。`,
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家前往或靠近${heroine.name}(${heroine.title})所在的「${heroine.located}」，用她偏爱的方式打开对话。${action.stateLine}`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveCharacterGift(action: Extract<GameAction, { type: 'CHARACTER_GIFT' }>): ActionResult {
    const heroine = heroines.value.find(item => item.id === action.heroineId);
    if (!heroine) return { ok: false, tone: 'red', message: '没有找到这位角色。' };
    if (!canSpendCopper('wallet', action.costCopper)) {
      return { ok: false, tone: 'red', message: `随身钱袋余额不足。本次需要 ${formatCopper(action.costCopper)}，当前只有 ${walletText.value}。` };
    }
    walletCopper.value = Math.max(0, walletCopper.value - action.costCopper);
    heroine.affection = Math.min(heroine.affectionMax, heroine.affection + action.affectionGain);
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `赠送 ${heroine.name} ${action.itemName}，羁绊 +${action.affectionGain}，随身钱袋 -${formatCopper(action.costCopper)}。`);
    return {
      ok: true,
      tone: 'green',
      message: `已把「${action.itemName}」送给 ${heroine.name}。`,
      shouldAskAI: false,
      paidCopper: action.costCopper,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家把「${action.itemName}」郑重交给${heroine.name}，随身钱袋支出 ${formatCopper(action.costCopper)}，羁绊提升 ${action.affectionGain}。${action.stateLine}`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveProtagonistTrainCooking(action: Extract<GameAction, { type: 'PROTAGONIST_TRAIN_COOKING' }>): ActionResult {
    protagonist.cookingExp = Math.min(protagonist.cookingExpMax, protagonist.cookingExp + Math.max(0, action.expGain));
    markLocalStateDirty();
    void writeChatSave();
    pushLog('结算', `主角厨艺修行已记录 · +${Math.max(0, action.expGain)}`);
    return {
      ok: true,
      tone: 'green',
      message: '已记录主角厨艺修行。',
      shouldAskAI: false,
      narrativeFact: `当前位置为「${currentSceneLabel()}」。玩家练习基础火候与刀工，记录一次厨艺修行。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveCustomAction(action: Extract<GameAction, { type: 'CUSTOM_ACTION' }>): ActionResult {
    const text = action.text.trim();
    if (!text) return { ok: false, tone: 'amber', message: '还没有写行动内容。' };
    return {
      ok: true,
      tone: 'cyan',
      message: action.title ? `${action.title}: ${text}` : `已提交行动: ${text}`,
      shouldAskAI: true,
      summary: text,
      aiHint: '若行动自然影响库存、生命、精力、地点、人物关系、农田或酒窖，请通过隐藏 MVU/变量补丁体现。',
    };
  }

  function resolveMoneyTransfer(action: Extract<GameAction, { type: 'MONEY_TRANSFER' }>): ActionResult {
    const amount = normalizeCopperValue(action.amountCopper);
    if (amount <= 0) return { ok: false, tone: 'amber', message: '还没有填写要转移的金额。' };
    const from: MoneyAccount = action.direction === 'wallet_to_cashbox' ? 'wallet' : 'cashbox';
    const to: MoneyAccount = action.direction === 'wallet_to_cashbox' ? 'cashbox' : 'wallet';
    if (!canSpendCopper(from, amount)) {
      return {
        ok: false,
        tone: 'red',
        message: `${moneyAccountLabel(from)}余额不足。本次需要 ${formatCopper(amount)}，当前只有 ${moneyAccountText(from)}。`,
      };
    }
    moneyAccountRef(from).value -= amount;
    moneyAccountRef(to).value += amount;
    markLocalStateDirty();
    void writeChatSave();
    const actionText = action.direction === 'wallet_to_cashbox' ? '存入钱匣' : '从钱匣取出';
    pushLog('结算', `${actionText} · ${formatCopper(amount)}`);
    return {
      ok: true,
      tone: 'green',
      message: `${actionText} ${formatCopper(amount)}。`,
      shouldAskAI: true,
      summary: `${actionText} ${formatCopper(amount)}`,
      narrativeFact:
        action.direction === 'wallet_to_cashbox'
          ? `从随身钱袋取出 ${formatCopper(amount)}，存入钱匣。`
          : `从钱匣取出 ${formatCopper(amount)}，放入随身钱袋。`,
      settledFact: `当前位置为「${currentSceneLabel()}」。前端已完成资金转移：${moneyAccountLabel(from)}减少 ${formatCopper(amount)}，${moneyAccountLabel(to)}增加 ${formatCopper(amount)}，总额不变。`,
      aiHint: '请简短描写拿钱、清点、存放或取出的动作；不要重新计算随身钱袋、钱匣或总资金。',
    };
  }

  function resolveDebugCurrency(action: Extract<GameAction, { type: 'DEBUG_CURRENCY' }>): ActionResult {
    const delta = Math.floor(action.deltaCopper || 0);
    const account = action.account ?? 'wallet';
    moneyAccountRef(account).value = Math.max(0, moneyAccountRef(account).value + delta);
    markLocalStateDirty();
    void writeChatSave();
    void writeCurrentMessageStatData(buildFrontendMvuSnapshot(action.reason || '调试资金调整'));
    pushLog(delta >= 0 ? '奖励' : '扣减', `${action.reason} · ${moneyAccountLabel(account)} ${delta >= 0 ? '+' : '-'}${formatCopper(Math.abs(delta))}`);
    return {
      ok: true,
      tone: delta >= 0 ? 'green' : 'amber',
      message: `${action.reason} 已调整${moneyAccountLabel(account)}。`,
      shouldAskAI: false,
      paidCopper: Math.abs(delta),
      narrativeFact: `调试调整${moneyAccountLabel(account)}: ${action.reason}, ${delta >= 0 ? '增加' : '减少'}${formatCopper(Math.abs(delta))}。`,
      aiHint: '无需生成正文。',
    };
  }

  function resolveDebugStat(action: Extract<GameAction, { type: 'DEBUG_STAT' }>): ActionResult {
    if (action.stat === 'energy_full') {
      energy.value = energy.max;
      protagonist.energy = energy.value;
    }
    if (action.stat === 'reputation_delta') reputation.value = Math.min(100, Math.max(0, reputation.value + Math.floor(action.value ?? 0)));
    markLocalStateDirty();
    void writeChatSave();
    void writeCurrentMessageStatData(buildFrontendMvuSnapshot(action.reason || '调试状态调整'));
    pushLog('系统', action.reason);
    return {
      ok: true,
      tone: 'cyan',
      message: action.reason,
      shouldAskAI: false,
      narrativeFact: `调试调整状态: ${action.reason}。`,
      aiHint: '无需生成正文。',
    };
  }

  function buildCurrentScenePrompt(actionText: string) {
    return buildNarrationPrompt({ userText: actionText });
  }

  function buildFrontendMvuSnapshot(lastActionSummary = ''): PrimordiaStatData {
    void lastActionSummary;
    ensureWeatherForToday();
    const cookingTitles = ['烧火工', '守灶童', '灶台学徒', '行炉工', '持勺匠', '灶台师傅', '首席灶师', '灶火宗师'];
    const makeMoneySnapshot = (value: number) => {
      const parts = copperToParts(value);
      return {
        铜币: parts.copper,
        银币: parts.silver,
        金币: parts.gold,
        铂金币: parts.platinum,
        秘银币: parts.mithril,
        折算合计铜币: value,
      };
    };
    const makeInventorySnapshot = (items: InventoryItem[]) => {
      const out: Record<InventoryItem['category'], Record<string, any>> = {
        食材: {},
        调料: {},
        成品: {},
        酒水: {},
        杂物: {},
      };
      items.forEach(item => {
        const entry: Record<string, any> = {
          数量: item.qty,
          标签: item.tags,
        };
        entry.价格折合铜币 = item.priceCopper ?? 0;
        if (item.category === '成品' || item.category === '酒水') entry.搭配判定 = item.quality ?? '无冲突';
        if (item.desc) entry.备注 = item.desc;
        out[item.category][item.name] = entry;
      });
      return out;
    };
    const storage: Record<InventoryItem['category'], Record<string, any>> = {
      食材: {},
      调料: {},
      成品: {},
      酒水: {},
      杂物: {},
    };
    inventory.value.forEach(item => {
      const entry: Record<string, any> = {
        数量: item.qty,
        标签: item.tags,
      };
      entry.价格折合铜币 = item.priceCopper ?? 0;
      if (item.category === '成品' || item.category === '酒水') entry.搭配判定 = item.quality ?? '无冲突';
      storage[item.category][item.name] = entry;
    });

    const regionSnapshot = Object.fromEntries(
      regions.value.filter(region => region.id !== 'rooms').map(region => [
        region.name,
        {
          状态: region.condition,
          风格: region.style,
          描述: region.description,
          分配员工: region.staff ?? '',
          设施: Object.fromEntries(
            region.facilities.map(facility => [
              facility.name,
              {
                状态: facility.condition,
                风格: facility.style,
                描述: facility.description,
                价格折合铜币: facility.priceCopper ?? 0,
              },
            ]),
          ),
        },
      ]),
    );
    const roomSnapshot = Object.fromEntries(
      regions.value.flatMap(region =>
        (region.rooms ?? []).map(room => [
          room.name,
          {
            所属区域: region.name,
            类型: room.type,
            住客: room.guest ?? '',
            价格折合铜币: room.priceCopper,
            舒适: room.comfort,
            私密: room.privacy,
            清洁: room.cleanliness,
            设施: Object.fromEntries(
              room.facilities.map(facility => [
                facility.name,
                {
                  状态: facility.condition,
                  风格: facility.style,
                  描述: facility.description,
                  价格折合铜币: facility.priceCopper ?? 0,
                },
              ]),
            ),
          },
        ]),
      ),
    );

    const relationshipSnapshot = Object.fromEntries(
      heroines.value.map(heroine => [
        heroine.name,
        {
          种族: heroine.race,
          身份: heroine.title,
          羁绊阶段: heroine.stage,
          阶段文字: heroine.stageName,
          好感: heroine.affection,
          心情: heroine.mood,
          所在位置: heroine.located,
          一句话穿着: heroine.outfit || '',
          生命: { 当前值: heroine.hp, 上限: heroine.hpMax },
          精力: { 当前值: heroine.energy, 上限: heroine.energyMax },
          膀胱: { 当前值: heroine.bladder, 上限: heroine.bladderMax },
          备注: heroine.bio,
        },
      ]),
    );

    const farmSnapshot = Object.fromEntries(
      farmPlots.value.map(plot => [
        `第${plot.id.replace(/^f-/, '')}号畦`,
        {
          作物: plot.crop === '空畦' ? '' : plot.crop,
          状态: plot.crop === '空畦' ? '空置' : plot.season,
          阶段: plot.stage,
          阶段上限: plot.stageMax,
          预计产出: plot.expectedHarvest,
          播种日: plot.plantedDay ?? '',
          成熟日: plot.matureDay ?? '',
          批次标签: plot.batchTags ?? [],
        },
      ]),
    );

    const brewSnapshot = Object.fromEntries(
      brews.value.map(barrel => [
        barrel.name,
        {
          状态: barrel.filling,
          内容物: barrel.name,
          类型: barrel.brewType ?? '酒水',
          酿造开始日: barrel.startedDay,
          收获日: barrel.matureDay,
          预计产出: barrel.expected,
        },
      ]),
    );

    return {
      世界: {
        时代: openingSave.value?.era ?? '共栖历1303年',
        地区: openingSave.value?.region ?? '韦斯托利亚',
        当前历法: {
          年: calendar.year,
          月份序号: calendar.monthIndex + 1,
          月份名: months[calendar.monthIndex] ?? '',
          季节: seasonText.value,
          日: calendar.day,
          天气: calendar.weather,
          时间: calendar.clock,
        },
        当前地点: {
          区域: location.region,
          具体位置: location.place,
        },
      },
      主角: {
        姓名: protagonist.name,
        种族: protagonist.race,
        称号: protagonist.title,
        当前状态: protagonist.mood,
        所在位置: location.place,
        一句话穿着: protagonist.outfit,
        生命: { 当前值: protagonist.hp, 上限: protagonist.hpMax },
        精力: { 当前值: energy.value, 上限: energy.max },
        烹饪等级: {
          等级: protagonist.cookingLevel,
          称号: cookingTitles[Math.max(0, Math.min(cookingTitles.length - 1, protagonist.cookingLevel - 1))] ?? '',
          做菜次数: protagonist.cookingExp,
          下级所需次数: protagonist.cookingExpMax,
        },
      },
      酒馆: {
        名称: tavernName.value,
        所属领地: openingSave.value?.region ?? '韦斯托利亚',
        所在城市: openingSave.value?.tavernCity ?? location.region,
        声望: reputation.value,
        资金: {
          随身钱袋: makeMoneySnapshot(walletCopper.value),
          钱匣: makeMoneySnapshot(cashboxCopper.value),
          铜币: treasuryParts.value.copper,
          银币: treasuryParts.value.silver,
          金币: treasuryParts.value.gold,
          铂金币: treasuryParts.value.platinum,
          秘银币: treasuryParts.value.mithril,
          折算合计铜币: treasuryCopper.value,
        },
        今日营业状态: protagonist.mood,
        区域: regionSnapshot,
        客房: roomSnapshot,
      },
      街坊商铺: {
        当前商铺: generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? generatedShop.value.name : '',
        商铺: generatedShop.value && isCurrentShopLocation(generatedShop.value.name)
          ? {
              [generatedShop.value.name]: {
                类型: generatedShop.value.kind ?? '街坊商铺',
                店主: generatedShop.value.keeper,
                氛围: generatedShop.value.atmosphere ?? '',
                招呼语: generatedShop.value.greeting ?? '',
                今日货架: Object.fromEntries(generatedShopProducts.value.map(product => [
                  product.name,
                  {
                    分类: product.category,
                    数量: product.stock,
                    单价折合铜币: product.priceCopper,
                    标签: product.tags,
                    备注: product.desc,
                  },
                ])),
              },
            }
          : {},
      },
      人物羁绊: relationshipSnapshot,
      农田与酒窖: {
        农田: farmSnapshot,
        酒窖桶: brewSnapshot,
      },
      库房: storage,
      行囊: makeInventorySnapshot(satchel.value),
      临时状态: clonePlain(temporaryStates.value),
    };
  }

  function getAuthoritativeMvuData(preferredMessageId?: number, fallbackSummary = ''): PrimordiaStatData {
    const statData = readMessageStatData(preferredMessageId);
    return statData ? clonePlainData(statData) : buildFrontendMvuSnapshot(fallbackSummary);
  }

  function buildAuthoritativeRequestData(text: string): PrimordiaStatData {
    return getAuthoritativeMvuData(undefined, text);
  }

  function readStoredFloorSnapshots() {
    try {
      return readChatVariable<PrimordiaChatSaveSnapshot>(PRIMORDIA_CHAT_SAVE_KEY)?.floorSnapshots ?? {};
    } catch {
      return {};
    }
  }

  function hashSnapshotText(text: string) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function readMessageText(messageId?: number) {
    if (typeof messageId !== 'number' || typeof getChatMessages !== 'function') return undefined;
    try {
      const message =
        getChatMessages(messageId, { role: 'all', hide_state: 'all' })?.[0] ??
        getChatMessages(messageId, { role: 'all' })?.[0] ??
        getChatMessages(messageId)?.[0];
      return message?.message ? String(message.message) : undefined;
    } catch {
      return undefined;
    }
  }

  function readMessageSignature(messageId?: number) {
    const text = readMessageText(messageId);
    return text ? hashSnapshotText(text) : undefined;
  }

  function snapshotMatchesCurrentMessage(snapshot: Pick<PrimordiaSaveBody, 'lastMessageId' | 'messageSignature' | 'latestStory'>) {
    if (typeof snapshot.lastMessageId !== 'number') return true;
    const expected = snapshot.messageSignature;
    const actualText = readMessageText(snapshot.lastMessageId);
    if (!actualText) return true;
    if (expected) return hashSnapshotText(actualText) === expected;

    const storyText = snapshot.latestStory?.maintext?.trim();
    if (!storyText) return true;
    const anchor = storyText.replace(/\s+/g, ' ').slice(0, 120);
    return actualText.replace(/\s+/g, ' ').includes(anchor);
  }

  function pruneFloorSnapshots(snapshots: Record<string, PrimordiaSaveBody>, keep = 80) {
    const entries = Object.entries(snapshots)
      .map(([messageId, snapshot]) => ({ messageId, numericId: Number(messageId), snapshot }))
      .sort((a, b) => {
        const left = Number.isFinite(a.numericId) ? a.numericId : -1;
        const right = Number.isFinite(b.numericId) ? b.numericId : -1;
        return right - left;
      })
      .slice(0, keep);
    return Object.fromEntries(entries.map(entry => [entry.messageId, entry.snapshot]));
  }

  function buildChatSaveSnapshot(latestStory?: LatestMaintextPayload): PrimordiaChatSaveSnapshot {
    syncProtagonistEnergyFromStore();
    const latestMessageId =
      typeof latestStory?.messageId === 'number'
        ? latestStory.messageId
        : typeof getLastMessageId === 'function'
          ? getLastMessageId()
          : undefined;
    const activeGeneratedShop = generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? generatedShop.value : null;

    const snapshot: PrimordiaSaveBody = {
      schemaVersion: PRIMORDIA_CHAT_SAVE_VERSION,
      savedAt: Date.now(),
      lastTickAt: lastTickAt.value,
      lastShopRefreshDay: lastShopRefreshDay.value,
      lastMessageId: latestMessageId,
      currentMessageId: latestMessageId,
      messageSignature: readMessageSignature(latestMessageId),
      branchBaseMessageId: loadedStoryCheckpoint.value?.messageId ?? null,
      calendar: {
        year: calendar.year,
        monthIndex: calendar.monthIndex,
        day: calendar.day,
        timeOfDay: calendar.timeOfDay,
        clock: calendar.clock,
        weather: calendar.weather,
        weatherIcon: calendar.weatherIcon,
        weatherDescription: calendar.weatherDescription,
        weatherDaySerial: calendar.weatherDaySerial,
      },
      location: {
        region: location.region,
        place: location.place,
        protagonistLocated: protagonist.located,
        sceneType: currentSceneType.value,
        relatedName: generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? generatedShop.value.name : undefined,
      },
      tavernName: tavernName.value,
      treasuryCopper: treasuryCopper.value,
      walletCopper: walletCopper.value,
      cashboxCopper: cashboxCopper.value,
      reputation: reputation.value,
      energy: { value: energy.value, max: energy.max },
      protagonist: clonePlain(protagonist),
      business: businessStateSnapshot(),
      guestGroups: clonePlain(guestGroups.value),
      heroines: clonePlain(heroines.value),
      tavernNpcActivities: clonePlain(tavernNpcActivities.value),
      lastNpcActivityMinute: lastNpcActivityMinute.value,
      lastNpcActivityTurn: lastNpcActivityTurn.value,
      successfulNarrationTurn: successfulNarrationTurn.value,
      npcActivityKeepTurns: npcActivityKeepTurns.value,
      npcActivityEnabled: npcActivityEnabled.value,
      npcActivityWorldbookLibrary: npcActivityWorldbookLibrary.value ? clonePlain(npcActivityWorldbookLibrary.value) : null,
      npcActivityWorldbookBindings: clonePlain(npcActivityWorldbookBindings.value),
      weatherWorldbookLibrary: weatherWorldbookLibrary.value ? clonePlain(weatherWorldbookLibrary.value) : null,
      weatherWorldbookBindings: clonePlain(weatherWorldbookBindings.value),
      weatherWorldbookStatus: weatherWorldbookStatus.value,
      weatherWorldbookErrors: clonePlain(weatherWorldbookErrors.value),
      turnContextWorldbookBinding: turnContextWorldbookBinding.value ? clonePlain(turnContextWorldbookBinding.value) : null,
      turnContextWorldbookStatus: turnContextWorldbookStatus.value,
      characterWorldbookBindings: clonePlain(characterWorldbookBindings.value),
      characterBehaviorLibraries: clonePlain(characterBehaviorLibraries.value),
      inventory: clonePlain(inventory.value),
      satchel: clonePlain(satchel.value),
      temporaryStates: clonePlain(temporaryStates.value),
      promiseMemos: clonePlain(promiseMemos.value),
      recipes: clonePlain(recipes.value),
      engineLogs: clonePlain(engineLogs.value),
      generatedShop: activeGeneratedShop ? clonePlain(activeGeneratedShop) : null,
      generatedShopProducts: activeGeneratedShop ? clonePlain(generatedShopProducts.value) : [],
      draftActions: clonePlain(draftActions.value),
      farmPlots: clonePlain(farmPlots.value),
      brews: clonePlain(brews.value),
      latestStory: latestStory
        ? {
            maintext: latestStory.maintext,
            options: latestStory.options,
            sum: latestStory.sum,
            messageId: latestStory.messageId,
            userMessageId: latestStory.userMessageId,
          }
        : undefined,
      systemJudgement: buildSystemJudgementSnapshot(latestStory?.sum || latestStory?.maintext || ''),
      opening: openingSave.value ? clonePlain(openingSave.value) : undefined,
    };

    const floorSnapshots = { ...readStoredFloorSnapshots() };
    if (typeof latestMessageId === 'number') {
      floorSnapshots[String(latestMessageId)] = clonePlain(snapshot);
    }

    return {
      ...snapshot,
      floorSnapshots: pruneFloorSnapshots(floorSnapshots),
    };
  }

  function normalizeSaveSnapshot(raw: unknown): PrimordiaSaveBody | null {
    const meta = normalizeChatSaveMeta(raw);
    if (!raw || typeof raw !== 'object' || !meta) return null;
    const source = raw as Partial<PrimordiaChatSaveSnapshot>;
    const patched: string[] = [];
    const notePatch = (label: string, ok: boolean) => {
      if (!ok) patched.push(label);
    };

    const sourceCalendar = asRecord(source.calendar);
    const sourceLocation = asRecord(source.location);
    notePatch('日期时间', !!source.calendar);
    notePatch('地点', !!source.location);
    notePatch('库存', Array.isArray(source.inventory));
    notePatch('个人行囊', Array.isArray(source.satchel));
    notePatch('临时状态', !!source.temporaryStates);
    notePatch('约定备忘录', Array.isArray(source.promiseMemos));
    notePatch('行动日志', Array.isArray(source.engineLogs));
    notePatch('农田', Array.isArray(source.farmPlots));
    notePatch('酒窖', Array.isArray(source.brews));

    const rawSceneType = typeof sourceLocation.sceneType === 'string' ? (sourceLocation.sceneType as SceneType) : undefined;
    const rawPlace = String(sourceLocation.place || location.place || protagonist.located || '主厅');
    const rawProtagonistLocated = String(sourceLocation.protagonistLocated || rawPlace);
    const rawGeneratedShop = source.generatedShop && typeof source.generatedShop === 'object' ? clonePlain(source.generatedShop) : null;
    const rawRelatedName = typeof sourceLocation.relatedName === 'string' ? sourceLocation.relatedName : '';
    const rawGeneratedShopName = typeof rawGeneratedShop?.name === 'string' ? rawGeneratedShop.name : '';
    const rawPlaceText = `${rawPlace} ${rawProtagonistLocated} ${rawRelatedName}`;
    const exactShopStillCurrent = !!rawGeneratedShopName && shopNameMatchesPlace(rawGeneratedShopName, rawPlaceText);
    const explicitShopSnapshot =
      rawSceneType === '商铺' ||
      exactShopStillCurrent ||
      (!!rawGeneratedShopName && (rawPlace === rawGeneratedShopName || rawProtagonistLocated === rawGeneratedShopName || rawRelatedName === rawGeneratedShopName));
    const shouldKeepShop = !!rawGeneratedShop && explicitShopSnapshot;
    const normalizedShop = shouldKeepShop ? rawGeneratedShop : null;
    const normalizedProducts = normalizedShop
      ? Array.isArray(source.generatedShopProducts)
        ? clonePlain(source.generatedShopProducts)
        : generatedShop.value?.name === normalizedShop.name
          ? clonePlain(generatedShopProducts.value)
          : []
      : [];
    if (normalizedShop && !Array.isArray(source.generatedShopProducts)) patched.push('商铺货架');

    const legacyOpeningCompleted =
      !source.opening &&
      Boolean(
        source.latestStory ||
          Math.floor(Number(source.successfulNarrationTurn) || 0) > 0 ||
          Math.floor(Number(source.lastMessageId ?? meta.lastMessageId) || 0) > 0 ||
          (Array.isArray(source.engineLogs) && source.engineLogs.length > 0),
      );
    const normalizedOpening =
      source.opening && typeof source.opening === 'object'
        ? clonePlain(source.opening as OpeningSaveSnapshot)
        : legacyOpeningCompleted
          ? ({
              completed: true,
              openingMessageId: 0,
              completedAt: meta.savedAt,
              worldbookName: '',
              characterSummary: String(source.protagonist?.name || protagonist.name || '主角'),
              tavernSummary: String(source.tavernName || tavernName.value || '酒馆'),
            } satisfies OpeningSaveSnapshot)
          : undefined;
    if (legacyOpeningCompleted) patched.push('旧档开局标记');
    const sourceEnergyValue = Number(source.energy?.value);
    const sourceEnergyMax = Number(source.energy?.max);

    const normalized: PrimordiaSaveBody = {
      schemaVersion: PRIMORDIA_CHAT_SAVE_VERSION,
      savedAt: meta.savedAt,
      lastTickAt: Math.floor(Number(source.lastTickAt) || lastTickAt.value || Date.now()),
      lastShopRefreshDay: Math.floor(Number(source.lastShopRefreshDay) || lastShopRefreshDay.value || currentCalendarDay()),
      lastMessageId: typeof source.lastMessageId === 'number' ? source.lastMessageId : meta.lastMessageId,
      currentMessageId: typeof source.currentMessageId === 'number' ? source.currentMessageId : meta.currentMessageId,
      messageSignature: typeof source.messageSignature === 'string' ? source.messageSignature : undefined,
      branchBaseMessageId:
        typeof source.branchBaseMessageId === 'number' || source.branchBaseMessageId === null
          ? source.branchBaseMessageId
          : meta.branchBaseMessageId ?? null,
      calendar: {
        year: Math.floor(Number(sourceCalendar.year) || calendar.year),
        monthIndex: Math.max(0, Math.min(months.length - 1, Math.floor(Number(sourceCalendar.monthIndex) || calendar.monthIndex))),
        day: Math.max(1, Math.floor(Number(sourceCalendar.day) || calendar.day)),
        timeOfDay: String(sourceCalendar.timeOfDay || calendar.timeOfDay),
        clock: String(sourceCalendar.clock || calendar.clock),
        weather: String(sourceCalendar.weather || calendar.weather),
        weatherIcon: ['sun', 'cloud', 'rain', 'snow', 'moon'].includes(String(sourceCalendar.weatherIcon))
          ? (sourceCalendar.weatherIcon as CalendarSnapshot['weatherIcon'])
          : calendar.weatherIcon,
        weatherDescription: String(sourceCalendar.weatherDescription || calendar.weatherDescription || ''),
        weatherDaySerial: Math.floor(Number(sourceCalendar.weatherDaySerial) || 0),
      },
      location: {
        region: String(sourceLocation.region || location.region || '布拉姆维克'),
        place: normalizedShop && isGenericStreetEntrance(rawPlace) ? normalizedShop.name : rawPlace,
        protagonistLocated: normalizedShop && isGenericStreetEntrance(rawProtagonistLocated) ? normalizedShop.name : rawProtagonistLocated,
        sceneType: normalizedShop ? '商铺' : rawSceneType || inferSceneType(`${rawPlace} ${rawProtagonistLocated}`),
        relatedName: typeof sourceLocation.relatedName === 'string' ? sourceLocation.relatedName : normalizedShop?.name,
      },
      tavernName: String(source.tavernName || tavernName.value || '铁壶酒馆'),
      treasuryCopper: normalizeCopperValue(source.treasuryCopper ?? treasuryCopper.value),
      walletCopper:
        source.walletCopper !== undefined
          ? normalizeCopperValue(source.walletCopper)
          : normalizeCopperValue(source.treasuryCopper ?? treasuryCopper.value),
      cashboxCopper: source.cashboxCopper !== undefined ? normalizeCopperValue(source.cashboxCopper) : 0,
      reputation: Math.max(0, Math.min(100, Number(source.reputation) || reputation.value)),
      energy: {
        value: Math.max(0, Math.floor(Number.isFinite(sourceEnergyValue) ? sourceEnergyValue : energy.value)),
        max: Math.max(1, Math.floor(Number.isFinite(sourceEnergyMax) ? sourceEnergyMax : energy.max)),
      },
      protagonist: clonePlain(source.protagonist ?? protagonist),
      business: normalizeBusinessState(source.business),
      guestGroups: normalizeGuestGroups(source.guestGroups),
      heroines: Array.isArray(source.heroines) ? clonePlain(source.heroines) : clonePlain(heroines.value),
      characterWorldbookBindings:
        source.characterWorldbookBindings && typeof source.characterWorldbookBindings === 'object'
          ? clonePlain(source.characterWorldbookBindings)
          : clonePlain(characterWorldbookBindings.value),
      characterBehaviorLibraries:
        source.characterBehaviorLibraries && typeof source.characterBehaviorLibraries === 'object'
          ? clonePlain(source.characterBehaviorLibraries)
          : clonePlain(characterBehaviorLibraries.value),
      tavernNpcActivities: Array.isArray(source.tavernNpcActivities) ? clonePlain(source.tavernNpcActivities) : clonePlain(tavernNpcActivities.value),
      lastNpcActivityMinute: Math.floor(Number(source.lastNpcActivityMinute) || currentSerialMinute()),
      lastNpcActivityTurn: Math.max(0, Math.floor(Number(source.lastNpcActivityTurn) || 0)),
      successfulNarrationTurn: Math.max(0, Math.floor(Number(source.successfulNarrationTurn) || 0)),
      npcActivityKeepTurns: safeNpcActivityKeepTurns(source.npcActivityKeepTurns),
      npcActivityEnabled: Boolean(source.npcActivityEnabled),
      npcActivityWorldbookLibrary:
        source.npcActivityWorldbookLibrary && typeof source.npcActivityWorldbookLibrary === 'object'
          ? clonePlain(source.npcActivityWorldbookLibrary)
          : null,
      npcActivityWorldbookBindings: Array.isArray(source.npcActivityWorldbookBindings)
        ? clonePlain(source.npcActivityWorldbookBindings)
        : clonePlain(npcActivityWorldbookBindings.value),
      weatherWorldbookLibrary:
        source.weatherWorldbookLibrary && typeof source.weatherWorldbookLibrary === 'object'
          ? clonePlain(source.weatherWorldbookLibrary)
          : null,
      weatherWorldbookBindings: Array.isArray(source.weatherWorldbookBindings)
        ? clonePlain(source.weatherWorldbookBindings)
        : clonePlain(weatherWorldbookBindings.value),
      weatherWorldbookStatus: String(source.weatherWorldbookStatus || weatherWorldbookStatus.value),
      weatherWorldbookErrors: Array.isArray(source.weatherWorldbookErrors) ? clonePlain(source.weatherWorldbookErrors) : [],
      turnContextWorldbookBinding:
        source.turnContextWorldbookBinding && typeof source.turnContextWorldbookBinding === 'object'
          ? clonePlain(source.turnContextWorldbookBinding)
          : source.opening?.turnContextWorldbookBinding && typeof source.opening.turnContextWorldbookBinding === 'object'
            ? clonePlain(source.opening.turnContextWorldbookBinding)
          : null,
      turnContextWorldbookStatus: String(source.turnContextWorldbookStatus || '本回合发送包条目尚未绑定。'),
      inventory: Array.isArray(source.inventory) ? clonePlain(source.inventory) : clonePlain(inventory.value),
      satchel: Array.isArray(source.satchel) ? clonePlain(source.satchel) : clonePlain(satchel.value),
      temporaryStates: normalizeTemporaryStateTree(source.temporaryStates),
      promiseMemos: normalizePromiseMemoList(source.promiseMemos),
      recipes: Array.isArray(source.recipes) ? clonePlain(source.recipes) : clonePlain(recipes.value),
      engineLogs: Array.isArray(source.engineLogs) ? clonePlain(source.engineLogs) : clonePlain(engineLogs.value),
      generatedShop: normalizedShop,
      generatedShopProducts: normalizedProducts,
      draftActions: Array.isArray(source.draftActions) ? clonePlain(source.draftActions) : clonePlain(draftActions.value),
      farmPlots: Array.isArray(source.farmPlots) ? clonePlain(source.farmPlots) : clonePlain(farmPlots.value),
      brews: Array.isArray(source.brews) ? clonePlain(source.brews) : clonePlain(brews.value),
      latestStory: source.latestStory ? clonePlain(source.latestStory) : undefined,
      systemJudgement:
        source.systemJudgement && typeof source.systemJudgement === 'object'
          ? clonePlain(source.systemJudgement as SystemJudgementSnapshot)
          : undefined,
      opening: normalizedOpening,
    };

    saveMigrationStatus.value = patched.length
      ? `读取时已补齐旧结构缺失字段：${[...new Set(patched)].join('、')}。`
      : `无需迁移 · schema v${PRIMORDIA_CHAT_SAVE_VERSION}`;

    return normalized;
  }

  function buildOpeningFingerprintFromDraft(draft: OpeningWorkshopDraft) {
    return buildOpeningFingerprint([
      draft.character.name,
      draft.character.race,
      draft.tavern.territory || draft.region,
      draft.tavern.city,
      draft.tavern.place,
      draft.era,
    ]);
  }

  function buildOpeningFingerprintFromStatData(statData: PrimordiaStatData | null) {
    if (!statData) return '';
    return buildOpeningFingerprint([
      readPlainPath(statData, '主角.姓名'),
      readPlainPath(statData, '主角.种族'),
      readPlainPath(statData, '酒馆.所属领地') ?? readPlainPath(statData, '世界.地区'),
      readPlainPath(statData, '酒馆.所在城市') ?? readPlainPath(statData, '世界.当前地点.区域'),
      readPlainPath(statData, '世界.当前地点.具体位置') ?? readPlainPath(statData, '主角.所在位置'),
      readPlainPath(statData, '世界.时代'),
    ]);
  }

  function openingSnapshotMatchesCurrentChat(opening: OpeningSaveSnapshot | undefined, snapshotLastMessageId?: number) {
    if (!opening?.completed) return true;
    const openingMessageId = typeof opening.openingMessageId === 'number' ? opening.openingMessageId : snapshotLastMessageId;
    const currentLastMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
    if (
      typeof openingMessageId === 'number' &&
      typeof currentLastMessageId === 'number' &&
      openingMessageId > currentLastMessageId
    ) {
      return false;
    }
    if (!opening.fingerprint) return false;
    if (typeof openingMessageId !== 'number') return false;
    const currentOpeningStatData = readMessageStatData(openingMessageId);
    if (!currentOpeningStatData) return false;
    return buildOpeningFingerprintFromStatData(currentOpeningStatData) === opening.fingerprint;
  }

  function applyChatSaveSnapshot(snapshot: PrimordiaSaveBody, options: { allowOlder?: boolean } = {}) {
    const normalized = normalizeSaveSnapshot(snapshot);
    if (!normalized) return false;

    const currentLastMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
    if (
      !options.allowOlder &&
      typeof normalized.lastMessageId === 'number' &&
      typeof currentLastMessageId === 'number' &&
      currentLastMessageId !== normalized.lastMessageId
    ) {
      return false;
    }
    if (!options.allowOlder && !openingSnapshotMatchesCurrentChat(normalized.opening, normalized.lastMessageId)) {
      return false;
    }
    if (!snapshotMatchesCurrentMessage(normalized)) {
      return false;
    }

    calendar.year = normalized.calendar.year;
    calendar.monthIndex = normalized.calendar.monthIndex;
    calendar.day = normalized.calendar.day;
    calendar.timeOfDay = normalized.calendar.timeOfDay as TimeOfDay;
    calendar.clock = normalized.calendar.clock;
    calendar.weather = normalized.calendar.weather;
    calendar.weatherIcon = normalized.calendar.weatherIcon;
    calendar.weatherDescription = normalized.calendar.weatherDescription ?? '';
    calendar.weatherDaySerial = normalized.calendar.weatherDaySerial ?? 0;

    location.region = normalized.location.region;
    setCurrentPlace(normalized.location.place, {
      keepShop: Boolean(normalized.generatedShop) || normalized.location.sceneType === '商铺' || isShopLikePlace(normalized.location.place),
    });
    tavernName.value = normalized.tavernName;
    walletCopper.value = normalizeCopperValue(normalized.walletCopper ?? normalized.treasuryCopper);
    cashboxCopper.value = normalizeCopperValue(normalized.cashboxCopper ?? 0);
    reputation.value = normalized.reputation;
    energy.value = normalized.energy.value;
    energy.max = normalized.energy.max;

    Object.assign(protagonist, clonePlain(normalized.protagonist));
    protagonist.race = protagonist.race || '人类';
    syncProtagonistEnergyFromStore();
    const business = normalizeBusinessState(normalized.business);
    isBusinessOpen.value = business.isOpen;
    guestCap.value = business.guestCap;
    visitorChance.value = business.visitorChance;
    currentGuests.value = Math.min(business.currentGuests, business.guestCap);
    lastVisitorSeed.value = business.lastVisitorSeed;
    guestGroups.value = normalizeGuestGroups(normalized.guestGroups);
    setCurrentPlace(normalized.location.protagonistLocated || normalized.location.place, {
      keepShop: Boolean(normalized.generatedShop) || normalized.location.sceneType === '商铺' || isShopLikePlace(normalized.location.protagonistLocated || normalized.location.place),
    });

    heroines.value = clonePlain(normalized.heroines ?? []);
    lastNpcActivityMinute.value = Math.floor(Number(normalized.lastNpcActivityMinute) || currentSerialMinute());
    lastNpcActivityTurn.value = Math.max(0, Math.floor(Number(normalized.lastNpcActivityTurn) || 0));
    successfulNarrationTurn.value = Math.max(
      lastNpcActivityTurn.value,
      Math.floor(Number(normalized.successfulNarrationTurn) || 0),
    );
    npcActivityKeepTurns.value = safeNpcActivityKeepTurns(normalized.npcActivityKeepTurns);
    tavernNpcActivities.value = normalizeNpcActivities(normalized.tavernNpcActivities ?? [], successfulNarrationTurn.value);
    npcActivityEnabled.value = Boolean(normalized.npcActivityEnabled && normalized.npcActivityWorldbookLibrary);
    npcActivityWorldbookLibrary.value = normalized.npcActivityWorldbookLibrary ? clonePlain(normalized.npcActivityWorldbookLibrary) : null;
    npcActivityWorldbookBindings.value = clonePlain(normalized.npcActivityWorldbookBindings ?? []);
    weatherWorldbookLibrary.value = normalized.weatherWorldbookLibrary ? clonePlain(normalized.weatherWorldbookLibrary) : null;
    weatherWorldbookBindings.value = clonePlain(normalized.weatherWorldbookBindings ?? []);
    weatherWorldbookStatus.value = normalized.weatherWorldbookStatus || (weatherWorldbookLibrary.value ? '已从存档恢复世界书天气池。' : '尚未读取世界书天气池。');
    weatherWorldbookErrors.value = clonePlain(normalized.weatherWorldbookErrors ?? []);
    turnContextWorldbookBinding.value = normalized.turnContextWorldbookBinding ? clonePlain(normalized.turnContextWorldbookBinding) : null;
    turnContextWorldbookStatus.value = normalized.turnContextWorldbookStatus || (turnContextWorldbookBinding.value ? '已从存档恢复本回合发送包条目绑定。' : '本回合发送包条目尚未绑定。');
    ensureWeatherForToday();
    characterWorldbookBindings.value = clonePlain(normalized.characterWorldbookBindings ?? {});
    characterBehaviorLibraries.value = clonePlain(normalized.characterBehaviorLibraries ?? {});
    inventory.value = clonePlain(normalized.inventory);
    satchel.value = clonePlain(normalized.satchel ?? []);
    temporaryStates.value = normalizeTemporaryStateTree(normalized.temporaryStates);
    promiseMemos.value = normalizePromiseMemoList(normalized.promiseMemos);
    recipes.value = clonePlain(normalized.recipes ?? []);
    engineLogs.value = clonePlain(normalized.engineLogs);
    draftActions.value = clonePlain(normalized.draftActions ?? []);
    farmPlots.value = clonePlain(normalized.farmPlots ?? []);
    brews.value = clonePlain(normalized.brews ?? []);
    openingSave.value = normalized.opening ? clonePlain(normalized.opening) : null;
    openingCompleted.value = Boolean(normalized.opening?.completed);
    openingRequired.value = false;
    lastTickAt.value = Number(normalized.lastTickAt) || Date.now();
    lastShopRefreshDay.value = Number(normalized.lastShopRefreshDay) || currentCalendarDay();
    generatedShop.value = normalized.generatedShop ? clonePlain(normalized.generatedShop) : null;
    generatedShopProducts.value = clonePlain(normalized.generatedShopProducts);
    syncGeneratedShopWithLocation(normalized.lastMessageId);
    return true;
  }

  function restoreStorySnapshot(messageId: number) {
    try {
      const snapshot = readChatVariable<PrimordiaChatSaveSnapshot>(PRIMORDIA_CHAT_SAVE_KEY);
      const floorSnapshot = snapshot?.floorSnapshots?.[String(messageId)];
      const canUseSnapshot = Boolean(floorSnapshot && snapshotMatchesCurrentMessage(floorSnapshot));
      const restoredSnapshot = canUseSnapshot ? applyChatSaveSnapshot(floorSnapshot as PrimordiaSaveBody, { allowOlder: true }) : false;
      const restoredMvu = syncFrontendFromMessageMvu({ messageId, restoreInventory: true });
      return restoredMvu || restoredSnapshot;
    } catch (error) {
      console.warn('[primordia] restore floor snapshot failed:', error);
      return false;
    }
  }

  function restoreNearestStorySnapshotBefore(messageId: number) {
    try {
      const floorSnapshots = readStoredFloorSnapshots();
      const target = Object.keys(floorSnapshots)
        .map(Number)
        .filter(id => Number.isFinite(id) && id < messageId)
        .sort((a, b) => b - a)[0];
      return typeof target === 'number' ? restoreStorySnapshot(target) : false;
    } catch (error) {
      console.warn('[primordia] restore nearest floor snapshot failed:', error);
      return false;
    }
  }

  function restoreAfterFailedRegeneration(anchorMessageId?: number) {
    const anchor =
      typeof anchorMessageId === 'number'
        ? anchorMessageId
        : typeof getLastMessageId === 'function'
          ? getLastMessageId() + 1
          : Number.POSITIVE_INFINITY;
    const restored = restoreNearestStorySnapshotBefore(anchor);
    if (!restored) {
      loadFromMvu({ force: true });
      syncGeneratedShopWithLocation();
      if (!isCurrentShopLocation()) clearGeneratedShop({ silent: true });
    }
    void writeChatSave();
    return restored;
  }

  function restoreFromChatSave() {
    try {
      const snapshot = readChatVariable<PrimordiaChatSaveSnapshot>(PRIMORDIA_CHAT_SAVE_KEY);
      const currentLastMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
      const onlyBootFloor = typeof currentLastMessageId === 'number' && currentLastMessageId <= 0;
      if (onlyBootFloor && snapshot) {
        return false;
      }
      const restoredSnapshot = snapshot ? applyChatSaveSnapshot(snapshot) : false;
      syncFrontendFromMessageMvu({ restoreInventory: true });
      return restoredSnapshot;
    } catch (error) {
      console.warn('[primordia] restore chat save failed:', error);
      return false;
    }
  }

  async function writeChatSave(latestStory?: LatestMaintextPayload) {
    const snapshot = buildChatSaveSnapshot(latestStory);
    try {
      return await writeChatVariable(PRIMORDIA_CHAT_SAVE_KEY, snapshot);
    } catch (error) {
      console.warn('[primordia] write chat save failed:', error);
    }
    return false;
  }

  function evaluateOpeningRequirement(state: { loadedFromMvu?: boolean; loadedFromLatestPatch?: boolean; loadedFromSave?: boolean } = {}) {
    const hasCompletedOpening = Boolean(openingSave.value?.completed || openingCompleted.value);
    const latestStory = loadLatestAssistantMaintext();
    const latestStoryMessageId = Number(latestStory.messageId ?? -1);
    const hasNarrativeAfterBoot = latestStoryMessageId >= 0 && Boolean(latestStory.maintext?.trim());
    const hasLegacyStartedChat = Boolean(
      state.loadedFromSave ||
        successfulNarrationTurn.value > 0 ||
        hasNarrativeAfterBoot,
    );

    if (hasCompletedOpening || hasLegacyStartedChat) {
      openingRequired.value = false;
      openingCompleted.value = true;
      return false;
    }
    openingCompleted.value = false;
    openingRequired.value = true;
    if (currentTab.value === 'chronicle') currentTab.value = 'opening';
    return openingRequired.value;
  }

  function hasStartedNarrativeAfterBoot() {
    const latestStory = loadLatestAssistantMaintext();
    return Number(latestStory.messageId ?? -1) >= 0 && Boolean(latestStory.maintext?.trim());
  }

  function openOpeningWorkshop() {
    openingWorkshopForced.value = true;
  }

  function closeOpeningWorkshop() {
    openingWorkshopForced.value = false;
  }

  function copperForOpeningFunds(value: string) {
    const text = String(value || '');
    if (/富足|豪华|很多|高/.test(text)) return 200_000;
    if (/宽裕|充足|中高/.test(text)) return 80_000;
    if (/拮据|贫穷|很少|低/.test(text)) return 2_000;
    return 17_382;
  }

  function openingInventory(stock: string): InventoryItem[] {
    const text = String(stock || '');
    const rich = /丰富|充足|很多|高/.test(text);
    const poor = /稀少|贫乏|很少|低/.test(text);
    const factor = rich ? 2 : poor ? 0.5 : 1;
    const qty = (base: number) => Math.max(1, Math.floor(base * factor));
    return [
      { id: 'opening-potato', name: '新鲜土豆', category: '食材', qty: qty(12), tags: ['根茎', '饱腹'], priceCopper: 12 },
      { id: 'opening-bean', name: '晒干豆子', category: '食材', qty: qty(8), tags: ['豆类', '耐储'], priceCopper: 8 },
      { id: 'opening-salt', name: '粗盐', category: '调料', qty: qty(6), tags: ['基础调味'], priceCopper: 8 },
      { id: 'opening-ale', name: '普通麦酒', category: '酒水', qty: qty(6), tags: ['苦涩', '解渴'], quality: '无冲突', priceCopper: 15 },
      { id: 'opening-clean-rag', name: '旧抹布', category: '杂物', qty: qty(3), tags: ['清扫'], priceCopper: 2 },
    ];
  }

  function setPlainPath(target: Record<string, any>, path: string, value: unknown) {
    const parts = path.split('.').filter(Boolean);
    let cursor = target;
    parts.slice(0, -1).forEach(part => {
      if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  function clonePlainData<T>(value: T): T {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value ?? {}));
    }
  }

  function mergePlainData<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
    const output = clonePlainData(base);
    const mergeInto = (target: Record<string, any>, source: Record<string, any>) => {
      Object.entries(source).forEach(([key, value]) => {
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          target[key] &&
          typeof target[key] === 'object' &&
          !Array.isArray(target[key])
        ) {
          mergeInto(target[key], value);
          return;
        }
        target[key] = clonePlainData(value);
      });
    };
    mergeInto(output, patch);
    return output;
  }

  function readInitStatData() {
    try {
      if (typeof Mvu !== 'undefined' && typeof Mvu.getMvuData === 'function') {
        const initialData = Mvu.getMvuData({ type: 'message', message_id: 0 });
        const statData = initialData?.stat_data ?? initialData?.data?.stat_data;
        if (statData && typeof statData === 'object') return clonePlainData(statData);
      }
    } catch (error) {
      console.warn('[primordia] read init stat_data failed:', error);
    }
    return buildFrontendMvuSnapshot('自定义开局');
  }

  function normalizeOpeningCalendarFromText(statData: PrimordiaStatData) {
    const world = (statData as Record<string, any>)['世界'];
    if (!world || typeof world !== 'object') return;

    const calendarValue = world['当前历法'];
    const calendarText = typeof calendarValue === 'string' ? calendarValue : '';
    const timeText = String(world['时间'] ?? world['当前时间'] ?? '').trim();
    const text = [calendarText, timeText].filter(Boolean).join('/');
    if (!text) return;

    const currentCalendar =
      calendarValue && typeof calendarValue === 'object' && !Array.isArray(calendarValue)
        ? { ...(calendarValue as Record<string, unknown>) }
        : {};
    const parts = text.split(/[/｜|]/).map(part => part.trim()).filter(Boolean);
    const yearMatch = text.match(/(\d{3,4})\s*年/);
    const monthIndexMatch = text.match(/(?:^|[/｜|\s])(\d{1,2})\s*月(?:[/｜|\s]|$)/);
    const dayMatch = text.match(/(\d{1,2})\s*日/);
    const clockMatch = text.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/);

    if (yearMatch) currentCalendar['年'] = Number(yearMatch[1]);
    if (monthIndexMatch) currentCalendar['月份序号'] = Number(monthIndexMatch[1]);
    if (dayMatch) currentCalendar['日'] = Number(dayMatch[1]);
    if (clockMatch) currentCalendar['时间'] = `${clockMatch[1].padStart(2, '0')}:${clockMatch[2]}`;

    const monthName = parts.find(part => /月$/.test(part) && !/^\d+\s*月$/.test(part));
    if (monthName) currentCalendar['月份名'] = monthName;
    const season = parts.find(part => /春|夏|秋|冬|暮春|仲春|初春|隆冬|冬末|初夏|盛夏|暮夏|初秋|仲秋|暮秋|初冬/.test(part));
    if (season) currentCalendar['季节'] = season;
    const timeOfDay = parts.find(part => /清晨|上午|正午|午后|黄昏|傍晚|入夜|深夜|黎明|夜/.test(part));
    if (timeOfDay) currentCalendar['时段'] = timeOfDay;
    const weatherPart = parts.find(part => !/^\d{3,4}年$|^\d{1,2}月$|^\d{1,2}日$|^\d{1,2}[:：]\d{2}$/.test(part) && part !== monthName && part !== season && part !== timeOfDay);
    if (weatherPart && !currentCalendar['天气']) currentCalendar['天气'] = weatherPart;

    world['当前历法'] = currentCalendar;
  }

  function normalizeOpeningLocationFromText(statData: PrimordiaStatData) {
    const world = (statData as Record<string, any>)['世界'];
    if (!world || typeof world !== 'object') return;
    const locationValue = world['当前地点'];
    if (locationValue && typeof locationValue === 'object' && !Array.isArray(locationValue)) return;
    const text = String(locationValue ?? '').trim();
    if (!text) return;
    const parts = text.split(/[/｜|]/).map(part => part.trim()).filter(Boolean);
    world['当前地点'] = {
      区域: parts[0] || location.region,
      具体位置: parts[1] || parts[0] || currentPlaceText(),
    };
  }

  function normalizeOpeningStatDataShape(statData: PrimordiaStatData) {
    normalizeOpeningCalendarFromText(statData);
    normalizeOpeningLocationFromText(statData);
    return statData;
  }

  const DEFAULT_OPENING_REGION_STYLES = new Set([
    '橡木与石墙',
    '深色橡木',
    '石灶与铁锅',
    '木梁与粗布',
  ]);
  const OPENING_CORE_REGION_NAMES = new Set(['主厅接待区', '柜台酒水区', '厨房餐食区', '客房']);

  function compactOpeningField(value: unknown, maxLength = 120) {
    const text = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  function isDefaultOpeningRegionStyle(style: string, draftStyle: string) {
    const text = style.trim();
    if (!text) return true;
    if (draftStyle && text.includes(draftStyle)) return false;
    return Array.from(DEFAULT_OPENING_REGION_STYLES).some(defaultStyle => text.includes(defaultStyle));
  }

  function ensureOpeningTavernRegions(statData: PrimordiaStatData, draft: OpeningWorkshopDraft, bundle: OpeningGenerationBundle) {
    const root = statData as Record<string, any>;
    const tavern = asRecord(root['酒馆']);
    if (root['酒馆'] !== tavern) root['酒馆'] = tavern;

    const regionRoot = asRecord(tavern['区域']);
    if (tavern['区域'] !== regionRoot) tavern['区域'] = regionRoot;
    if (!String(tavern['整体概况'] ?? '').trim()) {
      const tavernArchive = compactOpeningField(bundle.tavernProfile.summary || bundle.tavernProfile.profile, 220);
      tavern['整体概况'] =
        tavernArchive ||
        `${draft.tavern.name || '这间酒馆'}刚刚开张，当前只确认主厅、厨房、柜台和客房等基础空间，其余地方仍等待玩家在剧情中整理出来。`;
    }

    const draftStyle = compactOpeningField(draft.tavern.style, 80);
    const tavernArchive = compactOpeningField(bundle.tavernProfile.summary || bundle.tavernProfile.profile, 180);
    const placeText = [draft.tavern.territory || draft.region, draft.tavern.city, draft.tavern.name]
      .map(part => compactOpeningField(part, 40))
      .filter(Boolean)
      .join(' / ');
    const styleSeed = draftStyle || tavernArchive || compactOpeningField(draft.tavern.story, 80) || '本次开局酒馆风格';
    const condition = normalizeCondition(draft.tavern.status);

    regions.value.filter(region => OPENING_CORE_REGION_NAMES.has(region.name)).forEach(region => {
      const record = asRecord(regionRoot[region.name]);
      if (regionRoot[region.name] !== record) regionRoot[region.name] = record;

      const currentStyle = String(readFirstPath(record, ['风格', 'style'], '') || '').trim();
      if (isDefaultOpeningRegionStyle(currentStyle, draftStyle)) {
        record['风格'] = `${styleSeed} · ${region.name}`;
      }

      const currentDescription = String(readFirstPath(record, ['描述', 'description'], '') || '').trim();
      if (!currentDescription || currentDescription === region.description) {
        const placePrefix = placeText ? `${placeText}中，` : '';
        const archiveHint = tavernArchive ? `酒馆档案要点：${tavernArchive}` : `开局故事要点：${compactOpeningField(draft.tavern.story, 120) || '以本次开局设定为准。'}`;
        record['描述'] = `${placePrefix}${region.name}按「${styleSeed}」重新布置，细节服务于本次开局而不是默认模板。${archiveHint}`;
      }

      if (!String(readFirstPath(record, ['状态', 'condition'], '') || '').trim()) {
        record['状态'] = region.name === draft.tavern.place ? condition : region.condition;
      }
      if (!record['设施'] || typeof record['设施'] !== 'object' || Array.isArray(record['设施'])) {
        record['设施'] = {};
      }
    });
  }

  function buildOpeningStatData(draft: OpeningWorkshopDraft, bundle: OpeningGenerationBundle) {
    if (!bundle.story.initvar || typeof bundle.story.initvar !== 'object') {
      throw new Error('开局 AI 没有生成有效 initvar，不能创建第 1 层。');
    }
    const statData = normalizeOpeningStatDataShape(mergePlainData(readInitStatData(), bundle.story.initvar));
    const tavernTerritory = draft.tavern.territory.trim() || draft.region.trim() || '韦斯托利亚';
    const tavernCity = draft.tavern.city.trim() || '布拉姆维克';
    const tavernPlace = draft.tavern.place.trim() || '主厅接待区';
    const tavernNameText = draft.tavern.name.trim() || '铁壶酒馆';
    const protagonistName = draft.character.name.trim() || '克斯';
    const protagonistRace = draft.character.race.trim() || '人类';
    const protagonistTitle = bundle.characterProfile.title || draft.character.race || '酒馆老板';
    setPlainPath(statData, '世界.时代', draft.era.trim() || '共栖历1303年');
    setPlainPath(statData, '世界.地区', tavernTerritory);
    setPlainPath(statData, '世界.当前地点.区域', tavernCity);
    setPlainPath(statData, '世界.当前地点.具体位置', tavernPlace);
    setPlainPath(statData, '酒馆.名称', tavernNameText);
    setPlainPath(statData, '酒馆.所属领地', tavernTerritory);
    setPlainPath(statData, '酒馆.所在城市', tavernCity);
    setPlainPath(statData, '酒馆.今日营业状态', draft.tavern.status.trim() || '准备营业');
    setPlainPath(
      statData,
      '酒馆.整体概况',
      bundle.tavernProfile.summary ||
        `${tavernNameText}位于${tavernCity}，当前只确认主厅、厨房、柜台和客房等基础空间；其他角落仍等待玩家在正文行动中清理、命名和改造。`,
    );
    const openingFunds = copperForOpeningFunds(draft.tavern.funds);
    const openingParts = copperToParts(openingFunds);
    setPlainPath(statData, '酒馆.资金.随身钱袋', {
      铜币: openingParts.copper,
      银币: openingParts.silver,
      金币: openingParts.gold,
      铂金币: openingParts.platinum,
      秘银币: openingParts.mithril,
      折算合计铜币: openingFunds,
    });
    setPlainPath(statData, '酒馆.资金.钱匣', { 铜币: 0, 银币: 0, 金币: 0, 铂金币: 0, 秘银币: 0, 折算合计铜币: 0 });
    setPlainPath(statData, '酒馆.资金.折算合计铜币', openingFunds);
    setPlainPath(statData, '主角.姓名', protagonistName);
    setPlainPath(statData, '主角.种族', protagonistRace);
    setPlainPath(statData, '主角.称号', protagonistTitle);
    setPlainPath(statData, '主角.当前状态', '准备营业');
    setPlainPath(statData, '主角.所在位置', tavernPlace);
    setPlainPath(statData, '主角.一句话穿着', draft.character.appearance.trim() || '衣着细节待叙事确认。');
    ensureOpeningTavernRegions(statData, draft, bundle);
    return statData;
  }

  function applyOpeningState(draft: OpeningWorkshopDraft, bundle: OpeningGenerationBundle) {
    const tavernCity = draft.tavern.city.trim() || '布拉姆维克';
    const tavernPlace = draft.tavern.place.trim() || '主厅接待区';
    calendar.year = 1303;
    calendar.monthIndex = 4;
    calendar.day = 17;
    calendar.clock = '18:24';
    calendar.timeOfDay = timeOfDayFromClock(calendar.clock) ?? '黄昏';
    clearWeatherForDay();

    tavernName.value = draft.tavern.name.trim() || '铁壶酒馆';
    tavernOverview.value =
      bundle.tavernProfile.summary ||
      `${tavernName.value}刚刚开张，只有主厅、厨房、柜台和客房等基础空间真正能用；其余空间仍等待玩家在剧情中整理出来。`;
    location.region = tavernCity;
    setCurrentPlace(tavernPlace, { keepShop: false });
    const openingMapNode = mapNodes.value.find(node => node.name === tavernCity || node.id === normalizeMapNodeId(tavernCity));
    if (openingMapNode) currentMapId.value = openingMapNode.id;
    walletCopper.value = copperForOpeningFunds(draft.tavern.funds);
    cashboxCopper.value = 0;
    reputation.value = /著名|热闹|富足/.test(draft.tavern.status) ? 18 : /破旧|拮据|冷清/.test(draft.tavern.status) ? 4 : 9;

    protagonist.name = draft.character.name.trim() || '克斯';
    protagonist.race = draft.character.race.trim() || '人类';
    protagonist.title = bundle.characterProfile.title || draft.character.race || '酒馆老板';
    protagonist.mood = '准备营业';
    protagonist.located = tavernPlace;
    protagonist.outfit = draft.character.appearance.trim() || protagonist.outfit;
    protagonist.bio = bundle.characterProfile.summary || bundle.characterProfile.profile || protagonist.bio;
    protagonist.hp = 100;
    protagonist.hpMax = 100;
    protagonist.energy = 100;
    protagonist.energyMax = 100;
    energy.value = 100;
    energy.max = 100;

    const regionCondition = normalizeCondition(draft.tavern.status);
    regions.value = regions.value.filter(region => OPENING_CORE_REGION_NAMES.has(region.name)).map(region => ({
      ...region,
      condition: region.name === tavernPlace || region.id === 'main-hall' ? regionCondition : region.condition,
    }));
    heroines.value = [];
    tavernNpcActivities.value = [];
    inventory.value = openingInventory(draft.tavern.stock);
    satchel.value = [];
    temporaryStates.value = emptyTemporaryStates();
    promiseMemos.value = [];
    recipes.value = [];
    generatedShop.value = null;
    generatedShopProducts.value = [];
    draftActions.value = [];
    farmPlots.value = [];
    brews.value = [];
    isBusinessOpen.value = false;
    currentGuests.value = 0;
    guestCap.value = DEFAULT_BUSINESS_GUEST_CAP;
    visitorChance.value = DEFAULT_BUSINESS_VISITOR_CHANCE;
    lastVisitorSeed.value = '';
    guestGroups.value = [];
    engineLogs.value = [];
    pushLog('系统', '自定义开局已创建。', { source: 'system', authoritative: true, tone: 'cyan', actionType: 'OPENING_CREATED' });
  }

  function describeHostError(error: unknown, fallback = '未知错误。') {
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error.trim() || fallback;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      /* ignore serialization errors */
    }
    return fallback;
  }

  async function confirmOpeningWorkshop(draft: OpeningWorkshopDraft, bundle: OpeningGenerationBundle) {
    let worldbookResult: Awaited<ReturnType<typeof writeOpeningWorldbook>>;
    try {
      worldbookResult = await writeOpeningWorldbook(draft, bundle);
    } catch (error) {
      const message = describeHostError(error, '世界书接口没有返回具体错误。');
      throw new Error(`写入世界书失败：${message}`);
    }
    applyOpeningState(draft, bundle);
    const message = formatOpeningAssistantMessage(bundle.story);
    const statData = buildOpeningStatData(draft, bundle);
    applyMvuStatData(statData, { restoreInventory: true });

    let messageId: number | undefined;
    try {
      if (typeof createChatMessages !== 'function') throw new Error('当前环境没有提供 createChatMessages 接口。');
      await createChatMessages(
        [
          {
            role: 'assistant',
            message,
            data: { stat_data: statData },
            extra: {
              primordia: {
                type: 'opening_story',
                savedAt: Date.now(),
                worldbookName: draft.worldbookName,
              },
            },
          },
        ],
        { refresh: 'none' },
      );
      messageId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
      if (typeof messageId === 'number') {
        await writePrimordiaStatData(statData, normalizeMessageVariableOption(messageId));
      }
    } catch (error) {
      const detail = describeHostError(error, '楼层接口没有返回具体错误。');
      throw new Error(`创建第 1 层开局消息失败：${detail}`);
    }

    openingSave.value = {
      completed: true,
      openingMessageId: messageId,
      fingerprint: buildOpeningFingerprintFromDraft(draft),
      worldbookName: draft.worldbookName,
      turnContextWorldbookBinding: clonePlain(worldbookResult.turnContextBinding),
      moduleResults: worldbookResult.moduleResults,
      completedAt: Date.now(),
      characterSummary: bundle.characterProfile.summary,
      tavernSummary: bundle.tavernProfile.summary,
      theme: draft.theme,
      era: draft.era,
      region: draft.tavern.territory || draft.region,
      tavernCity: draft.tavern.city,
      tavernPlace: draft.tavern.place,
    };
    turnContextWorldbookBinding.value = clonePlain(worldbookResult.turnContextBinding);
    turnContextWorldbookStatus.value = `本回合发送包条目已绑定：${worldbookResult.turnContextBinding.worldbookName} · uid ${worldbookResult.turnContextBinding.uid}`;
    await ensureDefaultWorldbookModules(draft.worldbookName);
    openingCompleted.value = true;
    openingRequired.value = false;
    openingWorkshopForced.value = false;
    currentTab.value = 'chronicle';

    await writeChatSave({
      maintext: bundle.story.maintext,
      options: bundle.story.options,
      sum: bundle.story.sum,
      messageId,
    });
    return worldbookResult;
  }

  function setTavernName(nextName: string) {
    const next = nextName.trim();
    if (!next) return false;
    tavernName.value = next;
    pushLog('系统', `酒馆招牌已改为「${next}」。`, {
      source: 'engine',
      authoritative: true,
      tone: 'cyan',
      actionType: 'TAVERN_RENAME',
    });
    void writeChatSave();
    return true;
  }

  function buildDebugSaveJson() {
    return JSON.stringify(buildChatSaveSnapshot(), null, 2);
  }

  function buildWorldbookScanPreview() {
    ensureWeatherForToday();
    const tags = [
      '[普利莫迪亚]',
      '地点来源:MVU变量',
      generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? '场景:商铺' : `场景:${currentSceneType.value}`,
      generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? `店主:${generatedShop.value.keeper}` : '',
      `日期:${dateText.value}`,
      `时间:${currentTimeOfDay.value} ${clockText.value}`,
      `天气:${calendar.weather}`,
      `酒馆:${tavernName.value}`,
    ].filter(Boolean);
    return tags.join('\n');
  }

  function buildLatestPromptPreview() {
    const activeShop = generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? generatedShop.value : null;
    const recent = engineLogs.value
      .slice(-8)
      .map(log => `${log.kind}: ${log.text}`)
      .join('\n');
    return [
      '【当前场景扫描词】',
      buildWorldbookScanPreview(),
      '',
      '【当前权威局势摘要】',
      `资金: 随身钱袋 ${walletText.value}；钱匣 ${cashboxText.value}；合计 ${treasuryText.value}`,
      `库存: ${inventory.value.length} 项`,
      `农田: ${farmPlots.value.length} 畦`,
      `酒窖: ${brews.value.length} 桶`,
      activeShop ? `商铺快照: ${activeShop.name} / ${generatedShopProducts.value.length} 项货架` : '商铺快照: 无',
      '',
      '【前端结算快照】',
      formatSystemJudgementBlock(),
      '',
      '【最近行动日志】',
      recent || '暂无日志',
    ].join('\n');
  }

  function runReadonlyHealthCheck(): HealthCheckItem[] {
    const checks: HealthCheckItem[] = [];
    const add = (ok: boolean, title: string, detail: string, tone?: HealthCheckItem['tone']) => {
      checks.push({ ok, title, detail, tone: tone ?? (ok ? 'good' : 'bad') });
    };

    add(walletCopper.value >= 0, '随身钱袋非负', walletCopper.value >= 0 ? `当前 ${walletText.value}` : `随身钱袋出现负数: ${walletCopper.value}`);
    add(cashboxCopper.value >= 0, '钱匣非负', cashboxCopper.value >= 0 ? `当前 ${cashboxText.value}` : `钱匣出现负数: ${cashboxCopper.value}`);
    add(treasuryCopper.value >= 0, '资金合计非负', treasuryCopper.value >= 0 ? `合计 ${treasuryText.value}` : `资金合计出现负数: ${treasuryCopper.value}`);
    add(Boolean(location.region && location.place && protagonist.located), '地点完整', `区域「${location.region || '空'}」 · 地点「${location.place || '空'}」 · 主角「${protagonist.located || '空'}」`);

    const judgement = buildSystemJudgementSnapshot();
    const sceneTypeMatches = judgement.scene.sceneType === currentSceneType.value;
    const placeMatches = judgement.scene.place === location.place && judgement.scene.protagonistLocated === protagonist.located;
    add(
      sceneTypeMatches && placeMatches,
      '前端快照一致',
      sceneTypeMatches && placeMatches
        ? `最终判定锁定在「${currentSceneLabel()}」 / ${judgement.scene.sceneType}`
        : `最终判定与界面不同步：判定「${judgement.scene.place}」/「${judgement.scene.protagonistLocated}」/${judgement.scene.sceneType}，界面「${location.place}」/「${protagonist.located}」/${currentSceneType.value}`,
      sceneTypeMatches && placeMatches ? 'good' : 'bad',
    );

    const validCategories: InventoryItem['category'][] = ['食材', '调料', '成品', '酒水', '杂物'];
    const invalidInventory = inventory.value.filter(item => item.qty < 0 || !item.name || !validCategories.includes(item.category));
    add(invalidInventory.length === 0, '库存结构', invalidInventory.length === 0 ? `${inventory.value.length} 项库存均有效` : `${invalidInventory.length} 项库存数量或分类异常: ${invalidInventory.map(item => item.name || item.id).join('、')}`);

    const zeroInventory = inventory.value.filter(item => item.qty === 0);
    add(zeroInventory.length === 0, '零数量清理', zeroInventory.length === 0 ? '没有残留零数量物品' : `${zeroInventory.length} 项物品数量为 0，建议清理`, zeroInventory.length === 0 ? 'good' : 'warn');

    const pendingCrafts = inventory.value.filter(item => /待命名|待判定/.test(item.name));
    add(
      pendingCrafts.length <= 1,
      '制作占位',
      pendingCrafts.length <= 1
        ? pendingCrafts.length === 0
          ? '没有待命名成品占位'
          : `当前仅有 1 个待命名占位: ${pendingCrafts[0].name}`
        : `发现 ${pendingCrafts.length} 个待命名占位，可能存在做菜结果没有正确回填或生成了双份成品: ${pendingCrafts.map(item => item.name).join('、')}`,
      pendingCrafts.length <= 1 ? 'good' : 'bad',
    );

    const shopActive = Boolean(generatedShop.value && isCurrentShopLocation(generatedShop.value.name));
    add(
      !generatedShop.value || shopActive || !isShopLikePlace(currentPlaceText()),
      '商铺快照一致',
      !generatedShop.value
        ? '当前没有临时商铺快照'
        : shopActive
          ? `当前位置与「${generatedShop.value.name}」一致，货架 ${generatedShopProducts.value.length} 项`
          : !isShopLikePlace(currentPlaceText())
            ? `当前位置不是商铺，旧货架「${generatedShop.value.name}」会被前端忽略`
            : `当前位置像商铺，但与「${generatedShop.value.name}」不一致`,
      !generatedShop.value || shopActive || !isShopLikePlace(currentPlaceText()) ? 'good' : 'bad',
    );
    add(
      !shopActive || generatedShopProducts.value.length > 0,
      '当前商铺货架',
      !shopActive
        ? '当前不在临时商铺，无需货架'
        : generatedShopProducts.value.length > 0
          ? `当前商铺「${generatedShop.value?.name}」有 ${generatedShopProducts.value.length} 项货架`
          : `当前位置显示在「${generatedShop.value?.name}」，但货架为空。请检查本楼层 <shop> 是否被解析或读档快照是否缺货架。`,
      !shopActive || generatedShopProducts.value.length > 0 ? 'good' : 'bad',
    );

    const badShopStock = generatedShopProducts.value.filter(item => item.stock < 0 || item.priceCopper < 0);
    add(badShopStock.length === 0, '货架数量/价格', badShopStock.length === 0 ? '货架数量与价格没有负数' : `${badShopStock.length} 项货架异常: ${badShopStock.map(item => item.name).join('、')}`);

    const badPlots = farmPlots.value.filter(plot => plot.stage < 0 || plot.stage > plot.stageMax || (plot.crop !== '空畦' && (!plot.plantedDay || !plot.matureDay)));
    add(badPlots.length === 0, '农田队列', badPlots.length === 0 ? `${farmPlots.value.length} 块田畦状态正常` : `${badPlots.length} 块田畦日期或阶段异常: ${badPlots.map(plot => plot.id).join('、')}`);

    const badBrews = brews.value.filter(barrel => barrel.startedDay > barrel.matureDay || !barrel.name);
    add(badBrews.length === 0, '酒窖队列', badBrews.length === 0 ? `${brews.value.length} 只桶位状态正常` : `${badBrews.length} 只酒桶开始日/成熟日异常: ${badBrews.map(barrel => barrel.name || barrel.id).join('、')}`);

    const floorSnapshots = readStoredFloorSnapshots();
    add(Object.keys(floorSnapshots).length > 0, '读档快照', Object.keys(floorSnapshots).length > 0 ? `已保存 ${Object.keys(floorSnapshots).length} 个楼层快照` : '还没有可恢复的楼层快照', Object.keys(floorSnapshots).length > 0 ? 'good' : 'warn');

    const storedSystemJudgement = (() => {
      try {
        return readChatVariable<PrimordiaChatSaveSnapshot>(PRIMORDIA_CHAT_SAVE_KEY)?.systemJudgement;
      } catch {
        return undefined;
      }
    })();
    const storedScene = storedSystemJudgement?.scene;
    const storedMatchesCurrent =
      !storedScene ||
      (storedScene.place === location.place &&
        storedScene.protagonistLocated === protagonist.located &&
        storedScene.sceneType === currentSceneType.value &&
        (storedSystemJudgement.activeShopName || '') === (generatedShop.value && isCurrentShopLocation(generatedShop.value.name) ? generatedShop.value.name : ''));
    add(
      Boolean(storedSystemJudgement) && storedMatchesCurrent,
      '聊天变量快照',
      !storedSystemJudgement
        ? '聊天变量里还没有前端快照，发送或保存一回合后会生成。'
        : storedMatchesCurrent
          ? `聊天变量快照与当前界面一致：${storedScene?.place || '未知地点'} / ${storedScene?.sceneType || '未知场景'}`
          : `聊天变量快照与当前界面不同步：变量「${storedScene?.place || '空'}」/「${storedScene?.protagonistLocated || '空'}」/${storedScene?.sceneType || '空'}，界面「${location.place}」/「${protagonist.located}」/${currentSceneType.value}`,
      Boolean(storedSystemJudgement) && storedMatchesCurrent ? 'good' : storedSystemJudgement ? 'bad' : 'warn',
    );

    const floorEntries = Object.entries(floorSnapshots)
      .map(([messageId, snapshot]) => ({ messageId, numericId: Number(messageId), snapshot }))
      .sort((a, b) => a.numericId - b.numericId);
    const malformedFloors = floorEntries.filter(({ snapshot }) => {
      const record = snapshot as Partial<PrimordiaSaveBody>;
      return !record.location || !Array.isArray(record.inventory) || !record.calendar || !record.latestStory;
    });
    add(
      malformedFloors.length === 0,
      '楼层快照完整性',
      malformedFloors.length === 0
        ? '已保存的楼层快照都包含正文、地点、库存和时间'
        : `${malformedFloors.length} 个楼层快照缺少关键字段: ${malformedFloors.map(item => `#${item.messageId}`).join('、')}`,
      malformedFloors.length === 0 ? 'good' : 'warn',
    );

    const inventoryDrop = floorEntries.find((entry, index) => {
      if (index === 0) return false;
      const prev = floorEntries[index - 1].snapshot.inventory ?? [];
      const curr = entry.snapshot.inventory ?? [];
      return Array.isArray(prev) && Array.isArray(curr) && prev.length >= 5 && curr.length <= Math.max(1, Math.floor(prev.length * 0.35));
    });
    add(
      !inventoryDrop,
      '库存连续性',
      !inventoryDrop
        ? '楼层快照里没有发现库存突然大面积消失'
        : `楼层 #${inventoryDrop.messageId} 的库存数量较前一楼层骤降，可能出现整段库房覆盖或读档快照不完整。`,
      !inventoryDrop ? 'good' : 'bad',
    );

    add(engineLogs.value.length > 0, '行动日志', engineLogs.value.length > 0 ? `最近保留 ${engineLogs.value.length} 条日志` : '暂无行动日志', engineLogs.value.length > 0 ? 'good' : 'warn');
    return checks;
  }

  async function importDebugSaveJson(text: string) {
    try {
      const parsed = JSON.parse(text);
      const snapshot = parsed?.save && parsed?.schemaVersion ? parsed.save : parsed;
      if (!normalizeSaveSnapshot(snapshot)) {
        pushLog('提示', '导入失败：这不是普利莫迪亚主存档 JSON。', {
          source: 'engine',
          authoritative: true,
          tone: 'red',
          actionType: 'IMPORT_SAVE',
        });
        return false;
      }
      applyChatSaveSnapshot(snapshot as PrimordiaChatSaveSnapshot, { allowOlder: true });
      await writeChatSave();
      pushLog('系统', '主存档已导入并写回当前聊天变量。', {
        source: 'engine',
        authoritative: true,
        tone: 'cyan',
        actionType: 'IMPORT_SAVE',
      });
      return true;
    } catch (error) {
      console.warn('[primordia] import debug save failed:', error);
      pushLog('提示', '导入失败：JSON 格式无法读取。', {
        source: 'engine',
        authoritative: true,
        tone: 'red',
        actionType: 'IMPORT_SAVE',
      });
      return false;
    }
  }

  function stableShopProductId(shopName: string, product: ParsedShop['products'][number], index: number) {
    const key = [shopName, product.name, product.category, index]
      .map(part => String(part ?? '').trim().replace(/\s+/g, '_'))
      .filter(Boolean)
      .join('-');
    return `ai-shop-${key || index}`;
  }

  function applyGeneratedShop(shop: ParsedShop, options: { silent?: boolean; setLocation?: boolean } = {}) {
    const firstCategory = shop.products[0]?.category ?? '杂物';
    generatedShop.value = {
      id: 'ai-generated-shop',
      name: shop.name,
      kind: normalizeShopKind(firstCategory),
      keeper: shop.keeper || '陌生店主',
      greeting: shop.keeper ? `${shop.keeper}抬眼看向你。` : '店主抬眼看向你。',
      atmosphere: shop.description || '这是一处刚刚在当前场景里找到的临时商铺。',
      tags: [...new Set(shop.products.flatMap(product => product.tags))].slice(0, 6),
    };
    generatedShopProducts.value = shop.products.map((product, index) => ({
      id: stableShopProductId(shop.name, product, index),
      name: product.name,
      shop: shop.name,
      category: normalizeInventoryCategory(product.category),
      priceCopper: product.priceCopper,
      stock: product.stock,
      tags: product.tags,
      desc: product.desc,
    }));
    if (options.setLocation !== false) setCurrentPlace(shop.name, { keepShop: true });
    if (!options.silent) markLocalStateDirty();
    if (!options.silent) pushLog('叙事', `AI商铺已载入 · ${shop.name} · 货架 ${generatedShopProducts.value.length} 项`, {
      source: 'ai',
      authoritative: false,
      tone: 'violet',
    });
  }

  function persistParsedShopIntoMvuData(data: PrimordiaStatData, shop: ParsedShop) {
    if (!data.街坊商铺 || typeof data.街坊商铺 !== 'object' || Array.isArray(data.街坊商铺)) data.街坊商铺 = {};
    const streetShopRoot = data.街坊商铺 as Record<string, any>;
    if (!streetShopRoot.商铺 || typeof streetShopRoot.商铺 !== 'object' || Array.isArray(streetShopRoot.商铺)) {
      streetShopRoot.商铺 = {};
    }
    const shops = streetShopRoot.商铺 as Record<string, any>;
    const existingShop = asRecord(shops[shop.name]);
    const firstCategory = shop.products[0]?.category ?? '杂物';
    shops[shop.name] = {
      ...existingShop,
      类型: existingShop['类型'] ?? normalizeShopKind(firstCategory),
      店主: shop.keeper || existingShop['店主'] || existingShop['掌柜'] || existingShop['老板'] || '',
      氛围: shop.description || existingShop['氛围'] || existingShop['描述'] || '',
      描述: shop.description || existingShop['描述'] || existingShop['氛围'] || '',
      今日货架: Object.fromEntries(
        shop.products.map(product => [
          product.name,
          {
            名称: product.name,
            分类: normalizeInventoryCategory(product.category),
            单价铜币: product.priceCopper,
            数量: product.stock,
            标签: clonePlain(product.tags ?? []),
            描述: product.desc ?? '',
          },
        ]),
      ),
    };
    streetShopRoot.当前商铺 = shop.name;

    if (!data.世界 || typeof data.世界 !== 'object' || Array.isArray(data.世界)) data.世界 = {};
    const world = data.世界 as Record<string, any>;
    if (!world.当前地点 || typeof world.当前地点 !== 'object' || Array.isArray(world.当前地点)) {
      world.当前地点 = { 区域: location.region || '', 具体位置: shop.name };
    } else {
      world.当前地点.具体位置 = shop.name;
    }
    if (!data.主角 || typeof data.主角 !== 'object' || Array.isArray(data.主角)) data.主角 = {};
    (data.主角 as Record<string, any>).所在位置 = shop.name;
  }

  function clearGeneratedShop(options: { silent?: boolean } = {}) {
    generatedShop.value = null;
    generatedShopProducts.value = [];
    if (!options.silent) {
      markLocalStateDirty();
      pushLog('系统', '已清空临时商铺货架。', {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
        actionType: 'CLEAR_SHOP',
      });
    }
  }

  function readMvuShopRecord(data: PrimordiaStatData) {
    return readRecordPath(data, [...legacyPathAliases('街坊商铺.商铺'), '街坊商铺.店铺']);
  }

  function readMvuCurrentShopName(data: PrimordiaStatData) {
    const currentShopName = String(readFirstPath(data, legacyPathAliases('街坊商铺.当前商铺'), '') || '').trim();
    if (currentShopName) return currentShopName;
    const variablePlaceText = readMvuPlaceText(data);
    const shopRecord = readMvuShopRecord(data);
    return Object.keys(shopRecord).find(shopName => variablePlaceMatchesShopName(shopName, variablePlaceText)) ?? '';
  }

  function readGeneratedShopFromMvuData(data: PrimordiaStatData, preferredShopName = ''): ParsedShop | undefined {
    const shopRecord = readMvuShopRecord(data);
    const currentShopName = preferredShopName.trim() || readMvuCurrentShopName(data);
    const rawShop = currentShopName ? asRecord(shopRecord[currentShopName]) : {};
    if (!currentShopName || Object.keys(rawShop).length === 0) return undefined;

    const rawShelf =
      rawShop['今日货架'] ??
      rawShop['货架'] ??
      rawShop['商品'] ??
      rawShop['货物'] ??
      rawShop['商品列表'] ??
      rawShop['出售商品'] ??
      rawShop['服务'] ??
      rawShop['products'] ??
      rawShop['items'];
    const shelfEntries = Array.isArray(rawShelf)
      ? rawShelf.map((value, index) => {
          const item = asRecord(value);
          return [String(item['名称'] ?? item['商品名'] ?? item['name'] ?? `商品${index + 1}`), value] as const;
        })
      : Object.entries(asRecord(rawShelf));
    const products: ParsedShop['products'] = shelfEntries.map(([name, value]) => {
      const item = asRecord(value);
      return {
        name: String(item['名称'] ?? item['商品名'] ?? item['name'] ?? name),
        category: normalizeInventoryCategory(String(item['分类'] || item['类型'] || '杂物')),
        priceCopper: readCopperValue(item, ['单价铜币', '价格铜币', '单价折合铜币', '价格折合铜币', 'priceCopper', '价格'], 0),
        stock: Math.max(0, Math.floor(readLooseNumber(item, ['数量', '余数量', '库存', 'stock', 'count'], 0))),
        tags: Array.isArray(item['标签']) ? item['标签'].map(tag => String(tag).trim()).filter(Boolean) : String(item['标签'] || '').split(/[、,，]/).map(tag => tag.trim()).filter(Boolean),
        desc: String(item['备注'] ?? item['描述'] ?? ''),
      };
    }).filter(product => product.name && product.stock >= 0);

    if (products.length === 0) return undefined;
    return {
      name: currentShopName,
      keeper: String(rawShop['店主'] ?? rawShop['掌柜'] ?? rawShop['老板'] ?? ''),
      description: String(rawShop['氛围'] ?? rawShop['描述'] ?? ''),
      products,
    };
  }

  function applyGeneratedShopFromMvuData(data: PrimordiaStatData, options: { silent?: boolean; setLocation?: boolean; shopName?: string } = {}) {
    const shop = readGeneratedShopFromMvuData(data, options.shopName);
    if (!shop) return false;
    applyGeneratedShop(shop, options);
    return true;
  }

  function applyTimeFromMvuData(data: PrimordiaStatData) {
    let appliedExplicitTime = false;
    const nextYear = readNumberPath(data, ['世界.当前历法.年', '世界.当前历法.year'], undefined);
    if (nextYear !== undefined) {
      calendar.year = Math.max(1, Math.floor(nextYear));
      appliedExplicitTime = true;
    }

    const nextMonthIndex = readNumberPath(data, ['世界.当前历法.月份序号', '世界.当前历法.月序号', '世界.当前历法.monthIndex'], undefined);
    const nextMonthName = String(readFirstPath(data, ['世界.当前历法.月份名', '世界.当前历法.月', '世界.当前历法.monthName'], '') || '').trim();
    if (nextMonthIndex !== undefined) {
      calendar.monthIndex = Math.max(0, Math.min(months.length - 1, Math.floor(nextMonthIndex) - 1));
      appliedExplicitTime = true;
    } else if (nextMonthName) {
      const index = months.indexOf(nextMonthName);
      if (index >= 0) {
        calendar.monthIndex = index;
        appliedExplicitTime = true;
      }
    }

    const nextDay = readNumberPath(data, ['世界.当前历法.日', '世界.当前历法.day'], undefined);
    if (nextDay !== undefined) {
      calendar.day = Math.max(1, Math.min(30, Math.floor(nextDay)));
      appliedExplicitTime = true;
    }

    const clockTextFromMvu = String(
      readFirstPath(data, [...legacyPathAliases('世界.当前历法.时间'), '世界.当前历法.钟点', '世界.当前历法.clock'], '') || '',
    ).trim();
    const clockMatch = clockTextFromMvu.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if (clockMatch) {
      const [, hourRaw, minuteRaw] = clockMatch;
      const hour = Math.max(0, Math.min(23, Math.floor(Number(hourRaw) || 0)));
      const minute = Math.max(0, Math.min(59, Math.floor(Number(minuteRaw) || 0)));
      calendar.clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      calendar.timeOfDay = timeOfDayFromClock(calendar.clock) ?? calendar.timeOfDay;
      appliedExplicitTime = true;
    } else {
      const nextHour = readNumberPath(data, ['世界.当前历法.时', '世界.当前历法.小时', '世界.当前历法.hour'], undefined);
      const nextMinute = readNumberPath(data, ['世界.当前历法.分', '世界.当前历法.分钟', '世界.当前历法.minute'], undefined);
      if (nextHour !== undefined || nextMinute !== undefined) {
        const current = clockToMinutes(calendar.clock);
        const hour = Math.max(0, Math.min(23, Math.floor(nextHour ?? Math.floor(current / 60))));
        const minute = Math.max(0, Math.min(59, Math.floor(nextMinute ?? current % 60)));
        calendar.clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        calendar.timeOfDay = timeOfDayFromClock(calendar.clock) ?? calendar.timeOfDay;
        appliedExplicitTime = true;
      }
    }

    ensureWeatherForToday();
    if (appliedExplicitTime) lastTickAt.value = Date.now();
  }

  function applyCoreStatsFromMvuData(data: PrimordiaStatData) {
    const readMoneyBucket = (basePath: string) => {
      let total = readNumberPath(data, [`${basePath}.折算合计铜币`], undefined);
      if (total === undefined) {
        const copper = readNumberPath(data, [`${basePath}.铜币`], 0) ?? 0;
        const silver = readNumberPath(data, [`${basePath}.银币`], 0) ?? 0;
        const gold = readNumberPath(data, [`${basePath}.金币`], 0) ?? 0;
        const platinum = readNumberPath(data, [`${basePath}.铂金币`], 0) ?? 0;
        const mithril = readNumberPath(data, [`${basePath}.秘银币`], 0) ?? 0;
        const sum =
          copper +
          silver * COIN_PER_SILVER +
          gold * COIN_PER_SILVER * SILVER_PER_GOLD +
          platinum * COIN_PER_SILVER * SILVER_PER_GOLD * GOLD_PER_PLATINUM +
          mithril * COIN_PER_SILVER * SILVER_PER_GOLD * GOLD_PER_PLATINUM * PLATINUM_PER_MITHRIL;
        if (sum > 0) total = sum;
      }
      if (total === undefined) return undefined;
      if (total < 0) {
        pushLog('提示', `${basePath} 余额不足，已忽略本次负数资金更新。`, { tone: 'red' });
        return undefined;
      }
      return Math.floor(total);
    };

    const nextWallet = readMoneyBucket('酒馆.资金.随身钱袋');
    const nextCashbox = readMoneyBucket('酒馆.资金.钱匣');
    if (nextWallet !== undefined) walletCopper.value = nextWallet;
    if (nextCashbox !== undefined) cashboxCopper.value = nextCashbox;
    if (nextWallet === undefined && nextCashbox === undefined) {
      let nextMoney = readNumberPath(data, ['酒馆.资金.折算合计铜币', ...legacyPathAliases('酒馆.资金铜币'), '酒馆.钱袋铜币', '酒馆.资金.铜币'], undefined);
      if (nextMoney === undefined) {
        const copper = readNumberPath(data, ['酒馆.资金.铜币'], 0) ?? 0;
        const silver = readNumberPath(data, ['酒馆.资金.银币'], 0) ?? 0;
        const gold = readNumberPath(data, ['酒馆.资金.金币'], 0) ?? 0;
        const platinum = readNumberPath(data, ['酒馆.资金.铂金币'], 0) ?? 0;
        const mithril = readNumberPath(data, ['酒馆.资金.秘银币'], 0) ?? 0;
      const total =
        copper +
        silver * COIN_PER_SILVER +
        gold * COIN_PER_SILVER * SILVER_PER_GOLD +
        platinum * COIN_PER_SILVER * SILVER_PER_GOLD * GOLD_PER_PLATINUM +
        mithril * COIN_PER_SILVER * SILVER_PER_GOLD * GOLD_PER_PLATINUM * PLATINUM_PER_MITHRIL;
        if (total > 0) nextMoney = total;
      }
      if (nextMoney !== undefined) {
        if (nextMoney < 0) pushLog('提示', '资金余额不足，已忽略本次负数资金更新。', { tone: 'red' });
        else {
          walletCopper.value = Math.max(0, Math.floor(nextMoney));
          cashboxCopper.value = 0;
        }
      }
    }

    const nextReputation = readNumberPath(data, legacyPathAliases('酒馆.声望'), undefined);
    if (nextReputation !== undefined) reputation.value = Math.max(0, Math.min(100, Math.floor(nextReputation)));

    const nextName = String(readFirstPath(data, ['主角.姓名', '主角.name'], '') || '').trim();
    if (nextName && !/^<.*>$/.test(nextName)) protagonist.name = nextName;

    const nextRace = String(readFirstPath(data, ['主角.种族', '主角.race'], '') || '').trim();
    if (nextRace) protagonist.race = nextRace;

    const nextTitle = String(readFirstPath(data, ['主角.称号', '主角.身份', '主角.title'], '') || '').trim();
    if (nextTitle) protagonist.title = nextTitle;

    const nextMood = String(readFirstPath(data, ['主角.当前状态', '主角.状态', '主角.mood'], '') || '').trim();
    if (nextMood) protagonist.mood = nextMood;

    const nextOutfit = String(readFirstPath(data, ['主角.一句话穿着', '主角.穿着', '主角.outfit'], '') || '').trim();
    if (nextOutfit) protagonist.outfit = nextOutfit;

    const nextLocated = String(readFirstPath(data, ['主角.所在位置', '主角.位置', '主角.located'], '') || '').trim();
    if (nextLocated) setCurrentPlace(nextLocated, { keepShop: isShopLikePlace(nextLocated) || shopNameMatchesPlace(nextLocated, currentPlaceText()) });

    const nextEnergyMax = readNumberPath(data, ['主角.精力.上限', '主角.精力.最大值', '主角.精力.max'], undefined);
    if (nextEnergyMax !== undefined) {
      energy.max = Math.max(1, Math.floor(nextEnergyMax));
      protagonist.energyMax = energy.max;
      energy.value = Math.min(energy.value, energy.max);
      protagonist.energy = energy.value;
    }

    const nextEnergy = readNumberPath(data, ['主角.精力.当前值', '主角.精力.value', '主角.精力'], undefined);
    if (nextEnergy !== undefined) {
      energy.value = Math.max(0, Math.min(energy.max, Math.floor(nextEnergy)));
      protagonist.energy = energy.value;
    }

    const nextHp = readNumberPath(data, ['主角.生命.当前值', '主角.hp'], undefined);
    if (nextHp !== undefined) protagonist.hp = Math.max(0, Math.min(protagonist.hpMax, Math.floor(nextHp)));

    const nextHpMax = readNumberPath(data, ['主角.生命.上限', '主角.生命.最大值', '主角.hpMax'], undefined);
    if (nextHpMax !== undefined) {
      protagonist.hpMax = Math.max(1, Math.floor(nextHpMax));
      protagonist.hp = Math.min(protagonist.hp, protagonist.hpMax);
    }

    const nextCookingLevel = readNumberPath(data, ['主角.烹饪等级.等级', '主角.厨艺.等级', '主角.cookingLevel'], undefined);
    if (nextCookingLevel !== undefined) protagonist.cookingLevel = Math.max(1, Math.min(8, Math.floor(nextCookingLevel)));
    const nextCookingExp = readNumberPath(data, ['主角.烹饪等级.做菜次数', '主角.厨艺.做菜次数', '主角.cookingExp'], undefined);
    if (nextCookingExp !== undefined) protagonist.cookingExp = Math.max(0, Math.floor(nextCookingExp));
    const nextCookingExpMax = readNumberPath(data, ['主角.烹饪等级.下级所需次数', '主角.厨艺.下级所需次数', '主角.cookingExpMax'], undefined);
    if (nextCookingExpMax !== undefined) protagonist.cookingExpMax = Math.max(1, Math.floor(nextCookingExpMax));
  }

  function applyTavernStructureFromMvuData(data: PrimordiaStatData) {
    const regionRoot = readRecordPath(data, ['酒馆.区域', '酒馆.区域状态']);
    let changed = false;

    const overview = String(readFirstPath(data, ['酒馆.整体概况', '酒馆.概况', '酒馆.overview'], '') || '').trim();
    if (overview && overview !== tavernOverview.value) {
      tavernOverview.value = overview;
      changed = true;
    }

    for (const [regionName, raw] of Object.entries(regionRoot)) {
      const record = asRecord(raw);
      const region = ensureTavernRegionFromMvuName(regions.value, regionName, record);

      const condition = String(readFirstPath(record, ['状态', 'condition'], '') || '').trim();
      if (condition) {
        region.condition = normalizeCondition(condition);
        changed = true;
      }

      const style = String(readFirstPath(record, ['风格', 'style'], '') || '').trim();
      if (style) {
        region.style = style;
        changed = true;
      }

      const description = String(readFirstPath(record, ['描述', 'description'], '') || '').trim();
      if (description) {
        region.description = description;
        changed = true;
      }

      const staff = String(readFirstPath(record, ['分配员工', 'staff'], '') ?? '').trim();
      if (staff !== region.staff) {
        region.staff = staff;
        changed = true;
      }

      const facilities = readRecordPath(record, ['设施', 'facilities']);
      for (const [facilityName, facilityRaw] of Object.entries(facilities)) {
        const facilityRecord = asRecord(facilityRaw);
        const existing = region.facilities.find(item => item.name === facilityName || item.id === facilityName);
        const nextFacility: RegionFacility = {
          id: existing?.id ?? slugId(facilityName, `facility-${region.id}-${region.facilities.length + 1}`),
          name: facilityName,
          condition: normalizeCondition(String(readFirstPath(facilityRecord, ['状态', 'condition'], existing?.condition ?? '良好') || '良好')),
          style: String(readFirstPath(facilityRecord, ['风格', 'style'], existing?.style ?? '朴素') || '朴素'),
          description: String(readFirstPath(facilityRecord, ['描述', 'description'], existing?.description ?? `${facilityName}。`) || `${facilityName}。`),
          priceCopper: Math.max(0, Math.floor(readNumberPath(facilityRecord, ['价格折合铜币', 'priceCopper'], existing?.priceCopper ?? 0) ?? 0)),
        };
        if (existing) Object.assign(existing, nextFacility);
        else region.facilities.push(nextFacility);
        changed = true;
      }
    }

    const roomRoot = readRecordPath(data, ['酒馆.客房', '酒馆.房间']);
    const roomRegion = regions.value.find(region => region.id === 'rooms' || region.name === '客房');
    if (roomRegion && Object.keys(roomRoot).length > 0) {
      if (!roomRegion.rooms) roomRegion.rooms = [];
      for (const [roomName, raw] of Object.entries(roomRoot)) {
        const record = asRecord(raw);
        const room = roomRegion.rooms.find(item => item.name === roomName || item.id === roomName);
        const facilities = readRecordPath(record, ['设施', 'facilities']);
        const nextFacilities = Object.entries(facilities).map(([facilityName, facilityRaw], index) => {
          const facilityRecord = asRecord(facilityRaw);
          return {
            id: slugId(facilityName, `room-facility-${index + 1}`),
            name: facilityName,
            condition: normalizeCondition(String(readFirstPath(facilityRecord, ['状态', 'condition'], '良好') || '良好')),
            style: String(readFirstPath(facilityRecord, ['风格', 'style'], '朴素') || '朴素'),
            description: String(readFirstPath(facilityRecord, ['描述', 'description'], `${facilityName}。`) || `${facilityName}。`),
            priceCopper: Math.max(0, Math.floor(readNumberPath(facilityRecord, ['价格折合铜币', 'priceCopper'], 0) ?? 0)),
          };
        });
        const nextRoom: TavernRoom = {
          id: room?.id ?? slugId(roomName, `room-${roomRegion.rooms.length + 1}`),
          name: roomName,
          type: String(readFirstPath(record, ['类型', 'type'], room?.type ?? '客房') || '客房'),
          guest: String(readFirstPath(record, ['住客', 'guest'], room?.guest ?? '') ?? '').trim() || null,
          priceCopper: Math.max(0, Math.floor(readNumberPath(record, ['价格折合铜币', 'priceCopper'], room?.priceCopper ?? 0) ?? 0)),
          comfort: Math.max(0, Math.min(100, Math.floor(readNumberPath(record, ['舒适', 'comfort'], room?.comfort ?? 0) ?? 0))),
          privacy: Math.max(0, Math.min(100, Math.floor(readNumberPath(record, ['私密', 'privacy'], room?.privacy ?? 0) ?? 0))),
          cleanliness: Math.max(0, Math.min(100, Math.floor(readNumberPath(record, ['清洁', 'cleanliness'], room?.cleanliness ?? 0) ?? 0))),
          facilities: nextFacilities.length > 0 ? nextFacilities : clonePlain(room?.facilities ?? []),
        };
        if (room) Object.assign(room, nextRoom);
        else roomRegion.rooms.push(nextRoom);
        changed = true;
      }
    }

    return changed;
  }

  function applyRelationshipsFromMvuData(data: PrimordiaStatData) {
    const relationshipRoot = [
      readRecordPath(data, ['人物', '角色']),
      readRecordPath(data, ['人物羁绊', '人物关系', '角色羁绊']),
    ].reduce<Record<string, any>>((merged, source) => {
      Object.entries(source).forEach(([key, value]) => {
        const current = asRecord(merged[key]);
        const incoming = asRecord(value);
        merged[key] = Object.keys(current).length ? { ...current, ...incoming } : value;
      });
      return merged;
    }, {});
    if (Object.keys(relationshipRoot).length === 0) return false;
    let changed = false;

    const normalizeStage = (value: number | undefined, fallback = 1) => {
      const stage = value === undefined ? fallback : Math.floor(value);
      return Math.max(1, Math.min(stageNames.length, stage));
    };
    const stageNameFromStage = (stage: number, fallback = stageNames[0]) => stageNames[Math.max(0, Math.min(stageNames.length - 1, stage - 1))] ?? fallback;
    const readGauge = (record: Record<string, any>, root: string, fallback: number) =>
      readNumberPath(record, [`${root}.当前值`, `${root}.value`, root], fallback) ?? fallback;
    const readGaugeMax = (record: Record<string, any>, root: string, fallback: number) =>
      readNumberPath(record, [`${root}.上限`, `${root}.最大值`, `${root}.max`], fallback) ?? fallback;

    Object.entries(relationshipRoot).forEach(([key, raw], index) => {
      const record = asRecord(raw);
      const rawName = String(readFirstPath(record, ['姓名', '名称', 'name'], key) || key).trim();
      if (!rawName || heroines.value.some(heroine => heroine.name === rawName || heroine.id === key)) return;
      const raceText = String(readFirstPath(record, ['种族', 'race'], '') || '').trim();
      const titleText = String(readFirstPath(record, ['身份', '称号', 'title'], '') || '').trim();
      const locatedText = String(readFirstPath(record, ['所在位置', '位置', 'located'], '') || '').trim();
      const outfitText = String(readFirstPath(record, ['一句话穿着', '穿着', 'outfit'], '') || '').trim();
      const hasEnoughIdentity = Boolean(raceText && titleText && (locatedText || outfitText));
      if (!hasEnoughIdentity) return;
      const stage = normalizeStage(readNumberPath(record, ['羁绊阶段', '阶段', 'stage'], 1), 1);
      const hpMax = readGaugeMax(record, '生命', 100);
      const energyMax = readGaugeMax(record, '精力', 100);
      const bladderMax = readGaugeMax(record, '膀胱', 100);
      const affectionMax = readGaugeMax(record, '好感', 100);
      heroines.value.push({
        id: slugId(rawName || key, `heroine-${heroines.value.length + 1}`),
        name: rawName,
        race: raceText,
        title: titleText,
        stage,
        stageName: String(readFirstPath(record, ['阶段文字', '阶段名', 'stageName'], stageNameFromStage(stage)) || stageNameFromStage(stage)),
        hp: Math.max(0, Math.min(hpMax, Math.floor(readGauge(record, '生命', hpMax)))),
        hpMax,
        energy: Math.max(0, Math.min(energyMax, Math.floor(readGauge(record, '精力', energyMax)))),
        energyMax,
        bladder: Math.max(0, Math.min(bladderMax, Math.floor(readGauge(record, '膀胱', 0)))),
        bladderMax,
        affection: Math.max(0, Math.min(affectionMax, Math.floor(readNumberPath(record, ['好感', '好感度', 'affection'], 0) ?? 0))),
        affectionMax,
        isMain: true,
        mood: String(readFirstPath(record, ['心情', '状态', 'mood'], '平静') || '平静'),
        located: normalizeScenePlaceName(locatedText || location.place) || location.place,
        outfit: outfitText,
        gift: String(readFirstPath(record, ['偏好礼物', '礼物', 'gift'], '') || ''),
        portraitColor: heroinePortraitColors[index % heroinePortraitColors.length],
        bio: String(readFirstPath(record, ['备注', '描述', 'bio'], '') || ''),
      });
      changed = true;
    });

    heroines.value.forEach(heroine => {
      const record = asRecord(relationshipRoot[heroine.name] ?? relationshipRoot[heroine.id]);
      if (Object.keys(record).length === 0) return;

      const race = String(readFirstPath(record, ['种族', 'race'], '') || '').trim();
      if (race) {
        heroine.race = race;
        changed = true;
      }

      const title = String(readFirstPath(record, ['身份', '称号', 'title'], '') || '').trim();
      if (title) {
        heroine.title = title;
        changed = true;
      }

      const stage = readNumberPath(record, ['羁绊阶段', '阶段', 'stage'], undefined);
      if (stage !== undefined) {
        heroine.stage = normalizeStage(stage, heroine.stage);
        heroine.stageName = String(readFirstPath(record, ['阶段文字', '阶段名', 'stageName'], stageNameFromStage(heroine.stage, heroine.stageName)) || heroine.stageName);
        changed = true;
      }

      const stageText = String(readFirstPath(record, ['阶段文字', '阶段名', 'stageName'], '') || '').trim();
      if (stageText) {
        heroine.stageName = stageText;
        changed = true;
      }

      const affectionMax = readGaugeMax(record, '好感', heroine.affectionMax);
      if (affectionMax !== heroine.affectionMax) {
        heroine.affectionMax = affectionMax;
        heroine.affection = Math.min(heroine.affection, heroine.affectionMax);
        changed = true;
      }

      const affection = readNumberPath(record, ['好感', '好感度', 'affection'], undefined);
      if (affection !== undefined) {
        heroine.affection = Math.max(0, Math.min(heroine.affectionMax, Math.floor(affection)));
        changed = true;
      }

      const hpMax = readGaugeMax(record, '生命', heroine.hpMax);
      if (hpMax !== heroine.hpMax) {
        heroine.hpMax = hpMax;
        heroine.hp = Math.min(heroine.hp, heroine.hpMax);
        changed = true;
      }
      const hp = readNumberPath(record, ['生命.当前值', '生命', 'hp'], undefined);
      if (hp !== undefined) {
        heroine.hp = Math.max(0, Math.min(heroine.hpMax, Math.floor(hp)));
        changed = true;
      }

      const energyMax = readGaugeMax(record, '精力', heroine.energyMax);
      if (energyMax !== heroine.energyMax) {
        heroine.energyMax = energyMax;
        heroine.energy = Math.min(heroine.energy, heroine.energyMax);
        changed = true;
      }
      const energyNow = readNumberPath(record, ['精力.当前值', '精力', 'energy'], undefined);
      if (energyNow !== undefined) {
        heroine.energy = Math.max(0, Math.min(heroine.energyMax, Math.floor(energyNow)));
        changed = true;
      }

      const bladderMax = readGaugeMax(record, '膀胱', heroine.bladderMax);
      if (bladderMax !== heroine.bladderMax) {
        heroine.bladderMax = bladderMax;
        heroine.bladder = Math.min(heroine.bladder, heroine.bladderMax);
        changed = true;
      }
      const bladder = readNumberPath(record, ['膀胱.当前值', '膀胱', 'bladder'], undefined);
      if (bladder !== undefined) {
        heroine.bladder = Math.max(0, Math.min(heroine.bladderMax, Math.floor(bladder)));
        changed = true;
      }

      const mood = String(readFirstPath(record, ['心情', '状态', 'mood'], '') || '').trim();
      if (mood) {
        heroine.mood = mood;
        changed = true;
      }

      const located = String(readFirstPath(record, ['所在位置', '位置', 'located'], '') || '').trim();
      if (located) {
        heroine.located = normalizeScenePlaceName(located) || located;
        changed = true;
      }

      const outfit = String(readFirstPath(record, ['一句话穿着', '穿着', 'outfit'], '') || '').trim();
      if (outfit) {
        heroine.outfit = outfit;
        changed = true;
      }

      const bio = String(readFirstPath(record, ['备注', '描述', 'bio'], '') || '').trim();
      if (bio) {
        heroine.bio = bio;
        changed = true;
      }
    });

    return changed;
  }

  function plotIndexFromKey(key: string) {
    const match = key.match(/(\d+)/);
    return match ? Math.max(1, Number(match[1])) : undefined;
  }

  function applyFarmBrewFromMvuData(data: PrimordiaStatData) {
    const farmRoot = readRecordPath(data, ['农田与酒窖.农田', '农田.田畦', '农田']);
    let changed = false;

    for (const [key, raw] of Object.entries(farmRoot)) {
      const record = asRecord(raw);
      const index = plotIndexFromKey(key);
      if (!index) continue;
      let plot = farmPlots.value.find(item => item.id === `f-${index}`);
      if (!plot) {
        plot = {
          id: `f-${index}`,
          crop: '空畦',
          stage: 0,
          stageMax: 5,
          season: '尚未种植',
          expectedHarvest: '选择种子播种',
          batchTags: [],
        };
        farmPlots.value.push(plot);
      }

      const rawCrop = readFirstPath<any>(record, ['作物', 'crop'], undefined);
      const crop = rawCrop === undefined || rawCrop === null ? undefined : String(rawCrop).trim();
      const status = String(readFirstPath(record, ['状态', 'season'], '') || '').trim();
      const expectedHarvest = String(readFirstPath(record, ['预计产出', 'expectedHarvest'], '') || '').trim();
      const plantedDay = dayNumberFromValue(readFirstPath(record, ['播种日', 'plantedDay'], undefined), plot.plantedDay);
      const matureDay = dayNumberFromValue(readFirstPath(record, ['收获日', '成熟日', 'matureDay'], undefined), plot.matureDay);
      const stage = readNumberPath(record, ['阶段', 'stage'], undefined);
      const stageMax = readNumberPath(record, ['阶段上限', 'stageMax'], undefined);
      const batchTagsRaw = readFirstPath<any>(record, ['批次标签', '标签', 'batchTags'], undefined);

      if (crop !== undefined) plot.crop = crop || '空畦';
      if (status) plot.season = status;
      if (expectedHarvest) plot.expectedHarvest = expectedHarvest;
      if (plantedDay !== undefined) plot.plantedDay = plantedDay;
      if (matureDay !== undefined) plot.matureDay = matureDay;
      if (stageMax !== undefined) plot.stageMax = Math.max(1, Math.floor(stageMax));
      if (stage !== undefined) plot.stage = Math.max(0, Math.min(plot.stageMax, Math.floor(stage)));
      if (Array.isArray(batchTagsRaw)) plot.batchTags = batchTagsRaw.map(tag => String(tag).trim()).filter(Boolean);
      else if (typeof batchTagsRaw === 'string') plot.batchTags = batchTagsRaw.split(/[、,，]/).map(tag => tag.trim()).filter(Boolean);
      changed = true;
    }

    const brewRoot = readRecordPath(data, ['农田与酒窖.酒窖桶', '农田与酒窖.酒窖', '酒窖桶', '酒窖']);
    for (const [key, raw] of Object.entries(brewRoot)) {
      const record = asRecord(raw);
      const name = String(readFirstPath(record, ['内容物', '名称', 'name'], key) || key).trim();
      const status = String(readFirstPath(record, ['状态', 'filling'], '') || '').trim();
      const emptied = !name || name === '无' || /已开桶|空桶|已灌装|已取出|无/.test(status);
      if (emptied) {
        const before = brews.value.length;
        brews.value = brews.value.filter(item => item.name !== key && item.id !== key && item.name !== name);
        if (brews.value.length !== before) changed = true;
        continue;
      }
      if (!name) continue;
      let barrel = brews.value.find(item => item.name === name || item.id === key);
      const startedDay = dayNumberFromValue(readFirstPath(record, ['酿造开始日', '开始日', 'startedDay'], undefined), currentCalendarDay());
      const matureDay = dayNumberFromValue(readFirstPath(record, ['收获日', '预计收获日', '成熟日', 'matureDay'], undefined), startedDay + 3);
      const brewType = String(readFirstPath(record, ['类型', 'type'], '') || '').trim();
      if (!barrel) {
        barrel = {
          id: `brew-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          startedDay: startedDay ?? currentCalendarDay(),
          matureDay: matureDay ?? currentCalendarDay() + 3,
          expected: String(readFirstPath(record, ['预计产出', 'expected'], name) || name),
          filling: status || '陈酿中',
          brewType: brewType || '酒水',
        };
        brews.value.push(barrel);
      } else {
        barrel.startedDay = startedDay ?? barrel.startedDay;
        barrel.matureDay = matureDay ?? barrel.matureDay;
        barrel.expected = String(readFirstPath(record, ['预计产出', 'expected'], barrel.expected) || barrel.expected);
        barrel.filling = status || barrel.filling;
        if (brewType) barrel.brewType = brewType;
      }
      changed = true;
    }

    return changed;
  }

  function readMvuPlaceText(data: PrimordiaStatData) {
    const worldLocation = readFirstPath<any>(data, legacyPathAliases('世界.当前地点'), undefined);
    return String(
      readFirstPath(
        data,
        [
          '世界.当前地点.具体位置',
          '世界.当前地点.地点',
          '主角.所在位置',
          ...legacyPathAliases('世界.当前地点.具体位置'),
          ...legacyPathAliases('世界.当前地点.地点'),
          ...legacyPathAliases('主角.所在位置'),
        ],
        typeof worldLocation === 'string' ? worldLocation : '',
      ) || '',
    ).trim();
  }

  function applySceneLocationOnlyFromMvu(data: PrimordiaStatData) {
    const nextRegion = String(
      readFirstPath(data, legacyPathAliases('世界.当前地点.区域'), '') || location.region || '',
    ).trim();
    const mvuCurrentShopName = readMvuCurrentShopName(data);
    const rawNextPlace = readMvuPlaceText(data);
    const normalizedRawPlace = normalizeScenePlaceName(rawNextPlace);
    const shouldPreferShopName =
      mvuCurrentShopName &&
      (!normalizedRawPlace ||
        isGenericStreetEntrance(normalizedRawPlace) ||
        variablePlaceMatchesShopName(mvuCurrentShopName, normalizedRawPlace));
    const nextPlace = shouldPreferShopName ? mvuCurrentShopName : rawNextPlace;
    if (nextRegion) location.region = nextRegion;
    if (!nextPlace) return false;
    const keepShop = Boolean(
      shouldPreferShopName ||
      (mvuCurrentShopName && variablePlaceMatchesShopName(mvuCurrentShopName, nextPlace)) ||
      (generatedShop.value && variablePlaceMatchesShopName(generatedShop.value.name, nextPlace)),
    );
    const changed = setCurrentPlace(nextPlace, { region: nextRegion || undefined, keepShop });
    if (!keepShop) clearGeneratedShop({ silent: true });
    return changed;
  }

  function readInventoryCollectionFromMvuData(data: PrimordiaStatData, rootName: '库房' | '行囊', previous: InventoryItem[]) {
    const categories = ['食材', '调料', '成品', '酒水', '杂物'] as const;
    const nextInventory: InventoryItem[] = [];
    const storageRoot = readRecordPath(data, legacyPathAliases(rootName));
    const hasStorageData = Object.keys(storageRoot).length > 0 || categories.some(category => readPath(data, `${rootName}.${category}`, undefined) !== undefined);
    if (!hasStorageData) return null;
    for (const category of categories) {
      const record = asRecord(storageRoot[category] ?? readPath(data, `${rootName}.${category}`, {}));
      for (const [name, raw] of Object.entries(record)) {
        const item = asRecord(raw);
        const qty = Math.max(0, Math.floor(readLooseNumber(item, ['数量', 'qty', 'count'], 0)));
        if (!name || qty <= 0) continue;
        const tags = Array.isArray(item['标签']) ? item['标签'].map(tag => String(tag).trim()).filter(Boolean) : [];
        const existingRecipeSource = previous.find(
          existing =>
            existing.name === name &&
            existing.category === category &&
            sameTagSet(existing.tags, tags) &&
            existing.recipeSource,
        )?.recipeSource;
        nextInventory.push({
          id: `${category}-${name}-${nextInventory.length}`,
          name,
          category,
          qty,
          priceCopper: readCopperValue(item, ['价格铜币', '单价铜币', '单价折合铜币', '价格折合铜币', 'priceCopper', '价格'], 0),
          tags,
          quality: (category === '成品' || category === '酒水') ? String(item['搭配判定'] ?? item['品质'] ?? item['quality'] ?? '无冲突') as InventoryItem['quality'] : undefined,
          desc: String(item['备注'] ?? item['描述'] ?? ''),
          ...(existingRecipeSource ? { recipeSource: clonePlain(existingRecipeSource) } : {}),
        });
      }
    }
    return nextInventory;
  }

  function inventorySignature(items: InventoryItem[]) {
    return JSON.stringify(items.map(item => ({
      name: item.name,
      category: item.category,
      qty: item.qty,
      priceCopper: item.priceCopper ?? 0,
      tags: item.tags ?? [],
      quality: item.quality ?? '',
      desc: item.desc ?? '',
    })));
  }

  function applyInventoryFromMvuData(data: PrimordiaStatData) {
    const nextInventory = readInventoryCollectionFromMvuData(data, '库房', inventory.value);
    if (!nextInventory) return false;
    const before = inventorySignature(inventory.value);
    const after = inventorySignature(nextInventory);
    inventory.value = nextInventory;
    return before !== after;
  }

  function applySatchelFromMvuData(data: PrimordiaStatData) {
    const nextSatchel = readInventoryCollectionFromMvuData(data, '行囊', satchel.value);
    if (!nextSatchel) return false;
    const before = inventorySignature(satchel.value);
    const after = inventorySignature(nextSatchel);
    satchel.value = nextSatchel;
    return before !== after;
  }

  function applyTemporaryStatesFromMvuData(data: PrimordiaStatData) {
    const raw = readFirstPath(data, ['临时状态', ...legacyPathAliases('临时状态')], undefined);
    if (raw === undefined) return false;
    const next = normalizeTemporaryStateTree(raw);
    const before = JSON.stringify(temporaryStates.value);
    const after = JSON.stringify(next);
    temporaryStates.value = next;
    return before !== after;
  }

  function applyMvuStatData(data: PrimordiaStatData, options: { restoreInventory?: boolean } = {}) {
    const mvuCurrentShopName = readMvuCurrentShopName(data);
    const mvuPlaceText = readMvuPlaceText(data);
    currentVariableShopName.value = mvuCurrentShopName;
    currentVariablePlaceText.value = mvuPlaceText;
    applySceneLocationOnlyFromMvu(data);
    applyTimeFromMvuData(data);
    applyCoreStatsFromMvuData(data);
    applyTavernStructureFromMvuData(data);
    applyRelationshipsFromMvuData(data);
    applyFarmBrewFromMvuData(data);

    if (options.restoreInventory) {
      applyInventoryFromMvuData(data);
      applySatchelFromMvuData(data);
    }
    applyTemporaryStatesFromMvuData(data);

    const shopNameFromPlace =
      generatedShop.value && mvuPlaceText && variablePlaceMatchesShopName(generatedShop.value.name, mvuPlaceText)
        ? generatedShop.value.name
        : '';
    const activeVariableShopName = mvuCurrentShopName || shopNameFromPlace;
    const restoredShopFromMvu = mvuCurrentShopName
      ? applyGeneratedShopFromMvuData(data, { silent: true, setLocation: false, shopName: mvuCurrentShopName })
      : false;
    if (mvuCurrentShopName && restoredShopFromMvu) {
      if (!currentPlaceText().includes(mvuCurrentShopName)) setCurrentPlace(mvuCurrentShopName, { keepShop: true });
    } else if (activeVariableShopName && generatedShop.value && variablePlaceMatchesShopName(generatedShop.value.name, activeVariableShopName)) {
      // The exact location still comes from 世界.当前地点.具体位置; this branch only keeps the shelf active.
    } else if (mvuCurrentShopName && generatedShop.value?.name !== mvuCurrentShopName) {
      const recoveredShop = findNearestShopBefore(undefined, mvuCurrentShopName);
      if (recoveredShop) applyGeneratedShop(recoveredShop, { silent: true });
    } else if (!activeVariableShopName && !isCurrentShopLocation()) {
      clearGeneratedShop({ silent: true });
    }

    const currentMapName = String(readFirstPath(data, ['地图.当前地点', '地图.当前节点', '地图.current', '世界.当前地点.区域'], location.region) || location.region);
    const currentMapNode = mapNodes.value.find(node => node.name === currentMapName || node.id === normalizeMapNodeId(currentMapName));
    if (currentMapNode) currentMapId.value = currentMapNode.id;
    syncGeneratedShopWithLocation();
    return true;
  }

  async function writeCurrentMessageStatData(statData: PrimordiaStatData, preferredMessageId?: number) {
    const latestAssistantMessageId =
      preferredMessageId === undefined && typeof getChatMessages === 'function'
        ? getChatMessages(-1, { role: 'assistant' })?.at(-1)?.message_id
        : undefined;
    const latestMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
    const currentMessageId = typeof getCurrentMessageId === 'function' ? getCurrentMessageId() : undefined;
    const messageId =
      typeof preferredMessageId === 'number'
        ? preferredMessageId
        : typeof latestAssistantMessageId === 'number'
          ? latestAssistantMessageId
          : typeof latestMessageId === 'number'
            ? latestMessageId
            : typeof currentMessageId === 'number'
              ? currentMessageId
              : undefined;
    const target = normalizeMessageVariableOption(messageId);
    try {
      return await writePrimordiaStatData(clonePlainData(statData), target);
    } catch (error) {
      console.warn('[primordia] 写入楼层 stat_data 失败:', error);
    }
    return false;
  }

  async function setFrontendMvuValue(path: string, value: unknown) {
    const normalizedPath = path
      .replace(/^\/+/, '')
      .replace(/\//g, '.')
      .split('.')
      .map(part => part.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
      .join('.');
    if (!normalizedPath) return false;

    const nextData = buildFrontendMvuSnapshot('变量总览手动编辑');
    setPlainPath(nextData, normalizedPath, value);
    applyMvuStatData(nextData, { restoreInventory: true });
    const wroteMessage = await writeCurrentMessageStatData(nextData);
    await writeChatSave();
    pushLog('系统', `变量已手动修改：${normalizedPath}`, {
      source: 'engine',
      authoritative: true,
      tone: wroteMessage ? 'cyan' : 'amber',
      actionType: 'VARIABLE_EDIT',
    });
    return true;
  }

  async function deleteHeroine(heroineId: string) {
    const heroine = heroines.value.find(item => item.id === heroineId);
    if (!heroine) return false;

    heroines.value = heroines.value.filter(item => item.id !== heroineId);
    delete characterWorldbookBindings.value[heroine.id];
    delete characterBehaviorLibraries.value[heroine.id];
    delete temporaryStates.value.人物[heroine.name];
    if (selectedHeroineId.value === heroine.id) selectedHeroineId.value = heroines.value[0]?.id ?? null;

    const nextData = buildFrontendMvuSnapshot(`手动删除配角：${heroine.name}`);
    applyMvuStatData(nextData, { restoreInventory: true });
    const wroteMessage = await writeCurrentMessageStatData(nextData);
    await writeChatSave();
    pushLog('系统', `已删除配角「${heroine.name}」。`, {
      source: 'engine',
      authoritative: true,
      tone: wroteMessage ? 'cyan' : 'amber',
      actionType: 'CHARACTER_DELETE',
    });
    return true;
  }

  async function setFrontendMvuData(data: Record<string, unknown>) {
    const nextData = clonePlainData(data);
    applyMvuStatData(nextData, { restoreInventory: true });
    const wroteMessage = await writeCurrentMessageStatData(nextData);
    await writeChatSave();
    pushLog('系统', '变量总览已手动保存完整变量。', {
      source: 'engine',
      authoritative: true,
      tone: wroteMessage ? 'cyan' : 'amber',
      actionType: 'VARIABLE_EDIT',
    });
    return true;
  }

  async function cleanupLegacyCharacterAlias() {
    const statData = readMessageStatData();
    if (!statData) {
      pushLog('系统', '没有读到当前楼层变量，无法清理旧人物字段。', {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
        actionType: 'VARIABLE_EDIT',
      });
      return false;
    }

    const hasLegacyCharacters = Object.prototype.hasOwnProperty.call(statData, '人物');
    const hasRelationshipCharacters =
      statData.人物羁绊 && typeof statData.人物羁绊 === 'object' && !Array.isArray(statData.人物羁绊);

    if (!hasLegacyCharacters || !hasRelationshipCharacters) {
      pushLog('系统', '当前楼层没有需要清理的旧人物字段。', {
        source: 'engine',
        authoritative: true,
        tone: 'cyan',
        actionType: 'VARIABLE_EDIT',
      });
      return false;
    }

    const nextData = clonePlainData(statData);
    delete nextData.人物;
    applyMvuStatData(nextData, { restoreInventory: true });
    const wroteMessage = await writeCurrentMessageStatData(nextData);
    await writeChatSave();
    pushLog('系统', '已清理当前楼层旧人物字段，保留正式人物羁绊。', {
      source: 'engine',
      authoritative: true,
      tone: wroteMessage ? 'cyan' : 'amber',
      actionType: 'VARIABLE_EDIT',
    });
    return wroteMessage;
  }
  const mvuReloadSuppressedUntil = ref(0);

  function syncFrontendFromMessageMvu(options: { messageId?: number; restoreInventory?: boolean } = {}) {
    const statData = readMessageStatData(options.messageId);
    if (!statData) return false;
    applyMvuStatData(statData, { restoreInventory: options.restoreInventory ?? true });
    syncGeneratedShopWithLocation(options.messageId);
    return true;
  }

  function statDataWithCurrentTemporaryStates(statData: PrimordiaStatData) {
    const nextData = clonePlainData(statData);
    setPlainPath(nextData, '临时状态', clonePlain(temporaryStates.value));
    return nextData;
  }

  function countInventoryItemsFromMvu(data: PrimordiaStatData, rootName: '库房' | '行囊') {
    const root = readRecordPath(data, [rootName]);
    return Object.values(root).reduce((sum, category) => sum + Object.keys(asRecord(category)).length, 0);
  }

  function logMvuSyncMismatches(data: PrimordiaStatData) {
    const mismatches: string[] = [];
    const mvuEnergy = readNumberPath(data, ['主角.精力.当前值'], undefined);
    if (mvuEnergy !== undefined && Math.floor(mvuEnergy) !== Math.floor(energy.value)) mismatches.push(`主角精力 ${energy.value}/${mvuEnergy}`);
    const mvuPlace = String(readFirstPath(data, ['主角.所在位置', '世界.当前地点.具体位置'], '') || '').trim();
    if (mvuPlace && normalizeScenePlaceName(mvuPlace) !== normalizeScenePlaceName(location.place)) mismatches.push(`主角位置 ${location.place}/${mvuPlace}`);
    const mvuRegionCount = Object.keys(readRecordPath(data, ['酒馆.区域'])).length;
    if (mvuRegionCount && mvuRegionCount !== regions.value.length) mismatches.push(`酒馆区域 ${regions.value.length}/${mvuRegionCount}`);
    const mvuInventoryCount = countInventoryItemsFromMvu(data, '库房');
    if (mvuInventoryCount && mvuInventoryCount !== inventory.value.length) mismatches.push(`库房 ${inventory.value.length}/${mvuInventoryCount}`);
    const mvuSatchelCount = countInventoryItemsFromMvu(data, '行囊');
    if (mvuSatchelCount && mvuSatchelCount !== satchel.value.length) mismatches.push(`行囊 ${satchel.value.length}/${mvuSatchelCount}`);

    for (const heroine of heroines.value) {
      const record = asRecord(readFirstPath(data, [`人物羁绊.${heroine.name}`, `人物.${heroine.name}`], undefined));
      if (!Object.keys(record).length) continue;
      const mood = String(readFirstPath(record, ['心情', '状态'], '') || '').trim();
      if (mood && mood !== heroine.mood) mismatches.push(`${heroine.name}心情 ${heroine.mood}/${mood}`);
      const place = String(readFirstPath(record, ['所在位置', '位置'], '') || '').trim();
      if (place && normalizeScenePlaceName(place) !== normalizeScenePlaceName(heroine.located)) mismatches.push(`${heroine.name}位置 ${heroine.located}/${place}`);
      const tempCount = normalizeTemporaryStateList(readFirstPath(data, [`临时状态.人物.${heroine.name}`], [])).length;
      const uiTempCount = temporaryStates.value.人物[heroine.name]?.length ?? 0;
      if (tempCount !== uiTempCount) mismatches.push(`${heroine.name}临时状态 ${uiTempCount}/${tempCount}`);
    }

    if (mismatches.length) {
      pushLog('系统', `MVU同步自检发现差异：${mismatches.slice(0, 6).join('；')}`, {
        source: 'engine',
        authoritative: true,
        tone: 'amber',
        actionType: 'MVU_SYNC_CHECK',
      });
    }
  }

  function loadFromMvu(options: { messageId?: number; force?: boolean } = {}) {
    if (!options.force && Date.now() < mvuReloadSuppressedUntil.value) return false;
    const currentLastMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : undefined;
    if (
      options.messageId === undefined &&
      typeof currentLastMessageId === 'number' &&
      currentLastMessageId <= 0 &&
      !openingCompleted.value &&
      !openingSave.value?.completed
    ) {
      return false;
    }
    return syncFrontendFromMessageMvu({ messageId: options.messageId, restoreInventory: true });
  }

  async function bindCharacterWorldbookEntry(heroineId: string, binding: Omit<CharacterWorldbookBinding, 'id' | 'boundAt'> & { id?: string; boundAt?: number }) {
    const key = String(heroineId || '').trim();
    const worldbookName = String(binding.worldbookName || '').trim();
    const uid = Number(binding.uid);
    if (!key || !worldbookName || !Number.isFinite(uid)) return false;

    const current = [...(characterWorldbookBindings.value[key] ?? [])];
    const existingIndex = current.findIndex(item => item.worldbookName === worldbookName && item.uid === uid);
    const nextBinding: CharacterWorldbookBinding = {
      id: binding.id || `${worldbookName}:${uid}`,
      worldbookName,
      uid,
      label: binding.label,
      boundAt: binding.boundAt ?? Date.now(),
      updatedAt: binding.updatedAt,
    };
    if (existingIndex >= 0) current.splice(existingIndex, 1, { ...current[existingIndex], ...nextBinding });
    else current.push(nextBinding);
    characterWorldbookBindings.value = { ...characterWorldbookBindings.value, [key]: current };
    await writeChatSave();
    return true;
  }

  async function unbindCharacterWorldbookEntry(heroineId: string, worldbookName: string, uid: number) {
    const key = String(heroineId || '').trim();
    const current = characterWorldbookBindings.value[key] ?? [];
    const next = current.filter(item => !(item.worldbookName === worldbookName && item.uid === uid));
    if (next.length === current.length) return false;
    characterWorldbookBindings.value = { ...characterWorldbookBindings.value, [key]: next };
    await writeChatSave();
    return true;
  }

  async function touchCharacterWorldbookBinding(heroineId: string, worldbookName: string, uid: number, label?: string) {
    const key = String(heroineId || '').trim();
    const current = [...(characterWorldbookBindings.value[key] ?? [])];
    const index = current.findIndex(item => item.worldbookName === worldbookName && item.uid === uid);
    if (index < 0) return false;
    current[index] = { ...current[index], label: label ?? current[index].label, updatedAt: Date.now() };
    characterWorldbookBindings.value = { ...characterWorldbookBindings.value, [key]: current };
    await writeChatSave();
    return true;
  }

  function validTavernRegionNames() {
    return regions.value.map(region => region.name).filter(Boolean);
  }

  function findHeroineForBehaviorUpdate(update: ParsedCharacterBehaviorUpdate) {
    const id = String(update.characterId ?? '').trim();
    const name = String(update.character ?? '').trim();
    if (id) {
      const byId = heroines.value.find(heroine => heroine.id === id);
      if (byId) return byId;
    }
    if (!name) return null;
    return heroines.value.find(heroine => heroine.name === name || heroine.title === name) ?? null;
  }

  function findCharacterBehaviorBinding(heroine: Heroine) {
    const expectedName = characterBehaviorEntryName(heroine.name);
    return (characterWorldbookBindings.value[heroine.id] ?? []).find(binding => {
      const label = String(binding.label || '');
      return label === expectedName || isCharacterBehaviorEntryName(label);
    });
  }

  async function ensureCharacterBehaviorLibraryBinding(heroine: Heroine) {
    const existing = findCharacterBehaviorBinding(heroine);
    if (existing) return existing;
    const ensured = await ensureCharacterBehaviorWorldbookEntry(heroine.id, heroine.name);
    const binding: CharacterWorldbookBinding = {
      id: `character-behavior:${ensured.worldbookName}:${ensured.uid}`,
      worldbookName: ensured.worldbookName,
      uid: ensured.uid,
      label: ensured.entryName,
      boundAt: Date.now(),
      updatedAt: Date.now(),
    };
    await bindCharacterWorldbookEntry(heroine.id, binding);
    return binding;
  }

  async function loadCharacterBehaviorLibraryForHeroine(heroineId: string) {
    const heroine = heroines.value.find(item => item.id === heroineId);
    if (!heroine) return null;
    const binding = await ensureCharacterBehaviorLibraryBinding(heroine);
    const library = await loadCharacterBehaviorLibraryFromEntry(binding, heroine.id, heroine.name);
    characterBehaviorLibraries.value = { ...characterBehaviorLibraries.value, [heroine.id]: clonePlain(library) };
    await touchCharacterWorldbookBinding(heroine.id, binding.worldbookName, Number(binding.uid), binding.label);
    return library;
  }

  async function saveCharacterBehaviorLibraryForHeroine(heroineId: string, library: CharacterBehaviorLibrary) {
    const heroine = heroines.value.find(item => item.id === heroineId);
    if (!heroine) return false;
    const binding = await ensureCharacterBehaviorLibraryBinding(heroine);
    await saveCharacterBehaviorLibraryToEntry(binding, library);
    characterBehaviorLibraries.value = { ...characterBehaviorLibraries.value, [heroine.id]: clonePlain(library) };
    await touchCharacterWorldbookBinding(heroine.id, binding.worldbookName, Number(binding.uid), binding.label);
    await writeChatSave();
    return true;
  }

  async function applyCharacterBehaviorUpdates(updates: ParsedCharacterBehaviorUpdate[] | undefined, completedTurn: number) {
    if (!updates?.length) return false;
    const grouped = new Map<string, { heroine: Heroine; updates: ParsedCharacterBehaviorUpdate[] }>();
    let unknownCharacters = 0;
    updates.forEach(update => {
      const heroine = findHeroineForBehaviorUpdate(update);
      if (!heroine) {
        unknownCharacters += 1;
        return;
      }
      const current = grouped.get(heroine.id);
      if (current) current.updates.push(update);
      else grouped.set(heroine.id, { heroine, updates: [update] });
    });

    let changed = false;
    let learned = 0;
    let unlocated = 0;
    for (const { heroine, updates: heroineUpdates } of grouped.values()) {
      try {
        const binding = await ensureCharacterBehaviorLibraryBinding(heroine);
        const existing = characterBehaviorLibraries.value[heroine.id]
          ? clonePlain(characterBehaviorLibraries.value[heroine.id])
          : await loadCharacterBehaviorLibraryFromEntry(binding, heroine.id, heroine.name);
        const result = applyCharacterBehaviorUpdatesToLibrary(existing, heroineUpdates, validTavernRegionNames(), completedTurn);
        if (!result.changed) continue;
        await saveCharacterBehaviorLibraryToEntry(binding, existing);
        characterBehaviorLibraries.value = { ...characterBehaviorLibraries.value, [heroine.id]: clonePlain(existing) };
        await touchCharacterWorldbookBinding(heroine.id, binding.worldbookName, Number(binding.uid), binding.label);
        changed = true;
        learned += result.learned;
        unlocated += result.unlocated;
        if (result.ignoredUnknownRegion.length) {
          pushLog('提示', `角色行为库收到未定位区域：${heroine.name} · ${result.ignoredUnknownRegion.join('、')}。未创建新区域。`, {
            source: 'ai',
            authoritative: false,
            tone: 'amber',
            actionType: 'CHARACTER_BEHAVIOR',
          });
        }
      } catch (error) {
        pushLog('提示', `角色行为库写入失败：${heroine.name} · ${error instanceof Error ? error.message : String(error)}`, {
          source: 'engine',
          authoritative: true,
          tone: 'red',
          actionType: 'CHARACTER_BEHAVIOR',
        });
      }
    }

    if (unknownCharacters) {
      pushLog('提示', `角色行为库忽略了 ${unknownCharacters} 条未知角色更新。`, {
        source: 'ai',
        authoritative: false,
        tone: 'amber',
        actionType: 'CHARACTER_BEHAVIOR',
      });
    }
    if (changed) {
      markLocalStateDirty();
      await writeChatSave();
      pushLog('系统', `角色行为库已学习 ${learned} 条${unlocated ? `，其中 ${unlocated} 条暂未定位到现有区域` : ''}。`, {
        source: 'ai',
        authoritative: false,
        tone: 'violet',
        actionType: 'CHARACTER_BEHAVIOR',
      });
    }
    return changed;
  }

  async function addCharacterBehavior(heroineId: string, input: Partial<CharacterBehaviorItem>) {
    const heroine = heroines.value.find(item => item.id === heroineId);
    if (!heroine) return false;
    const library = characterBehaviorLibraries.value[heroine.id]
      ? clonePlain(characterBehaviorLibraries.value[heroine.id])
      : createEmptyCharacterBehaviorLibrary(heroine.id, heroine.name);
    const behavior = String(input.behavior ?? '').trim();
    if (!behavior) return false;
    const update: ParsedCharacterBehaviorUpdate = {
      action: 'learn',
      character: heroine.name,
      characterId: heroine.id,
      region: String(input.region ?? heroine.located ?? '').trim(),
      behavior,
      behaviors: [behavior],
      trigger: String(input.trigger ?? 'manual').trim(),
      source: String(input.source ?? '玩家手动维护').trim(),
      protagonistFeel: String(input.protagonistFeel ?? '').trim(),
    };
    applyCharacterBehaviorUpdatesToLibrary(library, [update], validTavernRegionNames(), successfulNarrationTurn.value);
    return saveCharacterBehaviorLibraryForHeroine(heroine.id, library);
  }

  async function updateCharacterBehavior(heroineId: string, behaviorId: string, patch: Partial<CharacterBehaviorItem>) {
    const library = characterBehaviorLibraries.value[heroineId] ? clonePlain(characterBehaviorLibraries.value[heroineId]) : null;
    if (!library) return false;
    const updateItem = (item: CharacterBehaviorItem) => item.id === behaviorId ? { ...item, ...patch, updatedAt: Date.now() } : item;
    library.behaviors = library.behaviors.map(updateItem);
    library.unlocatedBehaviors = library.unlocatedBehaviors.map(updateItem);
    return saveCharacterBehaviorLibraryForHeroine(heroineId, library);
  }

  async function deleteCharacterBehavior(heroineId: string, behaviorId: string) {
    const library = characterBehaviorLibraries.value[heroineId] ? clonePlain(characterBehaviorLibraries.value[heroineId]) : null;
    if (!library) return false;
    const before = library.behaviors.length + library.unlocatedBehaviors.length;
    library.behaviors = library.behaviors.filter(item => item.id !== behaviorId);
    library.unlocatedBehaviors = library.unlocatedBehaviors.filter(item => item.id !== behaviorId);
    if (before === library.behaviors.length + library.unlocatedBehaviors.length) return false;
    return saveCharacterBehaviorLibraryForHeroine(heroineId, library);
  }

  async function loadFromLatestAssistantPatch(options: { force?: boolean } = {}) {
    if (!options.force && Date.now() < mvuReloadSuppressedUntil.value) return false;
    const latest = loadLatestAssistantMaintext();
    if (!latest.fullMessage?.trim()) return false;
    if (typeof latest.messageId === 'number' && readMessageStatData(latest.messageId)) return false;
    const previousStory = typeof latest.messageId === 'number'
      ? loadAssistantStoryIndex().filter(item => item.messageId < latest.messageId).at(-1)
      : undefined;
    const baseData = previousStory ? readMessageStatData(previousStory.messageId) ?? {} : readMessageStatData() ?? {};
    try {
      const result = await parseNarrativeMvuMessage(latest.fullMessage, baseData);
      if (!result.hasVariablePatch) return false;
      applyMvuStatData(result.mvuData, { restoreInventory: true });
      await writeCurrentMessageStatData(result.mvuData, latest.messageId);
      logMvuSyncMismatches(result.mvuData);
      syncGeneratedShopWithLocation(latest.messageId);
      return true;
    } catch (error) {
      console.warn('[primordia] 从最新楼层补丁同步失败:', error);
      return false;
    }
  }

  function restoreGeneratedShopFromLatestMessage(options: { clearWhenMissing?: boolean } = {}) {
    if (generatedShop.value && isCurrentShopLocation(generatedShop.value.name) && generatedShopProducts.value.length > 0) {
      return true;
    }

    if (loadedStoryCheckpoint.value?.shop) {
      if (currentSceneHasExactShop(loadedStoryCheckpoint.value.shop.name)) {
        applyGeneratedShop(loadedStoryCheckpoint.value.shop, { silent: true });
        return true;
      }
      if (options.clearWhenMissing) clearGeneratedShop({ silent: true });
      return false;
    }
    if (loadedStoryCheckpoint.value?.messageId) {
      const checkpointShopName = currentShopNameFromLocation();
      const recoveredShop = checkpointShopName
        ? findNearestShopBefore(loadedStoryCheckpoint.value.messageId, checkpointShopName)
        : undefined;
      if (recoveredShop) {
        applyGeneratedShop(recoveredShop, { silent: true, setLocation: false });
        loadedStoryCheckpoint.value = { ...loadedStoryCheckpoint.value, shop: recoveredShop };
        return true;
      }
    }
    const latest = loadLatestAssistantMaintext();
    if (latest.shop) {
      applyGeneratedShop(latest.shop, { silent: true });
      return true;
    }

    if (!latest.shop) {
      const currentShopName = currentShopNameFromLocation();
      const recoveredShop = currentShopName ? findNearestShopBefore(latest.messageId, currentShopName) : undefined;
      if (recoveredShop) {
        applyGeneratedShop(recoveredShop, { silent: true });
        return true;
      }
      if (options.clearWhenMissing && !isCurrentShopLocation()) clearGeneratedShop({ silent: true });
      return false;
    }
    if (options.clearWhenMissing && !isCurrentShopLocation()) clearGeneratedShop({ silent: true });
    return false;
  }

  const restoredFromChatSave = restoreFromChatSave();
  const syncedFromMvu = loadFromMvu({ force: true });
  if ((!restoredFromChatSave || heroines.value.length === 0) && !syncedFromMvu) loadFromMvu({ force: true });
  if (restoredFromChatSave && heroines.value.length > 0 && (openingCompleted.value || hasStartedNarrativeAfterBoot())) void writeChatSave();
  if (openingSave.value?.worldbookName && (openingCompleted.value || hasStartedNarrativeAfterBoot())) {
    void ensureDefaultWorldbookModules(openingSave.value.worldbookName);
  }
  lastTickAt.value = Date.now();

  /* 发送行动草稿到 LLM，并静默创建楼层 */
  async function submitNarrationPrompt(
    scenePrompt: string,
    combined: string,
    options: {
      reloadMvu?: boolean;
      applyInventoryFromMvu?: boolean;
      useFrontendAuthority?: boolean;
      npcActivityPlan?: TavernNpcActivityPlan | null;
      businessVisitorPlan?: TavernBusinessVisitorPlan | null;
    } = {},
  ): Promise<boolean> {
    const reloadMvu = options.reloadMvu ?? true;
    const applyInventoryPatch = options.applyInventoryFromMvu ?? reloadMvu;
    if (!turnContextWorldbookReady.value) {
      pushLog('提示', '本回合发送包条目未绑定或写入失败，已停止生成。', {
        source: 'engine',
        authoritative: true,
        tone: 'red',
      });
      return false;
    }
    if (!reloadMvu) mvuReloadSuppressedUntil.value = Date.now() + 8000;
    isGenerating.value = true;
    try {
      const duePromiseMemosForTurn = duePromiseMemos();
      const duePromiseMemoIds = duePromiseMemosForTurn.map(memo => memo.id);
      const scenePromptForRequest = appendDuePromiseMemoBlock(scenePrompt, duePromiseMemosForTurn);
      const temporaryStateKeysBeforeTurn = captureTemporaryStateKeys();
      const authoritativeData = options.useFrontendAuthority
        ? buildFrontendMvuSnapshot(combined)
        : buildAuthoritativeRequestData(combined);
      const isPrebuiltNarrationPrompt = /<玩家本回合行动>|【叙述者权限边界】|【当前权威局势】|【输出格式】/.test(scenePromptForRequest);
      const prebuiltAllowsVariablePatch =
        isPrebuiltNarrationPrompt &&
        !scenePromptForRequest.includes('前端已结算:') &&
        /自由行动造成的库存、状态或地点变化|若行动自然影响库存/.test(scenePromptForRequest);
      const canApplyScenePatch = true;
      const canApplyInventoryPatch = applyInventoryPatch && (!isPrebuiltNarrationPrompt || prebuiltAllowsVariablePatch);
      const result = await runUnifiedNarrativeRequest(scenePromptForRequest, {
        authoritativeData,
        turnContextWorldbookBinding: turnContextWorldbookBinding.value,
        worldbookScanText: buildWorldbookScanPreview(),
        enableStreamingMaintext: enableStoryStreaming.value,
        preserveNarrativeScene: canApplyScenePatch,
        allowGeneratedInventory: canApplyInventoryPatch,
        allowGeneratedStats: canApplyScenePatch,
        onTurnContextWorldbookWritten: binding => {
          turnContextWorldbookBinding.value = clonePlain(binding);
          turnContextWorldbookStatus.value = `最近写入：${new Date(binding.updatedAt ?? Date.now()).toLocaleString()} · ${binding.worldbookName} · uid ${binding.uid}`;
          pushLog('系统', `玩家行动已提交 · ${combined.slice(0, 24)}${combined.length > 24 ? '...' : ''}`, {
            source: 'player',
            authoritative: true,
            tone: 'cyan',
          });
          if (duePromiseMemosForTurn.length) {
            pushLog('系统', `本回合触发约定 ${duePromiseMemosForTurn.length} 条，已写入发送包。`, {
              source: 'engine',
              authoritative: true,
              tone: 'cyan',
              actionType: 'PROMISE_MEMO',
            });
          }
          pushLog('系统', `本回合发送包已写入世界书 · ${TURN_CONTEXT_WORLDBOOK_ENTRY_NAME}`, {
            source: 'engine',
            authoritative: true,
            tone: 'cyan',
            actionType: 'TURN_CONTEXT_WORLDBOOK_WRITE',
          });
        },
      });

      if (result.ok) {
        let finalMvuData = result.mvuData
          ? clonePlainData(result.mvuData)
          : options.useFrontendAuthority
            ? clonePlainData(authoritativeData)
            : null;
        if (finalMvuData && result.latest?.shop) {
          persistParsedShopIntoMvuData(finalMvuData, result.latest.shop);
        }
        const sceneUpdatedFromMvu =
          finalMvuData && canApplyScenePatch
            ? applySceneLocationOnlyFromMvu(finalMvuData)
            : false;
        if (result.mvuData && canApplyScenePatch && (sceneUpdatedFromMvu || result.hasScenePatch)) syncGeneratedShopWithLocation();
        if (finalMvuData) {
          applyMvuStatData(finalMvuData, { restoreInventory: true });
          const inventorySynced = applyInventoryPatch;
          const satchelSynced = applyInventoryPatch;
          const temporaryStatesSynced = applyTemporaryStatesFromMvuData(finalMvuData);
          await writeCurrentMessageStatData(finalMvuData, result.latest?.messageId);
          if (inventorySynced || satchelSynced) {
            pushLog('系统', `${inventorySynced && satchelSynced ? '库房与行囊' : inventorySynced ? '库房' : '行囊'}已按本回合变量/MVU结果同步。`, {
              source: 'ai',
              authoritative: false,
              tone: 'violet',
              actionType: 'MVU_INVENTORY_SYNC',
            });
          }
          if (temporaryStatesSynced) {
            pushLog('系统', '临时状态已按本回合变量/MVU结果同步。', {
              source: 'ai',
              authoritative: false,
              tone: 'violet',
              actionType: 'MVU_TEMPORARY_STATE_SYNC',
            });
          }
          logMvuSyncMismatches(finalMvuData);
        }
        if (result.latest?.craftResult) applyCraftResult(result.latest.craftResult);
        if (result.latest?.guestUpdates?.length) applyGuestUpdates(result.latest.guestUpdates, successfulNarrationTurn.value + 1);
        if (result.latest?.promiseUpdates?.length) applyPromiseUpdates(result.latest.promiseUpdates);
        const completedTurn = successfulNarrationTurn.value + 1;
        if (result.latest?.characterBehaviorUpdates?.length) {
          await applyCharacterBehaviorUpdates(result.latest.characterBehaviorUpdates, completedTurn);
        }
        if (result.latest?.shop) {
          applyGeneratedShop(result.latest.shop);
          currentTab.value = 'shop';
        } else if (!result.latest?.shop && result.mvuData && promptAcceptsGeneratedShop(scenePrompt)) {
          if (applyGeneratedShopFromMvuData(result.mvuData)) currentTab.value = 'shop';
        } else if (sceneUpdatedFromMvu && !isCurrentShopLocation()) clearGeneratedShop({ silent: true });
        commitTavernNpcActivityPlan(options.npcActivityPlan ?? null, completedTurn);
        commitManualWorkerAssignNpcActivities(completedTurn);
        commitBusinessVisitorPlan(options.businessVisitorPlan ?? null);
        markPromiseMemosTriggered(duePromiseMemoIds, completedTurn);
        const temporaryStatesTicked = decrementExistingTemporaryStates(temporaryStateKeysBeforeTurn);
        if (temporaryStatesTicked) {
          const countdownBase = finalMvuData ?? getAuthoritativeMvuData(result.latest?.messageId, '本回合临时状态倒计时');
          finalMvuData = statDataWithCurrentTemporaryStates(countdownBase);
          await writeCurrentMessageStatData(finalMvuData, result.latest?.messageId);
          applyTemporaryStatesFromMvuData(finalMvuData);
        }
        successfulNarrationTurn.value = completedTurn;
        clearActionDraft();
        playerInput.value = '';
        loadedStoryCheckpoint.value = null;
        storyContinuityOverride.value = null;
        localStateDirty.value = false;
        await writeChatSave(result.latest);
        pushLog('叙事', 'AI叙述已写入楼层并刷新前端。', {
          source: 'ai',
          authoritative: false,
          tone: 'violet',
        });
        return true;
      } else {
        pushLog('提示', result.error ?? '生成失败。', {
          source: 'engine',
          authoritative: true,
          tone: 'red',
        });
        return false;
      }
    } catch (error) {
      pushLog('提示', error instanceof Error ? error.message : '生成失败。', {
        source: 'engine',
        authoritative: true,
        tone: 'red',
      });
      return false;
    } finally {
      isGenerating.value = false;
    }
  }

  async function sendActionDraft(options: { reloadMvu?: boolean } = {}) {
    if (isGenerating.value) return;
    if (!actionDraft.value.trim() && !playerInput.value.trim()) return;
    lastTickAt.value = Date.now();
    const canContinue = await continueFromLoadedCheckpoint();
    if (!canContinue) return;
    const combined = [actionDraft.value.trim(), playerInput.value.trim()].filter(Boolean).join('\n—— 玩家旁白 ——\n');
    const isPrebuiltNarrationPrompt =
      /<玩家本回合行动>|【叙述者权限边界】|【当前权威局势】|【输出格式】/.test(combined) ||
      combined.includes('【系统已结算 / 权威局势】') ||
      combined.includes('【本回合标准结算单】');
    const customActionResult = isPrebuiltNarrationPrompt ? null : dispatchAction({ type: 'CUSTOM_ACTION', text: combined, title: '玩家本回合行动' });
    if (customActionResult && !customActionResult.ok) {
      pushLog('提示', customActionResult.message, {
        source: 'engine',
        authoritative: true,
        tone: 'red',
        actionType: 'CUSTOM_ACTION',
      });
      return;
    }
    const npcActivityPlan = isPrebuiltNarrationPrompt ? null : prepareTavernNpcActivityPlan(combined);
    const businessVisitorPlan = isPrebuiltNarrationPrompt ? null : prepareBusinessVisitorPlan();
    const scenePrompt = isPrebuiltNarrationPrompt
      ? combined
      : buildNarrationPrompt({
          userText: `<user>${combined}</user>`,
          actionType: 'CUSTOM_ACTION',
          actionTitle: '玩家本回合行动',
          aiHint: customActionResult?.aiHint,
          npcActivityPlan,
          businessVisitorPlan,
        });
    await submitNarrationPrompt(scenePrompt, combined, { ...options, npcActivityPlan, businessVisitorPlan });
  }

  async function previewActionDraftBeforeSend() {
    if (isGenerating.value) return false;
    if (!actionDraft.value.trim() && !playerInput.value.trim()) return false;

    const combined = [actionDraft.value.trim(), playerInput.value.trim()].filter(Boolean).join('\n—— 玩家旁白 ——\n');
    const isPrebuiltNarrationPrompt =
      /<玩家本回合行动>|【叙述者权限边界】|【当前权威局势】|【输出格式】/.test(combined) ||
      combined.includes('【系统已结算 / 权威局势】') ||
      combined.includes('【本回合标准结算单】');
    const npcActivityPlan = isPrebuiltNarrationPrompt ? null : prepareTavernNpcActivityPlan(combined);
    const businessVisitorPlan = isPrebuiltNarrationPrompt ? null : prepareBusinessVisitorPlan();
    const scenePrompt = isPrebuiltNarrationPrompt
      ? combined
      : buildNarrationPrompt({
          userText: `<user>${combined}</user>`,
          actionType: 'CUSTOM_ACTION',
          actionTitle: '玩家本回合行动',
          npcActivityPlan,
          businessVisitorPlan,
        });

    const result = await previewUnifiedNarrativeRequest(appendDuePromiseMemoBlock(scenePrompt, duePromiseMemos()), {
      authoritativeData: buildAuthoritativeRequestData(combined),
      worldbookScanText: buildWorldbookScanPreview(),
    });

    if (result.ok) {
      pushLog(
        '系统',
        `发送前预检完成：约 ${result.snapshot?.approxTokens ?? 0} token，命中世界书 ${result.snapshot?.activatedWorldbookEntries.length ?? 0} 条。`,
        { source: 'engine', authoritative: true, tone: 'cyan', actionType: 'PROMPT_PREFLIGHT' },
      );
      currentTab.value = 'settings';
      return true;
    }

    pushLog('提示', result.error ?? '发送前预检失败。', {
      source: 'engine',
      authoritative: true,
      tone: 'red',
      actionType: 'PROMPT_PREFLIGHT',
    });
    return false;
  }

  async function runStoryAction(action: StoryActionInput): Promise<boolean> {
    const existingText = [actionDraft.value.trim(), playerInput.value.trim()].filter(Boolean).join('\n—— 玩家旁白 ——\n');
    const combinedFact = [existingText, action.fact].filter(Boolean).join('\n');
    const settledFact = action.settled === false ? undefined : action.settledFact ?? action.fact;
    const npcActivityPlan = prepareTavernNpcActivityPlan(combinedFact);
    const businessVisitorPlan = prepareBusinessVisitorPlan();
    const prompt = buildNarrationPrompt({
      userText: `<user>${combinedFact}</user>`,
      settledFact,
      actionType: action.type,
      actionTitle: action.title,
      timeChange: settledFact ? action.timeChange : undefined,
      aiHint: action.aiHint,
      npcActivityPlan,
      businessVisitorPlan,
    });
    pushLog('结算', action.logText ?? `${action.title} · 前端事实已记录`, {
      source: 'engine',
      authoritative: true,
      tone: 'cyan',
      actionType: action.type,
    });
    pushLog('系统', `${action.type} 已进入闭环，等待 AI 叙述。`, {
      source: 'player',
      authoritative: true,
      tone: 'cyan',
      actionType: action.type,
    });

    if (action.autoSend) {
      currentTab.value = 'chronicle';
      const preserveLocalState = action.preserveLocalState ?? true;
      return submitNarrationPrompt(prompt, combinedFact, {
        reloadMvu: !preserveLocalState,
        applyInventoryFromMvu: !preserveLocalState,
        useFrontendAuthority: preserveLocalState,
        npcActivityPlan,
        businessVisitorPlan,
      });
    } else {
      clearActionDraft();
      playerInput.value = '';
      appendDraft(prompt, { type: action.type, undoPatch: action.undoPatch });
      return true;
    }
  }

  return {
    /* state */
    calendar,
    months,
    primordiaThemes,
    themeId,
    currentTimeOfDay,
    weekDayName,
    isMarketDay,
    dateText,
    clockText,
    sendWeatherToAi,
    enableStoryStreaming,
    lastTickAt,
    lastShopRefreshDay,
    location,
    tavernName,
    tavernOverview,
    walletCopper,
    cashboxCopper,
    walletParts,
    cashboxParts,
    walletText,
    cashboxText,
    treasuryCopper,
    treasuryParts,
    treasuryText,
    reputation,
    energy,
    protagonist,
    regions,
    isBusinessOpen,
    currentGuests,
    guestCap,
    visitorChance,
    lastVisitorSeed,
    guestGroups,
    inventory,
    satchel,
    temporaryStates,
    flattenTemporaryStates,
    promiseMemos,
    isPromiseMemoDue,
    updatePromiseMemoStatus,
    recipes,
    heroines,
    tavernNpcActivities,
    successfulNarrationTurn,
    npcActivityKeepTurns,
    npcActivityEnabled,
    npcActivityWorldbookLibrary,
    npcActivityWorldbookBindings,
    npcActivityWorldbookStatus,
    npcActivityWorldbookErrors,
    weatherWorldbookLibrary,
    weatherWorldbookBindings,
    weatherWorldbookStatus,
    weatherWorldbookErrors,
    turnContextWorldbookBinding,
    turnContextWorldbookStatus,
    turnContextWorldbookReady,
    openingRequired,
    openingCompleted,
    openingSave,
    openingWorkshopEnabled,
    shouldShowOpeningWorkshop,
    characterWorldbookBindings,
    characterBehaviorLibraries,
    stageNames,
    mapNodes,
    currentMapId,
    generatedShop,
    generatedShopProducts,
    farmPlots,
    brews,
    engineLogs,
    draftActions,
    actionDraft,
    playerInput,
    isGenerating,
    loadedStoryCheckpoint,
    saveMigrationStatus,
    currentTab,
    selectedHeroineId,
    selectedRegionId,
    /* actions */
    appendDraft,
    appendPlayerInput,
    removeDraftAction,
    clearDraftActions,
    currentSceneLabel,
    currentSceneType,
    currentCalendarDay,
    resolveTavernNpcRegion,
    npcActivitiesForRegion,
    refreshNpcActivityWorldbookLibrary,
    refreshNpcActivityWorldbookLibraryFromBindings,
    ensureNpcActivityWorldbook,
    setNpcActivityWorldbookBinding,
    clearNpcActivityWorldbookBindings,
    setNpcActivityEnabled,
    setNpcActivityKeepTurns,
    npcActivityWorldbookTemplate,
    weatherLibraryStats,
    refreshWeatherWorldbookLibrary,
    refreshWeatherWorldbookLibraryFromBindings,
    ensureWeatherWorldbook,
    setWeatherWorldbookBinding,
    clearWeatherWorldbookBindings,
    ensureTurnContextWorldbook,
    refreshTurnContextWorldbookBinding,
    loadCharacterBehaviorLibraryForHeroine,
    addCharacterBehavior,
    updateCharacterBehavior,
    deleteCharacterBehavior,
    weatherWorldbookFormatTemplate,
    fullWeatherWorldbookTemplate,
    monthWeatherWorldbookTemplate,
    availableOpeningWorldbooks,
    defaultOpeningWorldbookName,
    inspectOpeningTemplates,
    generateAndWriteOpeningTemplates,
    resetOpeningProfileEntries,
    saveOpeningTemplateContent,
    generateOpeningCharacterProfile,
    generateOpeningTavernProfile,
    generateOpeningStory,
    generateOpeningStoryWithInitvar,
    writeOpeningProfileEntry,
    confirmOpeningWorkshop,
    evaluateOpeningRequirement,
    openOpeningWorkshop,
    closeOpeningWorkshop,
    wrapUserAction,
    pushLog,
    removeLog,
    removeLogs,
    markLocalStateDirty,
    setLoadedStoryCheckpoint,
    continueFromLoadedCheckpoint,
    spendCopper,
    earnCopper,
    tickSave,
    advanceWorldTimeByGameHours,
    dispatchAction,
    executePseudoZeroAction,
    setBusinessOpen,
    setBusinessGuestCap,
    setBusinessVisitorChance,
    activeGuestGroups,
    orderableGuestGroups,
    addGuestGroup,
    updateGuestGroup,
    removeGuestGroup,
    markGuestGroupServed,
    bindCharacterWorldbookEntry,
    unbindCharacterWorldbookEntry,
    touchCharacterWorldbookBinding,
    deleteHeroine,
    saveRecipeFromInventoryItem,
    isRecipeSavedForItem,
    recipeShortages,
    craftRecipe,
    deleteRecipe,
    buildDebugSaveJson,
    importDebugSaveJson,
    buildWorldbookScanPreview,
    buildLatestPromptPreview,
    runReadonlyHealthCheck,
    buildCurrentScenePrompt,
    buildFrontendMvuSnapshot,
    getAuthoritativeMvuData,
    setFrontendMvuValue,
    setFrontendMvuData,
    cleanupLegacyCharacterAlias,
    syncFrontendFromMessageMvu,
    rerollTodayWeather,
    lifePhase,
    energyPhase,
    bladderPhase,
    applyGeneratedShop,
    applyMvuStatData,
    clearGeneratedShop,
    isCurrentShopLocation,
    setTavernName,
    runStoryAction,
    sendActionDraft,
    previewActionDraftBeforeSend,
    writeChatSave,
    restoreFromChatSave,
    restoreStorySnapshot,
    restoreNearestStorySnapshotBefore,
    restoreAfterFailedRegeneration,
    loadFromMvu,
    loadFromLatestAssistantPatch,
    restoreGeneratedShopFromLatestMessage,
  };
});
