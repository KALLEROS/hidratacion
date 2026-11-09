# Hidratación Estación

App para el iPhone que te recuerda tomar agua durante el día y lleva tu registro. Funciona sin internet.

**App:** https://kalleros.github.io/hidratacion-estacion/

| Pestaña | Para qué |
|---|---|
| **Hoy** | El garrafón se llena con lo que tomas. Cada raya es un vaso; lleno hasta los hombros es tu meta. Anota un vaso, un sorbo, una botella u otra cantidad. |
| **Horario** | Tus avisos del día y lo que respondiste en cada uno. Aquí cambias a qué hora empiezan, a qué hora terminan y cada cuánto llegan. |
| **Registro** | Racha, promedio diario, días con meta cumplida, cuántas veces ya habías tomado cuando llegó el aviso y un calendario del mes. |
| **Ajustes** | Meta diaria, tamaño de tu vaso, avisos, sonido y respaldo. |

## Instalarla en el iPhone

1. Abre https://kalleros.github.io/hidratacion-estacion/ en **Safari**.
2. Toca **Compartir** (cuadro con flecha) y luego **Agregar a inicio**.
3. Ábrela desde el ícono del garrafón. Ya instalada, abre aunque no haya señal.

Los datos se guardan solo en ese teléfono.

## Activar los avisos

Una app web en el iPhone solo puede recibir avisos con la app cerrada si alguien se los manda. Aquí los manda **GitHub Actions** cada 30 minutos, según tu horario, gratis.

1. En la app instalada, ve a **Ajustes** y toca **Activar avisos**. Acepta el permiso.
2. Toca **Copiar código**.
3. Toca **Abrir GitHub**: en *Settings > Secrets and variables > Actions*, crea (o edita) el secreto **`AVISOS_CODIGO`** y pega el código.
4. Prueba: **Probar aquí** muestra uno desde el teléfono; **Probar desde GitHub** abre *Actions > Avisos de agua > Run workflow* para que GitHub te mande uno.

Si cambias el horario, la app te avisa: copia el código otra vez y reemplaza `AVISOS_CODIGO`.

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
| `avisos/enviar.mjs` | Lo corre GitHub: revisa tu horario y manda el aviso que toca. |
| `.github/workflows/avisos.yml` | Corre `enviar.mjs` cada 30 minutos (a los :02 y :32). |
| `.github/workflows/mantener.yml` | GitHub apaga los horarios de un repo sin cambios en 60 días; esto los vuelve a encender cada 2 semanas. |
| `herramientas/iconos.mjs` | Dibuja los íconos. |
| `herramientas/servir.mjs` | Sirve la app en `http://localhost:5178` para probarla en la PC. |

### Secretos de GitHub

| Secreto | Qué es |
|---|---|
| `VAPID_PUBLICA` | Llave pública de los avisos (también está en `index.html`). |
| `VAPID_PRIVADA` | Llave privada. Solo vive en GitHub y en `.secretos/vapid.json` de la PC, que no se sube. |
| `AVISOS_CODIGO` | Tu horario y la dirección de tu teléfono, copiado desde la app. |

GitHub a veces atrasa los horarios automáticos unos minutos; el aviso se manda aunque llegue hasta 50 minutos tarde y nunca se repite.

### Probar el envío sin mandar nada

```bash
cd avisos
AVISOS_CODIGO="HE1...." node enviar.mjs --simular --ahora=2026-11-08T16:02:00Z
```
