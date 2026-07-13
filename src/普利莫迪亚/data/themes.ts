export const PRIMORDIA_THEME_STORAGE_KEY = 'primordia.theme';

export const primordiaThemes = [
  {
    id: 'walnut-brass',
    name: '黑木黄铜',
    description: '深色酒馆、羊皮纸与黄铜灯火。',
    swatches: ['#150d07', '#2a1c11', '#e3cea1', '#c9a04a', '#5c8a52'],
  },
  {
    id: 'frost-harbor',
    name: '霜港蓝灰',
    description: '冷港雾雨、蓝灰木梁与银白高光。',
    swatches: ['#0d1418', '#1c2a31', '#d7dfdc', '#9eb9c6', '#6f97a8'],
  },
  {
    id: 'greenwood-herb',
    name: '绿林药草',
    description: '橄榄木色、草药绿与温和浅金。',
    swatches: ['#12170d', '#25351c', '#e2d7aa', '#b9aa5c', '#6d9154'],
  },
  {
    id: 'copper-hearth',
    name: '红铜炉火',
    description: '炉火暗红、烟熏木纹与红铜暖光。',
    swatches: ['#170b08', '#3a1b14', '#ead0a4', '#c77a3f', '#a24c38'],
  },
  {
    id: 'iron-kettle-inn',
    name: '铁壶酒馆',
    description: '黑棕木梁、旧账羊皮纸与暗金烛火。',
    swatches: ['#100906', '#2b1b12', '#eadcc1', '#b78a37', '#7a5d38'],
  },
  {
    id: 'moonlit-silver',
    name: '月夜紫银',
    description: '夜幕紫银、深墨背景与冷亮边光。',
    swatches: ['#0c0b14', '#211c35', '#ded7ef', '#a99bd4', '#6f5d94'],
  },
  {
    id: 'morning-parchment',
    name: '晨光羊皮',
    description: '明亮纸面、柔金边框与低对比木色。',
    swatches: ['#f3e7c8', '#c4a66d', '#5d3f24', '#d6a953', '#77915d'],
  },
  {
    id: 'mithril-arcana',
    name: '冷色秘银',
    description: '蓝黑钢材、秘银刻线与奥术冷光。',
    swatches: ['#081116', '#172a33', '#dbe8e9', '#8fc7d5', '#4c86a0'],
  },
  {
    id: 'classic-parchment',
    name: '羊皮卷古典',
    description: '陈年纸页、墨褐笔迹与蜡封暗红。',
    swatches: ['#21150d', '#6d5133', '#ead5a8', '#b58a43', '#8c4035'],
  },
  {
    id: 'crimson-empire',
    name: '深红帝国',
    description: '黑檀宫墙、勃艮第红与帝国鎏金。',
    swatches: ['#0d0708', '#3b1018', '#e8d8c1', '#c19a4b', '#861f32'],
  },
] as const;

export type PrimordiaThemeId = (typeof primordiaThemes)[number]['id'];

export const DEFAULT_PRIMORDIA_THEME: PrimordiaThemeId = 'walnut-brass';

export function isPrimordiaThemeId(value: string | null | undefined): value is PrimordiaThemeId {
  return primordiaThemes.some(theme => theme.id === value);
}
