/* ============================================================
   STUDIE- EN TAKENAGENDA  |  script.js
   ============================================================ */

// ── STATE ────────────────────────────────────────────────────
let appData = { classes: [], events: [], availability: [] };
let currentView  = 'month';
let currentDate  = new Date();
let currentEventId = null;
let currentAvailId = null;
let availDrawMode  = false;   // tekenmodus voor beschikbaarheid
let dragAvail      = null;    // actieve sleep-operatie
let replaceAvailId = null;    // avail-id om te vervangen bij opslaan event
let availPickerDate = new Date(); // huidige week in de inline picker
let pickerDrag      = null;    // sleep-operatie in de picker
let externalEvents   = [];      // read-only items uit externe agenda's
let currentExternalEventId = null;
let externalCalendarState = { loading: false, loaded: false, error: '', source: '', updatedAt: null };
const TIMEEDIT_URL = "https://cloud.timeedit.net/be_vub/web/public/ri626Q99Y29Z2XQ526868926y9Z293022X299X6Q229225426X9X2261623Z2X2672w12QQ22X6690X9u5n663Zu.ics";
const TIMEEDIT_COLOR = '#7C3AED';

// ── INIT ─────────────────────────────────────────────────────
async function init() {
  loadData();
  if (!appData.classes || appData.classes.length === 0) initDefaultClasses();
  if (!appData.events)       appData.events = [];
  if (!appData.availability) appData.availability = [];
  renderAll();
  await loadExternalCalendars();
  renderAll();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function initDefaultClasses() {
  const defaults = [
    { name: 'Wiskunde',     color: '#3B82F6' },
    { name: 'Fysica',       color: '#8B5CF6' },
    { name: 'Programmeren', color: '#10B981' },
    { name: 'Familie',      color: '#F97316' },
    { name: 'Persoonlijk',  color: '#EC4899' },
    { name: 'Werk',         color: '#64748B' },
  ];
  defaults.forEach(d => appData.classes.push({ id: genId('class'), name: d.name, color: d.color }));
  saveData();
}

// ── DATA ─────────────────────────────────────────────────────
function loadData() {
  try {
    const raw = localStorage.getItem('studieAgenda_v2');
    if (raw) appData = JSON.parse(raw);
  } catch(e) { console.error(e); }
}

function saveData() {
  try { localStorage.setItem('studieAgenda_v2', JSON.stringify(appData)); }
  catch(e) { console.error(e); }
}

// ── UTILS ────────────────────────────────────────────────────
function genId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
}

function toInputDate(d) {
  const dt = new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toInputTime(d) {
  const dt = new Date(d);
  return dt.toTimeString().slice(0,5);
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('nl-BE', { weekday:'short', month:'short', day:'numeric' });
}

function fmtTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('nl-BE', { hour:'2-digit', minute:'2-digit' });
}

function fmtLong(dateStr) {
  const d = new Date(dateStr);
  const str = d.toLocaleDateString('nl-BE', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function fmtDuration(start, end) {
  const ms   = new Date(end) - new Date(start);
  const mins = Math.round(ms / 60000);
  if (mins < 0) return '—';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} uur` : `${h}u${String(m).padStart(2,'0')}`;
}

function fmtHours(h) {
  if (h <= 0) return '0u';
  const hours = Math.floor(h);
  const mins  = Math.round((h - hours) * 60);
  if (hours === 0) return `${mins}min`;
  if (mins  === 0) return `${hours}u`;
  return `${hours}u ${mins}min`;
}

function classById(id) { return appData.classes.find(c => c.id === id) || null; }

function eventColor(ev) {
  if (ev && ev._external) return TIMEEDIT_COLOR;
  const cls = classById(ev.classId);
  if (cls) return cls.color;
  const map = { Taak:'#6366F1', Deadline:'#EF4444', Evenement:'#F59E0B',
                Studieblok:'#3B82F6', Les:'#8B5CF6', Familie:'#F97316', Sport:'#0EA5E9', Andere:'#6B7280' };
  return map[ev.type] || '#6366F1';
}

function getClassPalette(index) {
  const p = ['#EF4444','#F97316','#EAB308','#22C55E','#14B8A6','#3B82F6',
             '#6366F1','#8B5CF6','#EC4899','#06B6D4','#84CC16','#A855F7'];
  return p[index % p.length];
}

// Items (events + availability) overlapping a calendar date
function itemsForDay(dateStr) {
  const d    = new Date(dateStr);
  const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dEnd   = new Date(dStart.getTime() + 864e5);
  const out  = [];

  appData.events.forEach(e => {
    const s = new Date(e.start);
    const n = e.end ? new Date(e.end) : new Date(s.getTime() + 3600e3);
    if (s < dEnd && n > dStart) out.push({ ...e, _avail: false });
  });

  appData.availability.forEach(a => {
    const s = new Date(a.start), n = new Date(a.end);
    if (s < dEnd && n > dStart) out.push({ ...a, _avail: true, type: 'Beschikbaar' });
  });

  if (isTimeEditEnabled()) {
    externalEvents.forEach(e => {
      const s = new Date(e.start);
      const n = e.end ? new Date(e.end) : new Date(s.getTime() + 3600e3);
      if (s < dEnd && n > dStart) out.push({ ...e, _external: true, type: 'VUB-les' });
    });
  }

  return out.sort((a,b) => new Date(a.start) - new Date(b.start));
}

// ── NAVIGATION ───────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${name}"]`).classList.add('active');
  if (name === 'taken')           renderEventsList();
  if (name === 'beschikbaarheid') renderAvailabilityList();
  if (name === 'kalenders')         renderExternalCalendars();
  if (name === 'klasses')         renderClassesList();
  if (name === 'statistieken')    renderStats();
}

// ── EXTERNE KALENDERS / TIMEEDIT ───────────────────────────────
function isTimeEditEnabled() {
  return localStorage.getItem('timeedit_enabled') !== '0';
}

function toggleTimeEditCalendar(enabled) {
  localStorage.setItem('timeedit_enabled', enabled ? '1' : '0');
  renderExternalCalendars();
  renderAll();
}

function itemOpenAction(item) {
  if (item._avail) return 'openAvailDetail';
  if (item._external) return 'openExternalEventDetail';
  return 'openEventDetail';
}

function icsUnescape(value = '') {
  return String(value)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function icsDateToLocal(value) {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T00:00`;
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return `${toInputDate(d)}T${toInputTime(d)}`;
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

function parseICS(text) {
  const unfolded = String(text || '').replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split(/BEGIN:VEVENT\r?\n/i).slice(1);
  const events = [];

  blocks.forEach((block, idx) => {
    const body = block.split(/END:VEVENT/i)[0] || '';
    const lines = body.split(/\r?\n/);
    const props = {};
    lines.forEach(line => {
      const colon = line.indexOf(':');
      if (colon < 0) return;
      const left = line.slice(0, colon);
      const key = left.split(';')[0].toUpperCase();
      const value = line.slice(colon + 1);
      if (!props[key]) props[key] = [];
      props[key].push({ left, value });
    });

    const start = icsDateToLocal(props.DTSTART?.[0]?.value);
    if (!start) return;
    const end = icsDateToLocal(props.DTEND?.[0]?.value) || start;
    const uid = icsUnescape(props.UID?.[0]?.value || `timeedit-${idx}-${start}`);
    const title = icsUnescape(props.SUMMARY?.[0]?.value || 'VUB les');
    const location = icsUnescape(props.LOCATION?.[0]?.value || '');
    const description = icsUnescape(props.DESCRIPTION?.[0]?.value || '');

    events.push({
      id: 'timeedit_' + btoa(unescape(encodeURIComponent(uid))).replace(/[^a-zA-Z0-9]/g,'').slice(0,32) + '_' + idx,
      uid,
      title,
      location,
      description,
      start,
      end,
      type: 'VUB-les',
      status: 'Gepland',
      priority: 'Normaal',
      _external: true,
      source: 'VUB TimeEdit'
    });
  });

  return events.sort((a,b) => new Date(a.start) - new Date(b.start));
}

async function loadExternalCalendars(force = false) {
  externalCalendarState = { loading: true, loaded: false, error: '', source: '', updatedAt: null };
  renderExternalCalendars();

  const localUrl = './data/vub.ics' + (force ? ('?t=' + Date.now()) : '');
  const attempts = [
    { url: localUrl, source: 'GitHub-sync' },
    { url: TIMEEDIT_URL, source: 'TimeEdit live' }
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Geen geldige ICS-feed');
      externalEvents = parseICS(text);
      externalCalendarState = {
        loading: false,
        loaded: true,
        error: '',
        source: attempt.source,
        updatedAt: new Date()
      };
      renderExternalCalendars();
      return;
    } catch (err) {
      lastError = err?.message || String(err);
    }
  }

  externalEvents = [];
  externalCalendarState = {
    loading: false,
    loaded: false,
    error: lastError || 'Rooster kon niet worden geladen',
    source: '',
    updatedAt: null
  };
  renderExternalCalendars();
}

async function refreshExternalCalendars() {
  await loadExternalCalendars(true);
  renderAll();
}

function renderExternalCalendars() {
  const status = document.getElementById('timeedit-status');
  const toggle = document.getElementById('timeedit-enabled');
  if (toggle) toggle.checked = isTimeEditEnabled();
  if (!status) return;

  if (externalCalendarState.loading) {
    status.className = 'external-cal-status loading';
    status.textContent = 'Rooster laden…';
    return;
  }
  if (externalCalendarState.loaded) {
    const when = externalCalendarState.updatedAt
      ? externalCalendarState.updatedAt.toLocaleTimeString('nl-BE', {hour:'2-digit', minute:'2-digit'})
      : '';
    status.className = 'external-cal-status ok';
    status.textContent = `${externalEvents.length} items geladen · ${externalCalendarState.source}${when ? ' · ' + when : ''}`;
    return;
  }
  status.className = 'external-cal-status error';
  status.textContent = 'Nog geen TimeEdit-data. De GitHub-update vult dit automatisch aan.';
}

function openExternalEventDetail(id) {
  const ev = externalEvents.find(e => e.id === id);
  if (!ev) return;
  currentEventId = null;
  currentExternalEventId = id;

  document.getElementById('detail-event-title').innerHTML =
    `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${TIMEEDIT_COLOR};margin-right:8px;vertical-align:middle"></span>${ev.title}`;

  document.getElementById('event-detail-body').innerHTML = `
    <div class="detail-row"><span class="detail-label">Bron</span><span class="detail-value">🎓 VUB TimeEdit</span></div>
    <div class="detail-row"><span class="detail-label">Start</span><span class="detail-value">${fmtDate(ev.start)} &middot; ${fmtTime(ev.start)}</span></div>
    <div class="detail-row"><span class="detail-label">Einde</span><span class="detail-value">${fmtDate(ev.end)} &middot; ${fmtTime(ev.end)}</span></div>
    <div class="detail-row"><span class="detail-label">Duur</span><span class="detail-value">${fmtDuration(ev.start, ev.end)}</span></div>
    ${ev.location ? `<div class="detail-row"><span class="detail-label">Lokaal</span><span class="detail-value">${ev.location}</span></div>` : ''}
    ${ev.description ? `<div class="detail-desc">${ev.description}</div>` : ''}
    <div class="readonly-note">🔒 Dit item komt uit TimeEdit en is alleen-lezen.</div>
  `;

  document.getElementById('btn-mark-done').style.display = 'none';
  document.getElementById('btn-edit-event').style.display = 'none';
  document.getElementById('btn-delete-event').style.display = 'none';
  document.getElementById('event-detail-modal').style.display = 'flex';
}

// ── CALENDAR ─────────────────────────────────────────────────
function enterAvailDrawMode() {
  availDrawMode = true;
  showTab('kalender');
  if (currentView !== 'week') {
    currentView = 'week';
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    const wb = document.querySelector('.view-btn[data-view="week"]');
    if (wb) wb.classList.add('active');
  }
  renderCalendar();
}

function exitAvailDrawMode() {
  availDrawMode = false;
  renderCalendar();
}

// ── AVAIL DRAG ────────────────────────────────────────────────
function yToMins(y) {
  const rawH = y / HOUR_H + WEEK_START_H;
  return Math.round(rawH * 60 / 15) * 15;
}

function minsToTimeStr(mins) {
  const h = Math.min(Math.floor(mins / 60), 23);
  const m = mins % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function startAvailDrag(e, ds) {
  if (!availDrawMode) return;
  if (e.target.closest('.week-event')) return; // klik op bestaand event = niet slepen
  e.preventDefault();
  e.stopPropagation();

  const col      = e.currentTarget;
  if (e.pointerId !== undefined && col.setPointerCapture) {
    try { col.setPointerCapture(e.pointerId); } catch (_) {}
  }
  const weekBody = document.querySelector('.week-body');
  const bodyRect = weekBody ? weekBody.getBoundingClientRect() : { top: 0 };
  const scrollTop = weekBody ? weekBody.scrollTop : 0;
  const relY = (e.clientY - bodyRect.top) + scrollTop;

  const overlay = document.createElement('div');
  overlay.id = 'avail-drag-overlay';
  overlay.style.cssText = [
    'position:absolute', 'left:2px', 'right:2px', 'border-radius:6px',
    'background:rgba(5,150,105,0.22)', 'border:2px solid #059669',
    'z-index:10', 'pointer-events:none',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-size:10px', 'font-weight:700', 'color:#065F46', 'overflow:hidden'
  ].join(';');
  col.appendChild(overlay);

  dragAvail = { ds, col, startY: relY, currentY: relY, overlay };
  updateAvailDragOverlay();
}

function onAvailDragMove(e) {
  if (!dragAvail) return;
  const weekBody = document.querySelector('.week-body');
  const bodyRect = weekBody ? weekBody.getBoundingClientRect() : { top: 0 };
  dragAvail.currentY = (e.clientY - bodyRect.top) + (weekBody ? weekBody.scrollTop : 0);
  updateAvailDragOverlay();
}

function updateAvailDragOverlay() {
  if (!dragAvail || !dragAvail.overlay) return;
  const top    = Math.min(dragAvail.startY, dragAvail.currentY);
  const height = Math.max(12, Math.abs(dragAvail.currentY - dragAvail.startY));
  dragAvail.overlay.style.top    = top + 'px';
  dragAvail.overlay.style.height = height + 'px';
  if (height > 22) {
    const startM = yToMins(Math.min(dragAvail.startY, dragAvail.currentY));
    const endM   = yToMins(Math.max(dragAvail.startY, dragAvail.currentY));
    dragAvail.overlay.textContent = `${minsToTimeStr(startM)} – ${minsToTimeStr(Math.max(startM + 15, endM))}`;
  } else {
    dragAvail.overlay.textContent = '';
  }
}

function endAvailDrag(e) {
  if (!dragAvail) return;
  const weekBody = document.querySelector('.week-body');
  const bodyRect = weekBody ? weekBody.getBoundingClientRect() : { top: 0 };
  dragAvail.currentY = (e.clientY - bodyRect.top) + (weekBody ? weekBody.scrollTop : 0);

  if (dragAvail.overlay) dragAvail.overlay.remove();

  const startY = Math.min(dragAvail.startY, dragAvail.currentY);
  const endY   = Math.max(dragAvail.startY, dragAvail.currentY);
  const dsLocal = dragAvail.ds;
  dragAvail = null;

  if (endY - startY >= 12) {
    const startMins = yToMins(startY);
    const endMins   = Math.max(startMins + 15, yToMins(endY));
    const start = `${dsLocal}T${minsToTimeStr(startMins)}`;
    const end   = `${dsLocal}T${minsToTimeStr(Math.min(endMins, 23 * 60))}`;
    appData.availability.push({ id: genId('avail'), title: 'Beschikbaar leermoment', start, end, note: '' });
    saveData();
    renderAll();
  }
}
function setView(v) {
  currentView = v;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.view-btn[data-view="${v}"]`).classList.add('active');
  renderCalendar();
}

function prevPeriod() {
  if (currentView === 'month') currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1);
  else if (currentView === 'week') currentDate = new Date(currentDate.getTime() - 7*864e5);
  else currentDate = new Date(currentDate.getTime() - 864e5);
  renderCalendar();
}

function nextPeriod() {
  if (currentView === 'month') currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1);
  else if (currentView === 'week') currentDate = new Date(currentDate.getTime() + 7*864e5);
  else currentDate = new Date(currentDate.getTime() + 864e5);
  renderCalendar();
}

function goToToday() { currentDate = new Date(); renderCalendar(); }

function renderCalendar() {
  if (currentView === 'month') renderMonthView();
  else if (currentView === 'week') renderWeekView();
  else renderDayView();
}

// ── MONTH VIEW ───────────────────────────────────────────────
function renderMonthView() {
  const y = currentDate.getFullYear(), m = currentDate.getMonth();
  const MON = ['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];
  document.getElementById('calendar-title').textContent = `${MON[m]} ${y}`;

  const firstDay = new Date(y, m, 1);
  let startDow = firstDay.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // Mon=0

  const daysInMonth   = new Date(y, m+1, 0).getDate();
  const daysInPrevMon = new Date(y, m, 0).getDate();
  const todayStr = toInputDate(new Date());

  let html = `<div class="month-day-names">${['Ma','Di','Wo','Do','Vr','Za','Zo']
    .map(n=>`<div class="month-day-name">${n}</div>`).join('')}</div><div class="month-grid">`;

  // Prev month fill
  for (let i = startDow-1; i >= 0; i--)
    html += `<div class="month-cell other-month"><div class="cell-day-num">${daysInPrevMon-i}</div></div>`;

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isTod = ds === todayStr;
    const items = itemsForDay(ds);
    const show  = items.slice(0, 3);
    const more  = items.length - 3;

    html += `<div class="month-cell${isTod ? ' is-today':''}" onclick="handleDayClick('${ds}')">`;
    html += `<div class="cell-day-num${isTod?' today-circle':''}">${d}</div>`;

    show.forEach(item => {
      const col = item._avail ? '#059669' : eventColor(item);
      const t   = fmtTime(item.start);
      html += `<div class="cal-chip" style="background:${col}"
        onclick="event.stopPropagation();${itemOpenAction(item)}('${item.id}')"
        title="${item.title}">${t} ${item.title}</div>`;
    });
    if (more > 0) html += `<div class="cal-more">+${more} meer</div>`;
    html += `</div>`;
  }

  // Next month fill
  const total = Math.ceil((startDow + daysInMonth) / 7) * 7;
  for (let d = 1; d <= total - startDow - daysInMonth; d++)
    html += `<div class="month-cell other-month"><div class="cell-day-num">${d}</div></div>`;

  html += `</div>`;
  document.getElementById('calendar-container').innerHTML = html;
}

function handleDayClick(ds) {
  openEventModal();
  document.getElementById('event-start-date').value = ds;
  document.getElementById('event-end-date').value   = ds;
}

// ── WEEK VIEW ─────────────────────────────────────────────────
const WEEK_START_H = 6;  // show from 06:00
const WEEK_END_H   = 23; // show to 23:00
const HOUR_H       = 48; // px per hour

function getMonday(d) {
  const dt  = new Date(d);
  const dow = dt.getDay();
  const diff = (dow === 0) ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0,0,0,0);
  return dt;
}

function renderWeekView() {
  const monday = getMonday(currentDate);
  const days   = Array.from({length:7}, (_,i) => { const d=new Date(monday); d.setDate(d.getDate()+i); return d; });
  const todayStr = toInputDate(new Date());
  const dayNames = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
  const hours    = Array.from({length: WEEK_END_H - WEEK_START_H}, (_,i) => i + WEEK_START_H);

  const startStr = days[0].toLocaleDateString('nl-BE', {month:'long', day:'numeric'});
  const endStr   = days[6].toLocaleDateString('nl-BE', {month:'long', day:'numeric', year:'numeric'});
  document.getElementById('calendar-title').textContent = `${startStr} – ${endStr}`;

  let html = '';

  if (availDrawMode) {
    html += `<div class="avail-draw-banner">
      <span>🟢 Sleep op een dag om een beschikbaar moment te tekenen — klik op bestaande blokken om ze te bekijken</span>
      <button class="avail-draw-exit" onclick="exitAvailDrawMode()">✕ Tekenmodus afsluiten</button>
    </div>`;
  }

  html += '<div class="week-outer">';

  // Header row
  html += '<div class="week-header-row"><div class="week-time-stub"></div>';
  days.forEach((d,i) => {
    const isTod = toInputDate(d) === todayStr;
    html += `<div class="week-day-header-cell${isTod?' today':''}">
      <div class="wk-day-name">${dayNames[i]}</div>
      <div class="wk-day-num${isTod?' today-circle':''}">${d.getDate()}</div>
    </div>`;
  });
  html += '</div>';

  // Scrollable body
  html += '<div class="week-body"><div class="week-time-col">';
  hours.forEach(h => html += `<div class="week-time-label">${String(h).padStart(2,'0')}:00</div>`);
  html += '</div><div class="week-days-row">';

  days.forEach(d => {
    const ds    = toInputDate(d);
    const items = itemsForDay(ds);
    const totalH = (WEEK_END_H - WEEK_START_H) * HOUR_H;
    const drawAttr = availDrawMode ? `onpointerdown="startAvailDrag(event,'${ds}')"` : '';
    html += `<div class="week-day-col${availDrawMode ? ' avail-draw-mode' : ''}" style="min-height:${totalH}px" ${drawAttr}>`;
    hours.forEach(h => {
      const slotClick = availDrawMode ? '' : `onclick="handleWeekSlotClick('${ds}',${h})"`;
      html += `<div class="week-bg-hour" ${slotClick}></div>`;
    });
    items.forEach(item => {
      const s   = new Date(item.start);
      const e   = item.end ? new Date(item.end) : new Date(s.getTime() + 3600e3);
      const sh  = s.getHours() + s.getMinutes()/60;
      const eh  = e.getHours() + e.getMinutes()/60;
      if (eh <= WEEK_START_H || sh >= WEEK_END_H) return;
      const top = Math.max(0, (sh - WEEK_START_H)) * HOUR_H;
      const bot = Math.min(eh, WEEK_END_H);
      const hgt = Math.max(18, (bot - Math.max(sh, WEEK_START_H)) * HOUR_H);
      const col = item._avail ? '#059669' : eventColor(item);
      const opa = item.status === 'Afgewerkt' ? 0.5 : 1;
      html += `<div class="week-event" style="top:${top}px;height:${hgt}px;background:${col};opacity:${opa}"
        onclick="event.stopPropagation();${itemOpenAction(item)}('${item.id}')"
        title="${item.title}">
        <div class="we-time">${fmtTime(item.start)}</div>
        <div class="we-title">${item.title}</div>
      </div>`;
    });
    html += '</div>';
  });

  html += '</div></div></div>';
  document.getElementById('calendar-container').innerHTML = html;
  setTimeout(() => {
    const body = document.querySelector('.week-body');
    if (body) body.scrollTop = (new Date().getHours() - WEEK_START_H - 1) * HOUR_H;
    renderTimeLine('week');
  }, 30);
}

function renderTimeLine(mode) {
  const now   = new Date();
  const todayStr = toInputDate(now);
  const mins  = now.getHours() * 60 + now.getMinutes();
  const top   = ((mins / 60) - WEEK_START_H) * HOUR_H;
  if (top < 0 || top > (WEEK_END_H - WEEK_START_H) * HOUR_H) return;

  if (mode === 'week') {
    // Place line in the correct day column
    const cols = document.querySelectorAll('.week-day-col');
    const days = document.querySelectorAll('.week-day-header-cell');
    if (!cols.length) return;
    // Find today's column index by matching header date
    const monday = getMonday(currentDate);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      if (toInputDate(d) === todayStr && cols[i]) {
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.top = top + 'px';
        const dot = document.createElement('div');
        dot.className = 'now-dot';
        dot.style.top = (top - 4) + 'px';
        cols[i].appendChild(line);
        cols[i].appendChild(dot);
        break;
      }
    }
  } else if (mode === 'day') {
    const col = document.querySelector('.day-events-col');
    if (!col) return;
    const ds = toInputDate(currentDate);
    if (ds !== todayStr) return;
    const line = document.createElement('div');
    line.className = 'now-line';
    line.style.top = top + 'px';
    const dot = document.createElement('div');
    dot.className = 'now-dot';
    dot.style.top = (top - 4) + 'px';
    col.appendChild(line);
    col.appendChild(dot);
  }
}

// Auto-refresh time line every minute
setInterval(() => {
  if (currentView === 'week' || currentView === 'dag') {
    document.querySelectorAll('.now-line, .now-dot').forEach(el => el.remove());
    renderTimeLine(currentView === 'week' ? 'week' : 'day');
  }
}, 60000);

function handleWeekSlotClick(ds, hour) {
  openEventModal();
  document.getElementById('event-start-date').value = ds;
  document.getElementById('event-start-time').value = `${String(hour).padStart(2,'0')}:00`;
  document.getElementById('event-end-date').value   = ds;
  const endH = Math.min(hour+1, 23);
  document.getElementById('event-end-time').value   = `${String(endH).padStart(2,'0')}:00`;
}

// ── DAY VIEW ──────────────────────────────────────────────────
function renderDayView() {
  const ds      = toInputDate(currentDate);
  const isTod   = ds === toInputDate(new Date());
  const title   = fmtLong(currentDate);
  document.getElementById('calendar-title').textContent = title;

  const items   = itemsForDay(ds);
  const hours   = Array.from({length: WEEK_END_H - WEEK_START_H}, (_,i) => i + WEEK_START_H);
  const totalH  = hours.length * HOUR_H;

  let html = `<div class="day-outer"><div class="day-header-bar${isTod?'':' '}" style="${isTod?'':'background:#F9F8F5;color:var(--text-2);'}">`;
  html += isTod ? '⭐ Vandaag — ' + title : title;
  html += '</div><div class="day-body">';

  // Time column
  html += '<div class="day-time-col">';
  hours.forEach(h => html += `<div class="week-time-label">${String(h).padStart(2,'0')}:00</div>`);
  html += '</div>';

  // Events column
  html += `<div class="day-events-col" style="min-height:${totalH}px">`;
  hours.forEach(h => html += `<div class="day-bg-hour" onclick="handleWeekSlotClick('${ds}',${h})"></div>`);

  items.forEach(item => {
    const s  = new Date(item.start);
    const e  = item.end ? new Date(item.end) : new Date(s.getTime() + 3600e3);
    const sh = s.getHours() + s.getMinutes()/60;
    const eh = e.getHours() + e.getMinutes()/60;
    if (eh <= WEEK_START_H || sh >= WEEK_END_H) return;
    const top = Math.max(0, (sh - WEEK_START_H)) * HOUR_H;
    const hgt = Math.max(24, (Math.min(eh,WEEK_END_H) - Math.max(sh,WEEK_START_H)) * HOUR_H);
    const col = item._avail ? '#059669' : eventColor(item);
    const cls = classById(item.classId);
    html += `<div class="day-event" style="top:${top}px;height:${hgt}px;background:${col}"
      onclick="${itemOpenAction(item)}('${item.id}')">
      <div class="de-time">${fmtTime(item.start)} – ${fmtTime(e)}</div>
      <div class="de-title">${item.title}</div>
      ${cls ? `<div class="de-class">${cls.name}</div>` : ''}
    </div>`;
  });

  html += '</div></div></div>';
  document.getElementById('calendar-container').innerHTML = html;
  setTimeout(() => {
    const body = document.querySelector('.day-body');
    if (body) body.scrollTop = (new Date().getHours() - WEEK_START_H - 1) * HOUR_H;
    renderTimeLine('day');
  }, 30);
}

// ── EVENT MODAL ───────────────────────────────────────────────
function openEventModal(id = null) {
  populateClassSelect('event-class');
  const title = document.getElementById('event-modal-title');
  const today = toInputDate(new Date());

  if (id) {
    const ev = appData.events.find(e => e.id === id);
    if (!ev) return;
    title.textContent = 'Item aanpassen';
    document.getElementById('event-id').value           = ev.id;
    document.getElementById('event-title').value        = ev.title;
    document.getElementById('event-type').value         = ev.type;
    document.getElementById('event-class').value        = ev.classId || '';
    document.getElementById('event-start-date').value   = toInputDate(ev.start);
    document.getElementById('event-start-time').value   = toInputTime(ev.start);
    document.getElementById('event-end-date').value     = ev.end ? toInputDate(ev.end) : toInputDate(ev.start);
    document.getElementById('event-end-time').value     = ev.end ? toInputTime(ev.end) : '';
    document.getElementById('event-priority').value     = ev.priority;
    document.getElementById('event-status').value       = ev.status;
    document.getElementById('event-description').value  = ev.description || '';
  } else {
    title.textContent = 'Nieuw item';
    document.getElementById('event-id').value           = '';
    document.getElementById('event-title').value        = '';
    document.getElementById('event-type').value         = 'Taak';
    document.getElementById('event-class').value        = '';
    document.getElementById('event-start-date').value   = today;
    document.getElementById('event-start-time').value   = '';
    document.getElementById('event-end-date').value     = today;
    document.getElementById('event-end-time').value     = '';
    document.getElementById('event-priority').value     = 'Normaal';
    document.getElementById('event-status').value       = 'Nog te doen';
    document.getElementById('event-description').value  = '';
  }

  document.getElementById('avail-hint-panel').style.display = 'none';
  document.getElementById('event-modal').style.display = 'flex';
}

function closeEventModal() {
  document.getElementById('event-modal').style.display = 'none';
}

function saveEvent() {
  const title = document.getElementById('event-title').value.trim();
  if (!title) { alert('Geef een titel in.'); return; }
  const startDate = document.getElementById('event-start-date').value;
  if (!startDate) { alert('Geef een startdatum in.'); return; }

  const startTime = document.getElementById('event-start-time').value || '00:00';
  const endDate   = document.getElementById('event-end-date').value   || startDate;
  const endTime   = document.getElementById('event-end-time').value   || startTime;

  const start     = `${startDate}T${startTime}`;
  const end       = `${endDate}T${endTime}`;
  const existId   = document.getElementById('event-id').value;

  const ev = {
    id:          existId || genId('event'),
    title,
    description: document.getElementById('event-description').value.trim(),
    type:        document.getElementById('event-type').value,
    classId:     document.getElementById('event-class').value || null,
    start, end,
    priority:    document.getElementById('event-priority').value,
    status:      document.getElementById('event-status').value,
    createdAt:   existId
      ? (appData.events.find(e=>e.id===existId)?.createdAt || new Date().toISOString())
      : new Date().toISOString()
  };

  if (existId) {
    const idx = appData.events.findIndex(e => e.id === existId);
    if (idx !== -1) appData.events[idx] = ev; else appData.events.push(ev);
  } else {
    appData.events.push(ev);
  }

  saveData();
  closeEventModal();
  // Als dit een vervanging van een beschikbaar moment is, verwijder het
  if (replaceAvailId) {
    appData.availability = appData.availability.filter(a => a.id !== replaceAvailId);
    replaceAvailId = null;
    saveData();
  }
  renderAll();
}

// ── EVENT DETAIL ─────────────────────────────────────────────
function openEventDetail(id) {
  const ev = appData.events.find(e => e.id === id);
  if (!ev) return;
  currentEventId = id;

  const col  = eventColor(ev);
  const cls  = classById(ev.classId);
  const isDone = ev.status === 'Afgewerkt';

  document.getElementById('detail-event-title').innerHTML =
    `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${col};margin-right:8px;vertical-align:middle"></span>${ev.title}`;

  const prioCol = { Dringend:'#B91C1C', Hoog:'#B45309', Normaal:'#1D4ED8', Laag:'#6B7280' };
  const statCol = { Afgewerkt:'#065F46', Bezig:'#92400E', 'Nog te doen':'#374151', Geannuleerd:'#9CA3AF' };

  document.getElementById('event-detail-body').innerHTML = `
    <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${ev.type}</span></div>
    ${cls ? `<div class="detail-row"><span class="detail-label">Klasse</span>
      <span class="detail-value"><span class="class-dot" style="background:${cls.color}"></span> ${cls.name}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">Start</span><span class="detail-value">${fmtDate(ev.start)} &middot; ${fmtTime(ev.start)}</span></div>
    <div class="detail-row"><span class="detail-label">Einde</span><span class="detail-value">${fmtDate(ev.end)} &middot; ${fmtTime(ev.end)}</span></div>
    <div class="detail-row"><span class="detail-label">Duur</span><span class="detail-value">${fmtDuration(ev.start, ev.end)}</span></div>
    <div class="detail-row"><span class="detail-label">Prioriteit</span><span class="detail-value" style="color:${prioCol[ev.priority]||'#374151'}">${ev.priority}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value" style="color:${statCol[ev.status]||'#374151'}">${ev.status}</span></div>
    ${ev.description ? `<div class="detail-desc">${ev.description}</div>` : ''}
  `;

  document.getElementById('btn-mark-done').style.display = isDone ? 'none' : '';
  document.getElementById('btn-edit-event').style.display = '';
  document.getElementById('btn-delete-event').style.display = '';
  document.getElementById('event-detail-modal').style.display = 'flex';
}

function closeEventDetailModal() {
  document.getElementById('event-detail-modal').style.display = 'none';
  currentEventId = null;
  currentExternalEventId = null;
}

function editCurrentEvent() {
  const id = currentEventId;
  closeEventDetailModal();
  openEventModal(id);
}

function deleteCurrentEvent() {
  if (!currentEventId) return;
  if (!confirm('Weet je zeker dat je dit item wil verwijderen?')) return;
  appData.events = appData.events.filter(e => e.id !== currentEventId);
  saveData();
  closeEventDetailModal();
  renderAll();
}

function markEventDone() {
  if (!currentEventId) return;
  const idx = appData.events.findIndex(e => e.id === currentEventId);
  if (idx !== -1) {
    appData.events[idx].status = 'Afgewerkt';
    saveData();
    closeEventDetailModal();
    renderAll();
  }
}

// ── AVAILABILITY MODAL ────────────────────────────────────────
function openAvailabilityModal(id = null) {
  const titleEl = document.getElementById('avail-modal-title');
  const today   = toInputDate(new Date());

  if (id) {
    const av = appData.availability.find(a => a.id === id);
    if (!av) return;
    titleEl.textContent = 'Moment aanpassen';
    document.getElementById('avail-id').value         = av.id;
    document.getElementById('avail-start-date').value = toInputDate(av.start);
    document.getElementById('avail-start-time').value = toInputTime(av.start);
    document.getElementById('avail-end-date').value   = toInputDate(av.end);
    document.getElementById('avail-end-time').value   = toInputTime(av.end);
    document.getElementById('avail-note').value       = av.note || '';
  } else {
    titleEl.textContent = 'Beschikbaar leermoment';
    document.getElementById('avail-id').value         = '';
    document.getElementById('avail-start-date').value = today;
    document.getElementById('avail-start-time').value = '';
    document.getElementById('avail-end-date').value   = today;
    document.getElementById('avail-end-time').value   = '';
    document.getElementById('avail-note').value       = '';
  }
  document.getElementById('availability-modal').style.display = 'flex';
}

function closeAvailabilityModal() {
  document.getElementById('availability-modal').style.display = 'none';
}

function saveAvailability() {
  const sd = document.getElementById('avail-start-date').value;
  const st = document.getElementById('avail-start-time').value;
  const ed = document.getElementById('avail-end-date').value;
  const et = document.getElementById('avail-end-time').value;
  if (!sd || !st || !ed || !et) { alert('Vul alle datum- en tijdvelden in.'); return; }
  const start = `${sd}T${st}`, end = `${ed}T${et}`;
  if (new Date(end) <= new Date(start)) { alert('Eindtijd moet na de starttijd liggen.'); return; }

  const existId = document.getElementById('avail-id').value;
  const rec = { id: existId || genId('avail'), title: 'Beschikbaar leermoment', start, end,
    note: document.getElementById('avail-note').value.trim() };

  if (existId) {
    const idx = appData.availability.findIndex(a => a.id === existId);
    if (idx !== -1) appData.availability[idx] = rec; else appData.availability.push(rec);
  } else {
    appData.availability.push(rec);
  }
  saveData();
  closeAvailabilityModal();
  renderAll();
}

// ── AVAILABILITY DETAIL ───────────────────────────────────────
function openAvailDetail(id) {
  const av = appData.availability.find(a => a.id === id);
  if (!av) return;
  currentAvailId = id;
  document.getElementById('avail-detail-body').innerHTML = `
    <div class="detail-row"><span class="detail-label">Start</span><span class="detail-value">${fmtDate(av.start)} &middot; ${fmtTime(av.start)}</span></div>
    <div class="detail-row"><span class="detail-label">Einde</span><span class="detail-value">${fmtDate(av.end)} &middot; ${fmtTime(av.end)}</span></div>
    <div class="detail-row"><span class="detail-label">Duur</span><span class="detail-value">${fmtDuration(av.start, av.end)}</span></div>
    ${av.note ? `<div class="detail-desc">${av.note}</div>` : ''}
  `;
  document.getElementById('avail-detail-modal').style.display = 'flex';
}

function closeAvailDetailModal() {
  document.getElementById('avail-detail-modal').style.display = 'none';
  currentAvailId = null;
}

function editCurrentAvail() {
  const id = currentAvailId;
  closeAvailDetailModal();
  openAvailabilityModal(id);
}

function planAvailAsEvent() {
  const av = appData.availability.find(a => a.id === currentAvailId);
  if (!av) return;
  replaceAvailId = null;
  closeAvailDetailModal();
  openEventModal();
  document.getElementById('event-start-date').value = toInputDate(av.start);
  document.getElementById('event-start-time').value = toInputTime(av.start);
  document.getElementById('event-end-date').value   = toInputDate(av.end);
  document.getElementById('event-end-time').value   = toInputTime(av.end);
}

function planAndReplaceAvail() {
  const av = appData.availability.find(a => a.id === currentAvailId);
  if (!av) return;
  replaceAvailId = currentAvailId;
  closeAvailDetailModal();
  openEventModal();
  document.getElementById('event-start-date').value = toInputDate(av.start);
  document.getElementById('event-start-time').value = toInputTime(av.start);
  document.getElementById('event-end-date').value   = toInputDate(av.end);
  document.getElementById('event-end-time').value   = toInputTime(av.end);
}

function deleteCurrentAvail() {
  if (!currentAvailId) return;
  if (!confirm('Weet je zeker dat je dit moment wil verwijderen?')) return;
  appData.availability = appData.availability.filter(a => a.id !== currentAvailId);
  saveData();
  closeAvailDetailModal();
  renderAll();
}

// ── AVAILABILITY HINT (in event modal) ───────────────────────
function toggleAvailHint() {
  const panel = document.getElementById('avail-hint-panel');
  const open  = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  if (open) updateAvailHint();
}

function updateAvailHint() {
  const minMins = parseInt(document.getElementById('hint-min-dur').value) || 0;
  const now     = new Date();

  const slots = appData.availability
    .filter(a => {
      const s = new Date(a.start);
      const e = new Date(a.end);
      return s >= now && (e - s) / 60000 >= minMins;
    })
    .sort((a,b) => new Date(a.start) - new Date(b.start));

  if (slots.length === 0) {
    document.getElementById('avail-hint-list').innerHTML =
      '<div style="font-size:12px;color:var(--text-3);font-style:italic;padding:6px 0">Geen momenten gevonden.</div>';
    return;
  }

  document.getElementById('avail-hint-list').innerHTML = slots.map(sl => {
    const s = new Date(sl.start);
    const e = new Date(sl.end);
    const dateStr = s.toLocaleDateString('nl-BE', { weekday:'long', month:'long', day:'numeric' });
    const cap = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    return `<div class="hint-slot">
      <div class="hint-slot-info">
        <div class="date-str">${cap}</div>
        <div class="time-str">${fmtTime(sl.start)} – ${fmtTime(sl.end)}</div>
      </div>
      <div class="hint-slot-dur">${fmtDuration(sl.start, sl.end)}</div>
    </div>`;
  }).join('');
}

// ── EVENTS LIST ───────────────────────────────────────────────
function renderEventsList() {
  // Update class filter options
  const sel = document.getElementById('filter-klasse');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Alle klasses</option>' +
      appData.classes.map(c => `<option value="${c.id}"${c.id===cur?' selected':''}>${c.name}</option>`).join('');
  }

  const q     = (document.getElementById('search-input')?.value || '').toLowerCase();
  const fKls  = document.getElementById('filter-klasse')?.value || '';
  const fTyp  = document.getElementById('filter-type')?.value  || '';
  const fStat = document.getElementById('filter-status')?.value || '';
  const fPrio = document.getElementById('filter-prioriteit')?.value || '';

  let evs = [...appData.events];
  if (q)     evs = evs.filter(e => {
    const c = classById(e.classId);
    return e.title.toLowerCase().includes(q) ||
           (e.description||'').toLowerCase().includes(q) ||
           e.type.toLowerCase().includes(q) ||
           (c?.name||'').toLowerCase().includes(q);
  });
  if (fKls)  evs = evs.filter(e => e.classId === fKls);
  if (fTyp)  evs = evs.filter(e => e.type === fTyp);
  if (fStat) evs = evs.filter(e => e.status === fStat);
  if (fPrio) evs = evs.filter(e => e.priority === fPrio);
  evs.sort((a,b) => new Date(a.start) - new Date(b.start));

  const cont = document.getElementById('events-list');
  if (!cont) return;

  if (evs.length === 0) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div class="empty-state-title">Geen items gevonden</div>
      <div class="empty-state-sub">Voeg een nieuw item toe of pas de filters aan</div>
    </div>`; return;
  }

  cont.innerHTML = `<div class="events-grid">${evs.map(ev => {
    const col  = eventColor(ev);
    const cls  = classById(ev.classId);
    const done = ev.status === 'Afgewerkt';
    const stat = ev.status.replace(/ /g,'');
    return `<div class="event-card${done?' done':''}" style="border-left-color:${col}" onclick="openEventDetail('${ev.id}')">
      <div class="ec-title${done?' striked':''}">${ev.title}</div>
      <div class="ec-badges">
        <span class="badge badge-type">${ev.type}</span>
        <span class="badge badge-${ev.priority}">${ev.priority}</span>
        <span class="badge badge-${stat}">${ev.status}</span>
      </div>
      ${cls ? `<div class="ec-class"><span class="class-dot" style="background:${cls.color}"></span>${cls.name}</div>` : ''}
      <div class="ec-meta">📅 ${fmtDate(ev.start)} &middot; ${fmtTime(ev.start)}${ev.end?' – '+fmtTime(ev.end):''}</div>
    </div>`;
  }).join('')}</div>`;
}

// ── AVAILABILITY LIST ─────────────────────────────────────────
function renderAvailabilityList() {
  const cont = document.getElementById('availability-list');
  if (!cont) return;
  const items = [...appData.availability].sort((a,b) => new Date(a.start) - new Date(b.start));
  if (items.length === 0) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🟢</div>
      <div class="empty-state-title">Geen beschikbare momenten</div>
      <div class="empty-state-sub">Voeg je vrije studiemomenten toe</div>
    </div>`; return;
  }
  const now = new Date();
  cont.innerHTML = `<div class="avail-grid">${items.map(a => {
    const s    = new Date(a.start);
    const e    = new Date(a.end);
    const past = e < now;
    return `<div class="avail-card${past?' past':''}" onclick="openAvailDetail('${a.id}')">
      <div class="ac-label">📗 Beschikbaar leermoment</div>
      <div class="ac-date">${s.toLocaleDateString('nl-BE',{weekday:'long', month:'long', day:'numeric'})}</div>
      <div class="ac-time">${fmtTime(a.start)} – ${fmtTime(a.end)}</div>
      <div class="ac-dur">⏱ ${fmtDuration(a.start, a.end)}</div>
      ${a.note ? `<div class="ac-note">${a.note}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ── AVAIL WEEK PICKER ─────────────────────────────────────────
function openAvailWeekPicker() {
  availPickerDate = new Date();
  document.getElementById('avail-list-view').style.display = 'none';
  document.getElementById('tab-beschikbaarheid').classList.add('picker-active');
  document.getElementById('avail-week-picker').classList.add('active');
  renderAvailWeekPicker();
}

function closeAvailWeekPicker() {
  document.getElementById('tab-beschikbaarheid').classList.remove('picker-active');
  document.getElementById('avail-week-picker').classList.remove('active');
  document.getElementById('avail-list-view').style.display = '';
  renderAvailabilityList();
}

function availPickerPrev()  { availPickerDate = new Date(availPickerDate.getTime() - 7*864e5); renderAvailWeekPicker(); }
function availPickerNext()  { availPickerDate = new Date(availPickerDate.getTime() + 7*864e5); renderAvailWeekPicker(); }
function availPickerToday() { availPickerDate = new Date(); renderAvailWeekPicker(); }

function renderAvailWeekPicker() {
  const monday   = getMonday(availPickerDate);
  const days     = Array.from({length:7}, (_,i) => { const d=new Date(monday); d.setDate(d.getDate()+i); return d; });
  const todayStr = toInputDate(new Date());
  const dayNames = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
  const hours    = Array.from({length: WEEK_END_H - WEEK_START_H}, (_,i) => i + WEEK_START_H);
  const startStr = days[0].toLocaleDateString('nl-BE', {month:'long', day:'numeric'});
  const endStr   = days[6].toLocaleDateString('nl-BE', {month:'long', day:'numeric', year:'numeric'});

  let html = `
    <div class="avail-picker-toolbar">
      <div class="cal-nav">
        <button class="btn-nav" onclick="availPickerPrev()">&#8249; Vorige</button>
        <button class="btn-today" onclick="availPickerToday()">Vandaag</button>
        <button class="btn-nav" onclick="availPickerNext()">Volgende &#8250;</button>
      </div>
      <span class="avail-picker-period">${startStr} – ${endStr}</span>
      <button class="avail-picker-close" onclick="closeAvailWeekPicker()">✓ Klaar</button>
    </div>
    <div class="avail-picker-hint">
      💡 <strong>Klik</strong> op een leeg tijdvak = 1 uur toevoegen &nbsp;·&nbsp;
         <strong>Klik</strong> op groen blok = verwijderen &nbsp;·&nbsp;
         <strong>Sleep</strong> = meerdere uren tekenen
    </div>
    <div class="week-outer">`;

  // Header
  html += '<div class="week-header-row"><div class="week-time-stub"></div>';
  days.forEach((d,i) => {
    const isTod = toInputDate(d) === todayStr;
    html += `<div class="week-day-header-cell${isTod?' today':''}">
      <div class="wk-day-name">${dayNames[i]}</div>
      <div class="wk-day-num${isTod?' today-circle':''}"">${d.getDate()}</div>
    </div>`;
  });
  html += '</div>';

  // Body
  html += '<div class="week-body" id="avail-picker-body"><div class="week-time-col">';
  hours.forEach(h => html += `<div class="week-time-label">${String(h).padStart(2,'0')}:00</div>`);
  html += '</div><div class="week-days-row">';
  days.forEach(d => {
    const ds    = toInputDate(d);
    const items = itemsForDay(ds);
    const totalH = (WEEK_END_H - WEEK_START_H) * HOUR_H;

    html += `<div class="week-day-col avail-picker-col" style="min-height:${totalH}px" onpointerdown="startPickerDrag(event,'${ds}')">`;
    hours.forEach(() => html += `<div class="week-bg-hour"></div>`);

    items.forEach(item => {
      const s  = new Date(item.start);
      const e  = item.end ? new Date(item.end) : new Date(s.getTime() + 3600e3);
      const sh = s.getHours() + s.getMinutes()/60;
      const eh = e.getHours() + e.getMinutes()/60;
      if (eh <= WEEK_START_H || sh >= WEEK_END_H) return;
      const top = Math.max(0, (sh - WEEK_START_H)) * HOUR_H;
      const hgt = Math.max(18, (Math.min(eh, WEEK_END_H) - Math.max(sh, WEEK_START_H)) * HOUR_H);

      if (item._avail) {
        html += `<div class="week-event picker-avail-block"
          style="top:${top}px;height:${hgt}px;background:#059669"
          onclick="event.stopPropagation();togglePickerAvail('${item.id}')"
          title="Klik om te verwijderen">
          <div class="we-time">${fmtTime(item.start)} – ${fmtTime(e)}</div>
          <div class="we-title">✕ verwijderen</div>
        </div>`;
      } else {
        html += `<div class="week-event" style="top:${top}px;height:${hgt}px;background:${eventColor(item)};opacity:0.22;pointer-events:none">
          <div class="we-title">${item.title}</div>
        </div>`;
      }
    });

    html += '</div>';
  });

  html += '</div></div></div>'; // week-days-row / week-body / week-outer

  document.getElementById('avail-week-picker').innerHTML = html;

  setTimeout(() => {
    const body = document.getElementById('avail-picker-body');
    if (body) body.scrollTop = (8 - WEEK_START_H) * HOUR_H;
  }, 30);
}

function togglePickerAvail(id) {
  appData.availability = appData.availability.filter(a => a.id !== id);
  saveData();
  renderAvailWeekPicker();
}

// ── PICKER DRAG ───────────────────────────────────────────────
function startPickerDrag(e, ds) {
  if (e.target.closest('.week-event')) return; // klik op bestaand blok = toggle
  e.preventDefault();

  const col      = e.currentTarget;
  if (e.pointerId !== undefined && col.setPointerCapture) {
    try { col.setPointerCapture(e.pointerId); } catch (_) {}
  }
  const body     = document.getElementById('avail-picker-body');
  const bodyRect = body ? body.getBoundingClientRect() : { top: 0 };
  const relY     = (e.clientY - bodyRect.top) + (body ? body.scrollTop : 0);

  const overlay  = document.createElement('div');
  overlay.style.cssText = [
    'position:absolute','left:2px','right:2px','border-radius:6px',
    'background:rgba(5,150,105,0.28)','border:2px solid #059669',
    'z-index:10','pointer-events:none',
    'display:flex','align-items:center','justify-content:center',
    'font-size:10px','font-weight:700','color:#065F46','overflow:hidden'
  ].join(';');
  col.appendChild(overlay);

  pickerDrag = { ds, col, startY: relY, currentY: relY, overlay };
  updatePickerDragOverlay();
}

function onPickerDragMove(e) {
  if (!pickerDrag) return;
  const body     = document.getElementById('avail-picker-body');
  const bodyRect = body ? body.getBoundingClientRect() : { top: 0 };
  pickerDrag.currentY = (e.clientY - bodyRect.top) + (body ? body.scrollTop : 0);
  updatePickerDragOverlay();
}

function updatePickerDragOverlay() {
  if (!pickerDrag || !pickerDrag.overlay) return;
  const top    = Math.min(pickerDrag.startY, pickerDrag.currentY);
  const height = Math.max(12, Math.abs(pickerDrag.currentY - pickerDrag.startY));
  pickerDrag.overlay.style.top    = top + 'px';
  pickerDrag.overlay.style.height = height + 'px';
  if (height > 22) {
    const s = yToMins(Math.min(pickerDrag.startY, pickerDrag.currentY));
    const e = Math.max(s + 15, yToMins(Math.max(pickerDrag.startY, pickerDrag.currentY)));
    pickerDrag.overlay.textContent = `${minsToTimeStr(s)} – ${minsToTimeStr(e)}`;
  } else {
    pickerDrag.overlay.textContent = '';
  }
}

function endPickerDrag(e) {
  if (!pickerDrag) return;
  const body     = document.getElementById('avail-picker-body');
  const bodyRect = body ? body.getBoundingClientRect() : { top: 0 };
  pickerDrag.currentY = (e.clientY - bodyRect.top) + (body ? body.scrollTop : 0);

  if (pickerDrag.overlay) pickerDrag.overlay.remove();

  const startY  = Math.min(pickerDrag.startY, pickerDrag.currentY);
  const endY    = Math.max(pickerDrag.startY, pickerDrag.currentY);
  const dsLocal = pickerDrag.ds;
  pickerDrag    = null;

  let startMins, endMins;
  if (endY - startY < 8) {
    // Klik: snap naar het exacte uur-slot
    const slotIndex = Math.floor(startY / HOUR_H);
    startMins = (slotIndex + WEEK_START_H) * 60;
    endMins   = startMins + 60;
  } else {
    // Sleep: snap naar kwartieren
    startMins = yToMins(startY);
    endMins   = Math.max(startMins + 15, yToMins(endY));
  }

  const start = `${dsLocal}T${minsToTimeStr(startMins)}`;
  const end   = `${dsLocal}T${minsToTimeStr(Math.min(endMins, 23 * 60))}`;

  appData.availability.push({ id: genId('avail'), title: 'Beschikbaar leermoment', start, end, note: '' });
  saveData();
  renderAvailWeekPicker();
}

// ── CLASSES ───────────────────────────────────────────────────
function populateClassSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— Geen klasse —</option>' +
    appData.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function openClassModal(id = null) {
  const titleEl = document.getElementById('class-modal-title');
  if (id) {
    const cls = appData.classes.find(c => c.id === id);
    if (!cls) return;
    titleEl.textContent = 'Klasse aanpassen';
    document.getElementById('class-id').value    = cls.id;
    document.getElementById('class-name').value  = cls.name;
    document.getElementById('class-color').value = cls.color;
  } else {
    titleEl.textContent = 'Nieuwe klasse';
    document.getElementById('class-id').value    = '';
    document.getElementById('class-name').value  = '';
    document.getElementById('class-color').value = getClassPalette(appData.classes.length);
  }
  document.getElementById('class-modal').style.display = 'flex';
}

function closeClassModal() {
  document.getElementById('class-modal').style.display = 'none';
}

function saveClass() {
  const name = document.getElementById('class-name').value.trim();
  if (!name) { alert('Geef een naam in voor de klasse.'); return; }
  const color   = document.getElementById('class-color').value;
  const existId = document.getElementById('class-id').value;
  if (existId) {
    const idx = appData.classes.findIndex(c => c.id === existId);
    if (idx !== -1) { appData.classes[idx].name = name; appData.classes[idx].color = color; }
  } else {
    appData.classes.push({ id: genId('class'), name, color });
  }
  saveData();
  closeClassModal();
  renderClassesList();
  renderCalendar();
}

function deleteClass(id) {
  if (!confirm('Klasse verwijderen? Items behouden hun data maar verliezen de klasse-koppeling.')) return;
  appData.classes = appData.classes.filter(c => c.id !== id);
  appData.events.forEach(e => { if (e.classId === id) e.classId = null; });
  saveData();
  renderClassesList();
  renderCalendar();
}

function renderClassesList() {
  const cont = document.getElementById('classes-list');
  if (!cont) return;
  if (appData.classes.length === 0) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🎨</div>
      <div class="empty-state-title">Geen klasses</div>
      <div class="empty-state-sub">Maak je eerste klasse aan</div>
    </div>`; return;
  }
  cont.innerHTML = `<div class="classes-grid">${appData.classes.map(cls => `
    <div class="class-card">
      <div class="class-color-swatch" style="background:${cls.color}"></div>
      <div class="class-name">${cls.name}</div>
      <div class="class-actions">
        <button class="btn-icon" onclick="openClassModal('${cls.id}')" title="Aanpassen">✎</button>
        <button class="btn-icon del" onclick="deleteClass('${cls.id}')" title="Verwijderen">🗑</button>
      </div>
    </div>`).join('')}</div>`;
}

// ── SIDEBAR WIDGETS ───────────────────────────────────────────
function renderTodayOverview() {
  const cont = document.getElementById('today-overview');
  if (!cont) return;
  const items = itemsForDay(toInputDate(new Date()));
  if (items.length === 0) {
    cont.innerHTML = '<div class="widget-empty">Niets gepland vandaag</div>'; return;
  }
  cont.innerHTML = items.slice(0,5).map(item => {
    const col = item._avail ? '#059669' : eventColor(item);
    return `<div class="widget-item" onclick="${itemOpenAction(item)}('${item.id}')">
      <div class="widget-item-title">
        <span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${col};flex-shrink:0"></span>
        ${item.title}
      </div>
      <div class="widget-item-meta">${fmtTime(item.start)}</div>
    </div>`;
  }).join('') + (items.length > 5 ? `<div class="widget-empty" style="margin-top:4px">+${items.length-5} meer</div>` : '');
}

function renderTomorrowOverview() {
  const cont = document.getElementById('tomorrow-overview');
  if (!cont) return;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const items = itemsForDay(toInputDate(tomorrow));
  if (items.length === 0) {
    cont.innerHTML = '<div class="widget-empty">Niets gepland morgen</div>'; return;
  }
  cont.innerHTML = items.slice(0,5).map(item => {
    const col = item._avail ? '#059669' : eventColor(item);
    return `<div class="widget-item" onclick="${itemOpenAction(item)}('${item.id}')">
      <div class="widget-item-title">
        <span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${col};flex-shrink:0"></span>
        ${item.title}
      </div>
      <div class="widget-item-meta">${fmtTime(item.start)}</div>
    </div>`;
  }).join('') + (items.length > 5 ? `<div class="widget-empty" style="margin-top:4px">+${items.length-5} meer</div>` : '');
}

function renderUpcomingDeadlines() {
  const cont = document.getElementById('upcoming-deadlines');
  if (!cont) return;
  const now = new Date();
  const dl  = appData.events
    .filter(e => e.type === 'Deadline' && !['Afgewerkt','Geannuleerd'].includes(e.status) && new Date(e.start) >= now)
    .sort((a,b) => new Date(a.start) - new Date(b.start))
    .slice(0,5);
  if (dl.length === 0) {
    cont.innerHTML = '<div class="widget-empty">Geen komende deadlines</div>'; return;
  }
  cont.innerHTML = dl.map(d => {
    const dt   = new Date(d.start);
    const days = Math.ceil((dt - now) / 864e5);
    const col  = days <= 1 ? '#EF4444' : days <= 3 ? '#F97316' : days <= 7 ? '#EAB308' : 'rgba(255,255,255,0.38)';
    const when = days === 0 ? 'Vandaag!' : days === 1 ? 'Morgen' : `${days} dagen`;
    return `<div class="widget-item" onclick="openEventDetail('${d.id}')">
      <div class="widget-item-title">${d.title}</div>
      <div class="widget-item-meta" style="color:${col}">${fmtDate(d.start)} &middot; ${when}</div>
    </div>`;
  }).join('');
}

function renderStudyHours() {
  const cont = document.getElementById('study-hours');
  if (!cont) return;
  cont.innerHTML = _buildStudyHoursWidget(0, 'study-hours');
}

function renderStudyHoursNext() {
  const cont = document.getElementById('study-hours-next');
  if (!cont) return;
  cont.innerHTML = _buildStudyHoursWidget(1, 'study-hours-next');
}

function _buildStudyHoursWidget(weekOffset, _id) {
  const now  = new Date();
  const dow  = now.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const wkS  = new Date(now); wkS.setDate(now.getDate() + diff + weekOffset * 7); wkS.setHours(0,0,0,0);
  const wkE  = new Date(wkS.getTime() + 7*864e5);

  const map  = {};
  appData.events.forEach(e => {
    if (!e.classId || !e.end) return;
    if (!['Studieblok','Les','Taak'].includes(e.type)) return;
    const s = new Date(e.start);
    if (s < wkS || s >= wkE) return;
    const h = (new Date(e.end) - s) / 3600e3;
    map[e.classId] = (map[e.classId] || 0) + h;
  });

  const entries = Object.entries(map).sort((a,b) => b[1]-a[1]);
  if (entries.length === 0) return `<div class="widget-empty">Geen studieuren gepland</div>`;
  const maxH = Math.max(...entries.map(e=>e[1]));
  return entries.map(([cid, h]) => {
    const cls = classById(cid);
    if (!cls) return '';
    const pct = (h/maxH)*100;
    const lbl = h%1===0 ? `${h}u` : `${h.toFixed(1)}u`;
    return `<div class="study-bar">
      <div class="study-bar-labels"><span>${cls.name}</span><span>${lbl}</span></div>
      <div class="study-bar-track"><div class="study-bar-fill" style="width:${pct}%;background:${cls.color}"></div></div>
    </div>`;
  }).join('');
}

// ── SEARCH & FILTER ───────────────────────────────────────────
function searchAndFilter() {
  const active = document.querySelector('.tab-content.active');
  if (!active) return;
  if (active.id === 'tab-taken') renderEventsList();
}

// ── STATISTIEKEN ──────────────────────────────────────────────
function renderStats() {
  const cont = document.getElementById('stats-content');
  if (!cont) return;

  const now = new Date();

  // ── 1. Alle afgewerkte items met tijdsduur ──────────────────
  const TIMED_TYPES = ['Studieblok','Les','Taak','Evenement','Andere'];
  const completed = appData.events.filter(e =>
    e.status === 'Afgewerkt' && e.end
  );

  // Trofeekast per type
  const typeLabels = {
    Studieblok: '📘 Studieblokken',
    Les:        '🏫 Lessen',
    Taak:       '✅ Taken',
    Deadline:   '⏰ Deadlines',
    Evenement:  '🎉 Evenementen',
    Familie:    '👨‍👩‍👦 Familie',
    Sport:      '🏃 Sport',
    Andere:     '📎 Andere',
  };

  // Uren per klasse (alleen items met een tijdsduur)
  const byClass   = {};
  let grandTotal  = 0;
  const byType    = {};
  let totalCount  = 0;

  completed.forEach(ev => {
    totalCount++;
    // Count per type
    byType[ev.type] = (byType[ev.type] || 0) + 1;
    // Hours per class (only if has real duration)
    const h = Math.max(0, (new Date(ev.end) - new Date(ev.start)) / 3600e3);
    if (h > 0 && TIMED_TYPES.includes(ev.type)) {
      const key = ev.classId || '__none__';
      byClass[key] = (byClass[key] || 0) + h;
      grandTotal   += h;
    }
  });

  const classEntries = Object.entries(byClass).sort((a,b) => b[1]-a[1]);
  const maxH = classEntries.length ? Math.max(...classEntries.map(e=>e[1])) : 1;

  // ── 2. Morgen ───────────────────────────────────────────────
  const tomorrow    = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toInputDate(tomorrow);

  const tomorrowBlocks = appData.events
    .filter(e => !['Afgewerkt','Geannuleerd'].includes(e.status)
               && toInputDate(new Date(e.start)) === tomorrowStr)
    .sort((a,b) => new Date(a.start) - new Date(b.start));

  const tomorrowH = tomorrowBlocks.reduce((s,e) =>
    s + (e.end ? Math.max(0,(new Date(e.end)-new Date(e.start))/3600e3) : 0), 0);

  // ── 3. Komende 7 dagen ──────────────────────────────────────
  const weekEnd = new Date(now.getTime() + 7*864e5);

  const weekBlocks = appData.events
    .filter(e => {
      const s = new Date(e.start);
      return !['Afgewerkt','Geannuleerd'].includes(e.status)
          && s >= now && s < weekEnd;
    })
    .sort((a,b) => new Date(a.start) - new Date(b.start));

  const weekH = weekBlocks.reduce((s,e) =>
    s + (e.end ? Math.max(0,(new Date(e.end)-new Date(e.start))/3600e3) : 0), 0);

  // ── Motivatie ───────────────────────────────────────────────
  let motivation, motivationClass;
  if      (totalCount === 0) { motivation = '📚 Nog niets afgewerkt — begin vandaag!';             motivationClass = ''; }
  else if (totalCount < 5)   { motivation = '🌱 Goed bezig! Je bent mooi aan het starten.';        motivationClass = 'green'; }
  else if (totalCount < 20)  { motivation = '📈 Je bouwt een sterke studie-routine op!';            motivationClass = 'green'; }
  else if (totalCount < 50)  { motivation = '🔥 Geweldig bezig — je bent een studie-machine!';     motivationClass = 'orange'; }
  else                       { motivation = '🏆 Ongelooflijk! Je bent een echte studeerkampioen!'; motivationClass = 'gold'; }

  // ── HTML ────────────────────────────────────────────────────
  let html = `<div class="stats-motivation stats-motivation-${motivationClass}">${motivation}</div>`;

  // Samenvatting-kaarten
  html += `<div class="stats-summary-row">
    <div class="stat-card stat-card-primary">
      <div class="stat-card-icon">⏱</div>
      <div class="stat-card-num">${fmtHours(grandTotal)}</div>
      <div class="stat-card-label">Totaal gestudeerd</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon">✅</div>
      <div class="stat-card-num">${totalCount}</div>
      <div class="stat-card-label">Voltooide items</div>
    </div>
    <div class="stat-card stat-card-green">
      <div class="stat-card-icon">📅</div>
      <div class="stat-card-num">${fmtHours(weekH)}</div>
      <div class="stat-card-label">Gepland komende week</div>
    </div>
    <div class="stat-card stat-card-blue">
      <div class="stat-card-icon">🌅</div>
      <div class="stat-card-num">${fmtHours(tomorrowH)}</div>
      <div class="stat-card-label">Gepland morgen</div>
    </div>
  </div>`;

  // ── Trofeekast ───────────────────────────────────────────────
  html += `<div class="stats-section">
    <div class="stats-section-title">🏆 Trofeekast — voltooide items per type</div>`;

  if (totalCount === 0) {
    html += `<div class="stats-empty">
      <div class="stats-empty-icon">📭</div>
      <p>Nog niets afgewerkt. Zet een item op <strong>Afgewerkt</strong> om het hier te zien.</p>
    </div>`;
  } else {
    html += '<div class="stats-trophy-row">';
    Object.entries(typeLabels).forEach(([type, label]) => {
      const count = byType[type] || 0;
      if (count === 0) return;
      const col = { Studieblok:'#3B82F6', Les:'#8B5CF6', Taak:'#6366F1',
                    Deadline:'#EF4444', Evenement:'#F59E0B', Familie:'#F97316', Sport:'#0EA5E9', Andere:'#6B7280' }[type] || '#9CA3AF';
      html += `<div class="stats-trophy-card" style="border-top-color:${col}">
        <div class="stats-trophy-label">${label}</div>
        <div class="stats-trophy-count" style="color:${col}">${count}</div>
        <div class="stats-trophy-sub">${count === 1 ? 'item' : 'items'}</div>
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  // ── Per-vak ──────────────────────────────────────────────────
  html += `<div class="stats-section">
    <div class="stats-section-title">📚 Voltooide uren per vak</div>`;

  if (classEntries.length === 0) {
    html += `<div class="stats-empty">
      <div class="stats-empty-icon">📊</div>
      <p>Nog geen afgewerkte items met tijdsduur per vak.</p>
    </div>`;
  } else {
    html += '<div class="stats-bars-list">';
    classEntries.forEach(([key, h]) => {
      const cls      = key === '__none__' ? null : classById(key);
      const name     = cls ? cls.name : 'Zonder klasse';
      const color    = cls ? cls.color : '#9CA3AF';
      const pct      = (h / maxH) * 100;
      const sharePct = grandTotal > 0 ? Math.round((h / grandTotal) * 100) : 0;
      html += `<div class="stats-bar-row">
        <div class="stats-bar-meta">
          <span class="stats-bar-dot" style="background:${color}"></span>
          <span class="stats-bar-name">${name}</span>
          <span class="stats-bar-share">${sharePct}%</span>
        </div>
        <div class="stats-bar-track">
          <div class="stats-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="stats-bar-hours">${fmtHours(h)}</div>
      </div>`;
    });
    html += `<div class="stats-grand-total">
      <span>Totaal</span>
      <span>${fmtHours(grandTotal)}</span>
    </div></div>`;
  }
  html += '</div>';

  // ── Komende planning ─────────────────────────────────────────
  html += '<div class="stats-two-col">';

  // Morgen
  html += `<div class="stats-section">
    <div class="stats-section-title">🌅 Morgen</div>`;
  if (tomorrowBlocks.length === 0) {
    html += `<div class="stats-upcoming-empty">Niets gepland voor morgen</div>`;
  } else {
    html += `<div class="stats-upcoming-total">Totaal: <strong>${fmtHours(tomorrowH)}</strong></div>`;
    tomorrowBlocks.forEach(ev => { html += _upcomingBlockHtml(ev); });
  }
  html += '</div>';

  // Komende 7 dagen
  html += `<div class="stats-section">
    <div class="stats-section-title">📅 Komende 7 dagen</div>`;
  if (weekBlocks.length === 0) {
    html += `<div class="stats-upcoming-empty">Niets gepland voor de komende week</div>`;
  } else {
    html += `<div class="stats-upcoming-total">Totaal: <strong>${fmtHours(weekH)}</strong></div>`;
    const byDay = {};
    weekBlocks.forEach(ev => {
      const ds = toInputDate(new Date(ev.start));
      if (!byDay[ds]) byDay[ds] = [];
      byDay[ds].push(ev);
    });
    Object.entries(byDay).forEach(([ds, evs]) => {
      const dayObj  = new Date(ds + 'T12:00');
      const dayLbl  = dayObj.toLocaleDateString('nl-BE', { weekday:'long', month:'long', day:'numeric' });
      const dayH    = evs.reduce((s,e) => s + (e.end ? Math.max(0,(new Date(e.end)-new Date(e.start))/3600e3) : 0), 0);
      const cap     = dayLbl.charAt(0).toUpperCase() + dayLbl.slice(1);
      const isToday = ds === toInputDate(now);
      html += `<div class="stats-day-group">
        <div class="stats-day-header${isToday?' today':''}">
          ${cap}
          <span class="stats-day-h">${fmtHours(dayH)}</span>
        </div>`;
      evs.forEach(ev => { html += _upcomingBlockHtml(ev); });
      html += '</div>';
    });
  }
  html += '</div>';
  html += '</div>'; // two-col
  cont.innerHTML = html;
}

function _upcomingBlockHtml(ev) {
  const cls = classById(ev.classId);
  const col = cls ? cls.color : eventColor(ev);
  const h   = ev.end ? Math.max(0,(new Date(ev.end)-new Date(ev.start))/3600e3) : 0;
  const timeStr = fmtTime(ev.start) + (ev.end ? ' – ' + fmtTime(ev.end) : '');
  return `<div class="stats-upcoming-block" onclick="openEventDetail('${ev.id}')" style="border-left-color:${col}">
    <div class="sub-title">${ev.title}</div>
    <div class="sub-meta">${timeStr} &middot; ${fmtHours(h)}</div>
    ${cls ? `<div class="sub-class" style="color:${col}">${cls.name}</div>` : ''}
  </div>`;
}

// ── RENDER ALL ────────────────────────────────────────────────
function renderAll() {
  renderCalendar();
  renderTodayOverview();
  renderTomorrowOverview();
  renderUpcomingDeadlines();
  renderStudyHours();
  renderStudyHoursNext();
  const active = document.querySelector('.tab-content.active');
  if (active) {
    if (active.id === 'tab-taken')           renderEventsList();
    if (active.id === 'tab-beschikbaarheid') renderAvailabilityList();
    if (active.id === 'tab-kalenders')         renderExternalCalendars();
    if (active.id === 'tab-klasses')         renderClassesList();
    if (active.id === 'tab-statistieken')    renderStats();
  }
}

// ── CLOSE MODAL ON OVERLAY CLICK ─────────────────────────────
document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  e.target.style.display = 'none';
  currentEventId = null;
  currentAvailId = null;
});

// ── COLOR PREVIEW ─────────────────────────────────────────────
document.addEventListener('change', e => {
  if (e.target.id === 'class-color') {
    const prev = document.getElementById('class-color-preview');
    if (prev) prev.textContent = e.target.value;
  }
});

// ── EXPORT / CLEAR (utility, not exposed in UI) ───────────────
function clearAllData() {
  if (!confirm('⚠️ Alle data verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
  localStorage.removeItem('studieAgenda_v2');
  appData = { classes:[], events:[], availability:[] };
  initDefaultClasses();
  renderAll();
}

// ── AVAIL DRAG — DOCUMENT HANDLERS ────────────────────────────
document.addEventListener('pointermove', e => {
  if (dragAvail)  onAvailDragMove(e);
  if (pickerDrag) onPickerDragMove(e);
}, { passive: false });

document.addEventListener('pointerup', e => {
  if (dragAvail)  endAvailDrag(e);
  if (pickerDrag) endPickerDrag(e);
});

document.addEventListener('pointercancel', e => {
  if (dragAvail) {
    if (dragAvail.overlay) dragAvail.overlay.remove();
    dragAvail = null;
  }
  if (pickerDrag) {
    if (pickerDrag.overlay) pickerDrag.overlay.remove();
    pickerDrag = null;
  }
});

// ── BOOT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);