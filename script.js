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
const SONAR_MAX_ONSCREEN = 2;
function pushSonarPulse(pulse) {
  if (sonarPulses.length >= SONAR_MAX_ONSCREEN) return; // keep it calm — max 1-2 bubbles at a time
  sonarPulses.push(pulse);
}

// ══════════════════════════════════════════════════════════════════
// HEARTBEAT ECG CANVAS
// Speed and visual state tied to combined chain health
// ══════════════════════════════════════════════════════════════════

// ECG pattern: clinical P-QRS-T waveform shape (baseline → P wave → flat PR
// segment → sharp QRS complex → flat ST segment → T wave → baseline rest)
const ECG_PATTERN = [
  // Isoelectric baseline before P wave
  0, 0, 0, 0, 0, 0, 0, 0,
  // P wave — small rounded bump
  0.3, 0.9, 1.5, 1.8, 1.5, 0.9, 0.3, 0,
  // PR segment — flat
  0, 0, 0,
  // QRS complex — Q dip, sharp R spike, S dip
  -1.2, -2.8, 9, 18, 9, -3.5, -1.4,
  // ST segment — flat
  0, 0, 0, 0,
  // T wave — broader rounded bump
  0.5, 1.3, 2.3, 3.2, 3.7, 3.2, 2.3, 1.3, 0.5, 0,
  // Rest of cycle — isoelectric baseline
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
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
  if (hbCanvas) hbCanvas.classList.toggle('hb-tampered', hbHealthRatio > 0);
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

  // Any tamper at all pushes the *visual intensity* up to at least 0.4 so a single
  // tampered block still reads as an alarmed, racing heartbeat — not just a red tint.
  const vRatio = hbHealthRatio > 0 ? Math.max(0.4, hbHealthRatio) : 0;

  hbCanvas.style.filter = vRatio > 0.2 ? `blur(${Math.min(2.1, vRatio * 2.4)}px)` : 'none';
  hbCanvas.style.opacity = `${0.92 - Math.min(0.18, vRatio * 0.18)}`;

  const speed = 0.95 + vRatio * 3.2;
  hbScrollX += speed;

  const mid    = ch * 0.52;
  const maxAmp = Math.max(6, mid - 6);
  const amp    = maxAmp * Math.max(0.18, 1 - vRatio * 0.7);
  const drift  = Math.sin(now / 930) * vRatio * 3.2;

  const color = hbHealthRatio > 0 ? '#ff1e2d' : '#2fe07a';

  hbCtx.beginPath();
  hbCtx.strokeStyle = color;
  hbCtx.lineWidth   = 2;
  hbCtx.lineJoin    = 'round';
  hbCtx.lineCap     = 'round';
  hbCtx.shadowColor = color;
  hbCtx.shadowBlur  = vRatio * 9;

  const pxPerSample = cw / (ECG_LEN * 0.64);
  const flattenAmt  = Math.min(1, vRatio * 0.85);
  const noiseScale  = 0.045 + vRatio * 0.42;

  for (let x = 0; x <= cw; x += 1) {
    const samplePos = (x + hbScrollX) / pxPerSample;
    const ecgIdx = Math.floor(samplePos) % ECG_LEN;
    const nextIdx = (ecgIdx + 1) % ECG_LEN;
    const frac = samplePos - Math.floor(samplePos);
    const rawVal = ECG_PATTERN[ecgIdx] + (ECG_PATTERN[nextIdx] - ECG_PATTERN[ecgIdx]) * frac;
    const wave = rawVal * (1 - flattenAmt * 0.72);
    const noise = (Math.random() - 0.5) * noiseScale * maxAmp;
    const baseline = drift + Math.sin(x * 0.09 + now * 0.003) * vRatio * 1.8;

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
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.2)  * 0.14,
      size:  0.6 + Math.random() * 2.2,
      alpha: 0.08 + Math.random() * 0.22,
    });
  }
  const fcount = Math.max(12, Math.round(window.innerWidth / 220));
  for (let i = 0; i < fcount; i++) {
    flareNodes.push({
      x: Math.random() * w, y: Math.random() * h,
      size:  18 + Math.random() * 24,
      speed: 0.012 + Math.random() * 0.024,
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
      flare.x += Math.sin(time / 4200) * 0.02;
      flare.y += Math.cos(time / 3400) * 0.014;
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
      const x = (i * 200 + time / 32) % w;
      bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x + 80, h); bgCtx.stroke();
    }
    bgCtx.restore();

    bgCtx.save();
    bgCtx.globalAlpha = 0.12; bgCtx.fillStyle = '#ff4a5a';
    flareNodes.forEach((flare, idx) => {
      const radius = flare.size * (0.7 + Math.sin(time / 1900 + idx) * 0.2);
      bgCtx.beginPath(); bgCtx.arc(flare.x, flare.y, radius, 0, Math.PI * 2); bgCtx.fill();
    });
    bgCtx.restore();

    for (let i = sonarPulses.length - 1; i >= 0; i--) {
      const pulse = sonarPulses[i];
      const age = (time - pulse.t) / 1600;
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
      const x = ((i * 180) + time / 36) % w;
      const y = h * 0.12 + Math.sin((time / 2400) + i) * 28;
      radarCtx.beginPath(); radarCtx.moveTo(x, 0); radarCtx.lineTo(x + 90, h); radarCtx.stroke();
    }
    radarCtx.globalAlpha = 1;

    const centerX = Math.max(220, w * 0.5 + Math.sin(time / 3400) * 120);
    const centerY = Math.max(220, h * 0.4 + Math.cos(time / 3100) * 55);
    for (let i = 0; i < 4; i++) {
      const r = ((time / 1700 + i * 0.7) % 1) * Math.min(w, h) / 1.8;
      radarCtx.beginPath();
      radarCtx.strokeStyle = `rgba(255,30,30,${0.07 - i * 0.01})`;
      radarCtx.lineWidth = 1.4;
      radarCtx.arc(centerX, centerY, r, 0, Math.PI * 2); radarCtx.stroke();
    }

    radarCtx.fillStyle = 'rgba(255,255,255,0.04)';
    radarCtx.font = '10px monospace';
    for (let i = 0; i < 18; i++) {
      const hx = (i * 183 + time / 32) % w;
      const hy = (i * 93 + Math.sin((time / 2100) + i) * 42) % h;
      radarCtx.fillText(Math.random() > 0.7 ? 'ab12f6' : 'c3d9a0', hx, hy);
    }
  } catch (err) { console.error('Radar render error', err); }
  requestAnimationFrame(drawRadar);
}

let lastMouseBubbleT = 0;
window.addEventListener('mousemove', (e) => {
  cursorEl.style.left = `${e.clientX}px`;
  cursorEl.style.top  = `${e.clientY}px`;
  const now = performance.now();
  if (now - lastMouseBubbleT > 900) {
    pushSonarPulse({ x: e.clientX, y: e.clientY, t: now });
    lastMouseBubbleT = now;
  }
});

setInterval(() => {
  pushSonarPulse({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, t: performance.now() });
}, 3200);

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
    setTimeout(() => s.remove(), 2200);
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
  sonarPulses = []; pushSonarPulse({ x: window.innerWidth / 2, y: window.innerHeight / 2, t: performance.now() });
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
    card.className = `block-card ${statusClass} block-card--${b.status}`;

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
  sonarPulses = []; pushSonarPulse({ x: window.innerWidth / 2, y: window.innerHeight / 3, t: performance.now() });
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

  // Always render genesis block first (at top)
  const genesis = trailLedger[0];
  if (genesis) {
    const genesisCard = document.createElement('div');
    genesisCard.className = 'block-card genesis-block-card';
    genesisCard.innerHTML = `
      <div class="block-row">
        <strong>⛓ Genesis Block #0</strong>
        <span class="block-type">Genesis</span>
        <div style="margin-left:auto;font-size:12px;font-weight:800;letter-spacing:.06em;color:#7b61ff">GENESIS</div>
      </div>
      <div class="block-meta"><strong>Evidence ID:</strong> ${escapeHtml(genesis.evidenceID)}</div>
      <div class="block-meta"><strong>From:</strong> ${escapeHtml(genesis.fromPerson)} • <strong>To:</strong> ${escapeHtml(genesis.toPerson)}</div>
      <div class="block-meta">${escapeHtml(genesis.notes)}</div>
      <div class="block-meta" style="font-size:11px"><strong>Time:</strong> ${new Date(genesis.timestamp).toLocaleString()}</div>
      <div class="block-hash"><strong>Hash:</strong> ${genesis.hash ? genesis.hash.slice(0,24)+'…' : '<em>pending</em>'}</div>
    `;
    container.appendChild(genesisCard);
  }

  if (trailLedger.length <= 1) {
    container.insertAdjacentHTML('beforeend', '<div class="block-meta" style="opacity:.5;padding:14px 0">No trail entries yet. Add the first custody transfer.</div>');
    return;
  }

  // Render blocks in ASCENDING chronological order: Genesis → #1 → #2 → #3…
  // (previously rendered newest-first, which put the latest block right after
  // Genesis instead of Block #1 — that was the numbering bug)
  for (let i = 1; i < trailLedger.length; i++) {
    const b = trailLedger[i];
    const statusClass = b.status === 'valid'    ? 'status-valid'
                      : b.status === 'tampered' ? 'status-tampered'
                      : 'status-pending';

    // Connector line linking this block visually to the one above it
    const connector = document.createElement('div');
    connector.className = 'trail-connector';
    connector.textContent = '↓';
    container.appendChild(connector);

    const card = document.createElement('div');
    card.className = `block-card ${statusClass} block-card--${b.status}`;

    let tamperBanner = '';
    if (b.status === 'tampered') {
      tamperBanner = `<div class="tamper-alert">⚠ TRUTH WAS CHANGED — TRAIL INTEGRITY BROKEN</div>`;
    }

    // b.index is correct (1,2,3...) as set by addTrailBlock using trailLedger.length
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
  if (statusEl) statusEl.textContent = `Trail block #${trailLedger.length - 1} sealed. Chain updated. (${trailLedger.length - 1} custody entries)`;
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
// ══════════════════════════════════════════════════════════════════
// DAREDEVIL CINEMATIC ATMOSPHERE ENGINE
// City skyline · Neural net · Fog · Rain · Embers · Floating crypto
// Sonar hero rings · Lightning flashes · Mouse interaction
// ══════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  let W = window.innerWidth, H = window.innerHeight;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const IS_MOBILE = W < 768;
  const DENSITY = IS_MOBILE ? 0.4 : 1.0;

  // ── Canvas setup helper ─────────────────────────────────────────
  function setupCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return { c: null, ctx: null };
    c.width  = Math.round(W * DPR);
    c.height = Math.round(H * DPR);
    c.style.width  = W + 'px';
    c.style.height = H + 'px';
    const ctx = c.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return { c, ctx };
  }

  let city   = setupCanvas('city-canvas');
  let neural = setupCanvas('neural-canvas');
  let fog    = setupCanvas('fog-canvas');
  let rain   = setupCanvas('rain-canvas');
  let ember  = setupCanvas('ember-canvas');
  let floatC = setupCanvas('float-canvas');
  let sonar  = setupCanvas('sonar-hero-canvas');
  const lightning = document.getElementById('lightning-overlay');

  window.addEventListener('resize', () => {
    W = window.innerWidth; H = window.innerHeight;
    [city, neural, fog, rain, ember, floatC, sonar].forEach(o => {
      if (!o.c) return;
      o.c.width  = Math.round(W * DPR);
      o.c.height = Math.round(H * DPR);
      o.c.style.width  = W + 'px';
      o.c.style.height = H + 'px';
      o.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    });
    initCityline();
    initNeural();
  });

  // ── Tab visibility pause ────────────────────────────────────────
  let paused = false;
  document.addEventListener('visibilitychange', () => { paused = document.hidden; });

  // ── Mouse tracking ──────────────────────────────────────────────
  let mx = W / 2, my = H / 2;
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

  // ══════════════════════════════════════════════════════════════
  // 1. CITY SKYLINE
  // ══════════════════════════════════════════════════════════════
  let buildings = [];

  function initCityline() {
    buildings = [];
    const count = Math.floor(W / 18 * DENSITY);
    for (let i = 0; i < count; i++) {
      const w = 10 + Math.random() * 30;
      buildings.push({
        x: (i / count) * W + (Math.random() - 0.5) * 18,
        w,
        h: 40 + Math.random() * (IS_MOBILE ? 120 : 200),
        windows: [],
        lit: Math.random() > 0.35,
      });
    }
    buildings.forEach(b => {
      const cols = Math.floor(b.w / 5);
      const rows = Math.floor(b.h / 6);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > 0.45) {
            b.windows.push({ r, c, on: Math.random() > 0.3, flicker: Math.random() > 0.92 });
          }
        }
      }
    });
  }

  function drawCityline(ctx, alpha) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const baseY = H * 0.72;

    // Flat, muted sky-glow band behind the skyline — plain dark red bleeding into black,
    // no bright haze, just enough to separate the silhouette from the void behind it.
    const sky = ctx.createLinearGradient(0, baseY - 200, 0, baseY);
    sky.addColorStop(0, 'rgba(0,0,0,0)');
    sky.addColorStop(1, `rgba(60,4,8,${alpha * 0.35})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, baseY - 200, W, 200);

    buildings.forEach(b => {
      const bTop = baseY - b.h;
      // Building silhouette — flat noir gradient, plain dark red into black, no shine
      const grad = ctx.createLinearGradient(b.x, bTop, b.x, baseY);
      grad.addColorStop(0, `rgba(30,4,6,${alpha * 0.85})`);
      grad.addColorStop(0.5, `rgba(14,2,4,${alpha * 0.92})`);
      grad.addColorStop(1, `rgba(3,1,2,${alpha * 0.97})`);
      ctx.fillStyle = grad;
      ctx.fillRect(b.x, bTop, b.w, b.h);

      // Windows — a handful of faint, flat, unmoving dark-red marks (barely visible),
      // just enough to read as "city infrastructure", never bright or glowing
      if (b.lit) {
        ctx.fillStyle = `rgba(90,8,12,${alpha * 0.3})`;
        b.windows.forEach(win => {
          if (!win.on) return;
          const wx = b.x + 2 + win.c * 5;
          const wy = bTop + 3 + win.r * 6;
          ctx.fillRect(wx, wy, 2, 3);
        });
      }

      // Rooftop antenna — plain dark line, no blinking beacon
      if (b.h > 120) {
        ctx.strokeStyle = `rgba(50,6,10,${alpha * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x + b.w / 2, bTop);
        ctx.lineTo(b.x + b.w / 2, bTop - 16);
        ctx.stroke();
      }
    });

    // Ground — flat dark red bleeding to black, no glow bloom
    const gg = ctx.createLinearGradient(0, baseY, 0, H);
    gg.addColorStop(0, `rgba(40,2,5,${alpha * 0.14})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, baseY, W, H - baseY);

    // Wet-street reflection — faint, flat, desaturated echo of the silhouette
    ctx.save();
    ctx.globalAlpha = alpha * 0.06;
    ctx.translate(0, baseY * 2 + 6);
    ctx.scale(1, -1);
    buildings.forEach(b => {
      const bTop = baseY - Math.min(b.h, 60); // only reflect the base of each building
      const rg = ctx.createLinearGradient(b.x, bTop, b.x, baseY);
      rg.addColorStop(0, 'rgba(60,4,8,0.3)');
      rg.addColorStop(1, 'rgba(60,4,8,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(b.x, bTop, b.w, baseY - bTop);
    });
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════
  // 2. NEURAL NETWORK
  // ══════════════════════════════════════════════════════════════
  let nodes = [], pulses = [];
  const NODE_COUNT = Math.floor(40 * DENSITY);

  function initNeural() {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.06, vy: (Math.random() - 0.5) * 0.06,
        r: 2 + Math.random() * 2.5,
        bright: 0,
      });
    }
    // Periodic pulse injection
    setInterval(() => {
      if (paused || nodes.length < 2) return;
      const from = nodes[Math.floor(Math.random() * nodes.length)];
      const to   = nodes[Math.floor(Math.random() * nodes.length)];
      if (from !== to) pulses.push({ from, to, t: 0, speed: 0.005 + Math.random() * 0.006 });
    }, 2200);
  }

  function drawNeural(ctx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // Update nodes
    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0) n.x = W; if (n.x > W) n.x = 0;
      if (n.y < 0) n.y = H; if (n.y > H) n.y = 0;
      n.bright = Math.max(0, n.bright - 0.02);

      // Mouse glow
      const dx = n.x - mx, dy = n.y - my;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 120) n.bright = Math.max(n.bright, 1 - dist / 120);
    });

    // Draw edges
    const maxDist = IS_MOBILE ? 100 : 150;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < maxDist) {
          const alpha = (1 - d / maxDist) * 0.12 + (a.bright + b.bright) * 0.08;
          ctx.strokeStyle = `rgba(255,43,59,${alpha})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    // Draw nodes
    nodes.forEach(n => {
      const alpha = 0.2 + n.bright * 0.6;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + n.bright * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,43,59,${alpha})`;
      ctx.fill();
      if (n.bright > 0.3) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + n.bright * 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,43,59,${n.bright * 0.08})`;
        ctx.fill();
      }
    });

    // Draw pulses
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += p.speed;
      if (p.t >= 1) { pulses.splice(i, 1); continue; }
      const px = p.from.x + (p.to.x - p.from.x) * p.t;
      const py = p.from.y + (p.to.y - p.from.y) * p.t;
      const alpha = Math.sin(p.t * Math.PI) * 0.8;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,180,180,${alpha})`;
      ctx.fill();
      // Brighten nearby node
      p.to.bright = Math.max(p.to.bright, p.t * 0.8);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 3. FOG
  // ══════════════════════════════════════════════════════════════
  let fogLayers = [];
  function initFog() {
    fogLayers = [];
    const count = IS_MOBILE ? 3 : 5;
    for (let i = 0; i < count; i++) {
      fogLayers.push({
        x: Math.random() * W * 2 - W / 2,
        y: H * 0.35 + Math.random() * H * 0.4,
        r: 200 + Math.random() * 350,
        speed: 0.06 + Math.random() * 0.1,
        alpha: 0.015 + Math.random() * 0.03,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }
  initFog();

  function drawFog(ctx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    fogLayers.forEach(f => {
      f.x += f.speed;
      if (f.x > W + f.r) f.x = -f.r;
      const pulsedAlpha = f.alpha * (0.85 + Math.sin(performance.now() / 3000 + f.phase) * 0.15);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(180,40,60,${pulsedAlpha})`);
      g.addColorStop(0.5, `rgba(120,20,30,${pulsedAlpha * 0.5})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.r, f.r * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 4. RAIN — full thunderstorm: layered streaks, gusting wind, splashes
  // ══════════════════════════════════════════════════════════════
  let drops = [];
  let splashes = [];
  let windGust = 0;
  const RAIN_BASE_Y = () => H * 0.72; // matches city baseY — rain "hits the street" here

  function initRain() {
    drops = [];
    const count = Math.floor((IS_MOBILE ? 45 : 100) * DENSITY);
    for (let i = 0; i < count; i++) {
      drops.push(spawnDrop());
    }
  }

  function spawnDrop() {
    const layer = Math.random(); // 0 = far/thin, 1 = near/thick
    return {
      x: Math.random() * W,
      y: -Math.random() * H,
      len: 10 + layer * 22,
      speed: 7 + layer * 10,
      alpha: 0.08 + layer * 0.22,
      width: 0.5 + layer * 1,
      layer,
    };
  }

  initRain();

  // Gusting wind — the diagonal rain angle drifts stronger and weaker, storm-style
  setInterval(() => {
    windGust = 0.6 + Math.random() * 1.2;
  }, 2600);

  function drawRain(ctx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const groundY = RAIN_BASE_Y();
    const windAngle = 0.32 + Math.sin(performance.now() / 4000) * 0.12 + windGust * 0.15;

    ctx.lineCap = 'round';
    drops.forEach(d => {
      d.x -= d.speed * windAngle;
      d.y += d.speed;
      if (d.y > H + d.len || d.x < -40) {
        // Splash where it lands, if roughly at street level
        if (d.y > groundY - 20 && Math.random() > 0.7) {
          splashes.push({ x: d.x, y: Math.min(d.y, groundY), t: 0 });
        }
        const nd = spawnDrop();
        nd.y = -nd.len;
        Object.assign(d, nd);
      }
      ctx.strokeStyle = `rgba(190,195,210,${d.alpha})`;
      ctx.lineWidth = d.width;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * windAngle * 0.5, d.y + d.len);
      ctx.stroke();
    });

    // Ground splashes — small red-tinted neon ripples where rain hits the wet street
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      s.t += 0.05;
      if (s.t >= 1) { splashes.splice(i, 1); continue; }
      const r = s.t * 6;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,60,70,${(1 - s.t) * 0.25})`;
      ctx.lineWidth = 0.7;
      ctx.ellipse(s.x, s.y, r, r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 5. EMBERS / DUST PARTICLES
  // ══════════════════════════════════════════════════════════════
  let embers = [];
  function initEmbers() {
    embers = [];
    const count = Math.floor((IS_MOBILE ? 20 : 55) * DENSITY);
    for (let i = 0; i < count; i++) {
      embers.push(spawnEmber());
    }
  }

  function spawnEmber() {
    return {
      x: Math.random() * W, y: H + 10,
      size: 0.8 + Math.random() * 2,
      vx: (Math.random() - 0.5) * 0.28,
      vy: -(0.16 + Math.random() * 0.5),
      life: 0, maxLife: 0.6 + Math.random() * 0.4,
      hue: 10 + Math.random() * 30,
    };
  }
  initEmbers();

  function drawEmbers(ctx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    embers.forEach((e, idx) => {
      e.x += e.vx + Math.sin(performance.now() / 2000 + idx) * 0.08;
      e.y += e.vy;
      e.life += 0.0016;
      if (e.life > e.maxLife || e.y < -10) { embers[idx] = spawnEmber(); return; }
      const lifeRatio = e.life / e.maxLife;
      const alpha = Math.sin(lifeRatio * Math.PI) * 0.7;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${e.hue},90%,65%,${alpha})`;
      ctx.fill();
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 6. FLOATING BLOCKCHAIN ELEMENTS
  // ══════════════════════════════════════════════════════════════
  const CRYPTO_CHARS = [
    'SHA-256','#0x4f7a','0101','⛓','ff3b','Block#','nonce','0000…',
    'c3d9','a8f1','0xff','1101','hash:','0xa3','prev:','0x00',
    '⊕','Σ','⌀','∂','∫','≈','0b1','merkle','ledger',
  ];

  let floaters = [];
  function initFloaters() {
    floaters = [];
    const count = Math.floor((IS_MOBILE ? 12 : 28) * DENSITY);
    for (let i = 0; i < count; i++) {
      floaters.push(spawnFloater());
    }
  }

  function spawnFloater() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      text: CRYPTO_CHARS[Math.floor(Math.random() * CRYPTO_CHARS.length)],
      size: 9 + Math.random() * 7,
      vx: (Math.random() - 0.5) * 0.08,
      vy: -0.05 - Math.random() * 0.11,
      alpha: 0.04 + Math.random() * 0.07,
      life: Math.random(),
    };
  }
  initFloaters();

  function drawFloaters(ctx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px monospace';
    floaters.forEach((f, idx) => {
      f.x += f.vx;
      f.y += f.vy;
      f.life += 0.0005;
      if (f.y < -20 || f.life > 1) { floaters[idx] = spawnFloater(); return; }
      const pulse = 0.5 + Math.sin(performance.now() / 3200 + idx) * 0.5;
      ctx.globalAlpha = f.alpha * pulse;
      ctx.fillStyle = '#ff7a84';
      ctx.font = `${f.size}px monospace`;
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
  }

  // ══════════════════════════════════════════════════════════════
  // 7. HERO SONAR RINGS
  // ══════════════════════════════════════════════════════════════
  let heroRings = [];
  const HERO_CX = () => W * 0.5;
  const HERO_CY = () => H * 0.28;

  setInterval(() => {
    if (paused) return;
    // Slight bend toward cursor
    const cx = HERO_CX() * 0.7 + mx * 0.3;
    const cy = HERO_CY() * 0.8 + my * 0.2;
    heroRings.push({ x: cx, y: cy, r: 0, t: 0, maxR: Math.max(W, H) * 0.7 });
  }, 4600);

  function drawSonar(ctx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (let i = heroRings.length - 1; i >= 0; i--) {
      const ring = heroRings[i];
      ring.r += 1.5;
      ring.t = ring.r / ring.maxR;
      if (ring.t >= 1) { heroRings.splice(i, 1); continue; }
      const alpha = (1 - ring.t) * 0.12;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,43,59,${alpha})`;
      ctx.lineWidth = 1.5 + (1 - ring.t) * 1.5;
      ctx.stroke();

      // Illuminate nearby neural nodes
      if (neural.ctx && nodes.length) {
        nodes.forEach(n => {
          const dx = n.x - ring.x, dy = n.y - ring.y;
          const d  = Math.sqrt(dx*dx + dy*dy);
          if (Math.abs(d - ring.r) < 20) {
            n.bright = Math.max(n.bright, (1 - Math.abs(d - ring.r) / 20) * 0.5);
          }
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 8. LIGHTNING FLASH — a pure light flash, no bolt lines
  // ══════════════════════════════════════════════════════════════
  function triggerLightning() {
    if (!lightning) return;
    lightning.style.opacity = '1';
    setTimeout(() => { lightning.style.opacity = '0.4'; }, 60);
    setTimeout(() => { lightning.style.opacity = '0'; }, 120);
    setTimeout(() => {
      lightning.style.opacity = '0.7';
      setTimeout(() => { lightning.style.opacity = '0'; }, 80);
    }, 250);
  }

  // Storm lightning every 12-22 seconds
  function scheduleLightning() {
    const delay = 12000 + Math.random() * 10000;
    setTimeout(() => {
      if (!paused) triggerLightning();
      scheduleLightning();
    }, delay);
  }
  scheduleLightning();

  // ══════════════════════════════════════════════════════════════
  // 9. HOVER PARTICLE DRIFT
  // ══════════════════════════════════════════════════════════════
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('.btn.primary, .card, .dash-card');
    if (!el || paused) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    // Pull nearby floaters toward the hovered element
    floaters.forEach(f => {
      const dx = cx - f.x, dy = cy - f.y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d < 200) {
        f.vx += dx / d * 0.06;
        f.vy += dy / d * 0.06;
        f.alpha = Math.min(0.18, f.alpha * 1.5);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════
  // MAIN LOOP
  // ══════════════════════════════════════════════════════════════
  let lastT = 0;
  function cinematicLoop(t) {
    if (!paused) {
      drawCityline(city.ctx, 0.92);
      drawNeural(neural.ctx);
      drawFog(fog.ctx);
      drawRain(rain.ctx);
      drawEmbers(ember.ctx);
      drawFloaters(floatC.ctx);
      drawSonar(sonar.ctx);
    }
    requestAnimationFrame(cinematicLoop);
  }

  initCityline();
  initNeural();
  requestAnimationFrame(cinematicLoop);

})();
