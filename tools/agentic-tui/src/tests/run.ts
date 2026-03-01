import { actionBarTests } from "../tui/action-bar.test.js";
import { domainSkillTests } from "../tui/domain-skills.test.js";
import { shortcutHandlerTests } from "../tui/tui-event-handlers.test.js";
import { sessionActionTests } from "../tui/tui-session-actions.test.js";
import { parserIntentTests, type TuiTestCase } from "../parser/intent-parser.test.js";

async function run() {
  const tests: TuiTestCase[] = [
    ...parserIntentTests,
    ...actionBarTests,
    ...domainSkillTests,
    ...shortcutHandlerTests,
    ...sessionActionTests
  ];
  let pass = 0;
  let fail = 0;

  // eslint-disable-next-line no-console
  console.log(`Running ${tests.length} agentic-tui tests...\n`);

  for (const test of tests) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await test.fn();
      pass += 1;
      // eslint-disable-next-line no-console
      console.log(`ok - ${test.name}`);
    } catch (error) {
      fail += 1;
      // eslint-disable-next-line no-console
      console.log(`not ok - ${test.name}`);
      // eslint-disable-next-line no-console
      console.log(`  ${error instanceof Error ? error.stack || error.message : String(error)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\npass ${pass}`);
  // eslint-disable-next-line no-console
  console.log(`fail ${fail}`);

  if (fail > 0) process.exit(1);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
