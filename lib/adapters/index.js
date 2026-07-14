const DynmapAdapter = require('./dynmap');
const SquaremapAdapter = require('./squaremap');
const BlueMapAdapter = require('./bluemap');

const ADAPTERS = [SquaremapAdapter, DynmapAdapter, BlueMapAdapter];

let detectedType = null;
let activeAdapter = null;
let cachedRootUrl = null;

/**
 * Get the active adapter for the given URL and optional map type.
 * Auto-detects if mapType is not set.
 * @param {string} rootUrl
 * @param {string|null} mapType - 'dynmap' | 'squaremap' | 'bluemap' | null (auto-detect)
 * @returns {Promise<BaseAdapter>}
 */
async function getAdapter(rootUrl, mapType) {
  // If already cached for this URL and type, return immediately
  if (activeAdapter && cachedRootUrl === rootUrl && (!mapType || mapType === detectedType)) {
    return activeAdapter;
  }

  // If mapType is specified, use it directly
  if (mapType) {
    const adapter = ADAPTERS.find(a => a.prototype.type === mapType);
    if (adapter) {
      activeAdapter = new adapter();
      detectedType = mapType;
      cachedRootUrl = rootUrl;
      return activeAdapter;
    }
    console.warn(`[adapter] unknown map type "${mapType}", falling back to auto-detect`);
  }

  // Auto-detect by probing endpoints
  for (const AdapterClass of ADAPTERS) {
    try {
      const canDetect = await AdapterClass.detect(rootUrl);
      if (canDetect) {
        activeAdapter = new AdapterClass();
        detectedType = activeAdapter.type;
        cachedRootUrl = rootUrl;
        console.log(`[adapter] detected map type: ${detectedType}`);
        return activeAdapter;
      }
    } catch {
      // Continue to next adapter
    }
  }

  // Fallback to dynmap (backward compatible)
  console.warn('[adapter] could not detect map type, defaulting to dynmap');
  activeAdapter = new DynmapAdapter();
  detectedType = 'dynmap';
  cachedRootUrl = rootUrl;
  return activeAdapter;
}

function invalidateAdapter() {
  activeAdapter = null;
  detectedType = null;
  cachedRootUrl = null;
}

module.exports = { getAdapter, invalidateAdapter, ADAPTERS };
