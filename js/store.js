/* Camada de dados do Habit Tracker.
   - Modo Supabase: login com Google, leitura do Google Agenda e do Google Tasks
     direto do navegador e gravação das atividades no Supabase.
   - Modo demonstração: sem Supabase configurado, usa dados de exemplo no localStorage.
   As duas implementações expõem a mesma interface (veja o fim do arquivo). */
(function () {
  'use strict';

  const HT = (window.HT = window.HT || {});
  const cfg = window.HT_CONFIG || {};

  const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly';
  const SYNC_PAST_DAYS = 60;
  const SYNC_FUTURE_DAYS = 30;
  const HISTORY_DAYS = 400;
  const TOKEN_KEY = 'habit-tracker:google-token';

  // ---------- Datas (sempre no fuso local) ----------

  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fromKey = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  HT.dates = { pad, toKey, fromKey, addDays, today };

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function sortItems(list) {
    return list.sort((a, b) =>
      a.day < b.day ? -1 : a.day > b.day ? 1 :
      (a.all_day === b.all_day ? 0 : a.all_day ? -1 : 1) ||
      String(a.start_at || '').localeCompare(String(b.start_at || '')) ||
      a.title.localeCompare(b.title));
  }

  function codedError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  // ---------- Google ----------

  async function gfetch(url, token) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401) throw codedError('google-auth', 'A conexão com o Google expirou.');
    if (res.status === 403) throw codedError('google-forbidden', 'O Google recusou o acesso (verifique se a API está ativada e se a permissão foi concedida).');
    if (!res.ok) throw codedError('google-error', 'O Google respondeu com erro ' + res.status + '.');
    return res.json();
  }

  function mapEvent(ev, cal) {
    if (ev.status === 'cancelled' || !ev.start) return null;
    if (ev.eventType === 'workingLocation' || ev.eventType === 'outOfOffice') return null;
    const me = (ev.attendees || []).find((a) => a.self);
    if (me && me.responseStatus === 'declined') return null;
    const allDay = !!ev.start.date;
    const title = String(ev.summary || '(Sem título)').slice(0, 200);
    return {
      source: 'calendar',
      external_id: cal.id + ':' + ev.id,
      series_key: 'calendar:' + norm(title),
      container_id: cal.id,
      container_name: cal.summaryOverride || cal.summary || 'Agenda',
      title,
      description: ev.description ? String(ev.description).slice(0, 2000) : null,
      location: ev.location ? String(ev.location).slice(0, 300) : null,
      day: allDay ? ev.start.date : toKey(new Date(ev.start.dateTime)),
      start_at: allDay ? null : ev.start.dateTime,
      end_at: allDay ? null : (ev.end && ev.end.dateTime) || null,
      all_day: allDay
    };
  }

  async function fetchCalendar(token, from, to) {
    const list = await gfetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250', token);
    // Ignora agendas automáticas (feriados, aniversários, número da semana).
    const cals = (list.items || []).filter((c) => c.selected !== false && !/#(holiday|contacts|weeknum)@|addressbook#/.test(c.id));
    const items = [];
    for (const cal of cals) {
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
          timeMin: from.toISOString(), timeMax: to.toISOString()
        });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await gfetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(cal.id) + '/events?' + params, token);
        (data.items || []).forEach((ev) => { const a = mapEvent(ev, cal); if (a) items.push(a); });
        pageToken = data.nextPageToken || '';
      } while (pageToken);
    }
    return items;
  }

  async function fetchTasks(token, from, to) {
    const lists = await gfetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100', token);
    const items = [];
    for (const list of lists.items || []) {
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          showCompleted: 'true', showHidden: 'true', maxResults: '100',
          dueMin: from.toISOString(), dueMax: to.toISOString()
        });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await gfetch('https://tasks.googleapis.com/tasks/v1/lists/' + encodeURIComponent(list.id) + '/tasks?' + params, token);
        (data.items || []).forEach((t) => {
          const title = String(t.title || '').trim();
          // Tasks sem data não têm um dia para entrar nas métricas.
          if (!t.due || t.deleted || !title) return;
          items.push({
            source: 'tasks',
            external_id: list.id + ':' + t.id,
            series_key: 'tasks:' + norm(title),
            container_id: list.id,
            container_name: list.title || 'Tarefas',
            title: title.slice(0, 200),
            description: t.notes ? String(t.notes).slice(0, 2000) : null,
            location: null,
            // O Google Tasks guarda só a data do prazo (o horário vem zerado em UTC).
            day: t.due.slice(0, 10),
            start_at: null,
            end_at: null,
            all_day: true
          });
        });
        pageToken = data.nextPageToken || '';
      } while (pageToken);
    }
    return items;
  }

  // ---------- Modo Supabase ----------

  function createSupabaseStore() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    let user = null;
    let items = [];
    let settings = null;

    // O Supabase não renova o token do Google: guardamos o que veio no login (vale ~1 hora).
    function rememberGoogleToken(session) {
      if (!session || !session.provider_token) return;
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: session.provider_token, exp: Date.now() + 55 * 60 * 1000 })); } catch (e) { /* sem armazenamento */ }
    }
    function googleToken() {
      try {
        const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
        if (t && t.exp > Date.now()) return t.token;
      } catch (e) { /* ignora */ }
      return null;
    }

    async function load() {
      const from = toKey(addDays(today(), -HISTORY_DAYS));
      const all = [];
      const PAGE = 1000;
      for (let i = 0; ; i += PAGE) {
        const { data, error } = await sb.from('activities').select('*').gte('day', from)
          .order('day', { ascending: true }).order('id', { ascending: true }).range(i, i + PAGE - 1);
        if (error) throw error;
        all.push.apply(all, data);
        if (data.length < PAGE) break;
      }
      items = sortItems(all);
      const s = await sb.from('user_settings').select('*').maybeSingle();
      if (s.error) throw s.error;
      settings = s.data || null;
    }

    function replaceItem(row) {
      const i = items.findIndex((a) => a.id === row.id);
      if (i !== -1) items[i] = row;
    }

    return {
      mode: 'supabase',
      get user() { return user; },
      items: () => items,
      lastSyncedAt: () => (settings && settings.last_synced_at) || null,
      hasGoogleToken: () => !!googleToken(),

      async init() {
        const params = new URLSearchParams(location.search);
        const authError = params.get('error_description') || params.get('error');
        const { data, error } = await sb.auth.getSession();
        if (location.search) history.replaceState(null, '', location.pathname + location.hash);
        if (authError) throw codedError('auth', 'O login não foi concluído: ' + authError);
        if (error) throw error;
        if (!data.session) return;
        rememberGoogleToken(data.session);
        user = data.session.user;
        await load();
      },

      signIn() {
        return sb.auth.signInWithOAuth({
          provider: 'google',
          options: {
            scopes: GOOGLE_SCOPES,
            redirectTo: location.origin + location.pathname,
            queryParams: { access_type: 'offline', prompt: 'consent' }
          }
        });
      },

      async signOut() {
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignora */ }
        await sb.auth.signOut();
        user = null;
        items = [];
      },

      async complete(id, rating, note) {
        const { data, error } = await sb.from('activities')
          .update({ status: 'done', rating, note: note || null, completed_at: new Date().toISOString() })
          .eq('id', id).select().single();
        if (error) throw error;
        replaceItem(data);
      },

      async uncomplete(id) {
        const { data, error } = await sb.from('activities')
          .update({ status: 'pending', rating: null, note: null, completed_at: null })
          .eq('id', id).select().single();
        if (error) throw error;
        replaceItem(data);
      },

      async sync() {
        const token = googleToken();
        if (!token) throw codedError('google-auth', 'Conecte o Google de novo para sincronizar.');
        const t = today();
        const from = addDays(t, -SYNC_PAST_DAYS);
        const to = addDays(t, SYNC_FUTURE_DAYS + 1);
        const fromK = toKey(from);
        const toK = toKey(addDays(to, -1));
        const warnings = [];
        const fetched = [];

        try {
          fetched.push({ source: 'calendar', items: await fetchCalendar(token, from, to) });
        } catch (e) {
          if (e.code === 'google-auth') throw e;
          warnings.push('Agenda: ' + e.message);
        }
        try {
          fetched.push({ source: 'tasks', items: await fetchTasks(token, from, to) });
        } catch (e) {
          if (e.code === 'google-auth') throw e;
          warnings.push('Tasks: ' + e.message);
        }

        const now = new Date().toISOString();
        const seen = new Set();
        const rows = [];
        fetched.forEach((f) => f.items.forEach((a) => {
          const k = a.source + '|' + a.external_id;
          if (seen.has(k)) return;
          seen.add(k);
          rows.push(Object.assign({ user_id: user.id, synced_at: now }, a));
        }));
        // O upsert só envia os campos do Google: status, nota e observação ficam como estão.
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await sb.from('activities').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,source,external_id' });
          if (error) throw error;
        }

        // Remove o que sumiu do Google, desde que ainda não tenha sido avaliado.
        let removed = 0;
        for (const f of fetched) {
          const ids = new Set(f.items.map((a) => a.external_id));
          const stale = items.filter((a) => a.source === f.source && a.status === 'pending' && a.day >= fromK && a.day <= toK && !ids.has(a.external_id)).map((a) => a.id);
          for (let i = 0; i < stale.length; i += 200) {
            const { error } = await sb.from('activities').delete().in('id', stale.slice(i, i + 200));
            if (error) throw error;
          }
          removed += stale.length;
        }

        const { error: sErr } = await sb.from('user_settings').upsert({ user_id: user.id, last_synced_at: now, updated_at: now });
        if (sErr) throw sErr;
        await load();
        return { count: rows.length, removed, warnings };
      },

      onAuthChange(callback) {
        sb.auth.onAuthStateChange((event, session) => {
          if (session) rememberGoogleToken(session);
          callback(event);
        });
      }
    };
  }

  // ---------- Modo demonstração ----------

  function createDemoStore() {
    const KEY = 'habit-tracker:demo-v2';
    const DEFS = [
      { title: 'Aula de Cálculo II', source: 'calendar', container: 'Faculdade', days: [1, 3], time: [8, 0], minutes: 100, odds: 0.9, mean: 7 },
      { title: 'Aula de Contabilidade Tributária', source: 'calendar', container: 'Faculdade', days: [2, 4], time: [19, 0], minutes: 120, odds: 0.85, mean: 6 },
      { title: 'Academia', source: 'calendar', container: 'Pessoal', days: [1, 2, 3, 4, 5], time: [6, 30], minutes: 60, odds: 0.7, mean: 7 },
      { title: 'Reunião de estágio', source: 'calendar', container: 'Trabalho', days: [5], time: [14, 0], minutes: 45, odds: 0.95, mean: 8 },
      { title: 'Revisar anotações do dia', source: 'tasks', container: 'Minhas tarefas', days: [1, 2, 3, 4, 5], odds: 0.6, mean: 6 },
      { title: 'Ler 20 páginas', source: 'tasks', container: 'Minhas tarefas', days: [0, 1, 2, 3, 4, 5, 6], odds: 0.75, mean: 7 },
      { title: 'Planejar a semana', source: 'tasks', container: 'Minhas tarefas', days: [0], odds: 0.8, mean: 8 }
    ];

    function seed() {
      const t = today();
      const tk = toKey(t);
      let s = 11;
      const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const out = [];
      for (let i = -70; i <= 21; i++) {
        const d = addDays(t, i);
        const k = toKey(d);
        DEFS.forEach((def, idx) => {
          if (def.days.indexOf(d.getDay()) === -1) return;
          let start = null;
          let end = null;
          if (def.time) {
            const sd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), def.time[0], def.time[1]);
            start = sd.toISOString();
            end = new Date(sd.getTime() + def.minutes * 60000).toISOString();
          }
          const a = {
            id: 'demo-' + idx + '-' + k,
            source: def.source,
            external_id: 'demo:' + idx + ':' + k,
            series_key: def.source + ':' + norm(def.title),
            container_id: 'demo-' + def.container,
            container_name: def.container,
            title: def.title,
            description: null,
            location: null,
            day: k,
            start_at: start,
            end_at: end,
            all_day: !def.time,
            status: 'pending',
            rating: null,
            note: null,
            completed_at: null
          };
          const past = k < tk || (k === tk && end && new Date(end) < new Date() && rand() < 0.8);
          if (past && rand() < def.odds) {
            const trend = (i + 70) / 70; // melhora aos poucos ao longo do período
            const r = Math.round(def.mean - 1 + trend + (rand() - 0.5) * 4);
            a.status = 'done';
            a.rating = Math.min(10, Math.max(1, r));
            a.completed_at = (end || new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21).toISOString());
          }
          out.push(a);
        });
      }
      return { seededOn: tk, items: out };
    }

    function read() {
      try {
        const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (raw && Array.isArray(raw.items)) return raw;
      } catch (e) { /* recomeça */ }
      return null;
    }

    let db = read() || seed();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* sem armazenamento */ } };
    save();
    sortItems(db.items);
    const find = (id) => db.items.find((a) => a.id === id);

    return {
      mode: 'demo',
      user: { email: 'demonstracao@exemplo.com' },
      items: () => db.items,
      lastSyncedAt: () => null,
      hasGoogleToken: () => false,
      async init() {},
      async signIn() {},
      async signOut() {},
      async complete(id, rating, note) {
        const a = find(id);
        if (!a) return;
        Object.assign(a, { status: 'done', rating, note: note || null, completed_at: new Date().toISOString() });
        save();
      },
      async uncomplete(id) {
        const a = find(id);
        if (!a) return;
        Object.assign(a, { status: 'pending', rating: null, note: null, completed_at: null });
        save();
      },
      async sync() { return { demo: true, count: 0, removed: 0, warnings: [] }; },
      async reset() { db = seed(); sortItems(db.items); save(); },
      onAuthChange() {}
    };
  }

  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  HT.store = configured ? createSupabaseStore() : createDemoStore();
  HT.supabaseMissing = !!(cfg.supabaseUrl && cfg.supabaseAnonKey) && !configured;
})();
