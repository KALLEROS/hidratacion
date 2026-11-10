# Hidratación Estación

App para el iPhone que te recuerda tomar agua durante el día y lleva tu registro. Funciona sin internet.

**App:** https://kalleros.github.io/hidratacion/

<img src="qr-hidratacion.png" alt="QR para abrir la app" width="220">

| Pestaña | Para qué |
|---|---|
| **Hoy** | El garrafón se llena con lo que tomas. Cada raya es un vaso; lleno hasta los hombros es tu meta. Anota un vaso, un sorbo, una botella u otra cantidad. |
| **Horario** | Tus avisos del día y lo que respondiste en cada uno. Aquí cambias a qué hora empiezan, a qué hora terminan y cada cuánto llegan. |
| **Registro** | Racha, promedio diario, días con meta cumplida, cuántas veces ya habías tomado cuando llegó el aviso y un calendario del mes. |
| **Ajustes** | Meta diaria, tamaño de tu vaso, avisos, sonido y respaldo. |

## Instalarla en el iPhone

1. Abre https://kalleros.github.io/hidratacion/ en **Safari**.
2. Toca **Compartir** (cuadro con flecha) y luego **Agregar a inicio**.
3. Ábrela desde el ícono del garrafón. Ya instalada, abre aunque no haya señal.

Los datos se guardan solo en ese teléfono.

## Activar los avisos

Una app web en el iPhone solo recibe avisos con la app cerrada si alguien se los manda. Aquí los manda un **reloj en Cloudflare** (gratis) a los :00 y :30 de cada hora, a los teléfonos a los que les toca según su horario.

1. En la app instalada, ve a **Ajustes** y toca **Activar avisos**. Acepta el permiso.
2. Listo: la app manda sola tu horario al reloj. Si cambias el horario, lo vuelve a mandar en cuanto haya internet.
3. Para probar, toca **Mandar aviso de prueba** y sal de la app.

### Al tocar el aviso

- **iPhone:** se abre la app y pregunta **¿Ya habías tomado agua?**
  - **Sí, ya había tomado**: se guarda. Si no tenías nada anotado desde el aviso anterior, pregunta si anota un vaso.
  - **No, no había tomado**: se guarda y te pide tomar un vaso ahora; con **Listo, ya me lo tomé** lo anota.
- **Android:** el aviso trae los botones **Ya había tomado** y **No había tomado**. El primero se anota sin abrir la app.

Con la app abierta, a la hora del aviso suena una gota y sale la misma pregunta.

## Cómo funciona por dentro

| Archivo | Qué hace |
|---|---|
| `index.html` | La app. |
| `datos.js` | Guarda todo en el teléfono (IndexedDB). Lo comparten la app y el service worker. |
| `sw.js` | Guarda la app para usarla sin señal, muestra los avisos y anota la respuesta al tocarlos. |
| `cloudflare/worker.js` | El reloj de avisos. Guarda el horario de cada teléfono y le manda el aviso a su hora. |
| `cloudflare/wrangler.toml` | Configuración del reloj: corre a los :00 y :30 de cada hora. |
| `herramientas/iconos.mjs` | Dibuja los íconos. |
| `herramientas/servir.mjs` | Sirve la app en `http://localhost:5178` para probarla en la PC. |

### El reloj de avisos (Cloudflare)

Vive en https://hidratacion-avisos.kalleros.workers.dev y se publica desde la carpeta `cloudflare`:

```bash
cd cloudflare
npx wrangler deploy
```

| Secreto | Qué es |
|---|---|
| `VAPID_PUBLICA` | Llave pública de los avisos (también está en `index.html`). |
| `VAPID_PRIVADA` | Llave privada. Solo vive en Cloudflare y en `.secretos/vapid.json` de la PC, que no se sube. |

Se ponen con `npx wrangler secret put VAPID_PRIVADA`. Los teléfonos registrados se guardan en el KV `SUSCRIPCIONES`; si un teléfono deja de aceptar avisos, se borra solo.
