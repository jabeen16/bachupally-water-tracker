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
    html += `<th>${fmtDateTimeHtml(d)}</th>`;
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
  td.innerHTML = `<input type="number" value="${current}" data-original="${current}" onwheel="this.blur()">`;
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

function clampReadingHourInput(hourInputElement) {
  const trimmedHour = hourInputElement.value.trim();
  if (trimmedHour === '') return;
  const parsedHour = parseInt(trimmedHour, 10);
  if (isNaN(parsedHour)) return;
  const clampedHour = Math.max(0, Math.min(23, parsedHour));
  hourInputElement.value = String(clampedHour).padStart(2, '0');
}

function snapReadingMinuteInput(minuteInputElement) {
  const trimmedMinute = minuteInputElement.value.trim();
  if (trimmedMinute === '') return;
  const parsedMinute = parseInt(trimmedMinute, 10);
  if (isNaN(parsedMinute)) return;
  const snappedMinute = Math.min(55, Math.max(0, Math.round(parsedMinute / 5) * 5));
  minuteInputElement.value = String(snappedMinute).padStart(2, '0');
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
  const hourInput = document.getElementById('reading-hour');
  const minuteInput = document.getElementById('reading-minute');
  const now = new Date();
  const todayLocalDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const defaultMinute = Math.min(55, Math.max(0, Math.round(now.getMinutes() / 5) * 5));
  const latestExistingKey = DATA.dates.length > 0 ? DATA.dates[DATA.dates.length - 1] : null;
  const latestExistingDate = latestExistingKey ? latestExistingKey.substring(0, 10) : null;
  dateInput.value = todayLocalDate;
  dateInput.max = todayLocalDate;
  if (latestExistingDate) dateInput.min = latestExistingDate;
  hourInput.value = String(now.getHours()).padStart(2, '0');
  minuteInput.value = String(defaultMinute).padStart(2, '0');
  hourInput.onblur = () => clampReadingHourInput(hourInput);
  minuteInput.onblur = () => snapReadingMinuteInput(minuteInput);

  fields.innerHTML = '';
  DATA.residents.forEach((r, i) => {
    fields.innerHTML += `
      <div class="reading-entry">
        <label>${r.room} — ${r.name}</label>
        <input type="number" id="reading-${i}" min="0" step="1" inputmode="numeric" placeholder="Meter reading" onwheel="this.blur()">
      </div>
    `;
  });

  modal.classList.remove('hidden');
}

async function saveReading() {
  const dateInput = document.getElementById('reading-date');
  const hourInput = document.getElementById('reading-hour');
  const minuteInput = document.getElementById('reading-minute');
  clampReadingHourInput(hourInput);
  snapReadingMinuteInput(minuteInput);
  const readingDate = dateInput.value;
  const hourValue = hourInput.value.trim();
  const minuteValue = minuteInput.value.trim();
  const errorEl = document.getElementById('reading-error');
  errorEl.classList.add('hidden');

  if (!readingDate) {
    errorEl.textContent = 'Please select a date.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (hourValue === '' || minuteValue === '') {
    errorEl.textContent = 'Please enter both hour and minute.';
    errorEl.classList.remove('hidden');
    return;
  }

  const hourNumber = parseInt(hourValue, 10);
  const minuteNumber = parseInt(minuteValue, 10);
  if (isNaN(hourNumber) || hourNumber < 0 || hourNumber > 23) {
    errorEl.textContent = 'Please enter a valid hour (0–23).';
    errorEl.classList.remove('hidden');
    return;
  }
  if (isNaN(minuteNumber) || minuteNumber < 0 || minuteNumber > 55 || minuteNumber % 5 !== 0) {
    errorEl.textContent = 'Please enter a valid minute (0–55, in 5-minute steps).';
    errorEl.classList.remove('hidden');
    return;
  }
  const readingTime = `${String(hourNumber).padStart(2, '0')}:${String(minuteNumber).padStart(2, '0')}`;
  const newReadingKey = `${readingDate}T${readingTime}`;

  const now = new Date();
  const todayLocalDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (readingDate > todayLocalDate) {
    errorEl.textContent = 'Future dates are not allowed.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (DATA.dates.includes(newReadingKey)) {
    errorEl.textContent = 'A reading already exists for this date and time.';
    errorEl.classList.remove('hidden');
    return;
  }

  const latestExistingKey = DATA.dates.length > 0 ? DATA.dates[DATA.dates.length - 1] : null;
  if (latestExistingKey && newReadingKey < latestExistingKey) {
    errorEl.textContent = `Reading must be after the latest recorded reading (${fmtDateTime(latestExistingKey)}).`;
    errorEl.classList.remove('hidden');
    return;
  }

  const newReadings = {};
  const roomsMissingReading = [];
  DATA.residents.forEach((resident, residentIndex) => {
    const meterInput = document.getElementById(`reading-${residentIndex}`);
    const meterValue = parseInt(meterInput.value);
    if (isNaN(meterValue)) {
      roomsMissingReading.push(resident.room);
    } else {
      newReadings[residentIndex] = meterValue;
    }
  });

  if (roomsMissingReading.length > 0) {
    errorEl.textContent = `Please enter readings for: ${roomsMissingReading.join(', ')}.`;
    errorEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('save-reading-btn');
  const previousValuesByResident = {};
  try {
    btn.textContent = 'Saving...';
    btn.disabled = true;

    for (const ri in pendingEdits) {
      previousValuesByResident[ri] = {};
      for (const editFieldKey in pendingEdits[ri]) {
        if (editFieldKey === '_name') {
          previousValuesByResident[ri]._name = DATA.residents[ri].name;
          DATA.residents[ri].name = pendingEdits[ri][editFieldKey];
        } else {
          previousValuesByResident[ri][editFieldKey] = DATA.residents[ri].readings[editFieldKey];
          DATA.residents[ri].readings[editFieldKey] = pendingEdits[ri][editFieldKey];
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
    for (const ri in previousValuesByResident) {
      for (const editFieldKey in previousValuesByResident[ri]) {
        if (editFieldKey === '_name') {
          DATA.residents[ri].name = previousValuesByResident[ri]._name;
        } else {
          DATA.residents[ri].readings[editFieldKey] = previousValuesByResident[ri][editFieldKey];
        }
      }
    }
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

function exportReadingsCsv() {
  const datesInRange = filterDatesByMonth(DATA.dates, currentMonth);
  const headerRow = ['Room', 'Tenant', ...datesInRange.map(d => fmtDateTime(d))];
  const dataRows = DATA.residents.map(resident => [
    resident.room,
    resident.name,
    ...datesInRange.map(d => resident.readings[d] ?? '')
  ]);
  downloadCsv(`bachupally-readings-${currentMonth}.csv`, headerRow, dataRows);
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
  document.getElementById('export-readings-btn').addEventListener('click', exportReadingsCsv);
  loadData(initReadings);
});
