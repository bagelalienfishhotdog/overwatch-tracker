const axios = require('axios');
const BaseAdapter = require('./base');

class BlueMapAdapter extends BaseAdapter {
  get type() { return 'bluemap'; }
  get tileSize() { return 512; }

  static async detect(rootUrl) {
    try {
      const res = await axios.get(rootUrl + 'api/configuration', { timeout: 5000 });
      return !!(res.data && res.data.maps);
    } catch {
      return false;
    }
  }

  async fetchPlayers(rootUrl) {
    const res = await axios.get(rootUrl + 'api/players', { timeout: 8000 });
    const data = res.data;
    const players = (Array.isArray(data.players) ? data.players : []).map(p => ({
      account: p.uuid || p.name,
      display_name: p.name || p.uuid,
      world: p.world || 'unknown',
      x: p.x || 0, y: p.y || 0, z: p.z || 0,
      health: null,
      armor: null,
    }));
    return {
      players,
      timestamp: Date.now(),
      isThundering: false,
      hasStorm: false,
    };
  }

  async fetchConfig(rootUrl, preferredWorld) {
    const res = await axios.get(rootUrl + 'api/configuration', { timeout: 8000 });
    const config = res.data;

    let world = preferredWorld;
    if (!world && config.maps && config.maps.length > 0) {
      world = config.maps[0].id;
    }

    return {
      root: rootUrl,
      tileRoot: rootUrl + 'maps/',
      world,
      mapType: 'bluemap',
      tileSize: 512,
      config,
      prefix: null,
      imageFormat: 'png',
      scale: 1,
      nativeZoomMax: 0,
      tileUrlPattern: 'bluemap',
      error: null,
    };
  }

  async fetchMarkers(rootUrl, world) {
    // BlueMap markers API — best effort
    try {
      const res = await axios.get(rootUrl + `api/markers/${world}/main`, { timeout: 5000 });
      return res.data;
    } catch {
      return { sets: {} };
    }
  }

  buildTileUrl({ tileRoot, world, x, y, z, fmt }) {
    // BlueMap: /maps/{world}/{z}/{x}/{y}.png
    return `${tileRoot}${world}/${z}/${x}/${y}.${fmt}`;
  }

  buildCompositorTileUrl({ tileRoot, world, x, y, z, fmt }) {
    return `${tileRoot}${world}/${z}/${x}/${y}.${fmt}`;
  }
}

module.exports = BlueMapAdapter;
