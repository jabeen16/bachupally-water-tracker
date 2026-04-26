let pendingEdits = {};
let currentMonth = 'all';
let editMode = false;

function renderReadingsTable() {
  const table = document.getElementById('readings-table');
  const wrapper = table.closest('.table-wrapper');
  const editHint = document.querySelector('.edit-hint');
  const editBtn = document.getElementById('edit-mode-btn');
  const dates = filterDatesByMonth(DATA.dates, currentMonth);
  const saveBtn = document.getElementById('save-edits-btn');
  const latestDate = DATA.dates[DATA.dates.length - 1];
  pendingEdits = {};
  saveBtn.classList.add('hidden');

  if (editMode) {
    wrapper.classList.add('edit-mode');
    editHint.classList.remove('hidden');
    editBtn.textContent = 'Cancel';
  } else {
    wrapper.classList.remove('edit-mode');
    editHint.classList.add('hidden');
    editBtn.textContent = 'Edit';
  }

  let html = '<thead><tr><th>Room</th><th>Tenant</th>';
  dates.forEach(d => {
    const t = fmtTime(d);
    html += `<th>${fmtDate(d)}${t ? `<br><small>${t}</small>` : ''}</th>`;
  });
  html += '</tr></thead><tbody>';

  DATA.residents.forEach((r, ri) => {
    html += `<tr><td>${r.room}</td><td class="editable-name" data-resident="${ri}">${r.name || '-'}</td>`;
    dates.forEach(d => {
      const val = r.readings[d] != null ? r.readings[d] : '';
      const cls = d === latestDate ? 'editable' : '';
      html += `<td class="${cls}" data-resident="${ri}" data-date="${d}">${val ? numFmt(val) : '-'}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;

  if (editMode) {
    table.querySelectorAll('td.editable').forEach(td => {
      td.addEventListener('click', () => startEdit(td));
    });
    table.querySelectorAll('td.editable-name').forEach(td => {
      td.addEventListener('click', () => startNameEdit(td));
    });
  }
}

function toggleEditMode() {
  if (editMode && Object.keys(pendingEdits).length > 0) {
    if (!confirm('Discard unsaved changes?')) return;
  }
  editMode = !editMode;
  renderReadingsTable();
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
    editMode = false;
    renderReadingsTable();
  } catch (e) {
    if (isAuthError(e)) {
      showSetup(e.message, true);
    } else {
      alert(e.message);
    }
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
  const timeInput = document.getElementById('reading-time');
  dateInput.value = new Date().toISOString().split('T')[0];
  timeInput.value = '';

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
  const timeInput = document.getElementById('reading-time');
  const readingDate = dateInput.value;
  const readingTimeInput = timeInput.value.trim();
  const errorEl = document.getElementById('reading-error');
  errorEl.classList.add('hidden');

  if (!readingDate) {
    errorEl.textContent = 'Please select a date.';
    errorEl.classList.remove('hidden');
    return;
  }

  const readingTimeFormat = /^([01][0-9]|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/;
  if (readingTimeInput && !readingTimeFormat.test(readingTimeInput)) {
    errorEl.textContent = 'Time must be HH:MM in 24-hour format with 5-minute steps (e.g. 06:30, 18:45).';
    errorEl.classList.remove('hidden');
    return;
  }

  const readingTime = readingTimeInput || '00:00';
  const newReadingKey = `${readingDate}T${readingTime}`;

  if (DATA.dates.includes(newReadingKey)) {
    errorEl.textContent = 'A reading already exists for this date and time.';
    errorEl.classList.remove('hidden');
    return;
  }

  const newReadings = {};
  DATA.residents.forEach((r, i) => {
    const input = document.getElementById(`reading-${i}`);
    const val = parseInt(input.value);
    if (!isNaN(val)) newReadings[i] = val;
  });

  if (Object.keys(newReadings).length === 0) {
    errorEl.textContent = 'Enter at least one reading.';
    errorEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('save-reading-btn');
  try {
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

    Object.entries(newReadings).forEach(([i, val]) => {
      DATA.residents[i].readings[newReadingKey] = val;
    });
    DATA.dates.push(newReadingKey);
    DATA.dates.sort();

    const { sha } = await fetchData();
    await saveData(DATA, sha);

    document.getElementById('reading-modal').classList.add('hidden');
    editMode = false;
    renderReadingsTable();
  } catch (e) {
    DATA.dates = DATA.dates.filter(d => d !== newReadingKey);
    Object.keys(newReadings).forEach(i => {
      delete DATA.residents[i].readings[newReadingKey];
    });
    if (isAuthError(e)) {
      showSetup(e.message, true);
    } else {
      errorEl.textContent = e.message;
      errorEl.classList.remove('hidden');
    }
  } finally {
    btn.textContent = 'Save Reading';
    btn.disabled = false;
  }
}

function initReadings() {
  const select = document.getElementById('month-select');
  populateMonthSelect(select, (month) => {
    currentMonth = month;
    renderReadingsTable();
  });
  currentMonth = select.value;
  renderReadingsTable();
}

document.addEventListener('DOMContentLoaded', () => {
  initSetupListeners(initReadings);
  document.getElementById('add-reading-btn').addEventListener('click', openReadingModal);
  document.getElementById('save-reading-btn').addEventListener('click', saveReading);
  document.getElementById('cancel-reading-btn').addEventListener('click', () => {
    document.getElementById('reading-modal').classList.add('hidden');
  });
  document.getElementById('save-edits-btn').addEventListener('click', saveEdits);
  document.getElementById('edit-mode-btn').addEventListener('click', toggleEditMode);
  loadData(initReadings);
});
