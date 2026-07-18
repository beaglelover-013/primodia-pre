<script setup lang="ts">
import { computed } from 'vue';
/**
 * 普利莫迪亚 SVG 图标库
 * 全部为手写描线图标, 符合中世纪/羊皮卷美学,
 * 避免使用 Emoji 与现代赛博风。
 */
interface Props {
  name: string;
  size?: number | string;
  stroke?: number;
}
const props = withDefaults(defineProps<Props>(), {
  size: 18,
  stroke: 1.5,
});

const sizePx = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size));
</script>

<template>
  <svg
    :width="sizePx"
    :height="sizePx"
    viewBox="0 0 24 24"
    fill="none"
    :stroke-width="stroke"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="pm-icon"
    aria-hidden="true"
  >
    <!-- 酒馆: 房屋 + 招牌 -->
    <template v-if="name === 'tavern'">
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-5h4v5" />
      <path d="M3 8h6" />
      <circle cx="6" cy="6" r="0.6" fill="currentColor" stroke="none" />
    </template>

    <!-- 库房与灶台: 锅 -->
    <template v-else-if="name === 'pot'">
      <path d="M4 9h16v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V9z" />
      <path d="M2 9h20" />
      <path d="M8 6c.5-1 1.5-1 1.5-2.2" />
      <path d="M12 6c.5-1 1.5-1 1.5-2.2" />
      <path d="M16 6c.5-1 1.5-1 1.5-2.2" />
    </template>

    <!-- 人物羁绊: 双人头像 -->
    <template v-else-if="name === 'people'">
      <circle cx="9" cy="9" r="3" />
      <path d="M3 20c.5-3.5 3-5 6-5s5.5 1.5 6 5" />
      <circle cx="17" cy="7" r="2.4" />
      <path d="M14 14c1-1.6 2.5-2.2 4-2.2 2.5 0 4 1.8 4 4" />
    </template>

    <!-- 大地图: 折叠地图 -->
    <template v-else-if="name === 'map'">
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </template>

    <!-- 街坊商铺: 钱袋 -->
    <template v-else-if="name === 'coin'">
      <path d="M9 4h6l1.5 3c2 1 3.5 3.5 3.5 6.5 0 4-3 7-8 7s-8-3-8-7c0-3 1.5-5.5 3.5-6.5L9 4z" />
      <path d="M12 10v6" />
      <path d="M14 11.5c-1-1-3-1-3 .5 0 1.5 3 1.5 3 3 0 1.5-2 1.5-3 .5" />
    </template>

    <!-- 账单: 卷轴 -->
    <template v-else-if="name === 'ledger'">
      <path d="M5 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5z" />
      <path d="M5 4a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2" />
      <path d="M5 20a2 2 0 0 1-2-2v0a2 2 0 0 1 2-2" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </template>

    <!-- 农田与酒窖: 麦穗 -->
    <template v-else-if="name === 'farm'">
      <path d="M12 22V8" />
      <path d="M12 8c-2-2-4-2-5 0 1 2 3 2 5 0z" />
      <path d="M12 8c2-2 4-2 5 0-1 2-3 2-5 0z" />
      <path d="M12 12c-2-2-4-2-5 0 1 2 3 2 5 0z" />
      <path d="M12 12c2-2 4-2 5 0-1 2-3 2-5 0z" />
      <path d="M12 16c-2-2-4-2-5 0 1 2 3 2 5 0z" />
      <path d="M12 16c2-2 4-2 5 0-1 2-3 2-5 0z" />
    </template>

    <!-- 通用视线图标 -->
    <template v-else-if="name === 'abyss'">
      <path d="M3 12c3-5 6-7 9-7s6 2 9 7c-3 5-6 7-9 7s-6-2-9-7z" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </template>

    <!-- 系统与设置: 齿轮 -->
    <template v-else-if="name === 'gear'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"
      />
    </template>

    <!-- 银币 / 货币图标 -->
    <template v-else-if="name === 'silver'">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8" />
      <path d="M14 10.5c-1-1-3-1-3 .5 0 1.5 3 1.5 3 3 0 1.5-2 1.5-3 .5" />
    </template>

    <!-- 太阳 / 日历 -->
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.9 4.9l1.4 1.4" />
      <path d="M17.7 17.7l1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.9 19.1l1.4-1.4" />
      <path d="M17.7 6.3l1.4-1.4" />
    </template>

    <!-- 月 -->
    <template v-else-if="name === 'moon'">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </template>

    <!-- 云 -->
    <template v-else-if="name === 'cloud'">
      <path d="M7 18a5 5 0 0 1-1-9.9A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-1 8.5H7z" />
    </template>

    <!-- 雨 -->
    <template v-else-if="name === 'rain'">
      <path d="M7 14a5 5 0 0 1-1-9.9A6 6 0 0 1 18 5.5a4.5 4.5 0 0 1-1 8.5H7z" />
      <path d="M8 18l-1 3" />
      <path d="M12 18l-1 3" />
      <path d="M16 18l-1 3" />
    </template>

    <!-- 雪 -->
    <template v-else-if="name === 'snow'">
      <path d="M7 13a5 5 0 0 1-1-9.9A6 6 0 0 1 18 4.5a4.5 4.5 0 0 1-1 8.5H7z" />
      <path d="M9 18v2" />
      <path d="M13 18v2" />
      <path d="M17 18v2" />
      <path d="M8 19l2 1" />
      <path d="M14 19l2 1" />
    </template>

    <!-- 位置 -->
    <template v-else-if="name === 'pin'">
      <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </template>

    <!-- 烛火 -->
    <template v-else-if="name === 'candle'">
      <path d="M12 2c2 2 0 4 0 5s2 1 2 4a3 3 0 1 1-6 0c0-3 4-2 4-5s-2-2 0-4z" />
      <path d="M8 22h8" />
      <path d="M9 18v4" />
      <path d="M15 18v4" />
    </template>

    <!-- 加号 -->
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </template>

    <!-- 减号 -->
    <template v-else-if="name === 'minus'">
      <path d="M5 12h14" />
    </template>

    <!-- 关闭 -->
    <template v-else-if="name === 'x'">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </template>

    <!-- 火 (烹饪) -->
    <template v-else-if="name === 'fire'">
      <path
        d="M12 3c1 3 4 4 4 8a4 4 0 1 1-8 0c0-2 1-3 2-4 0 0-1-2 0-3 1 2 2 2 2-1z"
      />
    </template>

    <!-- 锤 / 建造 -->
    <template v-else-if="name === 'hammer'">
      <path d="M14.5 8.5L3 20l1 1 11.5-11.5" />
      <path d="M13 7l4-4 4 4-3 3-4-4z" />
    </template>

    <!-- 心 / 羁绊 -->
    <template v-else-if="name === 'heart'">
      <path
        d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"
      />
    </template>

    <!-- 礼物 -->
    <template v-else-if="name === 'gift'">
      <path d="M20 8H4v3h16V8z" />
      <path d="M4 11v9h16v-9" />
      <path d="M12 8v12" />
      <path
        d="M8 8s-1.5-3 0-4 4 1 4 4c0-3 2.5-5 4-4s0 4 0 4"
      />
    </template>

    <!-- 对话 -->
    <template v-else-if="name === 'chat'">
      <path d="M21 12a8 8 0 0 1-11.3 7.3L4 21l1.7-5.7A8 8 0 1 1 21 12z" />
    </template>

    <!-- 翻页箭头 -->
    <template v-else-if="name === 'chevron-right'">
      <path d="M9 6l6 6-6 6" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <path d="M15 6l-6 6 6 6" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="M6 9l6 6 6-6" />
    </template>

    <!-- 加快经营 (时间) -->
    <template v-else-if="name === 'hourglass'">
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M6 3c0 5 6 5 6 9s-6 4-6 9" />
      <path d="M18 3c0 5-6 5-6 9s6 4 6 9" />
    </template>

    <!-- 骰子 / 随机 -->
    <template v-else-if="name === 'dice'">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.5" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
    </template>

    <!-- 信件 / 引擎日志 -->
    <template v-else-if="name === 'scroll'">
      <path d="M4 5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6" />
      <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2" />
      <path d="M8 7h7" />
      <path d="M8 11h7" />
      <path d="M8 15h5" />
    </template>

    <!-- 复制 -->
    <template v-else-if="name === 'copy'">
      <path d="M8 8h11v13H8z" />
      <path d="M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" />
    </template>

    <!-- 发送 -->
    <template v-else-if="name === 'send'">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </template>

    <!-- 检查/勾 -->
    <template v-else-if="name === 'check'">
      <path d="M4 12l5 5L20 6" />
    </template>

    <!-- 刷新 / 重新扫描 -->
    <template v-else-if="name === 'refresh'">
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.5 10A7 7 0 0 0 6.4 6.4L4 9" />
      <path d="M5.5 14a7 7 0 0 0 12.1 3.6L20 15" />
    </template>
    <!-- 风格符号: 角花 -->
    <template v-else-if="name === 'flourish'">
      <path d="M2 12c4 0 4-4 8-4s4 4 8 4 4-4 4-4" />
      <circle cx="2" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="22" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </template>

    <!-- 默认 fallback: 菱形 -->
    <template v-else>
      <path d="M12 3l9 9-9 9-9-9 9-9z" />
    </template>
  </svg>
</template>

<style scoped>
.pm-icon {
  display: inline-block;
  flex: none;
  vertical-align: middle;
}
</style>
