// إصدار: 2026-10-14.3
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

  let emailSent = false;
  // ٣) إرسال بريد فوري (يتطلب تفعيل امتداد Trigger Email لاحقًا ليعمل فعليًا)
  if (targetEmail) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "awraqaicom@gmail.com",
        pass: GMAIL_APP_PASSWORD.value(),
      },
    });
    
    // (2026-10-13) فك الربط تم فعليًا؛ فشل البريد لا يُظهَر كفشل للعملية بل يُبلَّغ به المدير ليرسل الكلمة بنفسه
    try {
      await transporter.sendMail({
        from: "awraqaicom@gmail.com",
        to: targetEmail,
        subject: "تم فك ربط حسابك",
        text:
          "تم فك ربط بريدك القديم بناءً على طلبك.\n" +
          "كلمة المرور الأولية الجديدة لإعادة التفعيل: " + newPassword + "\n" +
          "سجّل الدخول من جديد بأي بريد وأدخل رقم هويتك وهذه الكلمة لإكمال التفعيل.",
      });
      emailSent = true;
    } catch (e) {
      console.error("unlinkUserAccount mail", e);
    }
  }

  return { success: true, email: targetEmail, emailSent };
});
const db2 = admin.firestore();

exports.requestMergeLink = onCall(
  {secrets: [GMAIL_APP_PASSWORD]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
    }
    if (request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider === "anonymous") {
      throw new HttpsError("permission-denied", "هذا الإجراء غير متاح لهذا النوع من الدخول.");
    }
    const callerUid = request.auth.uid;
    const {loginId, confirmEmail} = request.data || {};

    if (!loginId || !/^[0-9]{10,14}$/.test(loginId)) {
      throw new HttpsError("invalid-argument", "رقم هوية غير صالح.");
    }
    if (!confirmEmail) {
      throw new HttpsError("invalid-argument", "لازم تدخل البريد للتأكيد.");
    }

    // (2026-10-13) حدّ للمحاولات: لا تخمين لرقم الهوية والبريد
    const gate = await secGate("mrg_" + callerUid, 8, 30 * 60 * 1000);
    // إيجاد الحساب الآخر المطابق (سيرفريًا، لا نثق بأي شيء من المتصفح)
    const q = await db2.collection("users").where("loginId", "==", loginId).get();
    const otherDoc = q.docs.find((d) =>
      d.id !== callerUid &&
      d.data().authUid &&
      d.data().role !== "admin" &&
      d.data().role !== "schoolAdmin"
    );
    if (!otherDoc) {
      await secFail(gate);
      throw new HttpsError("not-found", "لا يوجد رقم سجل مطابق مرتبط بحساب آخر.");
    }
    const otherData = otherDoc.data();
    const realEmail = otherData.email || otherData.googleEmail || "";
    if (!realEmail || String(confirmEmail).trim().toLowerCase() !== realEmail.trim().toLowerCase()) {
      await secFail(gate);
      throw new HttpsError("permission-denied", "البريد المُدخَل غير صحيح.");
    }

    // (2026-10-13) لا نكتب شيئًا على حساب المستدعي هنا؛ يُحفظ الرقم في طلب الدمج وحده. ولا نُنشئ الطلب إن لم نستطع إيصال الكود.
    const callerDoc = await db2.collection("users").doc(callerUid).get();
    const callerEmail = callerDoc.exists ?
      (callerDoc.data().email || callerDoc.data().googleEmail || "") : "";
    if (!callerEmail) {
      throw new HttpsError("failed-precondition", "حسابك الحالي بلا بريد لإرسال الكود إليه.");
    }

    // توليد كود ٦ أرقام وحفظ طلب الدمج (صالح ٢٤ ساعة)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const mrRef = await db2.collection("mergeRequests").add({
      soloUid: callerUid,
      targetUid: otherDoc.id,
      loginId: loginId,
      code: code,
      used: false,
      createdAt: Date.now(),
      expiresAt: expiresAt,
    });

    // إرسال الكود لبريد الحساب الفردي نفسه؛ إن فشل الإرسال يُلغى الطلب ويُبلَّغ المستخدم (لا طلب معلّق بلا كود وصل)
    try {
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
    } catch (e) {
      console.error("requestMergeLink mail", e);
      await mrRef.delete().catch(() => {});
      throw new HttpsError("unavailable", "تعذّر إرسال الكود إلى بريدك الآن. أعد المحاولة بعد قليل.");
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
  if (request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "هذا الإجراء غير متاح لهذا النوع من الدخول.");
  }
  const callerUid = request.auth.uid;
  const {code} = request.data || {};

  if (!code) {
    throw new HttpsError("invalid-argument", "أدخل الكود.");
  }

  const db3 = admin.firestore();
  // (2026-10-13) حدّ للمحاولات: كود الدمج من ستة أرقام فلا يُترك للتخمين
  const gate3 = await secGate("mrgc_" + callerUid, 6, 30 * 60 * 1000);

  const q = await db3.collection("mergeRequests")
    .where("targetUid", "==", callerUid)
    .where("code", "==", String(code).trim())
    .where("used", "==", false)
    .get();

  if (q.empty) {
    await secFail(gate3);
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
   نقل سجلات المعلم عند إعادة ربط حسابه بعد فك الربط (ص-٣٦)
   الشرط (قرار المستخدم): تُنقل السجلات التي في نفس المدرسة ونفس الفترة الحالية ونفس العام الدراسي فقط.
   ما عداها (فترات/أعوام سابقة) يبقى على الحساب القديم كأرشيف ولا يُحذف.
   مصدر الحدود: schoolData/{sid} → yearFromMs/yearToMs و periods[{id,fromMs,toMs}] (إعدادات المدرسة).
   لا حدود معرّفة للعام ⇒ لا يُنقل شيء (الأمان أولًا). سجلات المعلم القديم تُعلَّم transferredTo ولا تُحذف.
   لا يشمل: الجدول المدرسي وخطط المناوبة والزيارات الصفية (يعيد المدير إسنادها).
   ========================================================================= */
const TR_REC_COLS = [
  ["attendance", "markedBy"], ["attAlerts", "byUserId"], ["leaves", "byUserId"], ["prepOverrides", "byUserId"],
  ["studentNotes", "fromUserId"], ["notes", "fromUserId"], ["guidanceSessions", "byUserId"], ["guidanceAppointments", "byUserId"],
];
function trCurrentPeriod(school, nowMs) {
  const ps = Array.isArray(school.periods) ? school.periods : [];
  const hit = ps.find((p) => p && p.fromMs != null && p.toMs != null && nowMs >= p.fromMs && nowMs <= p.toMs);
  return hit ? hit.id : (school.activePeriod || "first");
}
function trRecTime(v) {
  if (typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.date)) { const t = Date.parse(v.date.slice(0, 10) + "T12:00:00Z"); if (!isNaN(t)) return t; }
  for (const f of ["ts", "createdAt", "at", "updatedAt"]) if (typeof v[f] === "number") return v[f];
  return null;
}
/** هل السجل ضمن مدرسة/فترة/عام المعلم الحالية؟ */
function trEligible(v, sid, period, school) {
  if (!v || v.schoolId !== sid) return false;
  if (v.period && v.period !== period) return false;
  const t = trRecTime(v);
  if (t == null || school.yearFromMs == null || school.yearToMs == null) return false;
  if (t < school.yearFromMs || t > school.yearToMs) return false;
  if (!v.period) { // سجل بلا حقل فترة: يُحكم عليه بتاريخه داخل حدود الفترة الحالية إن عُرّفت
    const p = (school.periods || []).find((x) => x.id === period);
    if (p && p.fromMs != null && (t < p.fromMs || t > p.toMs)) return false;
  }
  return true;
}
exports.transferTeacherRecords = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  const uid = request.auth.uid;
  const db = admin.firestore();
  const me = await db.collection("users").doc(uid).get();
  if (!me.exists) return { moved: 0, skipped: "no-user" };
  const meData = me.data();
  if (!meData.loginId) return { moved: 0, skipped: "no-login-id" };
  const olds = (await db.collection("users").where("migratedTo", "==", uid).get()).docs
    .filter((d) => d.data().loginId && d.data().loginId === meData.loginId && d.data().schools);
  const now = Date.now();
  const out = { moved: 0, byCollection: {}, skippedSchools: [], conflicts: 0 };
  const bump = (k, n = 1) => { out.byCollection[k] = (out.byCollection[k] || 0) + n; out.moved += n; };
  for (const od of olds) {
    const oldId = od.id;
    for (const sid of Object.keys(od.data().schools || {})) {
      const myCtx = (meData.schools || {})[sid];
      if (!myCtx || myCtx.active === false) continue;
      const ss = await db.collection("schoolData").doc(sid).get();
      const school = ss.exists ? ss.data() : null;
      if (!school || school.yearFromMs == null || school.yearToMs == null) { out.skippedSchools.push({ sid, reason: "no-year-config" }); continue; }
      const period = trCurrentPeriod(school, now);

      // (أ) مستندات المعلم الواحدة (سجل الأعمال، المتابعة، الاختبارات، النتائج): معرّفها يتضمن رقم الحساب ⇒ تُنسخ بمعرّف جديد
      for (const col of ["results", "exams"]) {
        const qs = await db.collection(col).where("userId", "==", oldId).get();
        for (const d of qs.docs) {
          const v = d.data();
          if (v.schoolId !== sid || v.period !== period || v.transferredTo) continue;
          if (typeof v.updatedAt !== "number" || v.updatedAt < school.yearFromMs || v.updatedAt > school.yearToMs) continue;
          const newRef = db.collection(col).doc((v.base || "") + "_" + sid + "_" + period + "_" + uid);
          if (!v.base) continue;
          if ((await newRef.get()).exists) { out.conflicts++; continue; }
          await newRef.set(Object.assign({}, v, { userId: uid, transferredFrom: oldId }));
          await d.ref.update({ transferredTo: uid });
          bump(col);
        }
      }

      // (ب) السجلات المنفردة: يتغيّر حقل صاحب السجل فقط
      for (const [col, f] of TR_REC_COLS) {
        const qs = await db.collection(col).where(f, "==", oldId).get();
        let batch = db.batch(), n = 0;
        for (const d of qs.docs) {
          if (!trEligible(d.data(), sid, period, school)) continue;
          batch.update(d.ref, { [f]: uid, transferredFrom: oldId });
          if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
        }
        if (n % 400 !== 0) await batch.commit();
        if (n) bump(col, n);
      }

      // (ج) ملاحظات أُرسلت إليه (هو مستلم)
      const rn = await db.collection("notes").where("recipients", "array-contains", oldId).get();
      for (const d of rn.docs) {
        const v = d.data();
        if (!trEligible(v, sid, period, school)) continue;
        await d.ref.update({ recipients: (v.recipients || []).map((x) => (x === oldId ? uid : x)) });
        bump("notes-recipient");
      }

      // (د) التعاميم: قائمة المستلمين وتوقيعه (المعرّف = رقم الحساب ⇒ نسخ)
      const items = await db.collection("circulars").doc(sid).collection("items").get();
      for (const it of items.docs) {
        const iv = it.data();
        const t = trRecTime(iv);
        if (t == null || t < school.yearFromMs || t > school.yearToMs) continue;
        const rec = iv.recipients || [];
        if (!rec.includes(oldId)) continue;
        const sigNew = it.ref.collection("signatures").doc(uid);
        const sigOld = await it.ref.collection("signatures").doc(oldId).get();
        if (sigOld.exists && !sigOld.data().transferredTo && !(await sigNew.get()).exists) {
          await sigNew.set(Object.assign({}, sigOld.data(), { transferredFrom: oldId }));
          await sigOld.ref.update({ transferredTo: uid });
          bump("circular-signatures");
        }
        await it.ref.update({ recipients: rec.map((x) => (x === oldId ? uid : x)) });
        bump("circular-recipients");
      }
    }
  }
  return out;
});

/* =========================================================================
   حذف الحساب (متطلب متجر Google Play — المرحلة ١، ص-٣٦)
   - المعلم الفردي (بلا أي مدرسة): حذف فوري لبياناته وحساب الدخول.
   - موظف المدرسة: لا يحذف مباشرة (سجلاته تخص المدرسة) ⇒ يُسجَّل طلب في deletionRequests
     ويصل بريدًا إلى info@awraqai.com ليُنفَّذ بفك الربط (🔓) من admin العام. السجل يبقى معلّقًا ويمكن إعادة تفعيله.
   - الطالب والأدمن ومدير المدرسة: يُرفض الطلب برسالة توجّه للجهة المناسبة.
   ========================================================================= */
async function delAllWhere(db, col, field, val) {
  const qs = await db.collection(col).where(field, "==", val).get();
  for (let i = 0; i < qs.docs.length; i += 400) {
    const b = db.batch();
    qs.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  return qs.docs.length;
}
exports.deleteMyAccount = onCall({ secrets: [GMAIL_APP_PASSWORD] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  if (request.data && request.data.confirm !== "حذف") throw new HttpsError("invalid-argument", "لم يتم تأكيد الحذف.");
  const uid = request.auth.uid;
  const db = admin.firestore();
  const meSnap = await db.collection("users").doc(uid).get();
  if (!meSnap.exists) {
    const st = await db.collection("studentAccounts").doc(uid).get();
    if (st.exists) throw new HttpsError("failed-precondition", "حسابات الطلاب تُحذف عبر إدارة المدرسة أو بمراسلة info@awraqai.com.");
    throw new HttpsError("not-found", "لا يوجد حساب مرتبط.");
  }
  const me = meSnap.data();
  if (me.role === "admin" || me.role === "schoolAdmin") {
    throw new HttpsError("failed-precondition", "حسابات الإدارة لا تُحذف من هنا. راسل info@awraqai.com.");
  }
  const schools = Object.keys(me.schools || {});
  if (schools.length) {
    await db.collection("deletionRequests").doc(uid).set({
      uid, loginId: me.loginId || null, username: me.username || "", email: me.email || request.auth.token.email || null,
      schools, hasSolo: !!me.solo, status: "pending", requestedAt: Date.now(),
    });
    try {
      const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: "awraqaicom@gmail.com", pass: GMAIL_APP_PASSWORD.value() } });
      await transporter.sendMail({
        from: "awraqaicom@gmail.com", to: "info@awraqai.com", subject: "طلب حذف حساب — منجز المدرسي",
        text: "طلب حذف حساب موظف\nالاسم: " + (me.username || "") + "\nرقم الهوية: " + (me.loginId || "") +
          "\nالبريد: " + (me.email || request.auth.token.email || "") + "\nالمدارس: " + schools.join(", ") +
          "\nالتنفيذ: فك الربط (🔓) من إدارة المستخدمين ثم تعطيل الحساب. المعرّف: " + uid,
      });
    } catch (e) {
      console.error("deleteMyAccount mail", e);
      // (2026-10-13) لا يضيع الطلب: يُعلَّم بفشل البريد ليراه المسؤول في سجل الطلبات
      await db.collection("deletionRequests").doc(uid).update({ mailFailed: true }).catch(() => {});
    }
    return { mode: "request" };
  }
  if (!me.solo) throw new HttpsError("failed-precondition", "لا توجد بيانات للحذف على هذا الحساب.");
  // حذف فوري للمعلم الفردي
  const counts = {};
  await db.collection("schoolData").doc("roster_solo_" + uid).delete().catch(() => {});
  await db.collection("rosterIndex").doc("solo_" + uid).delete().catch(() => {});
  for (const [c, f] of [["results", "userId"], ["exams", "userId"], ["studentNotes", "fromUserId"], ["attendance", "markedBy"],
    ["worksheets", "createdBy"], ["questionBank", "createdBy"], ["submissions", "teacherUid"], ["pushTokens", "authUid"]]) {
    counts[c] = await delAllWhere(db, c, f, uid);
  }
  await db.collection("users").doc(uid).delete();
  try { await admin.auth().deleteUser(uid); } catch (e) { if (!e || e.code !== "auth/user-not-found") console.error("deleteUser", e); }
  return { mode: "deleted", counts };
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


/* [ADMIN-TOOLS:BEGIN] */
/* ============ شاشات التميز (ص-٣٧): اقتران تلفازات العرض بالمدرسة والقناة ============
   التطبيق على التلفاز يدخل مجهولًا (Anonymous Auth) فيكون uid الدخول = معرّف الشاشة.
   screenRequestCode (من التلفاز) ← رمز ٦ أرقام يصدره الخادم بعملية ذرية (لا يتكرر بين رمزين فعّالين).
   screenPeek / screenClaim (من مدير المدرسة أو المفوَّض «شاشة التميز» تعديل) ← يعاين الجهاز ثم يربطه بمدرسته وقناته.
   pairings/{الرمز} و screenClaimAttempts/{uid} مغلقة على العميل بالقواعد؛ هذه الدوال وحدها تكتب فيها. */
const exCrypto = require("crypto");
const EX_CHANNELS = ["public", "teachers", "admins"];
const EX_CODE_TTL_MS = 10 * 60 * 1000;
const EX_MAX_SCREENS = 30;

function exCanManage(u, sid) {
  if (!u || u.active === false || !sid) return false;
  if (u.role === "schoolAdmin") return (u.adminSchools || []).includes(sid);
  const c = (u.schools || {})[sid];
  if (!c || c.active === false) return false;
  const p = (c.permissions || {})["tools.excellence"];
  return !!(p && p.edit === true);
}
async function exAssertManager(db, request, sid) {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً.");
  const me = await db.collection("users").doc(request.auth.uid).get();
  if (!me.exists || !exCanManage(me.data(), sid)) throw new HttpsError("permission-denied", "ليست لديك صلاحية إدارة شاشة التميز في هذه المدرسة.");
  return me.data();
}
// ٨ محاولات فاشلة كل ١٠ دقائق كحد أقصى لكل مدير
async function exAttemptGate(db, uid) {
  const ref = db.collection("screenClaimAttempts").doc(uid);
  const now = Date.now();
  const s = await ref.get();
  const fails = ((s.exists && s.data().fails) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (fails.length >= 8) throw new HttpsError("resource-exhausted", "محاولات كثيرة خاطئة. حاول بعد قليل.");
  return { ref, fails, now };
}
async function exFail(gate) { await gate.ref.set({ fails: gate.fails.concat([gate.now]) }); }

exports.screenRequestCode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول.");
  const uid = request.auth.uid;
  const db = admin.firestore();
  const dev = request.data && request.data.device ? request.data.device : {};
  const device = {
    model: String(dev.model || "").slice(0, 60),
    platform: String(dev.platform || "").slice(0, 30),
    app: String(dev.app || "").slice(0, 20),
  };
  // مقترنة أصلًا؟
  const sc = await db.collection("screens").doc(uid).get();
  if (sc.exists) return { paired: true };
  const now = Date.now();
  // رمز فعّال سابق لنفس الجهاز: نعيده بدل إصدار آخر
  const prev = await db.collection("pairings").where("uid", "==", uid).get();
  for (const d of prev.docs) {
    const v = d.data();
    if (v.expiresAt > now + 30000) return { code: d.id, expiresAt: v.expiresAt };
    await d.ref.delete();
  }
  for (let i = 0; i < 15; i++) {
    const code = String(100000 + exCrypto.randomInt(900000));
    const ref = db.collection("pairings").doc(code);
    const ok = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists && s.data().expiresAt > now) return false;
      tx.set(ref, { uid, device, createdAt: now, expiresAt: now + EX_CODE_TTL_MS });
      return true;
    });
    if (ok) return { code, expiresAt: now + EX_CODE_TTL_MS };
  }
  throw new HttpsError("unavailable", "تعذّر إصدار رمز. أعد المحاولة.");
});

exports.screenPeek = onCall(async (request) => {
  const db = admin.firestore();
  const sid = request.data && request.data.sid;
  const code = String((request.data && request.data.code) || "").trim();
  await exAssertManager(db, request, sid);
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "الرمز ٦ أرقام.");
  const gate = await exAttemptGate(db, request.auth.uid);
  const s = await db.collection("pairings").doc(code).get();
  if (!s.exists || s.data().expiresAt < Date.now()) { await exFail(gate); throw new HttpsError("not-found", "الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا من التلفاز."); }
  const v = s.data();
  return { device: v.device || {}, createdAt: v.createdAt, expiresAt: v.expiresAt };
});

exports.screenClaim = onCall(async (request) => {
  const db = admin.firestore();
  const d = request.data || {};
  const sid = d.sid, code = String(d.code || "").trim(), channel = d.channel;
  const name = String(d.name || "").trim().slice(0, 40);
  const me = await exAssertManager(db, request, sid);
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "الرمز ٦ أرقام.");
  if (!EX_CHANNELS.includes(channel)) throw new HttpsError("invalid-argument", "قناة غير صحيحة.");
  if (!name) throw new HttpsError("invalid-argument", "اكتب اسمًا للشاشة.");
  const gate = await exAttemptGate(db, request.auth.uid);
  const count = (await db.collection("screens").where("schoolId", "==", sid).get()).size;
  if (count >= EX_MAX_SCREENS) throw new HttpsError("failed-precondition", "بلغت المدرسة الحد الأقصى للشاشات (" + EX_MAX_SCREENS + ").");
  const pref = db.collection("pairings").doc(code);
  const now = Date.now();
  const res = await db.runTransaction(async (tx) => {
    const s = await tx.get(pref);
    if (!s.exists || s.data().expiresAt < now) return null;
    const v = s.data();
    tx.set(db.collection("screens").doc(v.uid), {
      schoolId: sid, channel, name, device: v.device || {}, active: true,
      pairedAt: now, pairedBy: request.auth.uid, pairedByName: me.username || "", lastSeen: null, updatedAt: now,
    });
    tx.delete(pref);
    return v.uid;
  });
  if (!res) { await exFail(gate); throw new HttpsError("not-found", "الرمز غير صحيح أو انتهت صلاحيته."); }
  return { id: res };
});

// تنظيف الرموز المنتهية (كل ساعة)
exports.cleanupScreenPairings = onSchedule({ schedule: "every 60 minutes", timeZone: "Asia/Riyadh" }, async () => {
  const db = admin.firestore();
  const old = await db.collection("pairings").where("expiresAt", "<", Date.now() - 60 * 60 * 1000).limit(300).get();
  const b = db.batch();
  old.docs.forEach((d) => b.delete(d.ref));
  if (!old.empty) await b.commit();
});
/* [ADMIN-TOOLS:END] */

/* ============================================================================================
   الأمان (2026-10-12): دوال تحل محل قراءات/كتابات مجموعة users وstudentAccounts الواسعة من المتصفح
   بعد تضييق firestore.rules: لا يقرأ أي مستخدم مستندات الآخرين مباشرة ولا يكتب صلاحياته بنفسه.
   كل الدوال تتحقق من المستدعي سيرفريًا. لا مجموعات جديدة تُفتح للعميل (secAttempts وsystemCounters مغلقتان).
   ============================================================================================ */
const secDb = () => admin.firestore();
const secFV = admin.firestore.FieldValue;
const secMsg = (code, m) => new HttpsError(code, m);

function secIsAdmin(u) { return !!u && u.role === "admin" && u.active !== false; }
function secAdminSchools(u) { return (u && u.role === "schoolAdmin" && u.active !== false) ? (u.adminSchools || []) : []; }
function secIsSchoolAdminOf(u, sid) { return !!sid && secAdminSchools(u).includes(sid); }
function secStaffCtx(u, sid) {
  const c = ((u && u.schools) || {})[sid];
  return (c && c.active !== false) ? c : null;
}
function secPerm(ctx, key, f) { const p = ((ctx && ctx.permissions) || {})[key]; return !!(p && p[f] === true); }
function secEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && exCrypto.timingSafeEqual(x, y);
}
function secMask(email) {
  if (!email) return "غير معروف";
  const parts = String(email).split("@");
  return parts[0].slice(0, 2) + "***@" + (parts[1] || "");
}
async function secCaller(request, opts) {
  if (!request.auth) throw secMsg("unauthenticated", "يجب تسجيل الدخول أولاً.");
  const tok = request.auth.token || {};
  if (tok.firebase && tok.firebase.sign_in_provider === "anonymous") throw secMsg("permission-denied", "هذا الإجراء غير متاح لهذا النوع من الدخول.");
  const s = await secDb().collection("users").doc(request.auth.uid).get();
  const out = { uid: request.auth.uid, tok, ref: s.ref, exists: s.exists, data: s.exists ? s.data() : null };
  if (opts && opts.needDoc && !out.exists) throw secMsg("permission-denied", "لا يوجد حساب مرتبط بهذا الدخول.");
  // (2026-10-14.3) إغلاق كامل بعد نهاية العام الدراسي: لا يعمل أحد غير أدمن النظام (إلا ما نصّ عليه allowClosed)
  if (!(opts && opts.allowClosed) && !secIsAdmin(out.data)) {
    const cal = await secCalendar();
    if (secYearEnded(cal, Date.now())) throw secYearClosedError(cal);
  }
  return out;
}
/* ===== (2026-10-14.3) الإغلاق الكامل بعد نهاية العام =====
   settings/academicCalendar.endMs هو آخر لحظة في العام (23:59:59.999 بتوقيت الرياض). بعدها يُغلق النظام لكل المستخدمين
   عدا أدمن النظام، حتى يُحفظ تقويم عام جديد (endMs أبعد). تُخزَّن قراءة التقويم دقيقة واحدة في ذاكرة الدالة. */
let SEC_CAL_CACHE = { at: 0, v: null };
async function secCalendar(force) {
  const dtc = Date.now() - SEC_CAL_CACHE.at;
  if (!force && SEC_CAL_CACHE.at && dtc >= 0 && dtc < 60000) return SEC_CAL_CACHE.v;
  const s = await secDb().collection("settings").doc("academicCalendar").get();
  SEC_CAL_CACHE = { at: Date.now(), v: s.exists ? s.data() : null };
  return SEC_CAL_CACHE.v;
}
function secYearEnded(cal, nowMs) { return !!cal && typeof cal.endMs === "number" && nowMs > cal.endMs; }
function secYearClosedError(cal) {
  return new HttpsError("failed-precondition",
    "انتهى العام الدراسي" + (cal && cal.year ? " " + cal.year : "") + "، والنظام مغلق إلى حين اعتماد العام الدراسي الجديد. للاستفسار تواصل مع إدارة النظام.",
    { yearClosed: true, year: (cal && cal.year) || null });
}
// محاولات فاشلة محدودة لكل مفتاح (سجل في secAttempts — مغلق على العميل)
async function secGate(key, max, windowMs) {
  const ref = secDb().collection("secAttempts").doc(key);
  const now = Date.now();
  const s = await ref.get();
  const fails = ((s.exists && s.data().fails) || []).filter((t) => now - t < windowMs);
  if (fails.length >= max) throw secMsg("resource-exhausted", "محاولات خاطئة كثيرة. حاول بعد قليل.");
  return { ref, fails, now };
}
// هل هذا الدخول/البريد لحساب طالب مسجَّل؟ (يمنع أن يصير الطالب معلمًا بنفس البريد)
async function secIsStudent(uid, email) {
  const db = secDb();
  if ((await db.collection("studentAccounts").doc(uid).get()).exists) return true;
  const ems = Array.from(new Set([String(email || "").trim(), String(email || "").trim().toLowerCase()])).filter(Boolean);
  for (const e of ems) {
    if (!(await db.collection("studentAccounts").where("email", "==", e).limit(1).get()).empty) return true;
  }
  return false;
}
const SEC_STUDENT_MSG = "هذا البريد مسجَّل كحساب طالب، ولا يمكن استخدامه لحساب معلم أو منسوب مدرسة. استخدم بريدًا آخر.";
async function secFail(g) { await g.ref.set({ fails: g.fails.concat([g.now]) }); }

// هل يملك المستدعي صلاحية «مدير» على مستخدمي هذه المدرسة (يرى أرقام الهوية والبريد وكلمات المرور الأولية للمعلَّقين)؟
function secIsUserManager(u, sid) {
  if (secIsAdmin(u)) return true;
  if (secIsSchoolAdminOf(u, sid)) return true;
  const c = secStaffCtx(u, sid);
  return !!c && (secPerm(c, "index.users", "access") || secPerm(c, "tools.timetable", "access") || secPerm(c, "tools.timetable", "edit"));
}
const SEC_SENSITIVE = ["password", "loginId", "email", "googleEmail", "mergeRequestAt", "mergeRequestTarget"];

/* قائمة مستخدمي مدرسة (أو كل المستخدمين للأدمن العام بلا schoolId).
   الأدمن العام ومدير المدرسة ومن لديه «المستخدمون»/«الجدول المدرسي» يرون أرقام الهوية والبريد، وكلمة المرور الأولية
   للسجلات المعلَّقة تُعاد لمدير المدرسة والأدمن فقط. غيرهم يرى الأسماء والسياق الوظيفي بلا حقول حساسة. */
exports.listSchoolUsers = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  const u = me.data;
  const sid = request.data && request.data.schoolId ? String(request.data.schoolId) : null;
  const isAdm = secIsAdmin(u);
  if (!isAdm) {
    if (!sid) throw secMsg("invalid-argument", "حدّد المدرسة.");
    if (!(secIsSchoolAdminOf(u, sid) || secStaffCtx(u, sid))) throw secMsg("permission-denied", "ليست لديك صلاحية على هذه المدرسة.");
  }
  const db = secDb();
  const byId = new Map();
  if (!sid) {
    (await db.collection("users").get()).docs.forEach((d) => byId.set(d.id, d));
  } else {
    const col = db.collection("users");
    const FP = admin.firestore.FieldPath;
    const [a, b, c] = await Promise.all([
      col.where(new FP("schools", sid, "role"), ">=", "").get(),
      col.where("schoolId", "==", sid).get(),
      col.where("adminSchools", "array-contains", sid).get(),
    ]);
    [a, b, c].forEach((qs) => qs.docs.forEach((d) => byId.set(d.id, d)));
  }
  const mgr = sid ? secIsUserManager(u, sid) : isAdm;
  const pwOk = isAdm || (sid && secIsSchoolAdminOf(u, sid));
  const wantIds = !!(request.data && request.data.withIds);
  const users = [];
  byId.forEach((d, id) => {
    const x = d.data();
    const out = Object.assign({}, x);
    const pending = !x.authUid;
    if (!(pending && pwOk)) delete out.password;
    if (!(mgr && (wantIds || pwOk))) { SEC_SENSITIVE.forEach((k) => { if (k !== "password") delete out[k]; }); }
    users.push({ id, data: out });
  });
  return { users };
});

/* معلومات رقم هوية: تعارضه بمدرسة (لمن يدير المستخدمين)، ووجود حساب مفعَّل آخر بنفس الرقم (بريد مُقنَّع فقط) */
exports.loginIdInfo = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  const d = request.data || {};
  const loginId = String(d.loginId || "").trim();
  if (!loginId || loginId.length > 40) throw secMsg("invalid-argument", "رقم هوية غير صالح.");
  const sid = d.schoolId ? String(d.schoolId) : null;
  const exclude = d.excludeDocId ? String(d.excludeDocId) : null;
  const qs = await secDb().collection("users").where("loginId", "==", loginId).get();
  const out = {};
  if (sid) {
    if (!secIsUserManager(me.data, sid)) throw secMsg("permission-denied", "ليست لديك صلاحية على هذه المدرسة.");
    let conflict = false;
    for (const x of qs.docs) {
      if (exclude && x.id === exclude) continue;
      const v = x.data();
      if (v.migratedTo) continue;
      if (!v.authUid) { if (v.schoolId === sid) conflict = true; }
      else if (v.role === "schoolAdmin") { if ((v.adminSchools || []).includes(sid)) conflict = true; }
      else if (v.schools && v.schools[sid]) conflict = true;
    }
    out.conflictAtSchool = conflict;
  }
  if (d.wantElsewhere) {
    const hit = qs.docs.find((x) => x.id !== me.uid && x.data().authUid && x.data().role !== "admin" && x.data().role !== "schoolAdmin");
    out.activatedElsewhere = hit ? { found: true, maskedEmail: secMask(hit.data().email || hit.data().googleEmail) } : null;
  }
  return out;
});

/* السجلات المعلَّقة الأخرى (بمدارس أخرى) لنفس رقم هوية المستدعي — بلا أي بيانات حساسة */
async function secPendingFor(me, excludeId, blocked) {
  const lid = me && me.loginId;
  if (!lid) return [];
  const bl = blocked || me.blockedSchools || [];
  const qs = await secDb().collection("users").where("loginId", "==", lid).get();
  return qs.docs
    .filter((x) => x.id !== excludeId && !x.data().migratedTo && !x.data().authUid && x.data().active !== false && !bl.includes(x.data().schoolId))
    .map((x) => ({ id: x.id, schoolId: x.data().schoolId || null, role: x.data().role || null, loginId: x.data().loginId, skippedOnce: !!x.data().skippedOnce }));
}
exports.discoverPending = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  if (me.data.role === "admin" || me.data.role === "schoolAdmin") return { pending: [] };
  return { pending: await secPendingFor(me.data, null, null) };
});

async function secTemplatePerms(role) {
  try {
    const s = await secDb().collection("schoolData").doc("roleTemplates").get();
    const t = s.exists && ((s.data().templates || {})[role]);
    if (t && typeof t === "object" && Object.keys(t).length) return t;
  } catch (e) { /* يُترك للقيمة الافتراضية */ }
  return {};
}

/* تفعيل موظف بتحقق سيرفري من رقم الهوية وكلمة المرور الأولية، وإنشاء مستنده الموحَّد */
exports.activateStaff = onCall(async (request) => {
  const me = await secCaller(request);
  const tok = me.tok;
  if (tok.email_verified !== true) throw secMsg("failed-precondition", "يجب تأكيد بريدك أولًا ثم إعادة المحاولة.");
  const d = request.data || {};
  const seat = String(d.seat || "").trim();
  const temp = String(d.temp || "");
  if (!seat || !temp || seat.length > 40) throw secMsg("invalid-argument", "أدخل رقم الهوية وكلمة المرور الأولية");
  const gate = await secGate("act_" + me.uid, 10, 30 * 60 * 1000);
  if (await secIsStudent(me.uid, tok.email)) throw secMsg("permission-denied", SEC_STUDENT_MSG);
  const db = secDb();
  const users = db.collection("users");
  let qs = await users.where("loginId", "==", seat).get();
  let docs = qs.docs.filter((x) => !x.data().migratedTo && !x.data().authUid);
  if (!docs.length) {
    qs = await users.where("username", "==", seat).get();
    docs = qs.docs.filter((x) => !x.data().migratedTo && !x.data().authUid);
  }
  if (!docs.length) { await secFail(gate); throw secMsg("not-found", "رقم الهوية غير موجود، أو تم تفعيله مسبقاً. راجع الإدارة."); }
  const activeDocs = docs.filter((x) => x.data().active !== false);
  const pd = activeDocs.find((x) => secEq(x.data().password, temp)) || docs.find((x) => secEq(x.data().password, temp));
  if (!pd) {
    await secFail(gate);
    const d0 = activeDocs[0] || docs[0];
    if (d0.data().active === false) throw secMsg("failed-precondition", "هذا الحساب معطّل. راجع المسؤول");
    throw secMsg("permission-denied", "كلمة المرور الأولية غير صحيحة");
  }
  const data = pd.data();
  if (data.active === false) throw secMsg("failed-precondition", "هذا الحساب معطّل. راجع المسؤول");

  // رقم الهوية مرتبط بحساب مفعَّل بمصادقة أخرى: نوجّه للدخول بالحساب الأصلي (يُكشف بريده بعد نجاح التحقق من كلمة المرور فقط)
  const all = await users.where("loginId", "==", seat).get();
  const hit = all.docs.find((x) => x.id !== me.uid && x.data().authUid && x.data().authUid !== me.uid
    && x.data().role !== "admin" && x.data().role !== "schoolAdmin");
  if (hit) return { status: "already", already: { email: hit.data().email || null, googleEmail: hit.data().googleEmail || null } };

  const now = Date.now();
  const email = tok.email || null;
  const existingSnap = await me.ref.get();
  let kind;
  if (data.schools || data.solo) {
    if (existingSnap.exists) throw secMsg("failed-precondition", "حسابك الحالي مرتبط بحساب آخر بالفعل — لا يمكن إعادة ربط حساب كامل عليه. راجع admin العام.");
    const payload = Object.assign({}, data, { authUid: me.uid, email, updatedAt: now });
    delete payload.password;
    await me.ref.set(payload);
    await pd.ref.update({ migratedTo: me.uid, password: secFV.delete() });
    kind = "relink";
  } else if (data.role === "schoolAdmin") {
    const ur = await admin.auth().getUser(me.uid);
    const isGoogle = (ur.providerData || []).some((p) => p.providerId === "google.com");
    if (!isGoogle) return { status: "needGoogle" };
    if (existingSnap.exists) throw secMsg("failed-precondition", "لديك حساب مدير مفعَّل مسبقًا — إضافة مدرسة أخرى لحسابك تتم مباشرة من admin العام، لا عبر هذا التفعيل.");
    await me.ref.set({ role: "schoolAdmin", authUid: me.uid, email, googleEmail: email, username: data.username, active: true,
      adminSchools: [data.schoolId], loginId: seat, createdAt: now, updatedAt: now });
    await pd.ref.update({ migratedTo: me.uid, password: secFV.delete() });
    kind = "schoolAdmin";
  } else {
    if (data.role === "admin") throw secMsg("failed-precondition", "تفعيل حساب أدمن النظام لا يتم من هذه الشاشة. تواصل مع مالك النظام.");
    const perms = (data.permissions && Object.keys(data.permissions).length) ? data.permissions : await secTemplatePerms(data.role);
    const ctxPayload = { role: data.role, permissions: perms, assignedClasses: data.assignedClasses || [], active: true };
    if (!data.schoolId) throw secMsg("failed-precondition", "السجل غير مرتبط بمدرسة. راجع الإدارة.");
    if (!existingSnap.exists) {
      await me.ref.set({ authUid: me.uid, email, username: data.username, loginId: seat,
        schools: { [data.schoolId]: ctxPayload }, createdAt: now, updatedAt: now });
    } else if (existingSnap.data().role !== "admin" && existingSnap.data().role !== "schoolAdmin") {
      const FP = admin.firestore.FieldPath;
      const args = [new FP("schools", data.schoolId), ctxPayload, "updatedAt", now];
      if (!existingSnap.data().loginId) args.push("loginId", seat);
      await me.ref.update(...args);
    } else {
      throw secMsg("failed-precondition", "حسابك الحالي حساب أدمن/مدير — لا يمكن إضافة سياق موظف عادي عليه.");
    }
    await pd.ref.update({ migratedTo: me.uid, password: secFV.delete() });
    kind = "staff";
  }
  const meNow = (await me.ref.get()).data() || {};
  const others = await secPendingFor(Object.assign({}, meNow, { loginId: seat }), pd.id, meNow.blockedSchools || []);
  return { status: "activated", kind, others };
});

/* تفعيل مدرسة إضافية (سجل معلَّق آخر لنفس رقم الهوية) بعد التحقق من كلمة مرورها الأولية */
exports.activateExtraSchool = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  if (me.data.role === "admin" || me.data.role === "schoolAdmin" || !me.data.loginId) throw secMsg("permission-denied", "غير متاح لهذا الحساب.");
  const d = request.data || {};
  const pid = String(d.pendingId || ""), temp = String(d.temp || "");
  if (!pid || !temp) throw secMsg("invalid-argument", "بيانات ناقصة.");
  const gate = await secGate("act_" + me.uid, 10, 30 * 60 * 1000);
  const ps = await secDb().collection("users").doc(pid).get();
  const p = ps.exists ? ps.data() : null;
  if (!p || p.authUid || p.migratedTo || p.active === false || p.loginId !== me.data.loginId || !p.schoolId) {
    throw secMsg("not-found", "السجل غير متاح للتفعيل.");
  }
  if (!secEq(p.password, temp)) { await secFail(gate); throw secMsg("permission-denied", "كلمة المرور الأولية غير صحيحة"); }
  const perms = (p.permissions && Object.keys(p.permissions).length) ? p.permissions : await secTemplatePerms(p.role);
  const ctxPayload = { role: p.role, permissions: perms, assignedClasses: p.assignedClasses || [], active: true };
  await me.ref.update(new admin.firestore.FieldPath("schools", p.schoolId), ctxPayload, "updatedAt", Date.now());
  await ps.ref.update({ migratedTo: me.uid, password: secFV.delete() });
  return { ok: true };
});

/* تخطّي سجل معلَّق آخر أو حظر مدرسته نهائيًا */
exports.skipPending = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  if (!me.data.loginId) throw secMsg("permission-denied", "غير متاح لهذا الحساب.");
  const d = request.data || {};
  const ps = await secDb().collection("users").doc(String(d.pendingId || "")).get();
  const p = ps.exists ? ps.data() : null;
  if (!p || p.authUid || p.migratedTo || p.loginId !== me.data.loginId) throw secMsg("not-found", "السجل غير متاح.");
  const now = Date.now();
  if (d.block) {
    await me.ref.update({ blockedSchools: secFV.arrayUnion(p.schoolId), updatedAt: now });
    await ps.ref.update({ active: false, updatedAt: now });
  } else {
    await ps.ref.update({ active: false, skippedOnce: true, updatedAt: now });
  }
  return { ok: true };
});

/* إنشاء الحساب الفردي (تجربة ٣٠ يومًا تُحسب هنا لا في المتصفح) أو إضافة سياق الفردي لمستند موجود */
const SEC_SOLO_TRIAL_MS = 30 * 24 * 60 * 60 * 1000;   // الافتراضي إن لم يضبط الأدمن settings/soloTrial
/* (2026-10-14.2) مدة التجربة بالأيام يضبطها الأدمن في settings/soloTrial = {days}: 0 = بلا تجربة، وتسري على الحسابات الجديدة فقط */
async function secSoloTrialMs() {
  try {
    const s = await secDb().collection("settings").doc("soloTrial").get();
    const n = s.exists ? Number(s.data().days) : NaN;
    if (isFinite(n) && n >= 0 && n <= 3650) return Math.floor(n) * 86400000;
  } catch (e) { /* يبقى الافتراضي */ }
  return SEC_SOLO_TRIAL_MS;
}
async function secNextSoloCode() {
  const db = secDb();
  const ref = db.collection("systemCounters").doc("soloTeacher");
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    let max;
    if (s.exists) max = s.data().max || 0;
    else {
      max = 0;
      (await db.collection("users").where("isSolo", "==", true).get()).docs.forEach((x) => {
        const n = parseInt(String(x.data().teacherCode || "").replace(/^T/, ""), 10);
        if (!isNaN(n) && n > max) max = n;
      });
    }
    tx.set(ref, { max: max + 1 });
    return "T" + (max + 1);
  });
}
exports.registerSolo = onCall(async (request) => {
  const me = await secCaller(request);
  if (me.tok.email_verified !== true) throw secMsg("failed-precondition", "يجب تأكيد بريدك أولًا.");
  if (await secIsStudent(me.uid, me.tok.email)) throw secMsg("permission-denied", SEC_STUDENT_MSG);
  const db = secDb();
  const q = await db.collection("users").where("authUid", "==", me.uid).limit(1).get();
  const now = Date.now();
  const trialMs = await secSoloTrialMs();
  if (q.empty) {
    const email = me.tok.email || "";
    const data = {
      username: me.tok.name || (email.split("@")[0] || "مستخدم"),
      email, authUid: me.uid, teacherCode: await secNextSoloCode(), isSolo: true, loginId: null,
      solo: { active: true, subscribedAt: now, subscriptionEnds: now + trialMs },
      createdAt: now, updatedAt: now,
    };
    await db.collection("users").doc(me.uid).set(data);
    return { docId: me.uid, data };
  }
  const doc = q.docs[0];
  const data = doc.data();
  if (!data.solo && data.role !== "admin" && data.role !== "schoolAdmin") {
    const solo = { active: true, subscribedAt: now, subscriptionEnds: now + trialMs };
    const teacherCode = data.teacherCode || await secNextSoloCode();
    await doc.ref.update({ solo, teacherCode, isSolo: true, updatedAt: now });
    Object.assign(data, { solo, teacherCode, isSolo: true, updatedAt: now });
  }
  return { docId: doc.id, data };
});

/* ---------------- الطالب ---------------- */
async function secBelongsToStaff(uid, email) {
  const db = secDb();
  if ((await db.collection("users").doc(uid).get()).exists) return true;
  if (!(await db.collection("users").where("authUid", "==", uid).limit(1).get()).empty) return true;
  const ems = Array.from(new Set([String(email || "").trim(), String(email || "").trim().toLowerCase()])).filter(Boolean);
  for (const e of ems) {
    if (!(await db.collection("users").where("email", "==", e).limit(1).get()).empty) return true;
    if (!(await db.collection("users").where("googleEmail", "==", e).limit(1).get()).empty) return true;
  }
  return false;
}
// دخول الطالب بحساب Google: حساب موجود بالـuid ← مباشرة، أو بالبريد ← يُنقل لمعرّف الدخول الجديد، وإلا طالب جديد يحتاج التحقق
exports.studentSignIn = onCall(async (request) => {
  const me = await secCaller(request);
  const email = me.tok.email;
  if (!email) throw secMsg("failed-precondition", "تعذّر قراءة بريدك من حساب Google.");
  if (await secBelongsToStaff(me.uid, email)) return { status: "staff" };
  const db = secDb();
  const cols = db.collection("studentAccounts");
  const q = await cols.where("googleUid", "==", me.uid).limit(1).get();
  if (!q.empty) { const x = q.docs[0].data(); return { status: "ok", account: { id: q.docs[0].id, seat: x.seat, name: x.name || me.tok.name || "" } }; }
  const qe = await cols.where("email", "==", email).limit(1).get();
  if (!qe.empty) {
    const old = qe.docs[0]; const x = old.data();
    const payload = Object.assign({}, x, { googleUid: me.uid, name: x.name || me.tok.name || "", updatedAt: Date.now() });
    await cols.doc(me.uid).set(payload);
    if (old.id !== me.uid) await old.ref.delete();
    return { status: "ok", account: { id: me.uid, seat: x.seat, name: payload.name } };
  }
  return { status: "new" };
});
// التحقق من هوية الطالب ورمز فصله ثم إنشاء حسابه
exports.studentVerify = onCall(async (request) => {
  const me = await secCaller(request);
  const email = me.tok.email;
  if (!email) throw secMsg("failed-precondition", "تعذّر قراءة بريدك من حساب Google.");
  const d = request.data || {};
  const seat = String(d.seat || "").trim();
  const code = String(d.code || "").trim().toUpperCase();
  if (!seat || !code || seat.length > 40) throw secMsg("invalid-argument", "أدخل رقم الهوية ورمز الفصل.");
  if (await secBelongsToStaff(me.uid, email)) throw secMsg("permission-denied", "هذا البريد مسجَّل في النظام كحساب معلم أو منسوب مدرسة، ولا يمكن استخدامه في دخول الطالب.");
  const gate = await secGate("stu_" + me.uid, 8, 30 * 60 * 1000);
  const db = secDb();
  const snap = await db.collection("rosterIndex").where("seatList", "array-contains", seat).get();
  if (snap.empty) { await secFail(gate); throw secMsg("not-found", "رقم الهوية غير مسجّل لدى أي معلم. تأكد منه مع معلمك."); }
  let matched = null;
  snap.docs.forEach((x) => {
    const r = x.data();
    ((r.classBySeat || {})[seat] || []).forEach((cc) => {
      const meta = (r.classMeta || {})[cc];
      if (meta && meta.loginCode && String(meta.loginCode).toUpperCase() === code) matched = { rosterId: r.rosterId, classCode: cc };
    });
  });
  if (!matched) { await secFail(gate); throw secMsg("permission-denied", "رمز الفصل لا يطابق أي فصل أنت مسجَّل فيه. تأكد منه مع معلمك."); }
  const taken = await db.collection("studentAccounts").where("seat", "==", seat).limit(1).get();
  if (!taken.empty) throw secMsg("already-exists", "رقم الهوية هذا مرتبط بحساب آخر بالفعل. إن كان حسابك، سجّل الدخول بالبريد نفسه، وإلا راجع معلمك.");
  const now = Date.now();
  const payload = { googleUid: me.uid, email, name: me.tok.name || "", seat, linkedRosters: [matched.rosterId], verifiedAt: now, updatedAt: now };
  await db.collection("studentAccounts").doc(me.uid).set(payload);
  return { status: "ok", account: { id: me.uid, seat, name: payload.name } };
});
/* (2026-10-13 · المرحلة ٥) قراءة فهرس الطلاب صارت للخادم وحده: الطالب يرى فصوله هو فقط، ولا يصل لمتصفحه
   رمز دخول أي فصل ولا هوية غيره. رقم الهوية يؤخذ من حساب الطالب المخزَّن لا مما يرسله المتصفح. */
async function secStudentAccount(me) {
  const s = await secDb().collection("studentAccounts").doc(me.uid).get();
  if (!s.exists || !s.data().seat) throw secMsg("permission-denied", "لا يوجد حساب طالب مرتبط بهذا الدخول.");
  return s;
}
exports.studentMemberships = onCall(async (request) => {
  const me = await secCaller(request);
  const acc = await secStudentAccount(me);
  const seat = String(acc.data().seat);
  const linked = (acc.data().linkedRosters || []).map(String);
  const snap = await secDb().collection("rosterIndex").where("seatList", "array-contains", seat).get();
  const approved = [], invites = [];
  snap.docs.forEach((d) => {
    const r = d.data();
    const classCodes = ((r.classBySeat || {})[seat] || []).map(String);
    if (!classCodes.length) return;
    if (r.kind === "solo" && !linked.includes(String(r.rosterId))) {
      invites.push({ rosterId: String(r.rosterId), ownerName: r.ownerName || "معلم",
        classNames: classCodes.map((cc) => ((r.classMeta || {})[cc] || {}).name || cc) });
    } else {
      approved.push({ rosterId: String(r.rosterId), kind: r.kind, classCodes });
    }
  });
  return { approved, invites };
});
exports.studentConfirmInvite = onCall(async (request) => {
  const me = await secCaller(request);
  const acc = await secStudentAccount(me);
  const seat = String(acc.data().seat);
  const d = request.data || {};
  const rosterId = String(d.rosterId || "").trim();
  const code = String(d.code || "").trim().toUpperCase();
  if (!rosterId || !code || rosterId.length > 200 || code.length > 40) throw secMsg("invalid-argument", "أدخل رمز الفصل.");
  const gate = await secGate("inv_" + me.uid, 8, 30 * 60 * 1000);
  const rs = await secDb().collection("rosterIndex").doc(rosterId).get();
  const r = rs.exists ? rs.data() : {};
  const mine = (r.classBySeat || {})[seat] || [];
  const ok = r.kind === "solo" && mine.some((cc) => {
    const lc = ((r.classMeta || {})[cc] || {}).loginCode;
    return lc && String(lc).toUpperCase() === code;
  });
  if (!ok) { await secFail(gate); throw secMsg("permission-denied", "الرمز لا يطابق فصلك لدى هذا المعلم."); }
  await acc.ref.update({ linkedRosters: admin.firestore.FieldValue.arrayUnion(rosterId), updatedAt: Date.now() });
  return { ok: true };
});
// أرقام هوية طلاب فعّلوا حساباتهم (شارة «مفعَّل» عند المعلم) — بلا أي بيانات أخرى
exports.activatedSeats = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  const u = me.data;
  if (!(u.solo || u.schools || u.role === "admin" || u.role === "schoolAdmin")) throw secMsg("permission-denied", "غير متاح.");
  const seats = Array.from(new Set(((request.data && request.data.seats) || []).map(String).filter(Boolean))).slice(0, 1500);
  const found = [];
  for (let i = 0; i < seats.length; i += 30) {
    const qs = await secDb().collection("studentAccounts").where("seat", "in", seats.slice(i, i + 30)).get();
    qs.docs.forEach((x) => found.push(String(x.data().seat)));
  }
  return { seats: found };
});


/* ============================================================================================
   المرحلة ٤ (2026-10-13): اشتراك المعلم الفردي
   - secExtendSolo: نقطة التمديد الوحيدة (الأدمن الآن، وبوابة الدفع الإلكتروني لاحقًا): التاريخ الجديد = (الأبعد من اليوم أو
     تاريخ الانتهاء الحالي) + المدة، فمن يجدّد قبل الانتهاء لا يخسر أيامه. يُفعِّل السياق ويسجّل مصدر التجديد.
   - adminSoloSubscription: واجهة الأدمن العام (تجديد بالأيام، أو ضبط تاريخ، أو تفعيل/إيقاف السياق الفردي).
   - cleanupExpiredSolo: يوميًا؛ حذف بيانات الفردي بعد ٩٠ يومًا من الانتهاء. «تسجيل فقط» افتراضيًا حتى يُفعَّل الحذف الفعلي بـ
     systemCounters/soloCleanup = { live: true } من لوحة Firebase (مجموعة مغلقة على العميل). السجل في soloCleanupLog.
   ============================================================================================ */
const SEC_DAY_MS = 24 * 60 * 60 * 1000;
const SEC_SOLO_KEEP_DAYS = 90;

async function secExtendSolo(db, uid, days, source) {
  const n = Number(days);
  if (!uid || !isFinite(n) || n <= 0 || n > 3660) throw secMsg("invalid-argument", "مدة التمديد غير صالحة.");
  const ref = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw secMsg("not-found", "الحساب غير موجود.");
    const u = s.data();
    if (u.role === "admin" || u.role === "schoolAdmin") throw secMsg("failed-precondition", "لا اشتراك فردي لهذا النوع من الحسابات.");
    if (!u.solo) throw secMsg("failed-precondition", "هذا الحساب بلا سياق فردي.");
    const now = Date.now();
    const base = Math.max(now, u.solo.subscriptionEnds || 0);
    const ends = base + Math.round(n * SEC_DAY_MS);
    const solo = Object.assign({}, u.solo, { active: true, subscriptionEnds: ends, lastRenewedAt: now, lastRenewSource: source || "admin" });
    tx.update(ref, { solo, isSolo: true, updatedAt: now });
    return { ends };
  });
}

exports.adminSoloSubscription = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  if (!secIsAdmin(me.data)) throw secMsg("permission-denied", "مقصور على أدمن النظام العام.");
  const d = request.data || {};
  const uid = String(d.uid || "");
  if (!uid) throw secMsg("invalid-argument", "حدّد الحساب.");
  const db = secDb();
  if (d.extendDays != null) {
    const r = await secExtendSolo(db, uid, d.extendDays, "admin:" + me.uid);
    return { ok: true, ends: r.ends };
  }
  const ref = db.collection("users").doc(uid);
  const s = await ref.get();
  if (!s.exists) throw secMsg("not-found", "الحساب غير موجود.");
  const u = s.data();
  if (!u.solo || u.role === "admin" || u.role === "schoolAdmin") throw secMsg("failed-precondition", "هذا الحساب بلا سياق فردي.");
  const solo = Object.assign({}, u.solo);
  if (d.endsMs !== undefined) {
    if (d.endsMs === null) solo.subscriptionEnds = null;
    else if (typeof d.endsMs === "number" && isFinite(d.endsMs) && d.endsMs > 0) solo.subscriptionEnds = d.endsMs;
    else throw secMsg("invalid-argument", "تاريخ غير صالح.");
  }
  if (typeof d.active === "boolean") solo.active = d.active;
  await ref.update({ solo, updatedAt: Date.now() });
  return { ok: true, ends: solo.subscriptionEnds || null, active: solo.active !== false };
});

/* ============================================================================================
   الفصلان الدراسيان (2026-10-13.3): حالة كل فصل على مستند المدرسة schoolData/{sid}.semesters
     semesters = { first|second : { licensed, active, locked, activatedAt, closedAt, by } }
   الأدمن العام: يرخّص الفصل للمدرسة (license)، ويغلقه نهائيًا (lock) ويرفع الإغلاق (unlock)، ويضبط تواريخ الفردي (soloDates).
   مدير المدرسة: يفعّل (activate) ويغلق (close) الفصل المرخّص لمدرسته فقط، وبشرط أن يكون اليوم (بتوقيت الرياض) داخل تواريخ الفصل.
   التواريخ تُقرأ من school.periods التي يضبطها الأدمن. لا يكتب العميل هذه الحقول إطلاقًا (القواعد تمنع).
   ============================================================================================ */
const SEM_IDS = ["first", "second"];
const SEM_AR = { first: "الفصل الأول", second: "الفصل الثاني" };
function semTodayRiyadh() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }
const SEM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// تحويل تاريخ yyyy-mm-dd إلى مللي ثانية بتوقيت الرياض (بداية اليوم أو نهايته)
function semMs(dateStr, end) { return new Date(dateStr + (end ? "T23:59:59.999+03:00" : "T00:00:00+03:00")).getTime(); }

/* حفظ تواريخ العام والفصلين (أدمن النظام فقط) مع الفحص على الخادم:
   - تاريخ العام إلزامي متى حُدِّد أي فصل. - كل فصل داخل العام. - الفصلان لا يتداخلان (بداية الثاني بعد نهاية الأول).
   - لا تُحذف تواريخ فصل مرخَّص. الأوقات بتوقيت الرياض. تُكتب الحقول المحمية من هنا فقط (القواعد تمنع الكتابة المباشرة). */
async function semSaveDates(me, u, d) {
  if (!secIsAdmin(u)) throw secMsg("permission-denied", "مقصور على أدمن النظام العام.");
  const sid = String(d.schoolId || "");
  if (!sid) throw secMsg("invalid-argument", "حدّد المدرسة.");
  let yF = d.yearFrom ? String(d.yearFrom) : "", yT = d.yearTo ? String(d.yearTo) : "";
  /* (2026-10-14.2) التقويم المركزي: متى وُجد settings/academicCalendar فهو المرجع الوحيد لتواريخ المدرسة، ويُتجاهل ما يرسله العميل */
  const calSnap = await secDb().collection("settings").doc("academicCalendar").get();
  const calData = calSnap.exists ? calSnap.data() : null;
  let dSems = d.semesters || {};
  if (calData && Array.isArray(calData.periods) && calData.periods.length) {
    yF = calData.startDate; yT = calData.endDate;
    dSems = {};
    calData.periods.forEach((x) => { dSems[x.id] = { from: x.from, to: x.to }; });
  }
  const given = {};
  for (const p of SEM_IDS) {
    const x = dSems[p];
    if (!x) continue;
    const f = String(x.from || ""), t = String(x.to || "");
    if (!SEM_DATE_RE.test(f) || !SEM_DATE_RE.test(t)) throw secMsg("invalid-argument", "حدّد بداية ونهاية صحيحتين لـ" + SEM_AR[p] + ".");
    if (t < f) throw secMsg("invalid-argument", "نهاية " + SEM_AR[p] + " قبل بدايته.");
    given[p] = { from: f, to: t };
  }
  const has = Object.keys(given).length > 0;
  if ((yF && !SEM_DATE_RE.test(yF)) || (yT && !SEM_DATE_RE.test(yT))) throw secMsg("invalid-argument", "تاريخ العام الدراسي غير صالح.");
  if (has && (!yF || !yT)) throw secMsg("invalid-argument", "تاريخ العام الدراسي (بداية ونهاية) إلزامي عند تحديد الفصلين.");
  if ((yF && !yT) || (!yF && yT)) throw secMsg("invalid-argument", "حدّد بداية العام الدراسي ونهايته معًا.");
  if (yF && yT < yF) throw secMsg("invalid-argument", "نهاية العام الدراسي قبل بدايته.");
  for (const p of Object.keys(given)) {
    if (given[p].from < yF || given[p].to > yT) throw secMsg("invalid-argument", SEM_AR[p] + " خارج مدة العام الدراسي.");
  }
  if (given.first && given.second && given.second.from <= given.first.to) throw secMsg("invalid-argument", "الفصلان متداخلان أو غير مرتبين: يجب أن يبدأ الفصل الثاني بعد نهاية الأول.");
  const ref = secDb().collection("schoolData").doc(sid);
  await secDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data()._isSchool !== true) throw secMsg("not-found", "المدرسة غير موجودة.");
    const sems = s.data().semesters || {};
    for (const p of SEM_IDS) {
      if (!given[p] && sems[p] && sems[p].licensed === true) throw secMsg("failed-precondition", "لا يمكن حذف تواريخ " + SEM_AR[p] + " وهو مرخَّص للمدرسة. اسحب الترخيص أولًا.");
    }
    const periods = [], semDates = {};
    for (const p of SEM_IDS) {
      if (!given[p]) continue;
      const rec = { from: given[p].from, to: given[p].to, fromMs: semMs(given[p].from, false), toMs: semMs(given[p].to, true) };
      periods.push(Object.assign({ id: p }, rec));
      semDates[p] = { fromMs: rec.fromMs, toMs: rec.toMs };
    }
    const upd = {
      periods, updatedAt: Date.now(),
      yearFrom: yF, yearTo: yT,
      yearFromMs: yF ? semMs(yF, false) : null, yearToMs: yT ? semMs(yT, true) : null,
    };
    upd.semDates = has ? semDates : secFV.delete();
    tx.update(ref, upd);
  });
  return { ok: true };
}

exports.schoolSemester = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  const u = me.data;
  const d = request.data || {};
  const action = String(d.action || "");
  const db = secDb();

  if (action === "soloDates") {
    if (!secIsAdmin(u)) throw secMsg("permission-denied", "مقصور على أدمن النظام العام.");
    const out = {};
    for (const p of SEM_IDS) {
      const x = (d.dates || {})[p];
      if (!x) continue;
      const f = String(x.from || ""), t = String(x.to || "");
      if (!SEM_DATE_RE.test(f) || !SEM_DATE_RE.test(t) || t < f) throw secMsg("invalid-argument", "تواريخ " + SEM_AR[p] + " غير صحيحة.");
      out[p] = { from: f, to: t, fromMs: new Date(f + "T00:00:00+03:00").getTime(), toMs: new Date(t + "T23:59:59+03:00").getTime() };
    }
    if (out.first && out.second && out.second.from <= out.first.to) throw secMsg("invalid-argument", "الفصلان متداخلان أو غير مرتبين.");
    await db.collection("schoolData").doc("soloSemesters").set(Object.assign({ updatedAt: Date.now(), updatedBy: me.uid }, out), { merge: true });
    return { ok: true };
  }

  if (action === "saveDates") return semSaveDates(me, u, d);

  /* (2026-10-14.3) تمديد نهاية الفصل الأول لمدرسة بعينها (أدمن النظام فقط): حتى تاريخ أقصاه يوم قبل نهاية العام،
     وتبدأ مدرسة التمديد فصلها الثاني في اليوم التالي. until فارغ ← إلغاء التمديد. لا تمديد بعد نهاية العام. */
  if (action === "extend") {
    if (!secIsAdmin(u)) throw secMsg("permission-denied", "مقصور على أدمن النظام العام.");
    const sidE = String(d.schoolId || "");
    if (!sidE) throw secMsg("invalid-argument", "حدّد المدرسة.");
    const refE = db.collection("schoolData").doc(sidE);
    const sE = await refE.get();
    if (!sE.exists || sE.data()._isSchool !== true) throw secMsg("not-found", "المدرسة غير موجودة.");
    const until = String(d.until || "");
    if (!until) {
      await refE.update({ semExtend: secFV.delete(), updatedAt: Date.now() });
      return { ok: true, cleared: true };
    }
    if (!SEM_DATE_RE.test(until)) throw secMsg("invalid-argument", "تاريخ التمديد غير صحيح.");
    const cal = await secCalendar(true);
    if (!cal || cal.count !== 2 || !Array.isArray(cal.periods) || cal.periods.length < 2) throw secMsg("failed-precondition", "التمديد متاح عندما يكون العام فصلين فقط.");
    const p1 = cal.periods.find((x) => x.id === "first"), p2 = cal.periods.find((x) => x.id === "second");
    const ms = semMs(until, true);
    if (ms <= p1.toMs) throw secMsg("invalid-argument", "تاريخ التمديد يجب أن يكون بعد نهاية الفصل الأول (" + p1.to + ").");
    if (ms >= p2.toMs) throw secMsg("invalid-argument", "تاريخ التمديد يجب أن يسبق نهاية العام الدراسي (" + p2.to + "). لا تمديد بعد نهاية العام.");
    await refE.update({ semExtend: { first: ms, firstDate: until, by: me.uid, at: Date.now() }, updatedAt: Date.now() });
    return { ok: true, until, ms };
  }

  const sid = String(d.schoolId || "");
  const period = String(d.period || "");
  if (!sid || SEM_IDS.indexOf(period) < 0) throw secMsg("invalid-argument", "حدّد المدرسة والفصل الدراسي.");
  const isSys = secIsAdmin(u);
  const isDir = secIsSchoolAdminOf(u, sid);
  if (!isSys && !isDir) throw secMsg("permission-denied", "هذا الإجراء لأدمن النظام أو لمدير هذه المدرسة فقط.");
  if (["license", "lock", "unlock"].indexOf(action) >= 0 && !isSys) throw secMsg("permission-denied", "هذا الإجراء مقصور على أدمن النظام العام.");
  if (["license", "lock", "unlock", "activate", "close"].indexOf(action) < 0) throw secMsg("invalid-argument", "إجراء غير معروف.");

  const ref = db.collection("schoolData").doc(sid);
  const res = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data()._isSchool !== true) throw secMsg("not-found", "المدرسة غير موجودة.");
    const sc = s.data();
    // مدرسة قديمة بلا semesters: يُرخَّص لها الفصلان ويُفعَّل منهما الفصل activePeriod القديم (حفظًا لسلوكها الحالي)
    const sems = Object.assign({}, sc.semesters || {});
    if (!sc.semesters) {
      const ap = sc.activePeriod === "second" ? "second" : "first";
      SEM_IDS.forEach((p) => { sems[p] = { licensed: true, active: p === ap, locked: false }; });
    }
    const cur = Object.assign({ licensed: false, active: false, locked: false }, sems[period] || {});
    const now = Date.now();
    if (action === "license") {
      cur.licensed = d.licensed === true;
      if (!cur.licensed) cur.active = false;
    } else if (action === "lock") {
      cur.locked = true; cur.active = false; cur.closedAt = now; cur.by = me.uid;
    } else if (action === "unlock") {
      cur.locked = false;
    } else if (action === "close") {
      if (!cur.licensed) throw secMsg("failed-precondition", SEM_AR[period] + " غير مرخّص لهذه المدرسة.");
      cur.active = false; cur.closedAt = now; cur.by = me.uid;
    } else if (action === "activate") {
      if (sc.active === false) throw secMsg("failed-precondition", "المدرسة موقوفة من إدارة النظام.");
      if (!cur.licensed) throw secMsg("failed-precondition", SEM_AR[period] + " غير مرخّص لمدرستك. تواصل مع إدارة النظام.");
      if (cur.locked) throw secMsg("failed-precondition", SEM_AR[period] + " مغلق نهائيًا من إدارة النظام.");
      const per = (sc.periods || []).find((x) => x && x.id === period);
      if (!per || !per.from || !per.to) throw secMsg("failed-precondition", "لم تُحدَّد تواريخ " + SEM_AR[period] + " لمدرستك. تواصل مع إدارة النظام.");
      const today = semTodayRiyadh();
      if (today < per.from) throw secMsg("failed-precondition", "لم يبدأ " + SEM_AR[period] + " بعد (يبدأ في " + per.from + ").");
      if (today > per.to) throw secMsg("failed-precondition", "انتهى " + SEM_AR[period] + " في " + per.to + ".");
      cur.active = true; cur.activatedAt = now; cur.by = me.uid;
    }
    sems[period] = cur;
    const upd = { semesters: sems, updatedAt: now };
    // تعبئة semDates (مللي ثانية بتوقيت الرياض) من periods لمدرسة حُفظت تواريخها قبل هذه المرحلة — تقرؤها القواعد
    if (!sc.semDates && (sc.periods || []).length) {
      const sd = {};
      (sc.periods || []).forEach((x) => { if (x && x.id && x.from && x.to) sd[x.id] = { fromMs: semMs(x.from, false), toMs: semMs(x.to, true) }; });
      if (Object.keys(sd).length) upd.semDates = sd;
    }
    // يبقى الحقل القديم activePeriod صالحًا للإشعارات المجدولة: الفصل المفعّل الوحيد، وإلا يبقى كما هو
    const act = SEM_IDS.filter((p) => (sems[p] || {}).active === true);
    if (act.length === 1) upd.activePeriod = act[0];
    tx.update(ref, upd);
    return { semesters: sems, activePeriod: upd.activePeriod || sc.activePeriod || "first" };
  });
  return Object.assign({ ok: true }, res);
});

// حذف بيانات الفردي. كاملًا لمن لا سياق مدرسة له، وبيانات الفردي وحدها لمن له سياق مدرسة (لا تُمس أنشطة مدرسته)
async function secWipeSolo(db, uid, u) {
  const counts = {};
  const dual = Object.keys(u.schools || {}).length > 0;
  await db.collection("schoolData").doc("roster_solo_" + uid).delete().catch(() => {});
  await db.collection("rosterIndex").doc("solo_" + uid).delete().catch(() => {});
  const delDocs = async (docs) => {
    for (let i = 0; i < docs.length; i += 400) {
      const b = db.batch();
      docs.slice(i, i + 400).forEach((x) => b.delete(x.ref));
      await b.commit();
    }
    return docs.length;
  };
  if (!dual) {
    for (const [c, f] of [["results", "userId"], ["exams", "userId"], ["studentNotes", "fromUserId"], ["attendance", "markedBy"],
      ["worksheets", "createdBy"], ["questionBank", "createdBy"], ["submissions", "teacherUid"], ["pushTokens", "authUid"]]) {
      counts[c] = await delAllWhere(db, c, f, uid);
    }
    await db.collection("users").doc(uid).delete();
    try { await admin.auth().deleteUser(uid); } catch (e) { if (!e || e.code !== "auth/user-not-found") console.error("wipeSolo deleteUser", e); }
    counts.user = 1;
    return counts;
  }
  const ws = (await db.collection("worksheets").where("createdBy", "==", uid).get()).docs.filter((x) => !x.data().schoolId);
  const wsIds = new Set(ws.map((x) => x.id));
  const subs = (await db.collection("submissions").where("teacherUid", "==", uid).get()).docs.filter((x) => wsIds.has(x.data().worksheetId));
  const sn = (await db.collection("studentNotes").where("fromUserId", "==", uid).get()).docs.filter((x) => x.data().schoolId === "solo_" + uid);
  counts.submissions = await delDocs(subs);
  counts.worksheets = await delDocs(ws);
  counts.studentNotes = await delDocs(sn);
  await db.collection("users").doc(uid).update({ solo: secFV.delete(), isSolo: secFV.delete(), updatedAt: Date.now() });
  counts.soloContext = 1;
  return counts;
}

exports.cleanupExpiredSolo = onSchedule({ schedule: "30 3 * * *", timeZone: "Asia/Riyadh", timeoutSeconds: 540 }, async () => {
  const db = secDb();
  const cfg = await db.collection("systemCounters").doc("soloCleanup").get();
  const live = !!(cfg.exists && cfg.data().live === true);
  const now = Date.now();
  const cutoff = now - SEC_SOLO_KEEP_DAYS * SEC_DAY_MS;
  const qs = await db.collection("users").where(new admin.firestore.FieldPath("solo", "subscriptionEnds"), "<", cutoff).limit(50).get();
  const cands = [];
  for (const d of qs.docs) {
    const u = d.data();
    if (u.role === "admin" || u.role === "schoolAdmin" || !u.solo || !u.solo.subscriptionEnds || u.migratedTo) continue;
    const entry = { uid: d.id, username: u.username || "", email: u.email || "", endedAt: u.solo.subscriptionEnds, hasSchools: Object.keys(u.schools || {}).length > 0 };
    if (live) {
      try { entry.counts = await secWipeSolo(db, d.id, u); } catch (e) { entry.error = String(e && e.message || e); console.error("cleanupExpiredSolo", d.id, e); }
    }
    cands.push(entry);
  }
  const day = new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
  await db.collection("soloCleanupLog").doc(day).set({ at: now, live, candidates: cands });
  console.log("cleanupExpiredSolo: live=" + live + " candidates=" + cands.length);
});

/* ===== (2026-10-14.1) ختم العام الدراسي الموحَّد لبنك الأسئلة =====
   قيمة واحدة للنظام كله (مدارس ومستقلون) يضبطها أدمن النظام فقط: settings/academicYear = {year, endsMs, prevYear, prevEndsMs}.
   الختم يُثبَّت على النشاط عند حفظه في البنك (yearStamp) ولا يتغير بتغيّر العام لاحقًا، إلا في حالتين تصحَّحان هنا:
   (أ) نشاط بلا ختم (قديم، أو حُفظ قبل أن يُضبط عام) ← يُختم بالعام الجديد.
   (ب) نشاط حُفظ بعد نهاية العام السابق ولم يُحدَّث العام وقتها (فأخذ العام القديم) ← يُعاد ختمه بالعام الجديد حسب وقت حفظه،
       إلا ما أعاد المعلم ختمه بنفسه بتعديله (stampMode = "edit") فيبقى. */
const AY_YEAR_RE = /^1[34]\d\d$/;
async function ayRestamp(db, year, prevYear, prevEndsMs) {
  let stamped = 0, restamped = 0, last = null;
  for (;;) {
    let q = db.collection("questionBank").orderBy(admin.firestore.FieldPath.documentId()).select("yearStamp", "savedAt", "stampMode").limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    let n = 0;
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const ys = d.yearStamp == null ? "" : String(d.yearStamp);
      const sv = d.savedAt && typeof d.savedAt.toMillis === "function" ? d.savedAt.toMillis() : (typeof d.savedAt === "number" ? d.savedAt : 0);
      if (!ys) {
        batch.update(doc.ref, { yearStamp: year, stampMode: "auto" }); stamped++; n++;
      } else if (prevYear && ys === prevYear && d.stampMode !== "edit" && prevEndsMs && sv > prevEndsMs) {
        batch.update(doc.ref, { yearStamp: year, stampMode: "auto" }); restamped++; n++;
      }
    }
    if (n) await batch.commit();
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  return { stamped, restamped };
}

/* تطبيق العام الدراسي على settings/academicYear وإعادة ختم البنك (يستعملها academicYear وacademicCalendar) */
async function ayApply(db, year, endsMs, uid) {
  const ref = db.collection("settings").doc("academicYear");
  const cur = (await ref.get()).data() || {};
  if (cur.year && Number(year) < Number(cur.year)) throw secMsg("failed-precondition", "لا يمكن الرجوع إلى عام أقدم من العام الحالي (" + cur.year + ").");
  const now = Date.now();
  if (cur.year && cur.year === year) {
    await ref.set(Object.assign({}, cur, { endsMs, updatedAt: now, by: uid }));
    return { stamped: 0, restamped: 0 };
  }
  await ref.set({
    year, endsMs, prevYear: cur.year || null, prevEndsMs: cur.endsMs || null, setAt: now, updatedAt: now, by: uid,
  });
  return ayRestamp(db, year, cur.year || null, cur.endsMs || null);
}

exports.academicYear = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  if (!secIsAdmin(me.data)) throw secMsg("permission-denied", "مقصور على أدمن النظام العام.");
  const d = request.data || {};
  if (String(d.action || "") !== "set") throw secMsg("invalid-argument", "إجراء غير معروف.");
  const year = String(d.year || "").trim();
  if (!AY_YEAR_RE.test(year)) throw secMsg("invalid-argument", "اكتب العام الدراسي بأربع خانات، مثل ١٤٤٧.");
  const endDate = d.endDate ? String(d.endDate) : "";
  if (endDate && !SEM_DATE_RE.test(endDate)) throw secMsg("invalid-argument", "تاريخ نهاية العام غير صالح.");
  const endsMs = endDate ? semMs(endDate, true) : null;
  const res = await ayApply(secDb(), year, endsMs, me.uid);
  return { ok: true, year, stamped: res.stamped, restamped: res.restamped };
});

/* ===== (2026-10-14.2) التقويم الدراسي المركزي: settings/academicCalendar (أدمن النظام فقط) =====
   {year, count: 1|2, startDate, midDate (للفصلين: آخر يوم في الأول؛ الثاني يبدأ في اليوم التالي), endDate,
    periods:[{id,from,to,fromMs,toMs}], startMs, endMs}
   يُعمَّم من هنا على: كل المدارس (periods/yearFrom/yearTo/semDates) وتواريخ المعلم المستقل (schoolData/soloSemesters)،
   ويُحدِّث عام ختم البنك (settings/academicYear.endsMs = نهاية العام). الفصل الحالي لأي مستخدم يُحسب من تاريخ اليوم. */
function calNextDay(dateStr) { return new Date(semMs(dateStr, false) + 86400000 + 3 * 3600 * 1000).toISOString().slice(0, 10); }
function calBuild(d) {
  const year = String(d.year || "").trim();
  if (!AY_YEAR_RE.test(year)) throw secMsg("invalid-argument", "اكتب العام الدراسي بأربع خانات، مثل ١٤٤٧.");
  const count = Number(d.count);
  if (count !== 1 && count !== 2) throw secMsg("invalid-argument", "عدد الفصول الدراسية: فصل واحد أو فصلان.");
  const startDate = String(d.startDate || ""), endDate = String(d.endDate || ""), midDate = String(d.midDate || "");
  if (!SEM_DATE_RE.test(startDate)) throw secMsg("invalid-argument", "حدّد تاريخ بداية العام الدراسي.");
  if (!SEM_DATE_RE.test(endDate)) throw secMsg("invalid-argument", "حدّد تاريخ نهاية العام الدراسي.");
  if (endDate < startDate) throw secMsg("invalid-argument", "نهاية العام الدراسي قبل بدايته.");
  let periods;
  if (count === 1) {
    periods = [{ id: "first", from: startDate, to: endDate }];
  } else {
    if (!SEM_DATE_RE.test(midDate)) throw secMsg("invalid-argument", "حدّد تاريخ نهاية نصف العام.");
    if (midDate < startDate) throw secMsg("invalid-argument", "نهاية نصف العام قبل بداية العام.");
    if (midDate >= endDate) throw secMsg("invalid-argument", "نهاية نصف العام يجب أن تسبق نهاية العام الدراسي.");
    periods = [{ id: "first", from: startDate, to: midDate }, { id: "second", from: calNextDay(midDate), to: endDate }];
  }
  periods = periods.map((p) => Object.assign({}, p, { fromMs: semMs(p.from, false), toMs: semMs(p.to, true) }));
  return {
    year, count, startDate, midDate: count === 2 ? midDate : "", endDate, periods,
    startMs: semMs(startDate, false), endMs: semMs(endDate, true),
  };
}
async function calPropagate(db, cal) {
  const sc = await db.collection("schoolData").where("_isSchool", "==", true).get();
  let n = 0;
  for (let i = 0; i < sc.docs.length; i += 400) {
    const batch = db.batch();
    sc.docs.slice(i, i + 400).forEach((doc) => {
      const semDates = {};
      cal.periods.forEach((p) => { semDates[p.id] = { fromMs: p.fromMs, toMs: p.toMs }; });
      const upd0 = {};
      const ex = ((doc.data() || {}).semExtend || {}).first;
      const p1 = cal.periods.find((x) => x.id === "first"), p2 = cal.periods.find((x) => x.id === "second");
      if (ex && !(p1 && p2 && ex > p1.toMs && ex < p2.toMs)) upd0.semExtend = secFV.delete();   // التمديد لم يعد صالحًا مع التقويم الجديد
      batch.update(doc.ref, Object.assign(upd0, {
        periods: cal.periods.map((p) => ({ id: p.id, from: p.from, to: p.to, fromMs: p.fromMs, toMs: p.toMs })),
        yearFrom: cal.startDate, yearTo: cal.endDate, yearFromMs: cal.startMs, yearToMs: cal.endMs,
        semDates, updatedAt: Date.now(),
      }));
      n++;
    });
    await batch.commit();
  }
  const solo = { updatedAt: Date.now() };
  SEM_IDS.forEach((id) => {
    const p = cal.periods.find((x) => x.id === id);
    solo[id] = p ? { from: p.from, to: p.to, fromMs: p.fromMs, toMs: p.toMs } : secFV.delete();
  });
  await db.collection("schoolData").doc("soloSemesters").set(solo, { merge: true });
  return n;
}
exports.academicCalendar = onCall(async (request) => {
  const me = await secCaller(request, { needDoc: true });
  if (!secIsAdmin(me.data)) throw secMsg("permission-denied", "مقصور على أدمن النظام العام.");
  const d = request.data || {};
  if (String(d.action || "") !== "set") throw secMsg("invalid-argument", "إجراء غير معروف.");
  const cal = calBuild(d);
  const db = secDb();
  if (cal.count === 1) {
    const lic = (await db.collection("schoolData").where("_isSchool", "==", true).get()).docs
      .filter((x) => ((x.data().semesters || {}).second || {}).licensed === true).length;
    if (lic > 0) throw secMsg("failed-precondition", "لا يمكن جعل العام فصلًا واحدًا: يوجد " + lic + " مدرسة مرخَّصة للفصل الثاني. اسحب ترخيصه منها أولًا.");
  }
  const cur = (await db.collection("settings").doc("academicYear").get()).data() || {};
  if (cur.year && Number(cal.year) < Number(cur.year)) throw secMsg("failed-precondition", "لا يمكن الرجوع إلى عام أقدم من العام الحالي (" + cur.year + ").");
  const now = Date.now();
  const old = (await db.collection("settings").doc("academicCalendar").get()).data() || {};
  await db.collection("settings").doc("academicCalendar").set(Object.assign({}, cal, { setAt: old.setAt || now, updatedAt: now, by: me.uid }));
  const schools = await calPropagate(db, cal);
  const res = await ayApply(db, cal.year, cal.endMs, me.uid);
  return { ok: true, schools, stamped: res.stamped, restamped: res.restamped };
});

/* ===== (2026-10-14.2) الفصل الحالي بوقت خوادم Google: currentPeriod =====
   أي مستخدم مسجَّل. يُرجع وقت الخادم (nowMs) والفصل الذي يقع فيه اليوم حسب التقويم المركزي settings/academicCalendar:
   داخل فصل ← معرّفه (state="during")، قبل بداية العام ← الأول (state="before")، بعد نهايته ← الأخير (state="after")،
   بلا تقويم ← period=null (state="none"). لا يعتمد على ساعة جهاز المستخدم إطلاقًا. */
function calPeriodAt(cal, nowMs) {
  if (!cal || !Array.isArray(cal.periods) || !cal.periods.length) return { period: null, state: "none" };
  const ps = cal.periods.slice().sort((a, b) => a.fromMs - b.fromMs);
  for (const p of ps) if (nowMs >= p.fromMs && nowMs <= p.toMs) return { period: p.id, state: "during" };
  if (nowMs < ps[0].fromMs) return { period: ps[0].id, state: "before" };
  return { period: ps[ps.length - 1].id, state: "after" };
}
exports.currentPeriod = onCall(async (request) => {
  const me = await secCaller(request, { allowClosed: true });
  const nowMs = Date.now();
  const cal = await secCalendar(true);
  const r = calPeriodAt(cal, nowMs);
  let period = r.period;
  let extended = false;
  // تمديد الفصل الأول لمدرسة بعينها (semExtend.first): ما دام التمديد قائمًا تبقى المدرسة في الفصل الأول
  const sid = request.data && request.data.schoolId ? String(request.data.schoolId) : "";
  if (sid && r.state === "during" && period === "second") {
    const sc = await secDb().collection("schoolData").doc(sid).get();
    const e = sc.exists ? Number(((sc.data().semExtend || {}).first) || 0) : 0;
    if (e && nowMs <= e) { period = "first"; extended = true; }
  }
  const closed = secYearEnded(cal, nowMs) && !secIsAdmin(me.data);
  return { nowMs, period, state: r.state, year: cal ? cal.year || null : null, endMs: cal ? cal.endMs || null : null, closed, extended };
});


/* ===== (2026-10-14.3) الفحص اليومي للتقويم (02:00 بتوقيت الرياض) =====
   يكتب settings/calendarState = {state: during|before|ended|none, period, year, endMs, checkedAt} لتقرأه الواجهات والإدارة بلا حساب،
   ويسجّل سطرًا في calendarLog/{yyyy-mm-dd} عند تغيّر الحالة. الإغلاق الفعلي لا يعتمد على هذه الدالة (القواعد والدوال تحسبه من التاريخ مباشرة). */
exports.dailyCalendarSweep = onSchedule({ schedule: "0 2 * * *", timeZone: "Asia/Riyadh" }, async () => {
  const db = secDb();
  const nowMs = Date.now();
  const cal = await secCalendar(true);
  const r = calPeriodAt(cal, nowMs);
  const state = !cal ? "none" : (secYearEnded(cal, nowMs) ? "ended" : (r.state === "before" ? "before" : "during"));
  const ref = db.collection("settings").doc("calendarState");
  const prev = (await ref.get()).data() || {};
  await ref.set({ state, period: r.period || null, year: cal ? cal.year || null : null, endMs: cal ? cal.endMs || null : null, checkedAt: nowMs });
  if (prev.state !== state || prev.period !== (r.period || null)) {
    const day = new Date(nowMs + 3 * 3600e3).toISOString().slice(0, 10);
    await db.collection("calendarLog").doc(day).set({ at: nowMs, from: { state: prev.state || null, period: prev.period || null }, to: { state, period: r.period || null }, year: cal ? cal.year || null : null });
  }
  console.log("dailyCalendarSweep: state=" + state + " period=" + (r.period || "-"));
});
