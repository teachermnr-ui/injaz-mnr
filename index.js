// إصدار: 2026-10-05.3
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();
const nodemailer = require("nodemailer");
const {defineSecret} = require("firebase-functions/params");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
/**
 * فك ربط حساب مستخدم فعليًا:
 * - تعطيل حساب Firebase Auth (منع دخول حقيقي فوري)
 * - إرسال بريد فوري بكلمة المرور الجديدة عبر مجموعة "mail" (يتطلب امتداد Trigger Email لاحقًا)
 * يُستدعى فقط من admin العام (نتحقق من صلاحيته داخل الدالة)
 */
exports.unlinkUserAccount = onCall({secrets: [GMAIL_APP_PASSWORD]}, async (request) => {
  // التحقق: المستدعي لازم يكون مسجَّل دخول
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }

  const callerUid = request.auth.uid;
  const { targetDocId, newPassword } = request.data;

  if (!targetDocId || !newPassword) {
    throw new HttpsError("invalid-argument", "بيانات ناقصة (targetDocId أو newPassword).");
  }

  const db = admin.firestore();

  // التحقق: المستدعي فعلاً admin العام
  const callerDoc = await db.collection("users").doc(callerUid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "admin") {
    throw new HttpsError("permission-denied", "هذا الإجراء مقصور على admin العام فقط.");
  }

  // جلب المستند المستهدف
  const targetRef = db.collection("users").doc(targetDocId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "الحساب المستهدف غير موجود.");
  }
  const targetData = targetSnap.data();
  const targetAuthUid = targetData.authUid;

  if (!targetAuthUid) {
    throw new HttpsError("failed-precondition", "هذا الحساب غير مرتبط ببريد أصلاً.");
  }

  const targetEmail = targetData.email || targetData.googleEmail || null;

  // ١) تعطيل حساب Firebase Auth فعليًا
  await admin.auth().updateUser(targetAuthUid, { disabled: true });

  // ٢) تحديث مستند Firestore: مسح الربط، تسجيل كلمة المرور الجديدة
  await targetRef.update({
    authUid: admin.firestore.FieldValue.delete(),
    email: admin.firestore.FieldValue.delete(),
    googleEmail: admin.firestore.FieldValue.delete(),
    mergeRequestAt: admin.firestore.FieldValue.delete(),
    mergeRequestTarget: admin.firestore.FieldValue.delete(),
    password: newPassword,
    updatedAt: Date.now(),
  });

  // ٣) إرسال بريد فوري (يتطلب تفعيل امتداد Trigger Email لاحقًا ليعمل فعليًا)
  if (targetEmail) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "awraqaicom@gmail.com",
        pass: GMAIL_APP_PASSWORD.value(),
      },
    });
    
    await transporter.sendMail({
      from: "awraqaicom@gmail.com",
      to: targetEmail,
      subject: "تم فك ربط حسابك",
      text:
        "تم فك ربط بريدك القديم بناءً على طلبك.\n" +
        "كلمة المرور الأولية الجديدة لإعادة التفعيل: " + newPassword + "\n" +
        "سجّل الدخول من جديد بأي بريد وأدخل رقم هويتك وهذه الكلمة لإكمال التفعيل.",
    });
  }

  return { success: true, email: targetEmail };
});
const db2 = admin.firestore();

exports.requestMergeLink = onCall(
  {secrets: [GMAIL_APP_PASSWORD]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
    }
    const callerUid = request.auth.uid;
    const {loginId, confirmEmail} = request.data;

    if (!loginId || !/^[0-9]{10,14}$/.test(loginId)) {
      throw new HttpsError("invalid-argument", "رقم هوية غير صالح.");
    }
    if (!confirmEmail) {
      throw new HttpsError("invalid-argument", "لازم تدخل البريد للتأكيد.");
    }

    // إيجاد الحساب الآخر المطابق (سيرفريًا، لا نثق بأي شيء من المتصفح)
    const q = await db2.collection("users").where("loginId", "==", loginId).get();
    const otherDoc = q.docs.find((d) =>
      d.id !== callerUid &&
      d.data().authUid &&
      d.data().role !== "admin" &&
      d.data().role !== "schoolAdmin"
    );
    if (!otherDoc) {
      throw new HttpsError("not-found", "لا يوجد رقم سجل مطابق مرتبط بحساب آخر.");
    }
    const otherData = otherDoc.data();
    const realEmail = otherData.email || otherData.googleEmail || "";
    if (!realEmail || confirmEmail.trim().toLowerCase() !== realEmail.trim().toLowerCase()) {
      throw new HttpsError("permission-denied", "البريد المُدخَل غير صحيح.");
    }

    // كتابة رقم الهوية على حساب المستدعي (الفردي) الآن فقط
    await db2.collection("users").doc(callerUid).update({
      loginId: loginId,
      isSolo: true,
      updatedAt: Date.now(),
    });

    // توليد كود ٦ أرقام وحفظ طلب الدمج (صالح ٢٤ ساعة)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await db2.collection("mergeRequests").add({
      soloUid: callerUid,
      targetUid: otherDoc.id,
      loginId: loginId,
      code: code,
      used: false,
      createdAt: Date.now(),
      expiresAt: expiresAt,
    });

    // إرسال الكود لبريد الحساب الفردي نفسه
    const callerDoc = await db2.collection("users").doc(callerUid).get();
    const callerEmail = callerDoc.exists ?
      (callerDoc.data().email || callerDoc.data().googleEmail || "") : "";
    if (callerEmail) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "awraqaicom@gmail.com",
          pass: GMAIL_APP_PASSWORD.value(),
        },
      });
      await transporter.sendMail({
        from: "awraqaicom@gmail.com",
        to: callerEmail,
        subject: "كود ربط حسابك بمدرستك",
        text:
          "طلبت ربط حسابك الفردي بحساب مدرسة مرتبط بنفس رقم هويتك.\n" +
          "كود الربط: " + code + "\n" +
          "سجّل الدخول بحسابك الآخر (حساب المدرسة) وأدخل هذا الكود خلال 24 ساعة لإتمام الدمج.",
      });
    }

    return {success: true, maskedTarget: maskEmailServer(realEmail)};
  }
);

function maskEmailServer(email) {
  const parts = email.split("@");
  if (parts.length < 2) return email;
  const shown = parts[0].slice(0, 2);
  return shown + "***@" + parts[1];
}

/**
 * تأكيد الدمج: يُستدعى بعد تسجيل الدخول بحساب المدرسة (الهدف)
 * وإدخال كود الربط اللي وصل لبريد الحساب الفردي.
 */
exports.confirmMergeLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }
  const callerUid = request.auth.uid;
  const {code} = request.data;

  if (!code) {
    throw new HttpsError("invalid-argument", "أدخل الكود.");
  }

  const db3 = admin.firestore();

  const q = await db3.collection("mergeRequests")
    .where("targetUid", "==", callerUid)
    .where("code", "==", String(code).trim())
    .where("used", "==", false)
    .get();

  if (q.empty) {
    throw new HttpsError("not-found", "الكود غير صحيح.");
  }

  const reqDoc = q.docs[0];
  const reqData = reqDoc.data();

  if (!reqData.expiresAt || Date.now() > reqData.expiresAt) {
    throw new HttpsError("deadline-exceeded", "انتهت صلاحية الكود. أعد المحاولة من جديد من حسابك الفردي.");
  }

  const targetRef = db3.collection("users").doc(callerUid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "حسابك غير موجود.");
  }
  const targetData = targetSnap.data();
  const targetSchools = targetData.schools || {};
  if (!Object.keys(targetSchools).length) {
    throw new HttpsError(
        "failed-precondition",
        "حسابك الحالي فردي بحت بلا أي مدرسة — لا يمكن الدمج بهذا الاتجاه.",
    );
  }

  const soloUid = reqData.soloUid;
  const soloRef = db3.collection("users").doc(soloUid);
  const soloSnap = await soloRef.get();
  if (!soloSnap.exists) {
    throw new HttpsError("not-found", "الحساب الفردي الأصلي لم يعد موجودًا.");
  }
  const soloData = soloSnap.data();

  // نقل سياق solo لحساب الهدف فقط لو ما عنده سياق solo أصلاً (بلا استبدال بيانات موجودة)
  const updatePayload = {updatedAt: Date.now()};
  if (!targetData.solo && soloData.solo) {
    updatePayload.solo = soloData.solo;
  }
  await targetRef.update(updatePayload);

  // تعطيل حساب Auth الخاص بالحساب الفردي (لم يعد يُستخدم للدخول بعد الآن)
  try {
    await admin.auth().updateUser(soloUid, {disabled: true});
  } catch (e) {
    // لو الحساب محذوف مسبقًا من Auth لأي سبب، نكمل بدون توقف
  }

  // تعليم المستند الفردي كمُدمَج
  await soloRef.update({
    migratedTo: callerUid,
    authUid: admin.firestore.FieldValue.delete(),
    email: admin.firestore.FieldValue.delete(),
    googleEmail: admin.firestore.FieldValue.delete(),
    updatedAt: Date.now(),
  });

  // تعليم طلب الدمج كمستخدَم
  await reqDoc.ref.update({used: true, usedAt: Date.now()});

  return {success: true};
});
/**
 * فحص خفيف: هل يوجد طلب دمج معلَّق يستهدف الحساب الحالي؟
 * يرجع true/false فقط — لا يكشف أي تفاصيل عن الطلب للمتصفح.
 */
exports.checkPendingMerge = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  }
  const callerUid = request.auth.uid;
  const db4 = admin.firestore();
  const q = await db4.collection("mergeRequests")
    .where("targetUid", "==", callerUid)
    .where("used", "==", false)
    .get();
  const valid = q.docs.filter((d) => d.data().expiresAt && d.data().expiresAt > Date.now());
  return {pending: valid.length > 0};
});

/* =========================================================================
   ص-١: الأنشطة الرقمية ملك المعلم وتنتقل معه
   ========================================================================= */
const { onSchedule } = require("firebase-functions/v2/scheduler");

/**
 * أرشفة نشاط منشور/مغلق انقطعت صلة صاحبه بطلابه:
 * - نسخة مسودة (المحتوى فقط) في مكتبة المعلم
 * - النشاط يصير archived فيختفي عن الطلاب
 * - التسليمات تُخفى وتُقطع صلة المعلم بها (teacherUid = null)
 */
async function archiveWorksheet(db, wDoc, ownerUid, reason) {
  const w = wDoc.data();
  const FV = admin.firestore.FieldValue;
  await db.collection("worksheets").add({
    createdBy: ownerUid, createdByName: w.createdByName || "", schoolId: null,
    subject: w.subject || "", grade: w.grade || "", title: w.title || "", unit: w.unit || "", lesson: w.lesson || "",
    sourceFileName: w.sourceFileName || "", exercises: w.exercises || [],
    status: "draft", assignedClassIds: [], assignedStudentIds: [], dueDate: null,
    createdAt: FV.serverTimestamp(), publishedAt: null, copiedFrom: wDoc.id, restoredBy: reason,
  });
  const subs = await db.collection("submissions").where("worksheetId", "==", wDoc.id).get();
  for (let i = 0; i < subs.docs.length; i += 400) {
    const batch = db.batch();
    subs.docs.slice(i, i + 400).forEach((s) => batch.update(s.ref, {
      hidden: true, teacherUid: null, archivedTeacherUid: w.createdBy || null, archivedAt: Date.now(),
    }));
    await batch.commit();
  }
  await wDoc.ref.update({ status: "archived", archivedAt: FV.serverTimestamp(), archivedReason: reason });
}

/** هل ما زال صاحب النشاط مرتبطًا بسياق النشر (المدرسة، أو حسابه الفردي)؟ */
function stillLinked(u, sid, schoolExists) {
  if (!u || u.active === false || u.migratedTo) return false;
  if (sid) {
    if (!schoolExists) return false;
    if (u.role === "admin") return true;
    if (u.role === "schoolAdmin") return (u.adminSchools || []).includes(sid);
    const c = (u.schools || {})[sid];
    return !!c && c.active !== false;
  }
  return !!u.solo && u.solo.active !== false;
}

/**
 * كل ساعة: الأنشطة المنشورة/المغلقة لمعلم لم يعد في مدرسة النشر (أُزيل أو أُوقف، أو حُذفت المدرسة)،
 * أو انتهى حسابه الفردي، تُؤرشف: تختفي عنه وعن الطلاب، ويبقى محتواها مسودةً في مكتبته.
 */
exports.archiveDepartedTeachers = onSchedule({ schedule: "every 60 minutes", timeZone: "Asia/Riyadh" }, async () => {
  const db = admin.firestore();
  const snap = await db.collection("worksheets").where("status", "in", ["published", "closed"]).get();
  const userCache = new Map(), schoolCache = new Map();
  const getUser = async (uid) => {
    if (!userCache.has(uid)) { const s = await db.collection("users").doc(uid).get(); userCache.set(uid, s.exists ? s.data() : null); }
    return userCache.get(uid);
  };
  const schoolExists = async (sid) => {
    if (!schoolCache.has(sid)) { const s = await db.collection("schoolData").doc(sid).get(); schoolCache.set(sid, s.exists); }
    return schoolCache.get(sid);
  };
  let archived = 0;
  for (const d of snap.docs) {
    const w = d.data();
    if (!w.createdBy) continue;
    const sid = w.schoolId || null;
    const u = await getUser(w.createdBy);
    if (stillLinked(u, sid, sid ? await schoolExists(sid) : true)) continue;
    try { await archiveWorksheet(db, d, w.createdBy, "departure"); archived++; } catch (e) { console.error("archive", d.id, e); }
  }
  console.log("archiveDepartedTeachers: archived", archived);
});

/**
 * استرجاع أنشطة المعلم وبنك أسئلته من حساب سابق له:
 *  - حساب دُمج في حسابه الحالي (migratedTo = حسابه)، أو
 *  - حساب بنفس البريد المُثبت في رمز الدخول، وحساب Auth الخاص به محذوف أو معطّل.
 * المسودات وبنك الأسئلة تنتقل كما هي؛ المنشور/المغلق يُؤرشف وتُنسخ مسودته للحساب الحالي.
 */
exports.reclaimTeacherContent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  const uid = request.auth.uid;
  const db = admin.firestore();
  const me = await db.collection("users").doc(uid).get();
  if (!me.exists) return { moved: 0 };
  const olds = new Map();
  (await db.collection("users").where("migratedTo", "==", uid).get()).docs.forEach((d) => olds.set(d.id, true));
  const email = request.auth.token.email || "";
  if (email && request.auth.token.email_verified !== false) {
    const variants = [...new Set([email, email.toLowerCase()])];
    for (const f of ["email", "googleEmail"]) {
      for (const e of variants) {
        const s = await db.collection("users").where(f, "==", e).get();
        for (const d of s.docs) {
          if (d.id === uid || olds.has(d.id)) continue;
          const authUid = d.data().authUid || d.id;
          let dead = false;
          try { dead = !!(await admin.auth().getUser(authUid)).disabled; } catch (err) { dead = err && err.code === "auth/user-not-found"; }
          if (dead) olds.set(d.id, true);
        }
      }
    }
  }
  let moved = 0;
  for (const oldId of olds.keys()) {
    const ws = await db.collection("worksheets").where("createdBy", "==", oldId).get();
    for (const d of ws.docs) {
      const st = d.data().status;
      if (st === "draft") { await d.ref.update({ createdBy: uid, updatedAt: Date.now() }); moved++; }
      else if (st === "published" || st === "closed") { await archiveWorksheet(db, d, uid, "reclaim"); moved++; }
    }
    const qb = await db.collection("questionBank").where("createdBy", "==", oldId).get();
    for (let i = 0; i < qb.docs.length; i += 400) {
      const batch = db.batch();
      qb.docs.slice(i, i + 400).forEach((q) => batch.update(q.ref, { createdBy: uid }));
      await batch.commit();
      moved += Math.min(400, qb.docs.length - i);
    }
  }
  return { moved };
});

/* =========================================================================
   ص-١٢: الإشعارات الفورية (تطبيق إنجاز) + التذكير الصباحي + ساعات الهدوء
   - رموز الأجهزة: pushTokens/{رمز} = { uid, authUid, sid, … } — يكتبها pwa.js عند «تفعيل الإشعارات».
   - ساعات الهدوء والإجازات: schoolCalendar/{sid} — بند «الإجازات» (المدير والوكيل).
     ما يقع في ساعات الهدوء يُحفظ في pushQueue ويُرسل عند انتهائها (flushPushQueue كل ١٠ دقائق).
   - الضغط على الإشعار يفتح الصفحة المعنية (fcmOptions.link).
   ملاحظة: محفّزات Firestore (onDocumentWritten) لا تعمل في me-central2 (خلل معروف عند Google)،
   فالتغييرات تُراقَب بدالة مجدولة كل دقيقة (pushWatcher) — الإشعار يصل خلال دقيقة تقريبًا.
   ========================================================================= */
const SITE = "https://injaz.awraqai.com/";
const P_ORD = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
const P_WD = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const arNum = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const ordP = (p) => P_ORD[+p] || arNum(+p + 1);

// الوقت بتوقيت الرياض (UTC+3 ثابت، بلا توقيت صيفي)
function riyadhNow() {
  const d = new Date(Date.now() + 3 * 3600e3);
  return { key: d.toISOString().slice(0, 10), wd: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function addDaysKey(k, n) { const d = new Date(k + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function hijriDay(k) {
  try {
    return new Date(k + "T12:00:00Z").toLocaleDateString("ar-SA-u-ca-islamic-umalqura", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  } catch (e) { return k; }
}
function relDay(k) {
  const t = riyadhNow().key;
  return k === t ? "اليوم" : k === addDaysKey(t, 1) ? "غدًا" : hijriDay(k);
}
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function fmt12(t) {
  const m = toMin(t); if (m == null) return t || "";
  const h = Math.floor(m / 60), mi = m % 60;
  return arNum(((h + 11) % 12) + 1) + ":" + arNum(String(mi).padStart(2, "0")) + (h >= 12 ? " م" : " ص");
}
const parseVal = (snap) => {
  if (!snap || !snap.exists) return null;
  try { return JSON.parse(snap.data().value || "null"); } catch (e) { return null; }
};
const uniq = (a) => [...new Set((a || []).filter(Boolean))];

async function getCalendar(db, sid) {
  try { const s = await db.collection("schoolCalendar").doc(sid).get(); return s.exists ? s.data() : {}; } catch (e) { return {}; }
}
function isHoliday(cal, k) {
  return (cal.holidays || []).some((h) => h && h.from && h.from <= k && k <= (h.to && h.to >= h.from ? h.to : h.from));
}
// نهاية ساعات الهدوء (بالمللي ثانية) إن كنا داخلها الآن، وإلا null
function quietEnd(cal) {
  const q = cal.quiet || {};
  if (!q.on) return null;
  const f = toMin(q.from), t = toMin(q.to);
  if (f == null || t == null || f === t) return null;
  const now = riyadhNow().min;
  const inside = f < t ? (now >= f && now < t) : (now >= f || now < t);
  if (!inside) return null;
  const diff = (t - now + 1440) % 1440;
  return Date.now() + diff * 60000;
}

async function tokensOf(db, uids) {
  const out = [];
  const list = uniq(uids);
  for (let i = 0; i < list.length; i += 30) {
    const q = await db.collection("pushTokens").where("uid", "in", list.slice(i, i + 30)).get();
    q.docs.forEach((d) => out.push({ token: d.id, uid: d.data().uid }));
  }
  return out;
}
async function sendNow(db, uids, msg) {
  const toks = await tokensOf(db, uids);
  if (!toks.length) return 0;
  const link = SITE + (msg.link || "index.html");
  const notification = { title: msg.title, body: msg.body || "", icon: SITE + "icons/icon-192.png", badge: SITE + "icons/badge-72.png", dir: "rtl", lang: "ar" };
  if (msg.tag) notification.tag = msg.tag;
  let sent = 0;
  for (let i = 0; i < toks.length; i += 500) {
    const chunk = toks.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: chunk.map((t) => t.token),
      data: { link, title: msg.title, body: msg.body || "" },
      webpush: { headers: { Urgency: "high", TTL: "86400" }, notification, fcmOptions: { link } },
    });
    sent += res.successCount;
    const dead = [];
    res.responses.forEach((r, j) => {
      const c = r.error && r.error.code;
      if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token" || c === "messaging/invalid-argument") dead.push(chunk[j].token);
    });
    await Promise.all(dead.map((t) => db.collection("pushTokens").doc(t).delete().catch(() => {})));
  }
  return sent;
}
/** إرسال لمستخدمي مدرسة: فورًا، أو يُؤجَّل لنهاية ساعات الهدوء */
async function notify(db, sid, uids, msg, cal) {
  const list = uniq(uids);
  if (!list.length) return;
  const c = cal || await getCalendar(db, sid);
  const qe = quietEnd(c);
  if (qe) {
    await db.collection("pushQueue").add({ sid, uids: list, msg, sendAt: qe, createdAt: Date.now() });
    return;
  }
  try { await sendNow(db, list, msg); } catch (e) { console.error("push", sid, e); }
}

/* =========================================================================
   مراقب التغييرات — دالة مجدولة كل دقيقة (بدل محفّزات Firestore التي لا تعمل في me-central2)
   ما يتغير يصل إشعاره خلال دقيقة تقريبًا. الحالة السابقة في pushState/* (للخادم فقط).
   أول تشغيل: يسجّل الوضع الحالي بصمت ولا يرسل شيئًا عن الماضي.
   ========================================================================= */
const OVERLAP = 3 * 60 * 1000;   // تداخل زمني آمن لفروق ساعة الأجهزة؛ التكرار يمنعه سجل المعرّفات المُشعَرة

/* (هـ) تغيّر الجدول بعد النشر · (أ) انتظار حُدِّد له عند «اعتماد وإرسال» */
async function hPublished(db, sid, before, after, cal) {
  const bu = (before && before.byUser) || {}, au = (after && after.byUser) || {};
  const changed = [], fresh = [];
  Object.keys(au).forEach((uid) => {
    const sa = (au[uid] || {}).sig || "";
    if (!bu[uid]) fresh.push(uid);
    else if (((bu[uid] || {}).sig || "") !== sa) changed.push(uid);
  });
  await notify(db, sid, fresh, { title: "نُشر جدولك الدراسي", body: "اضغط للاطّلاع على جدولك", link: "myschedule.html", tag: "sched" }, cal);
  await notify(db, sid, changed, { title: "تغيّر جدولك الدراسي", body: "عُدِّل جدولك بعد النشر — اضغط للاطّلاع على التعديل", link: "myschedule.html", tag: "sched" }, cal);
}
async function hWaitDay(db, sid, date, before, after, cal) {
  if (!after || !after.sent || date < riyadhNow().key) return;
  if (before && before.sent && before.sentAt === after.sentAt) return;
  const key = (i) => [i.subUid, i.st, i.p, i.cls].join("|");
  const old = new Set(before && before.sent ? (before.items || []).filter((i) => i.subUid).map(key) : []);
  const byU = {};
  (after.items || []).filter((i) => i.subUid && !old.has(key(i))).forEach((i) => { (byU[i.subUid] = byU[i.subUid] || []).push(i); });
  for (const uid of Object.keys(byU)) {
    const items = byU[uid].sort((a, b) => a.p - b.p);
    await notify(db, sid, [uid], {
      title: "حصة انتظار " + relDay(date),
      body: items.map((i) => "الحصة " + ordP(i.p) + ": " + (i.clsLabel || i.cls || "") + (i.subj ? " (" + i.subj + ")" : "")).join(" · "),
      link: "myday.html", tag: "wait-" + date,
    }, cal);
  }
}
/* (ب) تعميم جديد يحتاج توقيعه (تعميم المناوبة يُغني عنه إشعار الاعتماد) */
async function hCircular(db, sid, c, cal) {
  if (!c || !c.mandatory || c.source === "duty") return;
  const fresh = (c.recipients || []).filter((u) => u !== c.createdBy);
  await notify(db, sid, fresh, { title: "تعميم جديد يحتاج توقيعك", body: "رقم " + arNum(c.number || "") + (c.title ? ": " + c.title : ""), link: "circulars.html", tag: "circ" }, cal);
}
/* (ج) اعتماد المناوبة والإشراف */
async function hDuty(db, sid, d, cal) {
  const pub = d.pub;
  await notify(db, sid, pub.members || d.members || [], {
    title: "اعتُمدت مناوبتك وإشرافك",
    body: (pub.stageLabel ? pub.stageLabel + " — " : "") + (pub.circular ? "وقّع على التعميم رقم " + arNum(pub.circular.number) + " للاستلام" : "اضغط للاطّلاع"),
    link: "myday.html", tag: "duty",
  }, cal);
}
/* (د) زيارة صفية جُدولت له (أو عُدِّل موعدها) */
const visitSig = (v) => (v && v.date ? [v.date, v.p, v.cls].join("|") : "");
async function hVisit(db, sid, v, prev, cal) {
  const today = riyadhNow().key;
  const lines = [];
  [["v1", "الأولى"], ["v2", "الثانية"]].forEach(([k, label]) => {
    const x = v[k];
    if (!visitSig(x) || visitSig(x) === (prev || {})[k] || x.date < today) return;
    lines.push("الزيارة " + label + ": " + relDay(x.date) + (x.p !== "" && x.p != null ? " — الحصة " + ordP(x.p) : ""));
  });
  if (!lines.length) return;
  await notify(db, sid, [v.teacherId], { title: "زيارة صفية مجدولة", body: lines.join(" · "), link: "myday.html", tag: "visit" }, cal);
}
/* (و) تحويل جديد وصله (للمعلم والمدير والوكيل وكل مستلم) */
async function hNote(db, n, cal) {
  const to = (n.recipients || []).filter((u) => u !== n.fromUserId);
  const who = n.studentName ? n.studentName + (n.className ? " — " + n.className : "") : String(n.text || "").slice(0, 80);
  await notify(db, n.schoolId, to, {
    title: n.studentName ? "تحويل جديد" : "ملاحظة جديدة",
    body: (n.fromName ? "من " + n.fromName + ": " : "") + who,
    link: "index.html?tab=received", tag: "note",
  }, cal);
}
/* (ح) طالب حضّره معلم وهو مسجّل غائب — للمدير والوكيل */
async function hAttAlert(db, a, cal) {
  const sid = a.schoolId, to = [];
  const sa = await db.collection("users").where("adminSchools", "array-contains", sid).get();
  sa.docs.forEach((d) => { const u = d.data(); if (u.role === "schoolAdmin" && u.active !== false) to.push(d.id); });
  const ag = await db.collection("users").where(new admin.firestore.FieldPath("schools", sid, "role"), "==", "agent").get();
  ag.docs.forEach((d) => { const u = d.data(); const c = (u.schools || {})[sid] || {}; if (u.active !== false && c.active !== false && !u.migratedTo) to.push(d.id); });
  await notify(db, sid, to, {
    title: "طالب حضّره معلم وهو مسجّل غائب",
    body: (a.name || "") + (a.className ? " — " + a.className : "") + (a.byName ? " · المعلم: " + a.byName : ""),
    link: "index.html?tab=absence", tag: "att",
  }, cal);
}

exports.pushWatcher = onSchedule({ schedule: "every 1 minutes", timeZone: "Asia/Riyadh", timeoutSeconds: 180 }, async () => {
  const db = admin.firestore(), ST = db.collection("pushState");
  const t0 = Date.now();
  const wmRef = ST.doc("wm"), seenRef = ST.doc("seen");
  const wmS = await wmRef.get();
  if (!wmS.exists) {   // أول تشغيل: لا إشعارات عن الماضي
    await wmRef.set({ at: t0 });
    console.log("pushWatcher: baseline");
  }
  const wm = wmS.exists ? (wmS.data().at || t0) : t0;
  const since = wm - OVERLAP;
  const seenS = await seenRef.get();
  const seen = new Set(seenS.exists ? (seenS.data().ids || []) : []);
  const calMemo = {};
  const calOf = async (sid) => (calMemo[sid] = calMemo[sid] || await getCalendar(db, sid));
  const mark = (id) => { if (seen.has(id)) return false; seen.add(id); return true; };
  const baselineOnly = !wmS.exists;
  const { key: today } = riyadhNow();
  const tomorrow = addDaysKey(today, 1);
  const nowMs = Date.now();

  // المدارس
  const schools = await db.collection("schoolData").where("_isSchool", "==", true).get();
  for (const s of schools.docs) {
    const sid = s.id, sd = s.data();
    if (sd.active === false) continue;
    try {
      const period = sd.activePeriod || "first";
      const ttc = db.collection("timetables").doc(sid).collection("data");
      const stRef = ST.doc("s_" + sid);
      const stS = await stRef.get();
      const state = stS.exists ? stS.data() : {};
      const next = { docs: Object.assign({}, state.docs || {}), duty: Object.assign({}, state.duty || {}) };
      let dirty = false;

      // الجدول المنشور + تحديد الانتظار اليومي
      const ids = [period + "_published", period + "_wday_" + today, period + "_wday_" + tomorrow];
      for (const id of ids) {
        const snap = await ttc.doc(id).get();
        if (!snap.exists) continue;
        const raw = snap.data(), rev = raw.rev || 0;
        const prev = next.docs[id];
        if (prev && prev.rev === rev) continue;
        let after = null; try { after = JSON.parse(raw.value || "null"); } catch (e) {}
        if (!after) continue;
        const isPub = id === period + "_published";
        const recent = nowMs - (raw.updatedAt || 0) < 10 * 60 * 1000;
        if (!baselineOnly && (prev || recent)) {
          const cal = await calOf(sid);
          if (isPub) await hPublished(db, sid, prev ? { byUser: prev.sigs } : null, after, cal);
          else await hWaitDay(db, sid, id.split("_wday_")[1], prev ? prev.wd : null, after, cal);
        }
        next.docs[id] = isPub
          ? { rev, sigs: Object.fromEntries(Object.keys(after.byUser || {}).map((u) => [u, { sig: ((after.byUser[u] || {}).sig) || "" }])) }
          : { rev, wd: { sent: !!after.sent, sentAt: after.sentAt || 0, items: (after.items || []).filter((i) => i.subUid).map((i) => ({ subUid: i.subUid, st: i.st, p: i.p, cls: i.cls })) } };
        dirty = true;
      }
      // أيام مضت: نظّف حالتها
      Object.keys(next.docs).forEach((k) => { const m = /_wday_(\d{4}-\d{2}-\d{2})$/.exec(k); if (m && m[1] < today) { delete next.docs[k]; dirty = true; } });

      // التعاميم الجديدة
      const cq = await db.collection("circulars").doc(sid).collection("items").where("createdAt", ">", since).get();
      for (const d of cq.docs) {
        if (!mark("c_" + sid + "_" + d.id)) continue;
        if (!baselineOnly) await hCircular(db, sid, d.data(), await calOf(sid));
      }

      // اعتماد المناوبة
      const dq = await db.collection("dutyPlans").where("schoolId", "==", sid).get();
      for (const d of dq.docs) {
        const v = d.data(); if (!v.pub) continue;
        const at = v.pub.at || 0;
        if (next.duty[d.id] === at) continue;
        const had = next.duty[d.id] != null;
        next.duty[d.id] = at; dirty = true;
        if (!baselineOnly && (had || nowMs - at < 10 * 60 * 1000)) await hDuty(db, sid, v, await calOf(sid));
      }
      if (dirty) await stRef.set(next);
    } catch (e) { console.error("pushWatcher school", sid, e); }
  }

  // الزيارات الصفية (تغيّرت مؤخرًا)
  try {
    const vq = await db.collection("classVisits").where("updatedAt", ">", since).get();
    for (const d of vq.docs) {
      const v = d.data();
      if (v.kind !== "plan" || !v.teacherId || !v.schoolId) continue;
      const vsRef = ST.doc("vs_" + v.schoolId), vsS = await vsRef.get();
      const vs = vsS.exists ? vsS.data() : {};
      const prev = vs[d.id] || null;
      const cur = { v1: visitSig(v.v1), v2: visitSig(v.v2) };
      if (prev && prev.v1 === cur.v1 && prev.v2 === cur.v2) continue;
      await vsRef.set({ [d.id]: cur }, { merge: true });
      if (!baselineOnly) await hVisit(db, v.schoolId, v, prev, await calOf(v.schoolId));
    }
  } catch (e) { console.error("pushWatcher visits", e); }

  // التحويلات الجديدة
  try {
    const nq = await db.collection("notes").where("createdAt", ">", since).get();
    for (const d of nq.docs) {
      const n = d.data(); if (!n.schoolId || !mark("n_" + d.id)) continue;
      if (!baselineOnly) await hNote(db, n, await calOf(n.schoolId));
    }
  } catch (e) { console.error("pushWatcher notes", e); }

  // تنبيهات الغياب
  try {
    const aq = await db.collection("attAlerts").where("ts", ">", since).get();
    for (const d of aq.docs) {
      const a = d.data(); if (!a.schoolId || a.resolved === true || !mark("a_" + d.id)) continue;
      if (!baselineOnly) await hAttAlert(db, a, await calOf(a.schoolId));
    }
  } catch (e) { console.error("pushWatcher alerts", e); }

  await seenRef.set({ ids: [...seen].slice(-800) });
  await wmRef.set({ at: t0 });
});

/* التذكير الصباحي ٦:٥٠ من الأحد إلى الخميس — ملخص يوم كل من فعّل الإشعارات، ولا يُرسل في أيام الإجازة.
   (ز) مواعيد أولياء الأمور اليوم تصل صاحبها (الوكيل/الموجه) ضمن الملخص. */
exports.morningReminder = onSchedule({ schedule: "50 6 * * 0-4", timeZone: "Asia/Riyadh" }, async () => {
  const db = admin.firestore();
  const { key: k, wd: w } = riyadhNow();
  const schools = await db.collection("schoolData").where("_isSchool", "==", true).get();
  let total = 0;
  for (const s of schools.docs) {
    const sd = s.data(), sid = s.id;
    if (sd.active === false) continue;
    try {
      const tk = await db.collection("pushTokens").where("sid", "==", sid).get();
      if (tk.empty) continue;
      const cal = await getCalendar(db, sid);
      if (isHoliday(cal, k)) continue;
      const period = sd.activePeriod || "first";
      const ttc = db.collection("timetables").doc(sid).collection("data");
      const pub = parseVal(await ttc.doc(period + "_published").get()) || {};
      const wday = parseVal(await ttc.doc(period + "_wday_" + k).get());
      const plans = (await db.collection("dutyPlans").where("schoolId", "==", sid).get()).docs.map((d) => d.data()).filter((v) => v.period === period && v.pub);
      const visits = (await db.collection("classVisits").where("schoolId", "==", sid).get()).docs.map((d) => d.data()).filter((v) => v.kind === "plan" && v.period === period);
      const appts = (await db.collection("guidanceAppointments").where("schoolId", "==", sid).get()).docs.map((d) => d.data()).filter((a) => a.date === k && a.status === "scheduled");
      const uids = uniq(tk.docs.map((d) => d.data().uid));
      for (const uid of uids) {
        const parts = [];
        if (plans.some((v) => ((v.pub.dutyDays || {})[k] || []).includes(uid))) parts.push("مناوبة");
        const n = ((((pub.byUser || {})[uid] || {}).lessons) || []).filter((l) => l.d === w).reduce((x, l) => x + (l.n || 1), 0);
        if (n) parts.push(n === 1 ? "حصة واحدة" : n === 2 ? "حصتان" : arNum(n) + (n <= 10 ? " حصص" : " حصة"));
        if (wday && wday.sent) (wday.items || []).filter((i) => i.subUid === uid).sort((a, b) => a.p - b.p).forEach((i) => parts.push("انتظار الحصة " + ordP(i.p)));
        plans.forEach((v) => {
          const evL = {}; (v.pub.events || []).forEach((e) => { evL[e.key] = e.label; });
          const plL = {}; (v.pub.places || []).forEach((p) => { plL[p.id] = p.name; });
          const byEv = (v.pub.sup || {})[w] || {};
          Object.keys(byEv).forEach((ev) => Object.keys(byEv[ev] || {}).forEach((pl) => {
            if ((byEv[ev][pl] || []).includes(uid)) parts.push("إشراف " + (evL[ev] || "") + (plL[pl] ? " (" + plL[pl] + ")" : ""));
          }));
        });
        visits.filter((v) => v.teacherId === uid).forEach((v) => [v.v1, v.v2].forEach((x) => {
          if (x && x.date === k) parts.push("زيارة صفية" + (x.p !== "" && x.p != null ? " الحصة " + ordP(x.p) : ""));
        }));
        appts.filter((a) => a.byUserId === uid).sort((a, b) => String(a.time).localeCompare(String(b.time)))
          .forEach((a) => parts.push("موعد ولي أمر " + fmt12(a.time)));
        if (!parts.length) continue;
        await notify(db, sid, [uid], { title: "صباح الخير — يومك", body: "اليوم: " + parts.join(" · "), link: "myday.html", tag: "morning-" + k }, cal);
        total++;
      }
    } catch (e) { console.error("morningReminder", sid, e); }
  }
  console.log("morningReminder: users", total);
});

/* إرسال ما أُجِّل في ساعات الهدوء عند انتهائها */
exports.flushPushQueue = onSchedule({ schedule: "every 10 minutes", timeZone: "Asia/Riyadh" }, async () => {
  const db = admin.firestore();
  const q = await db.collection("pushQueue").where("sendAt", "<=", Date.now()).limit(300).get();
  for (const d of q.docs) {
    const v = d.data();
    try { await sendNow(db, v.uids || [], v.msg || {}); } catch (e) { console.error("flushPushQueue", d.id, e); }
    await d.ref.delete().catch(() => {});
  }
});
