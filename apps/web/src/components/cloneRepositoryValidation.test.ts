import { describe, expect, it } from "vitest";

import { validateCloneSource } from "./cloneRepositoryValidation";

describe("validateCloneSource", () => {
  it.each([
    "https://github.com/tabs/repository.git",
    "ssh://git@github.com/tabs/repository.git",
    "git@github.com:tabs/repository.git",
    "../local-repository",
    "C:\\work\\repository",
  ])("accepts Git clone source %s", (source) => {
    expect(validateCloneSource(source)).toBeNull();
  });

  it.each(["", "--upload-pack=malicious", "repository", "javascript:alert(1)", "bad\nurl"])(
    "rejects unsafe or incomplete source %s",
    (source) => expect(validateCloneSource(source)).not.toBeNull(),
  );
});
