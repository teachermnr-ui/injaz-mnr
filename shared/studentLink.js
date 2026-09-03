// دوال مساعدة للربط بين حسابات الطلاب — تُستخدم في صفحات المعلم والطالب

import { db } from "./firebase-config.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * يدوّر على حساب طالب موجود بالفعل (عبر كل المعلمين) بمطابقة رقم الهوية —
 * الحالي أو أي رقم سابق مسجّل. يُستخدم للربط التلقائي الصامت بين المعلمين.
 * @param {string} nationalId
 * @returns {Promise<{uid:string, name:string, currentNationalId:string, previousNationalIds:string[]}|null>}
 */
export async function findAccountByNationalId(nationalId) {
  const q1 = query(collection(db, "studentAccounts"), where("currentNationalId", "==", nationalId));
  const s1 = await getDocs(q1);
  if (!s1.empty) return { uid: s1.docs[0].id, ...s1.docs[0].data() };

  const q2 = query(collection(db, "studentAccounts"), where("previousNationalIds", "array-contains", nationalId));
  const s2 = await getDocs(q2);
  if (!s2.empty) return { uid: s2.docs[0].id, ...s2.docs[0].data() };

  return null;
}

/**
 * يدوّر لنفس المعلم على سجل طالب سابق بنفس رقم الهوية — لإعادة استخدام نفس الـ PIN
 * بدل توليد رقم جديد (فصل جديد/سنة جديدة عند نفس المعلم).
 * @param {string} teacherCode
 * @param {string} nationalId
 * @returns {Promise<{id:string, pin:string, sequenceNumber:number, studentAccountId:string|null}|null>}
 */
export async function findExistingRelationship(teacherCode, nationalId) {
  const q = query(collection(db, "students"),
    where("teacherCode", "==", teacherCode), where("nationalId", "==", nationalId));
  const snap = await getDocs(q);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  return null;
}

/**
 * كل علاقات (طالب × معلم) المرتبطة بحساب طالب معيّن — طالب ممكن يبقى عنده أكتر
 * من علاقة (معلم/مادة مختلفة) لكل واحدة PIN مستقل.
 * @param {string} studentAccountUid
 * @returns {Promise<Array<{id:string, ...}>>}
 */
export async function getRelationshipsForAccount(studentAccountUid) {
  const q = query(collection(db, "students"), where("studentAccountId", "==", studentAccountUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
