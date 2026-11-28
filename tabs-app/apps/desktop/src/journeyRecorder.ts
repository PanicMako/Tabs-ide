import type { BrowserQuickActionSemantic } from "@tabs/contracts";
import { isBrowserQuickActionSemantic } from "@tabs/shared/browserQuickAction";
import { generateReproductionPlaywrightCode } from "@tabs/shared/browserReproduction";
import { QUICK_ACTION_SELECTOR_SCRIPT } from "./browserQuickActionDom";
import { BrowserCdpCoordinator } from "./browserCdpCoordinator";
import type { WebContents } from "electron";

export type JourneyAction =
  | "goto"
  | "click"
  | "fill"
  | "selectOption"
  | "check"
  | "uncheck"
  | "press"
  | "assertVisible"
  | "assertText"
  | "assertValue";

export type JourneyStep = {
  id?: string | undefined;
  action: JourneyAction;
  selector?: string | undefined;
  semantic?: BrowserQuickActionSemantic | undefined;
  value?: string | undefined;
  url?: string | undefined;
  key?: string | undefined;
  tag?: string | undefined;
  placeholder?: string | undefined;
  expectedValue?: string | undefined;
  isFragile?: boolean | undefined;
  reviewed?: boolean | undefined;
  locatorKey?: string | undefined;
  locatorEntryId?: string | undefined;
};

export function journeyCode(url: string, steps: readonly JourneyStep[]): string {
  return generateReproductionPlaywrightCode(
    url,
    steps.map((step, index) => ({
      ...step,
      id: step.id ?? `step-${index + 1}`,
      selector: step.selector ?? "",
    })),
    "Recorded journey",
  );
}

function safeUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Record an HTTP(S) page");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

type RecordedJourney = {
  code: string;
  count: number;
  steps: JourneyStep[];
  initialUrl: string;
};

const QUICK_ACTION_RECORDING_PRIVACY_SCRIPT = String.raw`
  // This history belongs to one guest document and never crosses the binding.
  const observedFragments = new Set();
  let reflectionHistoryFull = false;
  const reflectionWords = value => value.normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const rememberValue = value => {
    if (value.length <= 4096) {
      const words = reflectionWords(value);
      for (const word of words) observedFragments.add(word);
      if (words.length > 1) observedFragments.add(words.join(''));
      if (observedFragments.size <= 512) return;
    }
    // Older reflected text can still be on the page. Suppress metadata on overflow.
    reflectionHistoryFull = true;
    observedFragments.clear();
  };
  const isReflected = value => {
    if (reflectionHistoryFull) return true;
    if (observedFragments.size === 0) return false;
    return reflectionWords(value).some(word => {
      if (observedFragments.has(word)) return true;
      if (word.length < 4) return false;
      for (const fragment of observedFragments) {
        if (fragment.includes(word) || (fragment.length >= 4 && word.includes(fragment))) return true;
      }
      return false;
    });
  };

  const privateField = element => element.matches('input[autocomplete~="username" i]') || protectedField(element);
  const blockedQuickActionElement = element => privateField(element) ||
    (element.form && [...element.form.elements].some(privateField));
  const observeQuickActionInput = element => {
    if (reflectionHistoryFull || !element.matches('input,textarea,select') || blockedQuickActionElement(element)) return;
    if (element.localName === 'select') {
      for (const option of element.selectedOptions) {
        rememberValue(option.value);
        if (reflectionHistoryFull) break;
      }
    } else if (element.localName === 'textarea' ||
        /^(?:text|search|email|tel|url|number|date|month|week|time|datetime-local)$/.test(element.type)) {
      rememberValue(element.value);
    }
  };

  const recordedQuickActionSelector = element => {
    if (!(element instanceof HTMLElement)) return '';
    const uniqueSafeSelector = (value, selector) => value && safeSelector(selector) &&
      !isReflected(value) && document.querySelectorAll(selector).length === 1;
    for (const attribute of ['data-testid', 'data-test', 'data-cy']) {
      const value = element.getAttribute(attribute);
      const selector = '[' + attribute + '="' + value + '"]';
      if (uniqueSafeSelector(value, selector)) return selector;
    }
    const idSelector = '#' + element.id;
    if (uniqueSafeSelector(element.id, idSelector)) return idSelector;
    const name = element.getAttribute('name');
    const nameSelector = element.localName + '[name="' + name + '"]';
    return uniqueSafeSelector(name, nameSelector) ? nameSelector : '';
  };
  const recordedQuickActionSemantic = element => {
    const semantic = semanticFor(element);
    // A group can distinguish identical controls. Dropping only the group would broaden the match.
    return semantic && !isReflected(semantic.name) && (!semantic.group || !isReflected(semantic.group))
      ? semantic : undefined;
  };
`;

export class JourneyRecorder {
  private steps: JourneyStep[] = [];
  private scriptId: string | undefined;
  private unsubscribeInterruption: (() => void) | undefined;
  private interrupted = false;
  private active = false;
  private stopPending: Promise<RecordedJourney> | undefined;
  private quickAction = false;
  private initialUrl = "";
  private lastNavigatedUrl = "";
  private get isolatedWorld(): string {
    return `${this.binding}World`;
  }

  private readonly binding = `__tabsJourney${crypto.randomUUID().replaceAll("-", "")}`;
  constructor(
    private readonly contents: WebContents,
    private readonly coordinator = new BrowserCdpCoordinator(contents),
  ) {}

  private readonly message = (
    _event: unknown,
    method: string,
    params: { name?: string; payload?: string },
  ) => {
    if (
      !this.active ||
      method !== "Runtime.bindingCalled" ||
      params.name !== this.binding ||
      !params.payload ||
      params.payload.length > 4096 ||
      this.steps.length >= 500
    )
      return;
    try {
      const step = JSON.parse(params.payload) as JourneyStep;
      const validActions: JourneyAction[] = [
        "goto",
        "click",
        "fill",
        "check",
        "uncheck",
        "selectOption",
        "press",
        "assertVisible",
        "assertText",
        "assertValue",
      ];
      if (!validActions.includes(step.action)) return;
      if (
        this.quickAction &&
        !["click", "fill", "selectOption", "check", "uncheck"].includes(step.action)
      )
        return;
      if (typeof step.selector !== "string" && typeof step.url !== "string") return;
      if (step.selector && step.selector.length > 2000) return;
      const semantic =
        this.quickAction && isBrowserQuickActionSemantic(step.semantic) ? step.semantic : undefined;

      // Deduplicate consecutive fill on identical selector
      if (
        step.action === "fill" &&
        this.steps.length > 0 &&
        this.steps[this.steps.length - 1]?.action === "fill" &&
        this.steps[this.steps.length - 1]?.selector === step.selector &&
        JSON.stringify(this.steps[this.steps.length - 1]?.semantic) === JSON.stringify(semantic)
      ) {
        return;
      }

      // Only structural fields are copied. Typed text, defaults and placeholders sent by the page
      // (value, expectedValue, placeholder) are never stored; a fill keeps only its locator.
      this.steps.push({
        id: `step-${this.steps.length + 1}`,
        action: step.action,
        selector: step.selector ?? "",
        ...(semantic ? { semantic } : {}),
        key: this.quickAction ? undefined : step.key,
        tag: this.quickAction && typeof step.tag === "string" ? step.tag : undefined,
        url: this.quickAction ? undefined : step.url,
        isFragile: Boolean(step.isFragile),
        reviewed: !step.isFragile,
      });
    } catch {
      /* Ignore malformed events from page content. */
    }
  };

  private readonly navigated = (_event: unknown, url: string) => {
    if (!this.active || this.steps.length >= 500) return;
    try {
      const sUrl = safeUrl(url);
      if (this.quickAction) {
        if (new URL(sUrl).origin !== this.initialUrl) {
          this.interrupted = true;
          void this.stop();
        }
        return;
      }
      if (sUrl !== this.lastNavigatedUrl) {
        this.lastNavigatedUrl = sUrl;
        this.steps.push({
          id: `step-${this.steps.length + 1}`,
          action: "goto",
          url: sUrl,
          selector: "",
          reviewed: true,
        });
      }
    } catch {
      if (this.quickAction) {
        this.interrupted = true;
        void this.stop();
      }
    }
  };

  private readonly destroyed = () => {
    void this.stop();
  };

  async start(quickAction = false): Promise<void> {
    if (this.stopPending) await this.stopPending;
    if (this.active) throw new Error("A journey is already recording");
    this.quickAction = quickAction;
    this.initialUrl = safeUrl(this.contents.getURL());
    if (quickAction) this.initialUrl = new URL(this.initialUrl).origin;
    this.lastNavigatedUrl = this.initialUrl;
    this.steps = [];
    this.active = true;
    this.interrupted = false;
    this.unsubscribeInterruption = this.coordinator.onInterrupted(() => {
      this.interrupted = true;
      void this.stop();
    });
    try {
      await this.coordinator.withSession("recording", async (debug) => {
        debug.on("message", this.message);
        this.contents.once("destroyed", this.destroyed);
        if (typeof (this.contents as any).on === "function") {
          this.contents.on("did-navigate", this.navigated);
          this.contents.on("did-navigate-in-page", this.navigated);
        }
        await debug.sendCommand("Runtime.enable");
        await debug.sendCommand("Page.enable");
        await debug.sendCommand("Runtime.addBinding", {
          name: this.binding,
          ...(quickAction ? { executionContextName: this.isolatedWorld } : {}),
        });

        const source = `(() => {
        if (window !== window.top || window[${JSON.stringify(this.binding + "Stop")}]) return;
        ${quickAction ? QUICK_ACTION_SELECTOR_SCRIPT + QUICK_ACTION_RECORDING_PRIVACY_SCRIPT : ""}
        const quickAction = ${quickAction};
        const cleanups = [];
        let lastFilledElement = null;
        let lastFilledTime = 0;
        const listen = (type, handler) => { document.addEventListener(type, handler, true); cleanups.push(() => document.removeEventListener(type, handler, true)); };
        const getSelector = (element) => {
          if (!element || element.nodeType !== 1) return { selector: '', isFragile: false };
          const testIdAttribute = ['data-testid', 'data-test', 'data-cy'].find(name => element.hasAttribute(name));
          if (testIdAttribute) {
            const sel = '[' + testIdAttribute + '="' + CSS.escape(element.getAttribute(testIdAttribute)) + '"]';
            try { if (document.querySelectorAll(sel).length === 1) return { selector: sel, isFragile: false }; } catch {}
          }
          if (element.id && !/[-_][0-9a-f]{6,}/i.test(element.id) && !/^[0-9]/.test(element.id)) {
            const sel = '#' + CSS.escape(element.id);
            try { if (document.querySelectorAll(sel).length === 1) return { selector: sel, isFragile: false }; } catch {}
          }
          if (['input', 'select', 'textarea'].includes(element.tagName.toLowerCase()) && element.getAttribute('name')) {
            const sel = element.tagName.toLowerCase() + '[name="' + CSS.escape(element.getAttribute('name')) + '"]';
            try { if (document.querySelectorAll(sel).length === 1) return { selector: sel, isFragile: false }; } catch {}
          }
          if (element.getAttribute('aria-label')) {
            const sel = '[aria-label="' + CSS.escape(element.getAttribute('aria-label')) + '"]';
            try { if (document.querySelectorAll(sel).length === 1) return { selector: sel, isFragile: false }; } catch {}
          }
          if (element.getAttribute('placeholder')) {
            const sel = '[placeholder="' + CSS.escape(element.getAttribute('placeholder')) + '"]';
            try { if (document.querySelectorAll(sel).length === 1) return { selector: sel, isFragile: false }; } catch {}
          }
          const parts = [];
          for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
            const siblings = node.parentElement ? [...node.parentElement.children].filter(s => s.localName === node.localName) : [node];
            parts.unshift(node.localName + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
          }
          return { selector: parts.join(' > '), isFragile: true };
        };

        const emit = (action, element, extra) => {
          if (!element) return;
          if (quickAction && blockedQuickActionElement(element)) return;
          const info = quickAction
            ? { selector: recordedQuickActionSelector(element), semantic: recordedQuickActionSemantic(element),
                isFragile: false, tag: element.localName }
            : getSelector(element);
          window[${JSON.stringify(this.binding)}](JSON.stringify({ action, ...info, ...extra }));
        };

        if (quickAction) listen('input', event => {
          if (event.isTrusted && event.target instanceof Element) observeQuickActionInput(event.target);
        });

        listen('click', event => {
          if (!event.isTrusted || !(event.target instanceof Element)) return;
          const el = event.target.closest('button,a[href],[role="button"],input[type="submit"],input[type="button"],summary');
          if (el) emit('click', el);
        });

        listen('change', event => {
          if (!event.isTrusted || !(event.target instanceof Element)) return;
          const el = event.target;
          if (quickAction) observeQuickActionInput(el);
          if (el.matches('input[type="checkbox"],input[type="radio"]')) emit(el.checked ? 'check' : 'uncheck', el);
          else if (el.matches('select')) emit('selectOption', el);
          else if (el.matches('input,textarea')) {
            lastFilledElement = el;
            lastFilledTime = Date.now();
            emit('fill', el);
          }
        });

        listen('keydown', event => {
          if (!event.isTrusted || event.key !== 'Enter' || !(event.target instanceof Element) || !event.target.matches('input,textarea')) return;
          const el = event.target;
          const isRecentFill = el === lastFilledElement && (Date.now() - lastFilledTime < 1000);
          if (!isRecentFill) {
            emit('fill', el);
          }
          emit('press', el, { key: 'Enter' });
        });

        window[${JSON.stringify(this.binding + "Stop")}] = () => {
          cleanups.forEach(dispose => dispose());
          if (quickAction) observedFragments.clear();
          delete window[${JSON.stringify(this.binding + "Stop")}];
        };
      })();`;
        const script = await debug.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
          source,
          ...(quickAction ? { worldName: this.isolatedWorld, runImmediately: true } : {}),
        });
        this.scriptId = script.identifier;
        if (!quickAction) await this.contents.executeJavaScript(source);
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  status() {
    return {
      recording: this.active,
      interrupted: this.interrupted,
      count: this.steps.length,
      limit: 500,
    };
  }

  stop(): Promise<RecordedJourney> {
    return (this.stopPending ??= this.finish().finally(() => {
      this.stopPending = undefined;
    }));
  }

  private async finish(): Promise<RecordedJourney> {
    this.active = false;
    this.unsubscribeInterruption?.();
    this.unsubscribeInterruption = undefined;
    const debug = this.contents.debugger;
    debug.removeListener("message", this.message);
    this.contents.removeListener("destroyed", this.destroyed);
    if (typeof (this.contents as any).removeListener === "function") {
      this.contents.removeListener("did-navigate", this.navigated);
      this.contents.removeListener("did-navigate-in-page", this.navigated);
    }
    if (!this.contents.isDestroyed()) {
      const cleanup = `window[${JSON.stringify(this.binding + "Stop")}]?.()`;
      if (!this.quickAction) await this.contents.executeJavaScript(cleanup).catch(() => undefined);
      await this.coordinator
        .withSession("recording", async (debug) => {
          if (this.scriptId)
            await debug
              .sendCommand("Page.removeScriptToEvaluateOnNewDocument", {
                identifier: this.scriptId,
              })
              .catch(() => undefined);
          if (this.quickAction) {
            // The named world may belong to a new document after same-origin navigation.
            try {
              const { frameTree } = await debug.sendCommand("Page.getFrameTree");
              const { executionContextId } = await debug.sendCommand("Page.createIsolatedWorld", {
                frameId: frameTree.frame.id,
                worldName: this.isolatedWorld,
              });
              await debug.sendCommand("Runtime.evaluate", {
                expression: cleanup,
                contextId: executionContextId,
              });
            } catch {
              // A closed or changed document releases the in-page listeners as well.
            }
          }
          await debug
            .sendCommand("Runtime.removeBinding", { name: this.binding })
            .catch(() => undefined);
        })
        .catch(() => undefined);
    }
    this.scriptId = undefined;
    const steps = [...this.steps];
    return {
      code: journeyCode(this.initialUrl, steps),
      count: steps.length,
      steps,
      initialUrl: this.initialUrl,
    };
  }
}
