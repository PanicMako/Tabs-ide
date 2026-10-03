export interface BrowserReproductionStep {
  id: string;
  action:
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
  selector: string;
  value?: string | undefined;
  url?: string | undefined;
  key?: string | undefined;
  placeholder?: string | undefined;
  expectedValue?: string | undefined;
  isFragile?: boolean | undefined;
  reviewed?: boolean | undefined;
}

export interface BrowserVerificationResult {
  status: "pass" | "fail" | "interrupted" | "not_verified";
  message: string;
  afterScreenshotPath?: string | undefined;
  completedSteps: number;
  passedAssertions: number;
}
