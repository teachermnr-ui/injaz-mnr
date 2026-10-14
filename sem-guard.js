// إصدار: 2026-10-14.2
/* حارس الفصل الدراسي (المرحلة ٢ من الفصلين — 2026-10-13).
   الفصل المغلق (غير مفعَّل، أو مغلق نهائيًا، أو غير مرخَّص، أو انتهى تاريخه بتوقيت الرياض) يختفي عن موظفي المدرسة.
   الحماية الأصلية في firestore.rules (semWritable)؛ هذا الملف:
   - SemGuard.isOpen(school, period): هل الفصل مفتوح؟ (مدرسة بلا semesters = النمط القديم = مفتوح)
   - SemGuard.reason(school, period): سبب الإغلاق نصًّا.
   - SemGuard.start(): في صفحات الأدوات: يقرأ جلسة cls_session ويعرض غطاءً كاملًا «هذا الفصل مغلق» عند الإغلاق، ويعيد الفحص كل دقيقتين.
   لا يعمل لأدمن النظام ولا للمعلم المستقل (لا مدرسة له). */
(function(){
  var RECHECK_MS = 2 * 60 * 1000;
  var NAMES = { first: 'الفصل الأول', second: 'الفصل الثاني' };
  function nm(p){ return NAMES[p] || NAMES.first; }

  /* (2026-10-14.2) الوقت بساعة خوادم Google: فرق الساعة (الخادم − الجهاز) يُحفظ في cls_srvoff كلما استُدعيت currentPeriod،
     فلا تتأثر الحسابات بتاريخ جهاز المستخدم. ولا يوجد «تفعيل يدوي» للفصل: يُفتح تلقائيًا بتاريخه (مرخَّص + غير مقفل + داخل المدة). */
  var OFF_KEY = 'cls_srvoff';
  function off(){ try{ var v = parseInt(localStorage.getItem(OFF_KEY) || '0', 10); return isFinite(v) ? v : 0; }catch(e){ return 0; } }
  function now(){ return Date.now() + off(); }
  function setOff(serverMs){ try{ localStorage.setItem(OFF_KEY, String(serverMs - Date.now())); }catch(e){} }
  function loadFns(){
    return new Promise(function(res, rej){
      if(window.firebase && firebase.functions) return res();
      var sc = document.createElement('script');
      sc.src = 'https://www.gstatic.com/firebasejs/12.14.0/firebase-functions-compat.js';
      sc.onload = function(){ res(); };
      sc.onerror = function(){ rej(new Error('تعذّر تحميل خدمة الدوال. تحقق من الاتصال بالإنترنت.')); };
      document.head.appendChild(sc);
    });
  }
  // الفصل الحالي ووقت الخادم من دالة currentPeriod (يحفظ فرق الساعة)
  async function fetchPeriod(){
    await loadFns();
    var r = await firebase.functions().httpsCallable('currentPeriod')({});
    var d = r.data || {};
    if(d.nowMs) setOff(d.nowMs);
    return d;
  }
  function isOpen(sc, period){
    if(!sc || !sc.semesters) return true;
    var st = sc.semesters[period];
    if(!st || !st.licensed || st.locked) return false;
    var w = (sc.semDates || {})[period];
    var now_ = now();
    if(w){
      if(w.fromMs && now_ < w.fromMs) return false;
      if(w.toMs && now_ > w.toMs) return false;
    }
    return true;
  }
  function reason(sc, period){
    if(!sc || !sc.semesters) return '';
    var st = sc.semesters[period];
    if(!st || !st.licensed) return nm(period) + ' غير مرخَّص لهذه المدرسة.';
    if(st.locked) return nm(period) + ' مغلق نهائيًا من إدارة النظام.';
    var w = (sc.semDates || {})[period], now_ = now();
    if(w && w.toMs && now_ > w.toMs) return 'انتهى ' + nm(period) + '.';
    if(w && w.fromMs && now_ < w.fromMs) return 'لم يبدأ ' + nm(period) + ' بعد.';
    return '';
  }

  function sess(){ try{ return JSON.parse(localStorage.getItem('cls_session') || 'null'); }catch(e){ return null; } }
  var shown = false;
  function overlay(s, why){
    if(shown) return; shown = true;
    var isDir = s.role === 'schoolAdmin';
    var d = document.createElement('div');
    d.id = 'semGuardOverlay';
    d.setAttribute('dir', 'rtl');
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.94);color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:Tajawal,Tahoma,sans-serif';
    d.innerHTML = '<div style="max-width:420px"><div style="font-size:42px;margin-bottom:8px">🔒</div>'
      + '<h2 style="margin:0 0 10px;font-size:20px">هذا الفصل الدراسي مغلق</h2>'
      + '<p style="margin:0 0 18px;line-height:1.9;font-size:15px;opacity:.92">' + (why || '') + '<br>لا يمكن العمل فيه. ' + (isDir ? 'يمكنك إدارة الفصول من تبويب «الفصول الدراسية».' : 'تواصل مع مدير مدرستك.') + '</p>'
      + '<button id="semGuardBtn" style="background:#0b7a63;color:#fff;border:0;border-radius:12px;padding:12px 22px;font:inherit;font-size:15px;cursor:pointer">'
      + 'العودة إلى صفحة الدخول</button></div>';
    document.body.appendChild(d);
    document.getElementById('semGuardBtn').onclick = function(){
      try{ localStorage.removeItem('cls_session'); }catch(e){}
      location.href = 'index.html';
    };
  }

  /* تحويل الجلسة تلقائيًا إلى الفصل الحالي (بوقت الخادم) عند تغيّر الفصل أثناء الجلسة، مع إشعار ثم إعادة تحميل مرة واحدة.
     لا يعمل لأدمن النظام. عند تعذّر الاتصال لا يغيّر شيئًا (القواعد هي الحارس). */
  var syncing = false, lastSync = 0, SYNC_EVERY_MS = 10 * 60 * 1000;
  async function sync(force){
    var s = sess();
    if(syncing || !s || !s.userId || s.role === 'admin') return false;
    if(!force && lastSync && Date.now() - lastSync < SYNC_EVERY_MS) return false;   // لا نستدعي الخادم كل دقيقتين
    lastSync = Date.now();
    syncing = true;
    try{
      var d = await fetchPeriod();
      if(!d || !d.period) return false;
      if((s.period || 'first') !== d.period){
        s.period = d.period;
        try{ localStorage.setItem('cls_session', JSON.stringify(s)); }catch(e){}
        var b = document.createElement('div');
        b.setAttribute('dir', 'rtl');
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#0b7a63;color:#fff;padding:14px;text-align:center;font:600 15px Tajawal,Tahoma,sans-serif';
        b.textContent = 'بدأ ' + nm(d.period) + '، تم تحويلك إليه.';
        document.body.appendChild(b);
        setTimeout(function(){ location.reload(); }, 2200);
        return true;
      }
      return false;
    }catch(e){ return false; }
    finally{ syncing = false; }
  }

  async function check(){
    var s = sess();
    if(!s) return;
    if(await sync()) return;
    if(!s.schoolId || s.role === 'admin' || s.role === 'soloTeacher' || s.ctxKey === 'solo') return;
    if(!(window.firebase && firebase.apps && firebase.apps.length && firebase.firestore)) return;
    try{
      var snap = await firebase.firestore().collection('schoolData').doc(s.schoolId).get();
      if(!snap.exists) return;
      var sc = snap.data();
      var p = s.period || 'first';
      if(!isOpen(sc, p)) overlay(s, reason(sc, p));
    }catch(e){ /* بلا اتصال أو صلاحية: لا نمنع، فالقواعد هي الحارس الأصلي */ }
  }
  function start(){
    function go(){
      if(!(window.firebase && firebase.auth)){ return setTimeout(go, 400); }
      try{
        firebase.auth().onAuthStateChanged(function(u){ if(u) check(); });
      }catch(e){ return setTimeout(go, 800); }
      setInterval(check, RECHECK_MS);
    }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
  window.SemGuard = { isOpen: isOpen, reason: reason, start: start, check: check, sync: sync, fetchPeriod: fetchPeriod, now: now };
})();
