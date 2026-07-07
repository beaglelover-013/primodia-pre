<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGameStore, formatCopper, type BuyActionItem, type ShopProduct } from '../stores/game';
import PmIcon from '../components/PmIcon.vue';

const game = useGameStore();

const cart = ref<Record<string, number>>({});
const freeShopQuery = ref('');
const shopActionText = ref('');

const activeShop = computed(() => {
  if (game.generatedShop && game.isCurrentShopLocation(game.generatedShop.name)) return game.generatedShop;
  return null;
});
watch(activeShop, shop => {
  if (shop) return;
  cart.value = {};
  shopActionText.value = '';
});

const visibleGoods = computed<ShopProduct[]>(() => {
  if (game.generatedShop && game.isCurrentShopLocation(game.generatedShop.name)) return game.generatedShopProducts;
  return [];
});

const cartItems = computed(() =>
  Object.entries(cart.value)
    .map(([id, qty]) => {
      const p = visibleGoods.value.find(x => x.id === id);
      return p ? { product: p, qty } : null;
    })
    .filter((x): x is { product: ShopProduct; qty: number } => x !== null),
);
const cartTotal = computed(() => cartItems.value.reduce((acc, x) => acc + x.product.priceCopper * x.qty, 0));

function currentSceneLabel() {
  const region = game.location.region || '当前区域';
  const place = game.location.place || '未知地点';
  return place.startsWith(`${region} 路`) ? place : `${region} 路 ${place}`;
}

function currentRegionName() {
  return game.location.region || '当前区域';
}

function streetEntranceLabel() {
  return game.location.place || currentSceneLabel();
}

function normalizeFreeShopQuery(query: string) {
  return query.trim();
}

async function requestFreeShop() {
  const query = freeShopQuery.value.trim();
  if (!query) return;
  const origin = currentSceneLabel();
  const target = normalizeFreeShopQuery(query);
  cart.value = {};
  const streetEntrance = activeShop.value ? `${currentRegionName()} 路 街坊` : streetEntranceLabel();
  game.clearGeneratedShop();
  const result = await game.executePseudoZeroAction({
    type: 'FIND_SHOP',
    target,
    origin,
    streetEntrance,
  }, {
    type: 'FIND_SHOP',
    title: `寻找商铺 路 ${target}`,
    aiHint: '请生成商铺正文和 <shop> 数据。',
    logText: `VISIT_SHOP 路 自由找店 路 ${target}`,
    autoSend: true,
  });
  if (!result.ok) {
    return;
  }
}

function quickFreeQuery(text: string) {
  freeShopQuery.value = text;
  requestFreeShop();
}

async function submitUnifiedShopAction() {
  const text = shopActionText.value.trim();
  if (!activeShop.value || !text) return;
  shopActionText.value = '';
  const unifiedResult = await game.executePseudoZeroAction({
    type: 'CUSTOM_ACTION',
    text,
    title: '补充行动',
  }, {
    type: 'CUSTOM_ACTION',
    title: '补充行动',
    aiHint: '请承接上一楼层正文末尾叙述。若玩家行动导致移动或离开，只通过 MVU 地点补丁表达；不要刷新货架，不要新增未结算的购买结果。',
    logText: `CUSTOM_ACTION 路 ${text.slice(0, 28)}${text.length > 28 ? '...' : ''}`,
    autoSend: true,
    preserveLocalState: true,
  });
  if (!unifiedResult.ok) return;
}

function add(p: ShopProduct) {
  if ((cart.value[p.id] ?? 0) >= p.stock) {
    game.pushLog('提示', `${p.name} 只剩 ${p.stock} 件。`);
    return;
  }
  cart.value = { ...cart.value, [p.id]: (cart.value[p.id] ?? 0) + 1 };
}

function dec(p: ShopProduct) {
  if (!cart.value[p.id]) return;
  const nextQty = cart.value[p.id] - 1;
  const nextCart = { ...cart.value };
  if (nextQty <= 0) delete nextCart[p.id];
  else nextCart[p.id] = nextQty;
  cart.value = nextCart;
}

async function checkout() {
  if (!activeShop.value || cartTotal.value === 0) return;
  const shopName = activeShop.value.name;
  const keeper = activeShop.value.keeper;
  const result = await game.executePseudoZeroAction({
    type: 'BUY_ITEMS',
    shopName,
    keeper,
    items: cartItems.value.map<BuyActionItem>(({ product, qty }) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      priceCopper: product.priceCopper,
      stock: product.stock,
      qty,
      tags: product.tags,
      desc: product.desc,
    })),
  }, {
    type: 'BUY_ITEMS',
    title: `在 ${shopName} 买东西`,
    logText: `BUY_ITEMS 路 ${cartItems.value.map(({ product, qty }) => `${product.name}×${qty}`).join('、')} 路 ${formatCopper(cartTotal.value)}`,
    autoSend: true,
    preserveLocalState: true,
  });

  if (!result.ok) {
    return;
  }
  cart.value = {};
}
</script>

<template>
  <section id="page-shop" class="shop-page">
    <div class="shop-board">
      <header class="shop-header">
        <div>
          <p class="kicker">{{ currentRegionName() }}街坊</p>
          <h1>街坊商铺</h1>
        </div>
        <span class="wallet">随身钱袋 · {{ game.walletText }}</span>
      </header>

      <div v-if="!activeShop" class="visit-layout">
        <section class="free-shop">
          <div>
            <p class="kicker">自由找店</p>
            <h2>你想去哪里</h2>
            <p>写“卖种子的摊位”“玻璃和木桶”“冒险补给”“奇怪杂货”都可以。AI 会生成店名、店主、环境与货架商品，前端负责把这些商品装进当前货架。</p>
          </div>
          <div class="free-input-row">
            <input
              v-model="freeShopQuery"
              class="free-input"
              placeholder="例如: 我想找卖种子和园艺工具的地方"
              @keydown.enter.prevent="requestFreeShop"
            />
            <button class="visit-btn" :disabled="game.isGenerating" @click="requestFreeShop">
              {{ game.isGenerating ? '正在带路' : '让 AI 带路' }}
            </button>
          </div>
          <div class="free-hints">
            <button @click="quickFreeQuery('卖种子和园艺工具的摊位')">种子摊</button>
            <button @click="quickFreeQuery('卖玻璃罐、木桶和酿造器具的杂货铺')">瓶桶器具</button>
            <button @click="quickFreeQuery('冒险者常去的补给店')">冒险补给</button>
          </div>
        </section>
      </div>

      <div v-else class="inside-layout">
        <aside class="shop-scene">
          <p class="kicker">当前所在</p>
          <h2>{{ activeShop.name }}</h2>
          <p class="keeper">{{ activeShop.keeper }}</p>
          <blockquote>“{{ activeShop.greeting }}”</blockquote>
          <p class="scene-text">{{ activeShop.atmosphere }}</p>
          <div class="shop-action-box">
            <label for="shop-action">店内行动</label>
            <textarea
              id="shop-action"
              v-model="shopActionText"
              rows="4"
              placeholder="例如: 问问店主这些货从哪里来，或试着讨价还价。"
              @keydown.ctrl.enter.prevent="submitUnifiedShopAction"
            ></textarea>
            <button class="talk-btn" :disabled="!shopActionText.trim() || game.isGenerating" @click="submitUnifiedShopAction">
              {{ game.isGenerating ? '叙事中' : '和店主交流' }}
            </button>
          </div>
          <div class="next-shop-box">
            <label for="next-shop">继续找店</label>
            <div class="next-shop-row">
              <input
                id="next-shop"
                v-model="freeShopQuery"
                class="free-input"
                placeholder="例如: 调料铺、肉铺、菜摊"
                @keydown.enter.prevent="requestFreeShop"
              />
              <button class="visit-btn" :disabled="!freeShopQuery.trim() || game.isGenerating" @click="requestFreeShop">
                {{ game.isGenerating ? '寻找中' : '找下一家' }}
              </button>
            </div>
          </div>
        </aside>

        <main class="goods-area">
          <div class="goods-head">
            <span>今日货架 · {{ visibleGoods.length }} 项</span>
            <span>购买使用随身钱袋，物品先进入个人行囊；回到酒馆后可以整理入库。</span>
          </div>
          <div class="goods-grid">
            <article v-for="p in visibleGoods" :key="p.id" class="good-card">
              <header>
                <div>
                  <h3>{{ p.name }}</h3>
                  <p :class="{ muted: !p.desc }">{{ p.desc || '未标注更多说明。' }}</p>
                </div>
                <strong>{{ formatCopper(p.priceCopper) }}</strong>
              </header>
              <div class="good-tags">
                <span class="category">{{ p.category }}</span>
                <span v-for="tag in p.tags" :key="tag">{{ tag }}</span>
              </div>
              <footer>
                <span>余 {{ p.stock }}</span>
                <div class="qty">
                  <button @click="dec(p)"><PmIcon name="minus" :size="11" /></button>
                  <b>{{ cart[p.id] ?? 0 }}</b>
                  <button @click="add(p)"><PmIcon name="plus" :size="11" /></button>
                </div>
              </footer>
            </article>
          </div>
        </main>

        <aside class="receipt">
          <h2>包货小票</h2>
          <ul>
            <li v-for="item in cartItems" :key="item.product.id">
              <span>{{ item.product.name }}</span>
              <b>×{{ item.qty }}</b>
              <strong>{{ formatCopper(item.product.priceCopper * item.qty) }}</strong>
            </li>
            <li v-if="cartItems.length === 0" class="empty">还没有拿起任何东西。</li>
          </ul>
          <div class="receipt-total">
            <span>合计</span>
            <strong>{{ formatCopper(cartTotal) }}</strong>
          </div>
          <button class="checkout-btn" :disabled="cartItems.length === 0 || game.isGenerating" @click="checkout">
            {{ game.isGenerating ? '叙事生成中' : '付钱并请 AI 叙述' }}
          </button>
        </aside>
      </div>
    </div>
  </section>
</template>

<style scoped>
.shop-page {
  padding: 20px 0 8px;
}
.shop-board {
  color: var(--pm-dark-text);
}
.shop-header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 16px;
  margin-bottom: 14px;
}
.kicker {
  margin: 0 0 4px;
  color: var(--pm-gold);
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.22em;
}
h1,
h2,
h3 {
  margin: 0;
  letter-spacing: 0;
}
h1 {
  color: var(--pm-dark-text);
  font-size: calc(26px * var(--pm-text-scale));
  font-weight: 500;
}
.wallet {
  padding: 7px 12px;
  color: var(--pm-dark-text);
  background: var(--pm-dark-panel-solid);
  border: 1px solid var(--pm-dark-panel-border);
  border-radius: 4px;
  font-size: calc(12px * var(--pm-text-scale));
}
.visit-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
}
.free-shop {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  padding: 16px;
  background: var(--pm-dark-panel);
  border: 1px solid var(--pm-dark-panel-border);
  border-radius: 5px;
  box-shadow: inset 0 1px 0 rgba(255, 239, 196, 0.08);
}
.free-shop h2 {
  color: var(--pm-dark-text);
  font-size: calc(19px * var(--pm-text-scale));
}
.free-shop p:not(.kicker) {
  margin: 5px 0 0;
  color: var(--pm-dark-muted);
  line-height: 1.65;
  font-size: calc(12px * var(--pm-text-scale));
}
.free-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}
.free-input {
  min-width: 0;
  padding: 9px 11px;
  color: var(--pm-dark-text);
  background: var(--pm-dark-panel-solid);
  border: 1px solid var(--pm-dark-panel-border);
  border-radius: 4px;
}
.free-input::placeholder {
  color: var(--pm-dark-faint);
}
.free-hints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.free-hints button,
.free-hints span {
  padding: 4px 9px;
  color: var(--pm-gold);
  background: var(--pm-dark-panel-soft);
  border: 1px solid var(--pm-line-soft);
  border-radius: 99px;
  font-size: calc(11px * var(--pm-text-scale));
}
.shop-scene h2,
.receipt h2 {
  color: var(--pm-dark-text);
  font-size: calc(17px * var(--pm-text-scale));
  font-weight: 500;
}
.good-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 24px;
}
.good-tags span {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 3px 8px 4px;
  color: color-mix(in srgb, var(--pm-ink) 88%, #241609 12%);
  background:
    linear-gradient(180deg, rgba(255, 252, 238, 0.98), rgba(239, 223, 184, 0.96));
  border: 1px solid color-mix(in srgb, var(--pm-edge) 82%, #5d3f18 18%);
  border-radius: 5px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 1px 0 rgba(58, 35, 12, 0.2);
  font-family: var(--pm-font-display);
  font-size: calc(10.5px * var(--pm-text-scale));
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
  white-space: nowrap;
}
.good-tags .category {
  gap: 5px;
  color: #fff6d8;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--pm-gold) 72%, #7b4c16 28%), color-mix(in srgb, var(--pm-brass) 66%, #5a3510 34%));
  border-color: color-mix(in srgb, var(--pm-edge) 54%, #2c1a08 46%);
  border-radius: 999px;
  font-weight: 800;
  box-shadow:
    inset 0 1px 0 rgba(255, 244, 191, 0.46),
    inset 0 -1px 0 rgba(50, 29, 9, 0.38),
    0 1px 2px rgba(58, 35, 12, 0.28);
  text-shadow: 0 1px 1px rgba(36, 19, 4, 0.55);
}
.good-tags .category::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.78;
  box-shadow: 0 0 0 2px rgba(255, 247, 207, 0.34);
}
.visit-btn,
.checkout-btn,
.talk-btn {
  color: var(--pm-text-on-gold);
  background: var(--pm-grad-gold);
  border: 1px solid var(--pm-line-soft);
  border-radius: 4px;
  padding: 7px 12px;
  font-weight: 600;
  white-space: nowrap;
}
.inside-layout {
  display: grid;
  grid-template-columns: 255px 1fr 260px;
  gap: 12px;
  align-items: start;
}
.shop-scene,
.receipt {
  padding: 14px;
  background: var(--pm-dark-panel);
  border: 1px solid var(--pm-dark-panel-border);
  border-radius: 5px;
}
.keeper {
  margin: 3px 0 12px;
  color: var(--pm-gold);
}
blockquote {
  margin: 0 0 12px;
  padding: 10px 12px;
  color: var(--pm-dark-text);
  background: var(--pm-dark-panel-solid);
  border-left: 2px solid var(--pm-gold);
  line-height: 1.65;
}
.scene-text {
  color: var(--pm-dark-muted);
  line-height: 1.75;
}
.shop-action-box {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--pm-line-faint);
}
.next-shop-box {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--pm-line-faint);
}
.next-shop-box label {
  color: var(--pm-gold);
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.16em;
}
.next-shop-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
}
.shop-action-box label {
  color: var(--pm-gold);
  font-family: var(--pm-font-display);
  font-size: calc(11px * var(--pm-text-scale));
  letter-spacing: 0.16em;
}
.shop-action-box textarea {
  width: 100%;
  min-height: 92px;
  resize: vertical;
  padding: 9px 10px;
  color: var(--pm-dark-text);
  background: var(--pm-dark-panel-solid);
  border: 1px solid var(--pm-dark-panel-border);
  border-radius: 4px;
  line-height: 1.6;
}
.shop-action-box textarea::placeholder {
  color: var(--pm-dark-faint);
}
.talk-btn {
  width: 100%;
}
.talk-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.goods-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 2px 10px;
  color: var(--pm-dark-muted);
  font-size: calc(12px * var(--pm-text-scale));
}
.goods-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(205px, 1fr));
  gap: 9px;
}
.good-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 12px;
  color: var(--pm-ink-soft);
  background:
    radial-gradient(circle at 12% 8%, rgba(255, 255, 250, 0.8), transparent 26%),
    var(--pm-grad-parchment);
  border: 1px solid var(--pm-edge-soft);
  border-radius: 4px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 250, 0.66);
}
.good-card header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.good-card header > div {
  min-width: 0;
}
.good-card h3 {
  color: var(--pm-ink);
  font-size: calc(15px * var(--pm-text-scale));
  font-weight: 600;
}
.good-card p {
  margin: 4px 0 0;
  min-height: 0;
  color: var(--pm-ink-dim);
  font-size: calc(11.5px * var(--pm-text-scale));
  line-height: 1.55;
  overflow: visible;
}
.good-card p.muted {
  color: var(--pm-ink-fade);
  font-style: italic;
}
.good-card header strong {
  color: var(--pm-gold-dim);
  font-size: calc(12px * var(--pm-text-scale));
  white-space: nowrap;
}
.good-card footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}
.good-card footer > span {
  color: var(--pm-ink-dim);
  font-size: calc(12px * var(--pm-text-scale));
}
.qty {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.qty button {
  width: 25px;
  height: 25px;
  display: grid;
  place-items: center;
  color: var(--pm-text-on-gold);
  background: var(--pm-grad-gold-soft);
  border: 1px solid var(--pm-edge-soft);
  border-radius: 3px;
}
.qty b {
  min-width: 16px;
  text-align: center;
}
.receipt ul {
  list-style: none;
  padding: 0;
  margin: 12px 0;
  display: grid;
  gap: 6px;
}
.receipt li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 7px;
  color: var(--pm-dark-muted);
  font-size: calc(12px * var(--pm-text-scale));
}
.receipt .empty {
  display: block;
  color: var(--pm-dark-faint);
  font-style: italic;
}
.receipt-total {
  display: flex;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--pm-line-soft);
  color: var(--pm-dark-text);
}
.checkout-btn {
  width: 100%;
  margin-top: 12px;
}
.checkout-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 1160px) {
  .inside-layout {
    grid-template-columns: 1fr;
  }
}
</style>
