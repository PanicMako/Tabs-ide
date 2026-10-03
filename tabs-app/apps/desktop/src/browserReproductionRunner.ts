import type { BrowserReproductionStep, BrowserVerificationResult } from "@tabs/contracts";
import { prepareReproduction } from "@tabs/shared/browserReproduction";

type Step = BrowserReproductionStep;
export interface ReproductionDriver {
  checkControl(): void;
  navigate(url: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(key: string): Promise<void>;
}

/** This expression is evaluated in the guest page, never the application renderer. */
export function reproductionProbe(step: Step, mutate = false): string {
  return `(() => {
    const step = ${JSON.stringify(step)};
    const elements = document.querySelectorAll(step.selector);
    if (elements.length > 1) throw new Error('Selector matches multiple elements');
    const el = elements[0];
    if (!el) return false;
    const style = getComputedStyle(el);
    const visible = style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0;
    if (step.action === 'assertVisible') return visible;
    if (step.action === 'assertText') return (el.textContent || '').replace(/\\s+/g, ' ').trim() === (step.expectedValue || '').replace(/\\s+/g, ' ').trim();
    if (step.action === 'assertValue') return 'value' in el && el.value === step.expectedValue;
    if (!visible || el.matches(':disabled')) return false;
    if (${mutate}) {
      if (step.action === 'selectOption') {
        if (!(el instanceof HTMLSelectElement)) throw new Error('Expected a select element');
        if (![...el.options].some(option => option.value === step.value && !option.disabled)) return false;
        el.value = step.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (step.action === 'press') el.focus();
    }
    if (step.action === 'check' || step.action === 'uncheck') {
      if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) throw new Error('Expected a checkbox or radio');
      return el.checked === (step.action === 'check') ? 'satisfied' : 'click';
    }
    return true;
  })()`;
}

export async function runBrowserReproduction(
  driver: ReproductionDriver,
  url: string,
  rawSteps: readonly Step[],
  env: Record<string, string | undefined>,
  timeoutMs = 5000,
): Promise<BrowserVerificationResult> {
  let completedSteps = 0;
  let passedAssertions = 0;
  let steps: Step[];
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("Use an HTTP(S) initial URL without credentials.");
    steps = prepareReproduction(rawSteps, env);
  } catch (error) {
    return {
      status: "not_verified",
      message: error instanceof Error ? error.message : "Review the reproduction inputs.",
      completedSteps,
      passedAssertions,
    };
  }
  const waitFor = async (expression: string) => {
    const deadline = Date.now() + Math.min(Math.max(timeoutMs, 100), 15000);
    do {
      driver.checkControl();
      const result = await driver.evaluate(expression);
      driver.checkControl();
      if (result) return result;
      if (Date.now() >= deadline)
        throw new Error("Assertion or action target did not match before timeout.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (true);
  };
  try {
    driver.checkControl();
    await driver.navigate(url);
    for (const step of steps) {
      driver.checkControl();
      if (step.action === "goto") await driver.navigate(step.url!);
      else if (step.action.startsWith("assert")) {
        await waitFor(reproductionProbe(step));
        passedAssertions++;
      } else {
        const target = await waitFor(reproductionProbe(step));
        switch (step.action) {
          case "click":
            await driver.click(step.selector);
            break;
          case "fill":
            await driver.fill(step.selector, step.value!);
            break;
          case "press":
            await waitFor(reproductionProbe(step, true));
            await driver.press(step.key!);
            break;
          case "selectOption":
            await waitFor(reproductionProbe(step, true));
            break;
          case "check":
          case "uncheck":
            if (target !== "satisfied") await driver.click(step.selector);
            await waitFor(`(${reproductionProbe(step)}) === 'satisfied'`);
            break;
        }
      }
      driver.checkControl();
      completedSteps++;
    }
    return {
      status: "pass",
      message: `${passedAssertions} assertions passed; all ${completedSteps} steps completed.`,
      completedSteps,
      passedAssertions,
    };
  } catch (error) {
    const interrupted =
      error instanceof Error &&
      /interrupted|cancelled|human|closed|recreated|assignment/i.test(error.message);
    // Guest errors can contain input values. Export only the step number and outcome.
    return {
      status: interrupted ? "interrupted" : "fail",
      message: interrupted
        ? "Verification interrupted by control or session changes."
        : `Verification failed at step ${completedSteps + 1}. The action or assertion did not complete.`,
      completedSteps,
      passedAssertions,
    };
  }
}
