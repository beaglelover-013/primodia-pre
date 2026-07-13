import {
  getPrimaryCharacterWorldbookName,
  getWorldbookEntryName,
  loadWorldbookEntry,
  loadWorldbookEntryByName,
  saveWorldbookEntry,
  upsertWorldbookEntryByName,
  type EditableWorldbookEntry,
  type WorldbookEntryRef,
} from './worldbookService';
import type { ParsedCharacterBehaviorUpdate } from '../utils/messageParser';

export const CHARACTER_BEHAVIOR_BLOCK_TAG = 'PrimordiaCharacterBehaviorLibrary';
export const CHARACTER_BEHAVIOR_ENTRY_PREFIX = '【普利莫迪亚｜角色行为库｜';
export const CHARACTER_BEHAVIOR_ENTRY_SUFFIX = '｜自动维护】';

export interface CharacterBehaviorItem {
  id: string;
  region: string;
  behavior: string;
  trigger: string;
  source: string;
  protagonistFeel: string;
  learnedAtTurn: number;
  updatedAt: number;
}

export interface CharacterBehaviorLibrary {
  version: 1;
  characterId: string;
  characterName: string;
  behaviors: CharacterBehaviorItem[];
  unlocatedBehaviors: CharacterBehaviorItem[];
  updatedAt: number;
}

export interface CharacterBehaviorApplyResult {
  changed: boolean;
  learned: number;
  removed: number;
  unlocated: number;
  ignoredUnknownRegion: string[];
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function behaviorId(region: string, behavior: string) {
  const key = `${cleanText(region)}::${cleanText(behavior)}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return `behavior-${Math.abs(hash).toString(36)}`;
}

const behaviorKeywordPatterns = [
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

function shortenBehaviorText(text: string) {
  if (!text) return '';
  if (text.length <= 10) return text;
  for (const pattern of behaviorKeywordPatterns) {
    const matched = text.match(pattern)?.[0];
    if (matched) return matched;
  }
  const firstPart = text
    .split(/[、,，/／；;。.!！?？]|并且|以及|然后|同时|会|能|主动|不再/)
    .map(part => part.trim())
    .filter(Boolean)
    .find(part => part.length >= 2 && part.length <= 10);
  return firstPart || text.slice(0, 10);
}

function normalizeBehaviorText(value: unknown) {
  const text = cleanText(value)
    .replace(/^[-*•\d.、\s]+/, '')
    .replace(/[。.!！?？；;]+$/g, '')
    .trim();
  return shortenBehaviorText(text);
}

function normalizeCharacterName(name: string) {
  return cleanText(name).replace(/[\/:*?"<>|]/g, '').slice(0, 48) || '未命名角色';
}

export function characterBehaviorEntryName(characterName: string) {
  return `${CHARACTER_BEHAVIOR_ENTRY_PREFIX}${normalizeCharacterName(characterName)}${CHARACTER_BEHAVIOR_ENTRY_SUFFIX}`;
}

export function isCharacterBehaviorEntryName(entryName: string) {
  return cleanText(entryName).startsWith(CHARACTER_BEHAVIOR_ENTRY_PREFIX) && cleanText(entryName).endsWith(CHARACTER_BEHAVIOR_ENTRY_SUFFIX);
}

export function createEmptyCharacterBehaviorLibrary(characterId: string, characterName: string): CharacterBehaviorLibrary {
  return {
    version: 1,
    characterId: cleanText(characterId),
    characterName: cleanText(characterName) || '未命名角色',
    behaviors: [],
    unlocatedBehaviors: [],
    updatedAt: Date.now(),
  };
}

function normalizeBehaviorItem(value: unknown, fallbackRegion = ''): CharacterBehaviorItem | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const region = cleanText(record.region ?? record['区域'] ?? fallbackRegion);
  const behavior = normalizeBehaviorText(record.behavior ?? record['行为'] ?? record['习惯']);
  if (!behavior) return null;
  return {
    id: cleanText(record.id) || behaviorId(region, behavior),
    region,
    behavior,
    trigger: cleanText(record.trigger ?? record['触发']) || 'observed',
    source: cleanText(record.source),
    protagonistFeel: cleanText(record.protagonistFeel),
    learnedAtTurn: Math.max(0, Math.floor(Number(record.learnedAtTurn) || 0)),
    updatedAt: Math.max(0, Math.floor(Number(record.updatedAt) || Date.now())),
  };
}

export function parseCharacterBehaviorLibraryContent(content: string, characterId: string, characterName: string): CharacterBehaviorLibrary {
  const fallback = createEmptyCharacterBehaviorLibrary(characterId, characterName);
  const match = cleanText(content).match(new RegExp(`<${CHARACTER_BEHAVIOR_BLOCK_TAG}\\b[^>]*>([\\s\\S]*?)<\\/${CHARACTER_BEHAVIOR_BLOCK_TAG}>`, 'i'));
  if (!match?.[1]) return fallback;
  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    const behaviors = Array.isArray(parsed.behaviors)
      ? parsed.behaviors.map(item => normalizeBehaviorItem(item)).filter((item): item is CharacterBehaviorItem => Boolean(item))
      : [];
    const unlocatedBehaviors = Array.isArray(parsed.unlocatedBehaviors)
      ? parsed.unlocatedBehaviors.map(item => normalizeBehaviorItem(item)).filter((item): item is CharacterBehaviorItem => Boolean(item))
      : [];
    return {
      version: 1,
      characterId: cleanText(parsed.characterId) || fallback.characterId,
      characterName: cleanText(parsed.characterName) || fallback.characterName,
      behaviors,
      unlocatedBehaviors,
      updatedAt: Math.max(0, Math.floor(Number(parsed.updatedAt) || Date.now())),
    };
  } catch {
    return fallback;
  }
}

export function formatCharacterBehaviorLibraryContent(library: CharacterBehaviorLibrary) {
  const normalized: CharacterBehaviorLibrary = {
    version: 1,
    characterId: cleanText(library.characterId),
    characterName: cleanText(library.characterName) || '未命名角色',
    behaviors: library.behaviors.map(item => ({ ...item, id: item.id || behaviorId(item.region, item.behavior) })),
    unlocatedBehaviors: library.unlocatedBehaviors.map(item => ({ ...item, id: item.id || behaviorId(item.region, item.behavior) })),
    updatedAt: Date.now(),
  };
  return `<${CHARACTER_BEHAVIOR_BLOCK_TAG}>\n${JSON.stringify(normalized, null, 2)}\n</${CHARACTER_BEHAVIOR_BLOCK_TAG}>`;
}

function characterBehaviorEntrySeed(library: CharacterBehaviorLibrary): Partial<EditableWorldbookEntry> {
  const entryName = characterBehaviorEntryName(library.characterName);
  return {
    name: entryName,
    comment: entryName,
    enabled: false,
    content: formatCharacterBehaviorLibraryContent(library),
    strategy: {
      type: 'selective',
      keys: [entryName, library.characterName, '角色行为库'],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: { type: 'at_depth', role: 'system', depth: 4, order: 100 },
  };
}

export async function ensureCharacterBehaviorWorldbookEntry(
  characterId: string,
  characterName: string,
  worldbookName = getPrimaryCharacterWorldbookName(),
) {
  const targetWorldbook = cleanText(worldbookName);
  if (!targetWorldbook) throw new Error('当前角色没有主世界书，无法创建角色行为库条目。');
  const library = createEmptyCharacterBehaviorLibrary(characterId, characterName);
  const entryName = characterBehaviorEntryName(characterName);
  let entry = await loadWorldbookEntryByName(targetWorldbook, entryName);
  if (!entry) {
    entry = (await upsertWorldbookEntryByName(targetWorldbook, entryName, characterBehaviorEntrySeed(library))) as EditableWorldbookEntry;
  } else if (entry.enabled || !String(entry.content || '').includes(CHARACTER_BEHAVIOR_BLOCK_TAG)) {
    entry = await saveWorldbookEntry(targetWorldbook, {
      ...entry,
      enabled: false,
      content: String(entry.content || '').includes(CHARACTER_BEHAVIOR_BLOCK_TAG)
        ? entry.content
        : formatCharacterBehaviorLibraryContent(library),
    });
  }
  return { worldbookName: targetWorldbook, uid: Number(entry.uid), entryName: getWorldbookEntryName(entry) || entryName, entry };
}

export async function loadCharacterBehaviorLibraryFromEntry(
  ref: WorldbookEntryRef,
  characterId: string,
  characterName: string,
) {
  const entry = await loadWorldbookEntry(ref);
  if (!entry) return createEmptyCharacterBehaviorLibrary(characterId, characterName);
  return parseCharacterBehaviorLibraryContent(entry.content || '', characterId, characterName);
}

export async function saveCharacterBehaviorLibraryToEntry(ref: WorldbookEntryRef, library: CharacterBehaviorLibrary) {
  const entry = await loadWorldbookEntry(ref);
  if (!entry) throw new Error('角色行为库条目已经不存在。');
  const next = {
    ...entry,
    enabled: false,
    content: formatCharacterBehaviorLibraryContent(library),
  };
  return saveWorldbookEntry(ref.worldbookName, next);
}

function upsertBehavior(list: CharacterBehaviorItem[], item: CharacterBehaviorItem) {
  const id = behaviorId(item.region, item.behavior);
  const index = list.findIndex(existing => existing.id === id || behaviorId(existing.region, existing.behavior) === id);
  const next = { ...item, id, updatedAt: Date.now() };
  if (index >= 0) list[index] = { ...list[index], ...next, learnedAtTurn: list[index].learnedAtTurn || next.learnedAtTurn };
  else list.push(next);
}

function removeBehavior(list: CharacterBehaviorItem[], region: string, behavior: string) {
  const id = behaviorId(region, behavior);
  const before = list.length;
  const behaviorText = cleanText(behavior);
  const next = list.filter(item => behaviorId(item.region, item.behavior) !== id && cleanText(item.behavior) !== behaviorText);
  list.splice(0, list.length, ...next);
  return before !== list.length;
}

export function applyCharacterBehaviorUpdatesToLibrary(
  library: CharacterBehaviorLibrary,
  updates: ParsedCharacterBehaviorUpdate[],
  validRegions: string[],
  turn: number,
): CharacterBehaviorApplyResult {
  const validRegionSet = new Set(validRegions.map(region => cleanText(region)).filter(Boolean));
  const ignoredUnknownRegion: string[] = [];
  let changed = false;
  let learned = 0;
  let removed = 0;
  let unlocated = 0;

  for (const update of updates) {
    const region = cleanText(update.region) || '未定位';
    const behaviorList = (update.behaviors?.length ? update.behaviors : [update.behavior])
      .map(normalizeBehaviorText)
      .filter(Boolean);
    if (!behaviorList.length) continue;

    for (const behavior of behaviorList) {
      const item: CharacterBehaviorItem = {
        id: behaviorId(region, behavior),
        region,
        behavior,
        trigger: cleanText(update.trigger) || 'observed',
        source: cleanText(update.source),
        protagonistFeel: cleanText(update.protagonistFeel),
        learnedAtTurn: Math.max(0, turn),
        updatedAt: Date.now(),
      };
      const targetList = validRegionSet.has(region) ? library.behaviors : library.unlocatedBehaviors;

      if (update.action === 'remove') {
        const didRemove = removeBehavior(library.behaviors, region, item.behavior) || removeBehavior(library.unlocatedBehaviors, region, item.behavior);
        if (didRemove) {
          changed = true;
          removed += 1;
        }
        continue;
      }

      upsertBehavior(targetList, item);
      changed = true;
      learned += 1;
      if (!validRegionSet.has(region)) {
        unlocated += 1;
        ignoredUnknownRegion.push(region);
      }
    }
  }

  if (changed) library.updatedAt = Date.now();
  return { changed, learned, removed, unlocated, ignoredUnknownRegion: [...new Set(ignoredUnknownRegion)] };
}
