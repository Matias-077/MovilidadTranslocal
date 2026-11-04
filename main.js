/* ==========================================================
   Movilidad Translocal Soacha — Lógica del directorio
   Los datos se leen del archivo sql.json (no hay backend).
   ========================================================== */
(() => {
  'use strict';

  const ZONA_HORARIA = 'America/Bogota';

  const ESTADOS = {
    habilitado: 'Habilitado',
    contingencia: 'Paso en contingencia',
    restringido: 'Restringido'
  };

  const SERVICIOS = {
    Salud: '🏥',
    Educación: '🎓',
    Trabajo: '💼',
    Mercado: '🛒'
  };

  // Íconos SVG estáticos (contenido propio, no proviene del JSON)
  const ICONOS = {
    pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    route: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h7a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>'
  };

  const state = {
    municipio: 'todos',
    vereda: 'todas',
    estado: 'todos',
    servicio: 'todos',
    texto: '',
    orden: 'proxima'
  };

  let meta = {};
  let rutas = [];

  const $ = (sel) => document.querySelector(sel);
  const grid = $('#routesGrid');

  /* ---------- Utilidades ---------- */

  // Crea elementos de forma segura (textContent, sin innerHTML con datos del JSON)
  function h(tag, props = {}, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of hijos.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(c));
    }
    return el;
  }

  function icono(nombre, clase) {
    const span = h('span', { class: clase, 'aria-hidden': 'true' });
    span.innerHTML = ICONOS[nombre]; // constante interna
    return span;
  }

  // Normaliza texto: minúsculas y sin tildes ("Chusacá" == "chusaca")
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Deja solo dígitos (y '+' inicial) para el enlace tel:
  const telLimpio = (t) => String(t ?? '').replace(/[^\d+]/g, '');
  // 3102415396 -> 310 241 5396
  const telVisible = (t) => /^\d{10}$/.test(String(t)) ? String(t).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : String(t);

  const moneda = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

  /* ---------- Horarios ---------- */

  const aMinutos = (hhmm) => {
    const [hh, mm] = String(hhmm).split(':').map(Number);
    return hh * 60 + (mm || 0);
  };

  function formatoHora(min) {
    const h24 = Math.floor(min / 60) % 24;
    const mm = String(min % 60).padStart(2, '0');
    const sufijo = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return { h12, mm, sufijo, texto: `${h12}:${mm} ${sufijo}` };
  }

  // Hora actual en Bogotá (minutos desde la medianoche)
  function minutosAhora() {
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const hh = Number(partes.find(p => p.type === 'hour').value) % 24;
    const mm = Number(partes.find(p => p.type === 'minute').value);
    return hh * 60 + mm;
  }

  function salidasDelDia(r) {
    if (Array.isArray(r.salidasFijas) && r.salidasFijas.length) {
      return r.salidasFijas.map(aMinutos).sort((a, b) => a - b);
    }
    if (r.primeraSalida && r.ultimaSalida && r.cadaMin > 0) {
      const lista = [];
      for (let m = aMinutos(r.primeraSalida); m <= aMinutos(r.ultimaSalida); m += r.cadaMin) lista.push(m);
      return lista;
    }
    return [];
  }

  function proximaSalida(r, ahora) {
    const lista = salidasDelDia(r);
    const siguiente = lista.find(m => m >= ahora);
    return { lista, siguiente, primera: lista[0] };
  }

  function textoEspera(min) {
    if (min <= 0) return 'Sale ahora';
    if (min < 60) return `En ${min} min`;
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    return mm ? `En ${hh} h ${mm} min` : `En ${hh} h`;
  }

  function resumenHorario(r) {
    if (Array.isArray(r.salidasFijas) && r.salidasFijas.length) {
      return `${r.salidasFijas.length} salidas fijas al día`;
    }
    if (r.primeraSalida && r.ultimaSalida) {
      return `${formatoHora(aMinutos(r.primeraSalida)).texto} – ${formatoHora(aMinutos(r.ultimaSalida)).texto} · cada ${r.cadaMin} min`;
    }
    return 'Consultar con la empresa';
  }

  /* ---------- Carga de datos ---------- */

  async function cargar() {
    try {
      const resp = await fetch('sql.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const datos = await resp.json();
      meta = datos.meta || {};
      rutas = Array.isArray(datos) ? datos : (datos.rutas || []);
      iniciar();
    } catch (err) {
      console.error('Error al cargar sql.json:', err);
      grid.replaceChildren(
        h('div', { class: 'error', role: 'alert' },
          h('h3', { text: 'No se pudo cargar el directorio' }),
          h('p', {}, 'Abre el proyecto desde un servidor local (por ejemplo con ',
            h('code', { text: 'python -m http.server' }), ' o la extensión Live Server) y verifica que ',
            h('code', { text: 'sql.json' }), ' esté en la misma carpeta.'))
      );
    }
  }

  function iniciar() {
    pintarPanelEstado();
    pintarPestanas();
    pintarVeredas();
    pintarChipsEstado();
    pintarChipsServicio();
    pintarEmergencias();
    $('#footerAviso').textContent = meta.aviso || '';
    aplicarFiltros(true);
    relojVivo();
    setInterval(relojVivo, 30000);
    setInterval(() => aplicarFiltros(false), 60000); // refresca "próxima salida"
  }

  /* ---------- Panel de estado ---------- */

  function pintarPanelEstado() {
    const conteo = { habilitado: 0, contingencia: 0, restringido: 0 };
    rutas.forEach(r => { if (r.estado in conteo) conteo[r.estado]++; });
    const total = rutas.length || 1;

    $('#statTotal').textContent = rutas.length;
    $('#statOk').textContent = conteo.habilitado;
    $('#statWarn').textContent = conteo.contingencia;
    $('#statBad').textContent = conteo.restringido;

    const meter = $('#meter');
    meter.replaceChildren(
      ...[['m-ok', conteo.habilitado], ['m-warn', conteo.contingencia], ['m-bad', conteo.restringido]]
        .map(([clase, n]) => h('span', { class: clase, style: `width:${(n / total) * 100}%` }))
    );

    const fecha = meta.actualizado ? new Date(meta.actualizado) : null;
    $('#statUpdated').textContent = fecha && !isNaN(fecha)
      ? new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_HORARIA, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(fecha)
      : 'Sin fecha registrada';
  }

  function relojVivo() {
    $('#liveClock').textContent = new Intl.DateTimeFormat('es-CO', {
      timeZone: ZONA_HORARIA, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit'
    }).format(new Date());
  }

  /* ---------- Controles ---------- */

  function municipios() {
    return [...new Set(rutas.map(r => r.municipio))].sort((a, b) => a.localeCompare(b, 'es'));
  }

  function pintarPestanas() {
    const cont = $('#tabs');
    const items = [{ clave: 'todos', texto: 'Todas las rutas', n: rutas.length }]
      .concat(municipios().map(m => ({ clave: m, texto: m, n: rutas.filter(r => r.municipio === m).length })));

    cont.replaceChildren(...items.map(it =>
      h('button', {
        class: 'tab', role: 'tab', type: 'button', id: `tab-${norm(it.clave).replace(/\W+/g, '-')}`,
        'data-clave': it.clave, 'aria-selected': String(state.municipio === it.clave),
        tabindex: state.municipio === it.clave ? '0' : '-1'
      }, it.texto, h('span', { class: 'tab-count', text: it.n }))
    ));

    cont.onclick = (e) => {
      const btn = e.target.closest('.tab');
      if (btn) seleccionarPestana(btn);
    };
    cont.onkeydown = (e) => {
      const tabs = [...cont.querySelectorAll('.tab')];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j !== null) { e.preventDefault(); tabs[j].focus(); seleccionarPestana(tabs[j]); }
    };
  }

  function seleccionarPestana(btn) {
    state.municipio = btn.dataset.clave;
    state.vereda = 'todas';
    document.querySelectorAll('.tab').forEach(t => {
      const activa = t === btn;
      t.setAttribute('aria-selected', String(activa));
      t.tabIndex = activa ? 0 : -1;
    });
    $('#resultados').setAttribute('aria-labelledby', btn.id);
    btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    pintarVeredas();
    aplicarFiltros(true);
  }

  function pintarVeredas() {
    const sel = $('#veredaSelect');
    const delMunicipio = rutas.filter(r => state.municipio === 'todos' || r.municipio === state.municipio);
    const veredas = [...new Set(delMunicipio.map(r => r.vereda))].sort((a, b) => a.localeCompare(b, 'es'));

    sel.replaceChildren(
      h('option', { value: 'todas', text: 'Todas las veredas / sectores' }),
      ...veredas.map(v => h('option', { value: v, text: v }))
    );
    sel.value = state.vereda;
    sel.onchange = () => { state.vereda = sel.value; aplicarFiltros(true); };
  }

  function pintarChipsEstado() {
    const cont = $('#estadoChips');
    const opciones = [['todos', 'Todos'], ...Object.entries(ESTADOS)];
    cont.replaceChildren(...opciones.map(([clave, texto]) =>
      h('button', {
        type: 'button', 'data-estado': clave, 'aria-pressed': String(state.estado === clave),
        onclick: () => { state.estado = clave; actualizarPresionados(); aplicarFiltros(true); }
      }, clave !== 'todos' && h('i', { class: `dot dot-${clave}` }), texto)
    ));
  }

  function pintarChipsServicio() {
    const cont = $('#quickChips');
    const presentes = new Set(rutas.flatMap(r => r.servicios || []));
    cont.replaceChildren(...[...presentes].map(s =>
      h('button', {
        class: 'chip', type: 'button', 'data-servicio': s, 'aria-pressed': String(state.servicio === s),
        onclick: () => { state.servicio = state.servicio === s ? 'todos' : s; actualizarPresionados(); aplicarFiltros(true); }
      }, `${SERVICIOS[s] || '📍'} ${s}`)
    ));
  }

  function actualizarPresionados() {
    document.querySelectorAll('#estadoChips button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.estado === state.estado)));
    document.querySelectorAll('#quickChips .chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.servicio === state.servicio)));
  }

  $('#searchInput').addEventListener('input', (e) => { state.texto = e.target.value; aplicarFiltros(true); });
  $('#ordenSelect').addEventListener('change', (e) => { state.orden = e.target.value; aplicarFiltros(true); });
  $('#clearFilters').addEventListener('click', () => {
    Object.assign(state, { municipio: 'todos', vereda: 'todas', estado: 'todos', servicio: 'todos', texto: '', orden: 'proxima' });
    $('#searchInput').value = '';
    $('#ordenSelect').value = 'proxima';
    pintarPestanas();
    pintarVeredas();
    actualizarPresionados();
    $('#resultados').setAttribute('aria-labelledby', 'tab-todos');
    aplicarFiltros(true);
  });

  /* ---------- Filtrado y orden ---------- */

  function aplicarFiltros(animar) {
    const q = norm(state.texto).trim();
    const ahora = minutosAhora();

    let lista = rutas.filter(r => {
      if (state.municipio !== 'todos' && r.municipio !== state.municipio) return false;
      if (state.vereda !== 'todas' && r.vereda !== state.vereda) return false;
      if (state.estado !== 'todos' && r.estado !== state.estado) return false;
      if (state.servicio !== 'todos' && !(r.servicios || []).includes(state.servicio)) return false;
      if (!q) return true;
      const pajar = norm([r.id, r.nombre, r.municipio, r.vereda, r.origen, r.destino, r.puntoEncuentro,
        r.empresa, r.novedades, ...(r.servicios || [])].join(' '));
      return q.split(/\s+/).every(palabra => pajar.includes(palabra));
    });

    lista.sort((a, b) => {
      if (state.orden === 'nombre') return a.nombre.localeCompare(b.nombre, 'es');
      if (state.orden === 'tarifa') return (a.tarifa ?? Infinity) - (b.tarifa ?? Infinity);
      const sa = proximaSalida(a, ahora).siguiente;
      const sb = proximaSalida(b, ahora).siguiente;
      if (sa === undefined && sb === undefined) return a.nombre.localeCompare(b.nombre, 'es');
      if (sa === undefined) return 1;
      if (sb === undefined) return -1;
      return sa - sb;
    });

    pintarTarjetas(lista, ahora, animar);
  }

  /* ---------- Tarjetas ---------- */

  function dato(nombreIcono, titulo, contenido) {
    return h('div', { class: 'fact' },
      icono(nombreIcono, 'fact-ico'),
      h('div', {}, h('dt', { text: titulo }), h('dd', {}, contenido)));
  }

  function tarjeta(r, ahora) {
    const estado = ESTADOS[r.estado] ? r.estado : 'habilitado';
    const { lista, siguiente, primera } = proximaSalida(r, ahora);

    // Bloque de próxima salida
    let bloque;
    if (siguiente !== undefined) {
      const hora = formatoHora(siguiente);
      bloque = h('div', { class: 'depart' },
        h('div', {},
          h('span', { class: 'depart-label', text: 'Próxima salida' }),
          h('span', { class: 'depart-time' }, `${hora.h12}:${hora.mm}`, h('small', { text: hora.sufijo }))),
        h('span', { class: 'eta', text: textoEspera(siguiente - ahora) }));
    } else if (primera !== undefined) {
      const hora = formatoHora(primera);
      bloque = h('div', { class: 'depart' },
        h('div', {},
          h('span', { class: 'depart-label', text: 'Servicio de hoy finalizado' }),
          h('span', { class: 'depart-time' }, `${hora.h12}:${hora.mm}`, h('small', { text: hora.sufijo }))),
        h('span', { class: 'eta off', text: 'Primera salida mañana' }));
    } else {
      bloque = h('div', { class: 'depart' },
        h('div', {}, h('span', { class: 'depart-label', text: 'Horario' }), h('span', { class: 'depart-time', text: '—' })),
        h('span', { class: 'eta off', text: 'Consultar con la empresa' }));
    }

    // Horas fijas visibles como chips
    const fijas = Array.isArray(r.salidasFijas) && r.salidasFijas.length;
    const chips = fijas
      ? h('div', { class: 'times', 'aria-label': 'Salidas del día' },
          lista.map(m => h('span', {
            class: `time-chip${m === siguiente ? ' next' : m < ahora ? ' past' : ''}`,
            text: formatoHora(m).texto
          })))
      : null;

    const compartir = encodeURIComponent(
      `🚌 Ruta ${r.id}: ${r.nombre}\n📍 Punto de encuentro: ${r.puntoEncuentro}\n🕒 ${resumenHorario(r)}\n💵 ${r.tarifa != null ? moneda.format(r.tarifa) : 'Tarifa por confirmar'}\n⚠️ ${ESTADOS[estado]}${r.novedades ? ' — ' + r.novedades : ''}`
    );

    const id = `ruta-${r.id}`;
    return h('article', { class: `card estado-${estado}`, 'aria-labelledby': id },
      h('div', { class: 'card-top' },
        h('span', { class: 'route-id', text: r.id }),
        r.tipo === 'desvio' && h('span', { class: 'pill pill-desvio', text: 'Desvío a Bogotá' }),
        r.tipo === 'intermunicipal' && h('span', { class: 'pill', text: 'Intermunicipal' }),
        r.tipo === 'interveredal' && h('span', { class: 'pill', text: 'Interveredal' }),
        h('span', { class: `status status-${estado}` }, h('i', { class: 'dot' }), ESTADOS[estado])),
      h('h3', { class: 'card-title', id, text: r.nombre }),
      h('p', { class: 'card-sub', text: `${r.municipio} · ${r.vereda}` }),
      bloque,
      chips,
      h('dl', { class: 'facts' },
        dato('pin', 'Punto de encuentro', r.puntoEncuentro),
        dato('route', 'Trayecto', `${r.origen} → ${r.destino}`),
        dato('clock', 'Horario de servicio', resumenHorario(r))),
      (r.servicios && r.servicios.length)
        ? h('div', { class: 'tags', 'aria-label': 'Sirve para' },
            r.servicios.map(s => h('span', { class: 'tag', text: `${SERVICIOS[s] || '📍'} ${s}` })))
        : null,
      r.novedades
        ? h('div', { class: 'news' }, icono('alert'), h('div', {}, h('strong', { text: 'Novedades de la vía' }), r.novedades))
        : null,
      h('div', { class: 'card-foot' },
        h('div', { class: 'company' }, 'Empresa', h('strong', { text: r.empresa || 'Por confirmar' })),
        h('span', { class: 'fare', text: r.tarifa != null ? moneda.format(r.tarifa) : '—' }),
        h('div', { class: 'card-actions' },
          r.telefono && h('a', { class: 'btn-call', href: `tel:${telLimpio(r.telefono)}`, 'aria-label': `Llamar a ${r.empresa || 'la empresa'} al ${telVisible(r.telefono)}` },
            icono('phone'), 'Llamar'),
          h('a', { class: 'btn-share', href: `https://wa.me/?text=${compartir}`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Compartir ruta ${r.id} por WhatsApp` },
            icono('share'), 'Compartir')))
    );
  }

  function pintarTarjetas(lista, ahora, animar) {
    grid.classList.toggle('animate', !!animar);

    $('#resultsCount').textContent = lista.length === rutas.length
      ? `${rutas.length} rutas registradas`
      : `Mostrando ${lista.length} de ${rutas.length} rutas`;

    if (lista.length === 0) {
      grid.replaceChildren(
        h('div', { class: 'empty' },
          h('h3', { text: 'No encontramos rutas con esos criterios' }),
          h('p', { text: 'Prueba con otra vereda, quita algún filtro o busca con menos palabras.' }))
      );
      return;
    }

    grid.replaceChildren(...lista.map(r => tarjeta(r, ahora)));
  }

  /* ---------- Emergencias ---------- */

  function pintarEmergencias() {
    const dialog = $('#emergencyDialog');
    const contactos = meta.emergencias || [];

    $('#contactList').replaceChildren(...contactos.map(c => {
      const visible = telVisible(c.telefono);
      return h('li', {},
        h('a', { class: 'contact', href: `tel:${telLimpio(c.telefono)}`, 'aria-label': `Llamar a ${c.nombre}, número ${visible}` },
          icono('phone', 'contact-ico'),
          h('div', { class: 'contact-info' }, h('strong', { text: c.nombre }), h('small', { text: c.detalle || '' })),
          h('span', { class: 'contact-call' }, h('span', { class: 'contact-num', text: visible }), h('small', { text: 'Toca para llamar' }))));
    }));

    $('#openEmergency').addEventListener('click', () => {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
    $('#closeEmergency').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  /* ---------- Tema claro / oscuro ---------- */

  function iniciarTema() {
    const raiz = document.documentElement;
    const boton = $('#themeToggle');
    const metaColor = document.querySelector('meta[name="theme-color"]');
    const COLORES = { dark: '#080e1c', light: '#f4f6fb' };
    const guardado = () => { try { return localStorage.getItem('theme'); } catch { return null; } };

    function aplicar(tema, animar) {
      if (animar) {
        raiz.classList.add('theme-anim');
        setTimeout(() => raiz.classList.remove('theme-anim'), 450);
      }
      raiz.setAttribute('data-theme', tema);
      boton.setAttribute('aria-checked', String(tema === 'dark'));
      boton.setAttribute('aria-label', tema === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
      if (metaColor) metaColor.setAttribute('content', COLORES[tema]);
    }

    aplicar(raiz.getAttribute('data-theme') === 'light' ? 'light' : 'dark', false);

    boton.addEventListener('click', () => {
      const nuevo = raiz.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      aplicar(nuevo, true);
      try { localStorage.setItem('theme', nuevo); } catch { /* modo privado: no se guarda */ }
    });

    // Si la persona nunca eligió, seguir el cambio del sistema
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const alCambiar = (e) => { if (!guardado()) aplicar(e.matches ? 'light' : 'dark', true); };
    if (mq.addEventListener) mq.addEventListener('change', alCambiar);
  }

  iniciarTema();
  cargar();
})();