(function() {
  'use strict';

  // Pinyin matching is opt-out; toggle is wired from search-overlay.js based on user preference.
  let pinyinMatchingEnabled = true;

  function setPinyinMatchingEnabled(value) {
    pinyinMatchingEnabled = !!value;
  }

  function getPinyinHelpers() {
    if (typeof globalThis === 'undefined') return null;
    const indexApi = globalThis.PouncePinyinIndex;
    const matcherApi = globalThis.PouncePinyinMatcher;
    if (!indexApi || !matcherApi) return null;
    return { indexApi, matcherApi };
  }

  const SOURCE_PRIORITY = {
    tab: 0,
    history: 1,
    topSite: 2,
    bookmark: 3,
    open: 4,
    search: 5
  };

  const SOURCE_LABELS = {
    history: 'History',
    topSite: 'Top Site',
    bookmark: 'Bookmark',
    open: 'Open',
    search: 'Search'
  };

  const ICON_FALLBACKS = {
    tab: 'T',
    history: 'H',
    topSite: 'S',
    bookmark: 'B',
    open: 'O',
    search: 'S'
  };

  function safeUrl(value) {
    if (!value) {
      return null;
    }

    try {
      return new URL(value);
    } catch (error) {
      return null;
    }
  }

  function normalizeHostname(url) {
    if (!url) {
      return '';
    }

    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  }

  function normalizeHostWithPort(url) {
    const hostname = normalizeHostname(url);
    if (!hostname) {
      return '';
    }

    return url.port ? `${hostname}:${url.port}` : hostname;
  }

  function normalizeUrl(value) {
    const parsed = safeUrl(value);
    if (!parsed) {
      return String(value || '').trim().toLowerCase();
    }

    return `${parsed.protocol}//${getSearchableUrl(value)}`;
  }

  function getSearchableUrl(value) {
    const parsed = safeUrl(value);
    if (!parsed) {
      return '';
    }

    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${normalizeHostWithPort(parsed)}${pathname}${parsed.search}`;
  }

  function getDedupeKey(item) {
    const rawUrl = item?.url;
    const parsed = safeUrl(rawUrl);

    if (parsed) {
      return normalizeUrl(rawUrl);
    }

    const rawKey = String(rawUrl ?? '').trim().toLowerCase();
    if (rawKey) {
      return `invalid:${rawKey}`;
    }

    return `missing:${item?.type || 'unknown'}:${String(item?.id ?? item?.title ?? '')}`;
  }

  function formatDisplayUrl(value) {
    const parsed = safeUrl(value);
    if (!parsed) {
      return String(value || '');
    }

    const hostname = normalizeHostWithPort(parsed);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${hostname}${pathname}${parsed.search}`;
  }

  function getDisplayTitle(item) {
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (title) {
      return title;
    }

    const parsed = safeUrl(item?.url);
    if (parsed) {
      return normalizeHostname(parsed) || parsed.hostname;
    }

    return String(item?.url || '');
  }

  function getSourceLabel(type) {
    return SOURCE_LABELS[type] || '';
  }

  function getIconFallback(type) {
    return ICON_FALLBACKS[type] || '?';
  }

  function hasExplicitProtocol(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function looksLikeIpv4Host(value) {
    return /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/i.test(String(value || '').trim());
  }

  function looksLikeLocalhost(value) {
    return /^localhost(?::\d+)?(?:[/?#].*)?$/i.test(String(value || '').trim());
  }

  function looksLikeDomain(value) {
    return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?(?:[:/?#].*)?$/i.test(String(value || '').trim());
  }

  function hasInvalidPortSyntax(value) {
    const raw = String(value || '').trim();
    const hostPortMatch = raw.replace(/^https?:\/\//i, '').match(/^[^/?#]+/);
    if (!hostPortMatch) {
      return false;
    }

    const hostPort = hostPortMatch[0];
    const separatorIndex = hostPort.lastIndexOf(':');
    if (separatorIndex === -1) {
      return false;
    }

    const hostname = hostPort.slice(0, separatorIndex);
    const port = hostPort.slice(separatorIndex + 1);
    if (!hostname || hostname.includes(':')) {
      return false;
    }

    return !/^\d+$/.test(port);
  }

  function looksLikeDirectUrlInput(value) {
    const raw = String(value || '').trim();
    if (!raw || /\s/.test(raw)) {
      return false;
    }

    if (hasInvalidPortSyntax(raw)) {
      return false;
    }

    if (hasExplicitProtocol(raw)) {
      return true;
    }

    return looksLikeLocalhost(raw) || looksLikeIpv4Host(raw) || looksLikeDomain(raw);
  }

  function getQueryMatchData(query) {
    const raw = String(query || '').trim();
    const lowerRaw = raw.toLowerCase();
    const normalizedDirectUrl = looksLikeDirectUrlInput(raw) ? normalizeDirectUrlInput(raw) : '';
    if (normalizedDirectUrl && isValidDirectUrlCandidate(normalizedDirectUrl)) {
      const normalized = getSearchableUrl(normalizedDirectUrl);
      return {
        raw,
        lowerRaw,
        normalized,
        normalizedLower: normalized.toLowerCase()
      };
    }

    return {
      raw,
      lowerRaw,
      normalized: raw,
      normalizedLower: lowerRaw
    };
  }

  function normalizeDirectUrlInput(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    if (hasExplicitProtocol(raw)) {
      return raw;
    }

    if (looksLikeLocalhost(raw) || looksLikeIpv4Host(raw)) {
      return `http://${raw}`;
    }

    return `https://${raw}`;
  }

  function isIpv4Hostname(hostname) {
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(hostname || ''));
  }

  function isValidIpv4Hostname(hostname) {
    if (!isIpv4Hostname(hostname)) {
      return false;
    }

    return hostname.split('.').every((segment) => {
      const value = Number(segment);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }

  function isValidDomainHostname(hostname) {
    const labels = String(hostname || '').split('.');
    if (labels.length < 2) {
      return false;
    }

    return labels.every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i.test(label));
  }

  function isValidDirectUrlCandidate(value) {
    const parsed = safeUrl(value);
    if (!parsed || !/^https?:$/i.test(parsed.protocol)) {
      return false;
    }

    const hostname = normalizeHostname(parsed);
    if (!hostname) {
      return false;
    }

    if (hostname === 'localhost') {
      return true;
    }

    if (isIpv4Hostname(hostname)) {
      return isValidIpv4Hostname(hostname);
    }

    return isValidDomainHostname(hostname);
  }

  function getTypedCount(item) {
    return Number(item?.typedCount || 0);
  }

  function getVisitCount(item) {
    return Number(item?.visitCount || 0);
  }

  function getLastVisitTime(item) {
    return Number(item?.lastVisitTime || 0);
  }

  function getLastAccessed(item) {
    return Number(item?.lastAccessed || 0);
  }

  function getHistorySortKey(item) {
    return [
      getTypedCount(item),
      getVisitCount(item),
      getLastVisitTime(item)
    ];
  }

  function compareHistoryItems(a, b) {
    const [aTyped, aVisit, aLastVisit] = getHistorySortKey(a);
    const [bTyped, bVisit, bLastVisit] = getHistorySortKey(b);

    if (aTyped !== bTyped) return bTyped - aTyped;
    if (aVisit !== bVisit) return bVisit - aVisit;
    if (aLastVisit !== bLastVisit) return bLastVisit - aLastVisit;
    return 0;
  }

  function compareSourceSpecific(a, b) {
    if (a.type === 'tab' && b.type === 'tab') {
      const diff = getLastAccessed(b) - getLastAccessed(a);
      if (diff !== 0) return diff;
    }

    if (a.type === 'history' && b.type === 'history') {
      const historyDiff = compareHistoryItems(a, b);
      if (historyDiff !== 0) return historyDiff;
    }

    const aTitle = getDisplayTitle(a).toLowerCase();
    const bTitle = getDisplayTitle(b).toLowerCase();
    if (aTitle !== bTitle) {
      return aTitle.localeCompare(bTitle);
    }

    const aUrl = formatDisplayUrl(a.url).toLowerCase();
    const bUrl = formatDisplayUrl(b.url).toLowerCase();
    return aUrl.localeCompare(bUrl);
  }

  function splitQueryTokens(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];
    return trimmed.split(/\s+/);
  }

  function getItemSearchFields(item) {
    const parsed = safeUrl(item?.url);
    const titleSource = getDisplayTitle(item);
    const searchableUrl = parsed ? getSearchableUrl(item.url) : '';
    return {
      parsed,
      titleSource,
      titleLower: titleSource.toLowerCase(),
      hostname: parsed ? normalizeHostname(parsed) : '',
      searchableUrl,
      searchableUrlLower: searchableUrl.toLowerCase()
    };
  }

  function tierForToken(token, fields) {
    const queryData = getQueryMatchData(token);
    const { titleSource, titleLower, hostname, searchableUrl, searchableUrlLower } = fields;

    if (hostname && hostname.startsWith(queryData.normalizedLower)) return 0;
    if (hostname && hostname.includes(queryData.normalizedLower)) return 1;
    if (searchableUrl && searchableUrl.startsWith(queryData.normalized)) return 2;
    if (searchableUrlLower && searchableUrlLower.includes(queryData.normalizedLower)) return 3;
    if (titleLower && titleLower.startsWith(queryData.lowerRaw)) return 4;
    if (titleLower && titleLower.includes(queryData.lowerRaw)) return 5;

    // Pinyin fallback (tiers 6–10). Only invoked when:
    //   1) setting on
    //   2) token has at least one ASCII letter
    //   3) title contains at least one CJK character (verified by the index)
    if (!pinyinMatchingEnabled) return Number.POSITIVE_INFINITY;
    const helpers = getPinyinHelpers();
    if (!helpers) return Number.POSITIVE_INFINITY;
    if (!helpers.matcherApi.hasAsciiLetter(queryData.lowerRaw)) return Number.POSITIVE_INFINITY;
    const idx = helpers.indexApi.getPinyinIndex(titleSource);
    if (!idx || !idx.hasCjk) return Number.POSITIVE_INFINITY;

    const q = queryData.lowerRaw;
    if (helpers.matcherApi.matchFullStartsWith(q, idx))     return 6;
    if (helpers.matcherApi.matchInitialsStartsWith(q, idx)) return 7;
    if (helpers.matcherApi.matchFullIncludes(q, idx))       return 8;
    if (helpers.matcherApi.matchInitialsIncludes(q, idx))   return 9;
    if (helpers.matcherApi.matchMixed(queryData.raw, idx))  return 10;

    return Number.POSITIVE_INFINITY;
  }

  // Multi-token AND semantics: every whitespace-separated token must match;
  // the aggregate tier is the worst (largest) tier across tokens.
  function computeMatchTier(item, query) {
    const tokens = splitQueryTokens(query);
    const fields = getItemSearchFields(item);
    if (tokens.length === 0) return tierForToken('', fields);
    if (tokens.length === 1) return tierForToken(tokens[0], fields);

    let worst = -1;
    for (const token of tokens) {
      const t = tierForToken(token, fields);
      if (t === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
      if (t > worst) worst = t;
    }
    return worst;
  }

  function getMatchTier(item, query, tierCache) {
    if (tierCache && item && typeof item === 'object') {
      const cached = tierCache.get(item);
      if (cached !== undefined) return cached;
      const tier = computeMatchTier(item, query);
      tierCache.set(item, tier);
      return tier;
    }
    return computeMatchTier(item, query);
  }

  function getSearchOption(query) {
    return {
      type: 'search',
      id: 'web-search',
      title: `Search for "${query}"`,
      url: `search:${query}`,
      displayTitle: `Search for "${query}"`,
      displayUrl: 'Search with default search engine',
      sourceLabel: getSourceLabel('search'),
      iconFallback: getIconFallback('search'),
      isSearchOption: true
    };
  }

  function getOpenOption(query) {
    if (!looksLikeDirectUrlInput(query)) {
      return null;
    }

    const normalizedUrl = normalizeDirectUrlInput(query);
    if (!normalizedUrl || !isValidDirectUrlCandidate(normalizedUrl)) {
      return null;
    }

    return {
      type: 'open',
      id: `open:${normalizedUrl}`,
      title: `Open ${normalizedUrl}`,
      url: normalizedUrl,
      displayTitle: `Open ${normalizedUrl}`,
      displayUrl: normalizedUrl,
      sourceLabel: getSourceLabel('open'),
      iconFallback: getIconFallback('open'),
      isOpenOption: true
    };
  }

  function enrichResult(item) {
    return {
      ...item,
      displayTitle: getDisplayTitle(item),
      displayUrl: item.type === 'search' ? 'Search with default search engine' : formatDisplayUrl(item.url),
      sourceLabel: getSourceLabel(item.type),
      iconFallback: getIconFallback(item.type)
    };
  }

  function compareCandidates(a, b, query, tierCache) {
    if (query) {
      const aTier = getMatchTier(a, query, tierCache);
      const bTier = getMatchTier(b, query, tierCache);
      if (aTier !== bTier) {
        return aTier - bTier;
      }

      const aSource = SOURCE_PRIORITY[a.type] ?? 99;
      const bSource = SOURCE_PRIORITY[b.type] ?? 99;
      if (aSource !== bSource) {
        return aSource - bSource;
      }
    } else {
      const aSource = SOURCE_PRIORITY[a.type] ?? 99;
      const bSource = SOURCE_PRIORITY[b.type] ?? 99;
      if (aSource !== bSource) {
        return aSource - bSource;
      }
    }

    const sourceSpecific = compareSourceSpecific(a, b);
    if (sourceSpecific !== 0) {
      return sourceSpecific;
    }

    return String(a.id || '').localeCompare(String(b.id || ''));
  }

  function dedupeResults(results, query, tierCache) {
    const bestByUrl = new Map();

    for (const item of results) {
      if (item.type === 'search') {
        continue;
      }

      const key = getDedupeKey(item);
      const existing = bestByUrl.get(key);

      if (!existing || compareCandidates(item, existing, query, tierCache) < 0) {
        bestByUrl.set(key, item);
      }
    }

    return Array.from(bestByUrl.values());
  }

  function sortResults(results, query, tierCache) {
    return results.sort((a, b) => {
      if (!query) {
        const sourceDiff = (SOURCE_PRIORITY[a.type] ?? 99) - (SOURCE_PRIORITY[b.type] ?? 99);
        if (sourceDiff !== 0) {
          return sourceDiff;
        }

        const sourceSpecific = compareSourceSpecific(a, b);
        if (sourceSpecific !== 0) {
          return sourceSpecific;
        }

        return String(a.id || '').localeCompare(String(b.id || ''));
      }

      const aTier = getMatchTier(a, query, tierCache);
      const bTier = getMatchTier(b, query, tierCache);
      if (aTier !== bTier) {
        return aTier - bTier;
      }

      const sourceDiff = (SOURCE_PRIORITY[a.type] ?? 99) - (SOURCE_PRIORITY[b.type] ?? 99);
      if (sourceDiff !== 0) {
        return sourceDiff;
      }

      const sourceSpecific = compareSourceSpecific(a, b);
      if (sourceSpecific !== 0) {
        return sourceSpecific;
      }

      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function insertResultByRank(results, candidate, query, tierCache) {
    const rankedResults = Array.isArray(results) ? results.slice() : [];
    let insertIndex = rankedResults.length;

    for (let index = 0; index < rankedResults.length; index += 1) {
      if (compareCandidates(candidate, rankedResults[index], query, tierCache) < 0) {
        insertIndex = index;
        break;
      }
    }

    rankedResults.splice(insertIndex, 0, candidate);
    return rankedResults;
  }

  function getHighlightRangesForToken(text, token) {
    if (typeof text !== 'string' || text.length === 0) return [];
    if (typeof token !== 'string' || token.length === 0) return [];

    const literalRanges = [];
    if (token.length <= text.length) {
      const haystack = text.toLowerCase();
      const needle = token.toLowerCase();
      let pos = 0;
      while (pos <= haystack.length - needle.length) {
        const idx = haystack.indexOf(needle, pos);
        if (idx === -1) break;
        literalRanges.push([idx, idx + needle.length]);
        pos = idx + needle.length;
      }
    }
    if (literalRanges.length > 0) return literalRanges;

    // Pinyin fallback — same gates as tierForToken.
    if (!pinyinMatchingEnabled) return [];
    const helpers = getPinyinHelpers();
    if (!helpers) return [];
    if (!helpers.matcherApi.hasAsciiLetter(token)) return [];
    const idx = helpers.indexApi.getPinyinIndex(text);
    if (!idx || !idx.hasCjk) return [];

    const m = helpers.matcherApi.matchFullStartsWith(token, idx)
           || helpers.matcherApi.matchInitialsStartsWith(token, idx)
           || helpers.matcherApi.matchFullIncludes(token, idx)
           || helpers.matcherApi.matchInitialsIncludes(token, idx)
           || helpers.matcherApi.matchMixed(token, idx);
    return m ? m.ranges : [];
  }

  function mergeRanges(ranges) {
    if (ranges.length <= 1) return ranges;
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i += 1) {
      const last = merged[merged.length - 1];
      const cur = sorted[i];
      if (cur[0] <= last[1]) {
        if (cur[1] > last[1]) last[1] = cur[1];
      } else {
        merged.push(cur.slice());
      }
    }
    return merged;
  }

  function getHighlightRanges(text, query) {
    if (typeof text !== 'string' || text.length === 0) return [];
    if (typeof query !== 'string') return [];
    const tokens = splitQueryTokens(query);
    if (tokens.length === 0) return [];
    if (tokens.length === 1) return getHighlightRangesForToken(text, tokens[0]);

    const all = [];
    for (const token of tokens) {
      const ranges = getHighlightRangesForToken(text, token);
      for (const range of ranges) all.push(range);
    }
    return mergeRanges(all);
  }

  function rankResults(items, query = '', limit = 10) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const sourceItems = Array.isArray(items) ? items : [];
    // Memoize tier per item ref so sort/dedupe don't recompute it O(n log n) times.
    const tierCache = new Map();
    const eligibleItems = normalizedQuery
      ? sourceItems.filter((item) => getMatchTier(item, normalizedQuery, tierCache) !== Number.POSITIVE_INFINITY)
      : sourceItems;
    const deduped = dedupeResults(eligibleItems, normalizedQuery, tierCache);
    const enrichedDeduped = deduped.map((item) => {
      const enriched = enrichResult(item);
      // Carry tier across enrichment so the cache stays warm for the new object.
      if (normalizedQuery && tierCache.has(item)) {
        tierCache.set(enriched, tierCache.get(item));
      }
      return enriched;
    });
    const ranked = sortResults(enrichedDeduped, normalizedQuery, tierCache);
    const clipped = Number.isFinite(limit) ? ranked.slice(0, Math.max(0, limit)) : ranked;

    if (!normalizedQuery) {
      return clipped;
    }

    const trimmedQuery = String(query || '').trim();
    const openOption = getOpenOption(trimmedQuery);
    const resultsWithActions = openOption
      ? insertResultByRank(clipped, openOption, normalizedQuery, tierCache)
      : [...clipped];

    resultsWithActions.push(getSearchOption(trimmedQuery));
    return resultsWithActions;
  }

  const api = {
    rankResults,
    getDisplayTitle,
    getHighlightRanges,
    setPinyinMatchingEnabled
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.PounceSearchUtils = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
