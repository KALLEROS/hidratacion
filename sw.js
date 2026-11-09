// Service worker de Hidratación Estación.
// 1) Guarda la app en el teléfono para que abra sin señal.
// 2) Muestra los avisos que manda GitHub (push) a las horas de tu horario.
// 3) Al tocar el aviso, anota si ya habías tomado agua o no.
importScripts('./datos.js');

var CACHE = 'hidratacion-v1';
var ARCHIVOS = ['./', './index.html', './datos.js', './manifest.webmanifest',
  './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Primero la copia guardada (abre al instante y sin señal) y, por detrás,
// baja la versión nueva para la próxima vez que abras la app.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  var esPagina = req.mode === 'navigate';
  var clave = esPagina ? './index.html' : req;

  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(clave, { ignoreSearch: esPagina }).then(function (guardada) {
      var deRed = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(clave, res.clone());
        return res;
      }).catch(function () { return guardada; });
      if (guardada) { e.waitUntil(deRed.catch(function () {})); return guardada; }
      return deRed;
    });
  }));
});

function fmt(n) { return new Intl.NumberFormat('es-MX').format(Math.round(n)); }

function textoAviso(a, d, prueba) {
  var total = HE.total(d);
  var meta = d.meta || a.meta;
  if (prueba) return { titulo: 'Aviso de prueba', cuerpo: 'Así te van a llegar los avisos. Toca para responder si ya habías tomado agua.' };
  if (total >= meta) return { titulo: 'Ya cumpliste tu meta de hoy', cuerpo: 'Llevas ' + fmt(total) + ' ml. Si tienes sed, toma más.' };
  if (total === 0) return { titulo: 'Hora de tomar agua', cuerpo: 'Hoy todavía no anotas agua. ¿Ya habías tomado? Toca para responder.' };
  return { titulo: 'Hora de tomar agua', cuerpo: 'Llevas ' + fmt(total) + ' de ' + fmt(meta) + ' ml. ¿Ya habías tomado? Toca para responder.' };
}

function mostrarAviso(info) {
  var fecha = info.fecha || HE.claveDia();
  var hora = info.hora || HE.aHora(new Date().getHours() * 60 + new Date().getMinutes());
  return Promise.all([HE.ajustes(), HE.dia(fecha)]).then(function (r) {
    return textoAviso(r[0], r[1], info.prueba);
  }).catch(function () {
    return { titulo: 'Hora de tomar agua', cuerpo: '¿Ya habías tomado? Toca para responder.' };
  }).then(function (t) {
    return self.registration.showNotification(t.titulo, {
      body: t.cuerpo,
      tag: 'aviso-' + fecha + '-' + hora,
      renotify: true,
      icon: './icon-192.png',
      badge: './icon-192.png',
      lang: 'es-MX',
      data: { fecha: fecha, hora: hora, prueba: !!info.prueba },
      // En Android salen como botones; en iPhone se toca el aviso y la app pregunta.
      actions: [
        { action: 'si', title: 'Ya había tomado' },
        { action: 'no', title: 'No había tomado' }
      ]
    });
  });
}

self.addEventListener('push', function (e) {
  var info = {};
  try { info = e.data ? e.data.json() : {}; } catch (err) { info = {}; }
  e.waitUntil(mostrarAviso(info));
});

// La app pide un aviso de prueba o uno a la hora exacta mientras está abierta.
self.addEventListener('message', function (e) {
  var m = e.data || {};
  if (m.tipo === 'mostrar-aviso') e.waitUntil(mostrarAviso(m));
});

function avisarApp(mensaje) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    lista.forEach(function (c) { c.postMessage(mensaje); });
    return lista;
  });
}

self.addEventListener('notificationclick', function (e) {
  var n = e.notification;
  var d = n.data || {};
  n.close();
  var fecha = d.fecha || HE.claveDia();
  var hora = d.hora || '';

  // Botón "Ya había tomado" (Android): se anota sin abrir la app.
  if (e.action === 'si' && hora) {
    e.waitUntil(HE.responderAviso(fecha, hora, 'si', { sumarSiNoHay: true })
      .then(function () { return avisarApp({ tipo: 'datos' }); }));
    return;
  }

  // "No había tomado" o tocar el aviso: abre la app en la pregunta.
  var paso = e.action === 'no' ? 'no' : '';
  var guardar = paso === 'no' && hora ? HE.responderAviso(fecha, hora, 'no') : Promise.resolve();
  var url = new URL('./?aviso=' + encodeURIComponent(hora) + '&fecha=' + fecha + (paso ? '&r=no' : ''), self.registration.scope).href;

  e.waitUntil(guardar.then(function () {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  }).then(function (lista) {
    for (var i = 0; i < lista.length; i++) {
      var c = lista[i];
      if ('focus' in c) {
        c.postMessage({ tipo: 'aviso', fecha: fecha, hora: hora, r: paso });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
