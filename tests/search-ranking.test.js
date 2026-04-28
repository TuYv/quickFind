const test = require('node:test');
const assert = require('node:assert/strict');

const { rankResults, getDisplayTitle, getHighlightRanges } = require('../search-ranking.js');

test('browser export attaches the helper on globalThis', () => {
  assert.equal(globalThis.PounceSearchUtils.rankResults, rankResults);
  assert.equal(globalThis.PounceSearchUtils.getDisplayTitle, getDisplayTitle);
});

test('hostname prefix history matches outrank bookmarks and append search action', () => {
  const results = rankResults([
    {
      type: 'bookmark',
      id: 'bookmark:1',
      title: 'Google Docs',
      url: 'https://docs.google.com/document/d/1'
    },
    {
      type: 'history',
      id: 'history:1',
      title: '',
      url: 'https://www.google.com/',
      typedCount: 9,
      visitCount: 40,
      lastVisitTime: 500
    },
    {
      type: 'topSite',
      id: 'top-site:1',
      title: 'Google',
      url: 'https://www.google.com/'
    }
  ], 'goo', 10);

  assert.equal(results[0].type, 'history');
  assert.equal(results[0].displayUrl, 'google.com');
  assert.equal(results.at(-1).type, 'search');
});

test('enriched results expose source labels and icon fallbacks', () => {
  const results = rankResults([
    {
      type: 'tab',
      id: 9,
      title: 'Open Calendar',
      url: 'https://calendar.google.com/',
      lastAccessed: 200
    },
    {
      type: 'history',
      id: 'history:1',
      title: '',
      url: 'https://calendar.google.com/calendar/u/0/r',
      typedCount: 3,
      visitCount: 7,
      lastVisitTime: 100
    }
  ], '', 10);

  const tabResult = results.find((item) => item.type === 'tab');
  const historyResult = results.find((item) => item.type === 'history');

  assert.equal(tabResult.sourceLabel, '');
  assert.equal(tabResult.iconFallback, 'T');
  assert.equal(historyResult.sourceLabel, 'History');
  assert.equal(historyResult.iconFallback, 'H');
});

test('dedupe keeps the highest priority source for the same URL', () => {
  const results = rankResults([
    {
      type: 'bookmark',
      id: 'bookmark:1',
      title: 'GitHub Bookmark',
      url: 'https://github.com/'
    },
    {
      type: 'history',
      id: 'history:1',
      title: 'GitHub',
      url: 'https://github.com/',
      typedCount: 4,
      visitCount: 10,
      lastVisitTime: 200
    },
    {
      type: 'tab',
      id: 17,
      title: 'GitHub - Home',
      url: 'https://github.com/',
      lastAccessed: 1000
    }
  ], 'git', 10);

  const githubResults = results.filter((item) => item.type !== 'search');
  assert.equal(githubResults.length, 1);
  assert.equal(githubResults[0].type, 'tab');
});

test('missing urls do not collapse unrelated records during dedupe', () => {
  const results = rankResults([
    {
      type: 'bookmark',
      id: 'bookmark:1',
      title: 'Untitled Bookmark'
    },
    {
      type: 'bookmark',
      id: 'bookmark:2',
      title: 'Another Untitled Bookmark'
    }
  ], '', 10);

  assert.deepEqual(results.map((item) => item.title).sort(), [
    'Another Untitled Bookmark',
    'Untitled Bookmark'
  ]);
});

test('non-empty queries exclude non-matches before dedupe so matching duplicates survive', () => {
  const results = rankResults([
    {
      type: 'tab',
      id: 7,
      title: 'Dashboard',
      url: 'https://example.com/home',
      lastAccessed: 1000
    },
    {
      type: 'history',
      id: 'history:1',
      title: 'Docs Home',
      url: 'https://example.com/home',
      typedCount: 6,
      visitCount: 12,
      lastVisitTime: 300
    },
    {
      type: 'bookmark',
      id: 'bookmark:1',
      title: 'Example Bookmark',
      url: 'https://example.com/home'
    }
  ], 'docs', 10);

  const rankedResults = results.filter((item) => item.type !== 'search');
  assert.equal(rankedResults.length, 1);
  assert.equal(rankedResults[0].type, 'history');
  assert.equal(rankedResults[0].displayTitle, 'Docs Home');
});

test('non-empty queries rank stronger hostname matches ahead of weaker higher-priority sources', () => {
  const results = rankResults([
    {
      type: 'tab',
      id: 22,
      title: 'Docs Page',
      url: 'https://example.com/page',
      lastAccessed: 1200
    },
    {
      type: 'topSite',
      id: 'top-site:1',
      title: 'Docs',
      url: 'https://docs.example.net/'
    },
    {
      type: 'history',
      id: 'history:1',
      title: 'Docs Reference',
      url: 'https://docs.example.com/reference',
      typedCount: 8,
      visitCount: 14,
      lastVisitTime: 400
    },
    {
      type: 'bookmark',
      id: 'bookmark:1',
      title: 'Docs',
      url: 'https://docs.example.org/guide'
    }
  ], 'docs', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['history', 'topSite', 'bookmark', 'tab', 'search']
  );
});

test('non-empty queries use source priority only to break ties between equally strong matches', () => {
  const results = rankResults([
    {
      type: 'bookmark',
      id: 'bookmark:1',
      title: 'Workspace Docs',
      url: 'https://docs.example.com/bookmark'
    },
    {
      type: 'topSite',
      id: 'top-site:1',
      title: 'Workspace Docs',
      url: 'https://docs.example.com/top-site'
    },
    {
      type: 'history',
      id: 'history:1',
      title: 'Workspace Docs',
      url: 'https://docs.example.com/history',
      typedCount: 2,
      visitCount: 7,
      lastVisitTime: 200
    }
  ], 'docs', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['history', 'topSite', 'bookmark', 'search']
  );
});

test('title substring matches remain eligible as the weakest non-url match tier', () => {
  const results = rankResults([
    {
      type: 'tab',
      id: 1,
      title: 'Open Calendar',
      url: 'https://workspace.example.com/dashboard',
      lastAccessed: 1000
    },
    {
      type: 'history',
      id: 'history:1',
      title: 'Calendar Docs',
      url: 'https://docs.example.com/reference',
      typedCount: 3,
      visitCount: 9,
      lastVisitTime: 300
    }
  ], 'calendar', 10);

  const rankedResults = results.filter((item) => item.type !== 'search');

  assert.deepEqual(
    rankedResults.map((item) => item.type),
    ['history', 'tab']
  );
  assert.equal(rankedResults[0].displayTitle, 'Calendar Docs');
});

test('empty query keeps tabs first, then history, then top sites, then bookmarks', () => {
  const results = rankResults([
    {
      type: 'bookmark',
      id: 'bookmark:1',
      title: 'MDN',
      url: 'https://developer.mozilla.org/'
    },
    {
      type: 'topSite',
      id: 'top-site:1',
      title: 'Stack Overflow',
      url: 'https://stackoverflow.com/'
    },
    {
      type: 'history',
      id: 'history:1',
      title: 'Google',
      url: 'https://www.google.com/',
      typedCount: 12,
      visitCount: 30,
      lastVisitTime: 900
    },
    {
      type: 'tab',
      id: 99,
      title: 'Current Tab',
      url: 'https://example.com/',
      lastAccessed: 1200
    }
  ], '', 10);

  assert.deepEqual(results.map((item) => item.type), ['tab', 'history', 'topSite', 'bookmark']);
});

test('display title falls back to hostname when history title is empty', () => {
  assert.equal(
    getDisplayTitle({
      type: 'history',
      title: '',
      url: 'https://calendar.google.com/calendar/u/0/r'
    }),
    'calendar.google.com'
  );
});

test('results with different ports stay distinct during dedupe and display', () => {
  const results = rankResults([
    {
      type: 'history',
      id: 'history:3000',
      title: 'Dev 3000',
      url: 'https://example.com:3000/',
      typedCount: 6,
      visitCount: 10,
      lastVisitTime: 300
    },
    {
      type: 'history',
      id: 'history:4000',
      title: 'Dev 4000',
      url: 'https://example.com:4000/',
      typedCount: 5,
      visitCount: 9,
      lastVisitTime: 200
    }
  ], '', 10);

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.displayUrl), [
    'example.com:3000',
    'example.com:4000'
  ]);
});

test('complete domain input adds an open result before search', () => {
  const results = rankResults([], 'google.com', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['open', 'search']
  );
  assert.equal(results[0].url, 'https://google.com');
  assert.equal(results[0].displayTitle, 'Open https://google.com');
});

test('localhost and private ip inputs normalize to http', () => {
  const localhostResults = rankResults([], 'localhost:3000', 10);
  const ipResults = rankResults([], '192.168.1.1', 10);

  assert.equal(localhostResults[0].type, 'open');
  assert.equal(localhostResults[0].url, 'http://localhost:3000');
  assert.equal(ipResults[0].type, 'open');
  assert.equal(ipResults[0].url, 'http://192.168.1.1');
});

test('strong real url matches stay ahead of synthetic open results', () => {
  const results = rankResults([
    {
      type: 'history',
      id: 'history:1',
      title: 'Google',
      url: 'https://www.google.com/',
      typedCount: 10,
      visitCount: 30,
      lastVisitTime: 400
    }
  ], 'https://google.com', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['history', 'open', 'search']
  );
  assert.equal(results[1].url, 'https://google.com');
});

test('direct-url queries preserve path case when ranking real url matches', () => {
  const results = rankResults([
    {
      type: 'history',
      id: 'history:1',
      title: 'Case Path',
      url: 'https://example.com/FooBar',
      typedCount: 9,
      visitCount: 20,
      lastVisitTime: 200
    }
  ], 'https://example.com/FooBar', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['history', 'open', 'search']
  );
});

test('www-prefixed direct queries normalize before ranking real url matches', () => {
  const results = rankResults([
    {
      type: 'tab',
      id: 1,
      title: 'www.google.com notes',
      url: 'https://example.org/',
      lastAccessed: 100
    },
    {
      type: 'history',
      id: 'history:1',
      title: 'Google',
      url: 'https://www.google.com/',
      typedCount: 10,
      visitCount: 30,
      lastVisitTime: 400
    }
  ], 'www.google.com', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['history', 'open', 'tab', 'search']
  );
});

test('host-and-port direct queries outrank title-only matches', () => {
  const results = rankResults([
    {
      type: 'tab',
      id: 1,
      title: 'localhost:3000 notes',
      url: 'https://example.org/',
      lastAccessed: 100
    }
  ], 'localhost:3000', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['open', 'tab', 'search']
  );
  assert.equal(results[0].url, 'http://localhost:3000');
});

test('non-url search phrases do not create synthetic open results', () => {
  const results = rankResults([], 'openai api', 10);

  assert.deepEqual(results.map((item) => item.type), ['search']);
});

test('partial hostname input prefers real matches and does not force synthetic open', () => {
  const results = rankResults([
    {
      type: 'history',
      id: 'history:1',
      title: 'Google',
      url: 'https://www.google.com/',
      typedCount: 12,
      visitCount: 40,
      lastVisitTime: 500
    }
  ], 'googl', 10);

  assert.equal(results[0].type, 'history');
  assert.equal(results.some((item) => item.type === 'open'), false);
  assert.equal(results.at(-1).type, 'search');
});

test('direct-open action outranks weaker title-only matches', () => {
  const results = rankResults([
    {
      type: 'tab',
      id: 1,
      title: 'google.com notes',
      url: 'https://example.org/',
      lastAccessed: 200
    }
  ], 'google.com', 10);

  assert.deepEqual(
    results.map((item) => item.type),
    ['open', 'tab', 'search']
  );
  assert.equal(results[0].url, 'https://google.com');
});

test('invalid url-like inputs do not create synthetic open results', () => {
  const invalidQueries = [
    'https://',
    'https://?q=1',
    '256.256.256.256',
    '-foo.com',
    'foo-.com',
    'https://-foo.com'
  ];

  invalidQueries.forEach((query) => {
    const results = rankResults([], query, 10);

    assert.equal(
      results.some((item) => item.type === 'open'),
      false,
      `unexpected open result for ${query}`
    );
    assert.deepEqual(results.map((item) => item.type), ['search']);
  });
});

test('invalid protocol-only queries do not match existing urls by scheme text', () => {
  const sourceItems = [
    {
      type: 'history',
      id: 'history:https',
      title: 'Secure Example',
      url: 'https://example.com/',
      typedCount: 3,
      visitCount: 6,
      lastVisitTime: 200
    },
    {
      type: 'history',
      id: 'history:http',
      title: 'Local Example',
      url: 'http://localhost:3000/',
      typedCount: 2,
      visitCount: 5,
      lastVisitTime: 100
    }
  ];

  ['https://', 'http://'].forEach((query) => {
    const results = rankResults(sourceItems, query, 10);
    assert.deepEqual(results.map((item) => item.type), ['search']);
  });
});

test('trailing-dot direct url inputs still create open results', () => {
  const queries = ['example.com.', 'https://example.com.'];

  queries.forEach((query) => {
    const results = rankResults([], query, 10);

    assert.equal(results[0].type, 'open');
    assert.equal(results[0].url, 'https://example.com.');
    assert.equal(results.at(-1).type, 'search');
  });
});

test('empty-port url-like inputs do not create synthetic open results', () => {
  const invalidQueries = [
    'example.com:',
    'https://example.com:',
    'example.com:/foo'
  ];

  invalidQueries.forEach((query) => {
    const results = rankResults([], query, 10);

    assert.equal(
      results.some((item) => item.type === 'open'),
      false,
      `unexpected open result for ${query}`
    );
    assert.deepEqual(results.map((item) => item.type), ['search']);
  });
});

test('getHighlightRanges is exposed on the helper api', () => {
  assert.equal(globalThis.PounceSearchUtils.getHighlightRanges, getHighlightRanges);
});

test('getHighlightRanges returns single range for single occurrence', () => {
  assert.deepEqual(getHighlightRanges('GitHub', 'git'), [[0, 3]]);
});

test('getHighlightRanges returns all occurrences in order', () => {
  assert.deepEqual(getHighlightRanges('Google Docs - Google', 'go'), [[0, 2], [14, 16]]);
});

test('getHighlightRanges is case-insensitive but preserves source positions', () => {
  assert.deepEqual(getHighlightRanges('GitHub', 'GIT'), [[0, 3]]);
});

test('getHighlightRanges treats regex meta characters literally', () => {
  assert.deepEqual(getHighlightRanges('a.b.c', '.'), [[1, 2], [3, 4]]);
});

test('getHighlightRanges handles overlapping matches without infinite loop', () => {
  assert.deepEqual(getHighlightRanges('aaaa', 'aa'), [[0, 2], [2, 4]]);
});

test('getHighlightRanges returns [] for empty query', () => {
  assert.deepEqual(getHighlightRanges('GitHub', ''), []);
});

test('getHighlightRanges returns [] for whitespace-only query', () => {
  assert.deepEqual(getHighlightRanges('GitHub', '   '), []);
});

test('getHighlightRanges returns [] for null/undefined text', () => {
  assert.deepEqual(getHighlightRanges(null, 'git'), []);
  assert.deepEqual(getHighlightRanges(undefined, 'git'), []);
});

test('getHighlightRanges returns [] when query is longer than text', () => {
  assert.deepEqual(getHighlightRanges('git', 'github'), []);
});

test('getHighlightRanges returns [] when query is not found', () => {
  assert.deepEqual(getHighlightRanges('GitHub', 'foo'), []);
});

test('getHighlightRanges supports CJK substrings', () => {
  assert.deepEqual(getHighlightRanges('支付宝官网', '官网'), [[3, 5]]);
});

test('getHighlightRanges trims surrounding whitespace before matching', () => {
  assert.deepEqual(getHighlightRanges('GitHub', '  git  '), [[0, 3]]);
});
