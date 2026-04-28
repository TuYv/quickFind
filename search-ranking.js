(function() {
  'use strict';

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

  function getMatchTier(item, query) {
    const queryData = getQueryMatchData(query);
    const parsed = safeUrl(item?.url);
    const title = getDisplayTitle(item).toLowerCase();
    const hostname = parsed ? normalizeHostname(parsed) : '';
    const searchableUrl = parsed ? getSearchableUrl(item.url) : '';
    const searchableUrlLower = searchableUrl.toLowerCase();

    if (hostname && hostname.startsWith(queryData.normalizedLower)) {
      return 0;
    }

    if (hostname && hostname.includes(queryData.normalizedLower)) {
      return 1;
    }

    if (searchableUrl && searchableUrl.startsWith(queryData.normalized)) {
      return 2;
    }

    if (searchableUrlLower && searchableUrlLower.includes(queryData.normalizedLower)) {
      return 3;
    }

    if (title && title.startsWith(queryData.lowerRaw)) {
      return 4;
    }

    if (title && title.includes(queryData.lowerRaw)) {
      return 5;
    }

    return Number.POSITIVE_INFINITY;
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

  function compareCandidates(a, b, query) {
    if (query) {
      const aTier = getMatchTier(a, query);
      const bTier = getMatchTier(b, query);
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

  function dedupeResults(results, query) {
    const bestByUrl = new Map();

    for (const item of results) {
      if (item.type === 'search') {
        continue;
      }

      const key = getDedupeKey(item);
      const existing = bestByUrl.get(key);

      if (!existing || compareCandidates(item, existing, query) < 0) {
        bestByUrl.set(key, item);
      }
    }

    return Array.from(bestByUrl.values());
  }

  function sortResults(results, query) {
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

      const aTier = getMatchTier(a, query);
      const bTier = getMatchTier(b, query);
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

  function insertResultByRank(results, candidate, query) {
    const rankedResults = Array.isArray(results) ? results.slice() : [];
    let insertIndex = rankedResults.length;

    for (let index = 0; index < rankedResults.length; index += 1) {
      if (compareCandidates(candidate, rankedResults[index], query) < 0) {
        insertIndex = index;
        break;
      }
    }

    rankedResults.splice(insertIndex, 0, candidate);
    return rankedResults;
  }

  function getHighlightRanges(text, query) {
    if (typeof text !== 'string' || text.length === 0) {
      return [];
    }
    if (typeof query !== 'string') {
      return [];
    }
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0 || trimmedQuery.length > text.length) {
      return [];
    }

    const haystack = text.toLowerCase();
    const needle = trimmedQuery.toLowerCase();
    const ranges = [];
    let pos = 0;

    while (pos <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, pos);
      if (idx === -1) break;
      ranges.push([idx, idx + needle.length]);
      // Non-overlapping advance: skip past this match instead of stepping by 1.
      pos = idx + needle.length;
    }

    return ranges;
  }

  function rankResults(items, query = '', limit = 10) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const sourceItems = Array.isArray(items) ? items : [];
    const eligibleItems = normalizedQuery
      ? sourceItems.filter((item) => getMatchTier(item, normalizedQuery) !== Number.POSITIVE_INFINITY)
      : sourceItems;
    const deduped = dedupeResults(eligibleItems, normalizedQuery);
    const ranked = sortResults(deduped.map(enrichResult), normalizedQuery);
    const clipped = Number.isFinite(limit) ? ranked.slice(0, Math.max(0, limit)) : ranked;

    if (!normalizedQuery) {
      return clipped;
    }

    const trimmedQuery = String(query || '').trim();
    const openOption = getOpenOption(trimmedQuery);
    const resultsWithActions = openOption
      ? insertResultByRank(clipped, openOption, normalizedQuery)
      : [...clipped];

    resultsWithActions.push(getSearchOption(trimmedQuery));
    return resultsWithActions;
  }

  const api = {
    rankResults,
    getDisplayTitle,
    getHighlightRanges
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.PounceSearchUtils = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
