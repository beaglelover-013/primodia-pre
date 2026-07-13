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

export const REGULAR_GUEST_BOOK_BLOCK_TAG = 'PrimordiaRegularGuestBook';
export const REGULAR_GUEST_BOOK_ENTRY_NAME = '【普利莫迪亚｜常客簿｜自动维护】';

export type RegularGuestType = '个人' | '团体';

export interface RegularGuestUnit {
  id: string;
  name: string;
  type: RegularGuestType;
  sizeText: string;
  identity: string;
  relationship: string;
  memoryHook: string;
  likes: string;
  dislikes: string;
  habits: string;
  messageTendency: string;
  notes: string;
  createdAtTurn: number;
  updatedAt: number;
}

export interface RegularGuestBookBackup {
  version: 1;
  guests: RegularGuestUnit[];
  updatedAt: number;
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function regularGuestId(name: string, type: RegularGuestType, identity = '') {
  const key = `${cleanText(name)}::${type}::${cleanText(identity)}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return `regular-${Math.abs(hash).toString(36)}`;
}

export function normalizeRegularGuestType(value: unknown): RegularGuestType {
  const text = cleanText(value);
  return text === '团体' || /group|party|team|crew|多人|一桌|团/.test(text) ? '团体' : '个人';
}

export function normalizeRegularGuestUnit(value: unknown, fallbackTurn = 0): RegularGuestUnit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = cleanText(record.name ?? record['名称'] ?? record['名字']);
  if (!name) return null;
  const type = normalizeRegularGuestType(record.type ?? record['类型']);
  const identity = cleanText(record.identity ?? record['身份']);
  const now = Date.now();
  return {
    id: cleanText(record.id) || regularGuestId(name, type, identity),
    name,
    type,
    sizeText: cleanText(record.sizeText ?? record['人数描述'] ?? record['群体描述']),
    identity,
    relationship: cleanText(record.relationship ?? record['关系']) || '陌生人',
    memoryHook: cleanText(record.memoryHook ?? record['记忆钩子']),
    likes: cleanText(record.likes ?? record['偏好']),
    dislikes: cleanText(record.dislikes ?? record['忌口']),
    habits: cleanText(record.habits ?? record['习惯']),
    messageTendency: cleanText(record.messageTendency ?? record['消息倾向']),
    notes: cleanText(record.notes ?? record['备注']),
    createdAtTurn: Math.max(0, Math.floor(Number(record.createdAtTurn) || fallbackTurn || 0)),
    updatedAt: Math.max(0, Math.floor(Number(record.updatedAt) || now)),
  };
}

export function normalizeRegularGuestList(source: unknown, fallbackTurn = 0): RegularGuestUnit[] {
  if (!Array.isArray(source)) return [];
  const byId = new Map<string, RegularGuestUnit>();
  for (const item of source) {
    const normalized = normalizeRegularGuestUnit(item, fallbackTurn);
    if (!normalized) continue;
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()];
}

export function createRegularGuestFromFields(
  fields: Partial<RegularGuestUnit> & { name: string; type?: RegularGuestType },
  turn = 0,
): RegularGuestUnit {
  const type = normalizeRegularGuestType(fields.type);
  const identity = cleanText(fields.identity);
  const now = Date.now();
  return {
    id: cleanText(fields.id) || regularGuestId(fields.name, type, identity),
    name: cleanText(fields.name),
    type,
    sizeText: cleanText(fields.sizeText),
    identity,
    relationship: cleanText(fields.relationship) || '陌生人',
    memoryHook: cleanText(fields.memoryHook),
    likes: cleanText(fields.likes),
    dislikes: cleanText(fields.dislikes),
    habits: cleanText(fields.habits),
    messageTendency: cleanText(fields.messageTendency),
    notes: cleanText(fields.notes),
    createdAtTurn: Math.max(0, Math.floor(Number(fields.createdAtTurn) || turn || 0)),
    updatedAt: Math.max(0, Math.floor(Number(fields.updatedAt) || now)),
  };
}

export function formatRegularGuestBookContent(guests: RegularGuestUnit[]) {
  const backup: RegularGuestBookBackup = {
    version: 1,
    guests: normalizeRegularGuestList(guests),
    updatedAt: Date.now(),
  };
  return `<${REGULAR_GUEST_BOOK_BLOCK_TAG}>\n${JSON.stringify(backup, null, 2)}\n</${REGULAR_GUEST_BOOK_BLOCK_TAG}>`;
}

export function parseRegularGuestBookContent(content: string): RegularGuestBookBackup {
  const match = cleanText(content).match(new RegExp(`<${REGULAR_GUEST_BOOK_BLOCK_TAG}\\b[^>]*>([\\s\\S]*?)<\\/${REGULAR_GUEST_BOOK_BLOCK_TAG}>`, 'i'));
  if (!match?.[1]) return { version: 1, guests: [], updatedAt: 0 };
  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    return {
      version: 1,
      guests: normalizeRegularGuestList(parsed.guests),
      updatedAt: Math.max(0, Math.floor(Number(parsed.updatedAt) || 0)),
    };
  } catch {
    return { version: 1, guests: [], updatedAt: 0 };
  }
}

function regularGuestBookEntrySeed(guests: RegularGuestUnit[]): Partial<EditableWorldbookEntry> {
  return {
    name: REGULAR_GUEST_BOOK_ENTRY_NAME,
    comment: REGULAR_GUEST_BOOK_ENTRY_NAME,
    enabled: false,
    content: formatRegularGuestBookContent(guests),
    strategy: {
      type: 'selective',
      keys: [REGULAR_GUEST_BOOK_ENTRY_NAME, '常客簿', '老面孔', '常客'],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: { type: 'at_depth', role: 'system', depth: 4, order: 120 },
  };
}

export async function ensureRegularGuestBookWorldbookEntry(
  worldbookName = getPrimaryCharacterWorldbookName(),
  guests: RegularGuestUnit[] = [],
) {
  const targetWorldbook = cleanText(worldbookName);
  if (!targetWorldbook) throw new Error('当前角色没有主世界书，无法创建常客簿副本条目。');
  let entry = await loadWorldbookEntryByName(targetWorldbook, REGULAR_GUEST_BOOK_ENTRY_NAME);
  if (!entry) {
    entry = (await upsertWorldbookEntryByName(
      targetWorldbook,
      REGULAR_GUEST_BOOK_ENTRY_NAME,
      regularGuestBookEntrySeed(guests),
    )) as EditableWorldbookEntry;
  } else if (entry.enabled || !String(entry.content || '').includes(REGULAR_GUEST_BOOK_BLOCK_TAG)) {
    entry = await saveWorldbookEntry(targetWorldbook, {
      ...entry,
      enabled: false,
      content: String(entry.content || '').includes(REGULAR_GUEST_BOOK_BLOCK_TAG)
        ? entry.content
        : formatRegularGuestBookContent(guests),
    });
  }
  return {
    worldbookName: targetWorldbook,
    uid: Number(entry.uid),
    entryName: getWorldbookEntryName(entry) || REGULAR_GUEST_BOOK_ENTRY_NAME,
    entry,
  };
}

export async function saveRegularGuestBookToWorldbook(ref: WorldbookEntryRef, guests: RegularGuestUnit[]) {
  const entry = await loadWorldbookEntry(ref);
  if (!entry) throw new Error('常客簿副本条目已经不存在。');
  return saveWorldbookEntry(ref.worldbookName, {
    ...entry,
    enabled: false,
    content: formatRegularGuestBookContent(guests),
  });
}
