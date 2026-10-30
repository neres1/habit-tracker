/* Habit Tracker — interface (página única, JavaScript puro).
   Rotas no hash da URL: #/hoje, #/agenda, #/desempenho, #/atividades, #/atividade/<chave>.
   Os dados vêm de HT.store (js/store.js). */
(function () {
  'use strict';

  const { toKey, fromKey, addDays, today } = HT.dates;
  const store = HT.store;
  const THEME_KEY = 'habit-tracker:theme';

  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DOW_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const DOW_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  const svg = (body, size, width) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    check: svg('<path d="M5 12l5 5L19 7"/>', 20, 3),
    left: svg('<path d="M15 6l-6 6 6 6"/>', 18, 2.5),
    right: svg('<path d="M9 6l6 6-6 6"/>', 18, 2.5),
    sync: svg('<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/>', 18),
    flame: svg('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>', 16),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 14),
    google: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>'
  };

  // ---------- Utilidades ----------

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const dec = (n) => n.toFixed(1).replace('.', ',');
  const fmtLong = (d) => cap(d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  const fmtShort = (d) => d.getDate() + ' de ' + MONTHS[d.getMonth()];
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const weekStart = (d) => addDays(d, -d.getDay());
  const initial = (s) => (Array.from(String(s).trim())[0] || '?').toUpperCase();
  const kindLabel = (a) => (a.source === 'tasks' ? 'Task' : 'Evento');

  function timeLabel(a) {
    if (a.all_day) return a.source === 'tasks' ? 'Task do dia' : 'Dia todo';
    return fmtTime(a.start_at) + (a.end_at ? '–' + fmtTime(a.end_at) : '');
  }

  function rangeLabel(a, b) {
    if (a.getMonth() === b.getMonth()) return a.getDate() + ' – ' + b.getDate() + ' de ' + MONTHS[b.getMonth()] + ' de ' + b.getFullYear();
    return fmtShort(a) + ' – ' + fmtShort(b) + ' de ' + b.getFullYear();
  }

  function relativeTime(iso) {
    if (!iso) return 'nunca';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return 'há ' + plural(min, 'minuto', 'minutos');
    const h = Math.round(min / 60);
    if (h < 24) return 'há ' + plural(h, 'hora', 'horas');
    return 'em ' + fmtShort(new Date(iso));
  }

  const scoreClass = (r) => (r <= 3 ? 'low' : r <= 6 ? 'mid' : r <= 8 ? 'good' : 'top');
  const effectClass = (p) => (p == null ? 'none' : p < 40 ? 'low' : p < 60 ? 'mid' : p < 80 ? 'good' : 'top');

  // ---------- Métricas ----------
  // "Disponível" é toda atividade até o fim de hoje (mais as já concluídas): o que não tem
  // nota conta como zero. Efetividade = soma das notas ÷ (10 × disponíveis).
  // "Não feita" é a que já passou sem nota; "pendente" é a de hoje que ainda pode ser feita.

  const isDue = (a, tk) => a.status === 'done' || a.day <= tk;

  function isMissed(a, tk, now) {
    if (a.status === 'done') return false;
    if (a.day < tk) return true;
    return a.day === tk && !!(a.end_at && new Date(a.end_at).getTime() < now);
  }

  function metrics(list) {
    const tk = toKey(today());
    const now = Date.now();
    const due = list.filter((a) => isDue(a, tk));
    const done = list.filter((a) => a.status === 'done');
    const missed = list.filter((a) => isMissed(a, tk, now)).length;
    const sum = done.reduce((s, a) => s + a.rating, 0);
    return {
      total: list.length,
      due: due.length,
      done: done.length,
      missed,
      pending: due.length - done.length - missed,
      effect: due.length ? Math.round((sum / (10 * due.length)) * 100) : null,
      completion: due.length ? Math.round((done.length / due.length) * 100) : null,
      avg: done.length ? sum / done.length : null
    };
  }

  const inRange = (from, to) => store.items().filter((a) => a.day >= from && a.day <= to);

  function seriesList() {
    const map = new Map();
    store.items().forEach((a) => {
      let s = map.get(a.series_key);
      if (!s) { s = { key: a.series_key, title: a.title, source: a.source, container: a.container_name, items: [] }; map.set(a.series_key, s); }
      s.items.push(a);
    });
    return Array.from(map.values());
  }

  // ---------- Componentes ----------

  function seal(pct, size) {
    const s = size || 96;
    const c = 197.9;
    const frac = pct == null ? 0 : pct / 100;
    return `<div class="ring" style="width:${s}px;height:${s}px">` +
      `<svg viewBox="0 0 96 96" width="${s}" height="${s}" aria-hidden="true">` +
      '<circle class="ring-rays" cx="48" cy="48" r="43" fill="none" stroke-width="9" stroke-dasharray="6.75 6.75"/>' +
      '<circle class="ring-disc" cx="48" cy="48" r="37" stroke-width="2"/>' +
      '<circle class="ring-track" cx="48" cy="48" r="31.5" fill="none" stroke-width="5"/>' +
      `<circle class="ring-value" cx="48" cy="48" r="31.5" fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${(c * (1 - frac)).toFixed(1)}" transform="rotate(-90 48 48)"/>` +
      '<circle class="ring-face" cx="48" cy="48" r="26" stroke-width="2"/>' +
      `</svg><span class="ring-label" style="font-size:${Math.round(s / 6)}px">${pct == null ? '–' : pct + '%'}</span></div>`;
  }

  function syncButton() {
    if (store.mode === 'supabase' && ui.needsReconnect) {
      return `<button type="button" class="btn btn-ghost" data-action="signin">${ICONS.google}<span>Reconectar Google</span></button>`;
    }
    return `<button type="button" class="btn btn-ghost" data-action="sync"${ui.syncing ? ' disabled aria-busy="true"' : ''}>` +
      `<span class="${ui.syncing ? 'spin' : ''}">${ICONS.sync}</span><span>${ui.syncing ? 'Sincronizando…' : 'Sincronizar'}</span></button>`;
  }

  function activityRow(a) {
    const tk = toKey(today());
    const now = Date.now();
    const done = a.status === 'done';
    const missed = isMissed(a, tk, now);
    const future = a.day > tk;
    const check = done
      ? `<button type="button" class="check is-done" data-action="open" data-id="${esc(a.id)}" aria-label="Concluída com nota ${a.rating}. Editar ${esc(a.title)}">${ICONS.check}</button>`
      : `<button type="button" class="check" data-action="open" data-id="${esc(a.id)}" aria-label="Concluir ${esc(a.title)}"${future ? ' disabled' : ''}>${ICONS.check}</button>`;
    const tail = done
      ? `<button type="button" class="score score-${scoreClass(a.rating)}" data-action="open" data-id="${esc(a.id)}" aria-label="Nota ${a.rating} de 10. Editar">${a.rating}<small>/10</small></button>`
      : missed ? '<span class="tag tag-missed">Não feito</span>' : future ? '<span class="tag">Em breve</span>' : '';
    return `<li class="act${done ? ' is-done' : ''}${missed ? ' is-missed' : ''}">` + check +
      '<div class="act-main">' +
        `<span class="act-time">${ICONS.clock}${esc(timeLabel(a))}</span>` +
        `<a class="act-title" href="#/atividade/${encodeURIComponent(a.series_key)}">${esc(a.title)}</a>` +
        `<span class="act-meta"><span class="badge badge-${a.source}">${kindLabel(a)}</span>${esc(a.container_name || '')}</span>` +
        (done && a.note ? `<span class="act-note">“${esc(a.note)}”</span>` : '') +
      '</div>' + tail + '</li>';
  }

  function sparkline(vals) {
    if (!vals.length) return '';
    const w = 120;
    const h = 34;
    const n = vals.length;
    const x = (i) => (n === 1 ? w / 2 : 5 + (i * (w - 10)) / (n - 1));
    const y = (v) => h - 5 - (v / 10) * (h - 10);
    const line = vals.map((v, i) => (v ? x(i).toFixed(1) + ',' + y(v).toFixed(1) : null)).filter(Boolean).join(' ');
    const dots = vals.map((v, i) => (v
      ? `<circle class="spark-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6"/>`
      : `<circle class="spark-miss" cx="${x(i).toFixed(1)}" cy="${h - 4}" r="2.6"/>`)).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${line}"/>${dots}</svg>`;
  }

  function emptyState(title, text, withSync) {
    return `<div class="empty"><p class="script">${title}</p><p>${text}</p>${withSync ? syncButton() : ''}</div>`;
  }

  // ---------- Telas ----------

  function viewLogin() {
    return '<div class="login"><div class="card login-card">' +
      seal(100, 112) +
      '<p class="brand-name">Habit Tracker</p>' +
      '<h1 class="page-title" tabindex="-1">Sua agenda, avaliada dia a dia.</h1>' +
      '<p class="login-text">Conecte sua conta Google para transformar os eventos da Agenda e as suas Tasks em atividades que você conclui e avalia de 1 a 10.</p>' +
      `<button type="button" class="btn btn-primary btn-block" data-action="signin">${ICONS.google}Entrar com Google</button>` +
      '<p class="hint">O app pede acesso somente leitura à Agenda e às Tasks. Ele nunca altera nada no Google.</p>' +
      '<p class="hint"><a href="privacidade.html">Política de Privacidade</a></p>' +
      (ui.bootError ? `<p class="field-error" role="alert">${esc(ui.bootError)}</p>` : '') +
      '</div></div>';
  }

  function viewHoje() {
    const t = today();
    const tk = toKey(t);
    const sel = fromKey(ui.date);
    const selKey = ui.date;
    const isToday = selKey === tk;
    const list = inRange(selKey, selKey);
    const m = metrics(list);
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia, vizinho!' : hour < 18 ? 'Boa tarde, vizinho!' : 'Boa noite, vizinho!';
    const title = isToday ? greeting : selKey < tk ? 'Revendo um dia anterior' : 'Espiando o que vem por aí';

    const events = list.filter((a) => a.source === 'calendar');
    const tasks = list.filter((a) => a.source === 'tasks');
    const section = (label, items) => (items.length
      ? `<h3 class="list-label">${label} <span>${items.length}</span></h3><ul class="act-list">${items.map(activityRow).join('')}</ul>`
      : '');

    const summaryText = m.total === 0
      ? 'Nada na agenda para este dia.'
      : m.due === 0
        ? plural(m.total, 'atividade programada', 'atividades programadas') + '. As notas entram conforme você conclui.'
        : `${m.done} de ${m.due} concluídas${m.avg != null ? ' · nota média ' + dec(m.avg) : ''}`;

    return '' +
      '<header class="page-head">' +
        `<div class="stack-6"><p class="eyebrow">${esc(fmtLong(sel))}</p><h1 class="page-title" tabindex="-1">${title}</h1></div>` +
        '<div class="row">' +
          (isToday ? '' : '<button type="button" class="btn btn-ghost" data-action="day" data-step="today">Hoje</button>') +
          `<button type="button" class="icon-btn" data-action="day" data-step="-1" aria-label="Dia anterior">${ICONS.left}</button>` +
          `<button type="button" class="icon-btn" data-action="day" data-step="1" aria-label="Próximo dia">${ICONS.right}</button>` +
          syncButton() +
        '</div>' +
      '</header>' +
      '<section class="card stat stat-ring" aria-label="Resumo do dia">' + seal(m.effect) +
        '<div class="stack-4"><span class="stat-label">Efetividade do dia</span>' +
        `<span class="stat-big">${m.effect == null ? 'Sem notas ainda' : m.effect + '%'}</span>` +
        `<span class="stat-sub">${summaryText}</span></div>` +
      '</section>' +
      '<section class="card" aria-labelledby="dia-titulo">' +
        `<div class="card-head"><h2 id="dia-titulo" class="card-title">${isToday ? 'Atividades de hoje' : 'Atividades do dia'}</h2>` +
        `<span class="hint">${store.mode === 'demo' ? 'Dados de exemplo' : 'Sincronizado ' + relativeTime(store.lastSyncedAt())}</span></div>` +
        (list.length
          ? '<div class="card-body">' + section('Agenda', events) + section('Tasks', tasks) + '</div>'
          : emptyState('Dia livre!', 'Nenhum evento ou task do Google para este dia.', store.mode === 'supabase')) +
      '</section>';
  }

  function viewAgenda() {
    const t = today();
    const tk = toKey(t);
    const now = Date.now();
    const ws = addDays(weekStart(t), ui.weekOffset * 7);
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i));

    const cols = days.map((d) => {
      const k = toKey(d);
      const list = inRange(k, k);
      const m = metrics(list);
      const items = list.map((a) => {
        const done = a.status === 'done';
        const missed = isMissed(a, tk, now);
        const state = done ? 'done' : missed ? 'missed' : 'pending';
        return `<li><button type="button" class="mini mini-${state}" data-action="open" data-id="${esc(a.id)}"${k > tk ? ' disabled' : ''} aria-label="${esc(a.title)}, ${esc(timeLabel(a))}${done ? ', nota ' + a.rating : missed ? ', não feito' : ''}">` +
          `<span class="mini-time">${a.all_day ? (a.source === 'tasks' ? 'Task' : 'Dia') : fmtTime(a.start_at)}</span>` +
          `<span class="mini-title">${esc(a.title)}</span>` +
          (done ? `<span class="mini-score score-${scoreClass(a.rating)}">${a.rating}</span>` : missed ? '<span class="mini-x" aria-hidden="true">×</span>' : '') +
          '</button></li>';
      }).join('');
      return `<section class="card day-col${k === tk ? ' is-today' : ''}" aria-label="${DOW_LONG[d.getDay()]}, ${fmtShort(d)}">` +
        '<header class="day-head">' +
          `<span class="day-dow">${DOW_SHORT[d.getDay()]}</span><span class="day-num">${d.getDate()}</span>` +
          `<span class="pill effect-${effectClass(m.effect)}">${m.effect == null ? '–' : m.effect + '%'}</span>` +
        '</header>' +
        (items ? `<ul class="mini-list">${items}</ul>` : '<p class="day-empty">Livre</p>') +
        '</section>';
    }).join('');

    return '' +
      '<header class="page-head">' +
        `<div class="stack-6"><p class="eyebrow">${rangeLabel(days[0], days[6])}</p><h1 class="page-title" tabindex="-1">Agenda da semana</h1></div>` +
        '<div class="row">' +
          (ui.weekOffset !== 0 ? '<button type="button" class="btn btn-ghost" data-action="week" data-step="0">Esta semana</button>' : '') +
          `<button type="button" class="icon-btn" data-action="week" data-step="-1" aria-label="Semana anterior">${ICONS.left}</button>` +
          `<button type="button" class="icon-btn" data-action="week" data-step="1" aria-label="Próxima semana">${ICONS.right}</button>` +
          syncButton() +
        '</div>' +
      '</header>' +
      `<div class="week-grid">${cols}</div>`;
  }

  function periodRange() {
    const a = fromKey(ui.anchor);
    if (ui.period === 'dia') return { from: a, to: a, label: fmtLong(a) };
    if (ui.period === 'semana') { const s = weekStart(a); const e = addDays(s, 6); return { from: s, to: e, label: rangeLabel(s, e) }; }
    const s = new Date(a.getFullYear(), a.getMonth(), 1);
    const e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { from: s, to: e, label: cap(MONTHS[s.getMonth()]) + ' de ' + s.getFullYear() };
  }

  function chartDay(list) {
    const tk = toKey(today());
    const now = Date.now();
    if (!list.length) return emptyState('Dia livre!', 'Nenhuma atividade neste dia.');
    const rows = list.map((a) => {
      const done = a.status === 'done';
      const missed = isMissed(a, tk, now);
      const label = done ? a.rating + '/10' : missed ? 'Não feito' : 'Pendente';
      return '<li class="hbar">' +
        `<button type="button" class="hbar-name" data-action="open" data-id="${esc(a.id)}"${a.day > tk ? ' disabled' : ''}><span>${esc(a.title)}</span><small>${esc(timeLabel(a))}</small></button>` +
        `<span class="hbar-track"><span class="hbar-fill ${done ? 'score-' + scoreClass(a.rating) : missed ? 'is-missed' : 'is-pending'}" style="width:${done ? a.rating * 10 : missed ? 100 : 0}%"></span></span>` +
        `<span class="hbar-value">${label}</span></li>`;
    }).join('');
    return `<ul class="hbars">${rows}</ul>`;
  }

  function chartWeek(from) {
    const tk = toKey(today());
    const bars = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const d = addDays(from, i);
      const k = toKey(d);
      const m = metrics(inRange(k, k));
      const future = k > tk;
      const v = m.effect == null ? 0 : m.effect;
      return `<button type="button" class="vbar${k === tk ? ' is-today' : ''}" data-action="drill" data-date="${k}"${future ? ' disabled' : ''}` +
        ` aria-label="${DOW_LONG[d.getDay()]}, ${fmtShort(d)}: ${m.effect == null ? 'sem dados' : m.effect + '% de efetividade, ' + m.done + ' de ' + m.due + ' concluídas'}">` +
        `<span class="vbar-value">${m.effect == null ? '–' : m.effect + '%'}</span>` +
        `<span class="vbar-track"><span class="vbar-fill effect-${effectClass(m.effect)}" style="height:${future ? 0 : Math.max(v, 3)}%"></span></span>` +
        `<span class="vbar-label">${DOW_LETTER[d.getDay()]}<small>${d.getDate()}</small></span></button>`;
    }).join('');
    return `<div class="vbars">${bars}</div><p class="hint">Toque numa barra para ver o dia.</p>`;
  }

  function chartMonth(from, to) {
    const tk = toKey(today());
    let cells = DOW_LETTER.map((l) => `<span class="month-dow" aria-hidden="true">${l}</span>`).join('');
    for (let i = 0; i < from.getDay(); i++) cells += '<span></span>';
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const k = toKey(d);
      const m = metrics(inRange(k, k));
      cells += `<button type="button" class="month-cell effect-${effectClass(m.effect)}${k === tk ? ' is-today' : ''}" data-action="drill" data-date="${k}"${k > tk ? ' disabled' : ''}` +
        ` aria-label="${fmtShort(d)}: ${m.effect == null ? 'sem dados' : m.effect + '% de efetividade'}">` +
        `<span class="month-num">${d.getDate()}</span><span class="month-pct">${m.effect == null ? '' : m.effect + '%'}</span></button>`;
    }
    return `<div class="month-grid">${cells}</div>` +
      '<div class="legend" aria-hidden="true">Efetividade: <i class="effect-low"></i>&lt;40% <i class="effect-mid"></i>40–59% <i class="effect-good"></i>60–79% <i class="effect-top"></i>80%+</div>';
  }

  function histogram(list) {
    const counts = Array(11).fill(0);
    list.filter((a) => a.status === 'done').forEach((a) => { counts[a.rating]++; });
    const max = Math.max(1, ...counts);
    const total = counts.reduce((s, n) => s + n, 0);
    if (!total) return '<p class="hint">Nenhuma nota no período.</p>';
    const cols = [];
    for (let r = 1; r <= 10; r++) {
      cols.push('<div class="hist-col">' +
        `<span class="hist-count">${counts[r] || ''}</span>` +
        `<span class="hist-track"><span class="hist-bar score-${scoreClass(r)}" style="height:${(counts[r] / max) * 100}%"></span></span>` +
        `<span class="hist-label">${r}</span></div>`);
    }
    return `<div class="hist" role="img" aria-label="Notas no período: ${counts.map((n, r) => (r && n ? n + ' com nota ' + r : null)).filter(Boolean).join(', ')}">${cols.join('')}</div>`;
  }

  // Gráfico circular: como as atividades do período se dividem.
  function donut(list) {
    if (!list.length) return '<p class="hint">Nenhuma atividade no período.</p>';
    const tk = toKey(today());
    const now = Date.now();
    const count = (fn) => list.filter(fn).length;
    const done = (lo, hi) => (a) => a.status === 'done' && a.rating >= lo && a.rating <= hi;
    const slices = [
      { cls: 'seg-top', label: 'Concluídas · nota 9–10', n: count(done(9, 10)) },
      { cls: 'seg-good', label: 'Concluídas · nota 7–8', n: count(done(7, 8)) },
      { cls: 'seg-mid', label: 'Concluídas · nota 4–6', n: count(done(4, 6)) },
      { cls: 'seg-low', label: 'Concluídas · nota 1–3', n: count(done(1, 3)) },
      { cls: 'seg-missed', label: 'Não feitas', n: count((a) => isMissed(a, tk, now)) },
      { cls: 'seg-pending', label: 'Pendentes hoje', n: count((a) => a.status !== 'done' && a.day === tk && !isMissed(a, tk, now)) },
      { cls: 'seg-future', label: 'Por vir', n: count((a) => a.status !== 'done' && a.day > tk) }
    ].filter((s) => s.n > 0);
    const total = list.length;
    let offset = 0;
    const arcs = slices.map((s) => {
      const pct = (s.n / total) * 100;
      const arc = `<circle class="donut-seg ${s.cls}" cx="21" cy="21" r="15.9155" fill="none" stroke-width="6" stroke-dasharray="${pct.toFixed(3)} ${(100 - pct).toFixed(3)}" stroke-dashoffset="${(25 - offset).toFixed(3)}"><title>${s.label}: ${s.n} (${Math.round(pct)}%)</title></circle>`;
      offset += pct;
      return arc;
    }).join('');
    const legend = slices.map((s) =>
      `<li><i class="${s.cls}" aria-hidden="true"></i><span>${s.label}</span><strong>${s.n}</strong><small>${Math.round((s.n / total) * 100)}%</small></li>`).join('');
    return '<div class="donut-wrap">' +
      `<div class="donut"><svg viewBox="0 0 42 42" role="img" aria-label="${esc(slices.map((s) => s.label + ': ' + s.n).join(', '))}">` +
      `<circle class="donut-track" cx="21" cy="21" r="15.9155" fill="none" stroke-width="6"/>${arcs}</svg>` +
      `<span class="donut-center"><strong>${total}</strong><small>${total === 1 ? 'atividade' : 'atividades'}</small></span></div>` +
      `<ul class="donut-legend">${legend}</ul></div>`;
  }

  function meter(label, m) {
    return '<div class="meter">' +
      `<div class="meter-head"><span class="meter-label">${label}</span><span class="meter-value">${m.effect == null ? '–' : m.effect + '%'}</span></div>` +
      `<span class="meter-track"><span class="meter-fill effect-${effectClass(m.effect)}" style="width:${m.effect || 0}%"></span></span>` +
      `<span class="hint">${m.due ? m.done + ' de ' + m.due + ' concluídas' + (m.avg != null ? ' · média ' + dec(m.avg) : '') : 'Sem atividades devidas'}</span></div>`;
  }

  function viewDesempenho() {
    const r = periodRange();
    const fk = toKey(r.from);
    const tkEnd = toKey(r.to);
    const list = inRange(fk, tkEnd);
    const m = metrics(list);
    const tk = toKey(today());

    const seg = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map((p) =>
      `<button type="button" data-action="period" data-value="${p[0]}" aria-pressed="${ui.period === p[0]}">${p[1]}</button>`).join('');

    const chart = ui.period === 'dia' ? chartDay(list) : ui.period === 'semana' ? chartWeek(r.from) : chartMonth(r.from, r.to);
    const chartTitle = ui.period === 'dia' ? 'Notas do dia' : ui.period === 'semana' ? 'Efetividade por dia' : 'Calendário do mês';

    const ranked = seriesList().map((s) => {
      const sm = metrics(s.items.filter((a) => a.day >= fk && a.day <= tkEnd));
      return { s, m: sm };
    }).filter((x) => x.m.due >= 2).sort((a, b) => b.m.effect - a.m.effect);
    const best = ranked.slice(0, 3);
    const worst = ranked.slice(Math.max(best.length, ranked.length - 3)).reverse();
    const rankRow = (x) => `<li><a class="rank-row" href="#/atividade/${encodeURIComponent(x.s.key)}"><span>${esc(x.s.title)}</span><span class="pill effect-${effectClass(x.m.effect)}">${x.m.effect}%</span></a></li>`;

    return '' +
      '<header class="page-head">' +
        `<div class="stack-6"><p class="eyebrow">${esc(r.label)}</p><h1 class="page-title" tabindex="-1">Desempenho</h1></div>` +
        '<div class="row">' +
          `<div class="seg" role="group" aria-label="Período">${seg}</div>` +
          `<button type="button" class="icon-btn" data-action="period-nav" data-step="-1" aria-label="Período anterior">${ICONS.left}</button>` +
          `<button type="button" class="icon-btn" data-action="period-nav" data-step="1" aria-label="Próximo período"${tkEnd >= tk ? ' disabled' : ''}>${ICONS.right}</button>` +
        '</div>' +
      '</header>' +
      '<section class="kpis" aria-label="Indicadores do período">' +
        `<div class="card stat stat-ring">${seal(m.effect)}<div class="stack-4"><span class="stat-label">Efetividade</span><span class="stat-big">${m.effect == null ? '–' : m.effect + '%'}</span><span class="stat-sub">soma das notas ÷ máximo possível; sem nota conta zero</span></div></div>` +
        `<div class="card stat"><span class="stat-label">Concluídas</span><span class="stat-value">${m.done}<small> de ${m.due}</small></span><span class="stat-sub">${m.completion == null ? 'Nada disponível ainda' : m.completion + '% das atividades disponíveis'}</span></div>` +
        `<div class="card stat"><span class="stat-label">Nota média</span><span class="stat-value">${m.avg == null ? '–' : dec(m.avg)}</span><span class="stat-sub">nas atividades concluídas</span></div>` +
        `<div class="card stat"><span class="stat-label warm">Não feitas</span><span class="stat-value">${m.missed}</span><span class="stat-sub">atividades que passaram sem nota</span></div>` +
      '</section>' +
      '<div class="split">' +
        `<section class="card card-pad stack-16" aria-labelledby="graf-titulo"><h2 id="graf-titulo" class="section-title">${chartTitle}</h2>${chart}</section>` +
        '<div class="aside">' +
          `<section class="card card-pad stack-16" aria-labelledby="pizza-titulo"><h2 id="pizza-titulo" class="section-title">Situação das atividades</h2>${donut(list)}</section>` +
          `<section class="card card-pad stack-16" aria-labelledby="hist-titulo"><h2 id="hist-titulo" class="section-title">Distribuição das notas</h2>${histogram(list)}</section>` +
          '<section class="card card-pad stack-16" aria-labelledby="tipo-titulo"><h2 id="tipo-titulo" class="section-title">Por tipo</h2>' +
            meter('Eventos da agenda', metrics(list.filter((a) => a.source === 'calendar'))) +
            meter('Tasks', metrics(list.filter((a) => a.source === 'tasks'))) +
          '</section>' +
          (best.length
            ? '<section class="card card-pad stack-10" aria-labelledby="dest-titulo"><h2 id="dest-titulo" class="section-title">Destaques</h2>' +
              `<p class="stat-label">Melhores</p><ul class="rank">${best.map(rankRow).join('')}</ul>` +
              (worst.length ? `<p class="stat-label warm">Precisam de atenção</p><ul class="rank">${worst.map(rankRow).join('')}</ul>` : '') +
              '</section>'
            : '') +
        '</div>' +
      '</div>';
  }

  function viewAtividades() {
    const tk = toKey(today());
    const since = toKey(addDays(today(), -29));
    const now = Date.now();
    const filter = ui.seriesFilter;
    const series = seriesList()
      .filter((s) => filter === 'todas' || (filter === 'eventos' ? s.source === 'calendar' : s.source === 'tasks'))
      .map((s) => {
        const recent = s.items.filter((a) => a.day >= since && a.day <= tk);
        const due = s.items.filter((a) => a.status === 'done' || isMissed(a, tk, now));
        return { s, m: metrics(recent), spark: due.slice(-12).map((a) => (a.status === 'done' ? a.rating : 0)), count: recent.length };
      })
      .sort((a, b) => b.count - a.count || a.s.title.localeCompare(b.s.title));

    const chips = [['todas', 'Todas'], ['eventos', 'Eventos'], ['tasks', 'Tasks']].map((c) =>
      `<button type="button" class="chip" data-action="series-filter" data-value="${c[0]}" aria-pressed="${filter === c[0]}">${c[1]}</button>`).join('');

    const cards = series.map((x) =>
      `<li><a class="series-card" href="#/atividade/${encodeURIComponent(x.s.key)}">` +
        `<span class="avatar avatar-${x.s.source}" aria-hidden="true">${esc(initial(x.s.title))}</span>` +
        '<span class="series-main">' +
          `<span class="series-title">${esc(x.s.title)}</span>` +
          `<span class="act-meta"><span class="badge badge-${x.s.source}">${x.s.source === 'tasks' ? 'Task' : 'Evento'}</span>${esc(x.s.container || '')}</span>` +
          `<span class="hint">${x.m.due ? x.m.done + ' de ' + x.m.due + ' nos últimos 30 dias' + (x.m.avg != null ? ' · média ' + dec(x.m.avg) : '') : 'Sem ocorrências nos últimos 30 dias'}</span>` +
        '</span>' +
        `<span class="series-spark">${sparkline(x.spark)}</span>` +
        `<span class="pill effect-${effectClass(x.m.effect)}">${x.m.effect == null ? '–' : x.m.effect + '%'}</span>` +
      '</a></li>').join('');

    return '' +
      '<header class="page-head">' +
        `<div class="stack-6"><p class="eyebrow">${plural(series.length, 'atividade', 'atividades')}</p><h1 class="page-title" tabindex="-1">Atividades</h1></div>` +
        `<div class="chips" role="group" aria-label="Filtrar">${chips}</div>` +
      '</header>' +
      (series.length
        ? `<ul class="series-list">${cards}</ul>`
        : '<div class="card">' + emptyState('Nada por aqui!', 'Sincronize sua agenda para trazer eventos e tasks.', store.mode === 'supabase') + '</div>') +
      accountPanel();
  }

  function accountPanel() {
    const theme = currentTheme();
    return '<section class="card card-pad stack-16 account-panel" aria-labelledby="conta-titulo">' +
      '<h2 id="conta-titulo" class="section-title">Conta e aparência</h2>' +
      `<p class="hint">${store.mode === 'demo' ? 'Modo demonstração: configure o Supabase em js/config.js para usar sua agenda.' : 'Conectado como ' + esc(store.user && store.user.email) + ' · sincronizado ' + relativeTime(store.lastSyncedAt())}</p>` +
      '<div class="theme-switch" role="group" aria-label="Tema">' +
        [['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Escuro']].map((o) => `<button type="button" data-action="theme" data-theme-value="${o[0]}" aria-pressed="${theme === o[0]}">${o[1]}</button>`).join('') +
      '</div>' +
      '<div class="row">' +
        (store.mode === 'demo'
          ? '<button type="button" class="btn btn-ghost" data-action="demo-reset">Recriar dados de exemplo</button>'
          : '<button type="button" class="btn btn-danger" data-action="signout">Sair</button>') +
      '</div>' +
      '<p class="hint"><a href="privacidade.html">Política de Privacidade</a></p></section>';
  }

  function viewAtividade(key) {
    const items = store.items().filter((a) => a.series_key === key);
    if (!items.length) {
      return '<div class="card">' + emptyState('Ops!', 'Atividade não encontrada.') + '<p class="empty"><a class="btn btn-primary" href="#/atividades">Ver atividades</a></p></div>';
    }
    const tk = toKey(today());
    const now = Date.now();
    const last = items[items.length - 1];
    // Sequência e gráfico usam só ocorrências encerradas (concluídas ou não feitas).
    const due = items.filter((a) => a.status === 'done' || isMissed(a, tk, now));
    const m = metrics(items);
    const m30 = metrics(items.filter((a) => a.day >= toKey(addDays(today(), -29)) && a.day <= tk));

    let streak = 0;
    for (let i = due.length - 1; i >= 0 && due[i].status === 'done'; i--) streak++;
    const best = due.reduce((b, a) => (a.status === 'done' && a.rating > b ? a.rating : b), 0);

    const pts = due.slice(-20);
    const W = 640;
    const H = 220;
    const L = 34;
    const R = 12;
    const T = 14;
    const B = 30;
    const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
    const y = (v) => T + (1 - (v - 1) / 9) * (H - T - B);
    const grid = [1, 5, 10].map((v) => `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
    const line = pts.map((a, i) => (a.status === 'done' ? x(i).toFixed(1) + ',' + y(a.rating).toFixed(1) : null)).filter(Boolean).join(' ');
    const marks = pts.map((a, i) => {
      const d = fromKey(a.day);
      const lbl = i % Math.ceil(pts.length / 6) === 0 || i === pts.length - 1
        ? `<text class="chart-axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.getDate()}/${d.getMonth() + 1}</text>` : '';
      return (a.status === 'done'
        ? `<circle class="chart-dot score-${scoreClass(a.rating)}" cx="${x(i)}" cy="${y(a.rating)}" r="6"><title>${fmtShort(d)}: nota ${a.rating}</title></circle>`
        : `<g class="chart-miss"><title>${fmtShort(d)}: não feito</title><path d="M${x(i) - 5} ${H - B - 5}l10 10m0 -10l-10 10"/></g>`) + lbl;
    }).join('');
    const chart = pts.length
      ? `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Notas das últimas ${pts.length} ocorrências">${grid}<polyline class="chart-line" points="${line}"/>${marks}</svg>`
      : '<p class="hint">Ainda não há ocorrências passadas.</p>';

    const history = items.slice().reverse().filter((a) => a.day <= toKey(addDays(today(), 7))).slice(0, 40).map((a) => {
      const d = fromKey(a.day);
      return `<li class="hist-row"><span class="hist-date"><strong>${DOW_SHORT[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}</strong><small>${esc(timeLabel(a))}</small></span>` +
        '<span class="hist-detail">' + (a.note ? `<span class="act-note">“${esc(a.note)}”</span>` : '') + '</span>' +
        (a.status === 'done'
          ? `<button type="button" class="score score-${scoreClass(a.rating)}" data-action="open" data-id="${esc(a.id)}" aria-label="Nota ${a.rating}. Editar">${a.rating}<small>/10</small></button>`
          : isMissed(a, tk, now)
            ? `<button type="button" class="tag tag-missed tag-btn" data-action="open" data-id="${esc(a.id)}">Não feito · avaliar</button>`
            : a.day > tk ? '<span class="tag">Em breve</span>'
              : `<button type="button" class="btn btn-primary btn-sm" data-action="open" data-id="${esc(a.id)}">Concluir</button>`) +
        '</li>';
    }).join('');

    return '' +
      '<header class="page-head">' +
        `<div class="row"><a class="icon-btn" href="#/atividades" aria-label="Voltar para Atividades">${ICONS.left}</a><p class="eyebrow">${kindLabel(last)} · ${esc(last.container_name || '')}</p></div>` +
      '</header>' +
      `<div class="detail-hero"><span class="avatar avatar-${last.source} lg" aria-hidden="true">${esc(initial(last.title))}</span>` +
        `<div class="stack-4"><h1 class="page-title" tabindex="-1">${esc(last.title)}</h1><span class="hint">${plural(items.length, 'ocorrência carregada', 'ocorrências carregadas')}</span></div></div>` +
      '<section class="kpis" aria-label="Indicadores da atividade">' +
        `<div class="card stat stat-ring">${seal(m.effect)}<div class="stack-4"><span class="stat-label">Efetividade geral</span><span class="stat-big">${m.effect == null ? '–' : m.effect + '%'}</span><span class="stat-sub">${m.done} de ${m.due} concluídas</span></div></div>` +
        `<div class="card stat"><span class="stat-label">Últimos 30 dias</span><span class="stat-value">${m30.effect == null ? '–' : m30.effect + '%'}</span><span class="stat-sub">${m30.avg == null ? 'sem notas' : 'média ' + dec(m30.avg)}</span></div>` +
        `<div class="card stat"><span class="stat-label warm">${ICONS.flame}Sequência</span><span class="stat-value">${streak}</span><span class="stat-sub">concluídas seguidas</span></div>` +
        `<div class="card stat"><span class="stat-label">Melhor nota</span><span class="stat-value">${best || '–'}</span><span class="stat-sub">${m.avg == null ? 'sem notas' : 'média geral ' + dec(m.avg)}</span></div>` +
      '</section>' +
      `<section class="card card-pad stack-16" aria-labelledby="evol-titulo"><h2 id="evol-titulo" class="section-title">Evolução das notas</h2>${chart}</section>` +
      `<section class="card" aria-labelledby="histo-titulo"><div class="card-head"><h2 id="histo-titulo" class="card-title">Histórico</h2></div><ul class="hist-list">${history}</ul></section>`;
  }

  // ---------- Janela de avaliação ----------

  const dialog = document.getElementById('rate-dialog');
  const rateForm = document.getElementById('rate-form');
  let rating = { id: null };

  (function buildScale() {
    const box = document.getElementById('rate-scale');
    let html = '';
    for (let r = 1; r <= 10; r++) {
      html += `<label class="scale-item score-${scoreClass(r)}"><input type="radio" name="rating" value="${r}"><span>${r}</span></label>`;
    }
    box.innerHTML = html;
  })();

  function openRating(id) {
    const a = store.items().find((x) => x.id === id);
    if (!a) return;
    if (a.day > toKey(today())) { toast('Essa atividade ainda não chegou.'); return; }
    rating = { id, opener: document.activeElement };
    const done = a.status === 'done';
    document.getElementById('rate-title').textContent = a.title;
    document.getElementById('rate-when').textContent = fmtLong(fromKey(a.day)) + ' · ' + timeLabel(a);
    rateForm.querySelectorAll('input[name="rating"]').forEach((i) => { i.checked = done && Number(i.value) === a.rating; });
    document.getElementById('rate-note').value = a.note || '';
    document.getElementById('rate-error').hidden = true;
    document.getElementById('rate-undo').hidden = !done;
    document.getElementById('rate-save').textContent = done ? 'Salvar nota' : 'Concluir';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    const first = rateForm.querySelector('input[name="rating"]:checked') || rateForm.querySelector('input[name="rating"]');
    first.focus();
  }

  function closeRating() {
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  }

  dialog.addEventListener('close', () => {
    const op = rating.opener;
    rating = { id: null };
    if (op && document.contains(op)) op.focus();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeRating(); });
  document.getElementById('rate-cancel').addEventListener('click', closeRating);

  rateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const checked = rateForm.querySelector('input[name="rating"]:checked');
    if (!checked) { document.getElementById('rate-error').hidden = false; return; }
    const id = rating.id;
    const value = Number(checked.value);
    const note = document.getElementById('rate-note').value.trim().slice(0, 500);
    try {
      await store.complete(id, value, note);
      closeRating();
      toast('Concluída com nota ' + value + '/10.');
      render();
    } catch (err) {
      toast(err.message || 'Não foi possível salvar.', 'error');
    }
  });

  document.getElementById('rate-undo').addEventListener('click', async () => {
    try {
      await store.uncomplete(rating.id);
      closeRating();
      toast('Atividade marcada como não concluída.');
      render();
    } catch (err) {
      toast(err.message || 'Não foi possível desfazer.', 'error');
    }
  });

  // ---------- Avisos ----------

  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'toast is-visible' + (kind === 'error' ? ' is-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, kind === 'error' ? 7000 : 3500);
  }

  // ---------- Tema ----------

  function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
  function setTheme(value) {
    if (value === 'light' || value === 'dark') document.documentElement.setAttribute('data-theme', value);
    else document.documentElement.removeAttribute('data-theme');
    try {
      if (value === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, value);
    } catch (e) { /* vale só nesta visita */ }
    syncChrome();
  }

  // ---------- Renderização e rotas ----------

  const view = document.getElementById('view');
  const ui = {
    date: toKey(today()),
    followToday: true,
    weekOffset: 0,
    period: 'semana',
    anchor: toKey(today()),
    seriesFilter: 'todas',
    syncing: false,
    needsReconnect: false,
    bootError: null
  };
  let lastRoute = null;

  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '') || 'hoje';
    const i = raw.indexOf('/');
    return i === -1 ? { name: raw, arg: null } : { name: raw.slice(0, i), arg: decodeURIComponent(raw.slice(i + 1)) };
  }

  function focusKey(el) {
    if (!el || !el.dataset || !el.dataset.action || !view.contains(el)) return null;
    return ['action', 'id', 'date', 'step', 'value', 'themeValue']
      .filter((k) => el.dataset[k] != null)
      .map((k) => '[data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '="' + CSS.escape(el.dataset[k]) + '"]')
      .join('');
  }

  function syncChrome() {
    const theme = currentTheme();
    document.querySelectorAll('[data-action="theme"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeValue === theme)));
    const acc = document.getElementById('account');
    if (acc) {
      acc.innerHTML = store.mode === 'demo'
        ? '<span class="pill">Modo demonstração</span>'
        : store.user
          ? `<span class="account-email">${esc(store.user.email)}</span><button type="button" class="link-btn" data-action="signout">Sair</button>`
          : '';
    }
  }

  function render() {
    const r = parseRoute();
    const routeKey = r.name + '/' + (r.arg || '');
    const navigated = routeKey !== lastRoute;
    const restore = navigated ? null : focusKey(document.activeElement);
    if (ui.followToday) ui.date = toKey(today());

    const signedOut = store.mode === 'supabase' && !store.user;
    document.body.classList.toggle('signed-out', signedOut);

    let html;
    let title;
    let nav;
    if (signedOut) {
      html = viewLogin(); title = 'Entrar'; nav = null;
    } else {
      switch (r.name) {
        case 'hoje': html = viewHoje(); title = 'Hoje'; nav = 'hoje'; break;
        case 'agenda': html = viewAgenda(); title = 'Agenda'; nav = 'agenda'; break;
        case 'desempenho': html = viewDesempenho(); title = 'Desempenho'; nav = 'desempenho'; break;
        case 'atividades': html = viewAtividades(); title = 'Atividades'; nav = 'atividades'; break;
        case 'atividade': html = viewAtividade(r.arg); title = 'Atividade'; nav = 'atividades'; break;
        default: location.replace('#/hoje'); return;
      }
    }

    const banner = store.mode === 'demo'
      ? '<p class="banner">Modo demonstração com dados de exemplo. Para usar sua agenda, siga o guia do README e preencha <code>js/config.js</code>.</p>'
      : '';
    view.innerHTML = '<div class="view">' + (signedOut ? '' : banner) + html + '</div>';
    document.title = title + ' · Habit Tracker';
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    syncChrome();

    if (navigated) {
      const first = lastRoute === null;
      lastRoute = routeKey;
      if (!first) {
        window.scrollTo(0, 0);
        const h1 = view.querySelector('h1');
        if (h1) h1.focus({ preventScroll: true });
      }
    } else if (restore) {
      const el = view.querySelector(restore);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  async function doSync() {
    if (ui.syncing) return;
    ui.syncing = true;
    render();
    try {
      const res = await store.sync();
      ui.needsReconnect = false;
      if (res.demo) toast('No modo demonstração não há agenda para sincronizar.');
      else toast(`Agenda sincronizada: ${plural(res.count, 'atividade', 'atividades')}${res.removed ? ', ' + res.removed + ' removida(s)' : ''}.` + (res.warnings.length ? ' Atenção: ' + res.warnings.join(' ') : ''), res.warnings.length ? 'error' : null);
    } catch (e) {
      if (e.code === 'google-auth') { ui.needsReconnect = true; toast('A conexão com o Google expirou. Toque em "Reconectar Google".', 'error'); }
      else toast(e.message || 'Falha ao sincronizar.', 'error');
    } finally {
      ui.syncing = false;
      render();
    }
  }

  // ---------- Eventos ----------

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const step = btn.dataset.step;

    if (action === 'open') {
      openRating(btn.dataset.id);
    } else if (action === 'day') {
      ui.date = step === 'today' ? toKey(today()) : toKey(addDays(fromKey(ui.date), Number(step)));
      ui.followToday = ui.date === toKey(today());
      render();
    } else if (action === 'week') {
      ui.weekOffset = step === '0' ? 0 : ui.weekOffset + Number(step);
      render();
    } else if (action === 'period') {
      ui.period = btn.dataset.value;
      render();
    } else if (action === 'period-nav') {
      const a = fromKey(ui.anchor);
      const n = Number(step);
      ui.anchor = toKey(ui.period === 'dia' ? addDays(a, n) : ui.period === 'semana' ? addDays(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1));
      render();
    } else if (action === 'drill') {
      ui.period = 'dia';
      ui.anchor = btn.dataset.date;
      render();
    } else if (action === 'series-filter') {
      ui.seriesFilter = btn.dataset.value;
      render();
    } else if (action === 'sync') {
      doSync();
    } else if (action === 'signin') {
      try { await store.signIn(); } catch (err) { toast(err.message || 'Não foi possível abrir o login do Google.', 'error'); }
    } else if (action === 'signout') {
      if (!window.confirm('Sair da sua conta neste navegador?')) return;
      await store.signOut();
      location.hash = '#/hoje';
      render();
    } else if (action === 'theme') {
      setTheme(btn.dataset.themeValue);
    } else if (action === 'demo-reset') {
      if (!window.confirm('Recriar os dados de exemplo? As notas dadas no modo demonstração serão apagadas.')) return;
      await store.reset();
      render();
    }
  });

  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !(dialog.open)) render(); });
  document.querySelector('[data-skip]').addEventListener('click', () => view.focus());

  // ---------- Início ----------

  (async function boot() {
    view.innerHTML = '<div class="view"><p class="loading">Carregando…</p></div>';
    try {
      await store.init();
    } catch (e) {
      ui.bootError = e.message || 'Não foi possível carregar seus dados.';
      toast(ui.bootError, 'error');
    }
    store.onAuthChange((event) => { if (event === 'SIGNED_OUT') render(); });
    render();
    // Sincroniza sozinho ao entrar, se a última sincronização tiver mais de 30 minutos.
    if (store.mode === 'supabase' && store.user) {
      const last = store.lastSyncedAt();
      if (!last || Date.now() - new Date(last).getTime() > 30 * 60 * 1000) doSync();
    }
  })();
})();
