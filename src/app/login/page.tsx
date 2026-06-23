"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeOff, AlertCircle, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("कृपया सांकेतिक शब्द (पासवर्ड) प्रविष्ट करा.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "लॉगिन अयशस्वी झाले.");
      }

      router.push("/");
    } catch (err: any) {
      setError(err.message || "काहीतरी चूक झाली. कृपया पुन्हा प्रयत्न करा.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background soft gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-100/40 blur-3xl" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-100/40 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-white border border-slate-200/80 rounded-2xl shadow-xl p-8 relative z-10"
      >
        {/* Marathi Headers */}
        <div className="text-center mb-6">
          <p className="text-sm font-semibold text-slate-500 tracking-wide mb-1">॥ श्री राम समर्थ ॥</p>
          <p className="text-xs text-slate-400 tracking-wide mb-4">॥ जय जय रघुवीर समर्थ ॥</p>
          <div className="w-12 h-12 bg-indigo-50 border border-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-indigo-650" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-1">प्रशासक लॉगिन (Admin Login)</h1>
          <p className="text-sm text-slate-500">पुढे जाण्यासाठी सांकेतिक शब्द प्रविष्ट करा</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <label className="text-xs font-bold text-slate-600 block mb-1.5 uppercase">सांकेतिक शब्द (Password)</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="पासवर्ड प्रविष्ट करा"
                className="w-full h-11 px-4 pr-10 border border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                className="bg-rose-50 border border-rose-100 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-700 font-medium overflow-hidden"
              >
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full h-11 bg-indigo-650 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? "लॉगिन करत आहे..." : "प्रवेश करा (Login)"}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </motion.button>
        </form>
      </motion.div>
    </main>
  );
}
