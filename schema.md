# هيكلة قاعدة البيانات — نظام ملف الإنجاز (ورقة العمل الإلكترونية)

قاعدة بيانات واحدة مشتركة (Firestore). الفترة (أولى/ثانية) حقل فلترة عادي وليست قاعدة منفصلة.

## المجموعات (Collections)

### `classes` — الفصول
```
classId (auto)
  code            : string   // رمز الصف، 3 أرقام، مثال: "105"
  period          : string   // "first" | "second"
  name            : string   // اسم وصفي اختياري، مثال: "أول ثانوي - 3"
  createdAt       : timestamp
```

### `students` — الطلاب
سجل الطالب دائم ومستقل عن الفصل الحالي — النقل بين الفصول لا يغيّر `studentId` ولا `pin`.
```
studentId (auto)
  nationalId      : string   // رقم الهوية
  name            : string
  pin             : string   // ثابت مدى الحياة الدراسية، لا يعاد توليده عند النقل
  originClassCode : string   // رمز الصف وقت توليد الـ PIN أول مرة (قد لا يطابق الفصل الحالي)
  sequenceNumber  : number   // الترتيب الأبجدي وقت أول رفع، ثابت (لا يعاد حسابه)
  currentClassId  : string   // مرجع لـ classes.classId — الفصل الحالي، قابل للتغيير عند النقل
  currentPeriod   : string   // "first" | "second"
  createdAt       : timestamp
  updatedAt       : timestamp
```
**فهرس مطلوب:** `(currentClassId, pin)` فريد — لمنع تكرار الـ PIN داخل نفس الفصل عند التعديل اليدوي.

### `worksheets` — أوراق العمل
```
worksheetId (auto)
  title           : string
  sourceFileName  : string   // اسم ملف الـ PDF الأصلي
  unit            : string   // الوحدة (مستخرج من ترويسة الصفحة)
  lesson          : string   // الدرس
  status          : string   // "draft" (بعد الاستخراج، قبل مراجعة المعلم) | "published"
  assignedClassIds: array<string>
  assignedStudentIds: array<string>  // تعيين لطلاب محددين (اختياري، فوق تعيين الفصل)
  dueDate         : timestamp | null
  createdAt       : timestamp
  publishedAt     : timestamp | null

  exercises: array of {
    exerciseId    : string
    type          : string   // "fill-blank" | "fill-table" | "mcq" | "true-false"
                              // | "matching" | "ordering" | "open-text" | "reference-image"
    prompt        : string
    // بنية إضافية حسب النوع (خيارات، إجابات صحيحة، صفوف/أعمدة الجدول، عناصر المزاوجة...)
    data          : map
    autoGraded    : boolean
  }
```

### `submissions` — تسليمات الطلاب
```
submissionId (auto)
  worksheetId     : string
  studentId       : string
  status          : string   // "not-started" | "in-progress" | "submitted" | "corrected"
  answers         : array of { exerciseId, answer, isCorrect (nullable), score (nullable) }
  totalScore      : number | null
  submittedAt     : timestamp | null
  correctedAt     : timestamp | null
  updatedAt       : timestamp
```

### `references` — مراجع الطالب (ملفات PDF للتصفح)
```
referenceId (auto)
  title           : string
  fileUrl         : string   // مسار الملف في Firebase Storage
  assignedClassIds: array<string>
  uploadedAt      : timestamp
```

## توليد الـ PIN
```
PIN = رمز الصف (3 أرقام) + الترتيب الأبجدي (رقمين، padded) + آخر رقمين من رقم الهوية
مثال: "105" + "13" + "32" = "1051332"
```
- يُحسب مرة واحدة عند أول رفع لقائمة الفصل، ولا يُعاد حسابه لاحقًا (طلاب جدد يُضافون بترتيب تسلسلي في نهاية القائمة).
- تعديل يدوي مسموح، بشرط عدم التكرار داخل نفس `currentClassId`.
- النقل بين الفصول: يتغيّر `currentClassId` فقط، ويبقى `pin` و`originClassCode` كما هما.
