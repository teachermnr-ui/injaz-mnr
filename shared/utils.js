// دوال مساعدة مشتركة لكل صفحات المشروع

/**
 * توليد رقم تسلسل أبجدي لقائمة طلاب (يُستخدم مرة واحدة فقط عند أول رفع للفصل).
 * @param {Array<{name: string}>} students
 * @returns {Array<{name: string, sequenceNumber: number}>} نفس المصفوفة مرتبة أبجديًا مع رقم تسلسل مضاف
 */
export function assignAlphabeticalSequence(students) {
  const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return sorted.map((s, i) => ({ ...s, sequenceNumber: i + 1 }));
}

/**
 * أول رقم تسلسل فارغ لإضافة طالب جديد لفصل عنده طلاب بالفعل (بدون إعادة حساب الترتيب القديم).
 * @param {Array<{sequenceNumber: number}>} existingStudents
 * @returns {number}
 */
export function nextSequenceNumber(existingStudents) {
  if (existingStudents.length === 0) return 1;
  const max = Math.max(...existingStudents.map((s) => s.sequenceNumber));
  return max + 1;
}

/**
 * توليد PIN الطالب: رمز المعلم + رمز الصف (3 أرقام) + التسلسل الأبجدي (رقمين) + آخر رقمين من رقم الهوية
 * @param {string} teacherCode - مثال: "T1"
 * @param {string} classCode - مثال: "105"
 * @param {number} sequenceNumber - مثال: 13
 * @param {string} nationalId - مثال: "1061532832"
 * @returns {string} مثال: "T11051332"
 */
export function generatePin(teacherCode, classCode, sequenceNumber, nationalId) {
  const seqPadded = String(sequenceNumber).padStart(2, "0");
  const lastTwoOfId = nationalId.slice(-2);
  return `${teacherCode}${classCode}${seqPadded}${lastTwoOfId}`;
}

/**
 * التحقق من عدم تكرار PIN داخل نفس الفصل الحالي (currentClassId) قبل حفظ تعديل يدوي.
 * @param {string} newPin
 * @param {string} currentClassId
 * @param {string} excludeStudentId - الطالب اللي بيتعدّل، عشان نستثنيه من فحص التكرار مع نفسه
 * @param {Array<{studentId: string, pin: string, currentClassId: string}>} allStudentsInClass
 * @returns {boolean} true لو الـ PIN متاح (مش مكرر)
 */
export function isPinAvailable(newPin, currentClassId, excludeStudentId, allStudentsInClass) {
  return !allStudentsInClass.some(
    (s) =>
      s.currentClassId === currentClassId &&
      s.pin === newPin &&
      s.studentId !== excludeStudentId
  );
}
