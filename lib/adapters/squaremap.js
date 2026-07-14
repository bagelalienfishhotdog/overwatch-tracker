const axios = require('axios');
const BaseAdapter = require('./base');

class SquaremapAdapter extends BaseAdapter {
  get type() { return 'squaremap'; }
  get tileSize() { return 512; }

  static async detect(rootUrl) {
    try {
      const res = await axios.get(rootUrl + 'tiles/settings.json', { timeout: 5000 });
      return !!(res.data && Array.isArray(res.data.worlds));
    } catch {
      return false;
    }
  }

  async fetchPlayers(rootUrl) {
    const res = await axios.get(rootUrl + 'tiles/players.json', { timeout: 8000 });
    const data = res.data;
    const players = (Array.isArray(data.players) ? data.players : []).map(p => ({
      account: p.uuid || p.name,
      display_name: this._cleanName(p.display_name || p.name, p.uuid || p.name),
      world: p.world || 'unknown',
      x: p.x, y: p.y ?? 0, z: p.z,
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

  _cleanName(raw, fallback) {
    if (!raw) return fallback || '';
    return String(raw).replace(/<[^>]*>/g, '').trim();
  }

  async fetchConfig(rootUrl, preferredWorld) {
    // Fetch global settings
    const settingsRes = await axios.get(rootUrl + 'tiles/settings.json', { timeout: 8000 });
    const settings = settingsRes.data;

    // Determine world name
    let world = preferredWorld;
    if (!world && settings.worlds && settings.worlds.length > 0) {
      world = settings.worlds[0].name;
    }

    // Fetch world-specific settings
    let worldSettings = {};
    try {
      const worldRes = await axios.get(rootUrl + `tiles/${world}/settings.json`, { timeout: 5000 });
      worldSettings = worldRes.data;
    } catch {
      // Use defaults
    }

    return {
      root: rootUrl,
      tileRoot: rootUrl + 'tiles/',
      world,
      mapType: 'squaremap',
      tileSize: 512,
      config: settings,
      prefix: null, // squaremap doesn't use prefix
      imageFormat: 'png',
      scale: 1,
      nativeZoomMax: worldSettings.zoom ? (worldSettings.zoom.max || 0) : 0,
      tileUrlPattern: 'squaremap',
      worldSettings,
      error: null,
    };
  }

  async fetchMarkers(rootUrl, world) {
    const markersUrl = `${rootUrl}tiles/${world}/markers.json`;
    const res = await axios.get(markersUrl, { timeout: 8000 });
    const layers = res.data;

    // Transform squaremap marker format to Dynmap-compatible format
    // Squaremap returns an array of layer objects, each with markers
    const areas = {};
    if (Array.isArray(layers)) {
      for (const layer of layers) {
        if (!layer.markers) continue;
        for (const key in layer.markers) {
          const marker = layer.markers[key];
          if (marker.type === 'polygon' || marker.type === 'rectangle') {
            areas[key] = {
              label: marker.label || key,
              x: marker.x || [],
              z: marker.z || [],
              color: marker.color || '#90EE90',
              weight: marker.weight || 2,
              opacity: marker.opacity || 0.8,
              fillcolor: marker.fillcolor || '#800080',
              fillopacity: marker.fillopacity || 0.2,
              desc: marker.desc || '',
            };
          }
        }
      }
    }

    return {
      sets: {
        'towny.markerset': { areas },
      },
    };
  }

  buildTileUrl({ tileRoot, world, x, y, z, fmt }) {
    // Squaremap: /tiles/{world}/{z}/{x}_{y}.png
    return `${tileRoot}${world}/${z}/${x}_${y}.${fmt}`;
  }

  buildCompositorTileUrl({ tileRoot, world, x, y, z, fmt }) {
    return `${tileRoot}${world}/${z}/${x}_${y}.${fmt}`;
  }
}

module.exports = SquaremapAdapter;
