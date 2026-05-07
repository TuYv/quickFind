const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SEARCH_PREFERENCES,
  ALLOWED_RESULTS_LIMITS,
  normalizeSearchPreferences
} = require('../preferences.js');

test('missing search preferences default to enabled', () => {
  assert.deepEqual(normalizeSearchPreferences({}), DEFAULT_SEARCH_PREFERENCES);
  assert.deepEqual(normalizeSearchPreferences(undefined), DEFAULT_SEARCH_PREFERENCES);
});

test('explicit disabled search preferences are preserved', () => {
  assert.deepEqual(normalizeSearchPreferences({
    quickPickEnabled: false,
    highlightMatchesEnabled: false,
    pinyinMatchingEnabled: false
  }), {
    quickPickEnabled: false,
    highlightMatchesEnabled: false,
    pinyinMatchingEnabled: false,
    resultsLimit: DEFAULT_SEARCH_PREFERENCES.resultsLimit
  });
});

test('non-boolean search preferences fall back to defaults', () => {
  assert.deepEqual(normalizeSearchPreferences({
    quickPickEnabled: 'false',
    highlightMatchesEnabled: null
  }), DEFAULT_SEARCH_PREFERENCES);
});

test('resultsLimit accepts only allowed values', () => {
  for (const value of ALLOWED_RESULTS_LIMITS) {
    assert.equal(normalizeSearchPreferences({ resultsLimit: value }).resultsLimit, value);
    assert.equal(normalizeSearchPreferences({ resultsLimit: String(value) }).resultsLimit, value);
  }
});

test('invalid resultsLimit falls back to default', () => {
  for (const value of [0, 5, 100, 'ten', null, undefined, NaN, true]) {
    assert.equal(
      normalizeSearchPreferences({ resultsLimit: value }).resultsLimit,
      DEFAULT_SEARCH_PREFERENCES.resultsLimit
    );
  }
});
