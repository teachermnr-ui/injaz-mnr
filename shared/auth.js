// دوال مساعدة للمصادقة — تُستخدم في كل صفحات المعلم

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * يتحقق إن المعلم مسجل دخول وعنده بروفايل كامل (اسم + رمز T مولّد).
 * لو مسجّل دخول لكن بدون بروفايل، أو مش مسجّل خالص، يحوّله لصفحة تسجيل الدخول.
 * @param {string} loginPath - مسار صفحة تسجيل الدخول نسبةً للصفحة الحالية
 * @returns {Promise<{uid:string, name:string, subject:string, code:string}>}
 */
export function requireTeacherAuth(loginPath = "login.html") {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = loginPath;
        return;
      }
      const profileSnap = await getDoc(doc(db, "teachers", user.uid));
      if (!profileSnap.exists()) {
        window.location.href = loginPath;
        return;
      }
      resolve({ uid: user.uid, ...profileSnap.data() });
    });
  });
}

/**
 * توليد رمز معلم تسلسلي (T1, T2, T3...) بأمان حتى مع تسجيلات متزامنة،
 * باستخدام معاملة Firestore على عدّاد مركزي.
 * @returns {Promise<string>}
 */
export async function generateTeacherCode() {
  const counterRef = doc(db, "counters", "teacherSeq");
  const newNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? snap.data().value : 0;
    const next = current + 1;
    tx.set(counterRef, { value: next });
    return next;
  });
  return `T${newNumber}`;
}

/**
 * تسجيل خروج المعلم والتحويل لصفحة تسجيل الدخول.
 */
export async function signOutTeacher(redirectPath = "login.html") {
  await signOut(auth);
  window.location.href = redirectPath;
}
