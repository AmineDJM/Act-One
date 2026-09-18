/**
 * Whole-body delivery of React Server Component payloads.
 *
 * Installed as an inline script before any other client code. It wraps
 * `window.fetch` so that every `text/x-component` response (a navigation,
 * a prefetch, a server action's result) reaches Next.js and React's Flight
 * client only once its body has fully arrived, instead of as a stream.
 *
 * Why this exists, with the evidence:
 *
 * With Next 15.5 and the React canary it ships, a form action that
 * revalidates the page (`revalidatePath` inside the action) would leave the
 * form on "Saving…" forever in production, at random, on pages with a large
 * tree. Tracing the client showed the sequence every time: React suspends on
 * a Flight chunk whose row has not arrived yet; the row arrives in the next
 * network read, before React attaches its resolution listener; React then
 * calls `.then` on a chunk that is already `resolved_model`, which the Flight
 * client resolves synchronously inside the call; the work loop's
 * "suspended on data" path never resumes after a synchronous resolution, so
 * the transition never commits and `isPending` stays true. Nothing is
 * logged, nothing errors: the action ran, the server rendered, the page
 * simply never updates.
 *
 * Handing React the complete payload at once removes the window: every row
 * is parsed before React renders, so a chunk React waits on is never in the
 * half-state that resolves synchronously. Eight probes in a row settle where
 * none did before. The cost is that a client-side navigation paints when its
 * whole payload is in rather than progressively, which on this product's
 * pages is tens of milliseconds. Remove once the framework carries the fix.
 *
 * Kept as plain, dependency-free JavaScript in a string so it can be inlined
 * into the document head without a bundle boundary.
 */
export const RSC_BUFFER_SCRIPT = `(function(){
if (window.__actOneRscBuffer) return;
window.__actOneRscBuffer = true;
var original = window.fetch;
if (typeof original !== 'function') return;
window.fetch = function (input, init) {
  var self = this;
  return original.call(self, input, init).then(function (response) {
    var type = response.headers.get('content-type') || '';
    if (!response.body || type.indexOf('text/x-component') !== 0) return response;
    var url = response.url, redirected = response.redirected, kind = response.type;
    return response.arrayBuffer().then(function (bytes) {
      var headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      var whole = new Response(bytes, { status: response.status, statusText: response.statusText, headers: headers });
      try {
        Object.defineProperty(whole, 'url', { value: url });
        Object.defineProperty(whole, 'redirected', { value: redirected });
        Object.defineProperty(whole, 'type', { value: kind });
      } catch (e) {}
      return whole;
    });
  });
};
})();`;
