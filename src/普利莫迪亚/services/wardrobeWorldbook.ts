import { parse, stringify } from 'yaml';
import {
  getWorldbookEntryName,
  loadWorldbookEntryByName,
  saveWorldbookEntry,
  upsertWorldbookEntryByName,
  type EditableWorldbookEntry,
} from './worldbookService';

export type WardrobeLibrary = Record<string, string[]>;

export interface WardrobeEnsureResult {
  libraryEntry: EditableWorldbookEntry;
  visibleEntry: EditableWorldbookEntry;
}

export interface WardrobeOutfit {
  dateLabel: string;
  categories: Record<string, string | string[]>;
  summary: string;
}

const DEFAULT_CATEGORIES = ['日常上衣', '日常下装', '外套', '内衣与袜子', '鞋子', '配饰'];
const LIBRARY_BLOCK_RE = /<\s*PrimordiaWardrobeLibrary\b[^>]*>([\s\S]*?)<\s*\/\s*PrimordiaWardrobeLibrary\s*>/gi;
const GENERIC_WARDROBE_BLOCK_RE = /<\s*WORLD_main_characters_[^>\s]+_衣柜\b[^>]*>([\s\S]*?)<\s*\/\s*WORLD_main_characters_[^>\s]+_衣柜\s*>/gi;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function wardrobeLibraryEntryName(characterName: string) {
  return `${characterName}_衣柜库`;
}

export function wardrobeVisibleEntryName(characterName: string) {
  return `${characterName}_衣柜`;
}

export function wardrobeVisibleTagName(characterName: string) {
  return `WORLD_main_characters_${characterName}_衣柜`;
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function asStringList(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n+/).map(item => item.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const list = record.items ?? record['衣物'] ?? record['列表'];
    if (Array.isArray(list)) return list.map(cleanText).filter(Boolean);
  }
  return [];
}

function mergeUnique(base: string[] = [], additions: string[] = []) {
  const seen = new Set(base.map(item => item.trim()).filter(Boolean));
  const next = [...base];
  for (const item of additions.map(cleanText).filter(Boolean)) {
    if (seen.has(item)) continue;
    seen.add(item);
    next.push(item);
  }
  return next;
}

export function mergeWardrobeLibraries(base: WardrobeLibrary, additions: WardrobeLibrary): WardrobeLibrary {
  const next: WardrobeLibrary = { ...base };
  for (const [category, items] of Object.entries(additions)) {
    next[category] = mergeUnique(next[category] ?? [], items);
  }
  return next;
}

function extractBlocks(content: string, characterName?: string) {
  const text = String(content ?? '');
  const blocks: string[] = [];
  for (const match of text.matchAll(LIBRARY_BLOCK_RE)) blocks.push(match[1]);

  if (characterName) {
    const tag = escapeRegExp(wardrobeVisibleTagName(characterName));
    const specificRe = new RegExp(`<\\s*${tag}\\b[^>]*>([\\s\\S]*?)<\\s*\\/\\s*${tag}\\s*>`, 'gi');
    for (const match of text.matchAll(specificRe)) blocks.push(match[1]);
  }

  for (const match of text.matchAll(GENERIC_WARDROBE_BLOCK_RE)) {
    if (!blocks.includes(match[1])) blocks.push(match[1]);
  }

  if (!blocks.length) blocks.push(text);
  return blocks;
}

function readWardrobeRoot(parsed: unknown, characterName: string) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const rootKeys = [
    wardrobeVisibleEntryName(characterName),
    wardrobeLibraryEntryName(characterName),
    `${characterName}_衣柜`,
    `${characterName}_衣柜库`,
  ];
  for (const key of rootKeys) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return record;
}

function parseWardrobeYamlBlock(raw: string, characterName: string): WardrobeLibrary {
  const parsed = parse(raw);
  const root = readWardrobeRoot(parsed, characterName);
  if (!root) return {};

  const library: WardrobeLibrary = {};
  for (const [category, value] of Object.entries(root)) {
    if (['今日穿搭', '日期', '一句话穿着', '当前穿着', 'version'].includes(category)) continue;
    const items = asStringList(value);
    if (items.length) library[category] = mergeUnique(library[category] ?? [], items);
  }
  return library;
}

export function parseWardrobeLibraryContent(content: string, characterName: string): WardrobeLibrary {
  let merged: WardrobeLibrary = {};
  for (const block of extractBlocks(content, characterName)) {
    try {
      merged = mergeWardrobeLibraries(merged, parseWardrobeYamlBlock(block, characterName));
    } catch {
      /* Ignore malformed blocks; callers can decide whether an empty result is acceptable. */
    }
  }
  return merged;
}

export function wardrobeItemCount(library: WardrobeLibrary) {
  return Object.values(library).reduce((sum, items) => sum + items.length, 0);
}

export function serializeWardrobeLibrary(characterName: string, library: WardrobeLibrary) {
  const ordered: WardrobeLibrary = {};
  for (const category of DEFAULT_CATEGORIES) {
    if (library[category]?.length) ordered[category] = library[category];
  }
  for (const [category, items] of Object.entries(library)) {
    if (!DEFAULT_CATEGORIES.includes(category) && items.length) ordered[category] = items;
  }

  const yaml = stringify({ [wardrobeLibraryEntryName(characterName)]: ordered }).trimEnd();
  return `<PrimordiaWardrobeLibrary>\n${yaml}\n</PrimordiaWardrobeLibrary>`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seedText: string) {
  let state = hashText(seedText) || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}

function pickOne(items: string[] | undefined, random: () => number) {
  if (!items?.length) return '';
  return items[Math.floor(random() * items.length) % items.length];
}

function pickSome(items: string[] | undefined, random: () => number, max = 2) {
  if (!items?.length) return [];
  const pool = [...items];
  const count = Math.min(pool.length, Math.max(0, Math.floor(random() * (max + 1))));
  const picked: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const itemIndex = Math.floor(random() * pool.length) % pool.length;
    picked.push(pool.splice(itemIndex, 1)[0]);
  }
  return picked;
}

function shouldWearOuterwear(weatherText: string, random: () => number) {
  if (/雨|雪|寒|冷|霜|雾|风|湿/.test(weatherText)) return true;
  return random() > 0.55;
}

function outfitSummary(categories: Record<string, string | string[]>) {
  const parts = [
    categories['日常上衣'],
    categories['日常下装'],
    categories['外套'] ? `外披${categories['外套']}` : '',
    categories['鞋子'] ? `脚上是${categories['鞋子']}` : '',
  ].filter(Boolean);
  const accessories = Array.isArray(categories['配饰']) ? categories['配饰'] as string[] : [];
  if (accessories.length) parts.push(`配着${accessories.join('、')}`);
  return `${parts.join('，')}。`;
}

export function generateWardrobeOutfit(options: {
  characterName: string;
  library: WardrobeLibrary;
  dateLabel: string;
  daySerial: number;
  weatherText?: string;
  rerollSalt?: string;
}): WardrobeOutfit {
  const random = makeRandom(`${options.characterName}|${options.daySerial}|${options.rerollSalt ?? ''}`);
  const categories: Record<string, string | string[]> = {};

  const top = pickOne(options.library['日常上衣'], random);
  const bottom = pickOne(options.library['日常下装'], random);
  const shoes = pickOne(options.library['鞋子'], random);
  const underwear = pickOne(options.library['内衣与袜子'], random);
  const outerwear = shouldWearOuterwear(options.weatherText ?? '', random) ? pickOne(options.library['外套'], random) : '';
  const accessories = pickSome(options.library['配饰'], random, 2);

  if (top) categories['日常上衣'] = top;
  if (bottom) categories['日常下装'] = bottom;
  if (underwear) categories['内衣与袜子'] = underwear;
  if (outerwear) categories['外套'] = outerwear;
  if (shoes) categories['鞋子'] = shoes;
  if (accessories.length) categories['配饰'] = accessories;

  return {
    dateLabel: options.dateLabel,
    categories,
    summary: outfitSummary(categories),
  };
}

export function serializeVisibleWardrobe(characterName: string, outfit: WardrobeOutfit) {
  const tag = wardrobeVisibleTagName(characterName);
  const yaml = stringify({
    [wardrobeVisibleEntryName(characterName)]: {
      今日穿搭: {
        日期: outfit.dateLabel,
        ...outfit.categories,
        一句话穿着: outfit.summary,
      },
    },
  }).trimEnd();
  return `<${tag}>\n${yaml}\n</${tag}>`;
}

export async function ensureCharacterWardrobeEntries(worldbookName: string, characterName: string): Promise<WardrobeEnsureResult> {
  const libraryEntry = await upsertWorldbookEntryByName(worldbookName, wardrobeLibraryEntryName(characterName), {
    enabled: false,
    content: serializeWardrobeLibrary(characterName, {}),
    strategy: { type: 'constant', keys: [], scan_depth: 'same_as_global' },
  });
  const visibleEntry = await upsertWorldbookEntryByName(worldbookName, wardrobeVisibleEntryName(characterName), {
    enabled: true,
    content: serializeVisibleWardrobe(characterName, {
      dateLabel: '尚未换装',
      categories: {},
      summary: '今日穿搭尚未生成。',
    }),
    strategy: { type: 'constant', keys: [], scan_depth: 'same_as_global' },
    position: { type: 'at_depth', role: 'system', depth: 4, order: 98 },
  });
  return { libraryEntry, visibleEntry };
}

export async function loadCharacterWardrobeLibrary(worldbookName: string, characterName: string) {
  const entry = await loadWorldbookEntryByName(worldbookName, wardrobeLibraryEntryName(characterName));
  return {
    entry,
    library: entry ? parseWardrobeLibraryContent(entry.content ?? '', characterName) : {},
  };
}

export async function appendCapturedWardrobe(worldbookName: string, characterName: string, captureText: string) {
  const captured = parseWardrobeLibraryContent(captureText, characterName);
  const capturedCount = wardrobeItemCount(captured);
  if (!capturedCount) throw new Error('没有捕捉到衣服。请粘贴分类衣柜格式。');

  const current = await loadCharacterWardrobeLibrary(worldbookName, characterName);
  const merged = mergeWardrobeLibraries(current.library, captured);
  const nextContent = serializeWardrobeLibrary(characterName, merged);

  const entry = current.entry
    ? await saveWorldbookEntry(worldbookName, { ...current.entry, enabled: false, content: nextContent })
    : await upsertWorldbookEntryByName(worldbookName, wardrobeLibraryEntryName(characterName), {
        enabled: false,
        content: nextContent,
        strategy: { type: 'constant', keys: [], scan_depth: 'same_as_global' },
      });

  return {
    entry,
    library: merged,
    capturedCount,
    addedCount: wardrobeItemCount(merged) - wardrobeItemCount(current.library),
  };
}

export async function saveVisibleWardrobeOutfit(worldbookName: string, characterName: string, outfit: WardrobeOutfit) {
  return upsertWorldbookEntryByName(worldbookName, wardrobeVisibleEntryName(characterName), {
    enabled: true,
    content: serializeVisibleWardrobe(characterName, outfit),
    strategy: { type: 'constant', keys: [], scan_depth: 'same_as_global' },
    position: { type: 'at_depth', role: 'system', depth: 4, order: 98 },
  });
}

export function describeWardrobeEntry(entry: EditableWorldbookEntry | null | undefined) {
  return entry ? `${getWorldbookEntryName(entry)} · uid ${entry.uid}` : '尚未创建';
}
