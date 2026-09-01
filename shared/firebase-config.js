// إعداد Firebase المشترك — يتم استيراده في كل صفحات المشروع (معلم/طالب)
// عدّل القيم التالية بمفاتيح مشروعك الفعلي في Firebase Console قبل النشر

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBWCF8wgcUi4BFh-yznfsPLS1GYL3EWGRc",
  authDomain: "injaz-worksheets.firebaseapp.com",
  projectId: "injaz-worksheets",
  storageBucket: "injaz-worksheets.firebasestorage.app",
  messagingSenderId: "32425070148",
  appId: "1:32425070148:web:724833226335e6cd1ef611"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
