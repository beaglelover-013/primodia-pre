<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import PmIcon from './PmIcon.vue';
import { useGameStore } from '../stores/game';
import { findOpeningTerritory, openingRaceOptions, openingTerritories } from '../data/openingOptions';
import {
  OPENING_CHARACTER_TEMPLATE_ENTRY,
  OPENING_TAVERN_TEMPLATE_ENTRY,
  buildFixedOpeningPreset,
  buildSheepOpeningPreset,
  buildSoloCookOpeningPreset,
  type OpeningGeneratedProfile,
  type OpeningModuleChoice,
  type OpeningStoryDraft,
  type OpeningWorkshopDraft,
} from '../services/openingWorkshop';

const game = useGameStore();

const character = reactive({
  name: game.currentHostPersonaName() || game.protagonist.name || '克斯',
  gender: '',
  age: '14',
  race: '人类',
  originNote: '',
  appearance: '',
  personality: '',
  backstory: '',
});

const tavern = reactive({
  name: game.tavernName || '铁壶酒馆',
  territory: '韦斯托利亚',
  city: game.location.region || '布拉姆维克',
  place: game.location.place || '主厅接待区',
  status: '普通',
  style: '',
  story: '',
  funds: '普通',
  stock: '普通',
});

const world = reactive({
  era: '共栖历1303年',
  region: '韦斯托利亚',
  theme: '接手酒馆后的第一天',
  worldbookName: '',
});

const moduleChoices = ref<OpeningModuleChoice[]>([
  { group: '时代', entryName: '' },
  { group: '地区', entryName: '' },
  { group: '开局氛围', entryName: '' },
]);

const steps = [
  { key: 'character', title: '人物登记', subtitle: 'KEEPER' },
  { key: 'tavern', title: '酒馆登记', subtitle: 'TAVERN' },
  { key: 'world', title: '世界书', subtitle: 'LORE' },
  { key: 'preview', title: '预览确认', subtitle: 'OPENING' },
] as const;

const currentStep = ref(0);
const worldbooks = ref<string[]>([]);
const characterProfile = ref<OpeningGeneratedProfile | null>(null);
const tavernProfile = ref<OpeningGeneratedProfile | null>(null);
const story = ref<OpeningStoryDraft | null>(null);
const characterProfileState = ref('未生成');
const tavernProfileState = ref('未生成');
const missingTemplates = ref<string[]>([]);
const emptyTemplates = ref<string[]>([]);
const characterTemplateText = ref('');
const tavernTemplateText = ref('');
const templateState = ref('未生成');
const missingRegionEntries = ref<string[]>([]);
const loading = ref('');
const error = ref('');
const notice = ref('');
const activeTerritoryPeople = ref('');
const activeRaceGroup = ref('');
const genderCustomActive = ref(false);
const standardGenderOptions = ['男', '女'] as const;
const generatedDraftKey = ref('');
const showOpeningAdvanced = ref(false);
const customOpeningEnabled = false;
const hoveredOpeningId = ref('');
const displayedProtagonistName = computed(() => game.currentHostPersonaName() || game.protagonist.name || '克斯');
const displayedTavernName = computed(() => game.tavernName || '铁壶酒馆');
const fixedOpenings = computed(() => [
  {
    id: 'fox-applicant',
    title: '橘柒来应聘',
    badge: '固定开场',
    image: 'https://files.catbox.moe/0ld4p2.png',
    summary: `清晨的${displayedTavernName.value}还没正式营业，橘柒推门进来，问门口那句“招人”还算不算数。`,
    details: [displayedProtagonistName.value, displayedTavernName.value, '橘柒', '共栖历1303年'],
  },
  {
    id: 'sheep-brewer',
    title: '绵暖来访',
    badge: '固定开场',
    image: 'https://files.catbox.moe/j42erz.png',
    summary: `解冻月正午，酿造师公会学徒绵暖来到${displayedTavernName.value}，刚要自我介绍就被融雪风吹乱了开场。`,
    details: [displayedProtagonistName.value, displayedTavernName.value, '绵暖', '阳光融雪'],
  },
  {
    id: 'solo-cook',
    title: '单人开局',
    badge: '固定开场',
    summary: `没有任何女主相遇。${displayedProtagonistName.value}从睡梦中醒来，迎接${displayedTavernName.value}的新一天。`,
    details: [displayedProtagonistName.value, displayedTavernName.value, '无女主相遇', '清晨醒来'],
  },
]);
const hoveredOpening = computed(() => fixedOpenings.value.find(item => item.id === hoveredOpeningId.value));

const canConfirm = computed(() =>
  Boolean(
    world.worldbookName &&
      !cannotGenerateReason.value &&
      characterProfileState.value === '已写入' &&
      tavernProfileState.value === '已写入' &&
      story.value?.initvar,
  ),
);
const progressPercent = computed(() => `${((currentStep.value + 1) / steps.length) * 100}%`);
const activeStep = computed(() => steps[currentStep.value]);
const genderMode = computed(() => {
  if (standardGenderOptions.some(gender => gender === character.gender)) return character.gender;
  return genderCustomActive.value || character.gender ? '其他' : '';
});
const selectedTerritory = computed(() => findOpeningTerritory(tavern.territory));
const territoryGroups = computed(() =>
  Array.from(new Set(openingTerritories.map(item => item.people))).map(people => ({
    people,
    territories: openingTerritories.filter(item => item.people === people),
  })),
);
const visibleTerritories = computed(() => {
  const people = activeTerritoryPeople.value || selectedTerritory.value?.people || territoryGroups.value[0]?.people || '';
  return openingTerritories.filter(item => item.people === people);
});
const cityOptions = computed(() => {
  const territory = selectedTerritory.value;
  if (!territory) return [];
  return game.mapNodes
    .filter(node => territory.factionIncludes.some(keyword => String(node.faction || '').includes(keyword)))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
});
const selectedRace = computed(() => openingRaceOptions.find(option => option.value === character.race));
const raceGroups = computed(() =>
  Array.from(new Set(openingRaceOptions.map(item => item.group))).map(group => ({
    group,
    races: openingRaceOptions.filter(item => item.group === group),
  })),
);
const visibleRaces = computed(() => {
  const group = activeRaceGroup.value || selectedRace.value?.group || raceGroups.value[0]?.group || '';
  return openingRaceOptions.filter(item => item.group === group);
});
const cannotGenerateReason = computed(() => {
  if (!world.worldbookName) return '请先选择要读取和写入的世界书。';
  if (!tavern.territory) return '请先选择酒馆所在领地。';
  if (!cityOptions.value.length) return `「${tavern.territory}」暂时没有可选地图城市。`;
  if (!tavern.city) return '请先选择酒馆所在城市。';
  return '';
});

function refreshWorldbooks() {
  worldbooks.value = game.availableOpeningWorldbooks();
  world.worldbookName = world.worldbookName || game.defaultOpeningWorldbookName() || worldbooks.value[0] || '';
}

function cleanChoices() {
  return moduleChoices.value
    .map(choice => ({ group: choice.group.trim(), entryName: choice.entryName.trim() }))
    .filter(choice => choice.group && choice.entryName);
}

function buildDraft(): OpeningWorkshopDraft {
  return {
    character: { ...character },
    tavern: { ...tavern },
    era: world.era,
    region: tavern.territory || world.region,
    theme: world.theme,
    worldbookName: world.worldbookName,
    moduleChoices: cleanChoices(),
  };
}

function draftKey(draft: OpeningWorkshopDraft) {
  return JSON.stringify({
    character: draft.character,
    tavern: draft.tavern,
    era: draft.era,
    region: draft.region,
    theme: draft.theme,
    worldbookName: draft.worldbookName,
    moduleChoices: draft.moduleChoices,
  });
}

function clearGeneratedOpening() {
  characterProfile.value = null;
  tavernProfile.value = null;
  story.value = null;
  characterProfileState.value = '未生成';
  tavernProfileState.value = '未生成';
  generatedDraftKey.value = '';
}

function resetOpeningWorkshop() {
  const defaultTerritory = openingTerritories.find(item => item.tavernFriendly)?.id || openingTerritories[0]?.id || '';
  Object.assign(character, {
    name: game.currentHostPersonaName() || game.protagonist.name || '克斯',
    gender: '',
    age: '14',
    race: '人类',
    originNote: '',
    appearance: '',
    personality: '',
    backstory: '',
  });
  Object.assign(tavern, {
    name: '铁壶酒馆',
    territory: defaultTerritory,
    city: '',
    place: '主厅接待区',
    status: '普通',
    style: '',
    story: '',
    funds: '普通',
    stock: '普通',
  });
  Object.assign(world, {
    era: '共栖历1303年',
    region: defaultTerritory,
    theme: '接手酒馆后的第一天',
    worldbookName: '',
  });
  moduleChoices.value = [
    { group: '时代', entryName: '' },
    { group: '地区', entryName: '' },
    { group: '开局氛围', entryName: '' },
  ];
  currentStep.value = 0;
  missingTemplates.value = [];
  emptyTemplates.value = [];
  characterTemplateText.value = '';
  tavernTemplateText.value = '';
  templateState.value = '未生成';
  missingRegionEntries.value = [];
  showOpeningAdvanced.value = false;
  activeTerritoryPeople.value = findOpeningTerritory(defaultTerritory)?.people || '';
  activeRaceGroup.value = selectedRace.value?.group || '';
  genderCustomActive.value = false;
  error.value = '';
  notice.value = '';
  clearGeneratedOpening();
  refreshWorldbooks();
  const firstCity = cityOptions.value[0]?.name || '';
  tavern.city = firstCity;
}

function setStep(index: number) {
  currentStep.value = Math.max(0, Math.min(steps.length - 1, index));
}

function nextStep() {
  setStep(currentStep.value + 1);
}

function prevStep() {
  setStep(currentStep.value - 1);
}

async function runTask<T>(label: string, task: () => Promise<T>) {
  loading.value = label;
  error.value = '';
  notice.value = '';
  try {
    return await task();
  } catch (err) {
    if (err instanceof Error) {
      error.value = err.message || `${label}失败。`;
    } else if (typeof err === 'string') {
      error.value = err.trim() || `${label}失败。`;
    } else {
      try {
        const serialized = JSON.stringify(err);
        error.value = serialized && serialized !== '{}' ? `${label}失败：${serialized}` : `${label}失败：世界书接口返回了空错误。`;
      } catch {
        const message = String(err || '').trim();
        error.value = message ? `${label}失败：${message}` : `${label}失败：未知错误。`;
      }
    }
    return undefined;
  } finally {
    loading.value = '';
  }
}

async function inspectTemplatesOnce() {
  const result = await runTask('正在检查开局模板', () => game.inspectOpeningTemplates(world.worldbookName));
  missingTemplates.value = result?.missingEntries ?? [];
  emptyTemplates.value = result?.emptyEntries ?? [];
  characterTemplateText.value = result?.characterTemplateContent ?? '';
  tavernTemplateText.value = result?.tavernTemplateContent ?? '';
  return result;
}

async function checkTemplates(options: { autoRepair?: boolean; draft?: OpeningWorkshopDraft; forceRewrite?: boolean } = {}) {
  missingTemplates.value = [];
  emptyTemplates.value = [];
  if (!world.worldbookName) {
    error.value = '请先选择要读取和写入的世界书。';
    return false;
  }
  let result = options.forceRewrite ? undefined : await inspectTemplatesOnce();
  if (
    options.forceRewrite ||
    ((missingTemplates.value.length || emptyTemplates.value.length) && options.autoRepair !== false)
  ) {
    const draft = options.draft ?? buildDraft();
    templateState.value = '正在写入模板';
    const repaired = await runTask('正在写入开局模板', () => game.generateAndWriteOpeningTemplates(draft));
    if (!repaired) return false;
    result = await inspectTemplatesOnce();
  }
  if (missingTemplates.value.length) {
    templateState.value = '缺少模板';
    error.value = `当前世界书缺少：${missingTemplates.value.join('、')}。`;
    return false;
  }
  if (emptyTemplates.value.length) {
    templateState.value = '模板为空';
    error.value = `当前世界书里的模板正文为空：${emptyTemplates.value.join('、')}。`;
    return false;
  }
  templateState.value = '已写入';
  notice.value = result ? '开局模板已找到/已写入。' : '开局模板已写入。';
  return true;
}

async function generateCharacterProfileStep() {
  if (cannotGenerateReason.value) {
    error.value = cannotGenerateReason.value;
    return;
  }
  const draft = buildDraft();
  const currentKey = draftKey(draft);
  characterProfile.value = null;
  tavernProfile.value = null;
  story.value = null;
  characterProfileState.value = '未生成';
  tavernProfileState.value = '未生成';
  generatedDraftKey.value = '';

  const ok = await checkTemplates({ draft, forceRewrite: true });
  if (!ok) return;
  const resetEntries = await runTask('正在重置开局档案条目', () => game.resetOpeningProfileEntries(draft.worldbookName));
  if (!resetEntries) return;

  const characterResult = await runTask('正在生成人物档案', () =>
    game.generateOpeningCharacterProfile(draft.character, draft.worldbookName, draft.tavern),
  );
  if (!characterResult) return;
  if (draftKey(buildDraft()) !== currentKey) {
    characterProfileState.value = '需重新生成';
    error.value = '开局登记已变化，请重新生成人物档案。';
    return;
  }
  characterProfile.value = characterResult;
  const characterEntry = await runTask('正在写入开局人物档案', () =>
    game.writeOpeningProfileEntry(draft.worldbookName, 'character', draft, characterResult),
  );
  if (!characterEntry) {
    characterProfileState.value = '写入失败';
    return;
  }
  characterProfileState.value = '已写入';
  notice.value = '人物档案已生成并写入「开局人物档案」。';
}

async function generateTavernProfileStep() {
  if (cannotGenerateReason.value) {
    error.value = cannotGenerateReason.value;
    return;
  }
  if (characterProfileState.value !== '已写入' || !characterProfile.value) {
    error.value = '请先完成人物档案生成与写入。';
    return;
  }
  const draft = buildDraft();
  const currentKey = draftKey(draft);
  tavernProfile.value = null;
  story.value = null;
  tavernProfileState.value = '未生成';
  generatedDraftKey.value = '';

  const ok = await checkTemplates({ draft });
  if (!ok) return;

  const tavernResult = await runTask('正在生成酒馆档案', () => game.generateOpeningTavernProfile(draft.tavern, draft.worldbookName));
  if (!tavernResult) return;
  if (draftKey(buildDraft()) !== currentKey) {
    tavernProfileState.value = '需重新生成';
    error.value = '开局登记已变化，请重新生成酒馆档案。';
    return;
  }
  tavernProfile.value = tavernResult;
  const tavernEntry = await runTask('正在写入开局酒馆档案', () =>
    game.writeOpeningProfileEntry(draft.worldbookName, 'tavern', draft, tavernResult),
  );
  if (!tavernEntry) {
    tavernProfileState.value = '写入失败';
    return;
  }
  tavernProfileState.value = '已写入';
  notice.value = '酒馆档案已生成并写入「开局酒馆档案」。';
}

async function generateOpeningStoryStep() {
  if (cannotGenerateReason.value) {
    error.value = cannotGenerateReason.value;
    return;
  }
  if (characterProfileState.value !== '已写入' || !characterProfile.value) {
    error.value = '请先完成人物档案生成与写入。';
    return;
  }
  if (tavernProfileState.value !== '已写入' || !tavernProfile.value) {
    error.value = '请先完成酒馆档案生成与写入。';
    return;
  }
  const draft = buildDraft();
  const currentKey = draftKey(draft);
  story.value = null;

  const characterEntry = await runTask('正在同步开局人物档案', () =>
    game.writeOpeningProfileEntry(draft.worldbookName, 'character', draft, characterProfile.value!),
  );
  if (!characterEntry) {
    characterProfileState.value = '写入失败';
    return;
  }
  const savedCharacterProfile = {
    ...characterProfile.value,
    profile: String(characterEntry.content || characterProfile.value.profile),
  };

  const tavernEntry = await runTask('正在同步开局酒馆档案', () =>
    game.writeOpeningProfileEntry(draft.worldbookName, 'tavern', draft, tavernProfile.value!),
  );
  if (!tavernEntry) {
    tavernProfileState.value = '写入失败';
    return;
  }
  const savedTavernProfile = {
    ...tavernProfile.value,
    profile: String(tavernEntry.content || tavernProfile.value.profile),
  };

  const storyResult = await runTask('正在生成开场白与初始变量', () =>
    game.generateOpeningStoryWithInitvar(draft, savedCharacterProfile, savedTavernProfile),
  );
  if (!storyResult) return;
  if (draftKey(buildDraft()) !== currentKey) {
    error.value = '开局登记已变化，请重新生成开场白与变量。';
    return;
  }
  story.value = storyResult;
  generatedDraftKey.value = currentKey;
  characterProfileState.value = '已写入';
  tavernProfileState.value = '已写入';
  notice.value = '开场白和初始变量已生成，可以开始游戏。';
}

async function generateProfilesAndStoryFromCurrentTemplates() {
  if (cannotGenerateReason.value) {
    error.value = cannotGenerateReason.value;
    return;
  }
  await generateCharacterProfileStep();
  if (characterProfileState.value !== '已写入' || !characterProfile.value) return;
  await generateTavernProfileStep();
  if (tavernProfileState.value !== '已写入' || !tavernProfile.value) return;
  await generateOpeningStoryStep();
  if (story.value?.initvar) {
    currentStep.value = 3;
    showOpeningAdvanced.value = false;
  }
}

async function saveEditedOpeningTemplates() {
  if (!world.worldbookName) {
    error.value = '请先选择要读取和写入的世界书。';
    return;
  }
  const characterText = characterTemplateText.value.trim();
  const tavernText = tavernTemplateText.value.trim();
  if (!characterText || !tavernText) {
    error.value = '两份模板正文都不能为空。';
    return;
  }
  const first = await runTask('正在保存人物模板', () =>
    game.saveOpeningTemplateContent(world.worldbookName, OPENING_CHARACTER_TEMPLATE_ENTRY, characterText),
  );
  if (!first) return;
  const second = await runTask('正在保存酒馆模板', () =>
    game.saveOpeningTemplateContent(world.worldbookName, OPENING_TAVERN_TEMPLATE_ENTRY, tavernText),
  );
  if (!second) return;
  notice.value = '开局模板已保存到世界书。';
  await checkTemplates();
  templateState.value = '玩家已编辑';
  notice.value = '开局模板已保存到世界书。';
}

async function confirmOpening() {
  if (!canConfirm.value) {
    error.value = cannotGenerateReason.value || '请先按顺序完成人物档案、酒馆档案、开场白与初始变量。';
    return;
  }
  const draft = buildDraft();
  const currentKey = draftKey(draft);
  if (generatedDraftKey.value !== currentKey) {
    clearGeneratedOpening();
    error.value = '开局登记已变化，请重新按顺序生成档案与开场白。';
    return;
  }
  if (!characterProfile.value || !tavernProfile.value || !story.value || !story.value.initvar) {
    error.value = '请先按顺序完成人物档案、酒馆档案、开场白与初始变量。';
    return;
  }
  const result = await runTask('正在写入世界书并创建开局楼层', () =>
    game.confirmOpeningWorkshop(buildDraft(), {
      characterProfile: characterProfile.value!,
      tavernProfile: tavernProfile.value!,
      story: story.value!,
    }),
  );
  if (result) {
    missingRegionEntries.value = result.regionResults.filter(item => !item.found).map(item => item.entryName);
    const missingModules = result.moduleResults.filter(item => !item.foundTarget).map(item => item.entryName);
    const notes = [
      missingRegionEntries.value.length ? `未找到区域条目：${missingRegionEntries.value.join('、')}` : '',
      missingModules.length ? `未找到模块条目：${missingModules.join('、')}` : '',
    ].filter(Boolean);
    notice.value = notes.length ? `开局已完成；${notes.join('；')}。` : '开局已完成。';
    game.closeOpeningWorkshop();
  }
}

async function confirmFixedOpening() {
  await chooseFixedOpening('fox-applicant');
}

async function chooseFixedOpening(id: string) {
  refreshWorldbooks();
  if (!world.worldbookName) {
    error.value = '没有找到可用的世界书，请先为当前角色卡绑定世界书。';
    return;
  }
  const openingLabels: Record<string, string> = {
    'fox-applicant': '橘柒开场',
    'sheep-brewer': '绵暖开场',
    'solo-cook': '单人开局',
  };
  const { draft, bundle } =
    id === 'sheep-brewer'
      ? buildSheepOpeningPreset(world.worldbookName)
      : id === 'solo-cook'
        ? buildSoloCookOpeningPreset(world.worldbookName)
        : buildFixedOpeningPreset(world.worldbookName);
  const result = await runTask(`正在创建${openingLabels[id] ?? '固定开场'}`, () =>
    game.confirmOpeningWorkshop(draft, bundle),
  );
  if (result) {
    missingRegionEntries.value = result.regionResults.filter(item => !item.found).map(item => item.entryName);
    const missingModules = result.moduleResults.filter(item => !item.foundTarget).map(item => item.entryName);
    const notes = [
      missingRegionEntries.value.length ? `未找到区域条目：${missingRegionEntries.value.join('、')}` : '',
      missingModules.length ? `未找到模块条目：${missingModules.join('、')}` : '',
    ].filter(Boolean);
    notice.value = notes.length ? `${openingLabels[id] ?? '固定开场'}已完成；${notes.join('；')}。` : `${openingLabels[id] ?? '固定开场'}已完成。`;
    game.closeOpeningWorkshop();
  }
}

function addModuleChoice() {
  moduleChoices.value.push({ group: '', entryName: '' });
}

function removeModuleChoice(index: number) {
  moduleChoices.value.splice(index, 1);
}

function chooseGender(gender: string) {
  genderCustomActive.value = false;
  character.gender = gender;
}

function chooseCustomGender() {
  genderCustomActive.value = true;
  if (standardGenderOptions.some(gender => gender === character.gender)) character.gender = '';
}

onMounted(() => {
  if (game.shouldShowOpeningWorkshop) {
    resetOpeningWorkshop();
  } else {
    refreshWorldbooks();
  }
});

watch(
  () => game.shouldShowOpeningWorkshop,
  visible => {
    if (visible) resetOpeningWorkshop();
  },
);

watch(
  () => ({
    character: { ...character },
    tavern: { ...tavern },
    world: { ...world },
    moduleChoices: moduleChoices.value.map(choice => ({ ...choice })),
  }),
  () => {
    if (generatedDraftKey.value || characterProfile.value || tavernProfile.value || story.value) {
      clearGeneratedOpening();
      notice.value = '';
    }
  },
  { deep: true },
);

watch(
  () => tavern.territory,
  () => {
    world.region = tavern.territory;
    activeTerritoryPeople.value = selectedTerritory.value?.people || activeTerritoryPeople.value;
    const firstCity = cityOptions.value[0]?.name || '';
    if (!cityOptions.value.some(node => node.name === tavern.city)) tavern.city = firstCity;
  },
  { immediate: true },
);

watch(
  () => character.race,
  () => {
    activeRaceGroup.value = selectedRace.value?.group || activeRaceGroup.value;
  },
  { immediate: true },
);
</script>

<template>
  <div class="opening-workshop">
    <main class="opening-shell">
      <header class="opening-title">
        <div class="title-line"></div>
        <div>
          <p>PRIMORDIA CHRONICLES</p>
          <h1>开场选择</h1>
        </div>
        <div class="title-line"></div>
      </header>

      <div v-if="error" class="opening-alert bad">{{ error }}</div>
      <div v-if="notice" class="opening-alert good">{{ notice }}</div>
      <div v-if="loading" class="opening-alert">{{ loading }}...</div>

      <section class="fixed-opening-board">
        <div class="fixed-opening-grid">
          <article
            v-for="item in fixedOpenings"
            :key="item.id"
            class="fixed-opening-card"
            :class="{ withImage: Boolean(item.image) }"
            :style="item.image ? { '--opening-card-image': `url(${item.image})` } : undefined"
            @mouseenter="hoveredOpeningId = item.id"
            @mouseleave="hoveredOpeningId = ''"
          >
            <div class="fixed-card-top">
              <span>{{ item.badge }}</span>
              <PmIcon name="ledger" :size="18" />
            </div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.summary }}</p>
            <div class="fixed-card-tags">
              <span v-for="detail in item.details" :key="detail">{{ detail }}</span>
            </div>
            <button class="opening-btn hero" type="button" :disabled="!!loading" @click="chooseFixedOpening(item.id)">
              使用这个开场
            </button>
          </article>
        </div>
      </section>

      <Transition name="opening-preview">
        <article
          v-if="hoveredOpening"
          class="fixed-opening-card opening-hover-preview"
          :class="{ withImage: Boolean(hoveredOpening.image) }"
          :style="hoveredOpening.image ? { '--opening-card-image': `url(${hoveredOpening.image})` } : undefined"
          aria-hidden="true"
        >
          <div class="fixed-card-top">
            <span>{{ hoveredOpening.badge }}</span>
            <PmIcon name="ledger" :size="20" />
          </div>
          <h3>{{ hoveredOpening.title }}</h3>
          <p>{{ hoveredOpening.summary }}</p>
          <div class="fixed-card-tags">
            <span v-for="detail in hoveredOpening.details" :key="detail">{{ detail }}</span>
          </div>
        </article>
      </Transition>

      <section v-if="customOpeningEnabled" class="register-frame">
        <aside class="register-side">
          <div class="seal">
            <PmIcon name="ledger" :size="34" />
          </div>
          <div class="side-copy">
            <strong>{{ activeStep.title }}</strong>
            <span>{{ activeStep.subtitle }}</span>
          </div>

          <div class="step-list">
            <button
              v-for="(step, index) in steps"
              :key="step.key"
              class="step-item"
              :class="{ active: currentStep === index, done: currentStep > index }"
              type="button"
              @click="setStep(index)"
            >
              <span class="step-num">{{ index + 1 }}</span>
              <span>
                <strong>{{ step.title }}</strong>
                <small>{{ step.subtitle }}</small>
              </span>
            </button>
          </div>

          <div class="progress-track">
            <span :style="{ width: progressPercent }"></span>
          </div>

          <div class="side-summary">
            <p><span>人物</span><strong>{{ character.name || '未命名' }}</strong></p>
            <p><span>酒馆</span><strong>{{ tavern.name || '未命名' }}</strong></p>
            <p><span>世界书</span><strong>{{ world.worldbookName || '未选择' }}</strong></p>
          </div>
        </aside>

        <section class="register-main">
          <div v-if="error" class="opening-alert bad">{{ error }}</div>
          <div v-if="notice" class="opening-alert good">{{ notice }}</div>
          <div v-if="loading" class="opening-alert">{{ loading }}...</div>

          <section v-if="currentStep === 0" class="quick-start-panel">
            <div class="quick-copy">
              <p>默认开局</p>
              <h2>固定开场白快速开局</h2>
              <span>直接创建第 1 层，写入初始变量，并完成世界书绑定。适合第一次游玩或想快速进入故事的人。</span>
            </div>
            <div class="quick-controls">
              <label>
                <span>写入世界书</span>
                <select v-model="world.worldbookName" class="opening-input">
                  <option value="">请选择</option>
                  <option v-for="name in worldbooks" :key="name" :value="name">{{ name }}</option>
                </select>
              </label>
              <button class="opening-btn hero" type="button" :disabled="!!loading || !world.worldbookName" @click="confirmFixedOpening">
                使用固定开场白快速开局
              </button>
              <button class="opening-btn ghost wide custom-opening-btn" type="button" :disabled="!!loading || !!cannotGenerateReason" @click="generateProfilesAndStoryFromCurrentTemplates">
                自定义资料开局
              </button>
              <small v-if="!world.worldbookName">请先选择世界书。</small>
              <small v-else>想自己填写人物和酒馆设定时，再用自定义资料开局。</small>
            </div>
          </section>

          <section v-if="currentStep === 0" class="step-panel">
            <div class="section-head">
              <span><PmIcon name="heart" :size="18" /> 人物登记</span>
              <small>CHARACTER</small>
            </div>
            <div class="field-row two">
              <label><span>姓名</span><input v-model="character.name" class="opening-input" /></label>
              <label><span>年龄</span><input v-model="character.age" class="opening-input" /></label>
            </div>
            <div class="choice-field gender-picker">
              <div class="choice-label">
                <span>性别</span>
                <strong>{{ character.gender || '未填写' }}</strong>
              </div>
              <div class="choice-tabs">
                <button
                  v-for="gender in standardGenderOptions"
                  :key="gender"
                  class="choice-tab"
                  :class="{ active: character.gender === gender }"
                  type="button"
                  @click="chooseGender(gender)"
                >
                  {{ gender }}
                </button>
                <button
                  class="choice-tab"
                  :class="{ active: genderMode === '其他' }"
                  type="button"
                  @click="chooseCustomGender"
                >
                  其他
                </button>
              </div>
              <input
                v-if="genderMode === '其他'"
                v-model="character.gender"
                class="opening-input"
                placeholder="写下你的设定，例如：无性别、双性、非二元、由你决定"
              />
            </div>
            <div class="choice-field">
              <div class="choice-label">
                <span>种族</span>
                <strong>{{ character.race }}</strong>
              </div>
              <div class="choice-tabs">
                <button
                  v-for="group in raceGroups"
                  :key="group.group"
                  class="choice-tab"
                  :class="{ active: (activeRaceGroup || selectedRace?.group) === group.group }"
                  type="button"
                  @click="activeRaceGroup = group.group"
                >
                  {{ group.group }}
                  <small>{{ group.races.length }}</small>
                </button>
              </div>
              <div class="race-grid">
                <button
                  v-for="race in visibleRaces"
                  :key="race.value"
                  class="race-card"
                  :class="{ active: character.race === race.value }"
                  type="button"
                  @click="character.race = race.value"
                >
                  <strong>{{ race.value }}</strong>
                  <span>{{ race.hint }}</span>
                </button>
              </div>
            </div>
            <label><span>出身 / 备注</span><input v-model="character.originNote" class="opening-input" placeholder="例如：转化前种族、混血、外来者、家庭背景" /></label>
            <div v-if="character.race === '血族'" class="hint-box warn">血族外貌与转化前种族相同，建议在这里写明转化前种族或伪装身份。</div>
            <label><span>外貌</span><textarea v-model="character.appearance" class="opening-textarea"></textarea></label>
            <label><span>性格</span><input v-model="character.personality" class="opening-input" placeholder="例如：谨慎、温和、爱逞强" /></label>
            <label><span>个人故事</span><textarea v-model="character.backstory" class="opening-textarea tall"></textarea></label>
          </section>

          <section v-else-if="currentStep === 1" class="step-panel">
            <div class="section-head">
              <span><PmIcon name="home" :size="18" /> 酒馆登记</span>
              <small>TAVERN</small>
            </div>
            <div class="field-row two">
              <label><span>酒馆名</span><input v-model="tavern.name" class="opening-input" /></label>
              <label><span>经营状态</span><input v-model="tavern.status" class="opening-input" /></label>
            </div>
            <div class="choice-field territory-picker">
              <div class="choice-label">
                <span>领地</span>
                <strong>{{ selectedTerritory?.label || '未选择' }}</strong>
              </div>
              <div class="territory-layout">
                <div class="choice-tabs vertical">
                  <button
                    v-for="group in territoryGroups"
                    :key="group.people"
                    class="choice-tab"
                    :class="{ active: (activeTerritoryPeople || selectedTerritory?.people) === group.people }"
                    type="button"
                    @click="activeTerritoryPeople = group.people"
                  >
                    {{ group.people }}
                    <small>{{ group.territories.length }}</small>
                  </button>
                </div>
                <div class="territory-list">
                  <button
                    v-for="territory in visibleTerritories"
                    :key="territory.id"
                    class="territory-card"
                    :class="{ active: tavern.territory === territory.id, muted: !territory.tavernFriendly }"
                    type="button"
                    @click="tavern.territory = territory.id"
                  >
                    <span>
                      <strong>{{ territory.label }}</strong>
                      <small>{{ territory.tavernFriendly ? '常规开店' : '特殊开局' }}</small>
                    </span>
                    <em>{{ territory.hint }}</em>
                  </button>
                </div>
              </div>
            </div>
            <div class="choice-field">
              <div class="choice-label">
                <span>城市</span>
                <strong>{{ tavern.city || '暂无可选城市' }}</strong>
              </div>
              <div v-if="cityOptions.length" class="city-grid">
                <button
                  v-for="city in cityOptions"
                  :key="city.id"
                  class="city-ticket"
                  :class="{ active: tavern.city === city.name }"
                  type="button"
                  @click="tavern.city = city.name"
                >
                  <strong>{{ city.name }}</strong>
                  <span>{{ city.type || '地点' }}</span>
                  <small>{{ city.faction }}</small>
                </button>
              </div>
              <div v-else class="empty-box">这个领地暂时没有匹配到地图城市，不能生成开局。</div>
            </div>
            <label><span>酒馆位置</span><input v-model="tavern.place" class="opening-input" placeholder="例如：主厅接待区、港口边、旧街、厨房餐食区" /></label>
            <label><span>酒馆风格</span><textarea v-model="tavern.style" class="opening-textarea"></textarea></label>
            <label><span>酒馆故事</span><textarea v-model="tavern.story" class="opening-textarea tall"></textarea></label>
            <div class="field-row two">
              <label><span>初始资金倾向</span><input v-model="tavern.funds" class="opening-input" /></label>
              <label><span>初始库存倾向</span><input v-model="tavern.stock" class="opening-input" /></label>
            </div>
          </section>

          <section v-else-if="currentStep === 2" class="step-panel">
            <div class="section-head">
              <span><PmIcon name="book" :size="18" /> 世界书与模块</span>
              <small>WORLDBOOK</small>
            </div>
            <div class="field-row two">
              <label>
                <span>写入世界书</span>
                <select v-model="world.worldbookName" class="opening-input">
                  <option value="">请选择</option>
                  <option v-for="name in worldbooks" :key="name" :value="name">{{ name }}</option>
                </select>
              </label>
              <label><span>时代</span><input v-model="world.era" class="opening-input" /></label>
            </div>
            <div class="field-row two">
              <label><span>地区</span><input v-model="world.region" class="opening-input" readonly /></label>
              <label><span>开局主题</span><input v-model="world.theme" class="opening-input" /></label>
            </div>
            <div class="template-check">
              <span>AI 开局模板：{{ OPENING_CHARACTER_TEMPLATE_ENTRY }} / {{ OPENING_TAVERN_TEMPLATE_ENTRY }} · {{ templateState }}</span>
              <button class="opening-btn ghost sm" type="button" :disabled="!!loading" @click="checkTemplates">检查模板</button>
            </div>
            <div class="module-list">
              <div class="module-head">
                <span>互斥模块条目</span>
                <button class="opening-btn ghost sm" type="button" @click="addModuleChoice">添加</button>
              </div>
              <div v-for="(choice, index) in moduleChoices" :key="index" class="module-row">
                <input v-model="choice.group" class="opening-input" placeholder="组名，如 时代" />
                <input v-model="choice.entryName" class="opening-input" placeholder="条目名，如 时代-1303" />
                <button class="opening-btn ghost sm" type="button" @click="removeModuleChoice(index)">移除</button>
              </div>
            </div>
          </section>

          <section v-else class="step-panel preview-panel">
            <div class="section-head">
              <span><PmIcon name="sparkles" :size="18" /> 开场预览</span>
              <small>PREVIEW</small>
            </div>
            <div class="opening-auto-card">
              <div>
                <strong>自定义资料开局</strong>
                <span>需要自定义设定时，前端会自动完成档案与开场白生成。</span>
              </div>
              <button class="opening-btn primary" type="button" :disabled="!!loading || !!cannotGenerateReason" @click="generateProfilesAndStoryFromCurrentTemplates">
                生成自定义开局
              </button>
            </div>
            <details class="advanced-opening" :open="showOpeningAdvanced">
              <summary>高级开局细节：模板、档案与 initvar</summary>
              <div class="template-actions opening-sequence-actions">
              <button class="opening-btn primary" type="button" :disabled="!!loading || !!cannotGenerateReason" @click="generateCharacterProfileStep">
                1. 生成人物档案并写入
              </button>
              <button class="opening-btn primary" type="button" :disabled="!!loading || characterProfileState !== '已写入'" @click="generateTavernProfileStep">
                2. 生成酒馆档案并写入
              </button>
              <button class="opening-btn primary" type="button" :disabled="!!loading || characterProfileState !== '已写入' || tavernProfileState !== '已写入'" @click="generateOpeningStoryStep">
                3. 生成开场白与变量
              </button>
            </div>
            <div v-if="cannotGenerateReason" class="hint-box warn">{{ cannotGenerateReason }}</div>
            <div class="template-editor">
              <div class="module-head">
                <span>世界书开局模板 · {{ templateState }}</span>
                <span class="template-actions">
                  <button
                    class="opening-btn ghost sm"
                    type="button"
                    :disabled="!!loading || !characterTemplateText || !tavernTemplateText"
                    @click="saveEditedOpeningTemplates"
                  >
                    保存模板修改
                  </button>
                  <button
                    class="opening-btn ghost sm"
                    type="button"
                    :disabled="!!loading || !characterTemplateText || !tavernTemplateText"
                    @click="generateCharacterProfileStep"
                  >
                    使用当前模板重生成人物
                  </button>
                </span>
              </div>
              <div class="field-row two">
                <label>
                  <span>{{ OPENING_CHARACTER_TEMPLATE_ENTRY }}</span>
                  <textarea
                    v-if="characterTemplateText"
                    v-model="characterTemplateText"
                    class="opening-textarea tall"
                  ></textarea>
                  <div v-else class="empty-box">尚未生成。点击上方按钮后，AI 会先写入这份模板。</div>
                </label>
                <label>
                  <span>{{ OPENING_TAVERN_TEMPLATE_ENTRY }}</span>
                  <textarea
                    v-if="tavernTemplateText"
                    v-model="tavernTemplateText"
                    class="opening-textarea tall"
                  ></textarea>
                  <div v-else class="empty-box">尚未生成。点击上方按钮后，AI 会先写入这份模板。</div>
                </label>
              </div>
              <div class="fixed-option">正式开局会先把人物档案、酒馆档案分别写入世界书，再生成开场白和 initvar。</div>
            </div>
            <div class="field-row two">
              <label><span>人物档案 · {{ characterProfileState }}</span><textarea v-if="characterProfile" v-model="characterProfile.profile" class="opening-textarea tall"></textarea><div v-else class="empty-box">尚未生成。</div></label>
              <label><span>酒馆档案 · {{ tavernProfileState }}</span><textarea v-if="tavernProfile" v-model="tavernProfile.profile" class="opening-textarea tall"></textarea><div v-else class="empty-box">尚未生成。</div></label>
            </div>
            <label><span>开局正文</span><textarea v-if="story" v-model="story.maintext" class="opening-textarea story-box"></textarea><div v-else class="empty-box">尚未生成开场白。</div></label>
            <label>
              <span>初始变量校验</span>
              <div v-if="story?.initvar" class="empty-box">已生成完整 initvar，将写入第 1 层 stat_data。</div>
              <div v-else class="empty-box">尚未生成 initvar，不能开始游戏。</div>
            </label>
            <div class="fixed-option">固定选项：1.开始我们的故事</div>
            </details>
          </section>

          <footer class="opening-actions">
            <button class="opening-btn ghost" type="button" :disabled="currentStep === 0 || !!loading" @click="prevStep">上一步</button>
            <button v-if="currentStep < 3" class="opening-btn primary" type="button" :disabled="!!loading" @click="nextStep">下一步</button>
            <button v-else class="opening-btn primary" type="button" :disabled="!!loading || !canConfirm" @click="confirmOpening">开始游戏</button>
          </footer>
        </section>
      </section>
    </main>
  </div>
</template>

<style scoped>
.opening-workshop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  color: #f4e9d0;
  background:
    radial-gradient(circle at 18% 8%, rgba(191, 143, 64, 0.2), transparent 32%),
    linear-gradient(135deg, #110d0c 0%, #211816 48%, #0d0b0b 100%);
  overflow: auto;
  padding: 26px;
}

.opening-shell {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.opening-title {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 24px;
  align-items: center;
  text-align: center;
  margin: 0 0 28px;
}

.opening-title p {
  margin: 0 0 8px;
  color: #c89a45;
  letter-spacing: 0.18em;
  font-size: 12px;
}

.opening-title h1 {
  margin: 0;
  color: #fff9ed;
  font-size: 34px;
  font-weight: 400;
}

.title-line {
  height: 1px;
  background: linear-gradient(90deg, transparent, #c89a45, transparent);
}

.fixed-opening-board {
  border: 1px solid rgba(213, 166, 82, 0.72);
  border-radius: 18px 18px 6px 6px;
  background: rgba(34, 29, 28, 0.84);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
  padding: 18px;
}

.fixed-opening-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.fixed-opening-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 280px;
  border: 1px solid rgba(213, 166, 82, 0.34);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(255, 248, 225, 0.09), rgba(90, 60, 26, 0.12));
  padding: 18px;
  overflow: hidden;
}

.fixed-opening-card.withImage {
  background:
    linear-gradient(180deg, rgba(20, 13, 10, 0.06), rgba(20, 13, 10, 0.34) 48%, rgba(20, 13, 10, 0.88)),
    var(--opening-card-image) center 24% / cover no-repeat;
}

.fixed-opening-card.withImage::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(20, 13, 10, 0.58), rgba(20, 13, 10, 0.12) 64%, rgba(20, 13, 10, 0.24)),
    linear-gradient(180deg, transparent 30%, rgba(20, 13, 10, 0.82));
  pointer-events: none;
}

.fixed-opening-card > * {
  position: relative;
  z-index: 1;
}

.fixed-opening-card.withImage h3,
.fixed-opening-card.withImage p,
.fixed-opening-card.withImage .fixed-card-top {
  text-shadow: 0 2px 5px rgba(0, 0, 0, 0.9);
}

.opening-hover-preview {
  position: fixed;
  z-index: 100;
  top: 50%;
  left: 50%;
  width: min(520px, calc(100% - 36px));
  min-height: 440px;
  transform: translate(-50%, -50%);
  border-color: rgba(244, 192, 95, 0.88);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.78);
  pointer-events: none;
}

.opening-hover-preview.withImage {
  background-position: center 18%;
}

.opening-hover-preview h3 {
  margin-top: auto;
  font-size: 30px;
}

.opening-hover-preview p {
  flex: 0;
  font-size: 17px;
}

.opening-preview-enter-active,
.opening-preview-leave-active {
  transition:
    opacity 160ms ease,
    transform 180ms ease;
}

.opening-preview-enter-from,
.opening-preview-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.9);
}

.fixed-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #d9b56e;
}

.fixed-card-top span {
  border: 1px solid rgba(213, 166, 82, 0.38);
  border-radius: 999px;
  padding: 4px 8px;
  color: #f2d48a;
  font-size: 12px;
}

.fixed-opening-card h3 {
  margin: 0;
  color: #fff9ed;
  font-size: 22px;
  font-weight: 500;
}

.fixed-opening-card p {
  flex: 1;
  margin: 0;
  color: rgba(244, 233, 208, 0.74);
  line-height: 1.75;
}

.fixed-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fixed-card-tags span {
  border: 1px solid rgba(213, 166, 82, 0.28);
  border-radius: 999px;
  background: rgba(255, 248, 225, 0.08);
  padding: 4px 8px;
  color: #f4e9d0;
  font-size: 12px;
}

.register-frame {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 26px;
  min-height: 680px;
  border: 1px solid rgba(213, 166, 82, 0.72);
  border-radius: 18px 18px 6px 6px;
  background: rgba(34, 29, 28, 0.84);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
  padding: 28px;
}

.register-side {
  border-right: 1px solid rgba(213, 166, 82, 0.25);
  padding-right: 24px;
}

.seal {
  width: 82px;
  height: 82px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(213, 166, 82, 0.58);
  border-radius: 16px;
  background: rgba(255, 244, 211, 0.08);
  color: #d7ad5b;
}

.side-copy {
  margin: 18px 0 26px;
  display: grid;
  gap: 5px;
}

.side-copy strong {
  font-size: 22px;
  font-weight: 500;
}

.side-copy span,
.step-item small,
.side-summary span {
  color: rgba(244, 233, 208, 0.58);
  font-size: 12px;
}

.step-list {
  display: grid;
  gap: 10px;
}

.step-item {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 12px;
  align-items: center;
  text-align: left;
  padding: 13px;
  border: 1px dashed rgba(213, 166, 82, 0.38);
  border-radius: 9px;
  color: inherit;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}

.step-item.active {
  border-style: solid;
  border-color: #d7ad5b;
  background: rgba(196, 139, 45, 0.18);
}

.step-item.done {
  border-style: solid;
}

.step-num {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(213, 166, 82, 0.18);
  color: #eac77a;
}

.progress-track {
  height: 6px;
  margin: 22px 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progress-track span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #9b6722, #e5bf62);
}

.side-summary {
  display: grid;
  gap: 10px;
}

.side-summary p {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
}

.register-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.step-panel {
  display: grid;
  gap: 16px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(213, 166, 82, 0.22);
}

.section-head span {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 20px;
}

.section-head small {
  color: rgba(244, 233, 208, 0.45);
  letter-spacing: 0.12em;
}

.field-row {
  display: grid;
  gap: 14px;
}

.field-row.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

label {
  display: grid;
  gap: 8px;
  color: rgba(244, 233, 208, 0.86);
}

.opening-input,
.opening-textarea {
  width: 100%;
  border: 1px solid rgba(213, 166, 82, 0.24);
  border-radius: 8px;
  background: rgba(12, 10, 10, 0.72);
  color: #fff7e6;
  padding: 12px 14px;
  outline: none;
  font: inherit;
}

.opening-textarea {
  min-height: 96px;
  resize: vertical;
}

.opening-textarea.tall {
  min-height: 150px;
}

.story-box {
  min-height: 220px;
}

.opening-alert {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(213, 166, 82, 0.3);
  border-radius: 8px;
  background: rgba(213, 166, 82, 0.1);
}

.opening-alert.bad {
  border-color: rgba(220, 92, 78, 0.7);
  background: rgba(120, 30, 24, 0.22);
}

.opening-alert.good {
  border-color: rgba(104, 180, 118, 0.7);
  background: rgba(35, 99, 52, 0.18);
}

.quick-start-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
  gap: 18px;
  margin-bottom: 18px;
  padding: 22px;
  border: 1px solid rgba(226, 183, 91, 0.68);
  border-radius: 16px;
  background:
    radial-gradient(circle at 12% 12%, rgba(235, 194, 99, 0.24), transparent 40%),
    linear-gradient(135deg, rgba(120, 82, 28, 0.32), rgba(255, 255, 255, 0.035)),
    rgba(255, 255, 255, 0.035);
  box-shadow:
    inset 0 1px 0 rgba(255, 242, 201, 0.12),
    0 18px 38px -30px rgba(0, 0, 0, 0.72);
}

.quick-copy {
  display: grid;
  align-content: center;
  gap: 8px;
}

.quick-copy p,
.quick-copy h2,
.quick-copy span,
.quick-controls small {
  margin: 0;
}

.quick-copy p {
  color: #f0ce75;
  letter-spacing: 0.16em;
  font-size: 12px;
}

.quick-copy h2 {
  color: #fff8e9;
  font-size: 30px;
  font-weight: 500;
}

.quick-copy span,
.quick-controls small {
  color: rgba(244, 233, 208, 0.66);
  line-height: 1.65;
}

.quick-controls {
  display: grid;
  gap: 10px;
}

.quick-controls .opening-btn.hero {
  min-height: 56px;
  font-size: 17px;
  letter-spacing: 0.08em;
}

.custom-opening-btn {
  opacity: 0.86;
}

.opening-auto-card {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid rgba(213, 166, 82, 0.24);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
}

.opening-auto-card div {
  display: grid;
  gap: 5px;
}

.opening-auto-card strong {
  color: #ffe5a1;
}

.opening-auto-card span {
  color: rgba(244, 233, 208, 0.62);
  line-height: 1.55;
}

.advanced-opening {
  display: grid;
  gap: 14px;
}

.advanced-opening > summary {
  cursor: pointer;
  padding: 12px 14px;
  color: #f7e8bf;
  border: 1px dashed rgba(213, 166, 82, 0.34);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.03);
}

.module-list,
.template-check,
.empty-box,
.fixed-option,
.hint-box {
  border: 1px dashed rgba(213, 166, 82, 0.3);
  border-radius: 9px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
}

.hint-box {
  color: rgba(244, 233, 208, 0.76);
  line-height: 1.6;
}

.hint-box.warn {
  border-color: rgba(221, 168, 78, 0.5);
  background: rgba(170, 108, 28, 0.12);
}

.choice-field {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(213, 166, 82, 0.22);
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(255, 244, 211, 0.055), transparent 46%),
    rgba(255, 255, 255, 0.025);
}

.choice-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgba(244, 233, 208, 0.68);
}

.choice-label strong {
  color: #f3d386;
  font-size: 15px;
  font-weight: 500;
  text-align: right;
}

.choice-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.choice-tabs.vertical {
  align-content: start;
  display: grid;
  min-width: 158px;
}

.choice-tab {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid rgba(213, 166, 82, 0.26);
  border-radius: 999px;
  padding: 0 12px;
  color: rgba(244, 233, 208, 0.72);
  background: rgba(18, 14, 13, 0.55);
  cursor: pointer;
}

.choice-tab small {
  color: rgba(244, 233, 208, 0.44);
}

.choice-tab.active {
  color: #fff8e9;
  border-color: rgba(226, 183, 91, 0.88);
  background: linear-gradient(180deg, rgba(168, 119, 39, 0.5), rgba(80, 52, 24, 0.64));
  box-shadow: 0 0 0 1px rgba(226, 183, 91, 0.14) inset;
}

.race-grid,
.city-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}

.race-card,
.territory-card,
.city-ticket {
  width: 100%;
  min-width: 0;
  text-align: left;
  border: 1px solid rgba(213, 166, 82, 0.26);
  color: rgba(248, 235, 205, 0.78);
  background:
    linear-gradient(160deg, rgba(255, 244, 211, 0.08), transparent 55%),
    rgba(18, 14, 13, 0.46);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    transform 0.18s ease;
}

.race-card:hover,
.territory-card:hover,
.city-ticket:hover {
  border-color: rgba(226, 183, 91, 0.72);
  transform: translateY(-1px);
}

.race-card.active,
.territory-card.active,
.city-ticket.active {
  color: #fff9ea;
  border-color: #e4bd63;
  background:
    linear-gradient(160deg, rgba(241, 199, 104, 0.2), transparent 52%),
    rgba(92, 61, 25, 0.64);
  box-shadow:
    0 0 0 1px rgba(242, 207, 124, 0.18) inset,
    0 12px 26px rgba(0, 0, 0, 0.22);
}

.race-card {
  display: grid;
  gap: 7px;
  min-height: 94px;
  border-radius: 12px;
  padding: 13px;
}

.race-card strong,
.territory-card strong,
.city-ticket strong {
  color: #ffe5a1;
  font-size: 16px;
  font-weight: 600;
}

.race-card span,
.territory-card em,
.city-ticket small {
  color: rgba(244, 233, 208, 0.58);
  font-style: normal;
  line-height: 1.45;
}

.territory-layout {
  display: grid;
  grid-template-columns: minmax(150px, 0.28fr) 1fr;
  gap: 12px;
}

.territory-list {
  display: grid;
  gap: 10px;
}

.territory-card {
  display: grid;
  gap: 8px;
  border-radius: 12px;
  padding: 13px 14px;
}

.territory-card span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.territory-card small {
  flex: 0 0 auto;
  border: 1px solid rgba(226, 183, 91, 0.28);
  border-radius: 999px;
  padding: 3px 8px;
  color: rgba(244, 233, 208, 0.62);
  background: rgba(255, 255, 255, 0.035);
}

.territory-card.muted:not(.active) {
  border-style: dashed;
  opacity: 0.74;
}

.city-ticket {
  display: grid;
  gap: 7px;
  min-height: 106px;
  border-radius: 4px;
  padding: 14px;
  position: relative;
  overflow: hidden;
}

.city-ticket::after {
  content: '';
  position: absolute;
  inset: 9px;
  border: 1px dashed rgba(226, 183, 91, 0.17);
  pointer-events: none;
}

.city-ticket span {
  width: fit-content;
  border-radius: 999px;
  padding: 3px 8px;
  color: #1e1409;
  background: rgba(226, 183, 91, 0.78);
  font-size: 12px;
}

.template-check,
.module-head,
.opening-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.module-list {
  display: grid;
  gap: 12px;
}

.template-editor {
  display: grid;
  gap: 12px;
  border: 1px solid rgba(213, 166, 82, 0.24);
  border-radius: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.025);
}

.template-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.module-row {
  display: grid;
  grid-template-columns: 150px 1fr auto;
  gap: 10px;
}

.preview-panel .wide {
  justify-self: start;
}

.opening-actions {
  margin-top: auto;
  padding-top: 26px;
}

.opening-btn {
  min-height: 42px;
  border: 1px solid rgba(213, 166, 82, 0.5);
  border-radius: 8px;
  padding: 0 18px;
  color: #f7e8bf;
  background: rgba(65, 43, 24, 0.92);
  cursor: pointer;
}

.opening-btn.primary {
  color: #1d1308;
  background: linear-gradient(180deg, #f0ce75, #b6812f);
}

.opening-btn.ghost {
  background: rgba(255, 255, 255, 0.04);
}

.opening-btn.hero {
  min-height: 58px;
  color: #1d1308;
  font-size: 17px;
  font-weight: 800;
  background:
    linear-gradient(180deg, #ffe9a7, #d79a35 64%, #9f6722);
  border-color: rgba(255, 228, 147, 0.95);
  box-shadow:
    inset 0 1px 0 rgba(255, 248, 213, 0.78),
    0 16px 32px -20px rgba(0, 0, 0, 0.78);
}

.opening-btn.wide {
  width: 100%;
}

.opening-btn.sm {
  min-height: 34px;
  padding: 0 12px;
}

.opening-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

@media (max-width: 900px) {
  .fixed-opening-grid {
    grid-template-columns: 1fr;
  }

  .register-frame {
    grid-template-columns: 1fr;
  }

  .register-side {
    border-right: none;
    border-bottom: 1px solid rgba(213, 166, 82, 0.25);
    padding-right: 0;
    padding-bottom: 18px;
  }

  .field-row.two,
  .module-row,
  .territory-layout,
  .quick-start-panel {
    grid-template-columns: 1fr;
  }

  .opening-auto-card {
    align-items: stretch;
    flex-direction: column;
  }

  .choice-tabs.vertical {
    display: flex;
    min-width: 0;
  }
}

@media (hover: none) {
  .opening-hover-preview {
    display: none;
  }
}
</style>
