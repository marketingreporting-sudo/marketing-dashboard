import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBPAtJCR8OVeO3IBhtuXuQPz6qX2MLJsFY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "data-analysis-eeb4d.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "data-analysis-eeb4d",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "data-analysis-eeb4d.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "328769372636",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:328769372636:web:5662f7a97089859a518f19",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-DY9RVES6DX"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
