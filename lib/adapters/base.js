// Abstract base adapter — documents the interface all map adapters must implement.

class BaseAdapter {
  /** @returns {string} 'dynmap' | 'squaremap' | 'bluemap' */
  get type() { throw new Error('adapter must implement type'); }

  /** @returns {number} Tile size in pixels (128 for dynmap, 512 for squaremap/bluemap) */
  get tileSize() { return 128; }

  /**
   * Probe whether this adapter can handle the given URL.
   * @param {string} rootUrl - e.g. "http://map.example.com/"
   * @returns {Promise<boolean>}
   */
  static async detect(rootUrl) { throw new Error('adapter must implement detect'); }

  /**
   * Fetch online players, normalized to:
   * [{ account, display_name, world, x, y, z, health, armor }]
   * @param {string} rootUrl
   * @returns {Promise<{ players: Array, timestamp: number, isThundering: boolean, hasStorm: boolean }>}
   */
  async fetchPlayers(rootUrl) { throw new Error('adapter must implement fetchPlayers'); }

  /**
   * Fetch map configuration, normalized to:
   * { root, tileRoot, world, config, imageFormat, nativeZoomMax, tileSize }
   * @param {string} rootUrl
   * @param {string|null} preferredWorld - world name from URL or config
   * @returns {Promise<object>}
   */
  async fetchConfig(rootUrl, preferredWorld) { throw new Error('adapter must implement fetchConfig'); }

  /**
   * Fetch markers for a world, normalized to Dynmap-compatible format:
   * { sets: { 'towny.markerset': { areas: {...} } } }
   * @param {string} rootUrl
   * @param {string} world
   * @returns {Promise<object>}
   */
  async fetchMarkers(rootUrl, world) { throw new Error('adapter must implement fetchMarkers'); }

  /**
   * Build a tile URL for the frontend tile layer.
   * @param {object} opts - { tileRoot, world, prefix, x, y, z, nativeZoom, fmt }
   * @returns {string}
   */
  buildTileUrl(opts) { throw new Error('adapter must implement buildTileUrl'); }

  /**
   * Build a tile URL for the server-side compositor.
   * @param {object} opts - { tileRoot, world, prefix, tileX, tileY, scaledX, scaledY, fmt }
   * @returns {string}
   */
  buildCompositorTileUrl(opts) { throw new Error('adapter must implement buildCompositorTileUrl'); }
}

module.exports = BaseAdapter;
