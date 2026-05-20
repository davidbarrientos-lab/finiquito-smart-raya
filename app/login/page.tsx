"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleLogin() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail.endsWith("@raya.cl")) {
      alert("Solo se permite acceso con correos @raya.cl");
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    if (!data.user) {
      alert("No se pudo obtener el usuario.");
      return;
    }

    window.location.href = "/";
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <h1 className="text-3xl font-bold mb-6">Finiquito Smart Raya</h1>

        <input
          className="mb-4 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3"
          placeholder="correo@raya.cl"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          className="mb-6 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={handleLogin}
          className="w-full rounded-2xl bg-cyan-400 p-3 font-semibold text-slate-950"
        >
          Ingresar
        </button>
      </div>
    </main>
  );
}