# OrangeHRM read-only demo

Target: https://opensource-demo.orangehrmlive.com

Use only the public demo account Admin / admin123. Do not create, update or delete employees.

1. Open the login page; enter the public credentials and submit.
2. Assert the URL is the dashboard and the Dashboard heading is visible.
3. Navigate using PIM. Assert the employee-list URL, Employee Information heading and Search button.
4. Navigate using Time. Assert the employee-timesheet URL and Select Employee heading.

The smoke test intentionally fails if the shared demo changes language, credentials or behavior. Diagnose that failure; do not skip it or weaken the expected result.

For generated tests, validate every locator in the live page before saving. Keep ordered actions and assertions. Propose repairs for review; never convert an application defect into a passing or skipped test.
