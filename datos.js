// Datos de Hidratación Estación: todo se guarda en el teléfono (IndexedDB).
// Lo usan la app (index.html) y el service worker (sw.js), para que al tocar
// "Ya había tomado" en un aviso se anote aunque la app esté cerrada.
(function (raiz) {
  'use strict';

  var DB = 'hidratacion-estacion';
  var STORE = 'kv';
  var dbp = null;

  var BASE = {
    meta: 2000,     // ml al día
    vaso: 250,      // ml por vaso
    desde: 8,       // hora del primer aviso
    hasta: 22,      // hora límite del último aviso
    cada: 90,       // minutos entre avisos (múltiplo de 30)
    sonido: true,
    sub: null,          // suscripción a avisos de este teléfono
    codigoHorario: ''   // horario que llevaba el último código copiado
  };

  function abrir() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { dbp = null; rej(r.error); };
    });
    return dbp;
  }

  function leer(k) {
    return abrir().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }

  function guardar(k, v) {
    return abrir().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(v, k);
        tx.oncomplete = function () { res(v); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  // Lee, cambia y guarda en una sola transacción, para que la app y el
  // service worker no se pisen si escriben al mismo tiempo.
  function modificar(k, inicial, fn) {
    return abrir().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        var out;
        var q = st.get(k);
        q.onsuccess = function () {
          var actual = q.result || inicial();
          out = fn(actual) || actual;
          st.put(out, k);
        };
        tx.oncomplete = function () { res(out); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  function todosConPrefijo(prefijo) {
    return abrir().then(function (db) {
      return new Promise(function (res, rej) {
        var out = [];
        var rango = IDBKeyRange.bound(prefijo, prefijo + '￿');
        var q = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(rango);
        q.onsuccess = function () {
          var c = q.result;
          if (c) { out.push(c.value); c.continue(); } else res(out);
        };
        q.onerror = function () { rej(q.error); };
      });
    });
  }

  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function claveDia(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate());
  }
  function aMinutos(hhmm) { var p = hhmm.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function aHora(min) { return dos(Math.floor(min / 60)) + ':' + dos(min % 60); }

  function limpiarAjustes(a) {
    var o = Object.assign({}, BASE, a || {});
    function num(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; }
    o.meta = num(o.meta, 500, 6000, BASE.meta);
    o.vaso = num(o.vaso, 50, 1500, BASE.vaso);
    o.desde = num(o.desde, 0, 23, BASE.desde);
    o.hasta = num(o.hasta, 1, 24, BASE.hasta);
    if (o.hasta <= o.desde) o.hasta = Math.min(24, o.desde + 1);
    o.cada = num(o.cada, 30, 240, BASE.cada);
    o.cada = Math.max(30, Math.round(o.cada / 30) * 30);
    o.sonido = o.sonido !== false;
    return o;
  }

  // Las horas de aviso del día, por ejemplo ["08:00", "09:30", ...].
  function horas(a) {
    var out = [];
    for (var m = a.desde * 60; m <= a.hasta * 60 && m < 24 * 60; m += a.cada) out.push(aHora(m));
    return out;
  }

  function diaVacio(fecha) { return function () { return { fecha: fecha, tomas: [], avisos: {}, meta: null }; }; }
  function total(dia) { return dia && dia.tomas ? dia.tomas.reduce(function (s, t) { return s + t.ml; }, 0) : 0; }

  function ajustes() { return leer('ajustes').then(limpiarAjustes); }
  function guardarAjustes(a) { return guardar('ajustes', limpiarAjustes(a)); }
  function dia(fecha) { return leer('dia:' + fecha).then(function (d) { return d || diaVacio(fecha)(); }); }
  function todosLosDias() { return todosConPrefijo('dia:'); }

  function agregarToma(ml, origen, cuando) {
    cuando = cuando || Date.now();
    var fecha = claveDia(new Date(cuando));
    return ajustes().then(function (a) {
      return modificar('dia:' + fecha, diaVacio(fecha), function (d) {
        d.tomas = (d.tomas || []).concat([{ t: cuando, ml: Math.round(ml), o: origen || 'app' }]);
        d.meta = a.meta;
        return d;
      });
    });
  }

  function quitarToma(fecha, t) {
    return modificar('dia:' + fecha, diaVacio(fecha), function (d) {
      d.tomas = (d.tomas || []).filter(function (x) { return x.t !== t; });
      return d;
    });
  }

  // Guarda si ya habías tomado ("si") o no ("no") cuando llegó el aviso de
  // esa hora. Con sumarSiNoHay, un "si" sin nada anotado desde el aviso
  // anterior anota un vaso (para el botón del aviso con la app cerrada).
  function responderAviso(fecha, hora, r, opciones) {
    opciones = opciones || {};
    return ajustes().then(function (a) {
      return modificar('dia:' + fecha, diaVacio(fecha), function (d) {
        d.avisos = d.avisos || {};
        d.avisos[hora] = { r: r, t: Date.now() };
        d.meta = d.meta || a.meta;
        if (r === 'si' && opciones.sumarSiNoHay) {
          var desde = Date.now() - a.cada * 60000;
          var hay = (d.tomas || []).some(function (x) { return x.t >= desde; });
          if (!hay) d.tomas = (d.tomas || []).concat([{ t: Date.now(), ml: a.vaso, o: 'aviso' }]);
        }
        return d;
      });
    });
  }

  function respaldo() {
    return Promise.all([ajustes(), todosLosDias()]).then(function (r) {
      var a = Object.assign({}, r[0]); delete a.sub;
      return { app: 'Hidratación Estación', version: 1, creado: new Date().toISOString(), ajustes: a, dias: r[1] };
    });
  }

  raiz.HE = {
    BASE: BASE,
    claveDia: claveDia, aMinutos: aMinutos, aHora: aHora,
    limpiarAjustes: limpiarAjustes, horas: horas, total: total,
    ajustes: ajustes, guardarAjustes: guardarAjustes,
    dia: dia, todosLosDias: todosLosDias,
    agregarToma: agregarToma, quitarToma: quitarToma, responderAviso: responderAviso,
    respaldo: respaldo
  };
})(typeof self !== 'undefined' ? self : this);
