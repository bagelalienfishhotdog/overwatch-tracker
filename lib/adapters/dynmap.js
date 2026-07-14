const axios = require('axios');
const BaseAdapter = require('./base');

class DynmapAdapter extends BaseAdapter {
  get type() { return 'dynmap'; }
  get tileSize() { return 128; }

  static async detect(rootUrl) {
    // Try standard Dynmap endpoint first
    try {
      const res = await axios.get(rootUrl + 'up/configuration', { timeout: 5000 });
      if (res.data && res.data.worlds) return true;
    } catch {}

    // Try MySQL-backed Dynmap endpoint
    try {
      const res = await axios.get(rootUrl + 'standalone/MySQL_configuration.php', { timeout: 5000 });
      if (res.data && res.data.worlds) return true;
    } catch {}

    return false;
  }

  _isMySqlBackend() {
    return this._mysqlBackend === true;
  }

  _cleanName(rawHtml, account) {
    if (!rawHtml) return account || '';
    const nameMatch = rawHtml.match(/<span[^>]*color:#ffffff[^>]*>([^<]+)</);
    if (nameMatch) return nameMatch[1].trim();
    return String(rawHtml).replace(/<[^>]*>/g, '').trim();
  }

  async fetchPlayers(rootUrl) {
    // MySQL backend: use standalone/MySQL_update.php
    if (this._isMySqlBackend()) {
      const world = this._activeWorld || 'Main';
      const url = rootUrl + 'standalone/MySQL_update.php?world=' + encodeURIComponent(world) + '&ts=0';
      const res = await axios.get(url, { timeout: 8000 });
      const data = res.data;
      const players = (Array.isArray(data.players) ? data.players : []).map(p => ({
        account: p.account || this._cleanName(p.name, null),
        display_name: this._cleanName(p.name, p.account),
        world: p.world || 'unknown',
        x: p.x, y: p.y, z: p.z,
        health: p.health ?? null,
        armor: p.armor ?? null,
      }));
      return {
        players,
        timestamp: data.timestamp || Date.now(),
        isThundering: !!data.isThundering,
        hasStorm: !!data.hasStorm,
      };
    }

    // Standard: try up/world/{world}/ first
    try {
      const res = await axios.get(rootUrl, { timeout: 8000 });
      const data = res.data;
      // Check if the response actually contains player data
      if (Array.isArray(data.players) && data.timestamp) {
        const players = data.players.map(p => ({
          account: p.account || this._cleanName(p.name, null),
          display_name: this._cleanName(p.name, p.account),
          world: p.world || 'unknown',
          x: p.x, y: p.y, z: p.z,
          health: p.health ?? null,
          armor: p.armor ?? null,
        }));
        return {
          players,
          timestamp: data.timestamp || Date.now(),
          isThundering: !!data.isThundering,
          hasStorm: !!data.hasStorm,
        };
      }
      // Response didn't have player data — fall through to MySQL
    } catch (standardErr) {
      // Standard endpoint failed — fall through to MySQL
    }

    // MySQL backend fallback
    const world = this._activeWorld || 'Main';
    const url = rootUrl + 'standalone/MySQL_update.php?world=' + encodeURIComponent(world) + '&ts=0';
    const res = await axios.get(url, { timeout: 8000 });
    const data = res.data;
    const players = (Array.isArray(data.players) ? data.players : []).map(p => ({
      account: p.account || this._cleanName(p.name, null),
      display_name: this._cleanName(p.name, p.account),
      world: p.world || 'unknown',
      x: p.x, y: p.y, z: p.z,
      health: p.health ?? null,
      armor: p.armor ?? null,
    }));
    // Remember this for next time
    this._mysqlBackend = true;
    return {
      players,
      timestamp: data.timestamp || Date.now(),
      isThundering: !!data.isThundering,
      hasStorm: !!data.hasStorm,
    };
  }

  async fetchConfig(rootUrl, preferredWorld) {
    let config;
    let mysqlBackend = false;

    // Try standard endpoint first
    try {
      const res = await axios.get(rootUrl + 'up/configuration', { timeout: 8000 });
      if (res.data && res.data.worlds) {
        config = res.data;
      }
    } catch {}

    // Fall back to MySQL endpoint
    if (!config) {
      try {
        const res = await axios.get(rootUrl + 'standalone/MySQL_configuration.php', { timeout: 8000 });
        if (res.data && res.data.worlds) {
          config = res.data;
          mysqlBackend = true;
        }
      } catch {}
    }

    if (!config) {
      throw new Error('Could not fetch Dynmap configuration from any endpoint');
    }

    // Remember which backend we found
    this._mysqlBackend = mysqlBackend;

    // Derive world name from URL path or config
    let world = preferredWorld;
    if (!world && config.worlds && config.worlds.length > 0) {
      world = config.worlds[0].name;
    }

    // Store the active world for fetchPlayers
    this._activeWorld = world;

    const worldCfg = (config.worlds || []).find(w => w.name === world);
    const mapDef = worldCfg && worldCfg.maps && worldCfg.maps[0];

    const prefix = mapDef ? (mapDef.prefix || mapDef.name || 'flat') : 'flat';
    const imageFormat = mapDef ? (mapDef['image-format'] || mapDef.imageformat || 'png') : 'png';
    const scale = mapDef ? (mapDef.scale || (mapDef.tilescale ? 1 / mapDef.tilescale : 2)) : 2;

    // MySQL backend uses different tile/marker paths and a zzzzz_ tile prefix
    const tileRoot = mysqlBackend
      ? rootUrl + 'standalone/MySQL_tiles.php?tile='
      : rootUrl + 'tiles/';
    const tilePrefix = mysqlBackend ? 'zzzzz' : null;
    const extraZoomLevels = worldCfg ? (worldCfg.extrazoomout || 0) : 0;

    return {
      root: rootUrl,
      tileRoot,
      world,
      mapType: 'dynmap',
      tileSize: 128,
      config,
      prefix,
      tilePrefix,
      imageFormat,
      scale,
      extraZoomLevels,
      nativeZoomMax: 0,
      tileUrlPattern: 'dynmap',
      worldtomap: worldCfg && worldCfg.maps && worldCfg.maps[0]
        ? worldCfg.maps[0].worldtomap : null,
      mysqlBackend,
      error: null,
    };
  }

  async fetchMarkers(rootUrl, world) {
    if (this._isMySqlBackend()) {
      const markersUrl = `${rootUrl}standalone/MySQL_markers.php?marker=_markers_/marker_${world}.json`;
      const res = await axios.get(markersUrl, { timeout: 8000 });
      return res.data;
    }

    const markersUrl = `${rootUrl}tiles/_markers_/marker_${world}.json`;
    const res = await axios.get(markersUrl, { timeout: 8000 });
    return res.data;
  }

  buildTileUrl({ tileRoot, world, prefix, tilePrefix, x, y, nativeZoom, fmt }) {
    if (this._isMySqlBackend()) {
      // MySQL backend: standalone/MySQL_tiles.php?tile=world/prefix/scaledX_scaledY/tilePrefix_x_y.jpg
      const scaledX = Math.floor(x / 32);
      const scaledY = Math.floor(y / 32);
      const tp = tilePrefix || 'zzzzz';
      return `${tileRoot}${world}/${prefix}/${scaledX}_${scaledY}/${tp}_${x}_${y}.${fmt}`;
    }

    // Standard Dynmap: tiles/world/prefix/scaledX_scaledY/x_y.png
    const scaledX = Math.floor(x / 32);
    const scaledY = Math.floor(y / 32);
    return `${tileRoot}${world}/${prefix}/${scaledX}_${scaledY}/${x}_${y}.${fmt}`;
  }

  buildCompositorTileUrl({ tileRoot, world, prefix, tileX, tileY, fmt }) {
    const scaledX = Math.floor(tileX / 32);
    const scaledY = Math.floor(tileY / 32);
    return `${tileRoot}${world}/${prefix}/${scaledX}_${scaledY}/${tileX}_${tileY}.${fmt}`;
  }
}

module.exports = DynmapAdapter;
