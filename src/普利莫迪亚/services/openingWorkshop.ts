import {
  getKnownWorldbookNames,
  getPrimaryCharacterWorldbookName,
  createWorldbookEntriesForEdit,
  getWorldbookEntryName,
  loadWorldbookEntriesForEdit,
  loadActiveWorldbookEntries,
  loadWorldbookEntryByName,
  matchesWorldbookEntryName,
  replaceWorldbookEntriesForEdit,
  upsertWorldbookEntryByName,
  type EditableWorldbookEntry,
} from './worldbookService';
import {
  TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
  type TurnContextWorldbookBinding,
} from './turnContextWorldbook';
import { parse as parseYaml } from 'yaml';
import { recordFinalPromptDebugSnapshot } from '../utils/unifiedRequest';

declare const generate:
  | undefined
  | ((options: {
      user_input: string;
      should_stream?: boolean;
      max_chat_history?: 'all' | number;
      overrides?: Record<string, unknown>;
      injects?: Array<Record<string, unknown>>;
    }) => Promise<unknown>);
declare const generateRaw:
  | undefined
  | ((options: {
      user_input?: string;
      should_stream?: boolean;
      should_silence?: boolean;
      max_chat_history?: 'all' | number;
      ordered_prompts?: Array<string | { role: 'system' | 'assistant' | 'user'; content: string }>;
    }) => Promise<unknown>);

export const OPENING_CHARACTER_TEMPLATE_ENTRY = '开局模板-人物档案';
export const OPENING_TAVERN_TEMPLATE_ENTRY = '开局模板-酒馆档案';
export const OPENING_CHARACTER_ENTRY = '开局人物档案';
export const OPENING_TAVERN_ENTRY = '开局酒馆档案';
export const OPENING_GAME_INFO_ENTRY = '游戏信息';
const DISABLED_OPENING_ARCHIVE_ENTRY_NAMES = [
  OPENING_CHARACTER_ENTRY,
  OPENING_TAVERN_ENTRY,
  OPENING_GAME_INFO_ENTRY,
] as const;
export const OPENING_REGION_ENTRY_NAMES = [
  '酒馆区域-主厅接待区',
  '酒馆区域-柜台酒水区',
  '酒馆区域-厨房餐食区',
  '酒馆区域-客房',
] as const;
const OPENING_TAVERN_REGION_NAMES = OPENING_REGION_ENTRY_NAMES.map(name => name.replace(/^酒馆区域-/, ''));

export interface OpeningCharacterInput {
  name: string;
  gender: string;
  age: string;
  race: string;
  originNote: string;
  appearance: string;
  personality: string;
  backstory: string;
}

export interface OpeningTavernInput {
  name: string;
  territory: string;
  city: string;
  place: string;
  status: string;
  style: string;
  story: string;
  funds: string;
  stock: string;
}

export interface OpeningModuleChoice {
  group: string;
  entryName: string;
}

export interface OpeningWorkshopDraft {
  character: OpeningCharacterInput;
  tavern: OpeningTavernInput;
  era: string;
  region: string;
  theme: string;
  moduleChoices: OpeningModuleChoice[];
  worldbookName: string;
}

export interface OpeningGeneratedProfile {
  title: string;
  profile: string;
  summary: string;
  tags: string[];
}

export interface OpeningStoryDraft {
  maintext: string;
  options: string[];
  sum: string;
  initvar?: Record<string, any>;
  initvarYaml?: string;
  raw?: string;
}

export interface OpeningGenerationBundle {
  characterProfile: OpeningGeneratedProfile;
  tavernProfile: OpeningGeneratedProfile;
  story: OpeningStoryDraft;
}

export interface OpeningTemplateDraft {
  characterTemplate: string;
  tavernTemplate: string;
}

export interface OpeningTemplateStatus {
  worldbookName: string;
  characterTemplateFound: boolean;
  tavernTemplateFound: boolean;
  missingEntries: string[];
  emptyEntries: string[];
  characterTemplateContent?: string;
  tavernTemplateContent?: string;
}

export interface OpeningWorldbookResult {
  characterEntry: EditableWorldbookEntry;
  tavernEntry: EditableWorldbookEntry;
  turnContextEntry: EditableWorldbookEntry;
  turnContextBinding: TurnContextWorldbookBinding;
  moduleResults: Array<OpeningModuleChoice & { prefix: string; matched: number; changed: number; foundTarget: boolean }>;
  templateResults: Array<{ entryName: string; found: boolean; changed: boolean }>;
  regionResults: Array<{ entryName: string; found: boolean; changed: boolean }>;
}

const OPENING_COPPER_PER_SILVER = 100;
const OPENING_COPPER_PER_GOLD = OPENING_COPPER_PER_SILVER * 10;
const OPENING_COPPER_PER_PLATINUM = OPENING_COPPER_PER_GOLD * 500;
const OPENING_COPPER_PER_MITHRIL = OPENING_COPPER_PER_PLATINUM * 500;

function openingMoneyBucket(totalCopper: number) {
  let rest = Math.max(0, Math.floor(Number(totalCopper) || 0));
  const mithril = Math.floor(rest / OPENING_COPPER_PER_MITHRIL);
  rest -= mithril * OPENING_COPPER_PER_MITHRIL;
  const platinum = Math.floor(rest / OPENING_COPPER_PER_PLATINUM);
  rest -= platinum * OPENING_COPPER_PER_PLATINUM;
  const gold = Math.floor(rest / OPENING_COPPER_PER_GOLD);
  rest -= gold * OPENING_COPPER_PER_GOLD;
  const silver = Math.floor(rest / OPENING_COPPER_PER_SILVER);
  rest -= silver * OPENING_COPPER_PER_SILVER;
  const copper = rest;

  return {
    铜币: copper,
    银币: silver,
    金币: gold,
    铂金币: platinum,
    秘银币: mithril,
    折算合计铜币: Math.max(0, Math.floor(Number(totalCopper) || 0)),
  };
}

function openingReputationState(value = 0) {
  const score = Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)));
  const stages = [
    { index: 1, min: 0, max: 200, label: '无人知晓', multiplier: 1.1 },
    { index: 2, min: 200, max: 1000, label: '略有耳闻', multiplier: 1.2 },
    { index: 3, min: 1000, max: 3000, label: '小有名气', multiplier: 1.4 },
    { index: 4, min: 3000, max: 5000, label: '远近闻名', multiplier: 1.7 },
    { index: 5, min: 5000, max: 9999, label: '声名远扬', multiplier: 2 },
  ] as const;
  const stage = [...stages].reverse().find(item => score >= item.min) ?? stages[0];
  return {
    数值: score,
    阶段: stage.index,
    名称: stage.label,
    乘数: stage.multiplier,
    范围: stage.index >= 5 ? `${stage.min}+` : `${stage.min}-${stage.max}`,
  };
}

const DEFAULT_OPENING_TEMPLATE = `<maintext>
{{时代}}，{{地区}}的{{城市}}还停在一天最初的光里。{{主角名}}站在{{酒馆名}}的{{酒馆位置}}，眼前是刚刚接手的柜台、桌椅、灶火和账本。

{{主角名}}是一名{{年龄}}岁的{{种族}}{{性别称呼}}。{{外貌句}}{{性格句}}{{出身句}}{{个人故事句}}

这间酒馆位于{{领地}}，经营状态是{{经营状态}}。{{酒馆风格句}}{{酒馆故事句}}它还不算热闹，却已经足够成为一个起点：客人会来，消息会来，麻烦和机会也会从门外一点点靠近。

今天不需要立刻发生冲突。{{主角名}}只需要先看清这间酒馆、这座城市，以及自己接下来想走的第一步。
</maintext>
<option>
1.开始我们的故事
</option>`;

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function cloneOpeningEntry(entry: EditableWorldbookEntry): EditableWorldbookEntry {
  try {
    return structuredClone(entry);
  } catch {
    return JSON.parse(JSON.stringify(entry));
  }
}

function replaceOpeningManagedBlock(content: string, block: string, marker = 'PrimordiaOpening') {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const wrapped = `${start}\n${block.trim()}\n${end}`;
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  const source = String(content ?? '').trim();
  if (pattern.test(source)) return source.replace(pattern, wrapped);
  return source ? `${source}\n\n${wrapped}` : wrapped;
}

function normalizeLines(value: string, fallback = '') {
  const text = cleanText(value);
  return text || fallback;
}

function sentence(value: string, fallback = '') {
  const text = cleanText(value);
  if (!text) return fallback;
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function genderNoun(gender: string, age: string) {
  const parsedAge = Number.parseInt(age, 10);
  const young = Number.isFinite(parsedAge) && parsedAge > 0 && parsedAge < 18;
  if (gender === '男') return young ? '少年' : '男人';
  if (gender === '女') return young ? '少女' : '女人';
  return cleanText(gender) || '人物';
}

function replaceOpeningTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_, rawKey: string) => values[cleanText(rawKey)] ?? '');
}

function stripCodeFence(text: string) {
  return cleanText(text)
    .replace(/^```(?:json|xml|html)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractTaggedBlock(text: string, tagName: string) {
  const source = stripCodeFence(text);
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = source.match(pattern);
  return cleanText(match?.[1]);
}

function extractAnyTaggedBlock(text: string, tagNames: string[]) {
  for (const tagName of tagNames) {
    const value = extractTaggedBlock(text, tagName);
    if (value) return value;
  }
  return '';
}

function stripOpeningForbiddenBlocks(text: string) {
  return stripCodeFence(text)
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thought\b[^>]*>[\s\S]*?<\/thought>/gi, '')
    .replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable>/gi, '')
    .replace(/<Analysis\b[^>]*>[\s\S]*?<\/Analysis>/gi, '')
    .replace(/<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi, '')
    .replace(/<JSONPatch\b[^>]*>[\s\S]*?<\/JSONPatch>/gi, '')
    .trim();
}

function extractOpeningInitvarYaml(text: string) {
  const updateVariable = extractTaggedBlock(text, 'UpdateVariable') || text;
  const initvar = extractTaggedBlock(updateVariable, 'initvar');
  if (!initvar) return '';
  return initvar
    .replace(/^```(?:ya?ml)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function decodeJsonPointerPath(path: unknown) {
  if (typeof path !== 'string') return [];
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function setDeepValue(target: Record<string, any>, path: string[], value: unknown) {
  if (!path.length) return;
  let cursor: Record<string, any> = target;
  for (const key of path.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, any>;
  }
  cursor[path[path.length - 1]] = value;
}

function stripOpeningForbiddenVariableKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOpeningForbiddenVariableKeys);
  if (!value || typeof value !== 'object') return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '坐标' || key === '当前坐标' || key === '地图' || key === '系统判定') continue;
    cleaned[key] = stripOpeningForbiddenVariableKeys(child);
  }
  return cleaned;
}

function parseOpeningJsonPatchInitvar(text: string) {
  const patchText = extractTaggedBlock(text, 'JSONPatch');
  if (!patchText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(patchText));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI 输出了 JSONPatch，但这段 JSONPatch 无法转换为初始变量：${message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('AI 输出了 JSONPatch，但 JSONPatch 不是数组，无法转换为初始变量。');
  }
  const initvar: Record<string, any> = {};
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const patch = item as Record<string, unknown>;
    const op = String(patch.op ?? '').toLowerCase();
    if (!['insert', 'replace', 'add'].includes(op)) continue;
    const path = decodeJsonPointerPath(patch.path);
    if (!path.length) continue;
    setDeepValue(initvar, path, stripOpeningForbiddenVariableKeys(patch.value));
  }
  if (!Object.keys(initvar).length) {
    throw new Error('AI 输出了 JSONPatch，但其中没有可转换的初始变量。');
  }
  return initvar;
}

function parseOpeningInitvar(text: string) {
  const yamlText = extractOpeningInitvarYaml(text);
  if (!yamlText) {
    if (/<JSONPatch\b|<\/JSONPatch>/i.test(text)) {
      throw new Error('开局只能输出 <initvar>，不能输出 JSONPatch。');
    }
    throw new Error('AI 没有输出 <UpdateVariable><initvar> 初始变量。');
  }
  if (/<JSONPatch\b|<\/JSONPatch>/i.test(text)) {
    throw new Error('AI 同时输出了 initvar 和 JSONPatch，开局只能保留 initvar。');
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`开局 initvar YAML 解析失败：${message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('开局 initvar 必须是 YAML 对象。');
  }
  const record = parsed as Record<string, any>;
  const requiredTopKeys = ['世界', '酒馆', '主角', '库房', '行囊', '临时状态', '人物羁绊', '农田与酒窖', '街坊商铺'];
  const missing = requiredTopKeys.filter(key => !(key in record));
  if (missing.length) throw new Error(`开局 initvar 缺少顶层变量：${missing.join('、')}。`);
  return { initvar: record, initvarYaml: yamlText };
}

function extractPlainOpeningText(text: string) {
  const plain = stripOpeningForbiddenBlocks(text)
    .replace(/<option\b[^>]*>[\s\S]*?<\/option>/gi, '')
    .replace(/<sum\b[^>]*>[\s\S]*?<\/sum>/gi, '')
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '')
    .replace(/<\/?maintext\b[^>]*>/gi, '')
    .trim();
  if (!plain || plain.startsWith('{') || plain.startsWith('[')) return '';
  return plain;
}

function extractJsonObject(text: string) {
  const source = stripCodeFence(text);
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('AI 没有返回 JSON 对象。');
  return source.slice(first, last + 1)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

function parseJsonRecord(text: string, context: string) {
  try {
    const parsed = JSON.parse(extractJsonObject(text));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${context}格式不完整：请让 AI 使用页面要求的标签格式重新生成。原始解析错误：${message}`);
  }
}

async function runOpeningGeneration(prompt: string) {
  const systemPrompt =
    '你是普利莫迪亚开局设定整理器。严格按用户要求的 XML 风格标签输出，不输出解释、Markdown 代码块或额外前后缀。开局生成阶段绝对不要输出 <UpdateVariable>、<Analysis>、<JSONPatch>，也不要初始化或修改任何变量。';
  const result = await runIsolatedOpeningGeneration(prompt, systemPrompt);
  const text = coerceGenerationText(result);
  if (!text) throw new Error('AI 没有返回可读取的文本。');
  return text;
}

async function runIsolatedOpeningGeneration(prompt: string, systemPrompt: string) {
  recordFinalPromptDebugSnapshot({
    source: '开局生成预检',
    dryRun: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    activatedWorldbookEntries: [],
  });

  if (typeof generateRaw === 'function') {
    return generateRaw({
      should_stream: false,
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });
  }

  if (typeof generate !== 'function') throw new Error('当前环境没有提供 generate 接口。');
  return generate({
    user_input: prompt,
    should_stream: false,
    max_chat_history: 0,
    overrides: {
      world_info_before: '',
      world_info_after: '',
      chat_history: { with_depth_entries: false, prompts: [] },
    },
    injects: [
      {
        role: 'system',
        content: systemPrompt,
        position: 'none',
        depth: 0,
        should_scan: false,
      },
    ],
  });
}

function parseTagsList(text: string) {
  return cleanText(text)
    .split(/[、，,\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeProfile(raw: unknown, fallbackTitle: string): OpeningGeneratedProfile {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    title: cleanText(record.title) || fallbackTitle,
    profile: cleanText(record.profile) || cleanText(record.content),
    summary: cleanText(record.summary),
    tags: Array.isArray(record.tags) ? record.tags.map(cleanText).filter(Boolean) : [],
  };
}

function parseOpeningProfile(text: string, fallbackTitle: string, context: string): OpeningGeneratedProfile {
  const source = stripOpeningForbiddenBlocks(text);
  const title = extractAnyTaggedBlock(source, ['title', '标题', 'shortTitle']);
  const profile = extractAnyTaggedBlock(source, ['profile', '档案', 'content']);
  const summary = extractAnyTaggedBlock(source, ['summary', '摘要']);
  const tags = parseTagsList(extractAnyTaggedBlock(source, ['tags', '标签']));
  if (profile) {
    return {
      title: title || fallbackTitle,
      profile: stripOpeningForbiddenBlocks(profile),
      summary,
      tags,
    };
  }
  return normalizeProfile(parseJsonRecord(source, context), fallbackTitle);
}

function normalizeStory(raw: unknown): OpeningStoryDraft {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    maintext: stripOpeningForbiddenBlocks(cleanText(record.maintext)),
    options: ['开始我们的故事'],
    sum: cleanText(record.sum),
  };
}

function coerceGenerationText(result: unknown) {
  if (typeof result === 'string') return cleanText(result);
  if (result && typeof result === 'object') {
    const record = result as Record<string, any>;
    return cleanText(
      record.generatedText ??
        record.normalizedMessage ??
        record.message ??
        record.content ??
        record.text ??
        record.response ??
        '',
    );
  }
  return cleanText(result);
}

function parseOpeningStory(text: string): OpeningStoryDraft {
  const source = stripOpeningForbiddenBlocks(text);
  const maintext = extractAnyTaggedBlock(source, ['maintext', '正文']);
  const sum = extractAnyTaggedBlock(source, ['sum', 'summary', '摘要']);
  if (maintext) {
    return {
      maintext: stripOpeningForbiddenBlocks(maintext),
      options: ['开始我们的故事'],
      sum,
    };
  }
  const plain = extractPlainOpeningText(source);
  if (plain) {
    return {
      maintext: plain,
      options: ['开始我们的故事'],
      sum: '',
    };
  }
  return normalizeStory(parseJsonRecord(source, '开场白'));
}

function buildOpeningCharacterProfileFromDraft(draft: OpeningWorkshopDraft): OpeningGeneratedProfile {
  const protagonist = normalizeLines(draft.character.name, '克斯');
  const race = normalizeLines(draft.character.race, '人类');
  const gender = normalizeLines(draft.character.gender, '未指定');
  const age = normalizeLines(draft.character.age, '未知年龄');
  const title = `${race}酒馆主人`;
  const profile = [
    `姓名: ${protagonist}`,
    `性别: ${gender}`,
    `年龄: ${age}`,
    `种族: ${race}`,
    draft.character.originNote ? `出身/备注: ${draft.character.originNote}` : '',
    draft.character.appearance ? `外貌: ${draft.character.appearance}` : '',
    draft.character.personality ? `性格: ${draft.character.personality}` : '',
    draft.character.backstory ? `个人故事: ${draft.character.backstory}` : '',
  ].filter(Boolean).join('\n');
  return {
    title,
    profile,
    summary: `${protagonist}是${draft.tavern.city || draft.tavern.territory || '普利莫迪亚'}的${race}酒馆主人。`,
    tags: [race, gender, draft.character.personality].map(cleanText).filter(Boolean),
  };
}

function buildOpeningTavernProfileFromDraft(draft: OpeningWorkshopDraft): OpeningGeneratedProfile {
  const tavernName = normalizeLines(draft.tavern.name, '铁壶酒馆');
  const territory = normalizeLines(draft.tavern.territory || draft.region, '韦斯托利亚');
  const city = normalizeLines(draft.tavern.city, '布拉姆维克');
  const place = normalizeLines(draft.tavern.place, '主厅接待区');
  const style = normalizeLines(draft.tavern.style, '玩家未指定，按开局故事推断');
  const regionLines = OPENING_TAVERN_REGION_NAMES.map(regionName => {
    const focus = regionName === place ? '当前开局落点，细节需要最明确' : '按本次酒馆风格延展';
    return `- ${regionName}: 状态=${normalizeLines(draft.tavern.status, '普通')}；风格=${style}；描述=${focus}；设施=按开局资金与库存倾向配置。`;
  });
  const profile = [
    `名称: ${tavernName}`,
    `领地: ${territory}`,
    `城市: ${city}`,
    `酒馆位置: ${place}`,
    `经营状态: ${normalizeLines(draft.tavern.status, '普通')}`,
    draft.tavern.style ? `酒馆风格: ${draft.tavern.style}` : '',
    draft.tavern.funds ? `初始资金倾向: ${draft.tavern.funds}` : '',
    draft.tavern.stock ? `初始库存倾向: ${draft.tavern.stock}` : '',
    draft.tavern.story ? `酒馆故事: ${draft.tavern.story}` : '',
    '整体概况与当前已确定空间:',
    ...regionLines,
  ].filter(Boolean).join('\n');
  return {
    title: tavernName,
    profile,
    summary: `${tavernName}位于${territory}的${city}，开局落点是${place}。`,
    tags: [territory, city, draft.tavern.status, draft.tavern.style].map(cleanText).filter(Boolean),
  };
}

function buildOpeningStoryFromTemplate(draft: OpeningWorkshopDraft): OpeningStoryDraft {
  const protagonist = normalizeLines(draft.character.name, '克斯');
  const tavernName = normalizeLines(draft.tavern.name, '铁壶酒馆');
  const territory = normalizeLines(draft.tavern.territory || draft.region, '韦斯托利亚');
  const city = normalizeLines(draft.tavern.city, '布拉姆维克');
  const place = normalizeLines(draft.tavern.place, '主厅接待区');
  const values: Record<string, string> = {
    时代: normalizeLines(draft.era, '共栖历1303年'),
    地区: territory,
    领地: territory,
    城市: city,
    酒馆位置: place,
    主角名: protagonist,
    性别: cleanText(draft.character.gender),
    性别称呼: genderNoun(draft.character.gender, draft.character.age),
    年龄: normalizeLines(draft.character.age, '未知年龄'),
    种族: normalizeLines(draft.character.race, '人类'),
    出身备注: cleanText(draft.character.originNote),
    外貌: cleanText(draft.character.appearance),
    性格: cleanText(draft.character.personality),
    个人故事: cleanText(draft.character.backstory),
    酒馆名: tavernName,
    经营状态: normalizeLines(draft.tavern.status, '普通'),
    酒馆风格: cleanText(draft.tavern.style),
    酒馆故事: cleanText(draft.tavern.story),
    开局主题: cleanText(draft.theme),
    外貌句: draft.character.appearance ? sentence(draft.character.appearance) : '',
    性格句: draft.character.personality ? sentence(`性格关键词是${draft.character.personality}`) : '',
    出身句: draft.character.originNote ? sentence(draft.character.originNote) : '',
    个人故事句: draft.character.backstory ? sentence(draft.character.backstory) : '',
    酒馆风格句: draft.tavern.style ? sentence(draft.tavern.style) : '',
    酒馆故事句: draft.tavern.story ? sentence(draft.tavern.story) : '',
  };
  return parseOpeningStory(replaceOpeningTemplate(DEFAULT_OPENING_TEMPLATE, values));
}

export function buildModularOpeningBundle(draft: OpeningWorkshopDraft): OpeningGenerationBundle {
  return {
    characterProfile: buildOpeningCharacterProfileFromDraft(draft),
    tavernProfile: buildOpeningTavernProfileFromDraft(draft),
    story: buildOpeningStoryFromTemplate(draft),
  };
}

function normalizeOpeningTemplateDraft(raw: unknown): OpeningTemplateDraft {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const characterTemplate = cleanText(record.characterTemplate ?? record.character_template ?? record['人物档案模板']);
  const tavernTemplate = cleanText(record.tavernTemplate ?? record.tavern_template ?? record['酒馆档案模板']);
  if (!characterTemplate) throw new Error('AI 没有生成「开局模板-人物档案」正文。');
  if (!tavernTemplate) throw new Error('AI 没有生成「开局模板-酒馆档案」正文。');
  return { characterTemplate, tavernTemplate };
}

function parseOpeningTemplates(text: string): OpeningTemplateDraft {
  const characterTemplate = extractAnyTaggedBlock(text, ['characterTemplate', '人物档案模板']);
  const tavernTemplate = extractAnyTaggedBlock(text, ['tavernTemplate', '酒馆档案模板']);
  if (characterTemplate && tavernTemplate) return { characterTemplate, tavernTemplate };
  return normalizeOpeningTemplateDraft(parseJsonRecord(text, '开局模板'));
}

async function loadTemplateContent(worldbookName: string, entryName: string) {
  const found = await findOpeningTemplateEntry(entryName, worldbookName);
  const entry = found?.entry ?? null;
  if (!entry) throw new Error(`当前绑定世界书缺少「${entryName}」。`);
  const content = entry.content?.trim() ?? '';
  if (!content) throw new Error(`当前绑定世界书里的「${entryName}」正文为空。`);
  return content;
}

async function findOpeningTemplateEntry(entryName: string, preferredWorldbookName = '') {
  const preferred = cleanText(preferredWorldbookName);
  try {
    const activeItems = await loadActiveWorldbookEntries();
    const matches = activeItems.filter(item => matchesWorldbookEntryName(item.entry, entryName));
    const preferredMatch = matches.find(item => item.worldbookName === preferred);
    const match = preferredMatch ?? matches[0];
    if (match) {
      return {
        worldbookName: match.worldbookName,
        entry: cloneOpeningEntry(match.entry),
      };
    }
  } catch (error) {
    console.warn(`[Primordia] 扫描当前绑定世界书模板失败：${entryName}`, error);
  }

  if (preferred) {
    const entry = await loadWorldbookEntryByName(preferred, entryName);
    if (entry) return { worldbookName: preferred, entry };
  }

  return null;
}

export function availableOpeningWorldbooks() {
  return getKnownWorldbookNames();
}

export function defaultOpeningWorldbookName() {
  return getPrimaryCharacterWorldbookName() || getKnownWorldbookNames()[0] || '';
}

export async function inspectOpeningTemplates(worldbookName: string): Promise<OpeningTemplateStatus> {
  const characterFound = await findOpeningTemplateEntry(OPENING_CHARACTER_TEMPLATE_ENTRY, worldbookName);
  const tavernFound = await findOpeningTemplateEntry(OPENING_TAVERN_TEMPLATE_ENTRY, worldbookName);
  const characterTemplate = characterFound?.entry ?? null;
  const tavernTemplate = tavernFound?.entry ?? null;
  const missingEntries = [
    characterTemplate ? '' : OPENING_CHARACTER_TEMPLATE_ENTRY,
    tavernTemplate ? '' : OPENING_TAVERN_TEMPLATE_ENTRY,
  ].filter(Boolean);
  const emptyEntries = [
    characterTemplate && !cleanText(characterTemplate.content) ? OPENING_CHARACTER_TEMPLATE_ENTRY : '',
    tavernTemplate && !cleanText(tavernTemplate.content) ? OPENING_TAVERN_TEMPLATE_ENTRY : '',
  ].filter(Boolean);
  return {
    worldbookName: characterFound?.worldbookName || tavernFound?.worldbookName || worldbookName,
    characterTemplateFound: Boolean(characterTemplate && cleanText(characterTemplate.content)),
    tavernTemplateFound: Boolean(tavernTemplate && cleanText(tavernTemplate.content)),
    missingEntries,
    emptyEntries,
    characterTemplateContent: cleanText(characterTemplate?.content),
    tavernTemplateContent: cleanText(tavernTemplate?.content),
  };
}

export async function saveOpeningTemplateContent(worldbookName: string, entryName: string, content: string) {
  const targetWorldbook = worldbookName || defaultOpeningWorldbookName();
  if (!targetWorldbook) throw new Error('没有可写入的世界书。');
  const cleanName = cleanText(entryName);
  const allowedNames = [OPENING_CHARACTER_TEMPLATE_ENTRY, OPENING_TAVERN_TEMPLATE_ENTRY] as string[];
  if (!allowedNames.includes(cleanName)) {
    throw new Error(`「${cleanName}」不是可保存的开局模板条目。`);
  }
  const cleanContent = cleanText(content);
  if (!cleanContent) throw new Error('模板正文不能为空。');
  return upsertWorldbookEntryByName(targetWorldbook, cleanName, {
    enabled: true,
    content: cleanContent,
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: { type: 'at_depth', role: 'system', depth: 4, order: 95 },
  });
}

export async function saveOpeningTemplates(worldbookName: string, templates: OpeningTemplateDraft) {
  const targetWorldbook = worldbookName || defaultOpeningWorldbookName();
  if (!targetWorldbook) throw new Error('没有可写入的世界书。');
  const characterEntry = await saveOpeningTemplateContent(targetWorldbook, OPENING_CHARACTER_TEMPLATE_ENTRY, templates.characterTemplate);
  const tavernEntry = await saveOpeningTemplateContent(targetWorldbook, OPENING_TAVERN_TEMPLATE_ENTRY, templates.tavernTemplate);
  return { characterEntry, tavernEntry };
}

export async function generateOpeningTemplates(draft: OpeningWorkshopDraft): Promise<OpeningTemplateDraft> {
  const prompt = `请根据本次开局登记信息，写出两份“开局生成中间模板”。这些模板会被前端保存到世界书条目中，随后用于生成人物档案和酒馆档案。

只输出以下标签，不要输出 JSON，不要输出 Markdown 代码块，不要输出解释：
<characterTemplate>
开局模板-人物档案正文
</characterTemplate>
<tavernTemplate>
开局模板-酒馆档案正文
</tavernTemplate>

要求：
- 模板正文要像给 AI 的生成规范，不要写最终档案。
- 当前是“模板生成阶段”，不是“开场白阶段”；不要写故事正文，不要写第一天叙事。
- 模板里应明确本次开局需要保留的字段、风格、世界观重点和禁止跑偏事项。
- 人物模板服务于“根据玩家素材整理主角档案”。
- 酒馆模板服务于“根据玩家素材整理酒馆档案”，必须要求最终档案写出八个酒馆区域：${OPENING_TAVERN_REGION_NAMES.join('、')}。
- 酒馆模板必须要求每个区域写 状态、风格、描述、设施倾向，且全部体现玩家填写的酒馆风格和酒馆故事。
- 酒馆模板必须提醒：不要沿用默认区域词，如“木石混合”“橡木与石墙”“深色橡木”“石灶与铁锅”“木梁与粗布”“石壁与木桶”，除非玩家风格本来就是这些。
- 标签内部可以换行；不要省略任一标签。
- 绝对不要输出 <maintext>、<option>、<UpdateVariable>、<Analysis>、<JSONPatch>。

本次开局信息：
时代：${draft.era}
地区/领地：${draft.region || draft.tavern.territory}
开局主题：${draft.theme}

主角：
姓名：${draft.character.name}
性别：${draft.character.gender}
年龄：${draft.character.age}
种族：${draft.character.race}
出身/备注：${draft.character.originNote}
外貌：${draft.character.appearance}
性格：${draft.character.personality}
个人故事：${draft.character.backstory}

酒馆：
名称：${draft.tavern.name}
领地：${draft.tavern.territory}
城市：${draft.tavern.city}
酒馆位置：${draft.tavern.place}
经营状态：${draft.tavern.status}
酒馆风格：${draft.tavern.style}
资金倾向：${draft.tavern.funds}
库存倾向：${draft.tavern.stock}
酒馆故事：${draft.tavern.story}`;
  return parseOpeningTemplates(await runOpeningGeneration(prompt));
}

export async function generateAndWriteOpeningTemplates(draft: OpeningWorkshopDraft) {
  const templates = await generateOpeningTemplates(draft);
  const entries = await saveOpeningTemplates(draft.worldbookName, templates);
  return { ...templates, ...entries };
}

export async function generateOpeningCharacterProfile(
  input: OpeningCharacterInput,
  worldbookName: string,
  tavernInput?: OpeningTavernInput,
): Promise<OpeningGeneratedProfile> {
  const template = await loadTemplateContent(worldbookName, OPENING_CHARACTER_TEMPLATE_ENTRY);
  const tavernContext = tavernInput
    ? `

酒馆登记信息：
酒馆名：${tavernInput.name || '未填写'}
领地：${tavernInput.territory || '未填写'}
城市：${tavernInput.city || '未填写'}
酒馆位置：${tavernInput.place || '未填写'}
经营状态：${tavernInput.status || '未填写'}

人物档案必须把“酒馆名”作为主角当前经营/接手的酒馆名称写进去；不要另起一个不同的酒馆名。`
    : '';
  const prompt = `请根据玩家素材和“人物档案模板”整理普利莫迪亚主角开局档案。只输出以下标签，不要输出 JSON，不要输出 Markdown 代码块，不要输出解释：
<title>短称号</title>
<profile>
完整人物档案
</profile>
<summary>一句话摘要</summary>
<tags>标签1、标签2</tags>

人物档案模板：
${template}
${tavernContext}

玩家素材：
姓名：${input.name}
性别：${input.gender}
年龄：${input.age}
种族：${input.race}
出身/备注：${input.originNote}
外貌：${input.appearance}
性格：${input.personality}
个人故事：${input.backstory}`;
  return parseOpeningProfile(await runOpeningGeneration(prompt), input.name || '主角', '人物档案');
}

export async function generateOpeningTavernProfile(
  input: OpeningTavernInput,
  worldbookName: string,
): Promise<OpeningGeneratedProfile> {
  const template = await loadTemplateContent(worldbookName, OPENING_TAVERN_TEMPLATE_ENTRY);
  const prompt = `请根据玩家素材和“酒馆档案模板”整理普利莫迪亚酒馆开局档案。只输出以下标签，不要输出 JSON，不要输出 Markdown 代码块，不要输出解释：
<title>酒馆短标题</title>
<profile>
完整酒馆档案，必须包含整体概况和当前已确定空间
</profile>
<summary>一句话摘要</summary>
<tags>标签1、标签2</tags>

硬性要求：
- <profile> 里必须有“整体概况”和“当前已确定空间”或同等标题。
- 整体概况要总结：酒馆当前真正可用的空间、仍堆着旧家具/灰尘/杂物但尚未成立的地方、整体经营气质。
- 当前已确定空间只写开局明确存在或已经可用的空间，默认可包含：${OPENING_TAVERN_REGION_NAMES.join('、')}。
- 不要强制生成固定区域；前门、地窖、后院、马厩等只有玩家设定明确存在，或正文实际清理、搭建、修缮、命名后，才写成独立区域。
- 每个已确定空间必须写：状态、风格、描述、设施倾向。
- 每个已确定空间的风格和描述都要继承玩家的“酒馆风格”“经营状态”“酒馆故事”，不能写成通用默认酒馆。
- 不得沿用默认模板词，如“木石混合”“橡木与石墙”“深色橡木”“石灶与铁锅”“木梁与粗布”“石壁与木桶”，除非玩家填写的酒馆风格本来就是这些。
- 酒馆位置“${input.place || '未指定'}”对应的区域要写得最具体，因为开局会落在那里。

酒馆档案模板：
${template}

玩家素材：
酒馆名：${input.name}
领地：${input.territory}
城市：${input.city}
酒馆位置：${input.place}
经营状态：${input.status}
酒馆风格：${input.style}
资金倾向：${input.funds}
库存倾向：${input.stock}
酒馆故事：${input.story}`;
  return parseOpeningProfile(await runOpeningGeneration(prompt), input.name || '酒馆', '酒馆档案');
}

export async function generateOpeningStory(
  draft: OpeningWorkshopDraft,
  characterProfile: OpeningGeneratedProfile,
  tavernProfile: OpeningGeneratedProfile,
): Promise<OpeningStoryDraft> {
  const prompt = `请根据人物档案、酒馆档案和世界选择，生成普利莫迪亚第一层开场白正文。只输出以下标签，不要输出 JSON，不要输出 Markdown 代码块，不要输出解释：
<maintext>
800-1400字正文，不含其它标签，交代故事背景，结尾不要设置冲突
</maintext>
<sum>一句话摘要</sum>

硬性限制：
- 只写开场白正文，不要初始化变量。
- 绝对不要输出 <UpdateVariable>、<Analysis>、<JSONPatch>。
- 不要写“今天是第几月第几天”这种会覆盖前端变量的断言，除非下面的世界选择明确给出。
- 不要写地图坐标、变量路径、库存、资金、人物羁绊、酒馆区域 JSON。

缺省开场白模板含义：
<maintext>
{{时代}}的{{地区}}，{{主角名}}来到或接手了{{酒馆名}}。正文需要自然交代人物、酒馆、城市、第一天的空气和可行动的起点。
</maintext>
<option>
1.开始我们的故事
</option>

世界选择：
时代：${draft.era}
地区：${draft.region}
主题：${draft.theme}

人物档案：
${characterProfile.profile}

酒馆档案：
${tavernProfile.profile}`;
  return parseOpeningStory(await runOpeningGeneration(prompt));
}

async function runOpeningInitvarGeneration(prompt: string) {
  const result = await runIsolatedOpeningGeneration(
    prompt,
    '你是普利莫迪亚专用开局生成器。当前任务是初始化第 1 层，不是普通回合更新。必须同时生成开场正文和完整初始变量。严格输出用户要求的 XML 标签，不输出解释、Markdown 代码块或额外前后缀。开局变量只能使用 <UpdateVariable><initvar> YAML，不得使用 JSONPatch，不得输出 <Analysis>。',
  );
  const text = coerceGenerationText(result);
  if (!text) throw new Error('AI 没有返回可读取的文本。');
  return text;
}

function parseOpeningStoryWithInitvar(text: string): OpeningStoryDraft {
  const source = stripCodeFence(text);
  const taggedMaintext = extractAnyTaggedBlock(source, ['maintext', '正文']);
  const plainMaintext = taggedMaintext ? '' : extractPlainOpeningText(source);
  const maintext = taggedMaintext || plainMaintext;
  if (!maintext) throw new Error('AI 没有输出 <maintext> 开场正文，也没有可提取的开场正文文本。');
  const sum = extractAnyTaggedBlock(source, ['sum', 'summary', '摘要']);
  const { initvar, initvarYaml } = parseOpeningInitvar(source);
  return {
    maintext: stripOpeningForbiddenBlocks(maintext),
    options: ['开始我们的故事'],
    sum,
    initvar,
    initvarYaml,
    raw: source,
  };
}

function readOpeningInitvarPath(source: unknown, path: string) {
  if (!source || typeof source !== 'object') return '';
  const value = path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
  return cleanText(value);
}

function setOpeningInitvarPath(source: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let current: Record<string, unknown> = source;
  keys.slice(0, -1).forEach(key => {
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  });
  current[keys[keys.length - 1]] = value;
}

function enforceOpeningDraftFacts(story: OpeningStoryDraft, draft: OpeningWorkshopDraft) {
  if (!story.initvar || typeof story.initvar !== 'object' || Array.isArray(story.initvar)) return;
  const initvar = story.initvar as Record<string, unknown>;
  const tavernTerritory = cleanText(draft.tavern.territory || draft.region);
  const tavernCity = cleanText(draft.tavern.city);
  const tavernPlace = cleanText(draft.tavern.place);
  const tavernName = cleanText(draft.tavern.name);
  const protagonistName = cleanText(draft.character.name);
  const protagonistRace = cleanText(draft.character.race);

  if (draft.era) setOpeningInitvarPath(initvar, '世界.时代', cleanText(draft.era));
  if (tavernTerritory) setOpeningInitvarPath(initvar, '世界.地区', tavernTerritory);
  if (tavernCity) setOpeningInitvarPath(initvar, '世界.当前地点.区域', tavernCity);
  if (tavernPlace) setOpeningInitvarPath(initvar, '世界.当前地点.具体位置', tavernPlace);
  if (tavernName) setOpeningInitvarPath(initvar, '酒馆.名称', tavernName);
  if (tavernTerritory) setOpeningInitvarPath(initvar, '酒馆.所属领地', tavernTerritory);
  if (tavernCity) setOpeningInitvarPath(initvar, '酒馆.所在城市', tavernCity);
  if (draft.tavern.status) setOpeningInitvarPath(initvar, '酒馆.今日营业状态', cleanText(draft.tavern.status));
  if (protagonistName) setOpeningInitvarPath(initvar, '主角.姓名', protagonistName);
  if (protagonistRace) setOpeningInitvarPath(initvar, '主角.种族', protagonistRace);
  if (tavernPlace) setOpeningInitvarPath(initvar, '主角.所在位置', tavernPlace);
  if (draft.character.appearance) setOpeningInitvarPath(initvar, '主角.一句话穿着', cleanText(draft.character.appearance));
}

function assertOpeningStoryMatchesDraft(story: OpeningStoryDraft, draft: OpeningWorkshopDraft) {
  const checks = [
    { label: '主角姓名', expected: draft.character.name, actual: readOpeningInitvarPath(story.initvar, '主角.姓名') },
    { label: '主角种族', expected: draft.character.race, actual: readOpeningInitvarPath(story.initvar, '主角.种族') },
    { label: '酒馆名称', expected: draft.tavern.name, actual: readOpeningInitvarPath(story.initvar, '酒馆.名称') },
    { label: '所在城市', expected: draft.tavern.city, actual: readOpeningInitvarPath(story.initvar, '世界.当前地点.区域') },
    { label: '酒馆位置', expected: draft.tavern.place, actual: readOpeningInitvarPath(story.initvar, '世界.当前地点.具体位置') },
  ];
  const mismatches = checks.filter(item => {
    const expected = cleanText(item.expected);
    if (!expected) return false;
    return cleanText(item.actual) !== expected;
  });
  if (mismatches.length) {
    throw new Error(
      `AI 返回的开局变量与当前登记不一致：${mismatches
        .map(item => `${item.label} 应为“${cleanText(item.expected)}”，实际为“${cleanText(item.actual) || '空'}”`)
        .join('；')}。请重新生成，旧开局内容不会写入楼层。`,
    );
  }
}

const OPENING_INITVAR_SCHEMA_GUIDE = `正式 initvar 顶层必须包含：
世界:
  时代: 字符串
  地区: 字符串
  当前历法:
    年: 数字
    月份序号: 数字
    月份名: 字符串
    季节: 字符串
    日: 数字
    时段: 字符串
    天气: 字符串
    时间: HH:mm 字符串
  当前地点:
    区域: 字符串
    具体位置: 字符串
酒馆:
  名称: 字符串
  声望: { 数值: 0-9999, 阶段: 1-5, 名称: 无人知晓/略有耳闻/小有名气/远近闻名/声名远扬, 乘数: 数字, 范围: "0-200" }
  声望值: 数字
  声望名: 阶段名称
  资金:
    随身钱袋: 铜币/银币/金币/铂金币/秘银币/折算合计铜币
    钱匣: 铜币/银币/金币/铂金币/秘银币/折算合计铜币
    铜币/银币/金币/铂金币/秘银币/折算合计铜币: 两处资金合计
  今日营业状态: 字符串
  所属领地: 字符串
  所在城市: 字符串
  整体概况: 字符串。用2-4句总结酒馆当前总体状态、真正可用空间、尚未整理但可在未来发展的位置。
  区域: 动态区域对象。新开局只写当前确定存在/可用的空间，默认包含：主厅接待区、柜台酒水区、厨房餐食区、客房。前门、地窖、后院、马厩等未成立空间不要预设成区域。每个区域至少写 状态、风格、描述、设施。
  客房: 客房对象
主角:
  姓名/种族/称号/当前状态/所在位置/一句话穿着
  生命/精力: 当前值/上限/阶段
  烹饪等级: 等级/称号/做菜次数/下级所需次数
库房:
  食材/调料/成品/酒水/杂物
行囊:
  食材/调料/成品/酒水/杂物，开局默认可为空对象
临时状态:
  主角: []
  酒馆: []
  酒馆区域: {}
  人物: {}
人物羁绊: 可为空对象
  配角名:
    种族/身份/羁绊阶段/阶段文字/好感/心情/所在位置/一句话穿着/生命/精力/膀胱/备注
    个人资金: 铜币/银币/金币/铂金币/秘银币/折算合计铜币
    收入: 职业/日收入折合铜币/结算方式/备注
农田与酒窖:
  农田: {}
  酒窖桶: {}
街坊商铺:
  当前商铺: ""

注意：
- 顶层不要包 stat_data。
- 不要输出地图、系统判定、坐标。
- 库房物品用对象记录，至少包含 数量、标签、价格折合铜币；成品/酒水还要有 搭配判定。
- 人物羁绊里的每个配角都要写 个人资金 和 收入；不知道就写 0 和“未确认”，不要省略字段。
- 所有数值都要写具体值，不要留空或写“未知”。`;

export async function generateOpeningStoryWithInitvar(
  draft: OpeningWorkshopDraft,
  characterProfile?: OpeningGeneratedProfile,
  tavernProfile?: OpeningGeneratedProfile,
): Promise<OpeningStoryDraft> {
  const prompt = `请根据本次普利莫迪亚开局登记信息，生成第 1 层开场白和完整初始变量。

你要做两件事：
1. 写一段适合普利莫迪亚的开场正文，交代人物、酒馆、城市、第一天的起点。结尾不要替玩家做决定。
2. 根据同一个开场事实，写完整 <initvar> 初始变量。变量必须和正文一致。

只允许输出以下结构，不要输出解释，不要输出 Markdown 代码块：
<maintext>
开场正文
</maintext>
<option>
1.开始我们的故事
</option>
<UpdateVariable>
<initvar>
世界:
  ...
酒馆:
  ...
主角:
  ...
库房:
  ...
行囊:
  食材: {}
  调料: {}
  成品: {}
  酒水: {}
  杂物: {}
临时状态:
  主角: []
  酒馆: []
  酒馆区域: {}
  人物: {}
人物羁绊: {}
农田与酒窖:
  农田: {}
  酒窖桶: {}
街坊商铺:
  当前商铺: ""
</initvar>
</UpdateVariable>

禁止事项：
- 不要输出 JSONPatch。
- 不要输出 <Analysis>。
- 不要把变量写成 JSON。
- 不要输出坐标、地图、系统判定。
- 不要照抄示例省略号，所有叶节点必须有具体值。
- 顶层必须是正常中文：世界、酒馆、主角、库房、行囊、临时状态、人物羁绊、农田与酒窖、街坊商铺。
- 酒馆.整体概况必须根据“酒馆风格”和“AI 已整理酒馆档案”重写，用2-4句总结当前酒馆总体状态、已可用空间和仍待整理角落。
- 酒馆.区域 只写当前确定存在/可用的空间；未整理、未命名、未来可开发的角落写进整体概况，不要预设成区域。
- 每个酒馆区域必须根据“酒馆风格”和“AI 已整理酒馆档案”重写；不得沿用默认模板词，如“木石混合”“橡木与石墙”“深色橡木”“石灶与铁锅”“木梁与粗布”“石壁与木桶”，除非玩家填写的酒馆风格本来就是这些。
- 每个酒馆区域的 描述 必须体现玩家指定的酒馆风格、领地城市和开局故事，不要只写泛用功能说明。
- 主角种族必须严格使用“人物登记 / 种族”的值，不得根据酒馆领地、城市或当地主要种族改写。
- 酒馆领地和城市只影响环境、常见居民、食材与风俗；如果主角种族与当地主要种族不同，就写成外来者、客居者或继承者，不要把主角改成当地种族。

${OPENING_INITVAR_SCHEMA_GUIDE}

本次玩家开局信息：
时代: ${draft.era}
领地/地区: ${draft.region || draft.tavern.territory}
开局主题: ${draft.theme}

主角：
姓名: ${draft.character.name}
性别: ${draft.character.gender}
年龄: ${draft.character.age}
种族: ${draft.character.race}
出身/备注: ${draft.character.originNote}
外貌: ${draft.character.appearance}
性格: ${draft.character.personality}
个人故事: ${draft.character.backstory}

酒馆：
名称: ${draft.tavern.name}
领地: ${draft.tavern.territory}
城市: ${draft.tavern.city}
具体位置: ${draft.tavern.place}
经营状态: ${draft.tavern.status}
酒馆风格: ${draft.tavern.style}
资金倾向: ${draft.tavern.funds}
库存倾向: ${draft.tavern.stock}
酒馆故事: ${draft.tavern.story}

AI 已整理人物档案:
${characterProfile?.profile ? stripOpeningForbiddenBlocks(characterProfile.profile) : '（尚未提供，请仅参考玩家原始人物信息。）'}

AI 已整理酒馆档案:
${tavernProfile?.profile ? stripOpeningForbiddenBlocks(tavernProfile.profile) : '（尚未提供，请仅参考玩家原始酒馆信息。）'}`;

  const story = parseOpeningStoryWithInitvar(await runOpeningInitvarGeneration(prompt));
  enforceOpeningDraftFacts(story, draft);
  assertOpeningStoryMatchesDraft(story, draft);
  return story;
}

export function formatOpeningAssistantMessage(story: OpeningStoryDraft) {
  return `<maintext>\n${story.maintext.trim()}\n</maintext>\n\n<option>\n1.开始我们的故事\n</option>`;
}

function indentBlock(text: string, spaces = 4) {
  const pad = ' '.repeat(spaces);
  return cleanText(text).split('\n').map(line => `${pad}${line}`).join('\n');
}

export function buildGameInfoWorldbookContent(
  draft: OpeningWorkshopDraft,
  bundle: OpeningGenerationBundle,
) {
  return `<PrimordiaGameInfo>
version: 2
createdAt: ${new Date().toISOString()}

玩家原始选择:
  时代: ${draft.era || '未指定'}
  地区: ${draft.region || '未指定'}
  酒馆领地: ${draft.tavern.territory || '未指定'}
  酒馆城市: ${draft.tavern.city || '未指定'}
  酒馆位置: ${draft.tavern.place || '未指定'}
  开局主题: ${draft.theme || '未指定'}
  模块选择: ${draft.moduleChoices.map(choice => choice.entryName).filter(Boolean).join('、') || '无'}

主角原始素材:
  姓名: ${draft.character.name}
  性别: ${draft.character.gender}
  年龄: ${draft.character.age}
  种族: ${draft.character.race}
  出身/备注: ${draft.character.originNote}
  外貌: ${draft.character.appearance}
  性格: ${draft.character.personality}
  个人故事: |-
${indentBlock(draft.character.backstory)}

酒馆原始素材:
  名称: ${draft.tavern.name}
  领地: ${draft.tavern.territory}
  城市: ${draft.tavern.city}
  酒馆位置: ${draft.tavern.place}
  经营状态: ${draft.tavern.status}
  风格: ${draft.tavern.style}
  初始资金倾向: ${draft.tavern.funds}
  初始库存倾向: ${draft.tavern.stock}
  酒馆故事: |-
${indentBlock(draft.tavern.story)}

AI整理后主角档案:
${bundle.characterProfile.profile}

AI整理后酒馆档案:
${bundle.tavernProfile.profile}

开局约束:
  - 以上设定是长期事实，后续叙事应保持一致。
  - 如剧情需要扩展细节，应优先兼容玩家原始选择。
  - 不要在没有剧情依据时否定主角身份、酒馆来历或时代模块。
</PrimordiaGameInfo>`;
}

function buildCharacterArchiveContent(draft: OpeningWorkshopDraft, profile: OpeningGeneratedProfile) {
  return `<PrimordiaOpeningCharacter>
姓名: ${draft.character.name}
称号: ${profile.title}
摘要: ${profile.summary}
标签: ${profile.tags.join('、') || '无'}

${stripOpeningForbiddenBlocks(profile.profile)}
</PrimordiaOpeningCharacter>`;
}

function buildTavernArchiveContent(draft: OpeningWorkshopDraft, profile: OpeningGeneratedProfile) {
  return `<PrimordiaOpeningTavern>
名称: ${draft.tavern.name}
领地: ${draft.tavern.territory || draft.region}
城市: ${draft.tavern.city}
位置: ${draft.tavern.place}
经营状态: ${draft.tavern.status}
资金倾向: ${draft.tavern.funds}
库存倾向: ${draft.tavern.stock}
称号: ${profile.title}
摘要: ${profile.summary}
标签: ${profile.tags.join('、') || '无'}

${stripOpeningForbiddenBlocks(profile.profile)}
</PrimordiaOpeningTavern>`;
}

function openingArchiveSeed(
  entryName: string,
  content: string,
  keys: string[],
  order: number,
): Partial<EditableWorldbookEntry> {
  return {
    enabled: false,
    name: entryName,
    comment: entryName,
    content,
    strategy: {
      type: 'constant',
      keys,
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: { type: 'at_depth', role: 'system', depth: 4, order },
  };
}

export async function writeOpeningProfileEntry(
  worldbookName: string,
  kind: 'character' | 'tavern',
  draft: OpeningWorkshopDraft,
  profile: OpeningGeneratedProfile,
) {
  const targetWorldbook = worldbookName || draft.worldbookName || defaultOpeningWorldbookName();
  if (!targetWorldbook) throw new Error('没有可写入的世界书。');
  const entryName = kind === 'character' ? OPENING_CHARACTER_ENTRY : OPENING_TAVERN_ENTRY;
  const seed = kind === 'character'
    ? openingArchiveSeed(
        OPENING_CHARACTER_ENTRY,
        buildCharacterArchiveContent(draft, profile),
        ['普利莫迪亚', '开局人物档案'],
        70,
      )
    : openingArchiveSeed(
        OPENING_TAVERN_ENTRY,
        buildTavernArchiveContent(draft, profile),
        ['普利莫迪亚', '开局酒馆档案'],
        75,
      );
  return upsertWorldbookEntryByName(targetWorldbook, entryName, seed);
}

export async function resetOpeningProfileEntries(worldbookName: string) {
  const targetWorldbook = worldbookName || defaultOpeningWorldbookName();
  if (!targetWorldbook) throw new Error('没有可写入的世界书。');
  const characterEntry = await upsertWorldbookEntryByName(
    targetWorldbook,
    OPENING_CHARACTER_ENTRY,
    {
      ...openingArchiveSeed(
        OPENING_CHARACTER_ENTRY,
        '<PrimordiaOpeningCharacter status="pending">\n本次开局人物档案待生成。\n</PrimordiaOpeningCharacter>',
        ['普利莫迪亚', '开局人物档案'],
        70,
      ),
      enabled: false,
    },
  );
  const tavernEntry = await upsertWorldbookEntryByName(
    targetWorldbook,
    OPENING_TAVERN_ENTRY,
    {
      ...openingArchiveSeed(
        OPENING_TAVERN_ENTRY,
        '<PrimordiaOpeningTavern status="pending">\n本次开局酒馆档案待生成。\n</PrimordiaOpeningTavern>',
        ['普利莫迪亚', '开局酒馆档案'],
        75,
      ),
      enabled: false,
    },
  );
  return { characterEntry, tavernEntry };
}

function buildRegionOpeningBlock(draft: OpeningWorkshopDraft, bundle: OpeningGenerationBundle, regionEntryName: string) {
  const regionName = regionEntryName.replace(/^酒馆区域-/, '');
  return `开局酒馆: ${draft.tavern.name || '未命名酒馆'}
所在领地: ${draft.tavern.territory || draft.region || '未指定'}
所在城市: ${draft.tavern.city || '未指定'}
酒馆位置: ${draft.tavern.place || '未指定位置'}
区域: ${regionName}
经营状态: ${draft.tavern.status || '普通'}
酒馆风格: ${draft.tavern.style || '未指定'}

酒馆档案摘录:
${bundle.tavernProfile.profile}`;
}

export async function writeOpeningWorldbook(
  draft: OpeningWorkshopDraft,
  bundle: OpeningGenerationBundle,
): Promise<OpeningWorldbookResult> {
  const worldbookName = draft.worldbookName || defaultOpeningWorldbookName();
  if (!worldbookName) throw new Error('没有可写入的世界书。');

  let resolvedWorldbookName = worldbookName;
  let entries: EditableWorldbookEntry[];
  try {
    const loaded = await loadWorldbookEntriesForEdit(worldbookName);
    resolvedWorldbookName = loaded.worldbookName;
    entries = loaded.entries;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取世界书「${worldbookName}」失败：${message}`);
  }

  const characterSeed = openingArchiveSeed(
    OPENING_CHARACTER_ENTRY,
    buildCharacterArchiveContent(draft, bundle.characterProfile),
    ['普利莫迪亚', '开局人物档案'],
    70,
  );
  const tavernSeed = openingArchiveSeed(
    OPENING_TAVERN_ENTRY,
    buildTavernArchiveContent(draft, bundle.tavernProfile),
    ['普利莫迪亚', '开局酒馆档案'],
    75,
  );
  const turnContextSeed: Partial<EditableWorldbookEntry> = {
    enabled: true,
    content: [
      '<PRIMORDIA_TURN_CONTEXT status="waiting">',
      '【说明】',
      '这是普利莫迪亚本回合完整发送包的自动覆盖条目。发送新回合前，前端会把本回合发生/待执行内容写入这里。',
      '</PRIMORDIA_TURN_CONTEXT>',
    ].join('\n'),
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: { type: 'at_depth', role: 'user', depth: 0, order: 0 },
  };

  const findEntryIndex = (entryName: string) => entries.findIndex(item => matchesWorldbookEntryName(item, entryName));
  const missingRequiredEntries = [
    { name: OPENING_CHARACTER_ENTRY, seed: characterSeed },
    { name: OPENING_TAVERN_ENTRY, seed: tavernSeed },
    { name: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME, seed: turnContextSeed },
  ].filter(item => findEntryIndex(item.name) < 0);

  if (missingRequiredEntries.length > 0) {
    try {
      const created = await createWorldbookEntriesForEdit(
        resolvedWorldbookName,
        missingRequiredEntries.map(item => ({
          enabled: true,
          content: '',
          ...item.seed,
          name: item.name,
          comment: item.name,
        })),
      );
      entries = (created.worldbook ?? entries).map(cloneOpeningEntry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`新建开局必需条目失败（${missingRequiredEntries.map(item => item.name).join('、')}）：${message}`);
    }
  }

  const upsertInMemory = (entryName: string, seed: Partial<EditableWorldbookEntry>) => {
    const index = findEntryIndex(entryName);
    if (index < 0) throw new Error(`世界书「${resolvedWorldbookName}」中找不到「${entryName}」。`);
    entries[index] = {
      ...cloneOpeningEntry(entries[index]),
      ...seed,
      uid: entries[index].uid,
      name: entryName,
      comment: entryName,
    } as EditableWorldbookEntry;
    return cloneOpeningEntry(entries[index]);
  };

  const characterEntry = upsertInMemory(OPENING_CHARACTER_ENTRY, characterSeed);
  const tavernEntry = upsertInMemory(OPENING_TAVERN_ENTRY, tavernSeed);
  const turnContextEntry = upsertInMemory(TURN_CONTEXT_WORLDBOOK_ENTRY_NAME, turnContextSeed);

  const templateResults = [];
  for (const entryName of [OPENING_CHARACTER_TEMPLATE_ENTRY, OPENING_TAVERN_TEMPLATE_ENTRY]) {
    const index = findEntryIndex(entryName);
    if (index < 0) {
      templateResults.push({ entryName, found: false, changed: false });
      continue;
    }
    const changed = entries[index].enabled !== false;
    entries[index] = { ...cloneOpeningEntry(entries[index]), enabled: false };
    templateResults.push({ entryName, found: true, changed });
  }

  for (const entryName of DISABLED_OPENING_ARCHIVE_ENTRY_NAMES) {
    const index = findEntryIndex(entryName);
    if (index >= 0 && entries[index].enabled !== false) {
      entries[index] = { ...cloneOpeningEntry(entries[index]), enabled: false };
    }
  }

  const regionResults = [];
  for (const entryName of OPENING_REGION_ENTRY_NAMES) {
    const index = findEntryIndex(entryName);
    if (index < 0) {
      regionResults.push({ entryName, found: false, changed: false });
      continue;
    }
    const nextContent = replaceOpeningManagedBlock(entries[index].content || '', buildRegionOpeningBlock(draft, bundle, entryName));
    const changed = nextContent !== entries[index].content;
    entries[index] = { ...cloneOpeningEntry(entries[index]), content: nextContent };
    regionResults.push({ entryName, found: true, changed });
  }

  const moduleResults = [];
  for (const choice of draft.moduleChoices) {
    const group = cleanText(choice.group);
    const entryName = cleanText(choice.entryName);
    if (!group || !entryName) continue;
    const prefix = entryName.startsWith(`${group}-`) ? `${group}-` : `${group}-`;
    let changed = 0;
    let matched = 0;
    let foundTarget = false;
    entries = entries.map(item => {
      const name = getWorldbookEntryName(item);
      if (!name.startsWith(prefix)) return item;
      matched += 1;
      const shouldEnable = name === entryName;
      if (shouldEnable) foundTarget = true;
      if (item.enabled === shouldEnable) return item;
      changed += 1;
      return { ...cloneOpeningEntry(item), enabled: shouldEnable };
    });
    moduleResults.push({ ...choice, prefix, changed, matched, foundTarget });
  }

  try {
    await replaceWorldbookEntriesForEdit(resolvedWorldbookName, entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`保存世界书「${resolvedWorldbookName}」失败：${message}`);
  }

  return {
    characterEntry,
    tavernEntry,
    turnContextEntry,
    turnContextBinding: {
      worldbookName: resolvedWorldbookName,
      uid: Number(turnContextEntry.uid),
      entryName: TURN_CONTEXT_WORLDBOOK_ENTRY_NAME,
    },
    moduleResults,
    templateResults,
    regionResults,
  };
}

export function buildFixedOpeningPreset(worldbookName = ''): {
  draft: OpeningWorkshopDraft;
  bundle: OpeningGenerationBundle;
} {
  const fixedMaintext = `解冻月的阳光薄得像洗了太多遍的纱布，从丘陵东面的白桦林里慢吞吞地漫过来，在布拉姆维克村口那条还没完全干透的泥路上铺了一层不怎么暖的金色。路边的雪化了大半，只在背阴的石墙根底下残着一小条灰白的冰碴子，被脚印和车辙碾成了碎渣，和泥土搅在一起，踩上去发出湿软的吱嘎声。空气还是冷的，带着初春解冻时特有的泥土腥气，远处牧羊坡飘来的淡淡膻味，以及一缕若有若无的、来自某户人家烟囱的木柴烟。村子不大，三十来户人家沿着丘陵缓坡散落，石砌的矮屋顶上长着去年没来得及清理的枯草。远处磨坊的水轮开始转了--化冻的溪水刚恢复流量，吱呀声在清冷的空气里传出很远，和某个院子里一下一下劈柴的沉闷声混在一起，构成了这个春天早晨最主要的声响。

一条橘棕色的大尾巴从泥路那头摇摇晃晃地靠近了。

尾巴的主人裹在一件起球的深灰色旧斗篷里，兜帽拉得不太高，露出两只大三角的狐耳--耳尖是黑的，内侧透着粉色的绒毛，正不安分地左右转动着，像两座独立运作的小雷达。她走路几乎没有声音，兽爪半靴的前端敞开着，露出覆着短毛的爪子和粉色的肉垫，踩在半融的泥地上只留下浅浅的、几乎不带脚跟的印子。斗篷底下的尾巴太蓬松了，把布料撑出一个不规则的鼓包，走路时一摆一摆的，像是另一个不太听话的乘客。

泥土的湿气、远坡上的羊膻味、烟囱松脂混着硬木的烟--这些气味像水一样从她鼻子前面流过去，她都没怎么上心。直到风向微微一偏，带来了一股谷物煮过头之后留在空气里的焦甜气。她的耳朵先于脑子朝那个方向转了过去，步子也跟着偏了一点。

肚子没出声。但她觉得它想出声了。

村口的告示牌歪歪斜斜地杵在路边，一根木桩上钉着一块风吹日晒得发灰的厚木板。上面刻了不少东西，大部分已经模糊了，被风雨侵蚀成了一道道浅沟。她凑近了看--最上面几行是某次集市的通知，日期是去年秋天的，已经过时了。下面是一则冒险者工会的悬赏布告抄录，措辞生硬，大概是费尔马克镇传过来的。再往下，在木板的右下角，有一行明显比其他字迹新一些的刻字，笔画深而粗犷，一看就是用凿子一笔一划硬凿出来的，每个字的收笔处都带着木刺翻起的毛边。

"招人。包吃包住。酒馆问。"

她盯着那几个字看了两秒钟。手指不自觉地摸上了腰间那个已经磨出毛边的旧布袋，隔着布摸到了里面几枚铜板的形状--明明知道只有八个，指尖还是一枚一枚地点过去，像是再数一遍就能多出来一个似的。耳朵往两边塌了一下，又立起来。离心心念念的“铁心脏”还有半个月路程，连一晚大通铺都住不太起。蹭两天吃住，攒点体力和路费，再上路。她的视线顺着告示牌朝村子里面看去，在缓坡偏南的位置看到了一栋两层的石砌矮楼，一楼有扇木门，门边挂着一块同样风化得厉害的木牌，上面的字从这个距离看不清，但形状像是个杯子的简笔画。

行吧。

泥路在她脚下发出湿软的微响，或者说应该发出微响--她的肉垫把大部分声音都吞掉了，只在特别稀烂的泥坑处才踩出一点点被吸住又拔起的黏腻声。走近了，那股谷物焦甜变得更清晰了，确实是从那栋矮楼里飘出来的，混着陈年木头、铁锅锈气和一点点动物油脂凝固后的冷荤味。她的耳朵朝门的方向转了转--里面没有说话声，没有杯盘碰撞声，连脚步声都没有。要么没开门，要么没客人。

门是虚掩着的。她伸出爪掌推了一下，门轴发出一声极短极低的吱呀，然后就停了。肉垫贴上门板的瞬间她感受到了木头的温度--比外面的空气暖一点点，说明屋里有热源。她侧身闪进去，斗篷下的尾巴最后才跟着挤过门缝，蹭在门框上蓬了一下又压了回去。

屋里比外面暖。不是那种烤火的热，是一种闷了一夜的、灶台余温和木头墙壁慢慢沁出来的温吞暖意。她的尾巴在斗篷底下不自觉地松了松--走了一早上的路，到现在才发现自己的毛一直是竖着的。

酒馆比她预想的还小一些。六张木桌散落在前厅里，桌面擦过但没擦干净，靠窗那张的角落里还残着一圈干涸的水渍。椅子是粗木拼的，有几把缺了横档。地面是夯土铺了薄薄一层碎石，踩上去脚感粗粝。右手边是厨房方向，一道布帘半掩着，帘子后面传来极微弱的咕嘟声--她的耳朵朝那个方向歪了歪，鼻子跟着吸了一下。谷物焦甜味更浓了，混着一股铁锅被烧热又冷却后特有的金属涩气。整个空间弥漫着一种"有人在用但没什么人来"的气息，干净是干净的，但那种干净透着寡淡，像是一道只放了盐的汤。

她的目光扫完了整个前厅--没有客人，一个都没有--最后落在了柜台后面。

柜台是一块厚实的旧木板架在两个酒桶上，后面的架子上摆着几个陶杯和两只半满的酒桶。一个人趴在柜台上。不，不是趴着，是半靠着--一只手臂搁在木面上，手指头在柜台的木纹上慢慢地划来划去，像是在顺着年轮的弧线描什么看不见的图案。目光是放空的，看着柜台对面的某处，但又不像在看任何具体的东西。身上穿着一件洗得发白的亚麻短袖衫，袖子挽到肩膀，露出的小臂上有薄薄的一层肌肉轮廓和一道淡旧的烫伤疤痕。深棕色粗布短裤，赤脚踩在地上。腰间系着一条旧围裙--灰扑扑的帆布上有几块洗不掉的油渍，但围裙的带子系得很整齐，是那种做过很多次的肌肉记忆式的蝴蝶结。

她在门口站了大约五秒钟。那个人完全没有反应。手指继续在木纹上划，目光继续放空，呼吸平稳得像是这个世界上除了那块木头以外什么都不存在。她的耳朵不确定地朝他的方向转了转--确认了，不是在装没看见，是真的没注意到有人进来。灶火、木柴烟、隔夜的麦粥、微微的汗味--他身上的气味和这间屋子的气味混在一起，几乎分不出哪个是人哪个是酒馆。

她悄悄把斗篷的兜帽往后拨了拨，露出额前的碎发和两只立起来的耳朵。手指拨了拨耳朵旁边垂下来的几缕头发。

"--那个，打扰了。"

她的声音不高，带着一点从外面冷空气里走进来之后还没完全回暖的微哑，句尾拖了一个小小的尾音。柜台后面的手指停住了，目光从木纹上离开，慢了半拍才转过头来。她看到了一张圆脸--还没完全长开的少年轮廓，下颌线条柔和，鼻梁上有几颗淡雀斑，眉毛浓而直，眼睛不大但黑亮，瞳孔颜色很深，像深井里的水。那双眼睛在看到她的瞬间明显愣了一下，然后眨了两下，像是需要一点时间确认"面前真的站了一个人"这件事。

她的耳朵不自觉地微微前倾了一点。这个"老板"比告示牌给她的预期年轻很多。年轻太多了。

但嘴已经比脑子快了--从小在铺子里泡出来的习惯让她没过脑子就挂上了笑，嘴角翘起来，露出一点点小犬牙，语气随意得像是进了自家隔壁的杂货铺："村口告示牌上那个'招人'--还算数吗？"

琥珀色的眼睛在笑意下面瞥了一眼他赤脚踩在碎石地上的样子--这么冷的天--又看了一眼围裙上那几块洗不掉的油渍，然后重新回到他的脸上，安安静静地等着。尾巴在斗篷底下轻轻晃了一下。`;

  const draft: OpeningWorkshopDraft = {
    character: {
      name: '克斯',
      gender: '男',
      age: '14',
      race: '人类',
      originNote: '老老板离开后独自接手铁壶酒馆的少年。',
      appearance: '洗得发白的亚麻短袖衫、深棕色粗布短裤、旧围裙，赤脚站在柜台后。',
      personality: '慢半拍，容易放空，但做事有肌肉记忆式的认真。',
      backstory: '克斯刚接手布拉姆维克村口的铁壶酒馆，还没真正把它经营起来。',
    },
    tavern: {
      name: '铁壶酒馆',
      territory: '韦斯托利亚',
      city: '布拉姆维克',
      place: '主厅接待区',
      status: '冷清，准备营业',
      style: '丘陵村口的小型旧酒馆，六张木桌、旧木柜台、灶台余温、谷物焦甜气。',
      story: '村口告示牌上刻着“招人。包吃包住。酒馆问。”，橘柒正循着告示和气味推门进来。',
      funds: '拮据',
      stock: '稀少',
    },
    era: '共栖历1303年',
    region: '韦斯托利亚',
    theme: '固定开场白：橘柒应聘铁壶酒馆',
    worldbookName: worldbookName.trim(),
    moduleChoices: [],
  };

  const initvar = {
    世界: {
      时代: '共栖历1303年',
      地区: '韦斯托利亚',
      当前历法: {
        年: 1303,
        月份序号: 3,
        月份名: '解冻月',
        季节: '初春',
        日: 1,
        天气: '初春薄雾，空气湿冷，泥路半干',
        时间: '07:10',
      },
      当前地点: { 区域: '布拉姆维克', 具体位置: '主厅接待区' },
    },
    酒馆: {
      名称: '铁壶酒馆',
      所属领地: '韦斯托利亚',
      所在城市: '布拉姆维克',
      声望: openingReputationState(0),
      声望值: 0,
      声望名: '无人知晓',
      资金: {
        随身钱袋: openingMoneyBucket(2000),
        钱匣: openingMoneyBucket(0),
        铜币: 0,
        银币: 20,
        金币: 0,
        铂金币: 0,
        秘银币: 0,
        折算合计铜币: 2000,
      },
      今日营业状态: '准备营业',
      整体概况: '铁壶酒馆冷清，真正能用的是主厅接待区、柜台酒水区、厨房餐食区和二楼几间简陋客房。门外是布拉姆维克村口半干不干的泥路，屋里还有些旧家具和没完全清完的杂物。村口告示牌上刻着"招人。包吃包住。酒馆问。"',
      区域: {
        主厅接待区: {
          状态: '良好',
          风格: '丘陵村口旧酒馆前厅',
          描述:
            '六张木桌散落在前厅，桌面擦过但没擦干净，靠窗那张的角落里还残着一圈干涸的水渍。椅子是粗木拼的，有几把缺了横档。地面是夯土铺了薄薄一层碎石。空气里弥漫着谷物煮过头后的焦甜气，混着陈年木头和铁锅锈气。',
          分配员工: '',
          设施: {
            木桌: {
              状态: '良好',
              风格: '粗木拼桌',
              描述: '六张散放木桌，桌面有使用痕迹',
              价格折合铜币: 0,
            },
            旧木柜台: {
              状态: '良好',
              风格: '厚实旧木板架在两个酒桶上',
              描述: '柜台后面的架子上摆着几个陶杯和两只半满酒桶',
              价格折合铜币: 0,
            },
          },
        },
        柜台酒水区: {
          状态: '良好',
          风格: '旧木柜台与便宜麦酒',
          描述: '厚实旧木板架在两个酒桶上，后面架子上摆着几个陶杯和两只半满酒桶。这里负责点单、倒酒、收钱。',
          分配员工: '',
          设施: {
            旧木柜台: {
              状态: '良好',
              风格: '厚实旧木板',
              描述: '柜台是一块厚实的旧木板架在两个酒桶上',
              价格折合铜币: 0,
            },
          },
        },
        厨房餐食区: {
          状态: '良好',
          风格: '灶台余温与谷物焦甜气',
          描述: '布帘半掩，里面传出极微弱的咕嘟声，空气里有谷物煮过头后的焦甜气，混着铁锅被烧热又冷却后特有的金属涩气。',
          分配员工: '',
          设施: {
            灶台: {
              状态: '良好',
              风格: '砖石灶台',
              描述: '灶台有余温，铁锅里在咕嘟着什么',
              价格折合铜币: 0,
            },
          },
        },
        客房: {
          状态: '良好',
          风格: '简陋旅人小房',
          描述: '二楼几间小客房还没有住客，床铺和粗布被褥都偏旧，但能遮风，适合给旅人或临时帮工将就过夜。',
          分配员工: '',
          设施: {},
        },
      },
      客房: {},
    },
    主角: {
      姓名: '克斯',
      种族: '人类',
      称号: '铁壶酒馆的少年老板',
      当前状态: '发呆中，被进门的应聘者打断',
      所在位置: '主厅接待区',
      一句话穿着: '洗得发白的亚麻短袖衫、深棕色粗布短裤、旧围裙，赤脚。',
      生命: { 当前值: 100, 上限: 100 },
      精力: { 当前值: 100, 上限: 100 },
      烹饪等级: { 等级: 1, 称号: '烧火工', 做菜次数: 0, 下级所需次数: 10 },
    },
    库房: {
      食材: {
        粗磨黑面包: { 数量: 4, 标签: ['粗粮', '耐饥'], 价格折合铜币: 2 },
        干豆子: { 数量: 6, 标签: ['豆类', '耐储'], 价格折合铜币: 3 },
      },
      调料: { 粗盐: { 数量: 3, 标签: ['基础调味'], 价格折合铜币: 1 } },
      成品: {},
      酒水: { 普通麦酒: { 数量: 2, 标签: ['苦涩', '便宜'], 价格折合铜币: 80, 搭配判定: '无冲突' } },
      杂物: {
        旧抹布: { 数量: 3, 标签: ['清扫'], 价格折合铜币: 1 },
        干木柴: { 数量: 8, 标签: ['燃料'], 价格折合铜币: 2 },
      },
    },
    行囊: { 食材: {}, 调料: {}, 成品: {}, 酒水: {}, 杂物: {} },
    临时状态: { 主角: [], 酒馆: [], 酒馆区域: {}, 人物: {} },
    人物羁绊: {
      橘柒: {
        种族: '狐族',
        身份: '到店应聘者',
        羁绊阶段: 1,
        阶段文字: '陌生人',
        好感: 0,
        心情: '评估中，略带好奇',
        所在位置: '主厅接待区',
        一句话穿着:
          '起球的深灰色旧斗篷，洗旧的绥和式斜襟窄袖短打上衣，宽松灯笼裤扎绑腿，兽爪半靴前端露出爪子和粉色肉垫，腰间系着磨边布袋。',
        生命: { 当前值: 100, 上限: 100 },
        精力: { 当前值: 82, 上限: 100 },
        膀胱: { 当前值: 18, 上限: 100 },
        个人资金: openingMoneyBucket(8),
        收入: { 职业: '临时应聘者', 日收入折合铜币: 0, 结算方式: '尚未入职', 备注: '身上只有八枚铜板，想靠包吃包住攒路费。' },
        备注:
          '橘柒身高160cm出头，圆润脸颊带少女婴儿肥，琥珀色狐眼，橘棕色半长卷发用旧布绳松松扎着；头顶橘棕狐耳灵活如雷达，深橘渐变到奶白尾尖的大尾巴蓬松如云。身上只有八枚铜板，离心心念念的"铁心脏"还有半个月路程，想在酒馆蹭两天吃住攒点路费。声音偏高不尖，懒洋洋拖腔。偏好：热食、住处、路费、和铁心脏有关的消息。',
      },
    },
    农田与酒窖: { 农田: {}, 酒窖桶: {} },
    街坊商铺: { 当前商铺: '' },
  };

  return {
    draft,
    bundle: {
      characterProfile: {
        title: '铁壶酒馆的少年老板',
        profile: '克斯，14岁，人类。刚接手布拉姆维克村口的铁壶酒馆，穿着洗得发白的亚麻短袖衫、深棕色粗布短裤和旧围裙，赤脚站在柜台后。开局时他正发呆，被推门进来的橘柒打断。',
        summary: '克斯是铁壶酒馆的少年老板，慢半拍但认真，刚开始独自经营酒馆。',
        tags: ['少年老板', '铁壶酒馆', '烧火工'],
      },
      tavernProfile: {
        title: '铁壶酒馆',
        profile: '铁壶酒馆位于韦斯托利亚布拉姆维克村口，是一间小型旧酒馆。前厅有六张木桌、旧木柜台、陶杯和半满酒桶，厨房里还有灶台余温和谷物焦甜气。告示牌上刻着“招人。包吃包住。酒馆问。”',
        summary: '铁壶酒馆是布拉姆维克村口冷清但可营业的小酒馆，正等待第一位真正改变日常的人推门进来。',
        tags: ['村口酒馆', '冷清', '招人'],
      },
      story: {
        maintext: fixedMaintext,
        options: ['回应橘柒，确认招人还算数'],
        sum: '解冻月清晨，橘柒循着村口招人告示来到布拉姆维克的铁壶酒馆，向正在柜台后发呆的克斯询问“招人”是否还算数。',
        initvar,
      },
    },
  };
}

const SHEEP_OPENING_MAINTEXT = `解冻月的阳光没有一丝遮拦。天蓝得干净，像刷过的。阳光从东南方倾斜地倒下来，照在脸上白晃晃的--不全是阳光的功劳，是地上的融雪在帮它。布拉姆维克的积雪正在大面积崩溃，村口没铺石板的泥路变成了一条缓缓流动的浅泥河，车辙凹处积出深到脚踝的水洼，水面倒映着干干净净的天。屋檐在滴水，白桦枝在滴水，石墙根底下半融的冰碴子也在滴水，整个村子像被一场只有声音没有雨滴的雨淋着。远处磨坊的水轮比前几天转得快了--溪水涨了--吱呀声在干净的空气里传出很远。

一团白色从泥路那头慢慢靠近了。

说"一团"是因为那个身影的轮廓确实更接近"一团"而不是"一个"--蓬松的纯白卷毛从头顶蔓延到肩膀，从一件深灰蓝色收腰短大衣的领口和袖口冒出来，在阳光和融雪的反光里白得几乎透明。偶蹄踩进泥地没有声音，拔出来带起一小团泥水，留下浅浅的双瓣印。残雪是白的，白桦树干是白的，她也是白的--在这个所有东西都在反光的正午，这个身影差一点就融进了风景里。差一点，因为脸是黑的。浓墨一样的纯黑覆盖了整个面部，从额头到下巴，嵌在白卷毛正中间--像有人在一团棉花上按了个墨手印。一对浅琥珀色的大眼睛在黑色面孔上格外醒目，瞳孔是横的，正缓慢调整，适应没有遮拦的阳光。鼻尖圆钝，微微泛粉，是整张脸上唯一不是纯黑的地方。

头侧两只比手掌大一圈的耳朵正独立于脑袋转动--外侧黑色短毛，内侧粉红绒毛--先朝屋檐的滴水声偏了偏，又朝远处磨坊的方向转了转。头侧一对象牙白的羊角向后弯曲再向外卷，角面光滑，细密环状纹路，一根洗得发白的淡蓝色丝带缠在左角上，系法不太熟练，歪了一点。背上一个中等大小的木箱，麻布背带从双肩交叉到胸前，不大但有些分量，她走路时身体微微前倾来平衡重心。脖子上还挂着一块浅色木牌--巴掌大小，粗麻绳系在颈后，牌面朝外，边缘已经磨圆了，麻绳起着毛边。她弯腰绕过一个深泥坑时，木牌在胸前晃了一下，阳光照上去，上面的字很清楚--"请不要让我喝酒"。字迹端正，笔画利落，不是她自己刻的。

她直起身，没有留意木牌晃了。双瓣偶蹄绕过泥坑，继续朝缓坡上那栋两层石砌矮楼走去。

一楼有扇木门，半掩着。门边挂了一块灰木牌，上面画着一只杯子的简笔画。她在门前停了下来，盯着那扇门看了一会儿。嘴唇动了一下，像在默念什么。手指不自觉地去摸腰间小皮包的搭扣--打开，扣上，打开，扣上。耳朵微微后压，又立回来。短大衣下摆垂着的那条短尾巴--蓬松白色卷毛裹成的棉花球--开始不易察觉地颤抖。酿造师公会学徒，到韦斯托利亚不到一周，养母让她先从小村庄开始跑，一家一家地来。今天在路上犹豫了太久，已经快过午了，这是唯一还有时间进去的一家。

她深吸了一口气。化冻泥土的湿腥、松木劈柴的烟、牧坡的淡膻、融雪水的清冽--这些都是背景，她没怎么上心。直到一缕从半掩门缝里渗出来的气味从这些背景中浮了出来。她的鼻子抽了一下，耳朵从后压的位置啪地立直，前倾，嘴微微张开。谷物，煮过了。底下压着铁锅被反复烧热又冷却后的金属涩气，上面浮着油脂凝回去的冷荤味，还有焦炭冷下来后的涩甜。这些气味在鼻腔里同时铺开的瞬间，脑子里某个不受她控制的角落已经自己开始运转了。

"......这个......如果加一点......嗯......"极小声的嘟囔，小到三步之外听不见。然后她猛摇了一下头，角上的丝带跟着晃了两下。不是现在。她用嘴呼了口气，不用鼻子。"......您好，我是酿造师公会的--"她开始小声排练，声音比刚才的嘟囔更小，"--我们公会近期有......不对。您好，打扰了，我是......"背上的木箱随着她低头往前滑了一点，她推回去。不练了，进去就知道了。

门轴没有响。她推开刚够侧身的宽度，偶蹄跨过门槛--门槛的木头已经磨出了一个浅浅的凹槽--木箱蹭了一下门框，她侧了侧身让它过去。屋里比外面暖，一种闷了一夜的、从灶台余温和木头墙壁里慢慢渗出来的沉暖。和外面白晃晃的阳光相比屋里是暗的，横瞳用了两三秒调整，琥珀色瞳孔缓慢扩大。

酒馆比她预想的还要小。六张木桌散落在前厅，桌面擦过但没擦干净，角落靠窗那张残着一圈干涸的水渍。椅子粗木拼的，几把缺了横档。夯土地面铺了薄薄一层碎石，偶蹄踩上去有一点细碎的骨质碰石声。右手边布帘半掩着，那股谷物焦甜和金属涩气从帘后飘出来，在封闭的空间里浓了几倍。没有客人，一个都没有。整个空间弥漫着一种"有人在用但没什么人来"的感觉--干净是干净的，但那种干净透着寡淡，像一道只放了盐的汤。

她的目光最后落在了柜台的方向。旧木板架在两个酒桶上，后面的架子摆着几只陶杯和两个半满的桶。柜台后面有人。她的视线在那个方向停了不到一秒就滑开了，落到柜台面上一只倒扣的陶杯上--耳朵替她做了确认，朝那个方向微微转了一下，捕捉到了呼吸声和布料偶尔蹭动的细微声响。活人，在那里。但她没有仔细看，不是不好奇，是嗓子眼已经开始发紧了。

她应该开口了。"您好我是酿造师公会的"--这句话排练了一路，此刻在嗓子眼卡了一下，像一块太大的食物噎在喉咙口。嘴张开，气到了舌尖，没出声，又关上了。手指去弹腰间搭扣，发出极轻的金属声。再张开，又没出声。柜台后面那个人好像也没注意到她进来--整个前厅安安静静的，只有布帘后灶台上什么东西极小声地咕嘟，和从门缝渗进来的屋檐滴水声。她站在门和柜台之间的空地上，背着木箱，挂着牌子，白色卷毛在昏暗的室内像一团不太确定自己该不该出现在这里的云。五秒，十秒。她感觉过了很久，大概只有十几秒。她一定要开口，这是她的工作，养母在等她回去汇报。

她第三次张开嘴，然后身后一阵风灌了进来。

她进来的时候没有把门关严。融雪午后的风不冷但莽，灌进来的一瞬间裹着湿泥、融水和被太阳晒热的石头气息，直直扑进了前厅。她站在门和柜台之间正对风口，蓬松的白色卷毛在风里整个炸开了--从头顶到短大衣领口全部朝一个方向飘起来，角上那根歪丝带被吹得直直指向柜台。木牌在风里晃荡，"咔"地一声磕在木箱的背带扣上。耳朵里灌进冷风，粉红绒毛被吹得倒伏。她的双手本能地离开了小皮包--一只去按头顶飞起来的卷毛，一只去扶被风推歪的木箱--身体扭了一下，左蹄在碎石地面上滑了半步。门在风里撞开了，门板拍在墙上闷闷一声响，外面的阳光像掀翻了一桶白漆涌进来，刚适应暗处的横瞳猛然收缩，整个视野白了一瞬。

她在那片涌进来的光里僵了大约一秒钟。一只手按着头顶还没顺回去的卷毛，一只手扶着歪了一半的木箱，木牌还在轻轻晃，偶蹄卡在打滑的位置没敢动。阳光从背后打进来，在夯土地面上投下一个毛茸茸的、边缘不规则的影子。浅琥珀色的横瞳从飞散的白色卷毛后面，对上了柜台方向看过来的目光。

她的嘴还张着--排练了一路的那句"您好我是酿造师公会的"被风、门响、卷毛和打滑搅成了浆糊，从脑子里干干净净地消失了。耳朵啪地压平，鼻尖的粉色深了一点。`;

export function buildSheepOpeningPreset(worldbookName = ''): {
  draft: OpeningWorkshopDraft;
  bundle: OpeningGenerationBundle;
} {
  const preset = buildFixedOpeningPreset(worldbookName);
  const { draft, bundle } = preset;
  draft.tavern.story = '酿造师公会学徒绵暖背着木箱来到布拉姆维克村口的铁壶酒馆，还没来得及介绍自己，就被融雪午后的风吹乱了开场。';
  draft.tavern.funds = '6金币';
  draft.tavern.stock = '蔬菜和肉稍多';
  draft.theme = '固定开场白：绵暖从酿造师公会来访';

  bundle.characterProfile.profile =
    '克斯，14岁，人类。刚接手布拉姆维克村口的铁壶酒馆，穿着洗得发白的亚麻短袖衫、深棕色粗布短裤和旧围裙，赤脚站在柜台后。开局时他被一位被风吹乱开场的酿造师公会学徒吸引了注意。';
  bundle.characterProfile.summary = '克斯是铁壶酒馆的少年老板，慢半拍但认真，刚开始独自经营酒馆。';
  bundle.tavernProfile.profile =
    '铁壶酒馆位于韦斯托利亚布拉姆维克村口，是一间小型旧酒馆。前厅有六张木桌、旧木柜台、陶杯和半满酒桶，厨房里还有灶台余温、谷物焦甜气、铁锅金属涩气和一点冷荤味。解冻月正午，酿造师公会学徒绵暖背着木箱来到这里拜访。';
  bundle.tavernProfile.summary = '解冻月正午，铁壶酒馆冷清但可营业，门口半掩，厨房里有谷物焦甜、金属涩气和冷荤味。';
  bundle.story.maintext = SHEEP_OPENING_MAINTEXT;
  bundle.story.options = ['看向门口，回应这位酿造师公会学徒'];
  bundle.story.sum = '解冻月正午，酿造师公会学徒绵暖来到布拉姆维克的铁壶酒馆，刚要自我介绍就被融雪风吹乱，尴尬地和柜台后的克斯对上视线。';

  const initvar = bundle.story.initvar as Record<string, any>;
  initvar.世界.当前历法.天气 = '阳光融雪';
  initvar.世界.当前历法.时间 = '12:20';
  initvar.酒馆.资金 = {
    随身钱袋: openingMoneyBucket(6000),
    钱匣: openingMoneyBucket(0),
    铜币: 0,
    银币: 0,
    金币: 6,
    铂金币: 0,
    秘银币: 0,
    折算合计铜币: 6000,
  };
  initvar.酒馆.整体概况 =
    '铁壶酒馆冷清，真正能用的是主厅接待区、柜台酒水区、厨房餐食区和二楼几间简陋客房。门外是布拉姆维克村口正在融雪的泥路，屋里有灶台余温、谷物焦甜气、铁锅金属涩气和一点冷荤味。';
  initvar.主角.当前状态 = '在柜台后，被进门后僵住的酿造师公会学徒吸引了注意';
  initvar.库房.食材 = {
    ...initvar.库房.食材,
    新鲜土豆: { 数量: 8, 标签: ['蔬菜', '根茎', '饱腹'], 价格折合铜币: 12 },
    春萝卜: { 数量: 6, 标签: ['蔬菜', '清甜', '水润'], 价格折合铜币: 7 },
    卷心菜: { 数量: 4, 标签: ['蔬菜', '耐储', '清脆'], 价格折合铜币: 9 },
    风干咸肉: { 数量: 3, 标签: ['肉类', '耐储', '咸香'], 价格折合铜币: 28 },
    熏羊肉: { 数量: 2, 标签: ['肉类', '烟熏', '厚鲜'], 价格折合铜币: 36 },
  };
  delete initvar.人物羁绊.橘柒;
  initvar.人物羁绊.绵暖 = {
    种族: '羊族',
    身份: '酿造师公会学徒',
    羁绊阶段: 1,
    阶段文字: '陌生人',
    好感: 0,
    心情: '紧张、尴尬，努力维持礼貌',
    所在位置: '主厅接待区',
    一句话穿着: '深灰蓝色收腰短大衣，蓬松纯白卷毛从领口和袖口冒出，左角缠着淡蓝色旧丝带，背着中等大小木箱，脖子上挂着写有“请不要让我喝酒”的木牌。',
    生命: { 当前值: 100, 上限: 100 },
    精力: { 当前值: 78, 上限: 100 },
    膀胱: { 当前值: 12, 上限: 100 },
    个人资金: openingMoneyBucket(0),
    收入: { 职业: '酿造师公会学徒', 日收入折合铜币: 0, 结算方式: '公会学徒补贴由养母/公会安排', 备注: '当前跑村庄拜访线路，个人可支配收入尚未确认。' },
    备注:
      '绵暖是刚到韦斯托利亚不到一周的酿造师公会学徒，浅琥珀色横瞳，黑色面孔，粉色鼻尖，白色卷毛和向后弯卷的象牙白羊角很醒目。她受养母安排从小村庄开始拜访酒馆，嗅觉敏锐，闻到谷物、铁锅、油脂和焦炭味时会本能思考酿造或调味改良。她极度紧张，开场时被融雪午后的风吹乱，尚未成功说出自我介绍。偏好：温和交流、酿造、谷物香气、被认真听完；注意：木牌写着“请不要让我喝酒”。',
  };
  return preset;
}

const SOLO_COOK_OPENING_MAINTEXT = `<user>克斯从睡梦中醒来，迎接他新的一天。</user>`;

export function buildSoloCookOpeningPreset(worldbookName = ''): {
  draft: OpeningWorkshopDraft;
  bundle: OpeningGenerationBundle;
} {
  const preset = buildFixedOpeningPreset(worldbookName);
  const { draft, bundle } = preset;
  draft.tavern.story = '克斯在解冻月清晨独自醒来，没有任何女主或陌生来客登场。他只想把铁壶酒馆收拾起来，靠做饭赚钱。';
  draft.tavern.funds = '6金币';
  draft.tavern.stock = '蔬菜和肉稍多';
  draft.theme = '单人开局';

  bundle.characterProfile.profile =
    '克斯，14岁，人类。刚接手布拉姆维克村口的铁壶酒馆，穿着洗得发白的亚麻短袖衫、深棕色粗布短裤和旧围裙，赤脚在清晨下楼生火。他此刻没有等待任何相遇，只想靠做饭、卖饭和经营酒馆赚钱。';
  bundle.characterProfile.summary = '克斯是铁壶酒馆的少年老板，慢半拍但认真，当前目标很朴素：做饭赚钱，把破旧酒馆撑起来。';
  bundle.tavernProfile.profile =
    '铁壶酒馆位于韦斯托利亚布拉姆维克村口，是一间冷清的小型旧酒馆。前厅有六张木桌、旧木柜台、陶杯和半满酒桶，厨房里有灶台、铁锅、干木柴、粗粮、蔬菜和少量肉。这个开局没有任何女主或来访者登场，第一天从克斯独自醒来、生火、备菜开始。';
  bundle.tavernProfile.summary = '解冻月清晨，铁壶酒馆尚未营业；克斯独自起床生火，准备靠做饭赚钱。';
  bundle.story.maintext = SOLO_COOK_OPENING_MAINTEXT;
  bundle.story.options = ['开始备菜，准备今天营业'];
  bundle.story.sum = '解冻月清晨，克斯从睡梦中醒来，迎接铁壶酒馆的新一天。';

  const initvar = bundle.story.initvar as Record<string, any>;
  initvar.世界.当前历法.天气 = '解冻月清晨，薄雾湿冷，泥路半干，屋檐仍在滴水';
  initvar.世界.当前历法.时间 = '06:20';
  initvar.酒馆.资金 = {
    随身钱袋: openingMoneyBucket(6000),
    钱匣: openingMoneyBucket(0),
    铜币: 0,
    银币: 0,
    金币: 6,
    铂金币: 0,
    秘银币: 0,
    折算合计铜币: 6000,
  };
  initvar.酒馆.今日营业状态 = '准备营业';
  initvar.酒馆.整体概况 =
    '铁壶酒馆冷清但可用。这个开局没有女主相遇，也没有陌生来访者登场；第一天从克斯独自醒来、生火、备菜、盘算靠做饭赚钱开始。';
  initvar.主角.当前状态 = '清晨刚醒，正在厨房生火备菜，目标是做饭赚钱';
  initvar.主角.所在位置 = '厨房餐食区';
  initvar.库房.食材 = {
    ...initvar.库房.食材,
    新鲜土豆: { 数量: 10, 标签: ['蔬菜', '根茎', '饱腹'], 价格折合铜币: 12 },
    春萝卜: { 数量: 8, 标签: ['蔬菜', '清甜', '水润'], 价格折合铜币: 7 },
    卷心菜: { 数量: 5, 标签: ['蔬菜', '耐储', '清脆'], 价格折合铜币: 9 },
    风干咸肉: { 数量: 4, 标签: ['肉类', '耐储', '咸香'], 价格折合铜币: 28 },
    熏羊肉: { 数量: 2, 标签: ['肉类', '烟熏', '厚鲜'], 价格折合铜币: 36 },
  };
  initvar.人物羁绊 = {};
  initvar.农田与酒窖 = initvar.农田与酒窖 ?? { 农田: {}, 酒窖桶: {} };
  initvar.街坊商铺 = { 当前商铺: '' };

  return preset;
}

export function buildOpeningFallbackStory(draft: OpeningWorkshopDraft) {
  const era = normalizeLines(draft.era, '共栖历1303年');
  const region = normalizeLines(draft.region || draft.tavern.territory || draft.tavern.city, '韦斯托利亚');
  const protagonist = normalizeLines(draft.character.name, '克斯');
  const tavern = normalizeLines(draft.tavern.name, '铁壶酒馆');
  const city = normalizeLines(draft.tavern.city, '布拉姆维克');
  const place = normalizeLines(draft.tavern.place, '主厅接待区');
  return {
    maintext: `${era}的${region}，${protagonist}站在${city}的${tavern}里，脚下正是${place}。炉火、木门、账本和一间仍待整理的酒馆一起安静地等着他。属于普利莫迪亚编年录的第一天，就从这间酒馆的门槛开始。`,
    options: ['开始我们的故事'],
    sum: `${protagonist}在${region}·${city}的${tavern}开始了新的酒馆生活。`,
  };
}
