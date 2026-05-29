/**
 * Drama Director Hub — update checker
 *
 * Fetches the manifest URL of every installed module in the Drama Director
 * family and compares it to the locally installed version. The result feeds
 * the Hub panel UI (badges + "Check updates" button) and is also exposed on
 * the public API via DDHub.checkUpdates() / DDHub.getUpdateStatus().
 *
 * No telemetry leaves the machine — manifests are fetched directly from
 * github.com (or whatever URL the installed module.json points to).
 */

const HUB_ID = 'drama-director-hub';

/**
 * Family registry. Each entry maps a module ID to its default GitHub repo
 * (used to construct manifest / release URLs when the installed module.json
 * does not advertise them, e.g. side-loaded development copies).
 */
const FAMILY = Object.freeze({
  'drama-director-hub':       'phoenix1cold/drama-director-hub',
  'drama-director-cinematic': 'phoenix1cold/drama-director-cinematic',
  'drama-director-footsteps': 'phoenix1cold/drama-director-footsteps',
  'drama-director-novella':   'phoenix1cold/drama-director-novella',
  'drama-director-textpics':  'phoenix1cold/drama-director-textpics',
});

/** TTL for the in-memory result cache. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Current cached result. Invalidated by force=true. */
let _cache = null; // { ts: number, results: Array<UpdateResult> }
let _inFlight = null;

/**
 * @typedef {object} UpdateResult
 * @property {string}  id             module id
 * @property {boolean} installed      true if game.modules.get(id) exists and is active or known
 * @property {string|null} current    installed version (or null if not installed)
 * @property {string|null} latest     remote version (or null on fetch failure)
 * @property {boolean} hasUpdate      true iff installed && latest > current
 * @property {string}  manifestUrl    URL we attempted to fetch
 * @property {string}  releaseUrl     URL to point the user at on click (release page)
 * @property {string|null} error      fetch / parse error message, if any
 */

/** Compare two semver-ish strings. Returns negative / 0 / positive. */
function _cmpVersion(a, b) {
  const pa = String(a ?? '').split(/[.\-]/).map(s => /^\d+$/.test(s) ? +s : s);
  const pb = String(b ?? '').split(/[.\-]/).map(s => /^\d+$/.test(s) ? +s : s);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

/**
 * Pick the URL to fetch the latest manifest from for a given module.
 *  - prefer the installed module.json's `manifest` field
 *  - fall back to GitHub releases/latest/download/module.json on the family repo
 */
function _pickManifestUrl(id, installedMod) {
  const fromInstalled = installedMod?.manifest || installedMod?.flags?.manifest;
  if (typeof fromInstalled === 'string' && fromInstalled.startsWith('http')) {
    return fromInstalled;
  }
  const repo = FAMILY[id];
  if (!repo) return null;
  return `https://github.com/${repo}/releases/latest/download/module.json`;
}

/**
 * Pick the URL we want the user to land on if they click "update" — the
 * GitHub release page. Falls back to repo root.
 */
function _pickReleaseUrl(id, installedMod, latestVersion) {
  const repo = FAMILY[id];
  if (!repo) return installedMod?.url ?? '#';
  if (latestVersion) {
    return `https://github.com/${repo}/releases/tag/v${latestVersion}`;
  }
  return `https://github.com/${repo}/releases`;
}

/** Fetch a single manifest. Returns parsed JSON or null on failure. */
async function _fetchManifest(url) {
  try {
    const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return { __error: String(e?.message || e) };
  }
}

/** Run the check across all installed family modules. Returns results array. */
async function _runCheck() {
  const ids = Object.keys(FAMILY);
  const promises = ids.map(async (id) => {
    const installedMod = game.modules.get(id);
    const installed = !!installedMod;
    const current   = installed ? (installedMod.version ?? null) : null;

    if (!installed) {
      return {
        id, installed: false, current: null, latest: null,
        hasUpdate: false,
        manifestUrl: null,
        releaseUrl:  `https://github.com/${FAMILY[id]}`,
        error: null,
      };
    }

    const manifestUrl = _pickManifestUrl(id, installedMod);
    if (!manifestUrl) {
      return {
        id, installed: true, current, latest: null, hasUpdate: false,
        manifestUrl: null,
        releaseUrl:  `https://github.com/${FAMILY[id] ?? ''}`,
        error: 'no manifest url',
      };
    }

    const data = await _fetchManifest(manifestUrl);
    if (!data || data.__error) {
      return {
        id, installed: true, current, latest: null, hasUpdate: false,
        manifestUrl,
        releaseUrl: _pickReleaseUrl(id, installedMod, null),
        error: data?.__error || 'fetch failed',
      };
    }

    const latest    = data.version ?? null;
    const hasUpdate = !!(latest && current && _cmpVersion(latest, current) > 0);
    return {
      id,
      installed:  true,
      current,
      latest,
      hasUpdate,
      manifestUrl,
      releaseUrl: _pickReleaseUrl(id, installedMod, latest),
      error: null,
    };
  });

  return Promise.all(promises);
}

export const DDHubUpdates = {
  FAMILY,

  /**
   * Run a fresh check (or return cached result if not stale and !force).
   * @param {object} [opts]
   * @param {boolean} [opts.force=false]  ignore cache
   * @returns {Promise<UpdateResult[]>}
   */
  async checkUpdates({ force = false } = {}) {
    const now = Date.now();
    if (!force && _cache && (now - _cache.ts) < CACHE_TTL_MS) {
      return _cache.results;
    }
    if (_inFlight) return _inFlight;
    _inFlight = (async () => {
      try {
        const results = await _runCheck();
        _cache = { ts: Date.now(), results };
        // Notify listeners.
        try {
          Hooks.callAll('drama-director-hub.updatesChecked', results);
        } catch { /* noop */ }
        return results;
      } finally {
        _inFlight = null;
      }
    })();
    return _inFlight;
  },

  /** Returns the most recent results without triggering a fetch (or [] if none yet). */
  getStatus() {
    return _cache?.results ?? [];
  },

  /** Returns just the entries that have a newer remote version. */
  getAvailable() {
    return (_cache?.results ?? []).filter(r => r.hasUpdate);
  },

  /** Drop the cache, forcing the next check to actually fetch. */
  invalidate() { _cache = null; },

  /** Manually open the release URL for a module id. */
  openRelease(id) {
    const r = (_cache?.results ?? []).find(x => x.id === id);
    const url = r?.releaseUrl || (FAMILY[id] ? `https://github.com/${FAMILY[id]}/releases` : null);
    if (url) window.open(url, '_blank', 'noopener');
  },
};

/** Internal helper: log a brief summary to the console. */
function _logSummary(results) {
  const updates = results.filter(r => r.hasUpdate);
  if (!updates.length) {
    console.log('[DDHub.updates] family up to date');
    return;
  }
  for (const u of updates) {
    console.log(`[DDHub.updates] ${u.id}: ${u.current} → ${u.latest} available (${u.releaseUrl})`);
  }
}

/** Auto-run an unforced check on world load. Silent unless updates exist. */
Hooks.once('ready', async () => {
  if (!game.user?.isGM) return;
  // Defer slightly so we don't fight with other hub init work.
  setTimeout(async () => {
    try {
      const r = await DDHubUpdates.checkUpdates({ force: false });
      _logSummary(r);
    } catch (e) {
      console.warn('[DDHub.updates] auto-check failed', e);
    }
  }, 4000);
});
