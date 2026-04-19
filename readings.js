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
    html += `<tr><td>${r.room}</td><td class="editable-name" data-resident="${ri}">${r.name || '-'}</td>`;
    dates.forEach(d => {
      const val = r.readings[d] != null ? r.readings[d] : '';
      html += `<td class="editable" data-resident="${ri}" data-date="${d}">${val ? numFmt(val) : '-'}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;

  table.querySelectorAll('td.editable').forEach(td => {
    td.addEventListener('click', () => startEdit(td));
  });
  table.querySelectorAll('td.editable-name').forEach(td => {
    td.addEventListener('click', () => startNameEdit(td));
  });
}

function startNameEdit(td) {
  const { token } = getConfig();
  if (!token) { showSetup(); return; }
  if (td.classList.contains('editing')) return;

  const ri = td.dataset.resident;
  const current = DATA.residents[ri].name || '';

  td.classList.add('editing');
  td.innerHTML = `<input type="text" value="${current}" data-original="${current}">`;
  const input = td.querySelector('input');
  input.focus();
  input.select();

  input.addEventListener('blur', () => finishNameEdit(td, input, ri));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = input.dataset.original; input.blur(); }
  });
}

function finishNameEdit(td, input, ri) {
  const newVal = input.value.trim();
  const original = input.dataset.original;
  td.classList.remove('editing');

  if (newVal !== original) {
    td.textContent = newVal || '-';
    td.classList.add('changed');
    if (!pendingEdits[ri]) pendingEdits[ri] = {};
    pendingEdits[ri]._name = newVal;
    document.getElementById('save-edits-btn').classList.remove('hidden');
  } else {
    td.textContent = original || '-';
  }
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

  for (const ri in pendingEdits) {
    for (const key in pendingEdits[ri]) {
      if (key === '_name') {
        DATA.residents[ri].name = pendingEdits[ri][key];
      } else {
        DATA.residents[ri].readings[key] = pendingEdits[ri][key];
      }
    }
  }

  try {
    const { sha } = await fetchData();
    await saveData(DATA, sha);
    renderReadingsTable();
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  }

  btn.textContent = 'Save Changes';
  btn.disabled = false;
}

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

  DATA.dates.push(date);
  DATA.dates.sort();

  try {
    const btn = document.getElementById('save-reading-btn');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const { sha } = await fetchData();
    await saveData(DATA, sha);

    document.getElementById('reading-modal').classList.add('hidden');
    renderReadingsTable();
    btn.textContent = 'Save Reading';
    btn.disabled = false;
  } catch (e) {
    errorEl.textContent = `Save failed: ${e.message}`;
    errorEl.classList.remove('hidden');
    document.getElementById('save-reading-btn').textContent = 'Save Reading';
    document.getElementById('save-reading-btn').disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initSetupListeners(renderReadingsTable);
  document.getElementById('add-reading-btn').addEventListener('click', openReadingModal);
  document.getElementById('save-reading-btn').addEventListener('click', saveReading);
  document.getElementById('cancel-reading-btn').addEventListener('click', () => {
    document.getElementById('reading-modal').classList.add('hidden');
  });
  document.getElementById('save-edits-btn').addEventListener('click', saveEdits);
  loadData(renderReadingsTable);
});
