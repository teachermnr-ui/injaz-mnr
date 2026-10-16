/* إصدار: 2026-10-16.5 — «اقترح بالذكاء الاصطناعي»: زر عام يملأ أي حقل نصي عبر الدالة aiSuggest.
   الاستعمال: AIFill.attach({ field: عنصر الحقل, kind: 'نوع الاقتراح', schoolId, getCtx: ()=>({title, domain}), label: 'نص الزر' })
   - يتطلب تحميل firebase-functions-compat.js قبله. المفتاح والحدود في الخادم، فلا شيء سري هنا.
   - الاقتراح مسودة: يُملأ الحقل فقط ولا يُحفظ شيء حتى يضغط المستخدم حفظ/نشر. */
(function(g){
  'use strict';
  const toast = m => (g.ACT && g.ACT.toast) ? g.ACT.toast(m) : alert(m);
  const ask = m => (g.mnConfirm ? g.mnConfirm(m) : Promise.resolve(g.confirm(m)));
  async function suggest(kind, schoolId, ctx){
    if(!(g.firebase && firebase.functions)) throw new Error('خدمة الاقتراح غير متاحة في هذه الصفحة.');
    const r = await firebase.functions().httpsCallable('aiSuggest')(Object.assign({ kind, schoolId }, ctx||{}));
    return r.data || {};
  }
  function attach(o){
    const f = o.field; if(!f || f.__aiFill) return null; f.__aiFill = true;
    const bar = document.createElement('div'); bar.className = 'ai-fill-bar';
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 2px';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ac-btn sec sm'; btn.textContent = o.label || '✨ اقترح بالذكاء الاصطناعي';
    const note = document.createElement('span'); note.className = 'dh-sub'; note.style.cssText = 'font-size:12px';
    bar.appendChild(btn); bar.appendChild(note);
    f.insertAdjacentElement('afterend', bar);
    btn.addEventListener('click', async ()=>{
      const ctx = o.getCtx ? o.getCtx() : {};
      if(o.need && !o.need(ctx)){ toast(o.needMsg || 'أكمل البيانات المطلوبة أولًا.'); return; }
      if(f.value.trim() && !(await ask('سيُستبدل النص الحالي بالاقتراح. متابعة؟'))) return;
      const old = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ الاقتراح...'; note.textContent = '';
      try{
        const r = await suggest(o.kind, o.schoolId, ctx);
        f.value = r.text || ''; f.dispatchEvent(new Event('input', { bubbles:true }));
        note.textContent = 'اقتراح بالذكاء الاصطناعي — راجعه وعدّله قبل الاعتماد'+(typeof r.remainingToday==='number' ? ' (المتبقي لمدرستك اليوم: '+r.remainingToday+')' : '');
      }catch(e){
        const m = (e && e.message) ? String(e.message).replace(/^.*?:\s*(?=[؀-ۿ])/, '') : '';
        toast(m || 'تعذّر الاقتراح الآن، حاول لاحقًا.');
      }
      btn.disabled = false; btn.textContent = old;
    });
    return { button: btn, note };
  }
  g.AIFill = { attach, suggest };
})(window);
