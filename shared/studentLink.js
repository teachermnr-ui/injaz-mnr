// دوال مساعدة للربط بين حسابات الطلاب — تُستخدم في صفحات المعلم والطالب

import { db } from "./firebase-config.js";
import {
  collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

/**
 * طلب تعديل رقم هوية طالب مُفعَّل — يحتاج موافقة الطالب قبل ما يتفعل فعليًا.
 * الرقم القديم يفضل شغال عادي لحد الموافقة.
 * @param {string} studentAccountUid
 * @param {string} oldNationalId
 * @param {string} newNationalId
 * @param {string} requestedByTeacherCode
 */
export async function createIdChangeRequest(studentAccountUid, oldNationalId, newNationalId, requestedByTeacherCode) {
  return addDoc(collection(db, "idChangeRequests"), {
    studentAccountId: studentAccountUid,
    oldNationalId,
    newNationalId,
    requestedByTeacherCode,
    status: "pending",
    createdAt: serverTimestamp(),
    resolvedAt: null
  });
}

/**
 * كل طلبات تعديل الهوية المعلّقة لحساب طالب معيّن.
 * @param {string} studentAccountUid
 */
export async function getPendingIdChangeRequests(studentAccountUid) {
  const q = query(collection(db, "idChangeRequests"),
    where("studentAccountId", "==", studentAccountUid), where("status", "==", "pending"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * موافقة الطالب على طلب تعديل الهوية: يحدّث الحساب وكل العلاقات المرتبطة به
 * بالرقم الجديد، ويحفظ الرقم القديم في قائمة الأرقام السابقة (للمطابقة المستقبلية).
 * @param {{id:string, studentAccountId:string, oldNationalId:string, newNationalId:string}} request
 */
export async function approveIdChangeRequest(request) {
  const accountRef = doc(db, "studentAccounts", request.studentAccountId);
  const accountSnap = await getDoc(accountRef);
  const prev = accountSnap.exists() ? (accountSnap.data().previousNationalIds || []) : [];

  await updateDoc(accountRef, {
    currentNationalId: request.newNationalId,
    previousNationalIds: [...prev, request.oldNationalId]
  });

  const relSnap = await getDocs(query(collection(db, "students"), where("studentAccountId", "==", request.studentAccountId)));
  await Promise.all(relSnap.docs.map((d) => updateDoc(doc(db, "students", d.id), { nationalId: request.newNationalId })));

  await updateDoc(doc(db, "idChangeRequests", request.id), { status: "approved", resolvedAt: serverTimestamp() });
}

/**
 * رفض الطالب لطلب تعديل الهوية — مفيش أي تغيير في البيانات.
 * @param {string} requestId
 */
export async function rejectIdChangeRequest(requestId) {
  await updateDoc(doc(db, "idChangeRequests", requestId), { status: "rejected", resolvedAt: serverTimestamp() });
}
