(function() {
  'use strict';

  const ALLOWED_RESULTS_LIMITS = Object.freeze([10, 20, 50]);

  const DEFAULT_SEARCH_PREFERENCES = Object.freeze({
    quickPickEnabled: true,
    pinyinMatchingEnabled: true,
    resultsLimit: 10
  });

  const SEARCH_PREFERENCE_KEYS = Object.freeze(Object.keys(DEFAULT_SEARCH_PREFERENCES));

  function normalizeResultsLimit(value) {
    const num = Number(value);
    return ALLOWED_RESULTS_LIMITS.includes(num) ? num : DEFAULT_SEARCH_PREFERENCES.resultsLimit;
  }

  function normalizeSearchPreferences(values) {
    const source = values && typeof values === 'object' ? values : {};
    return SEARCH_PREFERENCE_KEYS.reduce((preferences, key) => {
      if (key === 'resultsLimit') {
        preferences[key] = normalizeResultsLimit(source[key]);
      } else {
        preferences[key] = typeof source[key] === 'boolean'
          ? source[key]
          : DEFAULT_SEARCH_PREFERENCES[key];
      }
      return preferences;
    }, {});
  }

  const api = {
    DEFAULT_SEARCH_PREFERENCES,
    SEARCH_PREFERENCE_KEYS,
    ALLOWED_RESULTS_LIMITS,
    normalizeResultsLimit,
    normalizeSearchPreferences
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.PouncePreferences = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
