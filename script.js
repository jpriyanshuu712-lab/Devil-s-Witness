// Devil's Witness — script.js
// Preserves full blockchain logic (SHA-256, mining, validation) while presenting an evidence integrity UI.

// --- Utilities ---
const $ = (sel) => document.querySelector(sel);
const qs = (sel) => document.querySelectorAll(sel);
const msgEl = $('#msg');

function showMessage(text, timeout = 3500) {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  clearTimeout(msgEl._t);
  msgEl._t = setTimeout(() => msgEl.classList.remove('show'), timeout);
}

// Convert ArrayBuffer to hex
function bufToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2,'0')).join('');
}

// SHA-256 using SubtleCrypto
async function sha256Hex(data) {
  let buf;
  if (data instanceof ArrayBuffer) buf = data;
  else if (typeof data === 'string') buf = new TextEncoder().encode(data);
  else if (data instanceof Uint8Array) buf = data;
  else throw new Error('Unsupported type for hashing');
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return bufToHex(hash);
}

// --- Blockchain core (preserved functionality) ---
let ledger = [];
let difficulty = 3; // leading zeros target (adjust for demonstration)
let pendingCount = 0;
let stats = { uploaded: 0, verified: 0, tampered: 0 };

// Create genesis block
function createGenesis() {
  const genesis = {
    index: 0,
    timestamp: new Date().toISOString(),
    caseNumber: 'GENESIS',
    evidenceID: 'GEN-000',
    evidenceType: 'system',
    officerName: 'SYSTEM',
    description: 'Ledger initialized.',
    evidenceHash: '0'.repeat(64),
    previousHash: '0'.repeat(64),
    nonce: 0,
    hash: null,
    status: 'valid'
  };
  genesis.hash = calcHash(genesis);
  ledger = [genesis];
}

// Calculate block hash (keeps SHA-256)
function calcHash(block) {
  const base = `${block.index}|${block.timestamp}|${block.caseNumber}|${block.evidenceID}|${block.evidenceType}|${block.officerName}|${block.description}|${block.evidenceHash}|${block.previousHash}|${block.nonce}`;
  // synchronous wrapper for hashing (but returns hex via Promise in sha256Hex). For mining we use async.
  // To allow mining loop to be interruptible we use async calls.
  return sha256Hex(base);
}

// Async mining: find nonce so hash starts with required zeros
async function mineBlockAsync(block, onProgress) {
  showMessage('Justice takes patience.');
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    block.nonce = nonce;
    const h = await calcHash(block);
    if (h.startsWith(target)) {
      block.hash = h;
      block.status = 'valid';
      return block;
    }
    if (nonce % 50 === 0 && typeof onProgress === 'function') onProgress(nonce);
    nonce++;
  }
}

// Add a new evidence block
async function addEvidenceBlock(data) {
  const prev = ledger[ledger.length - 1];
  const newBlock = {
    index: ledger.length,
    timestamp: new Date().toISOString(),
    caseNumber: data.caseNumber,
    evidenceID: data.evidenceID,
    evidenceType: data.evidenceType,
    officerName: data.officerName,
    description: data.description,
    evidenceHash: data.evidenceHash,
    previousHash: prev.hash || prev,
    nonce: 0,
    hash: null,
    status: 'pending'
  };
  ledger.push(newBlock);
  pendingCount++;
  updateDashboard();
  // mine in background (non-blocking)
  mineBlockAsync(newBlock, (n) => {
    // optional: update UI progress if desired
  }).then((blk) => {
    pendingCount = Math.max(0, pendingCount - 1);
    stats.uploaded++;
    showMessage("A new testimony has entered the record.");
    validateChain();
    updateDashboard();
    renderBlocks();
  }).catch((err) => {
    console.error('Mining error', err);
  });

  renderBlocks();
}

// Validate the entire ledger: mark tampered/valid and recalc chain health
async function validateChain() {
  let prevHash = null;
  let allGood = true;
  // We must await calcHash promises; compute hashes for each block and check previousHash links and difficulty requirement
  for (let i = 0; i < ledger.length; i++) {
    const b = ledger[i];
    // If block hasn't been mined yet, skip non-awaited hash check
    if (!b.hash) {
      b.status = 'pending';
      allGood = false;
      prevHash = b.hash || b.previousHash;
      continue;
    }
    // Recompute hash from stored fields and nonce to detect internal tampering
    const actualHash = await calcHash(b);
    if (actualHash !== b.hash) {
      b.status = 'tampered';
      allGood = false;
    } else if (i > 0 && b.previousHash !== ledger[i-1].hash) {
      b.status = 'tampered';
      allGood = false;
    } else {
      b.status = 'valid';
    }
    prevHash = b.hash;
  }
  // compute stats
  stats.tampered = ledger.filter(x => x.status === 'tampered').length;
  stats.verified = ledger.filter(x => x.status === 'valid' && x.index !== 0).length;
  updateDashboard();
  // visual heartbeat vs broken
  const healthPct = ledger.length <= 1 ? 100 : Math.max(0, Math.round(((ledger.length - stats.tampered -1) / (ledger.length -1)) * 100));
  $('#chainHealth').textContent = `${healthPct}%`;
  if (!allGood) {
    document.body.classList.add('chain-broken');
  } else {
    document.body.classList.remove('chain-broken');
  }
}

// --- File hashing helpers ---
async function hashFileInput(fileInput) {
  const f = fileInput?.files?.[0];
  if (!f) return null;
  const buffer = await f.arrayBuffer();
  const h = await sha256Hex(buffer);
  return h;
}

// --- UI: Render blocks ---
function renderBlocks() {
  const container = $('#blocks');
  container.innerHTML = '';
  for (let i = ledger.length - 1; i >= 0; i--) {
    const b = ledger[i];
    const card = document.createElement('div');
    card.className = 'block-card ' + (b.status === 'valid' ? 'status-valid' : (b.status === 'tampered' ? 'status-tampered' : 'status-pending'));
    card.innerHTML = `
      <div class="block-row">
        <strong>Evidence Block #${b.index}</strong>
        <div style="margin-left:auto;font-size:13px;color:${b.status==='tampered'?'#ff7b7b':'#9fd7b2'}">${b.status.toUpperCase()}</div>
      </div>
      <div class="block-meta"><strong>Case:</strong> ${escapeHtml(b.caseNumber)} — <strong>Evidence ID:</strong> ${escapeHtml(b.evidenceID)}</div>
      <div class="block-meta"><strong>Type:</strong> ${escapeHtml(b.evidenceType)} • <strong>Officer:</strong> ${escapeHtml(b.officerName)} • <strong>Time:</strong> ${new Date(b.timestamp).toLocaleString()}</div>
      <div class="block-meta">${escapeHtml(b.description)}</div>
      <div class="block-hash"><strong>Hash:</strong> ${b.hash ? b.hash.slice(0, 24) + '…' : '<em>pending</em>'}</div>
      <div class="block-hash"><strong>Prev:</strong> ${b.previousHash ? b.previousHash.slice(0, 24) + '…' : ''}</div>
      <div class="block-actions">
        <button class="small-btn inspect" data-index="${b.index}">Inspect</button>
        <button class="small-btn tamper" data-index="${b.index}">Tamper Evidence</button>
        <button class="small-btn warn export" data-index="${b.index}">Export Metadata</button>
      </div>
    `;
    container.appendChild(card);
  }

  // attach handlers
  qs('.small-btn.inspect').forEach(el => el.onclick = (e) => inspectBlock(e.target.dataset.index));
  qs('.small-btn.tamper').forEach(el => el.onclick = (e) => tamperBlockPrompt(e.target.dataset.index));
  qs('.small-btn.export').forEach(el => el.onclick = (e) => exportMetadata(e.target.dataset.index));
}

// inspect block (full modal-like view via message)
function inspectBlock(index) {
  const b = ledger[index];
  const lines = [
    `Evidence Block #${b.index}`,
    `Case: ${b.caseNumber}`,
    `Evidence ID: ${b.evidenceID}`,
    `Type: ${b.evidenceType}`,
    `Officer: ${b.officerName}`,
    `Time: ${new Date(b.timestamp).toLocaleString()}`,
    `Description: ${b.description}`,
    `Evidence Hash: ${b.evidenceHash}`,
    `Block Hash: ${b.hash || 'pending'}`,
    `Previous Hash: ${b.previousHash}`
  ];
  showMessage(lines.join(' — '), 8000);
}

// Prompt and tamper block (simulates malicious change / forensic edit)
function tamperBlockPrompt(index) {
  const i = parseInt(index, 10);
  const b = ledger[i];
  if (!b) return;
  // simple prompt — we'll let user change description (simulated)
  const newDesc = prompt("Tamper Evidence — enter new description to alter the record:", b.description + " (edited)");
  if (newDesc === null) return;
  // Modify evidenceHash (simulate file alteration) and mark chain invalid
  b.description = newDesc;
  // intentionally change evidenceHash so stored hash no longer matches file
  b.evidenceHash = b.evidenceHash.split('').reverse().join('').slice(0,64); // mutated fingerprint
  b.hash = null; // mined hash no longer correct
  showMessage("The heartbeat changed.\nSomeone rewrote the truth.");
  validateChain().then(renderBlocks);
}

// Export metadata as JSON file
function exportMetadata(index) {
  const b = ledger[index];
  const payload = JSON.stringify(b, null, 2);
  const blob = new Blob([payload], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `evidence-${b.evidenceID || b.index}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showMessage("The evidence has found its voice.");
}

// --- Verification ---
async function verifyFileAgainstLedger(fileInput, evidenceID) {
  const h = await hashFileInput(fileInput);
  if (!h) {
    showMessage("No file selected.");
    return;
  }
  // find matching block (prefer evidenceID if provided)
  let found = null;
  if (evidenceID) {
    found = ledger.find(b => b.evidenceID === evidenceID);
  }
  if (!found) {
    // fallback: search latest by evidenceHash match
    found = ledger.find(b => b.evidenceHash === h || b.hash === h);
  }
  if (!found) {
    // nothing matched
    showVerificationResult(false, "The chain remembers nothing like this.");
    return;
  }

  // Compare computed file hash to recorded evidence fingerprint
  if (found.evidenceHash === h) {
    showVerificationResult(true, "I don't need eyes. The truth remains unchanged.");
    stats.verified++;
    updateDashboard();
  } else {
    showVerificationResult(false, "The heartbeat changed. Someone rewrote the truth.");
    stats.tampered++;
    updateDashboard();
  }
  validateChain();
}

function showVerificationResult(ok, phrase) {
  const el = $('#verifyResult');
  el.className = 'verify-result glass ' + (ok ? 'ok' : 'bad');
  el.textContent = phrase;
  showMessage(phrase);
}

// --- Dashboard updates ---
function updateDashboard() {
  $('#countUploaded').textContent = stats.uploaded;
  $('#countVerified').textContent = stats.verified;
  $('#countTampered').textContent = stats.tampered;
  $('#dashUploaded').textContent = stats.uploaded;
  $('#dashVerified').textContent = stats.verified;
  $('#dashTampered').textContent = stats.tampered;
  $('#dashPending').textContent = pendingCount;
}

// --- Helpers ---
function escapeHtml(s){
  if (!s && s !== 0) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// --- Form handlers ---
$('#evidence-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const caseNumber = $('#caseNumber').value.trim();
  const evidenceID = $('#evidenceID').value.trim() || `EV-${Date.now()}`;
  const evidenceType = $('#evidenceType').value;
  const officerName = $('#officerName').value.trim() || 'Unknown';
  const description = $('#description').value.trim() || '';
  const fileInput = $('#evidenceFile');

  // compute file hash if file provided; otherwise create fingerprint from metadata
  let evidenceHash = '';
  if (fileInput.files && fileInput.files.length) {
    const file = fileInput.files[0];
    const arrayBuffer = await file.arrayBuffer();
    evidenceHash = await sha256Hex(arrayBuffer);
    showMessage("The evidence has found its voice.");
  } else {
    // metadata fingerprint fallback
    const seed = `${caseNumber}|${evidenceID}|${evidenceType}|${officerName}|${description}|${Date.now()}`;
    evidenceHash = await sha256Hex(seed);
    showMessage("The evidence has found its voice.");
  }

  // Create block
  await addEvidenceBlock({
    caseNumber, evidenceID, evidenceType, officerName, description, evidenceHash
  });

  // UI reset
  $('#evidence-form').reset();
  renderBlocks();
});

// Verify handlers
$('#verifyBtn').addEventListener('click', async () => {
  const fileInput = $('#verifyFile');
  const eid = $('#verifyEvidenceID').value.trim();
  showMessage("Checking the record...");
  await verifyFileAgainstLedger(fileInput, eid);
});

$('#quickScan').addEventListener('click', async () => {
  // pick latest evidence and try verify with provided file
  const fileInput = $('#verifyFile');
  if (!fileInput.files.length) {
    showMessage("Select a file first.");
    return;
  }
  const latest = ledger[ledger.length - 1];
  if (!latest) {
    showMessage("No records to compare against.");
    return;
  }
  showMessage("Scanning the latest testimony...");
  await verifyFileAgainstLedger(fileInput, latest.evidenceID);
});

// Reset ledger
$('#reset-chain').addEventListener('click', () => {
  if (!confirm("Reset the ledger? This will clear all evidence blocks (except genesis).")) return;
  createGenesis();
  stats = { uploaded: 0, verified: 0, tampered: 0 };
  pendingCount = 0;
  updateDashboard();
  renderBlocks();
  showMessage("The record has been sealed.\nA new investigation begins.");
});

// anchor buttons
$('#to-vault').addEventListener('click', () => location.href = '#vault');
$('#to-verify').addEventListener('click', () => location.href = '#verify');

// File hash helper for verify area (display helpful phrase on selection)
$('#verifyFile').addEventListener('change', async () => {
  const f = $('#verifyFile').files[0];
  if (f) showMessage("Every truth leaves a fingerprint.");
});

// Quick initialization
(async function init(){
  createGenesis();
  renderBlocks();
  validateChain();
  updateDashboard();
  showMessage("The record has been sealed. A new investigation begins.", 2500);
})();