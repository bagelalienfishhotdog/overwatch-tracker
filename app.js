(() => {
  'use strict';
  let authToken = localStorage.getItem('auth_token');
  let currentUser = null;
  function getAuthHeaders() { return authToken ? { 'Authorization': `Bearer ${authToken}` } : {}; }
  function clearAuthToken() { authToken = null; currentUser = null; localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); }
  const origFetch = window.fetch;
  window.fetch = function(url, opts = {}) { opts.headers = { ...opts.headers, ...getAuthHeaders() }; return origFetch(url, opts).then(r => { if (r.status === 401 && authToken) { clearAuthToken(); window.location.href = '/login.html'; } return r; }); };

  async function checkAuth() {
    if (!authToken) { window.location.href = '/login.html'; return; }
    try { const r = await fetch('/api/auth/me'); if (!r.ok) { clearAuthToken(); window.location.href = '/login.html'; return; } const d = await r.json(); currentUser = d.user; } catch { clearAuthToken(); window.location.href = '/login.html'; }
  }
  checkAuth();

  // Map
  let MAP_SCALE = 1, TILE_SIZE = 128, NATIVE_ZOOM = 5, WORLD_TO_MAP = null;
  function toLatLng(x, z) {
    if (WORLD_TO_MAP) { const w = WORLD_TO_MAP; const a = w[3]*x+w[5]*z, r = w[0]*x+w[2]*z; const d = 1 << NATIVE_ZOOM; return L.latLng(-((TILE_SIZE-a)/d), r/d); }
    return L.latLng(-z*MAP_SCALE, x*MAP_SCALE);
  }
  function fromLatLng(ll) {
    if (WORLD_TO_MAP) { const w = WORLD_TO_MAP; const d = 1 << NATIVE_ZOOM; return { x: ll.lng*d/w[0], z: (TILE_SIZE+ll.lat*d)/w[5] }; }
    return { x: ll.lng/MAP_SCALE, z: -ll.lat/MAP_SCALE };
  }

  const map = L.map('map', { crs: L.CRS.Simple, zoomControl: true, minZoom: 0, maxZoom: 8, attributionControl: false, preferCanvas: true }).setView([0, 0], 4);
  const markerLayer = L.layerGroup().addTo(map);
  const markers = new Map();
  let currentLive = [], selectedAccount = null, liveMode = true, mapCentered = false, followMode = false;

  function playerIcon(color, name) {
    return L.divIcon({ className: 'player-icon', html: `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;"><div style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};border:1px solid #05100a;flex-shrink:0;"></div><span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#d9f2e6;text-shadow:0 1px 3px rgba(0,0,0,0.9);">${name}</span></div>`, iconSize: [0, 0] });
  }
  function upsertMarker(p) {
    const ll = toLatLng(p.x, p.z);
    const color = p.account === selectedAccount ? '#ffb020' : '#34e58f';
    const icon = playerIcon(color, p.display_name || p.account);
    let m = markers.get(p.account);
    if (!m) { m = L.marker(ll, { icon }); m.on('click', () => selectPlayer(p.account, p.display_name)); m.addTo(markerLayer); markers.set(p.account, m); }
    m.setLatLng(ll); m.setIcon(icon);
    m.setTooltipContent(`<b>${p.display_name||p.account}</b><br>X ${p.x.toFixed(0)} Z ${p.z.toFixed(0)}`);
  }
  function pruneMarkers(accounts) { for (const [a, m] of markers) { if (!accounts.has(a)) { markerLayer.removeLayer(m); markers.delete(a); } } }

  // Roster
  let rosterCache = [];
  async function loadRoster() { const r = await fetch('/api/players'); rosterCache = await r.json(); renderRoster(rosterCache); document.getElementById('stat-tracked').textContent = rosterCache.length; }
  function renderRoster(list) {
    const el = document.getElementById('roster-list'); el.innerHTML = '';
    for (const p of list) {
      const live = currentLive.find(lp => lp.account === p.account);
      const row = document.createElement('div');
      row.className = 'roster-item' + (p.account === selectedAccount ? ' selected' : '');
      row.innerHTML = `<span class="name"><span class="dot ${live?'on':'off'}"></span>${p.display_name||p.account}</span>`;
      row.onclick = () => selectPlayer(p.account, p.display_name);
      el.appendChild(row);
    }
  }
  document.getElementById('search-input').addEventListener('input', e => { const q = e.target.value.trim(); if (!q) { renderRoster(rosterCache); return; } renderRoster(rosterCache.filter(p => (p.display_name||'').toLowerCase().includes(q.toLowerCase()) || p.account.toLowerCase().includes(q.toLowerCase()))); });

  // Player selection
  async function selectPlayer(account, name) {
    selectedAccount = account;
    document.getElementById('selected-banner').classList.remove('hidden');
    document.getElementById('selected-name').textContent = name || account;
    for (const [a, m] of markers) { m.setIcon(playerIcon(a === account ? '#ffb020' : '#34e58f', (currentLive.find(lp => lp.account === a)?.display_name) || a)); }
    document.getElementById('dossier-empty').classList.add('hidden');
    document.getElementById('dossier-content').classList.remove('hidden');
    const r = await fetch(`/api/players/${encodeURIComponent(account)}/stats`);
    const s = await r.json();
    document.getElementById('d-name').textContent = s.display_name;
    document.getElementById('d-account').textContent = '@' + s.account;
    document.getElementById('d-status').textContent = s.online ? 'ONLINE NOW' : 'LAST SEEN ' + new Date(s.last_seen).toLocaleString();
    document.getElementById('d-distance').textContent = s.distance_blocks_2d.toLocaleString();
    document.getElementById('d-time').textContent = Math.floor(s.time_online_ms/3600000)+'h '+Math.floor((s.time_online_ms%3600000)/60000)+'m';
    document.getElementById('d-visits').textContent = s.visits;
    document.getElementById('d-fixes').textContent = s.positions_recorded;
  }
  document.getElementById('btn-deselect').onclick = () => { selectedAccount = null; followMode = false; document.getElementById('btn-follow').classList.remove('active'); document.getElementById('selected-banner').classList.add('hidden'); document.getElementById('dossier-content').classList.add('hidden'); document.getElementById('dossier-empty').classList.remove('hidden'); };
  document.getElementById('btn-focus').onclick = () => { const m = markers.get(selectedAccount); if (m) map.setView(m.getLatLng(), Math.max(map.getZoom(), 4)); };
  document.getElementById('btn-follow').onclick = () => { followMode = !followMode; document.getElementById('btn-follow').classList.toggle('active', followMode); };
  document.getElementById('btn-coord-go').onclick = () => { const x = parseFloat(document.getElementById('coord-search-x').value), z = parseFloat(document.getElementById('coord-search-z').value); if (!isNaN(x) && !isNaN(z)) map.setView(toLatLng(x, z), Math.max(map.getZoom(), 4)); };
  document.getElementById('btn-fullscreen').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); };
  document.getElementById('btn-logout').onclick = () => { clearAuthToken(); window.location.href = '/login.html'; };
  document.getElementById('btn-logout').style.display = '';

  // Clock
  setInterval(() => { document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }); }, 1000);

  // Map coords
  map.on('mousemove', e => { const { x, z } = fromLatLng(e.latlng); document.getElementById('reticle-x').textContent = x.toFixed(1); document.getElementById('reticle-z').textContent = z.toFixed(1); });
  map.on('zoomend', () => { document.getElementById('zoom-level').textContent = map.getZoom(); });

  // Polling
  async function pollPlayers() {
    try {
      const r = await fetch('/api/players/live');
      if (!r.ok) throw new Error('Failed');
      const players = await r.json();
      connDot.classList.add('live'); connLabel.textContent = 'LIVE';
      currentLive = players;
      document.getElementById('stat-online').textContent = players.length;
      const accounts = new Set(currentLive.map(p => p.account));
      for (const p of currentLive) upsertMarker(p);
      pruneMarkers(accounts);
      if (followMode && selectedAccount) { const live = currentLive.find(p => p.account === selectedAccount); if (live) map.panTo(toLatLng(live.x, live.z)); }
      if (!mapCentered && currentLive.length > 0) { mapCentered = true; const bounds = L.latLngBounds(currentLive.map(p => toLatLng(p.x, p.z))); map.fitBounds(bounds.pad(0.2), { maxZoom: 4 }); }
    } catch { connDot.classList.remove('live'); connLabel.textContent = 'OFFLINE'; }
  }
  const connDot = document.getElementById('conn-dot');
  const connLabel = document.getElementById('conn-label');
  setInterval(pollPlayers, 3000);
  pollPlayers();
  loadRoster();
})();
