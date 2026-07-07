import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { canMountSameFloorApp } from './utils/sameFloor';
import './style.scss';

let mounted = false;

function renderBootError(error: unknown) {
  const target = document.querySelector('#app') as HTMLElement | null;
  if (!target) return;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  target.innerHTML = `
    <div style="
      min-height: 320px;
      padding: 28px;
      color: #f5d7a8;
      background: #150d08;
      border: 1px solid rgba(198, 150, 78, .45);
      font-family: 'Noto Serif SC', serif;
      line-height: 1.8;
    ">
      <h2 style="margin: 0 0 12px; color: #ffd98a;">普利莫迪亚界面启动失败</h2>
      <p style="margin: 0 0 10px;">前端已经捕捉到启动错误，不再静默黑屏。</p>
      <pre style="white-space: pre-wrap; color: #ffe7bd;">${message}</pre>
    </div>
  `;
}

function mountApp() {
  if (mounted) return;
  if (!canMountSameFloorApp()) {
    console.warn('[primordia] 当前不是最新楼层，已阻止重复挂载大型前端。请让启动正则只匹配需要承载界面的最新楼层。');
    return;
  }
  mounted = true;
  try {
    createApp(App).use(createPinia()).mount('#app');
    console.info('[primordia] 普利莫迪亚编年录 · 界面已挂载');
  } catch (error) {
    mounted = false;
    console.error('[primordia] 普利莫迪亚界面启动失败', error);
    renderBootError(error);
  }
}

function mountWhenReady() {
  if (document.querySelector('#app')) {
    mountApp();
    return;
  }
  requestAnimationFrame(mountWhenReady);
}

const maybeJQuery = (globalThis as any).$;
if (typeof maybeJQuery === 'function') {
  maybeJQuery(mountWhenReady);
} else {
  mountWhenReady();
}

window.addEventListener('error', event => {
  renderBootError(event.error ?? event.message);
});

window.addEventListener('unhandledrejection', event => {
  renderBootError(event.reason);
});
