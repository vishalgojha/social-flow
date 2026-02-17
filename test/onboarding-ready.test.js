const assert = require('node:assert/strict');
const { nextActions, readyLines } = require('../lib/ui/onboarding-ready');

module.exports = [
  {
    name: 'onboarding ready panel returns exactly three next actions',
    fn: () => {
      const rows = nextActions();
      assert.equal(Array.isArray(rows), true);
      assert.equal(rows.length, 3);
      assert.equal(rows.every((x) => x && x.label && x.command), true);
    }
  },
  {
    name: 'onboarding ready lines include ready state and profile',
    fn: () => {
      const lines = readyLines({ profile: 'agency-a' });
      assert.equal(lines[0], 'You are now ready.');
      assert.equal(lines[1], 'Profile: agency-a');
      assert.equal(lines[2], 'Next 3 actions:');
      assert.equal(lines.filter((x) => /^\d+\./.test(x)).length, 3);
    }
  }
];
