const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_SEARCH_PREFERENCES, normalizeSearchPreferences } = require('../preferences.js');

test('missing search preferences default to enabled', () => {
  assert.deepEqual(normalizeSearchPreferences({}), DEFAULT_SEARCH_PREFERENCES);
  assert.deepEqual(normalizeSearchPreferences(undefined), DEFAULT_SEARCH_PREFERENCES);
});

test('explicit disabled search preferences are preserved', () => {
  assert.deepEqual(normalizeSearchPreferences({
    quickPickEnabled: false,
    highlightMatchesEnabled: false
  }), {
    quickPickEnabled: false,
    highlightMatchesEnabled: false
  });
});

test('non-boolean search preferences fall back to defaults', () => {
  assert.deepEqual(normalizeSearchPreferences({
    quickPickEnabled: 'false',
    highlightMatchesEnabled: null
  }), DEFAULT_SEARCH_PREFERENCES);
});
