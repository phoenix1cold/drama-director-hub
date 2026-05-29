/**
 * One-time migration from the legacy single 'drama-director' module to the new
 * split modules. Runs once on the GM client; sets a flag in hub world settings
 * so it never runs twice.
 *
 * What it does:
 *   1. If the legacy 'drama-director' module exists AND has stored world data,
 *      copy each setting key to its new owning module (cinematic / footsteps /
 *      novella / textpics).
 *   2. Set hub.migrationDone = true.
 *   3. Notify the GM that they can safely disable the old module.
 *
 * Safety: this function is idempotent — keys are only copied if the target key
 * is at its default value (i.e. user hasn't already configured the new module).
 */

const HUB_ID    = 'drama-director-hub';
const LEGACY_ID = 'drama-director';

// Map: legacy setting key  →  { newModuleId, newKey }
//
// Keep in sync with:
//   - drama-director-cinematic settings
//   - drama-director-footsteps settings
//   - drama-director-novella settings
//   - drama-director-textpics settings
const SETTING_MAP = [
  // ── Cinematic ────────────────────────────────────────────────────────────
  ['vignetteIntensity',    'drama-director-cinematic'],
  ['defaultTextDuration',  'drama-director-cinematic'],
  ['enableSounds',         'drama-director-cinematic'],
  ['soundVolume',          'drama-director-cinematic'],
  ['loadingScreen',        'drama-director-cinematic'],
  ['abilityEffects',       'drama-director-cinematic'],

  // ── TextPics ─────────────────────────────────────────────────────────────
  ['textPresets',          'drama-director-textpics'],

  // ── Novella (VN) ─────────────────────────────────────────────────────────
  ['vnCharPresets',        'drama-director-novella'],
  ['vnBgPresets',          'drama-director-novella'],
  ['vnScenePresets',       'drama-director-novella'],
  ['vnLayerPresets',       'drama-director-novella'],
  ['vnIimgPresets',        'drama-director-novella'],
  ['vnLayersMaster',       'drama-director-novella'],
  ['vnIimgsMaster',        'drama-director-novella'],
  ['vnAutoSave',           'drama-director-novella'],
  ['vnLastSaveType',       'drama-director-novella'],

  // ── Footsteps ────────────────────────────────────────────────────────────
  ['stepSoundPresets',         'drama-director-footsteps'],
  ['stepsRegions',             'drama-director-footsteps'],
  ['stepsRegionPresets',       'drama-director-footsteps'],
  ['stepsSoundRegions',        'drama-director-footsteps'],
  ['stepsSoundRegionPresets',  'drama-director-footsteps'],
  ['stepsDistRegions',         'drama-director-footsteps'],
  ['stepsDistRegionPresets',   'drama-director-footsteps'],
  ['stepsEnabled',             'drama-director-footsteps'],
  ['stepsSurface',             'drama-director-footsteps'],
  ['stepsCustomUrl',           'drama-director-footsteps'],
  ['stepsCustomUrl2',          'drama-director-footsteps'],
  ['stepsCellInterval',        'drama-director-footsteps'],
  ['stepsVolumeAll',           'drama-director-footsteps'],
  ['stepsVolumeGM',            'drama-director-footsteps'],
  ['stepsMuteGM',              'drama-director-footsteps'],
  ['stepsRealistic',           'drama-director-footsteps'],
  ['stepsRealisticLevel',      'drama-director-footsteps'],
  ['stepsSpatial',             'drama-director-footsteps'],
  ['stepsWallMode',            'drama-director-footsteps'],
  ['stepsFadeMs',              'drama-director-footsteps'],
  ['stepsDistFull',            'drama-director-footsteps'],
  ['stepsDistMax',             'drama-director-footsteps'],
];

export const DDHubMigration = {
  async maybeRun() {
    let done = false;
    try { done = !!game.settings.get(HUB_ID, 'migrationDone'); } catch {}
    if (done) return;
    return this.run();
  },

  async run() {
    const legacyMod = game.modules.get(LEGACY_ID);
    if (!legacyMod) {
      // Nothing to migrate — mark done so we don't keep checking.
      try { await game.settings.set(HUB_ID, 'migrationDone', true); } catch {}
      console.log('[DDHub.migration] no legacy module installed; nothing to do');
      return;
    }

    let copied = 0, skipped = 0, missing = 0;
    for (const [key, newModuleId] of SETTING_MAP) {
      // Read legacy
      let legacyVal;
      try {
        legacyVal = game.settings.get(LEGACY_ID, key);
      } catch {
        missing++; continue;
      }
      if (legacyVal === undefined || legacyVal === null) { missing++; continue; }

      // Check if new module is loaded
      const newMod = game.modules.get(newModuleId);
      if (!newMod?.active) { skipped++; continue; }

      // Check if new key registered (try a get; if it throws, key not registered)
      let newVal;
      try { newVal = game.settings.get(newModuleId, key); }
      catch { skipped++; continue; }

      // Only copy if new is still at default-ish (empty array / object / 0 / false / '' / null)
      const isDefault =
        newVal === null || newVal === undefined ||
        newVal === '' || newVal === 0 || newVal === false ||
        (Array.isArray(newVal) && newVal.length === 0) ||
        (typeof newVal === 'object' && newVal && !Array.isArray(newVal) && Object.keys(newVal).length === 0);

      if (!isDefault) { skipped++; continue; }

      try {
        await game.settings.set(newModuleId, key, legacyVal);
        copied++;
      } catch (e) {
        console.warn(`[DDHub.migration] copy failed for ${key} → ${newModuleId}`, e);
      }
    }

    try { await game.settings.set(HUB_ID, 'migrationDone', true); } catch {}

    console.log(`[DDHub.migration] done — copied ${copied}, skipped ${skipped}, missing ${missing}`);

    if (copied > 0 && ui?.notifications?.info) {
      ui.notifications.info(
        game.i18n.format(
          'DDHUB.migration.success',
          { count: copied }
        ) || `Drama Director: migrated ${copied} settings from the legacy module.`
      );
    }
  },
};
