/*
 Devil's Witness — script.js
 Blockchain core: SHA-256 mining, cascade tamper detection, dual-ledger
 (Evidence Vault + Evidence Trail), live heartbeat ECG canvas.
*/

// ── DOM references ────────────────────────────────────────────────
const bgCanvas    = document.getElementById('bg-canvas');
const radarCanvas = document.getElementById('radar-canvas');
const loader      = document.getElementById('loader');
const loaderLine  = document.getElementById('loader-line');
const loaderSub   = document.getElementById('loader-sub');
const loaderHeart = document.getElementById('loader-heart');
const cursorEl    = document.getElementById('cursor');
const msgEl       = document.getElementById('msg');
const editModal   = document.getElementById('editModal');
const editForm    = document.getElementById('edit-form');
const trailEditModal = document.getElementById('trailEditModal');
const trailEditForm  = document.getElementById('trail-edit-form');
const hbCanvas    = document.getElementById('hb-canvas');
const hbCtx       = hbCanvas ? hbCanvas.getContext('2d') : null;
const brandLogo   = document.getElementById('brandLogo');
const logoUpload  = document.getElementById('logoUpload');

let bgCtx, radarCtx, w, h;
let particles  = [];
let flareNodes = [];
let sonarPulses = [];

// ══════════════════════════════════════════════════════════════════
// HEARTBEAT ECG CANVAS
// Speed and visual state tied to combined chain health
// ══════════════════════════════════════════════════════════════════

// ECG pattern: 40 samples representing one heartbeat cycle
// Values roughly −12 to +16 (centre = 0, positive = up)
const ECG_PATTERN = [
  0, 0, 0, 0, 0, 1, 2, 1, 0, 0,      // P-wave
  0, -3, 16, -8, 2, 0, 0, 0, 0, 0,   // QRS complex (sharp spike)
  0, 0, 4,  6,  4, 1, 0, 0, 0, 0,    // T-wave
  0, 0, 0,  0,  0, 0, 0, 0, 0, 0,    // Flat baseline
];
const ECG_LEN = ECG_PATTERN.length;

let hbScrollX    = 0;
let hbHealthRatio = 0;   // 0 = healthy (green chain),  1 = fully tampered (flatline/noise)

/** Called after every validateChain / validateTrailChain to sync heartbeat state. */
function updateHeartbeatState() {
  const mainTampered  = ledger.filter(b => b.status === 'tampered').length;
  const trailTampered = trailLedger.filter(b => b.status === 'tampered').length;
  const mainTotal  = Math.max(0, ledger.length - 1);
  const trailTotal = Math.max(0, trailLedger.length - 1);
  const total   = mainTotal + trailTotal;
  const damaged = mainTampered + trailTampered;
  hbHealthRatio = total > 0 ? Math.min(1, damaged / total) : 0;
  if (hbCanvas) hbCanvas.classList.toggle('hb-tampered', hbHealthRatio > 0.2);
}

let hbSized = false;
function drawHBLine() {
  if (!hbCtx || !hbCanvas) { requestAnimationFrame(drawHBLine); return; }

  const cw = hbCanvas.offsetWidth;
  const ch = hbCanvas.offsetHeight || 42;
  if (cw < 1) { requestAnimationFrame(drawHBLine); return; }

  // Resize backing store if CSS size changed
  const pw = Math.round(cw * devicePixelRatio);
  const ph = Math.round(ch * devicePixelRatio);
  if (!hbSized || hbCanvas.width !== pw || hbCanvas.height !== ph) {
    hbCanvas.width  = pw;
    hbCanvas.height = ph;
    hbCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    hbSized = true;
  }

  const now = performance.now();
  hbCtx.clearRect(0, 0, cw, ch);

  hbCanvas.style.filter = hbHealthRatio > 0.2 ? `blur(${Math.min(2.1, hbHealthRatio * 2.4)}px)` : 'none';
  hbCanvas.style.opacity = `${0.92 - Math.min(0.18, hbHealthRatio * 0.18)}`;

  const speed = 1.2 + hbHealthRatio * 3.0;
  hbScrollX += speed;

  const mid    = ch * 0.52;
  const maxAmp = Math.max(6, mid - 6);
  const amp    = maxAmp * Math.max(0.14, 1 - hbHealthRatio * 0.7);
  const drift  = Math.sin(now / 930) * hbHealthRatio * 3.2;

  const color = hbHealthRatio > 0.7 ? '#ff0f18'
              : hbHealthRatio > 0.25 ? '#ff4736'
              : '#ff9fa8';

  hbCtx.beginPath();
  hbCtx.strokeStyle = color;
  hbCtx.lineWidth   = 1.8;
  hbCtx.lineJoin    = 'round';
  hbCtx.lineCap     = 'round';
  hbCtx.shadowColor = color;
  hbCtx.shadowBlur  = hbHealthRatio * 8;

  const pxPerSample = cw / (ECG_LEN * 0.64);
  const flattenAmt  = Math.min(1, hbHealthRatio * 0.85);
  const noiseScale  = 0.18 + hbHealthRatio * 0.38;

  for (let x = 0; x <= cw; x += 1) {
    const samplePos = (x + hbScrollX) / pxPerSample;
    const ecgIdx = Math.floor(samplePos) % ECG_LEN;
    const nextIdx = (ecgIdx + 1) % ECG_LEN;
    const frac = samplePos - Math.floor(samplePos);
    const rawVal = ECG_PATTERN[ecgIdx] + (ECG_PATTERN[nextIdx] - ECG_PATTERN[ecgIdx]) * frac;
    const wave = rawVal * (1 - flattenAmt * 0.72);
    const noise = (Math.random() - 0.5) * noiseScale * maxAmp;
    const baseline = drift + Math.sin(x * 0.09 + now * 0.003) * hbHealthRatio * 1.8;

    let y;
    if (hbHealthRatio >= 0.94) {
      y = mid + Math.sin(x * 0.08 + now * 0.0028) * 1.4 + noise * 0.25 + baseline * 0.3;
    } else {
      y = mid - (wave / 18) * amp + noise * 0.35 + baseline * 0.25;
    }

    if (x === 0) hbCtx.moveTo(x, y);
    else          hbCtx.lineTo(x, y);
  }
  hbCtx.stroke();
  requestAnimationFrame(drawHBLine);
}

// ══════════════════════════════════════════════════════════════════
// CANVAS BACKGROUND  (particles, flare nodes, scan lines, sonar)
// ══════════════════════════════════════════════════════════════════
function resizeCanvases() {
  w = window.innerWidth;
  h = window.innerHeight;
  [bgCanvas, radarCanvas].forEach((c) => {
    c.width  = w * devicePixelRatio;
    c.height = h * devicePixelRatio;
    c.style.width  = `${w}px`;
    c.style.height = `${h}px`;
  });
  bgCtx    = bgCanvas.getContext('2d');
  radarCtx = radarCanvas.getContext('2d');
  bgCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  radarCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function initVisuals() {
  particles  = [];
  flareNodes = [];
  sonarPulses = [];
  const pcount = Math.max(80, Math.round(window.innerWidth / 12));
  for (let i = 0; i < pcount; i++) {
    particles.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.2)  * 0.24,
      size:  0.6 + Math.random() * 2.2,
      alpha: 0.08 + Math.random() * 0.22,
    });
  }
  const fcount = Math.max(12, Math.round(window.innerWidth / 220));
  for (let i = 0; i < fcount; i++) {
    flareNodes.push({
      x: Math.random() * w, y: Math.random() * h,
      size:  18 + Math.random() * 24,
      speed: 0.02 + Math.random() * 0.04,
      alpha: 0.12 + Math.random() * 0.24,
    });
  }
}

let lastTime = 0;
function drawBackground(time) {
  try {
    const dt = Math.min(40, time - lastTime);
    lastTime = time;
    bgCtx.clearRect(0, 0, w, h);

    const bgGrad = bgCtx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, 'rgba(12,4,6,0.22)');
    bgGrad.addColorStop(1, 'rgba(3,3,5,0.96)');
    bgCtx.fillStyle = bgGrad;
    bgCtx.fillRect(0, 0, w, h);

    particles.forEach((p) => {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
      bgCtx.beginPath();
      bgCtx.fillStyle = `rgba(255,${30 + Math.round(Math.random() * 50)},${30 + Math.round(Math.random() * 70)},${p.alpha})`;
      bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      bgCtx.fill();
    });

    flareNodes.forEach((flare) => {
      flare.x += Math.sin(time / 2400) * 0.03;
      flare.y += Math.cos(time / 1900) * 0.02;
      bgCtx.beginPath();
      const g = bgCtx.createRadialGradient(flare.x, flare.y, 0, flare.x, flare.y, flare.size);
      g.addColorStop(0, `rgba(255,40,40,${flare.alpha})`);
      g.addColorStop(1, 'rgba(255,40,40,0)');
      bgCtx.fillStyle = g;
      bgCtx.fillRect(flare.x - flare.size, flare.y - flare.size, flare.size * 2, flare.size * 2);
    });

    bgCtx.save();
    bgCtx.globalAlpha = 0.05; bgCtx.strokeStyle = '#ff2b3b'; bgCtx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const x = (i * 200 + time / 18) % w;
      bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x + 80, h); bgCtx.stroke();
    }
    bgCtx.restore();

    bgCtx.save();
    bgCtx.globalAlpha = 0.12; bgCtx.fillStyle = '#ff4a5a';
    flareNodes.forEach((flare, idx) => {
      const radius = flare.size * (0.7 + Math.sin(time / 1100 + idx) * 0.2);
      bgCtx.beginPath(); bgCtx.arc(flare.x, flare.y, radius, 0, Math.PI * 2); bgCtx.fill();
    });
    bgCtx.restore();

    for (let i = sonarPulses.length - 1; i >= 0; i--) {
      const pulse = sonarPulses[i];
      const age = (time - pulse.t) / 1000;
      if (age > 2.2) { sonarPulses.splice(i, 1); continue; }
      bgCtx.beginPath();
      bgCtx.strokeStyle = `rgba(255,40,40,${0.35 * (1 - age)})`;
      bgCtx.lineWidth = 1.4 + age * 3;
      bgCtx.arc(pulse.x, pulse.y, age * 220, 0, Math.PI * 2);
      bgCtx.stroke();
    }
  } catch (err) { console.error('Background render error', err); }
  requestAnimationFrame(drawBackground);
}

let radarTime = 0;
function drawRadar(time) {
  try {
    radarCtx.clearRect(0, 0, w, h);
    radarTime = time;

    radarCtx.globalAlpha = 0.06; radarCtx.strokeStyle = '#ff3b3b'; radarCtx.lineWidth = 0.7;
    for (let i = 0; i < 12; i++) {
      const x = ((i * 180) + time / 20) % w;
      const y = h * 0.12 + Math.sin((time / 1400) + i) * 28;
      radarCtx.beginPath(); radarCtx.moveTo(x, 0); radarCtx.lineTo(x + 90, h); radarCtx.stroke();
    }
    radarCtx.globalAlpha = 1;

    const centerX = Math.max(220, w * 0.5 + Math.sin(time / 1950) * 120);
    const centerY = Math.max(220, h * 0.4 + Math.cos(time / 1750) * 55);
    for (let i = 0; i < 4; i++) {
      const r = ((time / 900 + i * 0.7) % 1) * Math.min(w, h) / 1.8;
      radarCtx.beginPath();
      radarCtx.strokeStyle = `rgba(255,30,30,${0.07 - i * 0.01})`;
      radarCtx.lineWidth = 1.4;
      radarCtx.arc(centerX, centerY, r, 0, Math.PI * 2); radarCtx.stroke();
    }

    radarCtx.fillStyle = 'rgba(255,255,255,0.04)';
    radarCtx.font = '10px monospace';
    for (let i = 0; i < 18; i++) {
      const hx = (i * 183 + time / 18) % w;
      const hy = (i * 93 + Math.sin((time / 1200) + i) * 42) % h;
      radarCtx.fillText(Math.random() > 0.7 ? 'ab12f6' : 'c3d9a0', hx, hy);
    }
  } catch (err) { console.error('Radar render error', err); }
  requestAnimationFrame(drawRadar);
}

window.addEventListener('mousemove', (e) => {
  cursorEl.style.left = `${e.clientX}px`;
  cursorEl.style.top  = `${e.clientY}px`;
  if (Math.random() > 0.95)
    sonarPulses.push({ x: e.clientX, y: e.clientY, t: performance.now() });
});

setInterval(() => {
  sonarPulses.push({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, t: performance.now() });
}, 1400);

document.addEventListener('mouseover', (ev) => {
  const el = ev.target.closest('.card, .block-card, .dash-card, .btn');
  if (el) {
    const rect = el.getBoundingClientRect();
    const s = document.createElement('div');
    s.className = 'sonar';
    s.style.left   = `${rect.left + rect.width  / 2}px`;
    s.style.top    = `${rect.top  + rect.height / 2}px`;
    s.style.width  = s.style.height = `${Math.max(rect.width, rect.height) * 2}px`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1600);
  }
});

function startVisualLoop() {
  resizeCanvases();
  initVisuals();
  requestAnimationFrame(drawBackground);
  requestAnimationFrame(drawRadar);
  requestAnimationFrame(drawHBLine);
}
window.addEventListener('resize', resizeCanvases);

// ══════════════════════════════════════════════════════════════════
// LOADER SEQUENCE
// ══════════════════════════════════════════════════════════════════
async function runLoaderSequence() {
  const steps = [
    { text: "Initializing Devil's Witness...", sub: 'Scanning Evidence...' },
    { text: 'Listening to the chain...',       sub: 'Verifying Chain...' },
    { text: 'Integrity Confirmed.',            sub: 'Access Granted.' },
  ];
  for (let i = 0; i < steps.length; i++) {
    loaderLine.textContent = '';
    const phrase = steps[i].text;
    for (let j = 0; j < phrase.length; j++) {
      loaderLine.textContent += phrase[j];
      await new Promise((r) => setTimeout(r, 14 + Math.random() * 16));
    }
    loaderSub.textContent = steps[i].sub;
    loaderHeart.style.animationDuration = `${1.8 - i * 0.2}s`;
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 520));
  }
  await new Promise((r) => setTimeout(r, 550));
  loader.style.opacity   = 0;
  loader.style.transform = 'translateY(-28px)';
  setTimeout(() => loader.remove(), 900);
}

// ══════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════
function showMessage(text, timeout = 3600) {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  clearTimeout(msgEl._t);
  msgEl._t = setTimeout(() => msgEl.classList.remove('show'), timeout);
}

const $  = (sel) => document.querySelector(sel);
const qs = (sel) => document.querySelectorAll(sel);

function bufToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data) {
  let buf;
  if (data instanceof ArrayBuffer)  buf = data;
  else if (typeof data === 'string') buf = new TextEncoder().encode(data);
  else if (data instanceof Uint8Array) buf = data;
  else throw new Error('Unsupported type for hashing');
  return bufToHex(await crypto.subtle.digest('SHA-256', buf));
}

function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[&<>"']/g, (m) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// ══════════════════════════════════════════════════════════════════
// MAIN EVIDENCE LEDGER  (Vault blockchain)
// ══════════════════════════════════════════════════════════════════
let ledger      = [];
let difficulty  = 3;
let pendingCount = 0;
let stats = { uploaded: 0, verified: 0, tampered: 0 };

async function createGenesis() {
  const genesis = {
    index: 0, timestamp: new Date().toISOString(),
    caseNumber: 'GENESIS', evidenceID: 'GEN-000',
    evidenceType: 'system', officerName: 'SYSTEM',
    description: 'Ledger initialized.', evidenceHash: '0'.repeat(64),
    previousHash: '0'.repeat(64), nonce: 0, hash: null, status: 'valid',
  };
  genesis.hash = await calcHash(genesis);
  ledger = [genesis];
}

function calcHash(block) {
  const base = `${block.index}|${block.timestamp}|${block.caseNumber}|${block.evidenceID}|${block.evidenceType}|${block.officerName}|${block.description}|${block.evidenceHash}|${block.previousHash}|${block.nonce}`;
  return sha256Hex(base);
}

async function mineBlockAsync(block, onProgress) {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    block.nonce = nonce;
    const h = await calcHash(block);
    if (h.startsWith(target)) { block.hash = h; block.status = 'valid'; return block; }
    if (nonce % 60 === 0 && typeof onProgress === 'function') onProgress(nonce);
    nonce++;
  }
}

async function addEvidenceBlock(data) {
  const prev = ledger[ledger.length - 1];
  const newBlock = {
    index: ledger.length, timestamp: new Date().toISOString(),
    caseNumber:   data.caseNumber,
    evidenceID:   data.evidenceID,
    evidenceType: data.evidenceType,
    officerName:  data.officerName,
    description:  data.description,
    evidenceHash: data.evidenceHash,
    previousHash: typeof prev.hash === 'string' ? prev.hash : (prev.previousHash || '0'.repeat(64)),
    nonce: 0, hash: null, status: 'pending',
    blockType: data.blockType || 'evidence',
  };
  ledger.push(newBlock);
  pendingCount++;
  updateDashboard(); renderBlocks();
  showMessage('Justice takes patience. Mining block…');
  await mineBlockAsync(newBlock);
  pendingCount = Math.max(0, pendingCount - 1);
  stats.uploaded++;
  showMessage('A new testimony has entered the record.');
  await validateChain();
  updateDashboard(); renderBlocks();
  sonarPulses.push({ x: window.innerWidth / 2, y: window.innerHeight / 2, t: performance.now() });
  return newBlock;
}

/**
 * validateChain — true blockchain cascade:
 *  • null hash          → TAMPERED (not pending)
 *  • data mismatch      → TAMPERED + cascade all blocks after it
 *  • previousHash break → TAMPERED + cascade
 *  • previousBlock was tampered → this block is also TAMPERED (cascade)
 */
async function validateChain() {
  let allGood     = true;
  let prevTampered = false;

  for (let i = 0; i < ledger.length; i++) {
    const b = ledger[i];

    if (!b.hash) {
      // Null hash means the block's content was altered outside the mine process
      b.status = 'tampered';
      allGood  = false;
      prevTampered = true;
      continue;
    }

    if (prevTampered) {
      // Cascade: prior block is broken → this block's chain link is severed
      b.status = 'tampered';
      allGood  = false;
      // prevTampered stays true — entire suffix is invalid
      continue;
    }

    const actualHash = await calcHash(b);
    if (actualHash !== b.hash) {
      // Block data was modified but hash not updated → detected
      b.status = 'tampered';
      allGood  = false;
      prevTampered = true;
    } else if (i > 0 && b.previousHash !== ledger[i - 1].hash) {
      // Previous block was re-mined → its hash changed → this block's link breaks
      b.status = 'tampered';
      allGood  = false;
      prevTampered = true;
    } else {
      b.status = 'valid';
      prevTampered = false;
    }
  }

  stats.tampered = ledger.filter(x => x.status === 'tampered').length;
  stats.verified = ledger.filter(x => x.status === 'valid' && x.index !== 0).length;
  updateDashboard();

  const totalBlocks  = ledger.length - 1;
  const healthPct    = totalBlocks <= 0 ? 100
    : Math.max(0, Math.round(((totalBlocks - stats.tampered) / totalBlocks) * 100));
  document.getElementById('chainHealth').textContent = `${healthPct}%`;

  const vaultHealth = document.getElementById('vaultChainHealth');
  if (vaultHealth) {
    vaultHealth.textContent = `Vault Integrity: ${healthPct}%`;
    vaultHealth.style.color = healthPct < 100 ? '#ff4a5a' : '';
  }

  document.body.classList.toggle('chain-broken', !allGood);
  updateHeartbeatState();
}

// ── Render evidence blocks ──────────────────────────────────────
function renderBlocks() {
  const container = $('#blocks');
  if (!container) return;
  container.innerHTML = '';

  for (let i = ledger.length - 1; i >= 0; i--) {
    const b = ledger[i];
    const statusClass = b.status === 'valid'    ? 'status-valid'
                      : b.status === 'tampered' ? 'status-tampered'
                      : 'status-pending';
    const card = document.createElement('div');
    card.className = `block-card ${statusClass}`;

    // Tamper alert banner shown on non-genesis tampered blocks
    let tamperBanner = '';
    if (b.status === 'tampered' && b.index > 0) {
      tamperBanner = `<div class="tamper-alert">⚠ HEARTBEAT CHANGED — TRUTH WAS REWRITTEN</div>`;
    }

    card.innerHTML = `
      <div class="block-row">
        <strong>${b.blockType === 'trail' ? 'Evidence Trail #' : 'Evidence Block #'}${b.index}</strong>
        <span class="block-type">${b.blockType === 'trail' ? 'Trail Record' : 'Evidence Record'}</span>
        <div style="margin-left:auto;font-size:12px;font-weight:800;letter-spacing:.06em;color:${b.status==='tampered'?'#ff6b6b':b.status==='pending'?'#ffb86b':'#3ad275'}">${b.status.toUpperCase()}</div>
      </div>
      ${tamperBanner}
      <div class="block-meta"><strong>Case:</strong> ${escapeHtml(b.caseNumber)} — <strong>ID:</strong> ${escapeHtml(b.evidenceID)}</div>
      <div class="block-meta"><strong>Type:</strong> ${escapeHtml(b.evidenceType)} • <strong>Officer:</strong> ${escapeHtml(b.officerName)} • <strong>Time:</strong> ${new Date(b.timestamp).toLocaleString()}</div>
      <div class="block-meta">${escapeHtml(b.description)}</div>
      <div class="block-hash"><strong>Hash:</strong> ${b.hash ? b.hash.slice(0,24)+'…' : '<em>pending</em>'}</div>
      <div class="block-hash"><strong>Prev:</strong> ${b.previousHash ? String(b.previousHash).slice(0,24)+'…' : ''}</div>
      <div class="block-actions">
        <button class="small-btn inspect" data-index="${b.index}">Inspect</button>
        <button class="small-btn tamper"  data-index="${b.index}">Tamper Evidence</button>
        <button class="small-btn warn export" data-index="${b.index}">Export</button>
        <button class="small-btn edit"   data-index="${b.index}">Edit Evidence</button>
      </div>`;
    container.appendChild(card);
  }

  qs('.small-btn.inspect').forEach(el => el.onclick = e => inspectBlock(e.target.dataset.index));
  qs('.small-btn.tamper' ).forEach(el => el.onclick = e => tamperBlockPrompt(e.target.dataset.index));
  qs('.small-btn.export' ).forEach(el => el.onclick = e => exportMetadata(e.target.dataset.index));
  qs('.small-btn.edit'   ).forEach(el => el.onclick = e => openEditModal(e.target.dataset.index));
}

function inspectBlock(index) {
  const b = ledger[index];
  if (!b) return;
  showMessage([
    `Block #${b.index}`,
    `Case: ${b.caseNumber}`,
    `ID: ${b.evidenceID}`,
    `Officer: ${b.officerName}`,
    `Hash: ${b.hash || 'pending'}`,
    `Prev: ${b.previousHash}`,
  ].join(' • '), 7000);
}

/**
 * tamperBlockPrompt — simulates malicious tampering.
 * Changes the block's DATA but leaves the stored hash untouched.
 * validateChain will then compute actualHash ≠ block.hash → TAMPERED cascade.
 */
function tamperBlockPrompt(index) {
  const i = parseInt(index, 10);
  const b = ledger[i];
  if (!b) return;
  const newDesc = prompt('Tamper Evidence — alter description (the hash mismatch will be detected):', `${b.description} (tampered)`);
  if (newDesc === null) return;
  b.description  = newDesc;
  // Corrupt the evidence hash too — stale block hash won't match recalculation
  b.evidenceHash = b.evidenceHash.split('').reverse().join('').slice(0, 64);
  // Do NOT update b.hash → validateChain detects discrepancy and cascades
  showMessage('⚠ The heartbeat changed. Truth was rewritten.', 5000);
  validateChain().then(renderBlocks);
}

function exportMetadata(index) {
  const b = ledger[index];
  if (!b) return;
  const payload = JSON.stringify(b, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type:'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `evidence-${b.evidenceID || b.index}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showMessage('The evidence has found its voice.');
}

// ── Verification ────────────────────────────────────────────────
async function hashFileInput(fileInput) {
  const f = fileInput?.files?.[0];
  if (!f) return null;
  return sha256Hex(await f.arrayBuffer());
}

async function verifyFileAgainstLedger(fileInput, evidenceID) {
  const h = await hashFileInput(fileInput);
  if (!h) { showMessage('No file selected.'); return; }
  let found = evidenceID ? ledger.find(b => b.evidenceID === evidenceID) : null;
  if (!found) found = ledger.find(b => b.evidenceHash === h || b.hash === h);
  if (!found) { showVerificationResult(false, 'The chain remembers nothing like this.'); return; }
  if (found.evidenceHash === h) {
    showVerificationResult(true, "I don't need eyes. The truth remains unchanged.");
    stats.verified++; updateDashboard();
  } else {
    showVerificationResult(false, '⚠ The heartbeat changed. Someone rewrote the truth.');
    stats.tampered++; updateDashboard();
  }
  validateChain();
}

function showVerificationResult(ok, phrase) {
  const el = $('#verifyResult');
  el.className = 'verify-result glass ' + (ok ? 'ok' : 'bad');
  el.textContent = phrase;
  showMessage(phrase);
}

function updateDashboard() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('countUploaded', stats.uploaded);
  set('countVerified', stats.verified);
  set('countTampered', stats.tampered);
  set('dashUploaded',  stats.uploaded);
  set('dashVerified',  stats.verified);
  set('dashTampered',  stats.tampered);
  set('dashPending',   pendingCount);
}

// ══════════════════════════════════════════════════════════════════
// EVIDENCE TRAIL BLOCKCHAIN  (separate ledger for custody transfers)
// ══════════════════════════════════════════════════════════════════
let trailLedger = [];
let trailStats  = { added: 0, tampered: 0, valid: 0 };

async function createTrailGenesis() {
  const genesis = {
    index: 0, timestamp: new Date().toISOString(),
    evidenceID: 'TRAIL-GENESIS',
    fromPerson: 'SYSTEM', toPerson: 'SYSTEM',
    action: 'system', notes: 'Trail chain initialized.',
    previousHash: '0'.repeat(64), nonce: 0, hash: null, status: 'valid',
  };
  genesis.hash = await calcTrailHash(genesis);
  trailLedger  = [genesis];
}

function calcTrailHash(block) {
  const base = `${block.index}|${block.timestamp}|${block.evidenceID}|${block.fromPerson}|${block.toPerson}|${block.action}|${block.notes}|${block.previousHash}|${block.nonce}`;
  return sha256Hex(base);
}

async function mineTrailBlock(block) {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    block.nonce = nonce;
    const h = await calcTrailHash(block);
    if (h.startsWith(target)) { block.hash = h; block.status = 'valid'; return block; }
    nonce++;
  }
}

async function addTrailBlock(data) {
  const prev = trailLedger[trailLedger.length - 1];
  const newBlock = {
    index:      trailLedger.length,
    timestamp:  new Date().toISOString(),
    evidenceID: data.evidenceID,
    fromPerson: data.fromPerson,
    toPerson:   data.toPerson,
    action:     data.action,
    notes:      data.notes,
    previousHash: typeof prev.hash === 'string' ? prev.hash : '0'.repeat(64),
    nonce: 0, hash: null, status: 'pending',
  };
  trailLedger.push(newBlock);
  renderTrailBlocks();
  showMessage('Mining trail block…');
  await mineTrailBlock(newBlock);
  trailStats.added++;
  showMessage('Evidence trail block sealed in the chain.');
  await validateTrailChain();
  renderTrailBlocks();
  sonarPulses.push({ x: window.innerWidth / 2, y: window.innerHeight / 3, t: performance.now() });
}

/**
 * validateTrailChain — identical cascade logic to validateChain.
 * A null hash, data mismatch, or broken previousHash → TAMPERED + cascade.
 */
async function validateTrailChain() {
  let allGood      = true;
  let prevTampered = false;

  for (let i = 0; i < trailLedger.length; i++) {
    const b = trailLedger[i];

    if (!b.hash) {
      b.status = 'tampered'; allGood = false; prevTampered = true; continue;
    }
    if (prevTampered) {
      b.status = 'tampered'; allGood = false; continue;
    }

    const actualHash = await calcTrailHash(b);
    if (actualHash !== b.hash) {
      b.status = 'tampered'; allGood = false; prevTampered = true;
    } else if (i > 0 && b.previousHash !== trailLedger[i - 1].hash) {
      b.status = 'tampered'; allGood = false; prevTampered = true;
    } else {
      b.status = 'valid'; prevTampered = false;
    }
  }

  trailStats.tampered = trailLedger.filter(x => x.status === 'tampered').length;
  trailStats.valid    = trailLedger.filter(x => x.status === 'valid' && x.index !== 0).length;

  const total     = Math.max(0, trailLedger.length - 1);
  const healthPct = total === 0 ? 100
    : Math.max(0, Math.round(((total - trailStats.tampered) / total) * 100));

  const healthEl = document.getElementById('trailChainHealth');
  if (healthEl) {
    healthEl.textContent = `Trail Chain Integrity: ${healthPct}%`;
    healthEl.style.color = healthPct < 100 ? '#ff4a5a' : '';
  }

  updateHeartbeatState();
}

// ── Render trail blockchain ─────────────────────────────────────
function renderTrailBlocks() {
  const container = document.getElementById('trail-blocks');
  if (!container) return;
  container.innerHTML = '';

  const visible = trailLedger.filter(b => b.index > 0);
  if (visible.length === 0) {
    container.innerHTML = '<div class="block-meta" style="opacity:.5;padding:14px 0">No trail entries yet. Add the first custody transfer.</div>';
    return;
  }

  for (let i = trailLedger.length - 1; i >= 1; i--) {
    const b = trailLedger[i];
    const statusClass = b.status === 'valid'    ? 'status-valid'
                      : b.status === 'tampered' ? 'status-tampered'
                      : 'status-pending';
    const card = document.createElement('div');
    card.className = `block-card ${statusClass}`;

    let tamperBanner = '';
    if (b.status === 'tampered') {
      tamperBanner = `<div class="tamper-alert">⚠ TRUTH WAS CHANGED — TRAIL INTEGRITY BROKEN</div>`;
    }

    card.innerHTML = `
      <div class="block-row">
        <strong>Trail Block #${b.index}</strong>
        <span class="block-type">Trail Record</span>
        <div style="margin-left:auto;font-size:12px;font-weight:800;letter-spacing:.06em;color:${b.status==='tampered'?'#ff6b6b':b.status==='pending'?'#ffb86b':'#3ad275'}">${b.status.toUpperCase()}</div>
      </div>
      ${tamperBanner}
      <div class="block-meta"><strong>Evidence ID:</strong> ${escapeHtml(b.evidenceID)} &nbsp;•&nbsp; <strong>Action:</strong> ${escapeHtml(b.action)}</div>
      <div class="trail-transfer">
        <span class="trail-from">${escapeHtml(b.fromPerson)}</span>
        <span class="trail-arrow">→</span>
        <span class="trail-to">${escapeHtml(b.toPerson)}</span>
      </div>
      <div class="block-meta">${escapeHtml(b.notes)}</div>
      <div class="block-meta" style="font-size:11px"><strong>Time:</strong> ${new Date(b.timestamp).toLocaleString()}</div>
      <div class="block-hash"><strong>Hash:</strong> ${b.hash ? b.hash.slice(0,24)+'…' : '<em>pending</em>'}</div>
      <div class="block-hash"><strong>Prev:</strong> ${b.previousHash ? String(b.previousHash).slice(0,24)+'…' : ''}</div>
      <div class="block-actions">
        <button class="small-btn trail-edit-btn"   data-tindex="${b.index}">Edit Trail</button>
        <button class="small-btn warn trail-tamper-btn" data-tindex="${b.index}">Tamper Trail</button>
      </div>`;
    container.appendChild(card);
  }

  document.querySelectorAll('.trail-edit-btn').forEach(el =>
    el.onclick = e => openTrailEditModal(e.target.dataset.tindex));
  document.querySelectorAll('.trail-tamper-btn').forEach(el =>
    el.onclick = e => tamperTrailBlock(e.target.dataset.tindex));
}

/**
 * tamperTrailBlock — changes trail block DATA, leaves hash untouched.
 * validateTrailChain detects mismatch and cascades TAMPERED forward.
 */
function tamperTrailBlock(index) {
  const i = parseInt(index, 10);
  const b = trailLedger[i];
  if (!b) return;
  const newNotes = prompt('Tamper Trail — alter notes (hash mismatch will cascade INVALID):', `${b.notes} (tampered)`);
  if (newNotes === null) return;
  b.notes = newNotes;  // data changed, stored hash stays stale → mismatch
  showMessage('⚠ Truth was changed. Trail chain compromised.', 5000);
  validateTrailChain().then(renderTrailBlocks);
}

// ── Trail Edit Modal ────────────────────────────────────────────
function openTrailEditModal(index) {
  const b = trailLedger[parseInt(index, 10)];
  if (!b) return;
  document.getElementById('trailEditIndex').value      = index;
  document.getElementById('trailEditEvidenceID').value = b.evidenceID;
  document.getElementById('trailEditAction').value     = b.action;
  document.getElementById('trailEditFrom').value       = b.fromPerson;
  document.getElementById('trailEditTo').value         = b.toPerson;
  document.getElementById('trailEditNotes').value      = b.notes;
  trailEditModal.classList.add('open');
  trailEditModal.setAttribute('aria-hidden', 'false');
}

function closeTrailEditModal() {
  trailEditModal.classList.remove('open');
  trailEditModal.setAttribute('aria-hidden', 'true');
}

trailEditForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const index = parseInt(document.getElementById('trailEditIndex').value, 10);
  const b     = trailLedger[index];
  if (!b) return;

  // Update block data
  b.evidenceID = document.getElementById('trailEditEvidenceID').value.trim();
  b.action     = document.getElementById('trailEditAction').value;
  b.fromPerson = document.getElementById('trailEditFrom').value.trim();
  b.toPerson   = document.getElementById('trailEditTo').value.trim();
  b.notes      = document.getElementById('trailEditNotes').value.trim();

  // Null the hash → re-mine gives new hash → subsequent blocks still have OLD previousHash
  // → validateTrailChain detects break → cascades TAMPERED on all blocks after this one
  b.hash   = null;
  b.status = 'pending';

  closeTrailEditModal();
  showMessage('⚠ Truth was changed. Re-mining trail block…', 4000);
  renderTrailBlocks();

  await mineTrailBlock(b);
  // b now has a NEW hash. The next block's previousHash still points to the OLD hash → cascade
  await validateTrailChain();
  renderTrailBlocks();
});

document.getElementById('cancelTrailEdit').addEventListener('click', closeTrailEditModal);
document.getElementById('closeTrailModal').addEventListener('click', closeTrailEditModal);
trailEditModal.addEventListener('click', ev => { if (ev.target === trailEditModal) closeTrailEditModal(); });

// ══════════════════════════════════════════════════════════════════
// FORM HANDLERS
// ══════════════════════════════════════════════════════════════════

// ── Evidence Vault form ─────────────────────────────────────────
document.getElementById('evidence-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const caseNumber  = $('#caseNumber').value.trim();
  const evidenceID  = $('#evidenceID').value.trim()  || `EV-${Date.now()}`;
  const evidenceType= $('#evidenceType').value;
  const officerName = $('#officerName').value.trim() || 'Unknown';
  const description = $('#description').value.trim() || '';
  const fileInput   = $('#evidenceFile');

  let evidenceHash = '';
  if (fileInput.files && fileInput.files.length) {
    evidenceHash = await sha256Hex(await fileInput.files[0].arrayBuffer());
    showMessage('The evidence has found its voice.');
  } else {
    evidenceHash = await sha256Hex(`${caseNumber}|${evidenceID}|${evidenceType}|${officerName}|${description}|${Date.now()}`);
    showMessage('The evidence has found its voice.');
  }

  await addEvidenceBlock({ caseNumber, evidenceID, evidenceType, officerName, description, evidenceHash });
  document.getElementById('evidence-form').reset();
  renderBlocks();
});

// ── Evidence Trail form ─────────────────────────────────────────
document.getElementById('trail-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const evidenceID  = $('#trailEvidenceID').value.trim();
  const trailAction = $('#trailAction').value;
  const fromPerson  = $('#trailFrom').value.trim()  || 'Unknown';
  const toPerson    = $('#trailTo').value.trim()    || 'Unknown';
  const notes       = $('#trailNotes').value.trim() || '';

  if (!evidenceID) { showMessage('Please enter an Evidence ID.'); return; }

  await addTrailBlock({ evidenceID, action: trailAction, fromPerson, toPerson, notes });
  document.getElementById('trail-form').reset();
  const statusEl = document.getElementById('trailStatus');
  if (statusEl) statusEl.textContent = `Trail block #${trailLedger.length - 1} sealed. Chain updated.`;
});

// ── Verification ────────────────────────────────────────────────
$('#verifyBtn').addEventListener('click', async () => {
  showMessage('Listening to the truth…');
  await verifyFileAgainstLedger($('#verifyFile'), $('#verifyEvidenceID').value.trim());
});

$('#quickScan').addEventListener('click', async () => {
  if (!$('#verifyFile').files.length) { showMessage('Select a file first.'); return; }
  const latest = ledger[ledger.length - 1];
  if (!latest) { showMessage('No records to compare against.'); return; }
  showMessage('Scanning the latest testimony…');
  await verifyFileAgainstLedger($('#verifyFile'), latest.evidenceID);
});

$('#reset-chain').addEventListener('click', async () => {
  if (!confirm('Reset the ledger? This will clear all evidence blocks (except genesis).')) return;
  await createGenesis();
  stats = { uploaded: 0, verified: 0, tampered: 0 };
  pendingCount = 0;
  updateDashboard(); renderBlocks();
  showMessage('The record has been sealed. A new investigation begins.');
});

$('#verifyFile').addEventListener('change', () => {
  if ($('#verifyFile').files[0]) showMessage('Every truth leaves a fingerprint.');
});

$('#to-vault').addEventListener('click',  () => location.href = '#vault');
$('#to-verify').addEventListener('click', () => location.href = '#verify');

// ══════════════════════════════════════════════════════════════════
// EVIDENCE EDIT MODAL
// ══════════════════════════════════════════════════════════════════
function openEditModal(index) {
  const block = ledger[index];
  if (!block) return;
  $('#editIndex').value       = index;
  $('#editCaseNumber').value  = block.caseNumber;
  $('#editEvidenceID').value  = block.evidenceID;
  $('#editEvidenceType').value= block.evidenceType;
  $('#editOfficerName').value = block.officerName;
  $('#editDescription').value = block.description;
  editModal.classList.add('open');
  editModal.setAttribute('aria-hidden', 'false');
}

function closeEditModal() {
  editModal.classList.remove('open');
  editModal.setAttribute('aria-hidden', 'true');
}

editForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const index = parseInt($('#editIndex').value, 10);
  const block = ledger[index];
  if (!block) return;

  // Update block metadata
  block.caseNumber  = $('#editCaseNumber').value.trim();
  block.evidenceID  = $('#editEvidenceID').value.trim();
  block.evidenceType= $('#editEvidenceType').value;
  block.officerName = $('#editOfficerName').value.trim();
  block.description = $('#editDescription').value.trim();

  // Null hash → re-mine will produce a brand-new hash for this block.
  // All blocks after this one still hold the OLD previousHash → mismatch
  // → validateChain cascade marks them all TAMPERED.
  block.hash   = null;
  block.status = 'pending';
  pendingCount++;
  updateDashboard();
  closeEditModal();

  showMessage('⚠ Heartbeat changed. Truth was rewritten. Re-mining block…', 4500);
  renderBlocks();

  await mineBlockAsync(block);
  pendingCount = Math.max(0, pendingCount - 1);

  // After re-mining: block[index].hash is NEW.
  // block[index+1].previousHash is still the OLD hash → cascade TAMPERED.
  await validateChain();
  updateDashboard();
  renderBlocks();
});

$('#cancelEdit').addEventListener('click', closeEditModal);
$('#closeModal').addEventListener('click', closeEditModal);
editModal.addEventListener('click', (ev) => { if (ev.target === editModal) closeEditModal(); });

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
(async function init() {
  startVisualLoop();
  await runLoaderSequence();
  await createGenesis();
  await createTrailGenesis();
  renderBlocks();
  renderTrailBlocks();
  await validateChain();
  updateDashboard();
  showMessage('The record has been sealed. A new investigation begins.', 2400);
  // initialize logo upload / drag-drop handlers
  initLogoUploader();
})();

function initLogoUploader() {
  if (!brandLogo) return;
  const logoMark = document.querySelector('.logo-mark');
  if (logoMark) {
    logoMark.style.cursor = 'pointer';
    logoMark.title = 'Click or drop an image to change logo';
    logoMark.addEventListener('click', () => { if (logoUpload) logoUpload.click(); });
    logoMark.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
    logoMark.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f && f.type && f.type.startsWith('image/')) setLogoFile(f);
    });
  }

  if (logoUpload) {
    logoUpload.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) setLogoFile(f);
    });
  }

  function setLogoFile(file) {
    try {
      const url = URL.createObjectURL(file);
      brandLogo.src = url;
      // Update favicon to match
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.type = file.type || 'image/png';
      link.href = url;
      showMessage('Logo updated.');
    } catch (err) { console.error('Logo set error', err); showMessage('Unable to update logo.'); }
  }
}
