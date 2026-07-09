const SAME_FLOOR_BODY_CLASS = 'primordia-same-floor-active';
const SAME_FLOOR_STYLE_ID = 'primordia-same-floor-style';
const SAME_FLOOR_HOST_CLASS = 'primordia-ui-host-floor';
const SAME_FLOOR_HOST_ATTR = 'data-primordia-ui-host-message-id';
const NATIVE_GENERATION_TIMEOUT_MS = 180_000;

export interface NativeNarrativeTurnOptions {
  createUserMessage?: boolean;
  userMessageData?: Record<string, any>;
  userMessageExtra?: Record<string, any>;
  onStreamingText?: (text: string) => void;
  /** Compatibility flag; same-floor mode still sends through ST's native chain. */
  forceGenerateStreaming?: boolean;
}

export interface NativeNarrativeTurnResult {
  assistantMessage: ChatMessage;
  userMessageId?: number;
  streamedText: string;
}

function stopEventListeners(stops: EventOnReturn[]) {
  stops.forEach(stop => {
    const maybeFunction = stop as unknown as () => void;
    if (typeof maybeFunction === 'function') maybeFunction();
    else stop.stop();
  });
  stops.length = 0;
}

function getParentDocument(): Document | undefined {
  try {
    const parentDocument = window.parent?.document;
    return parentDocument && parentDocument !== document ? parentDocument : undefined;
  } catch {
    return undefined;
  }
}

function getCurrentHostMessageId(): number | undefined {
  return typeof getCurrentMessageId === 'function' ? getCurrentMessageId() : undefined;
}

function isLatestMessageId(messageId: number) {
  return typeof getLastMessageId !== 'function' || messageId === getLastMessageId();
}

function findParentFloorElement(messageId: number, parentDocument = getParentDocument()): HTMLElement | undefined {
  return parentDocument?.querySelector<HTMLElement>(`#chat .mes[mesid="${messageId}"]`) ?? undefined;
}

function readRegisteredHostMessageId(parentDocument = getParentDocument()): number | undefined {
  const body = parentDocument?.body;
  const raw = body?.getAttribute(SAME_FLOOR_HOST_ATTR);
  const id = raw === null || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(id)) return undefined;
  if (!findParentFloorElement(id, parentDocument)) {
    body?.removeAttribute(SAME_FLOOR_HOST_ATTR);
    parentDocument?.querySelectorAll(`.${SAME_FLOOR_HOST_CLASS}`).forEach(element => {
      element.classList.remove(SAME_FLOOR_HOST_CLASS);
    });
    return undefined;
  }
  return id;
}

function registerHostFloor(messageId: number, parentDocument = getParentDocument()) {
  const body = parentDocument?.body;
  if (!body) return;
  body.setAttribute(SAME_FLOOR_HOST_ATTR, String(messageId));
  parentDocument?.querySelectorAll(`.${SAME_FLOOR_HOST_CLASS}`).forEach(element => {
    element.classList.remove(SAME_FLOOR_HOST_CLASS);
  });
  findParentFloorElement(messageId, parentDocument)?.classList.add(SAME_FLOOR_HOST_CLASS);
}

function buildSameFloorStyle(hostMessageId?: number): string {
  if (typeof hostMessageId === 'number') {
    return `
        body.${SAME_FLOOR_BODY_CLASS} #chat .mes[mesid]:not([mesid="${hostMessageId}"]) {
          display: none !important;
        }
        body.${SAME_FLOOR_BODY_CLASS} #chat .mes[mesid="${hostMessageId}"],
        body.${SAME_FLOOR_BODY_CLASS} #chat .mes.${SAME_FLOOR_HOST_CLASS} {
          display: flex !important;
        }
      `;
  }
  return `
        body.${SAME_FLOOR_BODY_CLASS} #chat .mes[mesid]:not(.${SAME_FLOOR_HOST_CLASS}) {
          display: none !important;
        }
        body.${SAME_FLOOR_BODY_CLASS} #chat .mes.${SAME_FLOOR_HOST_CLASS} {
          display: flex !important;
        }
      `;
}

function hideDisplayedFloor(messageId: number, hostMessageId = getCurrentHostMessageId()) {
  if (messageId === hostMessageId || typeof retrieveDisplayedMessage !== 'function') return;
  try {
    retrieveDisplayedMessage(messageId).closest('.mes').css('display', 'none');
  } catch (error) {
    console.warn(`[primordia] 隐藏楼层 #${messageId} 失败:`, error);
  }
}

function hideAllNonHostFloors(hostMessageId = getCurrentHostMessageId()) {
  if (typeof hostMessageId === 'number') registerHostFloor(hostMessageId);
  const lastMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : -1;
  for (let messageId = 0; messageId <= lastMessageId; messageId += 1) hideDisplayedFloor(messageId, hostMessageId);
}

function restoreAllFloors() {
  if (typeof retrieveDisplayedMessage !== 'function') return;
  const parentDocument = getParentDocument();
  parentDocument?.body?.removeAttribute(SAME_FLOOR_HOST_ATTR);
  parentDocument?.querySelectorAll(`.${SAME_FLOOR_HOST_CLASS}`).forEach(element => {
    element.classList.remove(SAME_FLOOR_HOST_CLASS);
  });
  const lastMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : -1;
  for (let messageId = 0; messageId <= lastMessageId; messageId += 1) {
    retrieveDisplayedMessage(messageId).closest('.mes').css('display', '');
  }
}

/**
 * 父 CSS 宿主锁：第一个成功挂载的前端楼层会成为 UI 宿主。
 * 后续楼层可正常生成和保存，但不能抢走宿主，避免 send 刷新中断前端。
 * 直接打开打包产物预览时没有楼层 API，仍允许挂载。
 */
export function canMountSameFloorApp() {
  const currentMessageId = getCurrentHostMessageId();
  if (currentMessageId === undefined) return true;
  const registeredHostMessageId = readRegisteredHostMessageId();
  if (registeredHostMessageId !== undefined) return currentMessageId === registeredHostMessageId;
  return isLatestMessageId(currentMessageId);
}

/**
 * 启用“原生楼层隐藏式伪同层”：只隐藏宿主页 DOM，不修改消息的 is_hidden 或聊天数据。
 */
export function activateSameFloorMode(): () => void {
  const parentDocument = getParentDocument();
  const body = parentDocument?.body;
  const hostMessageId = readRegisteredHostMessageId(parentDocument) ?? getCurrentHostMessageId();

  if (parentDocument?.head && body) {
    if (typeof hostMessageId === 'number') registerHostFloor(hostMessageId, parentDocument);
    let style = parentDocument.getElementById(SAME_FLOOR_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = parentDocument.createElement('style');
      style.id = SAME_FLOOR_STYLE_ID;
      parentDocument.head.append(style);
    }
    style.textContent = buildSameFloorStyle(hostMessageId);
    body.classList.add(SAME_FLOOR_BODY_CLASS);
  }

  hideAllNonHostFloors(hostMessageId);

  const stops: EventOnReturn[] = [];
  if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined') {
    stops.push(
      eventOn(tavern_events.USER_MESSAGE_RENDERED, messageId => hideDisplayedFloor(messageId, hostMessageId)),
      eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, messageId => hideDisplayedFloor(messageId, hostMessageId)),
      eventOn(tavern_events.MORE_MESSAGES_LOADED, () => hideAllNonHostFloors(hostMessageId)),
      eventOn(tavern_events.CHAT_CHANGED, () => hideAllNonHostFloors(hostMessageId)),
    );
  }

  console.info('[primordia] 已启用原生楼层隐藏式伪同层模式');

  return () => {
    stopEventListeners(stops);
    body?.classList.remove(SAME_FLOOR_BODY_CLASS);
    parentDocument?.getElementById(SAME_FLOOR_STYLE_ID)?.remove();
    restoreAllFloors();
  };
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string, parentDocument: Document) {
  const ParentTextArea = parentDocument.defaultView?.HTMLTextAreaElement;
  const setter = ParentTextArea ? Object.getOwnPropertyDescriptor(ParentTextArea.prototype, 'value')?.set : undefined;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;

  const EventConstructor = parentDocument.defaultView?.Event ?? Event;
  textarea.dispatchEvent(new EventConstructor('input', { bubbles: true }));
  textarea.dispatchEvent(new EventConstructor('change', { bubbles: true }));
}

function submitThroughNativeComposer(userText: string): boolean {
  const parentDocument = getParentDocument();
  if (!parentDocument) return false;

  const textarea = parentDocument.querySelector<HTMLTextAreaElement>('#send_textarea');
  const sendButton = parentDocument.querySelector<HTMLElement>('#send_but');
  if (!textarea || !sendButton || sendButton.matches(':disabled, .disabled')) return false;

  setNativeTextareaValue(textarea, userText, parentDocument);
  sendButton.click();
  return true;
}

function requestNativeRegeneration(): boolean {
  const parentDocument = getParentDocument();
  const regenerateButton = parentDocument?.querySelector<HTMLElement>('#option_regenerate');
  if (!regenerateButton || regenerateButton.matches(':disabled, .disabled')) return false;
  regenerateButton.click();
  return true;
}

async function readChatMessage(messageId: number, role: ChatMessage['role']): Promise<ChatMessage> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const message = getChatMessages(messageId, { role })[0];
    if (message) return message;
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  throw new Error(`原生楼层 #${messageId} 尚未写入聊天记录。`);
}

async function stampNativeUserMessage(messageId: number, options: NativeNarrativeTurnOptions) {
  const current = getChatMessages(messageId, { role: 'user' })[0];
  if (!current) return;
  await setChatMessages(
    [
      {
        message_id: messageId,
        data: options.userMessageData ?? current.data,
        extra: {
          ...(current.extra ?? {}),
          ...(options.userMessageExtra ?? {}),
        },
      },
    ],
    { refresh: 'none' },
  );
}

/**
 * 通过 ST 原生发送/重生成流程取得真实 assistant 楼层。只有父页面不可访问时，才回退到
 * createChatMessages + /trigger；生成结果始终由 ST 自己创建，前端不再伪造 assistant 楼层。
 */
export async function runNativeNarrativeTurn(
  userText: string,
  options: NativeNarrativeTurnOptions = {},
): Promise<NativeNarrativeTurnResult> {
  if (typeof eventOn !== 'function' || typeof tavern_events === 'undefined') {
    throw new Error('当前环境没有提供 ST 原生消息事件。');
  }

  const createUserMessage = options.createUserMessage !== false;
  const baselineMessageId = typeof getLastMessageId === 'function' ? getLastMessageId() : -1;
  const stops: EventOnReturn[] = [];
  let userMessageId = createUserMessage
    ? undefined
    : getChatMessages(`0-${Math.max(0, baselineMessageId)}`, { role: 'user' }).at(-1)?.message_id;
  let streamedText = '';
  let userStampPromise: Promise<void> = Promise.resolve();
  let timeoutId = 0;

  try {
    const assistantMessage = await new Promise<ChatMessage>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        callback();
      };

      const resolveAssistant = (messageId: number) => {
        void readChatMessage(messageId, 'assistant').then(
          message => finish(() => resolve(message)),
          error => finish(() => reject(error)),
        );
      };

      stops.push(
        eventOn(tavern_events.MESSAGE_SENT, messageId => {
          if (!createUserMessage || messageId <= baselineMessageId) return;
          userMessageId = messageId;
          hideDisplayedFloor(messageId);
          userStampPromise = stampNativeUserMessage(messageId, options);
        }),
        eventOn(tavern_events.MESSAGE_RECEIVED, messageId => {
          if (messageId <= baselineMessageId && createUserMessage) return;
          hideDisplayedFloor(messageId);
          resolveAssistant(messageId);
        }),
        eventOn(tavern_events.GENERATION_ENDED, messageId => {
          if (messageId <= baselineMessageId && createUserMessage) return;
          resolveAssistant(messageId);
        }),
        eventOn(tavern_events.GENERATION_STOPPED, () => {
          finish(() => reject(new Error('原生生成已停止。')));
        }),
        eventOn(tavern_events.STREAM_TOKEN_RECEIVED, token => {
          streamedText += token;
          options.onStreamingText?.(streamedText);
        }),
      );

      timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error('等待 ST 原生回复超时。')));
      }, NATIVE_GENERATION_TIMEOUT_MS);

      void (async () => {
        if (createUserMessage) {
          if (submitThroughNativeComposer(userText)) return;
          await createChatMessages(
            [
              {
                role: 'user',
                message: userText,
                data: options.userMessageData,
                extra: options.userMessageExtra,
              },
            ],
            { refresh: 'none' },
          );
          userMessageId = getLastMessageId();
          await triggerSlash('/trigger await=false');
          return;
        }

        if (requestNativeRegeneration()) return;
        await triggerSlash('/regenerate await=false');
      })().catch(error => finish(() => reject(error)));
    });

    await userStampPromise;
    return { assistantMessage, userMessageId, streamedText };
  } finally {
    window.clearTimeout(timeoutId);
    stopEventListeners(stops);
  }
}
