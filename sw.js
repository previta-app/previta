/* PREVITA – Service Worker
 * - Funciona offline (guarda o app no aparelho)
 * - Sempre busca a versão nova quando há internet
 * - Mostra as notificações de remédio e consulta
 * Ao publicar uma nova versão, aumente o número abaixo.
 */
const VERSAO = 'previta-v5';
const ARQUIVOS = ['./index.html', './manifest.json', './icon.png', './previta-icon.svg'];
const EXTERNOS_OK = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== VERSAO; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return; // IA, contador etc. vão direto para a rede
  const url = new URL(req.url);

  // Página do app: rede primeiro (versão nova), cópia guardada se estiver sem internet.
  // O "?v=" muda a cada 5 min para não pegar cópia velha guardada no caminho.
  const ehPagina = req.mode === 'navigate' ||
    (url.origin === self.location.origin && /\/(index\.html)?$/.test(url.pathname));
  if (ehPagina) {
    const fresco = new URL('./index.html', self.registration.scope);
    fresco.searchParams.set('v', Math.floor(Date.now() / 300000));
    e.respondWith(
      fetch(fresco.toString(), { cache: 'no-store' }).then(function (resp) {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then(function (c) { c.put('./index.html', copia); });
        }
        return resp;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // Ícones e manifest: usa a cópia e atualiza em segundo plano
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(VERSAO).then(function (c) {
        return c.match(req).then(function (guardado) {
          const rede = fetch(req).then(function (resp) {
            if (resp.ok) c.put(req, resp.clone());
            return resp;
          }).catch(function () { return guardado; });
          return guardado || rede;
        });
      })
    );
    return;
  }

  // Fonte e leitor de receita: guarda depois do primeiro uso
  if (EXTERNOS_OK.indexOf(url.hostname) !== -1) {
    e.respondWith(
      caches.open(VERSAO).then(function (c) {
        return c.match(req).then(function (guardado) {
          return guardado || fetch(req).then(function (resp) {
            if (resp.ok || resp.type === 'opaque') c.put(req, resp.clone());
            return resp;
          });
        });
      })
    );
  }
});

// Toque na notificação: abre (ou traz para frente) o PREVITA
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      for (const cl of lista) {
        if (cl.url.indexOf(self.registration.scope) === 0 && 'focus' in cl) return cl.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
