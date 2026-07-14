import {
  getPrimaryCharacterWorldbookName,
  getWorldbookEntryName,
  loadWorldbookEntry,
  matchesWorldbookEntryName,
  saveWorldbookEntry,
  upsertWorldbookEntryByName,
  type EditableWorldbookEntry,
  type WorldbookEntryRef,
} from './worldbookService';

export const TURN_CONTEXT_WORLDBOOK_ENTRY_NAME = '【普利莫迪亚｜本回合完整发送包｜自动覆盖】';

export interface TurnContextWorldbookBinding extends WorldbookEntryRef {
  worldbookName: string;
  uid: number;
  entryName: string;
  updatedAt?: number;
}

export interface TurnContextWorldbookWriteInput {
  turnId: string;
  playerAction: string;
  fullPrompt: string;
  updatedAt?: number;
}

function fixedEntrySeed(content = ''): Partial<EditableWorldbookEntry> {
  return {
    name: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
    comment: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
    enabled: true,
    content,
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: {
      type: 'at_depth',
      role: 'user',
      depth: 0,
      order: 0,
    },
  };
}

function placeholderContent() {
  return [
    '<PRIMORDIA_TURN_CONTEXT status="waiting">',
    '【说明】',
    '这是普利莫迪亚本回合完整发送包的自动覆盖条目。发送新回合前，前端会把本回合发生/待执行内容写入这里。',
    '</PRIMORDIA_TURN_CONTEXT>',
  ].join('\n');
}

export function formatTurnContextWorldbookContent(input: TurnContextWorldbookWriteInput) {
  const updatedAt = input.updatedAt ?? Date.now();
  const updatedAtText = new Date(updatedAt).toLocaleString();
  return [
    `<PRIMORDIA_TURN_CONTEXT turn_id="${input.turnId}" updated_at="${updatedAtText}">`,
    '【说明】',
    '这是普利莫迪亚前端为本回合写入的完整发送包，描述本回合发生/待执行内容、上下文、规则和输出要求。',
    '玩家本回合行动已经包含在完整发送包的 <玩家本回合行动> 中；不要重复读取或复述。',
    '外部工具可读取本条目辅助处理本回合行动；AI应按本条目执行，不要把说明文字写进正文。',
    '',
    '【前端完整发送包】',
    input.fullPrompt.trim() || '（无完整发送包）',
    '</PRIMORDIA_TURN_CONTEXT>',
  ].join('\n');
}

function bindingFromEntry(worldbookName: string, entry: EditableWorldbookEntry, updatedAt?: number): TurnContextWorldbookBinding {
  return {
    worldbookName,
    uid: Number(entry.uid),
    entryName: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
    updatedAt,
  };
}

export async function ensureTurnContextWorldbookBinding(worldbookName = '') {
  const targetWorldbook = worldbookName.trim() || getPrimaryCharacterWorldbookName();
  if (!targetWorldbook) throw new Error('没有找到当前角色主世界书，无法绑定本回合发送包条目。');
  const entry = await upsertWorldbookEntryByName(
    targetWorldbook,
    TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
    fixedEntrySeed(placeholderContent()),
  );
  return bindingFromEntry(targetWorldbook, entry);
}

export async function validateTurnContextWorldbookBinding(binding: Partial<TurnContextWorldbookBinding> | null | undefined) {
  const worldbookName = String(binding?.worldbookName || '').trim();
  const uid = Number(binding?.uid);
  if (!worldbookName || !Number.isFinite(uid)) {
    throw new Error('本回合发送包条目未绑定：缺少世界书名或 uid。');
  }
  const entry = await loadWorldbookEntry({ worldbookName, uid });
  if (!entry) throw new Error(`本回合发送包条目绑定失效：${worldbookName} 中找不到 uid=${uid}。`);
  if (!matchesWorldbookEntryName(entry, TURN_CONTEXT_WORLDBOOK_ENTRY_NAME)) {
    const actualName = getWorldbookEntryName(entry) || `uid ${uid}`;
    throw new Error(`本回合发送包条目绑定错误：当前条目是「${actualName}」，不是固定条目。`);
  }
  return { worldbookName, uid, entry };
}

export async function writeTurnContextWorldbookEntry(
  binding: Partial<TurnContextWorldbookBinding> | null | undefined,
  input: TurnContextWorldbookWriteInput,
) {
  const { worldbookName, entry } = await validateTurnContextWorldbookBinding(binding);
  const updatedAt = input.updatedAt ?? Date.now();
  const saved = await saveWorldbookEntry(worldbookName, {
    ...entry,
    ...fixedEntrySeed(formatTurnContextWorldbookContent({ ...input, updatedAt })),
    uid: entry.uid,
  } as EditableWorldbookEntry);
  return bindingFromEntry(worldbookName, saved, updatedAt);
}
