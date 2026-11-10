// Reloj de avisos de Hidratación Estación (Cloudflare Worker).
//
// - La app manda aquí la dirección del teléfono y su horario (POST /registrar).
// - Cloudflare corre este worker a los :00 y :30 de cada hora y manda el aviso
//   a cada teléfono al que le toca a esa hora, según su zona horaria.
//
// Secretos (wrangler secret put): VAPID_PUBLICA, VAPID_PRIVADA
// KV: SUSCRIPCIONES  (una entrada por teléfono)

const SUJETO = 'https://kalleros.github.io/hidratacion/';
const ORIGENES = ['https://kalleros.github.io', 'http://localhost:5178', 'http://127.0.0.1:5178'];
// Solo se aceptan direcciones de los servicios de avisos de Apple, Google, Mozilla y Microsoft.
const SERVICIOS = [/^https:\/\/web\.push\.apple\.com\//, /^https:\/\/fcm\.googleapis\.com\//,
  /^https:\/\/updates\.push\.services\.mozilla\.com\//, /^https:\/\/[a-z0-9.-]+\.notify\.windows\.com\//];
const MAX_TELEFONOS = 50;

export default {
  async fetch(req, env) {
    const origen = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : ORIGENES[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const responder = (cuerpo, estado = 200) =>
      new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ruta = new URL(req.url).pathname;
    if (req.method === 'GET' && ruta === '/') return responder({ ok: true, servicio: 'avisos de Hidratación Estación' });
    if (req.method !== 'POST') return responder({ error: 'Usa POST.' }, 405);

    let d;
    try { d = await req.json(); } catch { return responder({ error: 'Datos no válidos.' }, 400); }
    const endpoint = d && (d.endpoint || (d.sub && d.sub.endpoint));
    if (typeof endpoint !== 'string' || !SERVICIOS.some(r => r.test(endpoint))) return responder({ error: 'Dirección de avisos no válida.' }, 400);
    const clave = 's:' + await sha256(endpoint);

    if (ruta === '/registrar') {
      const sub = d.sub, tz = d.tz, horas = d.horas;
      if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return responder({ error: 'Faltan las llaves del teléfono.' }, 400);
      if (typeof tz !== 'string' || !zonaValida(tz)) return responder({ error: 'Zona horaria no válida.' }, 400);
      if (!Array.isArray(horas) || horas.length > 48 || !horas.every(h => /^\d\d:\d\d$/.test(h))) return responder({ error: 'Horario no válido.' }, 400);
      if (!(await env.SUSCRIPCIONES.get(clave))) {
        const hay = await env.SUSCRIPCIONES.list({ prefix: 's:', limit: MAX_TELEFONOS });
        if (hay.keys.length >= MAX_TELEFONOS) return responder({ error: 'No hay lugar para más teléfonos.' }, 503);
      }
      const registro = { sub: { endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, tz, horas, desde: Date.now() };
      await env.SUSCRIPCIONES.put(clave, JSON.stringify(registro));
      return responder({ ok: true, horas });
    }

    if (ruta === '/baja') {
      await env.SUSCRIPCIONES.delete(clave);
      return responder({ ok: true });
    }

    if (ruta === '/probar') {
      const txt = await env.SUSCRIPCIONES.get(clave);
      if (!txt) return responder({ error: 'Este teléfono no está registrado.' }, 404);
      const r = JSON.parse(txt);
      const local = horaLocal(new Date(), r.tz);
      const res = await mandar(env, r.sub, { hora: local.texto, fecha: local.fecha, prueba: true });
      if (res.status === 404 || res.status === 410) { await env.SUSCRIPCIONES.delete(clave); return responder({ error: 'El teléfono ya no acepta avisos. Actívalos otra vez.' }, 410); }
      if (!res.ok) return responder({ error: 'El servicio de avisos respondió ' + res.status + '.' }, 502);
      return responder({ ok: true });
    }

    return responder({ error: 'No existe.' }, 404);
  },

  async scheduled(evento, env, ctx) {
    const cuando = new Date(evento.scheduledTime);
    let cursor;
    do {
      const pag = await env.SUSCRIPCIONES.list({ prefix: 's:', cursor });
      for (const k of pag.keys) {
        const txt = await env.SUSCRIPCIONES.get(k.name);
        if (!txt) continue;
        const r = JSON.parse(txt);
        const local = horaLocal(cuando, r.tz);
        if (!r.horas.includes(local.texto)) continue;
        try {
          const res = await mandar(env, r.sub, { hora: local.texto, fecha: local.fecha, prueba: false });
          if (res.status === 404 || res.status === 410) await env.SUSCRIPCIONES.delete(k.name);
          console.log(`Aviso ${local.fecha} ${local.texto} (${r.tz}): ${res.status}`);
        } catch (e) {
          console.log('No se pudo mandar:', e.message);
        }
      }
      cursor = pag.list_complete ? null : pag.cursor;
    } while (cursor);
  },
};

/* ---------- utilidades ---------- */

function zonaValida(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

export function horaLocal(fecha, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, texto: `${p.hour}:${p.minute}` };
}

async function sha256(txt) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();
function b64u(bytes) {
  let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deB64u(txt) {
  const s = atob(txt.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - txt.length % 4) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function unir(...partes) {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0; for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}
async function hkdf(sal, ikm, info, largo) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, k, largo * 8));
}

// Firma VAPID (JWT ES256).
export async function encabezadoVapid(endpoint, publica, privada) {
  const pub = deB64u(publica);
  const llave = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: privada, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cab = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUJETO })));
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, llave, enc.encode(cab + '.' + cuerpo));
  return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${publica}`;
}

// Cifrado del contenido del aviso (RFC 8291, aes128gcm).
export async function cifrar(sub, texto) {
  const uaPub = deB64u(sub.keys.p256dh), auth = deB64u(sub.keys.auth);
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const uaLlave = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaLlave }, par.privateKey, 256));
  const ikm = await hkdf(auth, compartido, unir(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const llave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, llave, unir(enc.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return unir(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

async function mandar(env, sub, datos) {
  const cuerpo = await cifrar(sub, JSON.stringify(datos));
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await encabezadoVapid(sub.endpoint, env.VAPID_PUBLICA, env.VAPID_PRIVADA),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '1800',
      Urgency: 'high',
    },
    body: cuerpo,
  });
}
