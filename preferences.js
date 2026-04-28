(function() {
  'use strict';

  const DEFAULT_SEARCH_PREFERENCES = Object.freeze({
    quickPickEnabled: true,
    highlightMatchesEnabled: true
  });

  const SEARCH_PREFERENCE_KEYS = Object.freeze(Object.keys(DEFAULT_SEARCH_PREFERENCES));

  function normalizeSearchPreferences(values) {
    const source = values && typeof values === 'object' ? values : {};
    return SEARCH_PREFERENCE_KEYS.reduce((preferences, key) => {
      preferences[key] = typeof source[key] === 'boolean'
        ? source[key]
        : DEFAULT_SEARCH_PREFERENCES[key];
      return preferences;
    }, {});
  }

  const api = {
    DEFAULT_SEARCH_PREFERENCES,
    SEARCH_PREFERENCE_KEYS,
    normalizeSearchPreferences
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.PouncePreferences = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
