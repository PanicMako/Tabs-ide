const TEST_DIRECTORY = /(^|\/)(__tests__|__snapshots__|__mocks__|tests?|specs?)(\/|$)/i;
const TEST_FILE_NAME =
  /(\.(test|spec)\.[a-z0-9]+$)|(_test\.[a-z0-9]+$)|(^test_[^/]*\.py$)|(\.browser\.[tj]sx?$)/i;
// Case-sensitive on purpose: FooTest.java is a test, Contest.java is not.
const TEST_CLASS_NAME = /[A-Za-z0-9]Tests?\.(java|kt|cs|swift)$/;

/** Whether a repository path looks like a test, snapshot or test fixture rather than product code. */
export function isTestFilePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return TEST_DIRECTORY.test(normalized) || TEST_FILE_NAME.test(name) || TEST_CLASS_NAME.test(name);
}
