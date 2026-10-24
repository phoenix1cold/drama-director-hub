/**
 * Drama Director — Hub
 * Provides:
 *   - Sidebar tab with one button per registered feature module
 *   - Shared API surface  game.modules.get('drama-director-hub').api
 *   - Migration shim from the legacy single-module 'drama-director'
 *   - Cross-module event bus
 *
 * Feature modules (drama-director-cinematic, drama-director-footsteps,
 * drama-director-novella, drama-director-textpics) call
 *   DDHub.registerPanel({...})
 * during their own 'init' or 'setup' hook to appear on the hub.
 */

import { DDHubBus } from './hub-bus.mjs';
import { DDHubSettings } from './hub-settings.mjs';
import { DDHubMigration } from './hub-migration.mjs';
import { DDHubUpdates } from './hub-updates.mjs';
import { DramaDirectorHubTab } from './sidebar-tab.mjs';

const HUB_ID = 'drama-director-hub';
const LEGACY_ID = 'drama-director';

// ── Hub API surface ──────────────────────────────────────────────────────────
// All feature modules talk to the hub through this object. We attach it to
// the module record early (during 'init') so feature modules can grab it
// from their own init hook.
const _panels = [];
const _bus    = new DDHubBus();

const DDHub = {
  /**
   * Register a top-level button on the hub sidebar.
   * @param {object} def
   * @param {string} def.id             unique id (e.g. 'cinematic-intros')
   * @param {string} def.moduleId       the registering module id
   * @param {string} def.label          localized label (or i18n key)
   * @param {string} def.icon           font-awesome class (e.g. 'fa-solid fa-film')
   * @param {string} [def.color]        accent color (CSS)
   * @param {string} [def.hint]         localized hint
   * @param {string} [def.description]  longer description
   * @param {Function} def.open         () => void  — called when button clicked (GM only)
   * @param {number} [def.order=100]    sort order on the hub (lower = earlier)
   * @param {Function} [def.gmOnly]     boolean (default true)
   */
  registerPanel(def) {
    if (!def?.id || typeof def.open !== 'function') {
      console.warn('[DDHub] registerPanel: bad def', def);
      return;
    }
    // Prevent duplicates
    const idx = _panels.findIndex(p => p.id === def.id);
    if (idx >= 0) _panels[idx] = def;
    else          _panels.push(def);
    _panels.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    // Notify listeners (and force re-render of the hub tab if it's mounted).
    try { Hooks.callAll('drama-director-hub.panelsChanged', _panels.slice()); } catch {}
    try { DramaDirectorHubTab.requestRerender(); } catch {}
  },

  /** Ordered list of registered panels. Used by the hub tab template. */
  getPanels() { return [..._panels]; },

  /** Cross-module event bus. */
  bus: _bus,

  /** Convenience: forward to bus.emit. */
  emit(event, data) { _bus.emit(event, data); },
  on(event, cb)     { return _bus.on(event, cb); },
  off(event, cb)    { _bus.off(event, cb); },

  /** Settings helpers (each feature module owns its own keys; hub does not store theirs). */
  getSetting: DDHubSettings.get,
  setSetting: DDHubSettings.set,

  /** Manually trigger migration (idempotent; usually runs automatically on ready). */
  runMigration: () => DDHubMigration.run(),

  /** Returns true if the legacy 'drama-director' module is currently installed. */
  isLegacyInstalled: () => !!game.modules.get(LEGACY_ID),

  /**
   * Run the family update checker. Returns an array of UpdateResult — one
   * entry per module in the Drama Director family (cinematic / footsteps /
   * novella / textpics / hub). Cached for 1 hour unless force=true.
   */
  checkUpdates: (opts) => DDHubUpdates.checkUpdates(opts),

  /** Returns the most recent update results without triggering a fetch. */
  getUpdateStatus: () => DDHubUpdates.getStatus(),

  /** Returns just the entries that have a newer remote version. */
  getAvailableUpdates: () => DDHubUpdates.getAvailable(),

  /** Family registry: id → "owner/repo". */
  FAMILY: DDHubUpdates.FAMILY,

  /** Constants */
  HUB_ID,
  LEGACY_ID,
};

// ── Init ─────────────────────────────────────────────────────────────────────
Hooks.once('init', () => {
  const mod = game.modules.get(HUB_ID);
  if (mod) mod.api = DDHub;

  // Family-owned helpers: never rely on another feature registering them.
  Handlebars.registerHelper('ddEq', (a, b) => a === b);
  Handlebars.registerHelper('ddIsVideo', src => /\.(webm|mp4|ogv)(?:[?#]|$)/i.test(String(src || '')));

  // Hub settings (only ones the hub itself owns)
  game.settings.register(HUB_ID, 'migrationDone', {
    scope: 'world', config: false, type: Boolean, default: false,
  });
  game.settings.register(HUB_ID, 'language', {
    name: 'DDHUB.settings.language',
    hint: 'DDHUB.settings.languageHint',
    scope: 'client', config: true, type: String,
    choices: { auto: 'DDHUB.settings.languageAuto', en: 'English', ru: 'Русский', fr: 'Français', zh: '简体中文' },
    default: 'auto',
    onChange: () => window.location.reload(),
  });

  // Register the sidebar tab class
  try {
    DramaDirectorHubTab.register();
  } catch (e) {
    console.error('[DDHub] failed to register sidebar tab', e);
  }

  console.log('[DDHub] initialized');
});

// ── i18nInit: optional language override (mirrors legacy behavior) ──────────
Hooks.once('i18nInit', () => {
  let lang = 'auto';
  try { lang = game.settings.get(HUB_ID, 'language') ?? 'auto'; } catch { /* settings not yet registered */ }
  if (lang === 'auto' || !lang) return;
  fetch(`modules/${HUB_ID}/lang/${lang}.json`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      // Deep merge into i18n
      const merge = (target, src) => {
        for (const k of Object.keys(src)) {
          if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
            target[k] = target[k] ?? {};
            merge(target[k], src[k]);
          } else {
            target[k] = src[k];
          }
        }
      };
      merge(game.i18n.translations, data);
    })
    .catch(e => console.warn('[DDHub] language override failed', e));
});

// ── Ready: run migration once ────────────────────────────────────────────────
Hooks.once('ready', async () => {
  try {
    if (game.user?.isGM) {
      await DDHubMigration.maybeRun();
    }
  } catch (e) {
    console.error('[DDHub] migration error', e);
  }
});
