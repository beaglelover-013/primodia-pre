export interface ParsedOption {
  id: string;
  text: string;
}

export interface StoryMessagePayload {
  maintext: string;
  options: ParsedOption[];
  sum: string;
  shop?: ParsedShop;
  craftResult?: ParsedCraftResult;
  guestUpdates?: ParsedGuestUpdate[];
  regularGuestUpdates?: ParsedRegularGuestUpdate[];
  promiseUpdates?: ParsedPromiseUpdate[];
  tavernStateUpdates?: ParsedTavernStateUpdate[];
  businessAgreementUpdates?: ParsedBusinessAgreementUpdate[];
  characterBehaviorUpdates?: ParsedCharacterBehaviorUpdate[];
  messageId?: number;
  userMessageId?: number;
  fullMessage?: string;
}

export type LatestMaintextPayload = StoryMessagePayload;

export interface ParsedShopProduct {
  name: string;
  category: string;
  priceCopper: number;
  stock: number;
  tags: string[];
  desc: string;
}

export interface ParsedShop {
  name: string;
  keeper: string;
  description: string;
  products: ParsedShopProduct[];
}

export interface ParsedCraftResult {
  craftId?: string;
  type: string;
  name: string;
  destination: string;
  barrelName?: string;
  startDay?: string;
  matureDay?: string;
  quantity: number;
  quality?: string;
  tags: string[];
  aromaTags: string[];
  priceCopper: number;
  serveable: boolean;
  description: string;
}

export type GuestUpdateStatus = '刚进店' | '等待点单' | '已点单' | '待上菜' | '用餐中' | '已离开';

export interface ParsedGuestUpdate {
  id?: string;
  label: string;
  guests: string;
  status: GuestUpdateStatus;
  order: string;
  note: string;
}

export type RegularGuestUpdateAction = 'add' | 'update' | 'remove';
export type RegularGuestUnitType = '个人' | '团体';

export interface ParsedRegularGuestUpdate {
  action: RegularGuestUpdateAction;
  id?: string;
  name: string;
  type: RegularGuestUnitType;
  sizeText: string;
  identity: string;
  relationship: string;
  memoryHook: string;
  likes: string;
  dislikes: string;
  habits: string;
  messageTendency: string;
  notes: string;
}

export type PromiseUpdateAction = 'add' | 'cancel' | 'resolve';

export interface ParsedPromiseUpdate {
  action: PromiseUpdateAction;
  id?: string;
  name: string;
  triggerTime: string;
  people: string[];
  event: string;
  reminder: string;
}

export interface ParsedTavernStateUpdate {
  action: 'add' | 'update' | 'remove';
  id?: string;
  name: string;
  targetRegion: string;
  description: string;
  guestResponseHint: string;
}

export interface ParsedBusinessAgreementInventoryChange {
  name: string;
  category: string;
  qty: number;
  tags: string[];
}

export interface ParsedBusinessAgreementUpdate {
  action: 'add' | 'update' | 'cancel';
  id?: string;
  kind: 'wage' | 'rent' | 'delivery' | 'sideBusiness';
  name: string;
  counterparty: string;
  cashboxDeltaCopper: number;
  inventoryChanges: ParsedBusinessAgreementInventoryChange[];
  reminder: string;
}

export type CharacterBehaviorUpdateAction = 'learn' | 'remove' | 'update';

export interface ParsedCharacterBehaviorUpdate {
  action: CharacterBehaviorUpdateAction;
  character: string;
  characterId?: string;
  region: string;
  behavior: string;
  behaviors: string[];
  trigger: string;
  source: string;
  protagonistFeel: string;
}

export interface StoryIndexItem extends StoryMessagePayload {
  messageId: number;
  preview: string;
}

const HIDDEN_STORY_TAGS = [
  'shop',
  'craft_result',
  'guest_update',
  'regular_guest_update',
  'promise_update',
  'tavern_state_update',
  'business_agreement_update',
  'character_behavior_update',
  'UpdateVariable',
  'JSONPatch',
  'Analysis',
  'CONTEXT_conception',
];
const LEGACY_NARRATIVE_TAG = 'NARRATIVE';
const MAX_SHOP_PRODUCTS = 16;
const FRONTEND_PLACEHOLDER_PATTERN =
  /(?:【\s*beagle\s*】\s*)?<StatusPlaceHolderImpl\s*\/?>|<StatusPlaceHolder\b[^>]*\/?>|StatusPlaceHolderImpl/gi;
const FRONTEND_LOADER_MESSAGE_PATTERN = /\$\(('|")body\1\)\.load\(|<body>\s*<script>[\s\S]*?\.load\(/i;

function stripFrontendPlaceholders(content: string): string {
  return content.replace(FRONTEND_PLACEHOLDER_PATTERN, '').trim();
}

export function isFrontendLoaderMessage(content: string) {
  return FRONTEND_LOADER_MESSAGE_PATTERN.test(content);
}

export function isSeparatorOnlyStoryText(content: string) {
  return content.replace(/[-—–_\s.。·・]+/g, '').length === 0;
}

function stripSeparatorOnlyParagraphs(content: string) {
  return content
    .split(/\n\s*\n/)
    .map(line => line.trim())
    .filter(line => line && !isSeparatorOnlyStoryText(line))
    .join('\n\n');
}

function isUsableStoryText(content: string): boolean {
  if (isFrontendLoaderMessage(content)) return false;
  const visible = stripFrontendPlaceholders(content).replace(/\s+/g, '').trim();
  return visible.length > 0 && !isSeparatorOnlyStoryText(visible);
}

function hasExplicitStoryMarkup(content: string): boolean {
  return /<maintext\b[^>]*>[\s\S]*?<\/maintext>|<NARRATIVE\b[^>]*>[\s\S]*?<\/NARRATIVE>/i.test(content);
}

function uniqueMessagesById(messages: any[]): any[] {
  const seen = new Map<number, any>();
  for (const message of messages) {
    if (!message || typeof message.message_id !== 'number') continue;
    if (!seen.has(message.message_id)) seen.set(message.message_id, message);
  }
  return [...seen.values()].sort((a, b) => a.message_id - b.message_id);
}

function isAssistantStoryCandidate(message: any): boolean {
  const text = String(message?.message ?? '');
  if (hasExplicitStoryMarkup(text)) return true;
  if (message?.message_id <= 0) return false;
  if (message?.role === 'assistant') return true;
  return message?.is_user === false && message?.is_system !== true;
}

function readAssistantStoryCandidates(lastMessageId: number): any[] {
  if (typeof getChatMessages !== 'function') return [];
  const range = `0-${lastMessageId}`;
  const attempts: any[][] = [];
  try {
    attempts.push(getChatMessages(range, { role: 'assistant', hide_state: 'all' }) ?? []);
  } catch {
    // Some Tavern builds do not support hide_state on range reads.
  }
  try {
    attempts.push(getChatMessages(range, { role: 'assistant' }) ?? []);
  } catch {
    // Keep the fallback chain alive.
  }
  try {
    attempts.push(getChatMessages(range, { role: 'all', hide_state: 'all' }) ?? []);
  } catch {
    // Some Tavern builds do not support hide_state on range reads.
  }
  try {
    attempts.push(getChatMessages(range, { role: 'all' }) ?? []);
  } catch {
    // Final fallback failed; the caller will return an empty index.
  }
  return uniqueMessagesById(attempts.flat()).filter(isAssistantStoryCandidate);
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

  return cleaned;
}

function stripHiddenStoryTags(content: string): string {
  return HIDDEN_STORY_TAGS.reduce(
    (text, tagName) => text.replace(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi'), '').trim(),
    content,
  );
}

function extractLastTag(content: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const matches = [...content.matchAll(regex)];
  return matches.length ? matches[matches.length - 1]?.[1]?.trim() ?? '' : '';
}

function normalizeOptionId(id: string): string {
  return /^[a-d]$/i.test(id) ? id.toUpperCase() : id;
}

function cleanPreview(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function findPreviousUserMessageId(messageId?: number): number | undefined {
  if (messageId === undefined || messageId === null || typeof getChatMessages !== 'function') return undefined;
  for (let id = messageId - 1; id >= 0; id--) {
    const userMessages = getChatMessages(id, { role: 'user' });
    const userMessage = userMessages.find(message => !isFrontendLoaderMessage(String(message?.message ?? '')));
    if (userMessage) return userMessage.message_id;
  }
  return undefined;
}

function parseStoryMessage(messageContent: string, messageId?: number): StoryMessagePayload {
  return {
    maintext: parseMaintext(messageContent),
    options: parseOptions(messageContent),
    sum: parseSum(messageContent),
    shop: parseShop(messageContent),
    craftResult: parseCraftResult(messageContent),
    guestUpdates: parseGuestUpdates(messageContent),
    regularGuestUpdates: parseRegularGuestUpdates(messageContent),
    promiseUpdates: parsePromiseUpdates(messageContent),
    tavernStateUpdates: parseTavernStateUpdates(messageContent),
    businessAgreementUpdates: parseBusinessAgreementUpdates(messageContent),
    characterBehaviorUpdates: parseCharacterBehaviorUpdates(messageContent),
    messageId,
    userMessageId: findPreviousUserMessageId(messageId),
    fullMessage: messageContent,
  };
}

export function parseMaintext(messageContent: string): string {
  if (isFrontendLoaderMessage(messageContent)) return '';
  const cleaned = stripThinkingBlocks(messageContent);
  const maintext = extractLastTag(cleaned, 'maintext');
  const narrative = extractLastTag(cleaned, LEGACY_NARRATIVE_TAG);
  const body = maintext || narrative || cleaned;
  return stripSeparatorOnlyParagraphs(stripFrontendPlaceholders(stripHiddenStoryTags(body))
    .replace(/<NARRATIVE\b[^>]*>/gi, '')
    .replace(/<\/NARRATIVE>/gi, '')
    .replace(/<CONTEXT_conception\b[^>]*>[\s\S]*?<\/CONTEXT_conception>/gi, '')
    .replace(/<Analysis\b[^>]*>[\s\S]*?<\/Analysis>/gi, '')
    .replace(/<JSONPatch\b[^>]*>[\s\S]*?<\/JSONPatch>/gi, '')
    .trim());
}

export function parseSum(messageContent: string): string {
  return extractLastTag(stripThinkingBlocks(messageContent), 'sum');
}

function parseCopperValue(raw: unknown): number {
  const text = readJsonString(raw);
  if (!text) return 0;

  let total = 0;
  const mithril = text.match(/(\d+)\s*秘银/);
  const platinum = text.match(/(\d+)\s*铂金/);
  const gold = text.match(/(\d+)\s*金/);
  const silver = text.match(/(\d+)\s*银/);
  const copper = text.match(/(\d+)\s*铜/);
  if (mithril) total += Number(mithril[1]) * 500 * 500 * 10 * 100;
  if (platinum) total += Number(platinum[1]) * 500 * 10 * 100;
  if (gold) total += Number(gold[1]) * 10 * 100;
  if (silver) total += Number(silver[1]) * 100;
  if (copper) total += Number(copper[1]);
  if (total > 0) return total;

  const parsed = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function readShopField(shopText: string, field: string): string {
  const match = shopText.match(new RegExp(`^${field}[:：]\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() ?? '';
}

function cleanShopJsonText(shopText: string): string {
  const cleaned = shopText
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const firstObject = cleaned.indexOf('{');
  const lastObject = cleaned.lastIndexOf('}');
  const firstArray = cleaned.indexOf('[');
  const lastArray = cleaned.lastIndexOf(']');
  if (firstObject >= 0 && lastObject > firstObject && (firstArray < 0 || firstObject < firstArray)) {
    return cleaned.slice(firstObject, lastObject + 1).trim();
  }
  if (firstArray >= 0 && lastArray > firstArray) return cleaned.slice(firstArray, lastArray + 1).trim();
  return cleaned;
}

function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const loose = text
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(loose);
  }
}

function readJsonString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function readJsonFirstString(record: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const text = readJsonString(record[key]);
    if (text) return text;
  }
  return '';
}

function readJsonStringList(record: Record<string, any>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const list = value.map(readJsonString).filter(Boolean);
      if (list.length) return list;
    }
    const text = readJsonString(value);
    if (text) {
      return text
        .split(/[、,，/]/)
        .map(item => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function readJsonTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(readJsonString).filter(Boolean);
  return readJsonString(value)
    .split(/[,，、]/)
    .map(tag => tag.trim())
    .filter(Boolean);
}

function readJsonNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') return fallback;
  const parsed = Number(readJsonString(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeShopCategory(raw: unknown): string {
  const category = readJsonString(raw) || '杂物';
  if (['食材', '调料', '酒水', '成品', '杂物'].includes(category)) return category;
  if (/菜品|成品|熟食|餐|料理|药剂|药水/.test(category)) return '成品';
  if (/酒|饮|茶|水/.test(category)) return '酒水';
  if (/盐|糖|酱|香料|调味|油|醋|蜜/.test(category)) return '调料';
  if (/菜|肉|鱼|蛋|奶|粮|粉|果|食/.test(category)) return '食材';
  return '杂物';
}

function hasShelf(value: Record<string, any>): boolean {
  return Boolean(
    value.货架 ??
      value.今日货架 ??
      value.商品货架 ??
      value.售卖货架 ??
      value.货物 ??
      value.商品 ??
      value.商品列表 ??
      value.货架商品 ??
      value.今日商品 ??
      value.出售商品 ??
      value.售卖商品 ??
      value.清单 ??
      value.今日清单 ??
      value.服务 ??
      value.服务列表 ??
      value.products ??
      value.items,
  );
}

function looksLikeShop(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (hasShelf(value as Record<string, any>) ||
        (value as Record<string, any>).店主 ||
        (value as Record<string, any>).老板 ||
        (value as Record<string, any>).keeper ||
        (value as Record<string, any>).招呼语),
  );
}

function readShelf(shop: Record<string, any>): unknown {
  return (
    shop.货架 ??
    shop.今日货架 ??
    shop.商品货架 ??
    shop.售卖货架 ??
    shop.货物 ??
    shop.商品 ??
    shop.商品列表 ??
    shop.货架商品 ??
    shop.今日商品 ??
    shop.出售商品 ??
    shop.售卖商品 ??
    shop.清单 ??
    shop.今日清单 ??
    shop.服务 ??
    shop.服务列表 ??
    shop.products ??
    shop.items
  );
}

function parseShopJson(shopText: string): ParsedShop | undefined {
  const jsonText = cleanShopJsonText(shopText);
  if (!jsonText.startsWith('{') && !jsonText.startsWith('[')) return undefined;

  try {
    const parsed = parseLooseJson(jsonText);
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!root || typeof root !== 'object') return undefined;

    const record = root as Record<string, any>;
    const directName = readJsonFirstString(record, ['店名', '商铺名', '名称', 'name', 'shopName']);
    const nestedEntry = directName || looksLikeShop(record)
      ? ([directName || readJsonString(record.名称) || '临时商铺', record] as const)
      : Object.entries(record).find(([, value]) => looksLikeShop(value));
    if (!nestedEntry) return undefined;

    const [fallbackName, shopValue] = nestedEntry;
    const shop = shopValue as Record<string, any>;
    const name = directName || readJsonFirstString(shop, ['店名', '商铺名', '名称', 'name', 'shopName']) || fallbackName;
    const keeper = readJsonFirstString(shop, ['店主', '老板', '摊主', 'keeper', 'owner', 'NPC']);
    const description = readJsonFirstString(shop, ['描述', '氛围', '环境', '说明', '简介', 'atmosphere', 'description', 'desc']);
    const shelf = readShelf(shop);
    const entries = Array.isArray(shelf)
      ? shelf.map((value, index) => [
          readJsonString((value as any)?.名称 ?? (value as any)?.商品名 ?? (value as any)?.服务名 ?? (value as any)?.name) || `商品${index + 1}`,
          value,
        ] as const)
      : Object.entries((shelf && typeof shelf === 'object' ? shelf : {}) as Record<string, any>);

    const products = entries
      .map(([productName, value]) => {
        const item = value && typeof value === 'object' ? (value as Record<string, any>) : {};
        const priceSource =
          item.单价铜币 ??
          item.价格铜币 ??
          item.单价折合铜币 ??
          item.priceCopper ??
          item.price_copper ??
          item.价格 ??
          item.单价 ??
          item.price ??
          '0铜';
        return {
          name: readJsonFirstString(item, ['名称', '商品名', '服务名', '项目名', 'name']) || productName,
          category: normalizeShopCategory(item.分类 ?? item.category ?? item.类型 ?? item.kind),
          priceCopper: parseCopperValue(priceSource),
          stock: Math.max(0, readJsonNumber(item.余数量 ?? item.库存 ?? item.数量 ?? item.stock ?? item.count, 1)),
          tags: readJsonTags(item.标签 ?? item.tags),
          desc:
            readJsonFirstString(item, [
              '描述',
              '备注',
              '说明',
              '介绍',
              '详情',
              '效果',
              '用途',
              '商品描述',
              '服务描述',
              'desc',
              'note',
              'notes',
              'description',
            ]) || (typeof value === 'string' ? value : ''),
        };
      })
      .filter(product => product.name && product.priceCopper > 0 && product.stock > 0)
      .slice(0, MAX_SHOP_PRODUCTS);

    if (!name || products.length === 0) return undefined;
    return { name, keeper, description, products };
  } catch {
    return undefined;
  }
}

export function parseShop(messageContent: string): ParsedShop | undefined {
  const shopText = extractLastTag(stripThinkingBlocks(messageContent), 'shop');
  if (!shopText) return undefined;

  const jsonShop = parseShopJson(shopText);
  if (jsonShop) return jsonShop;

  const name = readShopField(shopText, '店名');
  const keeper = readShopField(shopText, '店主');
  const description = readShopField(shopText, '描述');
  const shelfStart = shopText.search(/^货架[:：]?\s*$/im);
  const shelfText = shelfStart >= 0 ? shopText.slice(shelfStart).replace(/^货架[:：]?\s*$/im, '') : shopText;

  const products = shelfText
    .split('\n')
    .map(line => line.trim().replace(/^[-*]\s*/, ''))
    .filter(line => line.includes('|'))
    .map(line => {
      const parts = line.split('|').map(part => part.trim());
      const [productName, category = '杂物', price = '0铜', stock = '余1', tagPart = '', desc = ''] = parts;
      const stockMatch = stock.match(/(\d+)/);
      const tags = tagPart
        .replace(/^标签[:：]\s*/, '')
        .split(/[,，、]/)
        .map(tag => tag.trim())
        .filter(Boolean);
      return {
        name: productName,
        category: normalizeShopCategory(category),
        priceCopper: parseCopperValue(price),
        stock: Math.max(1, Number(stockMatch?.[1] ?? 1)),
        tags,
        desc: desc.replace(/^(描述|备注|说明)[:：]\s*/, '').trim(),
      };
    })
    .filter(product => product.name && product.priceCopper > 0)
    .slice(0, MAX_SHOP_PRODUCTS);

  if (!name || products.length === 0) return undefined;
  return { name, keeper, description, products };
}

function readCraftField(craftText: string, fields: string[]): string {
  for (const field of fields) {
    const match = craftText.match(new RegExp(`^${field}[:：]\\s*(.+)$`, 'im'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function splitCraftList(raw: string): string[] {
  return raw
    .replace(/^标签[:：]\s*/, '')
    .split(/[,，、]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeCraftId(raw: string): string | undefined {
  const id = raw.replace(/[「」“”"'`]/g, '').trim();
  return id || undefined;
}

function readCraftTitleName(craftText: string): string {
  const firstContentLine = craftText
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !/^<|^```/.test(line));
  if (!firstContentLine) return '';
  const bracketMatch = firstContentLine.match(/^[【\[](.+?)[】\]]$/);
  if (bracketMatch?.[1]?.trim()) return bracketMatch[1].trim();
  return '';
}

function parseCraftResultJson(craftText: string): ParsedCraftResult | undefined {
  let parsed: unknown;
  try {
    parsed = parseLooseJson(cleanJsonLikeText(craftText));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const name = readJsonFirstString(record, ['名称', '成品名', '菜名', '酱名', '饮品名', 'name', 'outputName']);
  if (!name) return undefined;

  const type =
    readJsonFirstString(record, ['类型', '菜品分类', '分类', '品类', 'category', 'type']) ||
    (record.饮品名 ? '饮品' : '菜品');
  const destination =
    readJsonFirstString(record, ['去向', '放入', '目标', '入库分类', 'destination']) ||
    (type.includes('饮') ? '酒水' : '成品');
  const quantity = Math.max(1, readJsonNumber(record.数量 ?? record.产量 ?? record.quantity ?? record.yield, 1));
  const priceCopper = readJsonNumber(record.价格 ?? record.售价 ?? record.单价 ?? record.单份售价 ?? record.priceCopper, 0);
  const serveableText = readJsonFirstString(record, ['是否可上菜', '可上菜', '可直接上桌', 'serveable']);
  const serveable = !/否|不|不能|不可/.test(serveableText || '') && !/酒窖|桶|熟成|发酵/.test(destination);
  const tags = [
    ...readJsonStringList(record, ['标签', '味觉标签', '口感标签', '结构型风味', '工艺食味', 'tags']),
    ...readJsonStringList(record, ['气味标签', '气息标签', 'aromaTags']),
  ];
  const description =
    readJsonFirstString(record, ['描述', '说明', '月感标签', '备注', 'description', 'desc']) ||
    [
      readJsonFirstString(record, ['搭配等级']),
      readJsonStringList(record, ['味觉标签']).join('、'),
      readJsonStringList(record, ['气息标签']).join('、'),
    ]
      .filter(Boolean)
      .join('；');

  return {
    craftId: normalizeCraftId(readJsonFirstString(record, ['编号', 'ID', 'id', 'craftId'])),
    type,
    name,
    destination,
    barrelName: readJsonFirstString(record, ['桶名', 'barrelName']) || undefined,
    startDay: readJsonFirstString(record, ['开始日', '酿造开始日', 'startDay']) || undefined,
    matureDay: readJsonFirstString(record, ['预计收获日', '收获日', '成熟日', 'matureDay']) || undefined,
    quantity,
    quality: readJsonFirstString(record, ['搭配判定', '搭配等级', '品质', 'quality']) || undefined,
    tags: [...new Set(tags)],
    aromaTags: readJsonStringList(record, ['气味标签', '气息标签', 'aromaTags']),
    priceCopper,
    serveable,
    description,
  };
}

export function parseCraftResult(messageContent: string): ParsedCraftResult | undefined {
  const craftText = extractLastTag(stripThinkingBlocks(messageContent), 'craft_result');
  if (!craftText) return undefined;

  const jsonResult = parseCraftResultJson(craftText);
  if (jsonResult) return jsonResult;

  const name = readCraftField(craftText, ['名称', '成品名', '菜名', '酱名', '饮品名']) || readCraftTitleName(craftText);
  if (!name) return undefined;

  const type = readCraftField(craftText, ['类型', '菜品分类', '分类', '品类']) || '菜品';
  const destination = readCraftField(craftText, ['去向', '放入', '目标']) || (type.includes('饮') ? '酒水' : '成品');
  const quantity = Math.max(1, Number(readCraftField(craftText, ['数量', '产量']).replace(/[^\d]/g, '')) || 1);
  const priceCopper = parseCopperValue(readCraftField(craftText, ['价格', '售价', '单价', '单份售价']));
  const serveableText = readCraftField(craftText, ['是否可上菜', '可上菜', '可直接上桌']);
  const serveable = !/否|不|不能|不可/.test(serveableText || '') && !/酒窖|桶|熟成|发酵/.test(destination);

  return {
    craftId: normalizeCraftId(readCraftField(craftText, ['编号', 'ID', 'id'])),
    type,
    name,
    destination,
    barrelName: readCraftField(craftText, ['桶名']) || undefined,
    startDay: readCraftField(craftText, ['开始日', '酿造开始日']) || undefined,
    matureDay: readCraftField(craftText, ['预计收获日', '收获日', '成熟日']) || undefined,
    quantity,
    quality: readCraftField(craftText, ['搭配判定', '品质']) || undefined,
    tags: [
      ...splitCraftList(readCraftField(craftText, ['标签', '味觉标签', '口感标签', '结构型风味', '工艺食味'])),
      ...splitCraftList(readCraftField(craftText, ['月感标签'])),
    ],
    aromaTags: splitCraftList(readCraftField(craftText, ['气味标签', '气息标签'])),
    priceCopper,
    serveable,
    description: readCraftField(craftText, ['描述', '说明']) || '',
  };
}

function cleanJsonLikeText(text: string): string {
  const cleaned = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const firstObject = cleaned.indexOf('{');
  const lastObject = cleaned.lastIndexOf('}');
  const firstArray = cleaned.indexOf('[');
  const lastArray = cleaned.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray && (firstObject < 0 || firstArray < firstObject)) {
    return cleaned.slice(firstArray, lastArray + 1).trim();
  }
  if (firstObject >= 0 && lastObject > firstObject) return cleaned.slice(firstObject, lastObject + 1).trim();
  return cleaned;
}

function normalizeGuestStatus(raw: unknown): GuestUpdateStatus {
  const value = readJsonString(raw);
  if (value === '刚进店' || value === '等待点单' || value === '已点单' || value === '待上菜' || value === '用餐中' || value === '已离开') {
    return value;
  }
  if (/离开|走了|离店/.test(value)) return '已离开';
  if (/用餐|吃着|喝着|已服务/.test(value)) return '用餐中';
  if (/进食|吃饭|喝汤|喝酒|进餐/.test(value)) return '用餐中';
  if (/待上菜|等菜|催菜/.test(value)) return '待上菜';
  if (/点单|点了|订单/.test(value)) return '已点单';
  if (/交易|谈价|议价|售卖|出售|带货|货物/.test(value)) return '等待点单';
  if (/等|询问|未点/.test(value)) return '等待点单';
  return '刚进店';
}

function normalizeGuestUpdate(value: unknown, index: number): ParsedGuestUpdate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const name = readJsonFirstString(record, ['name', '姓名', '名字', '客人名']);
  const race = readJsonFirstString(record, ['race', '种族']);
  const location = readJsonFirstString(record, ['location', '地点', '位置', '所在']);
  const desc = readJsonFirstString(record, ['desc', 'description', '描述', '人物描述']);
  const guests =
    readJsonFirstString(record, ['guests', '客人', '人数描述']) ||
    [name, race ? `(${race})` : '', desc].filter(Boolean).join(' ').trim();
  const order = readJsonFirstString(record, ['order', '点单', '订单', '想要']);
  const note =
    readJsonFirstString(record, ['note', '备注', '补充']) ||
    [location ? `位置: ${location}` : '', desc && guests !== desc ? desc : ''].filter(Boolean).join('；');
  const label = readJsonFirstString(record, ['label', '桌名', '称呼']) || name || location || `第${index + 1}桌`;
  if (!guests && !order && !note) return undefined;
  return {
    id: readJsonFirstString(record, ['id', 'ID', '桌号', 'guest_id', 'guestId']) || undefined,
    label,
    guests,
    status: normalizeGuestStatus(record.status ?? record.状态),
    order,
    note,
  };
}

export function parseGuestUpdates(messageContent: string): ParsedGuestUpdate[] {
  const guestText = extractLastTag(stripThinkingBlocks(messageContent), 'guest_update');
  if (!guestText) return [];

  try {
    const parsed = parseLooseJson(cleanJsonLikeText(guestText));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .map((entry, index) => normalizeGuestUpdate(entry, index))
      .filter((entry): entry is ParsedGuestUpdate => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizeRegularGuestAction(raw: string): RegularGuestUpdateAction {
  const action = raw.trim().toLowerCase();
  if (action === 'remove' || action === 'delete' || action === '删除' || action === '移除') return 'remove';
  if (action === 'update' || action === 'edit' || action === '修改' || action === '更新') return 'update';
  return 'add';
}

function normalizeRegularGuestUnitType(raw: string): RegularGuestUnitType {
  const value = raw.trim();
  return value === '团体' || /group|party|team|crew|多人|一桌|团/.test(value) ? '团体' : '个人';
}

function normalizeRegularGuestUpdate(value: unknown): ParsedRegularGuestUpdate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const action = normalizeRegularGuestAction(readJsonFirstString(record, ['action', '动作', '操作']));
  const name = readJsonFirstString(record, ['name', '名称', '名字', '称呼']);
  const id = readJsonFirstString(record, ['id', 'ID']);
  if (!name && !id) return undefined;

  const type = normalizeRegularGuestUnitType(readJsonFirstString(record, ['type', '类型']));
  const sizeText = readJsonFirstString(record, ['sizeText', '人数描述', '人数', '群体描述']);
  const identity = readJsonFirstString(record, ['identity', '身份', '职业', '来历']);
  const relationship = readJsonFirstString(record, ['relationship', '关系', '关系阶段']);
  const memoryHook = readJsonFirstString(record, ['memoryHook', '记忆钩子', '记忆', '上次经历']);
  const likes = readJsonFirstString(record, ['likes', '偏好', '喜好', '喜欢']);
  const dislikes = readJsonFirstString(record, ['dislikes', '忌口', '不喜欢', '避雷']);
  const habits = readJsonFirstString(record, ['habits', '习惯', '行为习惯']);
  const messageTendency = readJsonFirstString(record, ['messageTendency', '消息倾向', '消息', '传闻倾向']);
  const notes = readJsonFirstString(record, ['notes', '备注', '补充']);

  if (action === 'add' && ![identity, memoryHook, likes, dislikes, habits, messageTendency, notes].some(Boolean)) return undefined;

  return {
    action,
    ...(id ? { id } : {}),
    name: name || id,
    type,
    sizeText,
    identity,
    relationship: relationship || '陌生人',
    memoryHook,
    likes,
    dislikes,
    habits,
    messageTendency,
    notes,
  };
}

export function parseRegularGuestUpdates(messageContent: string): ParsedRegularGuestUpdate[] {
  const updateText = extractLastTag(stripThinkingBlocks(messageContent), 'regular_guest_update');
  if (!updateText) return [];

  try {
    const parsed = parseLooseJson(cleanJsonLikeText(updateText));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .map(entry => normalizeRegularGuestUpdate(entry))
      .filter((entry): entry is ParsedRegularGuestUpdate => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizePromiseUpdate(value: unknown): ParsedPromiseUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const rawAction = readJsonFirstString(record, ['action', '动作', '操作']).toLowerCase();
  const action: PromiseUpdateAction =
    rawAction === 'cancel' || rawAction === '取消'
      ? 'cancel'
      : rawAction === 'resolve' || rawAction === '完成' || rawAction === '解决'
        ? 'resolve'
        : 'add';
  const name = readJsonFirstString(record, ['name', '名称', '名字', 'title', '标题']);
  const triggerTime = readJsonFirstString(record, ['trigger_time', 'triggerTime', '触发时间', 'time']);
  const event = readJsonFirstString(record, ['event', '事件', '记录']);
  const reminder = readJsonFirstString(record, ['reminder', '提醒', '提示词', 'prompt']);
  const id = readJsonFirstString(record, ['id']);
  const rawPeople = record.people ?? record['人物'] ?? record['相关人物'];
  const people = Array.isArray(rawPeople)
    ? rawPeople.map(readJsonString).filter(Boolean)
    : readJsonTags(rawPeople).filter(Boolean);

  if (!name && !id) return undefined;
  if (action === 'add' && (!triggerTime || !reminder)) return undefined;

  return {
    action,
    ...(id ? { id } : {}),
    name: name || id,
    triggerTime,
    people,
    event,
    reminder: reminder || event || name || id,
  };
}

export function parsePromiseUpdates(messageContent: string): ParsedPromiseUpdate[] {
  const promiseText = extractLastTag(stripThinkingBlocks(messageContent), 'promise_update');
  if (!promiseText) return [];

  try {
    const parsed = parseLooseJson(cleanJsonLikeText(promiseText));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .map(entry => normalizePromiseUpdate(entry))
      .filter((entry): entry is ParsedPromiseUpdate => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizeTavernStateUpdate(value: unknown): ParsedTavernStateUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const rawAction = readJsonFirstString(record, ['action', '动作', '操作']).toLowerCase();
  const action = rawAction === 'remove' || rawAction === 'delete' || rawAction === '删除'
    ? 'remove'
    : rawAction === 'update' || rawAction === '更新' || rawAction === '修改'
      ? 'update'
      : 'add';
  const id = readJsonFirstString(record, ['id']);
  const name = readJsonFirstString(record, ['name', '名称', '状态名']);
  const targetRegion = readJsonFirstString(record, ['target_region', 'targetRegion', 'region', '目标区域', '区域']);
  const description = readJsonFirstString(record, ['description', '描述', '效果']);
  const guestResponseHint = readJsonFirstString(record, ['guest_response_hint', 'guestResponseHint', '客人反应', '客人感受']);
  if (!name && !id) return undefined;
  if (action !== 'remove' && (!name || !targetRegion || !description)) return undefined;
  return {
    action,
    ...(id ? { id } : {}),
    name: name || id,
    targetRegion,
    description,
    guestResponseHint,
  };
}

export function parseTavernStateUpdates(messageContent: string): ParsedTavernStateUpdate[] {
  const updateText = extractLastTag(stripThinkingBlocks(messageContent), 'tavern_state_update');
  if (!updateText) return [];
  try {
    const parsed = parseLooseJson(cleanJsonLikeText(updateText));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.map(normalizeTavernStateUpdate).filter((entry): entry is ParsedTavernStateUpdate => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizeAgreementKind(raw: string): ParsedBusinessAgreementUpdate['kind'] {
  const value = raw.trim().toLowerCase();
  if (value === 'rent' || value === '房费' || value === '租金') return 'rent';
  if (value === 'delivery' || value === '送货' || value === '供货') return 'delivery';
  if (value === 'sidebusiness' || value === 'side_business' || value === '副业') return 'sideBusiness';
  return 'wage';
}

function normalizeBusinessAgreementUpdate(value: unknown): ParsedBusinessAgreementUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const rawAction = readJsonFirstString(record, ['action', '动作', '操作']).toLowerCase();
  const action = rawAction === 'cancel' || rawAction === 'remove' || rawAction === '取消' || rawAction === '删除'
    ? 'cancel'
    : rawAction === 'update' || rawAction === '更新' || rawAction === '修改'
      ? 'update'
      : 'add';
  const id = readJsonFirstString(record, ['id']);
  const kind = normalizeAgreementKind(readJsonFirstString(record, ['kind', 'type', '类型', '约定类型']));
  const name = readJsonFirstString(record, ['name', '名称', '标题']);
  const counterparty = readJsonFirstString(record, ['counterparty', 'person', '对象', '对方', '人物']);
  const cashboxDeltaCopper = Math.trunc(Number(record.cashbox_delta_copper ?? record.cashboxDeltaCopper ?? record['钱匣变化铜币'] ?? record['金额铜币'] ?? 0) || 0);
  const rawChanges = record.inventory_changes ?? record.inventoryChanges ?? record['库存变化'];
  const inventoryChanges = (Array.isArray(rawChanges) ? rawChanges : [])
    .map(raw => {
      if (!raw || typeof raw !== 'object') return undefined;
      const item = raw as Record<string, unknown>;
      const itemName = readJsonFirstString(item, ['name', '名称', '物品']);
      const category = readJsonFirstString(item, ['category', '分类']) || '杂物';
      const qty = Math.trunc(Number(item.qty ?? item['数量'] ?? 0) || 0);
      const tags = readJsonTags(item.tags ?? item['标签']).filter(Boolean);
      return itemName && qty !== 0 ? { name: itemName, category, qty, tags } : undefined;
    })
    .filter((entry): entry is ParsedBusinessAgreementInventoryChange => Boolean(entry));
  const reminder = readJsonFirstString(record, ['reminder', '提醒', '说明', '内容']);
  if (!name && !id) return undefined;
  if (action !== 'cancel' && (!name || !counterparty || (!cashboxDeltaCopper && !inventoryChanges.length))) return undefined;
  return {
    action,
    ...(id ? { id } : {}),
    kind,
    name: name || id,
    counterparty,
    cashboxDeltaCopper,
    inventoryChanges,
    reminder: reminder || name || id,
  };
}

export function parseBusinessAgreementUpdates(messageContent: string): ParsedBusinessAgreementUpdate[] {
  const updateText = extractLastTag(stripThinkingBlocks(messageContent), 'business_agreement_update');
  if (!updateText) return [];
  try {
    const parsed = parseLooseJson(cleanJsonLikeText(updateText));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.map(normalizeBusinessAgreementUpdate).filter((entry): entry is ParsedBusinessAgreementUpdate => Boolean(entry));
  } catch {
    return [];
  }
}

function normalizeCharacterBehaviorAction(raw: string): CharacterBehaviorUpdateAction {
  const action = raw.trim().toLowerCase();
  if (action === 'remove' || action === 'delete' || action === '删除' || action === '移除') return 'remove';
  if (action === 'update' || action === 'edit' || action === '修改' || action === '更新') return 'update';
  return 'learn';
}

function normalizeCharacterBehaviorUpdate(value: unknown): ParsedCharacterBehaviorUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const action = normalizeCharacterBehaviorAction(readJsonFirstString(record, ['action', '动作', '操作']));
  const character = readJsonFirstString(record, ['character', 'characterName', 'name', '角色', '人物', '角色名']);
  const characterId = readJsonFirstString(record, ['character_id', 'characterId', 'id', '角色id', '角色ID']);
  const region = readJsonFirstString(record, ['region', 'area', 'location', '区域', '地点']);
  const behaviors = readJsonStringList(record, ['behaviors', 'behaviorList', '行为列表', '行为组', 'behavior', '行为', '习惯', '内容']);
  const behavior = behaviors[0] ?? '';
  const trigger = readJsonFirstString(record, ['trigger', '触发', '触发方式']) || 'observed';
  const source = readJsonFirstString(record, ['source', '来源', '依据']);
  const protagonistFeel = readJsonFirstString(record, ['protagonist_feel', 'protagonistFeel', '主角感受', '主角可感受到']);

  if (!character && !characterId) return undefined;
  if (!behavior) return undefined;

  return {
    action,
    character,
    ...(characterId ? { characterId } : {}),
    region,
    behavior,
    behaviors,
    trigger,
    source,
    protagonistFeel,
  };
}

export function parseCharacterBehaviorUpdates(messageContent: string): ParsedCharacterBehaviorUpdate[] {
  const updateText = extractLastTag(stripThinkingBlocks(messageContent), 'character_behavior_update');
  if (!updateText) return [];

  try {
    const parsed = parseLooseJson(cleanJsonLikeText(updateText));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .map(entry => normalizeCharacterBehaviorUpdate(entry))
      .filter((entry): entry is ParsedCharacterBehaviorUpdate => Boolean(entry));
  } catch {
    return [];
  }
}

export function parseOptions(messageContent: string): ParsedOption[] {
  const cleaned = stripThinkingBlocks(messageContent);
  const withId: ParsedOption[] = [];
  const optionWithIdRegex = /<option\b[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;

  while ((match = optionWithIdRegex.exec(cleaned)) !== null) {
    const text = match[2].trim();
    if (text && withId.length < 4) withId.push({ id: normalizeOptionId(match[1].trim()), text });
  }
  if (withId.length > 0) return withId;

  const optionText = extractLastTag(cleaned, 'option');
  if (!optionText) return [];

  const lines = optionText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const optionPattern = /^([A-Da-d]|[1-4])[.、)]\s*/;
  const anyOptionPattern = /^([A-Za-z]|\d+)[.、)]\s*/;
  const hasOptionPrefix = lines.some(line => anyOptionPattern.test(line));

  if (!hasOptionPrefix) {
    return lines.slice(0, 4).map((line, index) => ({ id: String.fromCharCode(65 + index), text: line }));
  }

  const options: ParsedOption[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (optionPattern.test(line)) {
      if (current.length > 0 && options.length < 4) {
        const raw = current.join('\n');
        const id = normalizeOptionId(raw.match(optionPattern)?.[1] ?? String.fromCharCode(65 + options.length));
        options.push({ id, text: raw.replace(optionPattern, '').trim() });
      }
      current = [line];
    } else if (anyOptionPattern.test(line)) {
      break;
    } else if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0 && options.length < 4) {
    const raw = current.join('\n');
    const id = normalizeOptionId(raw.match(optionPattern)?.[1] ?? String.fromCharCode(65 + options.length));
    options.push({ id, text: raw.replace(optionPattern, '').trim() });
  }

  return options.slice(0, 4);
}

export function loadAssistantStoryIndex(): StoryIndexItem[] {
  try {
    if (typeof getLastMessageId !== 'function' || typeof getChatMessages !== 'function') return [];

    const lastMessageId = getLastMessageId();
    if (lastMessageId < 0) return [];

    return readAssistantStoryCandidates(lastMessageId)
      .filter(message => message.message_id > 0 || hasExplicitStoryMarkup(message.message))
      .map(message => {
        const parsed = parseStoryMessage(message.message, message.message_id);
        return {
          ...parsed,
          messageId: message.message_id,
          preview: cleanPreview(parsed.sum || parsed.maintext),
        };
      })
      .filter(item => isUsableStoryText(item.maintext));
  } catch (error) {
    console.warn('[primordia] 无法读取 assistant 楼层索引:', error);
  }

  return [];
}

export function findNearestShopBefore(messageId?: number, shopName?: string): ParsedShop | undefined {
  try {
    if (messageId === undefined || messageId === null || typeof getChatMessages !== 'function') return undefined;
    const messages = getChatMessages(`0-${messageId}`, { role: 'assistant' }).reverse();
    for (const message of messages) {
      const shop = parseShop(message.message);
      if (!shop) continue;
      if (!shopName || shop.name === shopName || shopName.includes(shop.name) || shop.name.includes(shopName)) return shop;
    }
  } catch (error) {
    console.warn('[primordia] 无法回溯商铺货架:', error);
  }
  return undefined;
}

export function loadLatestAssistantMaintext(): LatestMaintextPayload {
  const index = loadAssistantStoryIndex();
  return index.at(-1) ?? { maintext: '', options: [], sum: '' };
}
