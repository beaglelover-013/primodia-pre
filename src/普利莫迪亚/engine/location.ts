function cleanPlaceToken(value: string) {
  let cleaned = value
    .replace(/[「」“”'<>]/g, '')
    .replace(/(?:附近|一带)$/g, '')
    .trim();
  cleaned = cleaned
    .replace(/^(?:我|玩家|主角|克斯)?(?:已经|正在|刚刚)?(?:去了|去到|去往|前往|来到|到了|回了|回到|返回到|返回|进入|抵达|离开到|离开|走到|走进|去)\s*/g, '')
    .replace(/^在(?=酒馆|厨房|库房|主厅|客房|街坊|市集|市场|商铺|店铺|农田|酒窖|地图)/g, '')
    .trim();
  return cleaned;
}

export function normalizeScenePlaceName(raw: string) {
  const place = cleanPlaceToken(String(raw || '').trim());
  if (!place) return '';
  return place;
}

export function isGenericStreetEntrance(place: string) {
  const text = place || '';
  return /街坊街口|街坊入口|市集入口|市场入口|街口|路口/.test(text) && !/商铺\s*[·:：-]|店铺\s*[·:：-]|摊位\s*[·:：-]|货架\s*[·:：-]/.test(text);
}

export function isShopLikePlace(place: string) {
  const text = place || '';
  if (isGenericStreetEntrance(text)) return false;
  return /街坊商铺|商铺|店铺|铺子|摊位|摊子|货摊|货车|马车|商队|商会|货架|店|铺|摊/.test(text);
}

export type SceneType = '酒馆' | '街坊' | '商铺' | '地图' | '农田酒窖' | '库房炉台' | '人物互动' | '未知';

export function inferSceneType(placeText: string): SceneType {
  const text = placeText || '';
  if (isShopLikePlace(text)) return '商铺';
  if (/街坊|市集|市场|街口|商铺街/.test(text)) return '街坊';
  if (/库房|炉台|厨房|餐食|做菜|烹饪|上菜/.test(text)) return '库房炉台';
  if (/农田|菜园|酒窖|酒桶|后院|种植|陈酿|发酵/.test(text)) return '农田酒窖';
  if (/羁绊|人物|配角|主角|档案/.test(text)) return '人物互动';
  if (/地图|城|镇|村|港|堡|关|谷|林|原|岭|寨|庄|湾/.test(text)) return '地图';
  if (/酒馆|主厅|客房|马厩|地窖|前门/.test(text)) return '酒馆';
  return '未知';
}
