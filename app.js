(() => {
  'use strict';

  // ---- Auth token management -----------------------------------------------
  let authToken = localStorage.getItem('auth_token');
  let currentUser = null;

  function setAuthToken(token) {
    authToken = token;
    localStorage.setItem('auth_token', token);
  }

  function clearAuthToken() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  }

  function getAuthHeaders() {
    return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
  }

  function storeUser(user) {
    currentUser = user;
    localStorage.setItem('auth_user', JSON.stringify(user));
  }

  function loadStoredUser() {
    try {
      const raw = localStorage.getItem('auth_user');
      if (raw) currentUser = JSON.parse(raw);
    } catch {}
  }
  loadStoredUser();

  function logout() {
    clearAuthToken();
    window.location.href = '/login.html';
  }

  // Add auth headers to all fetch calls
  const originalFetch = window.fetch;
  window.fetch = function (url, options = {}) {
    options.headers = { ...options.headers, ...getAuthHeaders() };
    return originalFetch(url, options).then(res => {
      // If we get a 401, the token expired - logout
      if (res.status === 401 && authToken) {
        clearAuthToken();
        window.location.href = '/login.html';
      }
      return res;
    });
  };

  // Session expiry warning modal
  function showExpiryWarning(secondsLeft) {
    // Remove existing modal if any
    const existing = document.getElementById('expiry-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'expiry-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';

    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    modal.innerHTML = `
      <div style="background:var(--panel,#0b1210);border:1px solid var(--border,#1a3828);border-radius:6px;padding:24px 28px;max-width:360px;text-align:center;font-family:var(--mono,'IBM Plex Mono',monospace);">
        <div style="color:var(--amber,#ffb020);font-size:24px;margin-bottom:12px;">&#9888;</div>
        <div style="color:var(--text,#d4ede1);font-size:13px;font-weight:600;letter-spacing:1px;margin-bottom:8px;">SESSION EXPIRING</div>
        <div style="color:var(--text-dim,#5e8a76);font-size:11px;margin-bottom:16px;">
          Your access will expire in <span style="color:var(--amber);font-weight:600;">${timeStr}</span>
        </div>
        <div style="color:var(--text-muted,#3a5a4a);font-size:10px;margin-bottom:16px;">You will be automatically logged out when time runs out.</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button onclick="document.getElementById('expiry-modal').remove()" style="background:var(--green-dim,#1c6b46);color:#06120c;border:none;font-family:inherit;font-size:10px;font-weight:600;letter-spacing:1px;padding:8px 20px;border-radius:3px;cursor:pointer;">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Auto-remove after 30 seconds if they don't click OK
    setTimeout(() => {
      const m = document.getElementById('expiry-modal');
      if (m) m.remove();
    }, 30000);
  }

  // Check token expiry and auto-logout
  function checkTokenExpiry() {
    if (!authToken) return;
    try {
      const decoded = JSON.parse(atob(authToken));
      if (decoded.exp) {
        const now = Math.floor(Date.now() / 1000);
        const timeLeft = decoded.exp - now;
        if (timeLeft <= 0) {
          clearAuthToken();
          window.location.href = '/login.html';
          return;
        }

        // Show warning 60 seconds before expiry
        if (timeLeft > 60) {
          setTimeout(() => showExpiryWarning(60), (timeLeft - 60) * 1000);
        } else {
          // Already within 60 seconds
          showExpiryWarning(timeLeft);
        }

        // Auto-logout when expired
        const logoutTimer = setTimeout(() => {
          clearAuthToken();
          window.location.href = '/login.html';
        }, timeLeft * 1000);

        window._authLogoutTimer = logoutTimer;
      }
    } catch {}
  }
  checkTokenExpiry();

  // Check auth on load
  async function checkAuth() {
    if (!authToken) {
      window.location.href = '/login.html';
      return;
    }

    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        clearAuthToken();
        window.location.href = '/login.html';
        return;
      }
      const data = await res.json();
      storeUser(data.user);
    } catch {
      clearAuthToken();
      window.location.href = '/login.html';
    }
  }

  checkAuth();

  // Show admin link and logout button after auth check
  function initAuthUI() {
    const adminNav = document.getElementById('admin-nav');
    const logoutBtn = document.getElementById('btn-logout');
    if (currentUser && currentUser.role === 'admin' && adminNav) {
      adminNav.style.display = '';
    }
    if (logoutBtn) {
      logoutBtn.style.display = '';
      logoutBtn.onclick = logout;
    }

    // Hide features based on hidden_features array
    if (currentUser && currentUser.hidden_features && currentUser.hidden_features.length > 0) {
      currentUser.hidden_features.forEach(feature => {
        // Hide elements with data-feature attribute
        document.querySelectorAll(`[data-feature="${feature}"]`).forEach(el => {
          el.style.display = 'none';
        });
        // Also hide tab buttons
        document.querySelectorAll(`[data-tab="${feature}"]`).forEach(el => {
          el.style.display = 'none';
        });
      });
    }
  }
  // Run after a short delay to allow auth check to complete
  setTimeout(initAuthUI, 500);

  // ---- World <-> map coordinate conversion --------------------------------
  // Uses Dynmap worldtomap matrix from config for accurate coordinate mapping
  let MAP_SCALE = 1;
  let TILE_SIZE = 128;
  let NATIVE_ZOOM = 5;
  let WORLD_TO_MAP = null;

  function toLatLng(x, z) {
    if (WORLD_TO_MAP) {
      // Use projection matrix: a = w[3]*x + w[5]*z, r = w[0]*x + w[2]*z
      // lat = -((tileSize - a) / 2^nativeZoom), lng = r / 2^nativeZoom
      const w = WORLD_TO_MAP;
      const a = w[3] * x + w[5] * z;  // w[4] is 0 for y
      const r = w[0] * x + w[2] * z;  // w[1] is 0 for y
      const divisor = 1 << NATIVE_ZOOM;
      const result = L.latLng(-((TILE_SIZE - a) / divisor), r / divisor);
      return result;
    }
    // Fallback: simple scale
    return L.latLng(-z * MAP_SCALE, x * MAP_SCALE);
  }

  function fromLatLng(latlng) {
    if (WORLD_TO_MAP) {
      const w = WORLD_TO_MAP;
      const divisor = 1 << NATIVE_ZOOM;
      const r = latlng.lng * divisor;
      const a = TILE_SIZE + latlng.lat * divisor;
      // Invert: a = w[3]*x + w[5]*z, r = w[0]*x + w[2]*z
      // For HOM: w[0]=4, w[2]~0, w[3]~0, w[5]=-4
      // So: a = -4*z, r = 4*x -> z = -a/4, x = r/4
      return { x: r / w[0], z: a / w[5] };
    }
    return { x: latlng.lng / MAP_SCALE, z: -latlng.lat / MAP_SCALE };
  }

  // ---- Map setup ------------------------------------------------------------
  const map = L.map('map', {
    crs: L.CRS.Simple,
    zoomControl: true,
    minZoom: 0,
    maxZoom: 8,
    attributionControl: false,
    preferCanvas: true,
  }).setView([0, 0], 4);

  // Grid
  const gridPane = map.createPane('grid');
  gridPane.style.zIndex = 350;
  let gridLayer = L.layerGroup().addTo(map);
  let gridEnabled = true;

  function niceStep(worldSpan) {
    const targets = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
    for (const t of targets) if (worldSpan / t < 12) return t;
    return 100000;
  }

  function drawGrid() {
    gridLayer.clearLayers();
    if (!gridEnabled) return;
    const bounds = map.getBounds();
    const nw = fromLatLng(bounds.getNorthWest());
    const se = fromLatLng(bounds.getSouthEast());
    const spanX = Math.abs(se.x - nw.x);
    const step = niceStep(spanX || 1000);
    const xStart = Math.floor(nw.x / step) * step;
    const xEnd = Math.ceil(se.x / step) * step;
    const zStart = Math.floor(nw.z / step) * step;
    const zEnd = Math.ceil(se.z / step) * step;
    const lineOpts = { color: '#123322', weight: 1, interactive: false, pane: 'grid' };
    for (let x = xStart; x <= xEnd; x += step) {
      L.polyline([toLatLng(x, zStart - step), toLatLng(x, zEnd + step)], lineOpts).addTo(gridLayer);
      L.marker(toLatLng(x, nw.z), {
        icon: L.divIcon({ className: 'grid-label', html: `X ${x}`, iconSize: [0, 0] }),
        interactive: false, pane: 'grid',
      }).addTo(gridLayer);
    }
    for (let z = zStart; z <= zEnd; z += step) {
      L.polyline([toLatLng(xStart - step, z), toLatLng(xEnd + step, z)], lineOpts).addTo(gridLayer);
      L.marker(toLatLng(nw.x, z), {
        icon: L.divIcon({ className: 'grid-label', html: `Z ${z}`, iconSize: [0, 0] }),
        interactive: false, pane: 'grid',
      }).addTo(gridLayer);
    }
  }
  map.on('moveend zoomend', drawGrid);
  drawGrid();
  document.getElementById('zoom-level').textContent = map.getZoom();

  const styleTag = document.createElement('style');
  styleTag.textContent = `.grid-label { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: #1c6b46; white-space: nowrap; transform: translate(2px, -12px); }`;
  document.head.appendChild(styleTag);

  // ---- Layers ---------------------------------------------------------------
  const markerLayer = L.layerGroup().addTo(map);
  let trailLayer = L.layerGroup().addTo(map);
  const claimsLayer = L.layerGroup().addTo(map);
  let heatLayer = L.heatLayer([], { radius: 22, blur: 18, maxZoom: 8, minOpacity: 0.25 }).addTo(map);

  map.on('zoomend', () => {
    const z = map.getZoom();
    document.getElementById('zoom-level').textContent = z;
    let r, b, opacity;
    if (z <= -3)      { r = 8;  b = 6;  opacity = 0.10; }
    else if (z === -2) { r = 12; b = 9;  opacity = 0.15; }
    else if (z === -1) { r = 16; b = 12; opacity = 0.20; }
    else if (z === 0)  { r = 22; b = 18; opacity = 0.25; }
    else if (z === 1)  { r = 28; b = 22; opacity = 0.30; }
    else if (z === 2)  { r = 34; b = 26; opacity = 0.35; }
    else if (z === 3)  { r = 40; b = 30; opacity = 0.40; }
    else               { r = 48; b = 36; opacity = 0.45; }
    heatLayer.setOptions({ radius: r, blur: b, minOpacity: opacity });
  });

  // ---- Tile layer -----------------------------------------------------------
  // Dynmap tile cache proxy (appends auth token as query param for <img> tags)
  function buildCachedTileUrl(originalUrl) {
    const sid = currentServerId;
    if (!sid) return originalUrl;
    if (originalUrl.includes('?')) return originalUrl;
    const base = `/api/tiles/cached/${sid}/${originalUrl.replace(/^https?:\/\/[^/]+\//, '')}`;
    return authToken ? `${base}?token=${encodeURIComponent(authToken)}` : base;
  }

  // Build a tile URL matching Dynmap's coordinate system
  // Dynmap zoom levels are inverted: higher zoomoutlevel = more zoomed out
  // zoomoutlevel = nativeZoom - leafletZoom (clamped to 0)
  // Each level doubles the tile coverage
  function buildTileUrlFromCoords(tileRoot, world, prefix, tilePrefix, zoomForUrl, coords, extraZoomLevels, imageFormat) {
    const fmt = imageFormat || 'png';
    // Match LiveAtlas getTileInfo: zoomoutlevel = max(0, zoomForUrl - extraZoomLevels)
    // zoomForUrl comes from Leaflet's _getZoomForUrl() (applies zoomReverse + clamping)
    const zoomoutlevel = Math.max(0, zoomForUrl - (extraZoomLevels || 0));
    const scale = 1 << zoomoutlevel;
    const x = scale * coords.x;
    const y = -(scale * coords.y);  // Y INVERTED for Dynmap HD-map

    const scaledX = x >> 5;
    const scaledY = y >> 5;

    // Zoom prefix: 'z'.repeat(amount) + (amount === 0 ? '' : '_')
    const zp = 'z'.repeat(zoomoutlevel) + (zoomoutlevel === 0 ? '' : '_');

    return `${tileRoot}${world}/${prefix}/${scaledX}_${scaledY}/${zp}${x}_${y}.${fmt}`;
  }

  const DynmapTileLayer = L.TileLayer.extend({
    getTileUrl(coords) {
      const tileUrlPattern = this.options.tileUrlPattern || 'dynmap';
      if (tileUrlPattern === 'squaremap' || tileUrlPattern === 'bluemap') {
        // Use Leaflet's default URL template (handles {z}/{x}/{y} replacement)
        const baseUrl = L.TileLayer.prototype.getTileUrl.call(this, coords);
        return buildCachedTileUrl(baseUrl);
      }
      // Dynmap: use _getZoomForUrl() (applies zoomReverse + clamping) — matches LiveAtlas getTileInfo
      const zoomForUrl = this._getZoomForUrl();
      const url = buildTileUrlFromCoords(
        this.options.tileRoot, this.options.world, this.options.prefix,
        this.options.tilePrefix, zoomForUrl, coords,
        this.options.extraZoomLevels || 0, this.options.imageFormat || 'png'
      );
      return buildCachedTileUrl(url);
    },
  });

  let tileLayer = null;
  let tileMeta = null;
  let townAreas = [];

  function buildTileLayer(pxPerBlock) {
    if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }
    if (!tileMeta || !document.getElementById('toggle-tiles').checked) return;

    let nativeZoom;
    if (tileMeta.tileUrlPattern === 'squaremap' || tileMeta.tileUrlPattern === 'bluemap') {
      nativeZoom = tileMeta.nativeZoomMax || 0;
    } else {
      // Dynmap: nativeZoom = mapzoomout from Dynmap config
      nativeZoom = tileMeta.mapzoomout || 5;
    }
    const extraZoom = tileMeta.extraZoomLevels || 0;

    tileLayer = new DynmapTileLayer(
      tileMeta.tileUrlPattern === 'squaremap' || tileMeta.tileUrlPattern === 'bluemap'
        ? `tiles/${tileMeta.world}/{z}/{x}_{y}.${tileMeta.imageFormat || 'png'}`
        : '', {
      tileSize: tileMeta.tileSize || 128,
      minZoom: map.getMinZoom(),
      maxZoom: nativeZoom + extraZoom,
      // Do NOT set minNativeZoom — LiveAtlas defaults to 0
      maxNativeZoom: nativeZoom,
      nativeZoom,
      extraZoomLevels: extraZoom,
      tileRoot: tileMeta.tileRoot,
      world: tileMeta.world,
      prefix: tileMeta.prefix,
      tilePrefix: tileMeta.tilePrefix || null,
      imageFormat: tileMeta.imageFormat,
      tileUrlPattern: tileMeta.tileUrlPattern || 'dynmap',
      pane: 'tilePane',
      zoomReverse: tileMeta.tileUrlPattern !== 'squaremap' && tileMeta.tileUrlPattern !== 'bluemap',
    });
    tileLayer.addTo(map);
    tileLayer.bringToBack();
  }

  async function loadTileMeta() {
    const statusEl = document.getElementById('tile-status');
    try {
      const res = await fetch('/api/mapconfig');
      const data = await res.json();
      const mapType = data.mapType || 'unknown';
      document.getElementById('tile-status').textContent = `Map type: ${mapType}`;

      if (data.error) {
        statusEl.textContent = `Map type: ${mapType} — Config error: ${data.error}`;
        document.getElementById('toggle-tiles').checked = false;
        document.getElementById('toggle-tiles').disabled = true;
        return;
      }
      if (!data.config) {
        statusEl.textContent = `Map type: ${mapType} — Terrain tiles unavailable (no config).`;
        document.getElementById('toggle-tiles').checked = false;
        document.getElementById('toggle-tiles').disabled = true;
        return;
      }

      if (data.mapType === 'squaremap') {
        const zoomMax = data.nativeZoomMax || 0;
        MAP_SCALE = zoomMax > 0 ? 1 / Math.pow(2, zoomMax) : 1;
        tileMeta = {
          tileRoot: data.tileRoot, world: data.world, prefix: null,
          imageFormat: data.imageFormat || 'png', tileSize: 512,
          nativeZoomMax: zoomMax, tileUrlPattern: 'squaremap',
        };
        statusEl.textContent = `Map type: squaremap — World: ${data.world}`;
        buildTileLayer(1);
      } else if (data.mapType === 'bluemap') {
        tileMeta = {
          tileRoot: data.tileRoot, world: data.world, prefix: null,
          imageFormat: data.imageFormat || 'png', tileSize: 512,
          nativeZoomMax: data.nativeZoomMax || 0, tileUrlPattern: 'bluemap',
        };
        statusEl.textContent = `Map type: BlueMap — World: ${data.world}`;
        buildTileLayer(1);
      } else {
        const worldCfg = (data.config.worlds || []).find(w => w.name === data.world);
        const mapDef = worldCfg && worldCfg.maps && worldCfg.maps[0];
        if (!mapDef) {
          statusEl.textContent = `Map type: dynmap — No map definition found for world "${data.world}".`;
          document.getElementById('toggle-tiles').checked = false;
          document.getElementById('toggle-tiles').disabled = true;
          return;
        }
        // Read mapzoomout from Dynmap config (this IS the nativeZoom for tile URLs and projection)
        const mapzoomout = data.config?.worlds?.[0]?.maps?.[0]?.mapzoomout || 5;
        const mapzoomin = data.config?.worlds?.[0]?.maps?.[0]?.mapzoomin || 0;
        tileMeta = {
          tileRoot: data.tileRoot, world: data.world,
          prefix: mapDef.prefix || mapDef.name || 'flat',
          tilePrefix: data.tilePrefix || null,
          imageFormat: data.imageFormat || 'png', tileSize: 128,
          nativeZoomMax: 0, tileUrlPattern: 'dynmap',
          extraZoomLevels: data.extraZoomLevels || 0,
          mapzoomout, mapzoomin,
        };
        const configScale = mapDef.tilescale === 0 ? 1 : (data.scale || (mapDef.scale || (mapDef.tilescale ? 1 / mapDef.tilescale : 2)));
        // Set coordinate conversion parameters from Dynmap config
        if (data.worldtomap) {
          // Parse the worldtomap matrix string (space-separated values)
          const vals = String(data.worldtomap).trim().split(/[\s,]+/).map(Number);
          WORLD_TO_MAP = vals.length >= 9 ? vals : null;
          TILE_SIZE = tileMeta.tileSize || 128;
          NATIVE_ZOOM = mapzoomout;
          console.log(`[map] Dynmap projection: nativeZoom=${mapzoomout}, extraZoom=${tileMeta.extraZoomLevels}, matrix=${vals.join(',')}`);
        } else {
          MAP_SCALE = configScale / (tileMeta.tileSize || 128);
        }
        const scaleSelect = document.getElementById('tile-scale');
        if (scaleSelect) scaleSelect.value = configScale;
        statusEl.textContent = `Map type: dynmap — Using map "${mapDef.title || mapDef.name || tileMeta.prefix}".`;
        buildTileLayer(configScale);
      }
    } catch (err) {
      statusEl.textContent = 'Terrain tiles unavailable (mapconfig request failed).';
      document.getElementById('toggle-tiles').checked = false;
      document.getElementById('toggle-tiles').disabled = true;
    }
  }

  document.getElementById('toggle-tiles').onchange = () => buildTileLayer(Number(document.getElementById('tile-scale').value));
  document.getElementById('tile-scale').onchange = (e) => buildTileLayer(Number(e.target.value));

  const markers = new Map();
  let currentLive = [];
  let selectedAccount = null;
  let liveMode = true;
  let mapCentered = false;
  let followMode = false;

  function playerIcon(color, name) {
    return L.divIcon({
      className: 'player-icon',
      html: `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;">
             <div style="width:10px;height:10px;border-radius:50%;background:${color};
             box-shadow:0 0 6px ${color};border:1px solid #05100a;flex-shrink:0;"></div>
             <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#d9f2e6;
             text-shadow:0 1px 3px rgba(0,0,0,0.9),0 0 4px rgba(0,0,0,0.7);">${name}</span>
             </div>`,
      iconSize: [0, 0],
    });
  }

  function upsertMarker(p) {
    const latlng = toLatLng(p.x, p.z);
    const isSelected = p.account === selectedAccount;
    const color = isSelected ? '#ffb020' : '#34e58f';
    const iconWithName = playerIcon(color, p.display_name || p.account);
    let m = markers.get(p.account);
    if (!m) {
      m = L.marker(latlng, { icon: iconWithName });
      m.on('click', () => selectPlayer(p.account, p.display_name));
      m.bindTooltip('', { className: 'player-tooltip', direction: 'top', offset: [0, -6] });
      m.addTo(markerLayer);
      markers.set(p.account, m);
    }
    m.setLatLng(latlng);
    m.setIcon(iconWithName);
    m.setTooltipContent(
      `<b>${p.display_name || p.account}</b><br>X ${p.x.toFixed(0)} Y ${p.y.toFixed(0)} Z ${p.z.toFixed(0)}` +
      (p.health != null ? `<br>HP ${p.health}` : '')
    );
  }

  function pruneMarkers(currentAccounts) {
    for (const [account, m] of markers) {
      if (!currentAccounts.has(account)) {
        markerLayer.removeLayer(m);
        markers.delete(account);
      }
    }
  }

  // ---- Server management ----------------------------------------------------
  let currentServerId = '';
  let serversList = [];

  async function loadServers() {
    try {
      const res = await fetch('/api/servers');
      serversList = await res.json();
      const sel = document.getElementById('server-selector');
      sel.innerHTML = '';
      if (serversList.length === 0) {
        sel.innerHTML = '<option value="">No servers configured</option>';
        return;
      }
      for (const s of serversList) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sel.appendChild(opt);
      }
      const settingsRes = await fetch('/api/settings');
      const settings = await settingsRes.json();
      currentServerId = settings.activeServerId || serversList[0].id;
      sel.value = currentServerId;
      renderServerList();
    } catch (e) {
      console.error('[servers] failed to load:', e);
    }
  }

  function renderServerList() {
    const el = document.getElementById('server-list');
    el.innerHTML = '';
    for (const s of serversList) {
      const item = document.createElement('div');
      item.className = 'server-item' + (s.id === currentServerId ? ' active' : '');
      item.innerHTML = `
        <span class="server-item-name">${s.name}</span>
        <span class="server-item-type">${s.mapType || 'auto'}</span>
        <span class="server-item-actions">
          ${s.id !== currentServerId ? `<button class="server-item-btn activate" data-id="${s.id}" title="Activate">ON</button>` : ''}
          <button class="server-item-btn delete" data-id="${s.id}" title="Remove">&times;</button>
        </span>
      `;
      el.appendChild(item);
    }
    el.querySelectorAll('.server-item-btn.activate').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); switchServer(btn.dataset.id); };
    });
    el.querySelectorAll('.server-item-btn.delete').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Remove this server?')) return;
        await fetch(`/api/servers/${btn.dataset.id}`, { method: 'DELETE' });
        await loadServers();
        renderServerList();
      };
    });
  }

  async function switchServer(serverId) {
    try {
      await fetch(`/api/servers/${serverId}/activate`, { method: 'POST' });
      currentServerId = serverId;
      document.getElementById('server-selector').value = serverId;
      invalidateTileCache();
      markers.clear();
      markerLayer.clearLayers();
      trailLayer.clearLayers();
      claimsLayer.clearLayers();
      selectedAccount = null;
      followMode = false;
      document.getElementById('btn-follow').classList.remove('active');
      document.getElementById('selected-banner').classList.add('hidden');
      document.getElementById('dossier-content').classList.add('hidden');
      document.getElementById('dossier-empty').classList.remove('hidden');
      await loadTileMeta();
      await loadRoster();
      loadClaims();
      loadAnalytics();
      refreshHeatmap();
      renderServerList();
    } catch (e) {
      console.error('[server-switch] failed:', e);
    }
  }

  document.getElementById('server-selector').onchange = (e) => {
    const serverId = e.target.value;
    if (serverId && serverId !== currentServerId) switchServer(serverId);
  };

  document.getElementById('btn-add-server').onclick = async () => {
    const nameEl = document.getElementById('settings-new-server-name');
    const urlEl = document.getElementById('settings-new-server-url');
    const typeEl = document.getElementById('settings-new-server-type');
    const statusEl = document.getElementById('server-add-status');
    const url = urlEl.value.trim();
    if (!url) { statusEl.textContent = 'Enter a URL first.'; return; }
    statusEl.textContent = 'Adding...';
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameEl.value.trim() || 'Server', url, mapType: typeEl.value || null }),
      });
      if (!res.ok) { const err = await res.json(); statusEl.textContent = 'Error: ' + (err.error || 'unknown'); return; }
      nameEl.value = ''; urlEl.value = ''; typeEl.value = '';
      statusEl.textContent = 'Server added.';
      await loadServers(); renderServerList();
    } catch (e) { statusEl.textContent = 'Failed: ' + e.message; }
  };

  // ---- Socket.IO replaced with polling ----------------------------------------
  const connDot = document.getElementById('conn-dot');
  const connLabel = document.getElementById('conn-label');

  setInterval(() => {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }) + ' UTC';
  }, 1000);

  map.on('mousemove', (e) => {
    const { x, z } = fromLatLng(e.latlng);
    document.getElementById('reticle-x').textContent = x.toFixed(1);
    document.getElementById('reticle-z').textContent = z.toFixed(1);
  });

  // ---- Roster / search -------------------------------------------------------
  let rosterCache = [];

  async function loadRoster() {
    const res = await fetch('/api/players');
    rosterCache = await res.json();
    renderRoster(rosterCache);
    document.getElementById('stat-tracked').textContent = rosterCache.length;
  }

  function renderRoster(list) {
    list = applyTownFilter(list);
    const el = document.getElementById('roster-list');
    el.innerHTML = '';
    for (const p of list) {
      const liveEntry = currentLive.find(lp => lp.account === p.account);
      const row = document.createElement('div');
      row.className = 'roster-item' + (p.account === selectedAccount ? ' selected' : '');
      row.setAttribute('data-account', p.account);
      const town = liveEntry && liveEntry.x != null ? getTownName(liveEntry.x, liveEntry.z) : null;
      row.innerHTML = `<span class="name"><span class="dot ${liveEntry ? 'on' : 'off'}"></span>${p.display_name || p.account}${town ? ` <span class="town-tag">${town}</span>` : ''}</span>`;
      row.onclick = () => selectPlayer(p.account, p.display_name);
      el.appendChild(row);
    }
  }

  function updateRosterDots() {
    const items = document.querySelectorAll('#roster-list .roster-item');
    const liveAccounts = new Set(currentLive.map(lp => lp.account));
    for (const item of items) {
      const acc = item.getAttribute('data-account');
      const dot = item.querySelector('.dot');
      if (dot && acc) {
        const isOnline = liveAccounts.has(acc);
        dot.classList.toggle('on', isOnline);
        dot.classList.toggle('off', !isOnline);
      }
    }
  }

  function updateRosterTowns() {
    const items = document.querySelectorAll('#roster-list .roster-item');
    for (const item of items) {
      const acc = item.getAttribute('data-account');
      const nameSpan = item.querySelector('.name');
      const existingTag = nameSpan ? nameSpan.querySelector('.town-tag') : null;
      const live = acc ? currentLive.find(lp => lp.account === acc) : null;
      const town = live && live.x != null ? getTownName(live.x, live.z) : null;
      if (town && nameSpan && !existingTag) {
        const tag = document.createElement('span');
        tag.className = 'town-tag';
        tag.textContent = town;
        nameSpan.appendChild(tag);
      } else if (!town && existingTag) {
        existingTag.remove();
      } else if (town && existingTag && existingTag.textContent !== town) {
        existingTag.textContent = town;
      }
    }
  }

  document.getElementById('search-input').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    if (!q) { renderRoster(rosterCache); return; }
    const res = await fetch('/api/players/search?q=' + encodeURIComponent(q));
    renderRoster(await res.json());
  });

  document.getElementById('town-filter').onchange = () => renderRoster(rosterCache);

  function applyTownFilter(list) {
    const town = document.getElementById('town-filter').value;
    if (!town) return list;
    const area = townAreas.find(a => a.label === town);
    if (!area) return list;
    return list.filter(p => {
      const live = currentLive.find(lp => lp.account === p.account);
      if (!live || live.x == null || live.z == null) return false;
      if (live.x < area.minX || live.x > area.maxX || live.z < area.minZ || live.z > area.maxZ) return false;
      return pointInPolygon(live.x, live.z, area.x, area.z);
    });
  }

  // ---- Selecting a player ---------------------------------------------------
  function currentRangeMs() {
    const startEl = document.getElementById('filter-start').value;
    const endEl = document.getElementById('filter-end').value;
    if (liveMode || (!startEl && !endEl)) {
      return { start: Date.now() - 60 * 60 * 1000, end: Date.now() };
    }
    return {
      start: startEl ? new Date(startEl).getTime() : 0,
      end: endEl ? new Date(endEl).getTime() : Date.now(),
    };
  }

  async function selectPlayer(account, displayName) {
    selectedAccount = account;
    document.getElementById('selected-banner').classList.remove('hidden');
    document.getElementById('selected-name').textContent = displayName || account;
    renderRoster(document.getElementById('search-input').value ? rosterCache.filter(p =>
      (p.display_name||'').toLowerCase().includes(document.getElementById('search-input').value.toLowerCase())) : rosterCache);
    for (const [acc, m] of markers) {
      const live = currentLive.find(lp => lp.account === acc);
      const name = (live && live.display_name) || acc;
      m.setIcon(playerIcon(acc === account ? '#ffb020' : '#34e58f', name));
    }
    await Promise.all([refreshDossier(account), refreshTrail(account), refreshHeatmap(), loadIntel(account)]);
  }

  document.getElementById('btn-deselect').onclick = () => {
    selectedAccount = null;
    followMode = false;
    document.getElementById('btn-follow').classList.remove('active');
    document.getElementById('selected-banner').classList.add('hidden');
    document.getElementById('dossier-content').classList.add('hidden');
    document.getElementById('dossier-empty').classList.remove('hidden');
    document.getElementById('tab-intel').style.display = 'none';
    document.querySelectorAll('.dossier-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.dossier-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.dossier-tab[data-tab="overview"]').classList.add('active');
    document.getElementById('tab-overview').classList.add('active');
    trailLayer.clearLayers();
    for (const [acc, m] of markers) {
      const live = currentLive.find(lp => lp.account === acc);
      const name = (live && live.display_name) || acc;
      m.setIcon(playerIcon('#34e58f', name));
    }
    refreshHeatmap();
  };

  document.getElementById('btn-focus').onclick = () => {
    const m = markers.get(selectedAccount);
    if (m) map.setView(m.getLatLng(), Math.max(map.getZoom(), 4));
  };

  document.getElementById('btn-follow').onclick = () => {
    followMode = !followMode;
    document.getElementById('btn-follow').classList.toggle('active', followMode);
    if (followMode && selectedAccount) {
      const m = markers.get(selectedAccount);
      if (m) map.setView(m.getLatLng(), Math.max(map.getZoom(), 4));
    }
  };

  // ESC to deselect player
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedAccount) {
      document.getElementById('btn-deselect').click();
    }
  });

  async function refreshDossier(account) {
    const { start, end } = currentRangeMs();
    const res = await fetch(`/api/players/${encodeURIComponent(account)}/stats?start=${start}&end=${end}`);
    if (!res.ok) return;
    const s = await res.json();
    document.getElementById('dossier-empty').classList.add('hidden');
    document.getElementById('dossier-content').classList.remove('hidden');
    document.getElementById('d-name').textContent = s.display_name;
    document.getElementById('d-account').textContent = '@' + s.account;
    document.getElementById('d-status').textContent = s.online ? 'ONLINE NOW' : 'LAST SEEN ' + new Date(s.last_seen).toLocaleString();
    // Make "LAST SEEN" clickable to teleport map to logout position
    const statusEl = document.getElementById('d-status');
    if (!s.online && s.last_x != null && s.last_z != null) {
      statusEl.classList.add('clickable');
      statusEl.style.cursor = 'pointer';
      statusEl.title = `Click to go to last position (${Math.round(s.last_x)}, ${Math.round(s.last_z)})`;
      statusEl.onclick = () => {
        const ll = toLatLng(s.last_x, s.last_z);
        map.flyTo(ll, Math.max(map.getZoom(), 5), { duration: 0.8 });
      };
    } else {
      statusEl.classList.remove('clickable');
      statusEl.style.cursor = '';
      statusEl.title = '';
      statusEl.onclick = null;
    }
    document.getElementById('d-distance').textContent = s.distance_blocks_2d.toLocaleString();
    document.getElementById('d-time').textContent = formatDuration(s.time_online_ms);
    document.getElementById('d-visits').textContent = s.visits;
    document.getElementById('d-fixes').textContent = s.positions_recorded;
    document.getElementById('d-first').textContent = s.first_seen ? new Date(s.first_seen).toLocaleDateString() : '\u2013';
    const live = currentLive.find(lp => lp.account === account);
    document.getElementById('d-town').textContent = (live && live.x != null && getTownName(live.x, live.z)) || 'Wilderness';
    refreshTownVisits(account);
  }

  async function refreshTrail(account) {
    if (!document.getElementById('toggle-trail').checked) {
      trailLayer.clearLayers();
      return;
    }
    const { start, end } = currentRangeMs();
    const world = tileMeta ? tileMeta.world : '';
    const [posRes, evtRes] = await Promise.all([
      fetch(`/api/players/${encodeURIComponent(account)}/history?start=${start}&end=${end}&world=${encodeURIComponent(world)}`),
      fetch(`/api/intel/events/${encodeURIComponent(account)}?start=${start}&end=${end}&type=teleport&limit=200`)
    ]);
    const points = await posRes.json();
    const evtData = await evtRes.json();

    // Build into temp layer, then swap atomically (no flicker)
    const tmp = L.layerGroup();

    if (points.length < 1) { trailLayer.clearLayers(); trailLayer = tmp; trailLayer.addTo(map); return; }

    // Collect teleport timestamps for gap detection
    // Use ONLY confirmed intel_events teleport data (not distance heuristics)
    const teleports = new Set();
    for (const ev of (evtData.events || [])) {
      teleports.add(ev.detected_at);
    }

    // Build segments: split at confirmed teleport events
    const segments = [];
    let currentSeg = [{ ll: toLatLng(points[0].x, points[0].z), ts: points[0].timestamp, x: points[0].x, z: points[0].z }];
    segments.push({ points: currentSeg, teleportBefore: false });

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];

      // Only split on confirmed teleport events (±2s tolerance for timestamp drift)
      let isTeleport = false;
      if (teleports.has(cur.timestamp) || teleports.has(prev.timestamp)) {
        isTeleport = true;
      } else {
        // Check if any teleport event falls between these two position timestamps
        for (const tpTs of teleports) {
          if (tpTs >= prev.timestamp && tpTs <= cur.timestamp) {
            isTeleport = true;
            break;
          }
        }
      }

      if (isTeleport) {
        currentSeg = [{ ll: toLatLng(cur.x, cur.z), ts: cur.timestamp, x: cur.x, z: cur.z }];
        segments.push({ points: currentSeg, teleportBefore: true });
      } else {
        currentSeg.push({ ll: toLatLng(cur.x, cur.z), ts: cur.timestamp, x: cur.x, z: cur.z });
      }
    }

    // Draw segments into temp layer
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      const latlngs = seg.points.map(p => p.ll);
      if (latlngs.length < 2) {
        if (latlngs.length === 1) {
          L.circleMarker(latlngs[0], { radius: 3, color: '#3ad6ff', fillColor: '#3ad6ff', fillOpacity: 1, weight: 1 }).addTo(tmp);
        }
        continue;
      }
      if (seg.teleportBefore && si > 0) {
        const prevSeg = segments[si - 1];
        if (prevSeg && prevSeg.points.length > 0) {
          const from = prevSeg.points[prevSeg.points.length - 1];
          const to = seg.points[0];
          // Use block distance for threshold — far teleports get dotted, close ones are solid
          const blockDist = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2);
          if (blockDist > 500) {
            // Long teleport — dotted red line
            L.polyline([from.ll, to.ll], { color: '#ff4444', weight: 2, opacity: 0.8, dashArray: '8 6' }).addTo(tmp);
            L.circleMarker(from.ll, { radius: 4, color: '#ff4444', fillColor: '#ff4444', fillOpacity: 0.8, weight: 1 }).addTo(tmp);
            L.circleMarker(to.ll, { radius: 4, color: '#ff4444', fillColor: '#ff4444', fillOpacity: 0.8, weight: 1 }).addTo(tmp);
          } else {
            // Short teleport — solid cyan (continuous line)
            L.polyline([from.ll, to.ll], { color: '#3ad6ff', weight: 2, opacity: 0.75 }).addTo(tmp);
          }
        }
      }
      L.polyline(latlngs, { color: '#3ad6ff', weight: 2, opacity: 0.75 }).addTo(tmp);
    }

    if (points.length > 0) {
      const startLL = toLatLng(points[0].x, points[0].z);
      L.circleMarker(startLL, { radius: 4, color: '#3ad6ff', fillOpacity: 1 }).addTo(tmp);
    }

    // Atomic swap: remove old, add new
    map.removeLayer(trailLayer);
    trailLayer = tmp;
    trailLayer.addTo(map);
  }

  let trailRefreshPending = false;
  function extendTrailLive() {
    if (trailRefreshPending) return;
    trailRefreshPending = true;
    setTimeout(() => { trailRefreshPending = false; refreshTrail(selectedAccount); }, 5000);
  }

  function formatDuration(ms) {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
  }

  async function refreshHeatmap() {
    if (!document.getElementById('toggle-heatmap').checked) { heatLayer.setLatLngs([]); return; }
    const { start, end } = currentRangeMs();
    const params = new URLSearchParams({ start, end });
    if (selectedAccount) params.set('account', selectedAccount);
    const res = await fetch('/api/heatmap?' + params.toString());
    const points = await res.json();
    heatLayer.setLatLngs(points.map(p => {
      const ll = toLatLng(p.x, p.z);
      return [ll.lat, ll.lng, 0.5];
    }));
  }
  setInterval(refreshHeatmap, 15000);

  function pointInPolygon(x, z, vsX, vsZ) {
    let inside = false;
    for (let i = 0, j = vsX.length - 1; i < vsX.length; j = i++) {
      if (((vsZ[i] > z) !== (vsZ[j] > z)) && (x < (vsX[j] - vsX[i]) * (z - vsZ[i]) / (vsZ[j] - vsZ[i]) + vsX[i])) inside = !inside;
    }
    return inside;
  }

  function getTownName(x, z) {
    for (const area of townAreas) {
      if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) continue;
      if (pointInPolygon(x, z, area.x, area.z)) return area.label;
    }
    return null;
  }

  async function refreshTownVisits(account) {
    const el = document.getElementById('d-town-visits');
    const { start, end } = currentRangeMs();
    const res = await fetch(`/api/players/${encodeURIComponent(account)}/history?start=${start}&end=${end}`);
    if (!res.ok) { el.innerHTML = '<span class="hint">No data</span>'; return; }
    const points = await res.json();
    if (!points.length || townAreas.length === 0) { el.innerHTML = '<span class="hint">No town visit data</span>'; return; }
    const visits = [];
    let currentTown = null, entryTime = null;
    for (const p of points) {
      const town = getTownName(p.x, p.z);
      if (town !== currentTown) {
        if (currentTown && entryTime) visits.push({ town: currentTown, from: entryTime, to: p.timestamp });
        currentTown = town || null;
        entryTime = town ? p.timestamp : null;
      }
    }
    if (currentTown && entryTime) visits.push({ town: currentTown, from: entryTime, to: points[points.length - 1].timestamp });
    if (!visits.length) { el.innerHTML = '<span class="hint">No town visits in this time range</span>'; return; }
    el.innerHTML = visits.reverse().map(v =>
      `<div class="town-visit"><span class="town-visit-name">${v.town}</span> <span class="town-visit-time">${new Date(v.from).toLocaleString()}</span></div>`
    ).join('');
  }

  // ---- Claims ---------------------------------------------------------------
  async function loadClaims() {
    claimsLayer.clearLayers();
    townAreas = [];
    const filterEl = document.getElementById('town-filter');
    filterEl.innerHTML = '<option value="">All towns</option>';
    if (!document.getElementById('toggle-claims').checked) return;
    try {
      const res = await fetch('/api/markers');
      if (!res.ok) {
        console.error('[claims] markers request failed:', res.status, res.statusText);
        return;
      }
      const data = await res.json();
      const townySet = data.sets && data.sets['towny.markerset'];
      if (!townySet || !townySet.areas) {
        console.warn('[claims] no towny.markerset.areas found');
        return;
      }
      let count = 0;
      for (const key in townySet.areas) {
        const area = townySet.areas[key];
        if (!area.x || !area.z || area.x.length === 0) continue;
        townAreas.push({
          label: area.label || key, x: area.x, z: area.z,
          minX: Math.min(...area.x), maxX: Math.max(...area.x),
          minZ: Math.min(...area.z), maxZ: Math.max(...area.z),
        });
        const opt = document.createElement('option');
        opt.value = area.label || key;
        opt.textContent = area.label || key;
        filterEl.appendChild(opt);
        const latlngs = area.x.map((xVal, idx) => toLatLng(xVal, area.z[idx]));
        const polygon = L.polygon(latlngs, {
          color: area.color || '#90EE90', weight: area.weight || 2,
          opacity: area.opacity || 0.8, fillColor: area.fillcolor || '#800080',
          fillOpacity: area.fillopacity || 0.2, interactive: true
        });
        if (area.desc) polygon.bindPopup(area.desc);
        else if (area.label) polygon.bindPopup(`<b>${area.label}</b>`);
        polygon.bindTooltip(area.label || 'Claim', { sticky: true });
        polygon.addTo(claimsLayer);
        count++;
      }
      console.log(`[claims] loaded ${count} town polygons`);
    } catch (err) { console.error('[claims] failed:', err); }
  }

  document.getElementById('toggle-heatmap').onchange = refreshHeatmap;
  document.getElementById('toggle-markers').onchange = (e) => {
    if (e.target.checked) markerLayer.addTo(map); else map.removeLayer(markerLayer);
  };
  document.getElementById('toggle-trail').onchange = () => { if (selectedAccount) refreshTrail(selectedAccount); };
  document.getElementById('toggle-grid').onchange = (e) => { gridEnabled = e.target.checked; drawGrid(); };
  document.getElementById('toggle-claims').onchange = loadClaims;

  document.getElementById('btn-apply-range').onclick = () => {
    liveMode = false; refreshHeatmap();
    if (selectedAccount) { refreshDossier(selectedAccount); refreshTrail(selectedAccount); }
  };
  document.getElementById('btn-clear-range').onclick = () => {
    liveMode = true;
    document.getElementById('filter-start').value = '';
    document.getElementById('filter-end').value = '';
    refreshHeatmap();
    if (selectedAccount) { refreshDossier(selectedAccount); refreshTrail(selectedAccount); }
  };

  function buildExportUrl(format) {
    const { start, end } = currentRangeMs();
    const params = new URLSearchParams({ start, end });
    if (selectedAccount) params.set('account', selectedAccount);
    return `/api/export/${format}?` + params.toString();
  }
  document.getElementById('btn-export-csv').onclick = () => window.open(buildExportUrl('csv'), '_blank');
  document.getElementById('btn-export-json').onclick = () => window.open(buildExportUrl('json'), '_blank');

  async function loadAnalytics() {
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) return;
      const data = await res.json();
      const townsBody = document.getElementById('towns-tbody');
      townsBody.innerHTML = data.towns && data.towns.length > 0
        ? data.towns.map(t => `<tr><td>${t.name}</td><td>${t.visitorsCount}</td><td>${t.fixesCount}</td><td>${t.activePlayer}</td></tr>`).join('')
        : '<tr><td colspan="4" style="color:var(--text-dim);">No town data available yet.</td></tr>';
      const explorersBody = document.getElementById('explorers-tbody');
      explorersBody.innerHTML = data.explorers && data.explorers.length > 0
        ? data.explorers.map(e => `<tr><td>${e.display_name}</td><td>${e.distance.toLocaleString()}</td></tr>`).join('')
        : '<tr><td colspan="2" style="color:var(--text-dim);">No explorer data available yet.</td></tr>';
    } catch (err) { console.error('[analytics] failed:', err); }
  }

  // Global events feed (overview tab)
  async function loadGlobalEvents(typeFilter) {
    const eventsEl = document.getElementById('global-events-list');
    if (!eventsEl) return;
    try {
      const url = typeFilter ? `/api/intel/events?type=${typeFilter}&limit=30` : '/api/intel/events?limit=30';
      const res = await fetch(url);
      if (!res.ok) { eventsEl.innerHTML = '<span class="hint">Failed to load events</span>'; return; }
      const events = await res.json();
      if (events && events.length > 0) {
        eventsEl.innerHTML = events.map(ev =>
          `<div class="intel-event-row" style="cursor:pointer" data-account="${ev.account}" data-name="${ev.display_name || ''}">
            <span class="intel-event-badge ${ev.event_type}">${ev.event_type.toUpperCase()}</span>
            <span class="intel-event-detail">${ev.display_name || ev.account}: ${ev.detail || ''}</span>
            <span class="intel-event-time">${new Date(ev.detected_at).toLocaleTimeString()}</span>
          </div>`
        ).join('');
        // Make events clickable to select player
        eventsEl.querySelectorAll('.intel-event-row[data-account]').forEach(row => {
          row.addEventListener('click', () => {
            const account = row.dataset.account;
            const name = row.dataset.name || account;
            selectPlayer(account, name);
          });
        });
      } else {
        eventsEl.innerHTML = '<span class="hint">No events yet</span>';
      }
    } catch (err) {
      eventsEl.innerHTML = '<span class="hint">Failed to load events</span>';
    }
  }

  // Wire up global event filters
  document.querySelectorAll('#global-event-filters .event-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#global-event-filters .event-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadGlobalEvents(btn.dataset.type || null);
    });
  });

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const s = await res.json();
      document.getElementById('settings-poll-interval').value = s.pollIntervalMs || 3000;
      document.getElementById('settings-offline-after').value = s.offlineAfterMissedPolls || 3;
    } catch (e) { console.error('[settings] failed to load:', e); }
  }

  document.getElementById('btn-save-settings').onclick = async () => {
    const statusEl = document.getElementById('settings-status');
    const body = {
      pollIntervalMs: parseInt(document.getElementById('settings-poll-interval').value, 10),
      offlineAfterMissedPolls: parseInt(document.getElementById('settings-offline-after').value, 10),
    };
    try {
      statusEl.textContent = 'Saving...';
      const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json(); statusEl.textContent = 'Error: ' + (err.error || 'unknown'); return; }
      statusEl.textContent = 'Settings saved.';
    } catch (e) { statusEl.textContent = 'Save failed: ' + e.message; }
  };

  function invalidateTileCache() {
    if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }
  }

  // ---- Intel Panel -----------------------------------------------------------
  document.querySelectorAll('.dossier-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dossier-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.dossier-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.getAttribute('data-tab') === 'intel' ? 'tab-intel-content' : 'tab-overview').classList.add('active');
    });
  });

  async function loadIntel(account) {
    if (!account) { document.getElementById('tab-intel').style.display = 'none'; return; }
    document.getElementById('tab-intel').style.display = '';
    const { start, end } = currentRangeMs();
    const params = `?start=${start}&end=${end}`;

    // Status: use live player data
    const live = currentLive.find(p => p.account === account);
    if (live) {
      document.getElementById('intel-status-online').textContent = 'ONLINE';
      document.getElementById('intel-status-online').style.color = '#34e58f';
      document.getElementById('intel-status-dot').className = 'intel-status-dot online';
      document.getElementById('intel-status-pos').textContent = `${Math.round(live.x)}, ${Math.round(live.z)}`;
      document.getElementById('intel-status-town').textContent = getTownName(live.x, live.z) || 'Wilderness';
    } else {
      document.getElementById('intel-status-online').textContent = 'OFFLINE';
      document.getElementById('intel-status-online').style.color = '#e55';
      document.getElementById('intel-status-dot').className = 'intel-status-dot offline';
      document.getElementById('intel-status-pos').textContent = '\u2013';
      document.getElementById('intel-status-town').textContent = '\u2013';
    }

    const [activity, sessions, anomalies, offlineWindows, associations, events] = await Promise.all([
      fetch(`/api/intel/activity-profile/${encodeURIComponent(account)}${params}`).then(r => r.json()).catch(() => null),
      fetch(`/api/intel/session-patterns/${encodeURIComponent(account)}${params}`).then(r => r.json()).catch(() => null),
      fetch(`/api/intel/anomalies${params}`).then(r => r.json()).catch(() => null),
      fetch(`/api/intel/offline-windows/${encodeURIComponent(account)}${params}`).then(r => r.json()).catch(() => null),
      fetch(`/api/intel/associations/${encodeURIComponent(account)}${params}`).then(r => r.json()).catch(() => null),
      fetch(`/api/intel/events/${encodeURIComponent(account)}${params}`).then(r => r.json()).catch(() => null),
    ]);

    // Status bar: time online
    if (sessions && sessions.avgDurationFormatted) {
      document.getElementById('intel-status-online-time').textContent = sessions.avgDurationFormatted;
    }

    // Activity stats
    if (activity) {
      document.getElementById('intel-sessions').textContent = activity.estimatedSessions ?? '\u2013';
      document.getElementById('intel-peak-hour').textContent = activity.peakHour != null ? `${String(activity.peakHour).padStart(2, '0')}:00` : '\u2013';
      document.getElementById('intel-peak-day').textContent = activity.peakDay ?? '\u2013';
    }
    if (sessions) {
      document.getElementById('intel-avg-session').textContent = sessions.avgDurationFormatted ?? '\u2013';
      document.getElementById('intel-max-session').textContent = sessions.maxDurationMs ? formatDuration(sessions.maxDurationMs) : '\u2013';
      document.getElementById('intel-avg-gap').textContent = sessions.avgGapFormatted ?? '\u2013';
    }

    // Hourly chart
    const chartEl = document.getElementById('intel-hourly-chart');
    chartEl.innerHTML = '';
    if (activity && activity.hourly) {
      const max = Math.max(...activity.hourly, 1);
      for (let h = 0; h < 24; h++) {
        const bar = document.createElement('div');
        bar.className = 'intel-chart-bar';
        bar.style.height = `${(activity.hourly[h] / max) * 100}%`;
        bar.title = `${String(h).padStart(2, '0')}:00 \u2014 ${activity.hourly[h]} fixes`;
        chartEl.appendChild(bar);
      }
    }

    // Anomalies (only show if flags exist)
    const anomaliesSection = document.getElementById('intel-anomalies-section');
    const flagsEl = document.getElementById('intel-flags');
    if (anomalies && anomalies.anomalies) {
      const match = anomalies.anomalies.find(a => a.account === account);
      if (match && match.flags.length > 0) {
        anomaliesSection.style.display = '';
        flagsEl.innerHTML = match.flags.map(f =>
          `<div class="intel-flag"><span class="intel-flag-type">${f.type}</span><span class="intel-flag-detail">${f.detail}</span></div>`
        ).join('');
      } else {
        anomaliesSection.style.display = 'none';
      }
    } else {
      anomaliesSection.style.display = 'none';
    }

    // Offline windows
    const offlineHighlight = document.getElementById('intel-offline-highlight');
    const offlineChart = document.getElementById('intel-offline-chart');
    if (offlineWindows && offlineWindows.windows && offlineWindows.windows.length > 0) {
      const best = offlineWindows.bestWindow;
      const bestH = offlineWindows.bestHour;
      const bestD = offlineWindows.bestDay;
      offlineHighlight.innerHTML = `
        <div class="intel-offline-badge"><span class="intel-offline-badge-label">BEST HOUR</span><span class="intel-offline-badge-value">${bestH.label}</span><span class="intel-offline-badge-sub">${bestH.offlineChance}% offline</span></div>
        <div class="intel-offline-badge"><span class="intel-offline-badge-label">BEST DAY</span><span class="intel-offline-badge-value">${bestD.day}</span><span class="intel-offline-badge-sub">${bestD.offlineChance}% offline</span></div>
        <div class="intel-offline-badge"><span class="intel-offline-badge-label">${best.windowSizeHours}H WINDOW</span><span class="intel-offline-badge-value">${best.startLabel}\u2013${best.endLabel}</span><span class="intel-offline-badge-sub">${best.offlineProbability}% offline</span></div>
        <div class="intel-offline-badge"><span class="intel-offline-badge-label">AVG SESSION</span><span class="intel-offline-badge-value">${offlineWindows.avgSessionLengthFormatted}</span></div>
        <div class="intel-offline-badge"><span class="intel-offline-badge-label">AVG OFFLINE</span><span class="intel-offline-badge-value">${offlineWindows.avgOfflineGapFormatted}</span></div>
      `;
      offlineChart.innerHTML = '';
      const offlineData = offlineWindows.offlinePattern || [];
      for (let h = 0; h < 24; h++) {
        const entry = offlineData[h];
        const bar = document.createElement('div');
        bar.className = 'intel-offline-bar';
        const chance = entry ? entry.offlineChance : 50;
        bar.style.height = `${Math.max(2, chance)}%`;
        bar.style.background = `rgb(${Math.round(52 + (255 - 52) * (1 - chance / 100))}, ${Math.round(229 * (chance / 100))}, ${Math.round(143 * (chance / 100))})`;
        bar.title = `${String(h).padStart(2, '0')}:00 \u2014 ${chance}% offline`;
        offlineChart.appendChild(bar);
      }
    } else {
      offlineHighlight.innerHTML = '<span class="hint">Insufficient data</span>';
      offlineChart.innerHTML = '';
    }

    // Associations
    const assocEl = document.getElementById('intel-associations');
    if (associations && associations.associates && associations.associates.length > 0) {
      assocEl.innerHTML = associations.associates.map(a => {
        const barWidth = Math.max(4, a.strength);
        return `<div class="intel-assoc-row" data-x="${a.avgLocation.x}" data-z="${a.avgLocation.z}">
          <div class="intel-assoc-name">${a.display_name || a.account}</div>
          <div class="intel-assoc-bar-track"><div class="intel-assoc-bar" style="width:${barWidth}%"></div></div>
          <div class="intel-assoc-meta">${a.cooccurrences} windows &middot; ~${a.avgDistance}m avg</div>
        </div>`;
      }).join('');
      assocEl.querySelectorAll('.intel-assoc-row[data-x]').forEach(row => {
        row.style.cursor = 'pointer';
        row.onclick = () => {
          map.setView(toLatLng(parseFloat(row.dataset.x), parseFloat(row.dataset.z)), 4);
        };
      });
    } else {
      assocEl.innerHTML = '<span class="hint">No co-location data</span>';
    }

    // Events (includes perimeter alerts as event_type)
    const eventsEl = document.getElementById('intel-events');
    if (events && events.events && events.events.length > 0) {
      eventsEl.innerHTML = events.events.slice(0, 25).map(ev =>
        `<div class="intel-event-row">
          <span class="intel-event-badge ${ev.event_type}">${ev.event_type.toUpperCase()}</span>
          <span class="intel-event-detail">${ev.detail || ''}</span>
          <span class="intel-event-time">${new Date(ev.detected_at).toLocaleTimeString()}</span>
        </div>`
      ).join('');
      // Wire up event filters
      eventsEl.parentElement.querySelectorAll('.event-filter').forEach(btn => {
        btn.onclick = async () => {
          eventsEl.parentElement.querySelectorAll('.event-filter').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const fType = btn.dataset.type;
          const fUrl = fType
            ? `/api/intel/events/${encodeURIComponent(account)}?type=${fType}&start=${start}&end=${end}`
            : `/api/intel/events/${encodeURIComponent(account)}?start=${start}&end=${end}`;
          const fRes = await fetch(fUrl).then(r => r.json()).catch(() => ({ events: [] }));
          if (fRes.events && fRes.events.length > 0) {
            eventsEl.innerHTML = fRes.events.slice(0, 25).map(ev =>
              `<div class="intel-event-row">
                <span class="intel-event-badge ${ev.event_type}">${ev.event_type.toUpperCase()}</span>
                <span class="intel-event-detail">${ev.detail || ''}</span>
                <span class="intel-event-time">${new Date(ev.detected_at).toLocaleTimeString()}</span>
              </div>`
            ).join('');
          } else {
            eventsEl.innerHTML = `<span class="hint">No ${fType || ''} events</span>`;
          }
        };
      });
    } else {
      eventsEl.innerHTML = '<span class="hint">No events detected</span>';
    }
  }

  // ---- Perimeter management ---------------------------------------------------
  let perimeterOverlays = [];
  let selectedShape = 'circle';
  let drawingMode = false;
  let drawTempLayer = null;
  let drawPoints = [];

  // Drawing tool buttons
  document.querySelectorAll('.draw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedShape = btn.dataset.shape;
      // Show/hide radius input based on shape
      document.getElementById('perimeter-radius-row').style.display = selectedShape === 'circle' ? '' : 'none';
    });
  });

  function buildPerimeterShape(perim, style) {
    const c = perim.color || '#ff4444';
    const type = perim.shape_type || 'circle';
    if (type === 'rectangle' && perim.shape_data) {
      const d = typeof perim.shape_data === 'string' ? JSON.parse(perim.shape_data) : perim.shape_data;
      return L.rectangle([toLatLng(d.x1, d.z1), toLatLng(d.x2, d.z2)], { color: c, fillColor: c, fillOpacity: 0.08, weight: 2, dashArray: '6 4', ...style });
    }
    if (type === 'polygon' && perim.shape_data) {
      const d = typeof perim.shape_data === 'string' ? JSON.parse(perim.shape_data) : perim.shape_data;
      const latlngs = d.vertices.map(v => toLatLng(v[0], v[1]));
      return L.polygon(latlngs, { color: c, fillColor: c, fillOpacity: 0.08, weight: 2, dashArray: '6 4', ...style });
    }
    // Default: circle
    return L.circle(toLatLng(perim.center_x, perim.center_z), { radius: perim.radius, color: c, fillColor: c, fillOpacity: 0.08, weight: 2, dashArray: '6 4', ...style });
  }

  async function loadPerimeters() {
    const res = await fetch('/api/perimeters');
    const perimeters = await res.json();
    const list = document.getElementById('perimeter-list');
    if (perimeters.length === 0) {
      list.innerHTML = '<span class="hint">No perimeters defined</span>';
    } else {
      list.innerHTML = perimeters.map(p =>
        `<div class="perimeter-item">
          <div class="perimeter-dot" style="background:${p.color}"></div>
          <span class="perimeter-item-name">${p.name}</span>
          <span class="perimeter-item-radius">${p.shape_type || 'circle'}</span>
          <span class="perimeter-item-del" data-id="${p.id}">&times;</span>
        </div>`
      ).join('');
      list.querySelectorAll('.perimeter-item-del').forEach(btn => {
        btn.onclick = async () => {
          await fetch(`/api/perimeters/${btn.dataset.id}`, { method: 'DELETE' });
          loadPerimeters();
        };
      });
    }
    renderPerimeterOverlays(perimeters);
  }

  async function renderPerimeterOverlays(perimeters) {
    if (!perimeters) {
      const res = await fetch('/api/perimeters');
      perimeters = await res.json();
    }
    perimeterOverlays.forEach(o => map.removeLayer(o));
    perimeterOverlays = [];
    for (const p of perimeters) {
      const layer = buildPerimeterShape(p, { interactive: false });
      layer.addTo(map);
      perimeterOverlays.push(layer);
    }
  }

  // Add perimeter at map center
  document.getElementById('btn-add-perimeter').onclick = async () => {
    const name = document.getElementById('perimeter-name').value.trim();
    if (!name) return;
    const center = map.getCenter();
    const { x, z } = fromLatLng(center);
    const radius = parseFloat(document.getElementById('perimeter-radius').value) || 500;
    const color = document.getElementById('perimeter-color').value;
    await fetch('/api/perimeters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, center_x: x, center_z: z, radius, color, shape_type: selectedShape }),
    });
    document.getElementById('perimeter-name').value = '';
    document.getElementById('perimeter-status').textContent = `Perimeter "${name}" created`;
    setTimeout(() => { document.getElementById('perimeter-status').textContent = ''; }, 3000);
    loadPerimeters();
  };

  // Drawing mode: click on map to draw shapes
  document.getElementById('btn-draw-perimeter').onclick = () => {
    if (drawingMode) {
      cancelDraw();
      return;
    }
    drawingMode = true;
    drawPoints = [];
    document.getElementById('btn-draw-perimeter').classList.add('btn-active');
    document.getElementById('perimeter-status').textContent = selectedShape === 'polygon'
      ? 'Click points on map. Double-click to finish.'
      : selectedShape === 'rectangle'
      ? 'Click two corners on the map.'
      : 'Click center, then click edge for radius.';
    document.getElementById('map').style.cursor = 'crosshair';
    map.on('click', onDrawClick);
    map.on('dblclick', onDrawDblClick);
  };

  function cancelDraw() {
    drawingMode = false;
    drawPoints = [];
    if (drawTempLayer) { map.removeLayer(drawTempLayer); drawTempLayer = null; }
    document.getElementById('btn-draw-perimeter').classList.remove('btn-active');
    document.getElementById('perimeter-status').textContent = '';
    document.getElementById('map').style.cursor = '';
    map.off('click', onDrawClick);
    map.off('dblclick', onDrawDblClick);
  }

  function onDrawClick(e) {
    const { x, z } = fromLatLng(e.latlng);
    drawPoints.push([x, z]);

    if (drawTempLayer) { map.removeLayer(drawTempLayer); drawTempLayer = null; }
    const color = document.getElementById('perimeter-color').value;

    if (selectedShape === 'circle' && drawPoints.length === 1) {
      // Show preview circle with default radius
      const r = parseFloat(document.getElementById('perimeter-radius').value) || 500;
      drawTempLayer = L.circle(e.latlng, { radius: r, color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '4 4' }).addTo(map);
    } else if (selectedShape === 'circle' && drawPoints.length === 2) {
      finalizeCircle();
    } else if (selectedShape === 'rectangle' && drawPoints.length <= 2) {
      if (drawPoints.length === 2) {
        finalizeRectangle();
      } else {
        drawTempLayer = L.rectangle([e.latlng, e.latlng], { color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '4 4' }).addTo(map);
        map.on('mousemove', onRectMouseMove);
      }
    } else if (selectedShape === 'polygon') {
      const latlngs = drawPoints.map(p => toLatLng(p[0], p[1]));
      drawTempLayer = L.polygon(latlngs, { color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '4 4' }).addTo(map);
    }
  }

  function onRectMouseMove(e) {
    if (!drawTempLayer || drawPoints.length !== 1) return;
    const { x: x2, z: z2 } = fromLatLng(e.latlng);
    drawTempLayer.setBounds([toLatLng(drawPoints[0][0], drawPoints[0][1]), toLatLng(x2, z2)]);
  }

  function onDrawDblClick(e) {
    if (selectedShape === 'polygon' && drawPoints.length >= 3) {
      finalizePolygon();
    }
  }

  async function finalizeCircle() {
    const [c, e] = drawPoints;
    const dist = Math.sqrt((e[0] - c[0]) ** 2 + (e[1] - c[1]) ** 2);
    const name = document.getElementById('perimeter-name').value.trim() || 'Zone';
    const color = document.getElementById('perimeter-color').value;
    await fetch('/api/perimeters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, center_x: c[0], center_z: c[1], radius: Math.round(dist), color, shape_type: 'circle' }),
    });
    document.getElementById('perimeter-name').value = '';
    cancelDraw();
    loadPerimeters();
  }

  async function finalizeRectangle() {
    const [c, e] = drawPoints;
    const name = document.getElementById('perimeter-name').value.trim() || 'Zone';
    const color = document.getElementById('perimeter-color').value;
    await fetch('/api/perimeters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, center_x: (c[0] + e[0]) / 2, center_z: (c[1] + e[1]) / 2, radius: 0, color, shape_type: 'rectangle', shape_data: { x1: c[0], z1: c[1], x2: e[0], z2: e[1] } }),
    });
    document.getElementById('perimeter-name').value = '';
    cancelDraw();
    loadPerimeters();
  }

  async function finalizePolygon() {
    const name = document.getElementById('perimeter-name').value.trim() || 'Zone';
    const color = document.getElementById('perimeter-color').value;
    const cx = drawPoints.reduce((s, p) => s + p[0], 0) / drawPoints.length;
    const cz = drawPoints.reduce((s, p) => s + p[1], 0) / drawPoints.length;
    await fetch('/api/perimeters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, center_x: cx, center_z: cz, radius: 0, color, shape_type: 'polygon', shape_data: { vertices: drawPoints } }),
    });
    document.getElementById('perimeter-name').value = '';
    cancelDraw();
    loadPerimeters();
  }

  // Manual check
  document.getElementById('btn-check-perimeter').onclick = async () => {
    document.getElementById('perimeter-status').textContent = 'Checking...';
    await fetch('/api/perimeter-alerts/check', { method: 'POST' });
    document.getElementById('perimeter-status').textContent = 'Check complete';
    setTimeout(() => { document.getElementById('perimeter-status').textContent = ''; }, 3000);
    if (selectedAccount) loadIntel(selectedAccount);
  };

  // ---- Coordinate search ------------------------------------------------------
  document.getElementById('btn-coord-go').onclick = () => {
    const x = parseFloat(document.getElementById('coord-search-x').value);
    const z = parseFloat(document.getElementById('coord-search-z').value);
    if (!isNaN(x) && !isNaN(z)) map.setView(toLatLng(x, z), Math.max(map.getZoom(), 4));
  };
  document.getElementById('coord-search-z').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-coord-go').click();
  });

  // ---- Bookmarks -------------------------------------------------------------
  const BOOKMARK_KEY = 'dynomap-bookmarks';
  function getBookmarks() { try { return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]'); } catch { return []; } }
  function saveBookmarks(bm) { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bm)); }

  function renderBookmarks() {
    const list = document.getElementById('bookmark-list');
    const bms = getBookmarks();
    if (bms.length === 0) { list.innerHTML = '<span class="hint">No bookmarks</span>'; return; }
    list.innerHTML = bms.map((b, i) =>
      `<div class="bookmark-item" data-idx="${i}">
        <span class="bookmark-icon">&#9873;</span>
        <span class="bookmark-name">${b.name}</span>
        <span class="bookmark-coords">${Math.round(b.x)},${Math.round(b.z)}</span>
        <span class="bookmark-del" data-idx="${i}">&times;</span>
      </div>`
    ).join('');
    list.querySelectorAll('.bookmark-item').forEach(el => {
      el.onclick = (e) => {
        if (e.target.classList.contains('bookmark-del')) return;
        const b = bms[parseInt(el.dataset.idx)];
        if (b) map.setView(toLatLng(b.x, b.z), Math.max(map.getZoom(), 4));
      };
    });
    list.querySelectorAll('.bookmark-del').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.idx);
        bms.splice(idx, 1);
        saveBookmarks(bms);
        renderBookmarks();
      };
    });
  }

  document.getElementById('btn-add-bookmark').onclick = () => {
    const center = map.getCenter();
    const { x, z } = fromLatLng(center);
    const name = prompt('Bookmark name:', `Location ${Math.round(x)},${Math.round(z)}`);
    if (!name) return;
    const bms = getBookmarks();
    bms.push({ name, x, z });
    saveBookmarks(bms);
    renderBookmarks();
  };

  // ---- Time presets -----------------------------------------------------------
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const hours = parseInt(btn.dataset.hours);
      if (hours === 0) {
        document.getElementById('filter-start').value = '';
        document.getElementById('filter-end').value = '';
      } else {
        const now = new Date();
        const from = new Date(now.getTime() - hours * 3600000);
        document.getElementById('filter-start').value = from.toISOString().slice(0, 16);
        document.getElementById('filter-end').value = now.toISOString().slice(0, 16);
      }
      document.getElementById('btn-apply-range').click();
    });
  });

  // ---- Fullscreen -------------------------------------------------------------
  document.getElementById('btn-fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  // ---- Keyboard shortcuts -----------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 'f': case 'F':
        e.preventDefault();
        document.getElementById('btn-fullscreen').click();
        break;
      case 'Escape':
        if (selectedAccount) document.getElementById('btn-deselect').click();
        break;
      case 's': case 'S':
        if (selectedAccount) {
          const m = markers.get(selectedAccount);
          if (m) map.setView(m.getLatLng(), Math.max(map.getZoom(), 4));
        }
        break;
      case 'l': case 'L':
        if (selectedAccount) {
          document.getElementById('btn-follow').click();
        }
        break;
      case '+': case '=':
        e.preventDefault();
        map.zoomIn();
        break;
      case '-': case '_':
        e.preventDefault();
        map.zoomOut();
        break;
      case 'g': case 'G':
        document.getElementById('toggle-grid').click();
        break;
      case 'h': case 'H':
        document.getElementById('toggle-heatmap').click();
        break;
      case 'p': case 'P':
        document.getElementById('toggle-markers').click();
        break;
      case 't': case 'T':
        document.getElementById('toggle-trail').click();
        break;
      case '1': map.setView(toLatLng(0, 0), 0); break;
    }
  });

  // ---- Distance measuring -----------------------------------------------------
  let measurePoints = [];
  let measureLayer = L.layerGroup().addTo(map);
  let measureActive = false;

  map.on('click', (e) => {
    if (!measureActive || drawingMode) return;
    const { x, z } = fromLatLng(e.latlng);
    measurePoints.push([x, z]);

    L.circleMarker(e.latlng, { radius: 4, color: '#3ad6ff', fillColor: '#3ad6ff', fillOpacity: 1 }).addTo(measureLayer);

    if (measurePoints.length >= 2) {
      const [a, b] = measurePoints.slice(-2);
      const dist = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
      const line = L.polyline([toLatLng(a[0], a[1]), toLatLng(b[0], b[1])], { color: '#3ad6ff', weight: 2, dashArray: '4 4' }).addTo(measureLayer);
      L.marker((line.getLatLngs()[0]), {
        icon: L.divIcon({ className: 'measure-tooltip', html: `${Math.round(dist)}m`, iconSize: [0, 0] }),
        interactive: false
      }).addTo(measureLayer);

      // Show total
      let total = 0;
      for (let i = 1; i < measurePoints.length; i++) {
        total += Math.sqrt((measurePoints[i][0] - measurePoints[i-1][0]) ** 2 + (measurePoints[i][1] - measurePoints[i-1][1]) ** 2);
      }
      document.getElementById('reticle-z').textContent = `TOTAL: ${Math.round(total)}m`;
    }
  });

  map.on('contextmenu', () => {
    if (!measureActive) return;
    measureActive = false;
    measurePoints = [];
    measureLayer.clearLayers();
  });

  // Measure mode toggle via double-click on reticle
  document.getElementById('reticle-x').parentElement.addEventListener('dblclick', () => {
    measureActive = !measureActive;
    if (!measureActive) {
      measurePoints = [];
      measureLayer.clearLayers();
    }
    document.getElementById('reticle-x').style.color = measureActive ? '#3ad6ff' : '';
  });

  // ---- Boot -----------------------------------------------------------------
  async function boot() {
    await loadServers();
    await loadSettings();
    await loadRoster();
    await loadTileMeta();
    loadClaims();
    loadAnalytics();
    loadGlobalEvents();
    loadPerimeters();
    renderBookmarks();
    const overview = await (await fetch('/api/stats/overview')).json();
    document.getElementById('stat-tracked').textContent = overview.totalPlayers;
    document.getElementById('stat-points').textContent = overview.totalPositions.toLocaleString();
    refreshHeatmap();
    setInterval(loadRoster, 20000);
    setInterval(async () => {
      const o = await (await fetch('/api/stats/overview')).json();
      document.getElementById('stat-points').textContent = o.totalPositions.toLocaleString();
    }, 20000);
    setInterval(loadAnalytics, 30000);
    setInterval(loadGlobalEvents, 15000);
  }
  boot();
})();
