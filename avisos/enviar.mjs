// Manda el aviso de agua a tu teléfono cuando toca según tu horario.
// Lo corre GitHub Actions cada 30 minutos (.github/workflows/avisos.yml).
//
// Secretos que necesita (Settings > Secrets and variables > Actions):
//   VAPID_PUBLICA, VAPID_PRIVADA  las llaves de los avisos
//   AVISOS_CODIGO                 el código que copias en la app (Ajustes)
//
// Para probar sin mandar nada:
//   AVISOS_CODIGO=HE1.... node enviar.mjs --simular --ahora=2026-11-08T16:02:00Z
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const SUJETO = 'https://kalleros.github.io/hidratacion-estacion/';
const TOLERANCIA_MIN = 50; // si GitHub se atrasa, todavía manda el aviso hasta 50 min tarde
const ESTADO = new URL('./estado.json', import.meta.url);

const args = process.argv.slice(2);
const simular = args.includes('--simular');
const ahoraArg = (args.find(a => a.startsWith('--ahora=')) || '').slice(8);
const prueba = process.env.PRUEBA === 'true';

function salida(clave, valor) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${clave}=${valor}\n`);
}

function leerCodigo(txt) {
  const limpio = txt.trim().replace(/^HE1\./, '').replace(/\s+/g, '');
  const json = Buffer.from(limpio.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const c = JSON.parse(json);
  if (!c.sub || !c.sub.endpoint || !c.sub.keys) throw new Error('Al código le falta la suscripción del teléfono.');
  if (!Array.isArray(c.horas)) throw new Error('Al código le falta el horario.');
  return { sub: c.sub, tz: c.tz || 'America/Mexico_City', horas: c.horas };
}

function horaLocal(fecha, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(fecha).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: (+p.hour) * 60 + (+p.minute), texto: `${p.hour}:${p.minute}` };
}

const aMin = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };

function leerEstado() {
  try { return JSON.parse(readFileSync(ESTADO, 'utf8')); } catch { return {}; }
}
function guardarEstado(e) {
  writeFileSync(ESTADO, JSON.stringify(e, null, 2));
  salida('cambio', 'true');
}

const codigo = process.env.AVISOS_CODIGO || '';
if (!codigo.trim()) {
  console.log('Todavía no hay AVISOS_CODIGO. Cópialo en la app (Ajustes) y pégalo como secreto en GitHub.');
  process.exit(0);
}

let cfg;
try { cfg = leerCodigo(codigo); }
catch (e) {
  console.error('El AVISOS_CODIGO no se pudo leer:', e.message, 'Cópialo otra vez desde la app.');
  process.exit(1);
}

const ahora = ahoraArg ? new Date(ahoraArg) : new Date();
const local = horaLocal(ahora, cfg.tz);
const estado = leerEstado();

let hora, clave;
if (prueba) {
  hora = local.texto;
  clave = null;
  console.log(`Aviso de prueba a las ${hora} (${cfg.tz}).`);
} else {
  const tocan = cfg.horas
    .map(h => ({ h, m: aMin(h) }))
    .filter(x => x.m <= local.minutos && local.minutos - x.m <= TOLERANCIA_MIN)
    .sort((a, b) => b.m - a.m);
  if (!tocan.length) {
    console.log(`Son las ${local.texto} en ${cfg.tz}: no toca aviso.`);
    process.exit(0);
  }
  hora = tocan[0].h;
  clave = `${local.fecha} ${hora}`;
  if (estado.ultimo && estado.ultimo >= clave) {
    console.log(`El aviso de las ${hora} ya se mandó.`);
    process.exit(0);
  }
}

const datos = JSON.stringify({ hora, fecha: local.fecha, prueba });

if (simular) {
  console.log('Simulación, no se manda nada:', datos);
  if (clave) console.log('Se guardaría como último aviso:', clave);
  process.exit(0);
}

const llavePublica = process.env.VAPID_PUBLICA, llavePrivada = process.env.VAPID_PRIVADA;
if (!llavePublica || !llavePrivada) {
  console.error('Faltan los secretos VAPID_PUBLICA y VAPID_PRIVADA en GitHub.');
  process.exit(1);
}

const { default: webpush } = await import('web-push');
webpush.setVapidDetails(SUJETO, llavePublica, llavePrivada);

try {
  await webpush.sendNotification(cfg.sub, datos, { TTL: 1800, urgency: 'high' });
  console.log(`Aviso de las ${hora} enviado.`);
  if (clave) { estado.ultimo = clave; estado.vencido = false; guardarEstado(estado); }
} catch (e) {
  if (e.statusCode === 404 || e.statusCode === 410) {
    console.error('El teléfono ya no acepta avisos con este código. En la app ve a Ajustes, activa los avisos y copia un código nuevo.');
    // Falla una sola vez (GitHub te manda un correo) y luego se queda callado.
    if (!estado.vencido) { estado.vencido = true; guardarEstado(estado); process.exit(1); }
    process.exit(0);
  }
  console.error('No se pudo mandar el aviso:', e.statusCode || '', e.body || e.message);
  process.exit(1);
}
