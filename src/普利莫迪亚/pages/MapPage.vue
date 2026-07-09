<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useGameStore, type MapNode } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';
import { mapTrafficRoutes, tradeRoutes, waterRoutes, type MapTrafficRoute } from '../data/mapTraffic';

const game = useGameStore();

const hoverId = ref<string | null>(null);
const zoom = ref(2.4);
const pan = reactive({ x: 0, y: 0 });
const mapCanvas = ref<SVGSVGElement | null>(null);
const drag = reactive({ active: false, moved: false, lastX: 0, lastY: 0 });
const selectedId = ref(game.currentMapId);
const mapLayer = ref<'roads' | 'trade' | 'water'>('roads');
const mobileMapOpen = ref(false);
const current = computed(() => game.mapNodes.find(n => n.id === game.currentMapId));
const selected = computed(() => game.mapNodes.find(n => n.id === selectedId.value) ?? current.value);
watch(
  () => game.currentMapId,
  id => {
    selectedId.value = id;
  },
);
const neighbors = computed(() => {
  if (!selected.value) return [];
  return game.mapNodes.filter(n => selected.value!.neighbors.includes(n.id));
});
const routeGroups = computed(() => {
  const groups: Record<string, { title: string; hint: string; nodes: MapNode[] }> = {
    local: { title: '本地生活圈', hint: '5-60km, 村镇、郊外、集市、驿站', nodes: [] },
    regional: { title: '区域交通圈', hint: '60-160km, 城镇与区域节点', nodes: [] },
    trunk: { title: '跨区干线', hint: '160km以上, 山脉、海航、荒野或地下远程路', nodes: [] },
  };
  for (const n of neighbors.value) {
    const route = routeFromSelected(n);
    if (!route) continue;
    groups[route.routeLevel].nodes.push(n);
  }
  return Object.values(groups).filter(group => group.nodes.length > 0);
});
const selectedIsCurrentNeighbor = computed(() => !!current.value && !!selected.value && current.value.neighbors.includes(selected.value.id));
function shouldShowNodeLabel(node: MapNode) {
  if (node.id === game.currentMapId) return true;
  if (node.id === selected.value?.id) return true;
  if (node.id === hoverId.value) return true;
  return Boolean(selected.value?.neighbors.includes(node.id));
}
const mapBounds = computed(() => {
  const xs = game.mapNodes.map(n => n.x);
  const ys = game.mapNodes.map(n => n.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
});
function mapPoint(n: Pick<MapNode, 'x' | 'y'>) {
  const b = mapBounds.value;
  const pad = 5;
  const width = Math.max(1, b.maxX - b.minX);
  const height = Math.max(1, b.maxY - b.minY);
  return {
    x: pad + ((n.x - b.minX) / width) * (100 - pad * 2),
    y: pad + ((b.maxY - n.y) / height) * (100 - pad * 2),
  };
}
function viewportPoint(p: { x: number; y: number }) {
  return {
    x: 50 + (p.x - 50) * zoom.value + pan.x,
    y: 50 + (p.y - 50) * zoom.value + pan.y,
  };
}
const visualNodes = computed(() => game.mapNodes.map(n => ({ node: n, ...mapPoint(n) })));
const viewportNodes = computed(() => visualNodes.value.map(item => ({ ...item, ...viewportPoint(item) })));
const nodeByName = computed(() => new Map(game.mapNodes.map(node => [node.name, node])));
const visibleTrafficRoutes = computed(() => (mapLayer.value === 'trade' ? tradeRoutes : mapLayer.value === 'water' ? waterRoutes : []));
const trafficPolylines = computed(() =>
  visibleTrafficRoutes.value
    .map(route => {
      const points = route.nodes
        .map(name => nodeByName.value.get(name))
        .filter((node): node is MapNode => !!node)
        .map(node => viewportPoint(mapPoint(node)));
      return {
        ...route,
        points: points.map(point => `${point.x},${point.y}`).join(' '),
        valid: points.length > 1,
      };
    })
    .filter(route => route.valid),
);
const activeTrafficNodeNames = computed(() => new Set(visibleTrafficRoutes.value.flatMap(route => route.nodes)));
const layerTitle = computed(() => {
  if (mapLayer.value === 'trade') return '主干商路';
  if (mapLayer.value === 'water') return '内陆水系';
  return '普通道路';
});
const layerHint = computed(() => {
  if (mapLayer.value === 'trade') return '只显示五条跨区贸易线, 沿途城市会被点亮';
  if (mapLayer.value === 'water') return '只显示可叙事引用的主河道, 部分水路需要许可或向导';
  return '显示当前节点的普通邻接路, 适合一站一站旅行';
});
const selectedTrafficRoutes = computed(() => {
  if (!selected.value) return [];
  return mapTrafficRoutes.filter(route => route.nodes.includes(selected.value!.name));
});

function nodeColor(type: MapNode['type']) {
  switch (type) {
    case '都市':
      return '#f3da90';
    case '城镇':
      return '#c9a04a';
    case '村落':
      return '#a07248';
    case '关隘':
      return '#a45a3e';
    case '秘境':
      return '#7d5a92';
    case '深界入口':
      return '#5a4a8c';
    default:
      return '#c9a04a';
  }
}
function nodeSize(type: MapNode['type']) {
  switch (type) {
    case '都市':
      return 1.18;
    case '城镇':
      return 1;
    case '村落':
      return 0.86;
    case '关隘':
      return 1.08;
    case '秘境':
    case '深界入口':
      return 1;
    default:
      return 1;
  }
}

function travelTo(n: MapNode) {
  if (!current.value) return;
  const origin = current.value;
  if (!origin.neighbors.includes(n.id)) {
    game.pushLog('提示', `${n.name} 与当前地点未直接邻接, 需要先到中转点。`);
    return;
  }
  const route = routeEstimate(origin, n);
  game.appendDraft(`我从「${origin.name}」出发，经${route.routeType}前往「${n.name}」，路程约${route.routeKm}公里，骑马约${route.horseText}。`);
  game.pushLog('提示', `旅行 · ${origin.name} -> ${n.name} 已加入行动框。`);
  selectedId.value = n.id;
}
function distanceBetween(a: Pick<MapNode, 'x' | 'y'>, b: Pick<MapNode, 'x' | 'y'>) {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y));
}
function hasTerrain(n: MapNode, keyword: string) {
  return !!`${n.terrain ?? ''}${n.specialTerrain ?? ''}${n.desc ?? ''}`.includes(keyword);
}
function trafficRouteForPair(a: MapNode, b: MapNode, kind?: MapTrafficRoute['kind']) {
  return mapTrafficRoutes.find(route => {
    if (kind && route.kind !== kind) return false;
    const ai = route.nodes.indexOf(a.name);
    const bi = route.nodes.indexOf(b.name);
    return ai >= 0 && bi >= 0 && Math.abs(ai - bi) === 1;
  });
}
function routeTypeBetween(a: MapNode, b: MapNode) {
  const traffic = trafficRouteForPair(a, b);
  if (traffic?.routeType) return traffic.routeType;
  if (a.type === '深界入口' || b.type === '深界入口') return '深界通道';
  if (hasTerrain(a, '地下') || hasTerrain(b, '地下')) return '地下入口';
  if (hasTerrain(a, '沿海') && hasTerrain(b, '沿海')) return '海航';
  if (hasTerrain(a, '沿河') && hasTerrain(b, '沿河')) return '水路';
  if (hasTerrain(a, '峡谷') || hasTerrain(b, '峡谷') || hasTerrain(a, '山地') || hasTerrain(b, '山地')) return '山路/隘口';
  if (hasTerrain(a, '沼泽') || hasTerrain(b, '沼泽')) return '湿地道路';
  if (hasTerrain(a, '森林') || hasTerrain(b, '森林')) return '林道';
  return '官道/陆路';
}
function routeFactor(a: MapNode, b: MapNode) {
  const text = `${a.terrain ?? ''}${b.terrain ?? ''}${a.specialTerrain ?? ''}${b.specialTerrain ?? ''}`;
  if (text.includes('地下') || text.includes('峡谷') || text.includes('山地')) return 1.65;
  if (text.includes('沼泽') || text.includes('沙漠')) return 1.55;
  if (text.includes('森林') || text.includes('丘陵')) return 1.4;
  if (text.includes('沿海') || text.includes('沿河')) return 1.25;
  return 1.25;
}
function routeName(a: MapNode, b: MapNode) {
  const traffic = trafficRouteForPair(a, b);
  if (traffic) return traffic.name;
  const pair = `${a.name}-${b.name}`;
  const factions = `${a.faction ?? ''}${b.faction ?? ''}`;
  if (pair.includes('纳维里斯') && factions.includes('卡尔德里亚')) return '纳维里斯-卡尔德里亚首都干道';
  if (factions.includes('矮人') || factions.includes('暗精灵')) return '铁砧隘路';
  if (factions.includes('兽族联邦') || factions.includes('阿尔登马克')) return '绢稻之路';
  if (factions.includes('龙裔')) return '沙金之路';
  if (factions.includes('精灵')) return '翡叶香路';
  if (factions.includes('人鱼') || routeTypeBetween(a, b) === '海航') return '人鱼控制海路';
  return routeTypeBetween(a, b);
}
const localRouteOverrides: Record<string, { km: number; type?: string; name?: string }> = {
  ['布拉姆维克|费尔马克']: { km: 18, type: '丘陵乡间路', name: '发石河乡道' },
  ['费尔马克|风磨丘']: { km: 70, type: '丘陵道路', name: '南丘风车路' },
  ['白崖城|费尔马克']: { km: 120, type: '沿河商路', name: '白崖旧商路' },
  ['布拉姆维克|风磨丘']: { km: 55, type: '丘陵小路', name: '荆篱小径' },
  ['布拉姆维克|雾港']: { km: 155, type: '南境海雾路', name: '雾港驿道' },
  ['费尔马克|雾港']: { km: 160, type: '南境驿道', name: '雾港驿道' },
  ['绿谷|铁炉镇']: { km: 95, type: '平原商路', name: '绿谷粮车道' },
  ['克朗港|盐脊堡']: { km: 140, type: '海岸盐路', name: '盐脊海岸路' },
  ['克朗港|杉影镇']: { km: 115, type: '林港商路', name: '杉影木材路' },
};
function localRouteKey(a: MapNode, b: MapNode) {
  return [a.name, b.name].sort((x, y) => x.localeCompare(y, 'zh-Hans-CN')).join('|');
}
function typeBaseKm(a: MapNode, b: MapNode) {
  const pair = [a.type, b.type].sort().join('|');
  const directSeed = distanceBetween(a, b) % 37;
  if (pair.includes('村落') && pair.includes('城镇')) return 35 + directSeed;
  if (pair.includes('村落') && pair.includes('都市')) return 75 + directSeed;
  if (pair.includes('城镇') && pair.includes('都市')) return 95 + directSeed;
  if (pair === '都市|都市') return 135 + directSeed * 2;
  if (pair.includes('关隘')) return 90 + directSeed * 2;
  if (pair.includes('秘境') || pair.includes('深界入口')) return 70 + directSeed * 2;
  return 55 + directSeed;
}
function localRouteKm(a: MapNode, b: MapNode) {
  const override = localRouteOverrides[localRouteKey(a, b)];
  if (override) return override.km;
  const sameFaction = (a.faction ?? a.region) === (b.faction ?? b.region);
  const routeType = routeTypeBetween(a, b);
  const factor = routeType.includes('山路') || routeType.includes('湿地') || routeType.includes('地下') ? 1.35 : routeType.includes('林道') ? 1.2 : 1;
  const base = Math.round(typeBaseKm(a, b) * factor);
  return sameFaction ? base : Math.round(base * 1.55);
}
function dayText(days: number) {
  if (days < 0.5) return '半日内';
  if (days < 1.5) return '约1日';
  return `约${Math.round(days)}日`;
}
function routeLevel(routeKm: number) {
  if (routeKm <= 60) return 'local';
  if (routeKm <= 160) return 'regional';
  return 'trunk';
}
function routeLevelLabel(level: string) {
  if (level === 'local') return '本地';
  if (level === 'regional') return '区域';
  return '干线';
}
function vehicleOptions(a: MapNode, b: MapNode, routeKm: number, routeType: string, routeNameValue: string) {
  const text = `${a.faction ?? ''}${b.faction ?? ''}${a.terrain ?? ''}${b.terrain ?? ''}${a.specialTerrain ?? ''}${b.specialTerrain ?? ''}${routeType}${routeNameValue}`;
  const options = [
    { name: '骑马', time: dayText(routeKm / 45), note: '通用移动' },
    { name: '徒步', time: dayText((routeKm / 45) * 1.5), note: '最省钱' },
  ];
  if (!routeType.includes('山路') && !routeType.includes('地下') && !routeType.includes('湿地')) {
    options.push({ name: '马车商队', time: dayText(routeKm / 35), note: '能载货, 适合安全道路' });
  }
  if (routeNameValue.includes('卡尔德里亚') || routeNameValue.includes('绿谷') || routeType.includes('官道')) {
    options.push({ name: '蒸汽货车', time: dayText(routeKm / 90), note: '仅限维护良好的主干道/试运营线' });
  }
  if (routeType.includes('水路')) {
    options.push({ name: '内河顺流', time: dayText(routeKm / 120), note: '顺水最快' });
    options.push({ name: '内河逆流', time: dayText(routeKm / 40), note: '逆水慢, 需纤夫或魔法辅助' });
  }
  if (routeType.includes('海航')) {
    options.push({ name: '帆船/海船', time: dayText(routeKm / 180), note: '受风浪与港口许可影响' });
  }
  if (routeType.includes('山路') || text.includes('矮人')) {
    options.push({ name: '驮牦/山地驮兽', time: dayText(routeKm / 32), note: '山路稳, 速度慢' });
    options.push({ name: '铁壳驮虫', time: dayText(routeKm / 28), note: '矮人山脉与矿道常用' });
  }
  if (routeType.includes('地下')) {
    options.push({ name: '洞穴驮兽', time: dayText(routeKm / 24), note: '地下安全, 但依赖向导' });
  }
  if (routeType.includes('湿地')) {
    options.push({ name: '沼蜥/浅水舟', time: dayText(routeKm / 38), note: '湿地稳定, 冬季迟缓' });
  }
  if (text.includes('龙裔') || text.includes('沙漠')) {
    options.push({ name: '骆驼商队', time: dayText(routeKm / 40), note: '高原与荒漠更稳' });
  }
  if (text.includes('雪女') || text.includes('约顿') || text.includes('霜') || text.includes('冰')) {
    options.push({ name: '雪犬队/霜角鹿', time: dayText(routeKm / 55), note: '雪地最佳, 暴风雪仍可能中断' });
  }
  options.push({ name: '狮鹫飞行', time: dayText(distanceBetween(a, b) / 400), note: '走直线, 昂贵且受天气限制' });
  return options;
}
function routeEstimate(a: MapNode, b: MapNode) {
  const directKm = distanceBetween(a, b);
  const override = localRouteOverrides[localRouteKey(a, b)];
  const isLocalNeighbor = a.neighbors.includes(b.id) || b.neighbors.includes(a.id);
  const routeType = override?.type ?? routeTypeBetween(a, b);
  const routeKm = isLocalNeighbor ? localRouteKm(a, b) : Math.max(1, Math.round(directKm * routeFactor(a, b)));
  const horseDays = routeKm / 45;
  const walkDays = horseDays * 1.5;
  const riverDays = routeType === '水路' ? routeKm / 120 : null;
  const shipDays = routeType === '海航' ? routeKm / 180 : null;
  const name = override?.name ?? routeName(a, b);
  const steamDays = name.includes('卡尔德里亚') ? horseDays * 0.5 : null;
  const vehicles = vehicleOptions(a, b, routeKm, routeType, name);
  return {
    directKm,
    routeKm,
    routeType,
    routeName: name,
    routeLevel: routeLevel(routeKm),
    routeLevelLabel: routeLevelLabel(routeLevel(routeKm)),
    horseDays,
    horseText: dayText(horseDays),
    walkText: dayText(walkDays),
    riverText: riverDays ? dayText(riverDays) : '',
    shipText: shipDays ? dayText(shipDays) : '',
    steamText: steamDays ? dayText(steamDays) : '',
    vehicles,
  };
}
function distanceFromSelected(n: MapNode) {
  if (!selected.value) return 0;
  return distanceBetween(selected.value, n);
}
function distanceFromCurrent(n: MapNode) {
  if (!current.value) return 0;
  return distanceBetween(current.value, n);
}
function routeFromSelected(n: MapNode) {
  if (!selected.value) return null;
  return routeEstimate(selected.value, n);
}
function routeFromCurrent(n: MapNode) {
  if (!current.value) return null;
  return routeEstimate(current.value, n);
}

/* 计算可视化线条 */
const edges = computed(() => {
  const seen = new Set<string>();
  const list: { from: MapNode; to: MapNode; key: string }[] = [];
  for (const n of game.mapNodes) {
    for (const tid of n.neighbors) {
      const key = [n.id, tid].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      const to = game.mapNodes.find(x => x.id === tid);
      if (to) list.push({ from: n, to, key });
    }
  }
  return list;
});
const visualEdges = computed(() =>
  edges.value.map(e => ({
    key: e.key,
    from: mapPoint(e.from),
    to: mapPoint(e.to),
  })),
);
const viewportEdges = computed(() =>
  visualEdges.value.map(e => ({
    key: e.key,
    from: viewportPoint(e.from),
    to: viewportPoint(e.to),
  })),
);
function zoomIn() {
  zoomAt(Math.min(8, Number((zoom.value * 1.18).toFixed(2))));
}
function zoomOut() {
  zoomAt(Math.max(0.9, Number((zoom.value / 1.18).toFixed(2))));
}
function moveMap(dx: number, dy: number) {
  pan.x += dx;
  pan.y += dy;
}
function resetView() {
  zoom.value = 2.4;
  pan.x = 0;
  pan.y = 0;
}
function focusNode(n: MapNode) {
  const point = mapPoint(n);
  pan.x = -(point.x - 50) * zoom.value;
  pan.y = -(point.y - 50) * zoom.value;
}
function clientToSvgPoint(event: PointerEvent | WheelEvent) {
  const rect = mapCanvas.value?.getBoundingClientRect();
  if (!rect) return { x: 50, y: 50 };
  return {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100,
  };
}
function zoomAt(nextZoom: number, center = { x: 50, y: 50 }) {
  const oldZoom = zoom.value;
  const ratio = nextZoom / oldZoom;
  pan.x = center.x - 50 - (center.x - 50 - pan.x) * ratio;
  pan.y = center.y - 50 - (center.y - 50 - pan.y) * ratio;
  zoom.value = nextZoom;
}
function onWheel(event: WheelEvent) {
  const nextZoom = event.deltaY > 0 ? zoom.value / 1.16 : zoom.value * 1.16;
  zoomAt(Math.min(8, Math.max(0.9, Number(nextZoom.toFixed(2)))), clientToSvgPoint(event));
}
function onPointerDown(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return;
  drag.active = true;
  drag.moved = false;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  mapCanvas.value?.setPointerCapture(event.pointerId);
}
function onPointerMove(event: PointerEvent) {
  if (!drag.active) return;
  const rect = mapCanvas.value?.getBoundingClientRect();
  if (!rect) return;
  const dx = ((event.clientX - drag.lastX) / rect.width) * 100;
  const dy = ((event.clientY - drag.lastY) / rect.height) * 100;
  if (Math.abs(event.clientX - drag.lastX) > 1 || Math.abs(event.clientY - drag.lastY) > 1) drag.moved = true;
  pan.x += dx;
  pan.y += dy;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
}
function onPointerUp(event: PointerEvent) {
  drag.active = false;
  mapCanvas.value?.releasePointerCapture(event.pointerId);
}
function onNodeClick(event: MouseEvent, n: MapNode) {
  event.stopPropagation();
  selectedId.value = n.id;
  focusNode(n);
}
</script>

<template>
  <section id="page-map" class="page pm-paper">
    <header class="pm-paper-head">
      <div>
        <h2 class="h-title">
          <PmIcon name="map" :size="22" />
          大地图 · 普利莫迪亚
        </h2>
        <div class="sub">节点彼此邻接, 跨越需消耗精力与时间</div>
      </div>
      <div class="head-actions">
        <span class="pm-tag dim">当前 · {{ current?.name }} · X {{ current?.x }} / Y {{ current?.y }}</span>
      </div>
    </header>

    <div class="pm-paper-body map-layout">
      <!-- SVG 地图 -->
      <button class="map-mobile-toggle pm-btn full" type="button" @click="mobileMapOpen = !mobileMapOpen">
        <PmIcon name="map" :size="14" />
        {{ mobileMapOpen ? '收起地图' : '展开触屏地图' }}
      </button>

      <div class="map-canvas-wrap" :class="[`layer-${mapLayer}`, { 'mobile-open': mobileMapOpen }]">
        <div class="map-controls" aria-label="地图缩放与移动">
          <button title="放大" @click="zoomIn">+</button>
          <button title="缩小" @click="zoomOut">-</button>
          <button title="上移" @click="moveMap(0, 8)">↑</button>
          <button title="下移" @click="moveMap(0, -8)">↓</button>
          <button title="左移" @click="moveMap(8, 0)">←</button>
          <button title="右移" @click="moveMap(-8, 0)">→</button>
          <button title="重置视野" @click="resetView">重置</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <div class="layer-tabs" aria-label="地图图层">
            <button :class="{ active: mapLayer === 'roads' }" @click="mapLayer = 'roads'">道路</button>
            <button :class="{ active: mapLayer === 'trade' }" @click="mapLayer = 'trade'">商路</button>
            <button :class="{ active: mapLayer === 'water' }" @click="mapLayer = 'water'">水路</button>
          </div>
        </div>
        <div class="layer-ribbon" :class="`layer-${mapLayer}`">
          <strong>{{ layerTitle }}</strong>
          <span>{{ layerHint }}</span>
        </div>
        <svg
          ref="mapCanvas"
          class="map-canvas"
          :class="[{ dragging: drag.active }, `layer-${mapLayer}`]"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="普利莫迪亚地图"
          @wheel.prevent="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointerleave="onPointerUp"
        >
          <defs>
            <radialGradient id="paperBg" cx="50%" cy="50%" r="65%">
              <stop offset="0%" stop-color="#f3deb1" />
              <stop offset="80%" stop-color="#d4ba88" />
              <stop offset="100%" stop-color="#a07a4a" />
            </radialGradient>
            <pattern id="paperGrid" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(110,80,34,0.18)" stroke-width="0.15" />
            </pattern>
            <filter id="goldGlow">
              <feGaussianBlur stdDeviation="0.6" />
            </filter>
          </defs>
          <rect width="100" height="100" fill="url(#paperBg)" />
          <rect width="100" height="100" fill="url(#paperGrid)" />

          <!-- 邻接线 -->
          <g v-if="mapLayer === 'roads'" class="edges">
            <line
              v-for="e in viewportEdges"
              :key="e.key"
              :x1="e.from.x"
              :y1="e.from.y"
              :x2="e.to.x"
              :y2="e.to.y"
              stroke="rgba(110,80,34,0.55)"
              stroke-width="0.25"
              stroke-dasharray="0.4 0.6"
            />
          </g>

          <!-- 商路 / 水路图层 -->
          <g v-if="mapLayer !== 'roads'" class="traffic-lines">
            <polyline
              v-for="route in trafficPolylines"
              :key="`${route.id}-glow`"
              :points="route.points"
              fill="none"
              :stroke="route.color"
              :stroke-width="route.kind === 'trade' ? 1.75 : 1.45"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="traffic-line-glow"
            />
            <polyline
              v-for="route in trafficPolylines"
              :key="route.id"
              :points="route.points"
              fill="none"
              :stroke="route.color"
              :stroke-width="route.kind === 'trade' ? 0.9 : 0.72"
              :stroke-dasharray="route.kind === 'water' ? '1.1 0.65' : 'none'"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="traffic-line-main"
            />
          </g>

          <!-- 节点 -->
          <g class="nodes">
            <g
              v-for="item in viewportNodes"
              :key="item.node.id"
              :transform="`translate(${item.x}, ${item.y})`"
              class="node"
              :class="{
                current: item.node.id === game.currentMapId,
                selected: item.node.id === selected?.id,
                hover: hoverId === item.node.id,
                'traffic-node': mapLayer !== 'roads' && activeTrafficNodeNames.has(item.node.name),
                muted: mapLayer !== 'roads' && !activeTrafficNodeNames.has(item.node.name),
              }"
              @mouseenter="hoverId = item.node.id"
              @mouseleave="hoverId = null"
              @pointerdown.stop
              @pointermove.stop
              @pointerup.stop
              @click.stop="onNodeClick($event, item.node)"
            >
              <g :transform="`scale(${nodeSize(item.node.type)})`">
                <circle r="2.7" class="node-shadow" />
                <g v-if="item.node.type === '都市'" class="node-symbol">
                  <path d="M -2.1 1.7 H 2.1 V -0.7 H 1.45 V -1.6 H 0.6 V -0.7 H -0.6 V -1.6 H -1.45 V -0.7 H -2.1 Z" :fill="nodeColor(item.node.type)" />
                  <path d="M -2.1 1.7 H 2.1 V -0.7 H 1.45 V -1.6 H 0.6 V -0.7 H -0.6 V -1.6 H -1.45 V -0.7 H -2.1 Z" class="node-ink" />
                </g>
                <g v-else-if="item.node.type === '城镇'" class="node-symbol">
                  <path d="M -2 1.4 H 2 V -0.45 L 0 -1.75 L -2 -0.45 Z" :fill="nodeColor(item.node.type)" />
                  <path d="M -2 1.4 H 2 V -0.45 L 0 -1.75 L -2 -0.45 Z" class="node-ink" />
                </g>
                <g v-else-if="item.node.type === '村落'" class="node-symbol">
                  <path d="M -1.7 1.35 H 1.7 V -0.2 L 0 -1.35 L -1.7 -0.2 Z" :fill="nodeColor(item.node.type)" />
                  <path d="M -1.7 1.35 H 1.7 V -0.2 L 0 -1.35 L -1.7 -0.2 Z" class="node-ink" />
                  <path d="M -0.55 1.35 V 0.25 H 0.35 V 1.35" class="node-detail" />
                </g>
                <g v-else-if="item.node.type === '关隘'" class="node-symbol">
                  <path d="M 0 -2 L 1.9 -1.15 V 0.35 C 1.9 1.45 0.85 2 0 2.25 C -0.85 2 -1.9 1.45 -1.9 0.35 V -1.15 Z" :fill="nodeColor(item.node.type)" />
                  <path d="M 0 -2 L 1.9 -1.15 V 0.35 C 1.9 1.45 0.85 2 0 2.25 C -0.85 2 -1.9 1.45 -1.9 0.35 V -1.15 Z" class="node-ink" />
                </g>
                <g v-else class="node-symbol">
                  <path d="M 0 -2.2 L 2 0 L 0 2.2 L -2 0 Z" :fill="nodeColor(item.node.type)" />
                  <path d="M 0 -2.2 L 2 0 L 0 2.2 L -2 0 Z" class="node-ink" />
                  <circle r="0.55" class="node-rune" />
                </g>
              </g>
              <circle v-if="item.node.id === game.currentMapId" r="3.6" fill="none" stroke="#f3da90" stroke-width="0.3" filter="url(#goldGlow)" />
              <circle v-if="item.node.id === selected?.id" r="4.3" fill="none" stroke="rgba(67, 38, 14, 0.7)" stroke-width="0.22" stroke-dasharray="0.5 0.45" />
              <text v-if="shouldShowNodeLabel(item.node)" :y="-4.2" text-anchor="middle" class="node-label">{{ item.node.name }}</text>
            </g>
          </g>

          <!-- 右下指南针 -->
          <g transform="translate(89, 89)" class="compass">
            <circle r="6" fill="none" stroke="rgba(110,80,34,0.6)" stroke-width="0.3" />
            <path d="M 0 -5 L 1.5 0 L 0 5 L -1.5 0 Z" fill="#c9a04a" stroke="#3a2614" stroke-width="0.15" />
            <text y="-7" text-anchor="middle" font-size="2" fill="rgba(110,80,34,0.85)">北</text>
          </g>
        </svg>
      </div>

      <!-- 信息侧栏 -->
      <aside class="map-side">
        <div class="side-card pm-card">
          <h3>当前地点</h3>
          <div v-if="current">
            <div class="loc-h">
              <span class="loc-name">{{ current.name }}</span>
              <span class="pm-tag" :style="{ background: nodeColor(current.type), color: '#2a1c11' }">{{ current.type }}</span>
            </div>
            <p class="pm-dim">{{ current.region }}</p>
            <div class="coord-board compact">
              <div>
                <span>当前位置坐标</span>
                <strong>X {{ current.x }} / Y {{ current.y }}</strong>
              </div>
            </div>
            <button class="pm-btn full" @click="current && (selectedId = game.currentMapId, focusNode(current))">回到当前地点</button>
          </div>
        </div>
        <div class="side-card pm-card">
          <h3>城市预览</h3>
          <div v-if="selected">
            <div class="loc-h">
              <span class="loc-name">{{ selected.name }}</span>
              <span class="pm-tag" :style="{ background: nodeColor(selected.type), color: '#2a1c11' }">{{ selected.type }}</span>
            </div>
            <p class="pm-dim">{{ selected.region }}</p>
            <div class="coord-board">
              <div>
                <span>预览坐标</span>
                <strong>{{ selected.name }} · X {{ selected.x }} / Y {{ selected.y }}</strong>
              </div>
            </div>
            <div class="loc-facts">
              <span v-if="selected.faction">{{ selected.faction }}</span>
              <span v-if="selected.mainTag">{{ selected.mainTag }}</span>
              <span v-if="selected.terrain">{{ selected.terrain }}</span>
              <span v-if="selected.specialTerrain && selected.specialTerrain !== '无'">{{ selected.specialTerrain }}</span>
            </div>
            <div v-if="selectedTrafficRoutes.length" class="traffic-tags">
              <span
                v-for="route in selectedTrafficRoutes"
                :key="route.id"
                :style="{ borderColor: route.color, color: route.color }"
              >
                {{ route.kind === 'trade' ? '商路' : '水系' }} · {{ route.name }}
              </span>
            </div>
            <div v-if="selected.id !== game.currentMapId && routeFromCurrent(selected)" class="route-preview">
              <span>{{ routeFromCurrent(selected)?.routeLevelLabel }} · {{ routeFromCurrent(selected)?.routeName }}</span>
              <strong>直线约 {{ routeFromCurrent(selected)?.directKm }} 公里 · 典型路程约 {{ routeFromCurrent(selected)?.routeKm }} 公里</strong>
              <em>推荐载具</em>
              <div class="vehicle-list">
                <span v-for="vehicle in routeFromCurrent(selected)?.vehicles.slice(0, 5)" :key="vehicle.name">
                  {{ vehicle.name }} {{ vehicle.time }}
                </span>
              </div>
            </div>
            <p class="loc-desc">{{ selected.desc }}</p>
            <p v-if="selected.subTags?.length" class="loc-subtags">副标签: {{ selected.subTags.join('、') }}</p>
            <button v-if="selected.id !== game.currentMapId && selectedIsCurrentNeighbor" class="pm-btn full" @click="travelTo(selected)">
              启程前往
            </button>
            <p v-else-if="selected.id !== game.currentMapId" class="pm-empty">此地不是当前所在地的直接邻城，需要经相邻节点中转。</p>
          </div>
        </div>
        <div class="side-card pm-card">
          <h3>周边路线</h3>
          <div v-for="group in routeGroups" :key="group.title" class="route-group">
            <div class="route-group-head">
              <strong>{{ group.title }}</strong>
              <span>{{ group.hint }}</span>
            </div>
            <ul class="adj-list">
              <li v-for="n in group.nodes" :key="n.id">
                <span class="adj-dot" :style="{ background: nodeColor(n.type) }"></span>
                <div class="adj-meta">
                  <span class="adj-name">{{ n.name }}</span>
                  <span class="adj-region pm-dim">{{ n.region }} · {{ n.type }}</span>
                  <span v-if="routeFromSelected(n)" class="adj-route">
                    {{ routeFromSelected(n)?.routeName }} · {{ routeFromSelected(n)?.routeType }} · 约 {{ routeFromSelected(n)?.routeKm }} 公里 · 骑马 {{ routeFromSelected(n)?.horseText }}
                  </span>
                  <span v-for="vehicle in routeFromSelected(n)?.vehicles.slice(0, 4)" :key="vehicle.name" class="adj-route alt">
                    {{ vehicle.name }} {{ vehicle.time }} · {{ vehicle.note }}
                  </span>
                </div>
                <button v-if="current?.neighbors.includes(n.id)" class="pm-btn sm" @click="travelTo(n)">
                  启程
                </button>
                <button v-else class="pm-btn sm ghost" @click="selectedId = n.id">查看</button>
              </li>
            </ul>
          </div>
          <p v-if="neighbors.length === 0" class="pm-empty">此地暂无相邻节点。</p>
        </div>
        <div class="side-card pm-card">
          <h3>交通图层</h3>
          <p v-if="mapLayer === 'roads'" class="pm-empty">当前显示普通道路。切到商路或水路后，可以看主干线，但不展开整条城市名单。</p>
          <div v-else class="traffic-route-list">
            <div v-for="route in visibleTrafficRoutes" :key="route.id" class="traffic-route-item">
              <div class="traffic-route-head">
                <span class="route-swatch" :style="{ background: route.color }"></span>
                <strong>{{ route.name }}</strong>
                <em>{{ route.routeType }}</em>
              </div>
              <p>共 {{ route.nodes.length }} 个节点。只在选中相关城市时展开局部信息。</p>
            </div>
          </div>
        </div>
        <div class="side-card pm-card">
          <h3>图例</h3>
          <ul class="legend">
            <li v-for="t in (['都市', '城镇', '村落', '关隘', '秘境', '深界入口'] as MapNode['type'][])" :key="t">
              <span class="lg-dot" :style="{ background: nodeColor(t) }"></span>
              {{ t }}
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.map-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
  gap: 14px;
}
.map-mobile-toggle {
  display: none;
}
.map-canvas-wrap {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  border: 2px solid rgba(110, 80, 34, 0.6);
  box-shadow:
    inset 0 0 0 4px rgba(243, 220, 162, 0.18),
    inset 0 0 80px rgba(110, 80, 34, 0.35),
    0 12px 30px -14px rgba(0, 0, 0, 0.55);
  background: #c9a04a;
}
.map-canvas-wrap.layer-roads {
  border-color: rgba(110, 80, 34, 0.62);
}
.map-canvas-wrap.layer-trade {
  border-color: rgba(166, 116, 45, 0.85);
  box-shadow:
    inset 0 0 0 4px rgba(240, 211, 137, 0.18),
    inset 0 0 80px rgba(121, 69, 21, 0.36),
    0 12px 30px -14px rgba(0, 0, 0, 0.58);
}
.map-canvas-wrap.layer-water {
  border-color: rgba(57, 119, 136, 0.86);
  box-shadow:
    inset 0 0 0 4px rgba(164, 216, 218, 0.15),
    inset 0 0 80px rgba(42, 94, 111, 0.38),
    0 12px 30px -14px rgba(0, 0, 0, 0.58);
}
.map-controls {
  position: absolute;
  z-index: 2;
  top: 10px;
  left: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  max-width: calc(100% - 20px);
  padding: 6px;
  border-radius: 4px;
  background: rgba(26, 18, 11, 0.82);
  border: 1px solid rgba(174, 139, 86, 0.3);
  color: var(--pm-parch);
}
.map-controls button {
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(236, 207, 145, 0.26);
  border-radius: 4px;
  background: linear-gradient(180deg, #d8bb7e, #a97a36);
  color: #241a10;
  font-weight: 700;
}
.map-controls span {
  display: inline-grid;
  place-items: center;
  min-width: 48px;
  font-family: var(--pm-font-num);
  font-size: calc(11px * var(--pm-text-scale));
  color: rgba(243, 220, 162, 0.82);
}
.layer-tabs {
  display: inline-flex;
  gap: 3px;
  padding-left: 4px;
  border-left: 1px solid rgba(236, 207, 145, 0.22);
}
.layer-tabs button {
  min-width: 44px;
  background: rgba(255, 245, 215, 0.12);
  color: rgba(243, 220, 162, 0.9);
}
.layer-tabs button.active {
  background: linear-gradient(180deg, #f0d389, #ba8440);
  color: #241a10;
}
.layer-tabs button:nth-child(2).active {
  background: linear-gradient(180deg, #e2bf75, #8f5f24);
}
.layer-tabs button:nth-child(3).active {
  background: linear-gradient(180deg, #9fd0cf, #3d7f91);
}
.layer-ribbon {
  position: absolute;
  z-index: 2;
  right: 12px;
  top: 12px;
  display: grid;
  gap: 2px;
  max-width: min(360px, calc(100% - 24px));
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(236, 207, 145, 0.28);
  background: rgba(31, 21, 13, 0.82);
  color: rgba(243, 220, 162, 0.9);
  pointer-events: none;
}
.layer-ribbon strong {
  font-family: var(--pm-font-display);
  font-size: calc(13px * var(--pm-text-scale));
  letter-spacing: 0.12em;
}
.layer-ribbon span {
  font-size: calc(11px * var(--pm-text-scale));
  color: rgba(243, 220, 162, 0.72);
}
.layer-ribbon.layer-trade {
  border-color: rgba(226, 191, 117, 0.46);
}
.layer-ribbon.layer-water {
  border-color: rgba(159, 208, 207, 0.46);
  color: rgba(204, 236, 232, 0.95);
}
.layer-ribbon.layer-water span {
  color: rgba(204, 236, 232, 0.74);
}
.map-canvas {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 10;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.map-canvas.dragging {
  cursor: grabbing;
}
.map-canvas.layer-trade {
  background: rgba(101, 63, 21, 0.12);
}
.map-canvas.layer-water {
  background: rgba(46, 105, 123, 0.12);
}
.traffic-lines {
  filter: drop-shadow(0 0 0.85px rgba(255, 245, 215, 0.45));
  opacity: 0.96;
}
.traffic-line-glow {
  opacity: 0.22;
}
.traffic-line-main {
  opacity: 0.95;
}
.node {
  cursor: pointer;
  transition: 0.2s ease;
}
.node.muted {
  opacity: 0.2;
}
.node.traffic-node {
  opacity: 1;
}
.node.traffic-node .node-symbol {
  filter: drop-shadow(0 0 0.8px rgba(255, 245, 215, 0.8));
}
.node:hover .node-symbol {
  filter: brightness(1.16) drop-shadow(0 0 0.65px rgba(243, 220, 162, 0.85));
}
.node.current .node-symbol {
  filter: drop-shadow(0 0 0.9px rgba(243, 220, 162, 0.95));
}
.node.selected .node-symbol {
  filter: brightness(1.12);
}
.node-shadow {
  fill: rgba(0, 0, 0, 0.28);
  transform: translate(0.2px, 0.28px);
}
.node-ink {
  fill: none;
  stroke: rgba(40, 20, 8, 0.9);
  stroke-width: 0.22;
  stroke-linejoin: round;
}
.node-detail {
  fill: none;
  stroke: rgba(40, 20, 8, 0.75);
  stroke-width: 0.2;
  stroke-linecap: round;
}
.node-rune {
  fill: rgba(250, 235, 184, 0.7);
  stroke: rgba(40, 20, 8, 0.55);
  stroke-width: 0.16;
}
.node-label {
  font-family: 'Cinzel', serif;
  font-size: 2.5px;
  fill: #2a1c11;
  font-weight: 600;
  letter-spacing: 0.08em;
  paint-order: stroke;
  stroke: rgba(243, 220, 162, 0.8);
  stroke-width: 0.45;
  stroke-linejoin: round;
}
.compass {
  animation: pmCandle 6s ease-in-out infinite;
}

.map-side {
  display: grid;
  gap: 10px;
  align-content: start;
}
.side-card h3 {
  margin: 0 0 8px;
  font-family: var(--pm-font-display);
  font-size: calc(14px * var(--pm-text-scale));
  letter-spacing: 0.12em;
  color: var(--pm-ink);
}
.loc-h {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.loc-name {
  font-family: var(--pm-font-display);
  font-size: calc(16px * var(--pm-text-scale));
  letter-spacing: 0.06em;
  color: var(--pm-ink);
}
.loc-desc {
  margin-top: 6px;
  font-size: calc(12px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
  line-height: 1.7;
}
.loc-distance {
  margin: 8px 0 0;
  font-size: calc(12px * var(--pm-text-scale));
  color: #6d4722;
}
.route-preview {
  display: grid;
  gap: 3px;
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid rgba(110, 80, 34, 0.28);
  background: rgba(255, 245, 215, 0.55);
}
.route-preview span {
  font-size: calc(11px * var(--pm-text-scale));
  color: rgba(82, 57, 32, 0.76);
}
.route-preview strong {
  font-size: calc(12px * var(--pm-text-scale));
  color: var(--pm-ink);
}
.route-preview em {
  font-style: normal;
  font-size: calc(11px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
}
.vehicle-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.vehicle-list span {
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid rgba(110, 80, 34, 0.22);
  background: rgba(255, 250, 232, 0.52);
  color: #6d4722;
  font-size: calc(11px * var(--pm-text-scale));
}
.coord-board {
  display: grid;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid rgba(110, 80, 34, 0.28);
  border-radius: 6px;
  background:
    linear-gradient(180deg, rgba(255, 248, 226, 0.68), rgba(225, 202, 154, 0.46)),
    rgba(255, 245, 215, 0.52);
}
.coord-board div {
  display: grid;
  gap: 2px;
}
.coord-board span {
  font-size: calc(10px * var(--pm-text-scale));
  letter-spacing: 0.08em;
  color: rgba(82, 57, 32, 0.72);
}
.coord-board strong {
  font-family: var(--pm-font-num);
  font-size: calc(12px * var(--pm-text-scale));
  color: var(--pm-ink);
}
.loc-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.loc-facts span,
.loc-subtags {
  border: 1px solid rgba(110, 80, 34, 0.24);
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.58);
  color: var(--pm-ink-soft);
  font-size: calc(11px * var(--pm-text-scale));
}
.loc-facts span {
  padding: 3px 6px;
}
.loc-subtags {
  margin-top: 8px;
  padding: 6px 8px;
}
.traffic-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.traffic-tags span {
  padding: 3px 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: rgba(255, 245, 215, 0.46);
  font-size: calc(11px * var(--pm-text-scale));
  font-weight: 700;
}
.pm-btn.full {
  width: 100%;
  margin-top: 10px;
}
.pm-btn.ghost {
  background: rgba(255, 245, 215, 0.42);
  color: var(--pm-ink-soft);
}
.route-group {
  display: grid;
  gap: 5px;
}
.route-group + .route-group {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed rgba(110, 80, 34, 0.22);
}
.route-group-head {
  display: grid;
  gap: 2px;
}
.route-group-head strong {
  color: var(--pm-ink);
  font-family: var(--pm-font-display);
  font-size: calc(13px * var(--pm-text-scale));
  letter-spacing: 0.08em;
}
.route-group-head span {
  color: rgba(82, 57, 32, 0.7);
  font-size: calc(11px * var(--pm-text-scale));
}
.adj-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 4px;
}
.adj-list li {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 245, 215, 0.55);
  border: 1px dashed rgba(110, 80, 34, 0.3);
}
.adj-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(40, 20, 8, 0.7);
}
.adj-name {
  color: var(--pm-ink);
  font-weight: 600;
  font-size: calc(13px * var(--pm-text-scale));
}
.adj-region {
  display: block;
  font-size: calc(11px * var(--pm-text-scale));
}
.adj-route {
  display: block;
  margin-top: 2px;
  font-size: calc(11px * var(--pm-text-scale));
  color: #6d4722;
  line-height: 1.45;
}
.adj-route.alt {
  color: rgba(82, 57, 32, 0.74);
}
.traffic-route-list {
  display: grid;
  gap: 8px;
}
.traffic-route-item {
  display: grid;
  gap: 4px;
  padding: 7px 8px;
  border: 1px dashed rgba(110, 80, 34, 0.28);
  border-radius: 8px;
  background: rgba(255, 245, 215, 0.5);
}
.traffic-route-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.traffic-route-head strong {
  color: var(--pm-ink);
  font-size: calc(13px * var(--pm-text-scale));
}
.traffic-route-head em {
  margin-left: auto;
  font-style: normal;
  color: rgba(82, 57, 32, 0.68);
  font-size: calc(11px * var(--pm-text-scale));
}
.traffic-route-item p {
  margin: 0;
  color: var(--pm-ink-soft);
  font-size: calc(11px * var(--pm-text-scale));
  line-height: 1.55;
}
.route-swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid rgba(40, 20, 8, 0.48);
}
.legend {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  font-size: calc(12px * var(--pm-text-scale));
  color: var(--pm-ink-soft);
}
.legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lg-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(40, 20, 8, 0.7);
}

@media (max-width: 1100px) {
  .map-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .map-layout {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .map-side {
    order: 1;
  }
  .map-mobile-toggle {
    order: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 40px;
  }
  .map-canvas-wrap {
    order: 3;
    display: none;
    display: grid;
    gap: 8px;
    overflow: visible;
    padding: 8px;
    border-radius: 8px;
  }
  .map-canvas-wrap:not(.mobile-open) {
    display: none;
  }
  .map-canvas-wrap.mobile-open {
    display: grid;
  }
  .map-controls,
  .layer-ribbon {
    position: static;
    max-width: none;
  }
  .map-controls {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 5px;
    padding: 6px;
    order: 1;
  }
  .map-controls button {
    min-width: 0;
    height: 30px;
    padding: 0 5px;
    font-size: calc(12px * var(--pm-text-scale));
  }
  .map-controls button[title='重置视野'] {
    grid-column: span 2;
  }
  .map-controls > span {
    grid-column: span 2;
    min-width: 0;
  }
  .layer-tabs {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding-left: 0;
    border-left: 0;
  }
  .layer-tabs button {
    min-width: 0;
  }
  .layer-ribbon {
    order: 2;
    padding: 7px 8px;
    background: rgba(31, 21, 13, 0.72);
  }
  .layer-ribbon span {
    display: none;
  }
  .map-canvas {
    order: 3;
    aspect-ratio: 1 / 1;
    border-radius: 6px;
  }
  .map-side {
    gap: 8px;
  }
  .side-card {
    padding: 10px;
  }
  .side-card h3 {
    margin-bottom: 6px;
  }
  .legend {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .adj-list li {
    grid-template-columns: 10px 1fr;
  }
  .adj-list .pm-btn {
    grid-column: 2;
    width: 100%;
  }
}
</style>
