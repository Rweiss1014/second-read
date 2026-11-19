// Visit counter: a first-party beacon to this site's own /api/visit. No cookies, no fingerprint, no IP kept.
// Sends: the page, the referrer's host, phone or desktop, a random id for this tab, which main link was clicked,
// how much of the walkthrough was watched, and the time on the page. Off with Do Not Track or Global Privacy Control.
// The owner turns it off on her own browser by opening any page with ?me=1 (and back on with ?me=0).
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.has('me')) {
      try { if (q.get('me') === '0') localStorage.removeItem('sr-me'); else localStorage.setItem('sr-me', '1'); } catch (e) {}
      q.delete('me');
      var rest = q.toString();
      history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
    var me = false; try { me = localStorage.getItem('sr-me') === '1'; } catch (e) {}
    if (me || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true || !navigator.sendBeacon) return;

    var id; try { id = sessionStorage.getItem('sr-visit'); } catch (e) {}
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + '-' + Date.now().toString(36)).toLowerCase();
      try { sessionStorage.setItem('sr-visit', id); } catch (e) {}
    }
    var path = location.pathname;
    function send(o) { o.v = id; o.path = path; try { navigator.sendBeacon('/api/visit', new Blob([JSON.stringify(o)], { type: 'text/plain' })); } catch (e) {} }

    var ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    if (ref === location.hostname) ref = 'same site';
    var w = Math.min(innerWidth, screen.width || innerWidth);
    send({ t: 'view', ref: ref === 'same site' ? '' : ref, vp: w < 600 ? 'phone' : w < 1000 ? 'tablet' : 'desktop' });

    // Main links and buttons: which one, never the page text.
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a[href]'); if (!a) return;
      var h = a.getAttribute('href'), what = '';
      if (/^\/app\/?/.test(h)) what = 'app';
      else if (/Rachel-Weiss-Resume\.pdf/.test(h)) what = 'resume-pdf';
      else if (h === '#resume') what = 'resume';
      else if (/workflow\.json$/.test(h)) what = 'n8n';
      else if (/github\.com\/.*\/examples\/n8n/.test(h)) what = 'n8n-github';
      else if (/github\.com\/Rweiss1014\/second-read/.test(h)) what = 'repo';
      else if (/linkedin\.com/.test(h)) what = 'linkedin';
      else if (/emdesigns\.ai/.test(h)) what = 'emdesigns';
      if (what) send({ t: 'click', what: what });
    }, true);

    // The walkthrough: 25, 50, 75 and 100 percent, each once, with the seconds actually played.
    function watch(v) {
      var marks = [25, 50, 75, 100], sent = {}, played = 0, last = null;
      v.addEventListener('timeupdate', function () {
        var t = v.currentTime;
        if (last !== null && !v.paused && t > last && t - last < 2) played += t - last;
        last = t;
        if (!v.duration) return;
        var pct = (t / v.duration) * 100;
        marks.forEach(function (m) { if (!sent[m] && (pct >= m || (m === 100 && pct >= 98))) { sent[m] = 1; send({ t: 'video', pct: m, secs: Math.round(played) }); } });
      });
      v.addEventListener('seeking', function () { last = null; });
      v.addEventListener('play', function once() { v.removeEventListener('play', once); send({ t: 'click', what: 'video' }); });
    }
    function findVideo() { var v = document.querySelector('video[src*="walkthrough"]'); if (v) watch(v); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', findVideo); else findVideo();

    // Time on the page, sent when it is hidden (tab switch, close, or leaving).
    var shown = Date.now(), total = 0, sentLeave = false;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { total += Date.now() - shown; if (!sentLeave || total > 5000) { send({ t: 'leave', secs: Math.round(total / 1000) }); sentLeave = true; } }
      else shown = Date.now();
    });
  } catch (e) { /* never break the page */ }
})();
