const GITHUB_API = 'https://api.github.com';
let DATA = null;
let allRoomsChart = null;
let singleRoomChart = null;

// ── GitHub API ──

function getConfig() {
  const token = localStorage.getItem('gh_token');
  const owner = localStorage.getItem('gh_owner') || 'jabeen16';
  const repo = localStorage.getItem('gh_repo') || 'bachupally-water-tracker';
  return { token, owner, repo };
}

async function fetchData(requireAuth) {
  const { token, owner, repo } = getConfig();
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/data.json`, { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const file = await res.json();
  const content = atob(file.content);
  return { data: JSON.parse(content), sha: file.sha };
}

async function saveData(data, sha) {
  const { token, owner, repo } = getConfig();
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/data.json`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Update readings - ${new Date().toISOString().split('T')[0]}`,
      content,
      sha
    })
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}

// ── Computation ──

function computeConsumption(data) {
  const dates = data.dates;
  const periods = [];
  for (let i = 0; i < dates.length - 1; i++) {
    periods.push({ from: dates[i], to: dates[i + 1] });
  }

  const rows = data.residents.map(r => {
    const consumption = {};
    const perDay = {};
    let total = 0;
    let totalDays = 0;

    periods.forEach(p => {
      const r1 = r.readings[p.from];
      const r2 = r.readings[p.to];
      if (r1 != null && r2 != null) {
        const diff = r2 - r1;
        const days = (new Date(p.to) - new Date(p.from)) / (1000 * 60 * 60 * 24);
        consumption[`${p.from}_${p.to}`] = diff;
        perDay[`${p.from}_${p.to}`] = Math.round((diff / days) * 10) / 10;
        total += diff;
        totalDays += days;
      }
    });

    return {
      name: r.name,
      room: r.room,
      consumption,
      perDay,
      total,
      totalPerDay: totalDays > 0 ? Math.round((total / totalDays) * 10) / 10 : 0
    };
  });

  return { periods, rows };
}

// ── Format helpers ──

function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function periodLabel(p) {
  return `${fmtDate(p.from)} \u2192 ${fmtDate(p.to)}`;
}

function numFmt(n) {
  return n.toLocaleString('en-IN');
}

function roomLabel(r) {
  return r.name ? `${r.room} (${r.name})` : r.room;
}

// ── Render Summary Cards ──

function renderCards(computed) {
  const container = document.getElementById('summary-cards');
  const totalUsage = computed.rows.reduce((s, r) => s + r.total, 0);
  const highestRoom = computed.rows.reduce((a, b) => a.totalPerDay > b.totalPerDay ? a : b);
  const lowestRoom = computed.rows.reduce((a, b) => a.totalPerDay < b.totalPerDay ? a : b);

  container.innerHTML = `
    <div class="card">
      <div class="label">Total Building Usage</div>
      <div class="value">${numFmt(totalUsage)}</div>
      <div class="sub">litres (all rooms combined)</div>
    </div>
    <div class="card">
      <div class="label">Highest Per Day</div>
      <div class="value">${numFmt(highestRoom.totalPerDay)}</div>
      <div class="sub">${roomLabel(highestRoom)}</div>
    </div>
    <div class="card">
      <div class="label">Lowest Per Day</div>
      <div class="value">${numFmt(lowestRoom.totalPerDay)}</div>
      <div class="sub">${roomLabel(lowestRoom)}</div>
    </div>
    <div class="card">
      <div class="label">Readings Recorded</div>
      <div class="value">${DATA.dates.length}</div>
      <div class="sub">${fmtDate(DATA.dates[0])} to ${fmtDate(DATA.dates[DATA.dates.length - 1])}</div>
    </div>
  `;
}

// ── Render Charts ──

const COLORS = [
  '#4472c4', '#ed7d31', '#2f5597', '#ffc000', '#5b9bd5',
  '#70ad47', '#ff5050', '#9b59b6', '#00b0f0', '#00b050'
];

function renderAllRoomsChart(computed) {
  const ctx = document.getElementById('all-rooms-chart').getContext('2d');
  const labels = computed.rows.map(r => roomLabel(r));
  const datasets = [];

  computed.periods.forEach((p, i) => {
    const key = `${p.from}_${p.to}`;
    datasets.push({
      label: periodLabel(p),
      data: computed.rows.map(r => r.perDay[key] || 0),
      backgroundColor: COLORS[i % COLORS.length],
      borderRadius: 4
    });
  });

  // Total per day as a separate bar
  datasets.push({
    label: 'Total Per Day',
    data: computed.rows.map(r => r.totalPerDay),
    backgroundColor: '#c00000',
    borderRadius: 4
  });

  if (allRoomsChart) allRoomsChart.destroy();
  allRoomsChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${numFmt(ctx.parsed.y)} litres/day`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Litres / Day' },
          ticks: { callback: v => numFmt(v) }
        },
        x: {
          ticks: { maxRotation: 90, minRotation: 45, autoSkip: false }
        }
      }
    }
  });
}

function renderSingleRoomChart(computed, roomIndex) {
  const ctx = document.getElementById('single-room-chart').getContext('2d');
  const resident = computed.rows[roomIndex];
  const labels = computed.periods.map(p => periodLabel(p));
  const data = computed.periods.map(p => resident.perDay[`${p.from}_${p.to}`] || 0);

  if (singleRoomChart) singleRoomChart.destroy();
  singleRoomChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: roomLabel(resident),
        data,
        borderColor: '#c00000',
        backgroundColor: 'rgba(192, 0, 0, 0.1)',
        borderWidth: 3,
        pointRadius: 8,
        pointBackgroundColor: '#c00000',
        pointHoverRadius: 10,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${numFmt(ctx.parsed.y)} litres/day`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Litres / Day' },
          ticks: { callback: v => numFmt(v) }
        }
      }
    }
  });
}

// ── Render Tables ──

function renderTables(computed) {
  // Consumption table
  const cTable = document.getElementById('consumption-table');
  let cHtml = '<thead><tr><th>Room</th><th>Tenant</th>';
  computed.periods.forEach(p => { cHtml += `<th>${periodLabel(p)}</th>`; });
  cHtml += '<th>Total</th></tr></thead><tbody>';

  const allPerDay = computed.rows.map(r => r.totalPerDay);
  const avgPerDay = allPerDay.reduce((a, b) => a + b, 0) / allPerDay.length;

  computed.rows.forEach(r => {
    cHtml += `<tr><td>${r.room}</td><td>${r.name}</td>`;
    computed.periods.forEach(p => {
      const key = `${p.from}_${p.to}`;
      cHtml += `<td>${r.consumption[key] != null ? numFmt(r.consumption[key]) : ''}</td>`;
    });
    cHtml += `<td><strong>${numFmt(r.total)}</strong></td></tr>`;
  });
  cHtml += '</tbody>';
  cTable.innerHTML = cHtml;

  // Per day table with anomaly highlighting
  const pTable = document.getElementById('perday-table');
  let pHtml = '<thead><tr><th>Room</th><th>Tenant</th>';
  computed.periods.forEach(p => { pHtml += `<th>${periodLabel(p)}</th>`; });
  pHtml += '<th>Total/Day</th></tr></thead><tbody>';

  computed.rows.forEach(r => {
    pHtml += `<tr><td>${r.room}</td><td>${r.name}</td>`;
    computed.periods.forEach(p => {
      const key = `${p.from}_${p.to}`;
      const val = r.perDay[key];
      const cls = val != null && val > avgPerDay * 1.5 ? 'high' : val != null && val < avgPerDay * 0.3 ? 'low' : '';
      pHtml += `<td class="${cls}">${val != null ? numFmt(val) : ''}</td>`;
    });
    const cls = r.totalPerDay > avgPerDay * 1.5 ? 'high' : r.totalPerDay < avgPerDay * 0.3 ? 'low' : '';
    pHtml += `<td class="${cls}"><strong>${numFmt(r.totalPerDay)}</strong></td></tr>`;
  });
  pHtml += '</tbody>';
  pTable.innerHTML = pHtml;
}

// ── Room Select ──

function populateRoomSelect(computed) {
  const select = document.getElementById('room-select');
  select.innerHTML = '';
  computed.rows.forEach((r, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = roomLabel(r);
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    renderSingleRoomChart(computed, parseInt(select.value));
  });
}

// ── Add Reading ──

function openReadingModal() {
  const { token } = getConfig();
  if (!token) {
    showSetup();
    return;
  }

  const modal = document.getElementById('reading-modal');
  const fields = document.getElementById('reading-fields');
  const dateInput = document.getElementById('reading-date');
  dateInput.value = new Date().toISOString().split('T')[0];

  fields.innerHTML = '';
  DATA.residents.forEach((r, i) => {
    fields.innerHTML += `
      <div class="reading-entry">
        <label>${r.room} — ${r.name}</label>
        <input type="number" id="reading-${i}" placeholder="Meter reading">
      </div>
    `;
  });

  modal.classList.remove('hidden');
}

async function saveReading() {
  const dateInput = document.getElementById('reading-date');
  const date = dateInput.value;
  const errorEl = document.getElementById('reading-error');
  errorEl.classList.add('hidden');

  if (!date) {
    errorEl.textContent = 'Please select a date.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (DATA.dates.includes(date)) {
    errorEl.textContent = 'Reading for this date already exists.';
    errorEl.classList.remove('hidden');
    return;
  }

  // Collect readings
  let hasAtLeastOne = false;
  DATA.residents.forEach((r, i) => {
    const input = document.getElementById(`reading-${i}`);
    const val = parseInt(input.value);
    if (!isNaN(val)) {
      r.readings[date] = val;
      hasAtLeastOne = true;
    }
  });

  if (!hasAtLeastOne) {
    errorEl.textContent = 'Enter at least one reading.';
    errorEl.classList.remove('hidden');
    return;
  }

  // Add date and sort
  DATA.dates.push(date);
  DATA.dates.sort();

  // Save to GitHub
  try {
    const btn = document.getElementById('save-reading-btn');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const { sha } = await fetchData();
    await saveData(DATA, sha);

    document.getElementById('reading-modal').classList.add('hidden');
    renderAll();
    btn.textContent = 'Save Reading';
    btn.disabled = false;
  } catch (e) {
    errorEl.textContent = `Save failed: ${e.message}`;
    errorEl.classList.remove('hidden');
    document.getElementById('save-reading-btn').textContent = 'Save Reading';
    document.getElementById('save-reading-btn').disabled = false;
  }
}

// ── Editable Readings Table ──

let pendingEdits = {};

function renderReadingsTable() {
  const table = document.getElementById('readings-table');
  const dates = DATA.dates;
  const saveBtn = document.getElementById('save-edits-btn');
  pendingEdits = {};
  saveBtn.classList.add('hidden');

  let html = '<thead><tr><th>Room</th><th>Tenant</th>';
  dates.forEach(d => { html += `<th>${fmtDate(d)}</th>`; });
  html += '</tr></thead><tbody>';

  DATA.residents.forEach((r, ri) => {
    html += `<tr><td>${r.room}</td><td>${r.name}</td>`;
    dates.forEach(d => {
      const val = r.readings[d] != null ? r.readings[d] : '';
      html += `<td class="editable" data-resident="${ri}" data-date="${d}">${val ? numFmt(val) : '-'}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;

  // Click to edit
  table.querySelectorAll('td.editable').forEach(td => {
    td.addEventListener('click', () => startEdit(td));
  });
}

function startEdit(td) {
  const { token } = getConfig();
  if (!token) {
    showSetup();
    return;
  }

  if (td.classList.contains('editing')) return;

  const ri = td.dataset.resident;
  const date = td.dataset.date;
  const current = DATA.residents[ri].readings[date] || '';

  td.classList.add('editing');
  td.innerHTML = `<input type="number" value="${current}" data-original="${current}">`;
  const input = td.querySelector('input');
  input.focus();
  input.select();

  input.addEventListener('blur', () => finishEdit(td, input, ri, date));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = input.dataset.original; input.blur(); }
  });
}

function finishEdit(td, input, ri, date) {
  const newVal = parseInt(input.value);
  const original = parseInt(input.dataset.original);
  td.classList.remove('editing');

  if (!isNaN(newVal) && newVal !== original) {
    td.textContent = numFmt(newVal);
    td.classList.add('changed');
    if (!pendingEdits[ri]) pendingEdits[ri] = {};
    pendingEdits[ri][date] = newVal;
    document.getElementById('save-edits-btn').classList.remove('hidden');
  } else {
    td.textContent = !isNaN(original) ? numFmt(original) : '-';
  }
}

async function saveEdits() {
  const btn = document.getElementById('save-edits-btn');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  // Apply edits to DATA
  for (const ri in pendingEdits) {
    for (const date in pendingEdits[ri]) {
      DATA.residents[ri].readings[date] = pendingEdits[ri][date];
    }
  }

  try {
    const { sha } = await fetchData();
    await saveData(DATA, sha);
    renderAll();
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  }

  btn.textContent = 'Save Changes';
  btn.disabled = false;
}

// ── Render All ──

function renderAll() {
  const computed = computeConsumption(DATA);
  renderCards(computed);
  renderAllRoomsChart(computed);
  populateRoomSelect(computed);
  renderSingleRoomChart(computed, 0);
  renderTables(computed);
  renderReadingsTable();
}

// ── Setup ──

function showSetup() {
  const { token, owner, repo } = getConfig();
  if (token) document.getElementById('token-input').value = '';
  if (owner) document.getElementById('repo-owner').value = owner;
  if (repo) document.getElementById('repo-name').value = repo;
  document.getElementById('setup-modal').classList.remove('hidden');
}

async function saveSetup() {
  const token = document.getElementById('token-input').value.trim();
  const owner = document.getElementById('repo-owner').value.trim();
  const repo = document.getElementById('repo-name').value.trim();
  const errorEl = document.getElementById('setup-error');
  errorEl.classList.add('hidden');

  if (!token || !owner || !repo) {
    errorEl.textContent = 'All fields are required.';
    errorEl.classList.remove('hidden');
    return;
  }

  localStorage.setItem('gh_token', token);
  localStorage.setItem('gh_owner', owner);
  localStorage.setItem('gh_repo', repo);

  try {
    const { data } = await fetchData();
    DATA = data;
    document.getElementById('setup-modal').classList.add('hidden');
    renderAll();
  } catch (e) {
    errorEl.textContent = `Connection failed: ${e.message}. Check your token and repo.`;
    errorEl.classList.remove('hidden');
  }
}

// ── Init ──

async function init() {
  // Event listeners
  document.getElementById('settings-btn').addEventListener('click', showSetup);
  document.getElementById('save-token-btn').addEventListener('click', saveSetup);
  document.getElementById('add-reading-btn').addEventListener('click', openReadingModal);
  document.getElementById('save-reading-btn').addEventListener('click', saveReading);
  document.getElementById('cancel-reading-btn').addEventListener('click', () => {
    document.getElementById('reading-modal').classList.add('hidden');
  });
  document.getElementById('save-edits-btn').addEventListener('click', saveEdits);
  document.getElementById('cancel-setup-btn').addEventListener('click', () => {
    document.getElementById('setup-modal').classList.add('hidden');
  });

  // Try loading data without token first (works for public repos)
  try {
    const { data } = await fetchData();
    DATA = data;
    renderAll();
  } catch (e) {
    // If public read fails, ask for token
    showSetup();
  }
}

document.addEventListener('DOMContentLoaded', init);
