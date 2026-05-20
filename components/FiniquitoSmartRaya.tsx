"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Worker = {
  id: string;
  empresa: string;
  rut: string;
  nombre: string;
  cargo: string;
  departamento: string;
  fechaIngreso: Date | null;
  fechaTerminoNubox: Date | null;
  tipoContrato: string;
  sueldoBase: number;
  raw: Record<string, string>;
};

type Params = {
  imm: number;
  uf: number;
};

type SimInput = {
  fechaSalida: string;
  causal: string;
  vacacionesDias: string;
  diasTrabajadosMonto: string;
  aplicaAviso: boolean;
  descuentaAFC: boolean;
  afcMonto: string;
};

const CLP = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const DEFAULT_IMM = 529000;
const DEFAULT_UF = 39200;

const EMPRESAS = ["Raya", "Swell", "Inflamable", "Otra sociedad"];

function parseCLNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  const parts = text.includes("/") ? text.split("/") : text.split("-");
  if (parts.length !== 3) return null;

  const first = Number(parts[0]);
  const second = Number(parts[1]);
  const third = Number(parts[2]);

  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(third)) {
    return null;
  }

  let d: number;
  let m: number;
  let y: number;

  // Soporta formatos:
  // 01-09-2020 / 01/09/2020 = día-mes-año, típico Nubox Chile
  // 2020-09-01 = año-mes-día, formato ISO
  if (String(parts[0]).length === 4) {
    y = first;
    m = second;
    d = third;
  } else {
    d = first;
    m = second;
    y = third;
  }

  const date = new Date(y, m - 1, d);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }

  return date;
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString("es-CL");
}

function splitCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function detectDelimiter(text: string): string {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/).find(Boolean) || "";

  const semis = (first.match(/;/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  const tabs = (first.match(/\t/g) || []).length;

  if (semis >= commas && semis >= tabs && semis > 0) return ";";
  if (tabs >= commas && tabs > 0) return "\t";
  return ",";
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/^"|"$/g, "")
    .trim()
    .toUpperCase();
}

function parseCSV(text: string, empresa: string): Worker[] {
  const cleanText = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(cleanText);

  const lines = cleanText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  // Nubox agrega filas iniciales como:
  // PUBLICIDAD Y PROMOCIONES RAYA S.A.
  // FECHA: ...
  // LISTADO DE TRABAJADORES
  // Por eso buscamos la fila real de encabezados.
  const headerIndex = lines.findIndex((line) => {
    const normalized = line.toUpperCase();
    return (
      normalized.includes("CODIGO") &&
      normalized.includes("RUT") &&
      normalized.includes("NOMBRE") &&
      normalized.includes("FECHA INGRESO")
    );
  });

  if (headerIndex === -1) {
    alert("No se encontró la fila de encabezados de Nubox. Revisa que el archivo sea el maestro/listado de trabajadores.");
    return [];
  }

  const headers = splitCSVLine(lines[headerIndex], delimiter)
    .map((h) => h.replace(/^"|"$/g, "").trim());

  return lines.slice(headerIndex + 1).map((line, index) => {
    const cells = splitCSVLine(line, delimiter).map((c) =>
      c.replace(/^"|"$/g, "").trim()
    );

    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });

    const codigo = row["CODIGO"] || "";
    const rut = row["RUT"] || row["Rut_Funcionario"] || row["RUT FUNCIONARIO"] || "Sin RUT";
    const nombre = [
      row["NOMBRE"],
      row["A. PATERNO"],
      row["A. MATERNO"],
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      id: `${empresa}-${rut}-${codigo || index}`,
      empresa,
      rut,
      nombre: nombre || "Sin nombre",
      cargo: row["CARGO"] || "No informado",
      departamento: row["DESC. DEPARTAMENTO"] || row["DEPARTAMENTO"] || "Sin depto.",
      fechaIngreso: parseDate(row["FECHA INGRESO"] || row["Fec_Ingreso"]),
      fechaTerminoNubox: parseDate(row["FECHA TERMINO"] || row["Fec_Termino"]),
      tipoContrato: row["TIPO DE CONTRATO"] || row["Tipo_Contrato"] || "",
      sueldoBase: parseCLNumber(row["VALOR SUELDO BASE"] || row["Sueldo_Mes"] || row["SUELDO BASE"]),
      raw: row,
    };
  }).filter((w) => w.rut !== "Sin RUT" && w.nombre !== "Sin nombre");
}

function yearsBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;

  let years = end.getFullYear() - start.getFullYear();
  const monthDiff = end.getMonth() - start.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && end.getDate() < start.getDate())) {
    years -= 1;
  }

  return Math.max(0, years);
}

function monthsRemainder(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;

  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() -
    start.getMonth();

  if (end.getDate() < start.getDate()) months -= 1;

  return Math.max(0, months % 12);
}

function calcFiniquito(worker: Worker, input: SimInput, params: Params) {
  const sueldo = worker.sueldoBase || 0;
  const gratificacion = Math.min(sueldo * 0.25, (params.imm * 4.75) / 12);
  const base = sueldo + gratificacion;

  const fechaSalida = parseDate(input.fechaSalida);
  const antiguedadAnios = yearsBetween(worker.fechaIngreso, fechaSalida);
  const antiguedadMeses = monthsRemainder(worker.fechaIngreso, fechaSalida);

  const baseTopeada = Math.min(base, params.uf * 90);

  const vacacionesDias = parseCLNumber(input.vacacionesDias);
  const vacaciones = (base / 30) * vacacionesDias;

  const avisoPrevio = input.aplicaAviso ? baseTopeada : 0;

  const causalConIAS = ["art161", "mutuo_con_ias"].includes(input.causal);
  const aniosIndemnizables = causalConIAS
    ? Math.min(antiguedadAnios, 11)
    : 0;

  const ias = baseTopeada * aniosIndemnizables;
  const diasTrabajados = parseCLNumber(input.diasTrabajadosMonto);
  const afc = input.descuentaAFC ? parseCLNumber(input.afcMonto) : 0;

  const total = vacaciones + avisoPrevio + ias + diasTrabajados - afc;

  const alerts: string[] = [];

  if (!fechaSalida) alerts.push("Falta fecha de salida");
  if (!input.causal) alerts.push("Falta causal de término");
  if (!input.vacacionesDias) alerts.push("Faltan días de vacaciones pendientes");
  if (base > params.uf * 90) alerts.push("Base supera tope legal de 90 UF");
  if (antiguedadAnios > 11) alerts.push("Antigüedad supera 11 años indemnizables");
  if (worker.fechaTerminoNubox) alerts.push("Trabajador ya registra fecha de término en Nubox");
  if (worker.tipoContrato && worker.tipoContrato !== "2") {
    alerts.push("Revisar tipo de contrato según codificación Nubox");
  }

  return {
    sueldo,
    gratificacion,
    base,
    baseTopeada,
    vacaciones,
    avisoPrevio,
    ias,
    diasTrabajados,
    afc,
    total,
    antiguedadAnios,
    antiguedadMeses,
    aniosIndemnizables,
    alerts,
  };
}

const sampleCSV = `Codigo;Rut_Funcionario;DV_Rut_Funcionario;Nombres;Ape_Paterno;Ape_Materno;Fec_Ingreso;Fec_Termino;Tipo_Contrato;Departamento;Sueldo_Mes
1;11111111;1;JUAN ALBERTO;PEREZ;PEREZ;01/11/2014;;2;Administracion;950000
2;12345678;5;JOSE ANTONIO;GONZALEZ;GUZMAN;01/04/2015;;2;Finanzas;1250000`;


function toISODate(date: Date | null): string | null {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromISODate(value: string | null): Date | null {
  if (!value) return null;
  return parseDate(value);
}

function workerToDb(worker: Worker) {
  return {
    id: worker.id,
    empresa: worker.empresa,
    rut: worker.rut,
    nombre: worker.nombre,
    cargo: worker.cargo,
    departamento: worker.departamento,
    fecha_ingreso: toISODate(worker.fechaIngreso),
    fecha_termino_nubox: toISODate(worker.fechaTerminoNubox),
    tipo_contrato: worker.tipoContrato,
    sueldo_base: worker.sueldoBase,
    raw: worker.raw,
  };
}

function dbToWorker(row: any): Worker {
  return {
    id: row.id,
    empresa: row.empresa || "Raya",
    rut: row.rut || "Sin RUT",
    nombre: row.nombre || "Sin nombre",
    cargo: row.cargo || "No informado",
    departamento: row.departamento || "Sin depto.",
    fechaIngreso: fromISODate(row.fecha_ingreso),
    fechaTerminoNubox: fromISODate(row.fecha_termino_nubox),
    tipoContrato: row.tipo_contrato || "",
    sueldoBase: Number(row.sueldo_base || 0),
    raw: row.raw || {},
  };
}

export default function FiniquitoSmartRaya() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [syncStatus, setSyncStatus] = useState("Validando acceso...");
  const [profile, setProfile] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [empresaCarga, setEmpresaCarga] = useState("Raya");
  const [empresaFiltro, setEmpresaFiltro] = useState("Todas");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [params, setParams] = useState<Params>({
    imm: DEFAULT_IMM,
    uf: DEFAULT_UF,
  });

  const [input, setInput] = useState<SimInput>({
    fechaSalida: "2026-05-31",
    causal: "art161",
    vacacionesDias: "0",
    diasTrabajadosMonto: "0",
    aplicaAviso: true,
    descuentaAFC: false,
    afcMonto: "0",
  });

  useEffect(() => {
    async function initAuthAndData() {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .eq("is_active", true)
        .single();

      if (profileError || !profileData) {
        console.error("Perfil no autorizado:", profileError);
        await supabase.auth.signOut();
        alert("Tu usuario no tiene perfil activo. Contacta al super admin.");
        window.location.href = "/login";
        return;
      }

      setProfile(profileData);

      const { data, error } = await supabase
        .from("trabajadores")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error cargando trabajadores:", error);
        setSyncStatus("No se pudo cargar Supabase. Revisa permisos.");
        setCheckingAuth(false);
        return;
      }

      const saved = (data || []).map(dbToWorker);
      setWorkers(saved);
      setSyncStatus(`${saved.length} trabajadores guardados en Supabase`);
      setCheckingAuth(false);
    }

    initAuthAndData();
  }, []);

  const filtered = useMemo(() => {
    return workers.filter((w) => {
      const empresaOk = empresaFiltro === "Todas" || w.empresa === empresaFiltro;
      const q = search.toLowerCase();
      const searchOk =
        !q ||
        w.nombre.toLowerCase().includes(q) ||
        w.rut.toLowerCase().includes(q);

      return empresaOk && searchOk;
    });
  }, [workers, empresaFiltro, search]);

  const selected = useMemo(() => {
    return workers.filter((w) => selectedIds.includes(w.id));
  }, [workers, selectedIds]);

  const selectedCalc = useMemo(() => {
    return selected.map((w) => ({
      worker: w,
      calc: calcFiniquito(w, input, params),
    }));
  }, [selected, input, params]);

  const totalCaja = selectedCalc.reduce((acc, x) => acc + x.calc.total, 0);
  const totalVacaciones = selectedCalc.reduce((acc, x) => acc + x.calc.vacaciones, 0);
  const totalIAS = selectedCalc.reduce((acc, x) => acc + x.calc.ias, 0);
  const totalAviso = selectedCalc.reduce((acc, x) => acc + x.calc.avisoPrevio, 0);

  async function loadText(text: string) {
    const parsed = parseCSV(text, empresaCarga);

    if (!parsed.length) {
      setSyncStatus("No se encontraron trabajadores en el archivo.");
      return;
    }

    setWorkers((prev) => {
      const merged = new Map<string, Worker>();
      [...prev, ...parsed].forEach((w) => merged.set(w.id, w));
      return Array.from(merged.values());
    });

    setSyncStatus(`Guardando ${parsed.length} trabajadores en Supabase...`);

    const { error } = await supabase
      .from("trabajadores")
      .upsert(parsed.map(workerToDb), { onConflict: "id" });

    if (error) {
      console.error("Error guardando trabajadores:", error);
      setSyncStatus("Error guardando en Supabase. Revisa policy de UPDATE/INSERT.");
      return;
    }

    setSyncStatus(`${parsed.length} trabajadores guardados correctamente`);
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (ev) => {
      loadText(String(ev.target?.result || ""));
      e.target.value = "";
    };

    reader.readAsText(file, "ISO-8859-1");
  }

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function selectFiltered() {
    const ids = filtered.map((w) => w.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
  }

  function clearAll() {
    setSelectedIds([]);
    setWorkers([]);
  }

  function exportCSV() {
    if (!selectedCalc.length) return;

    const rows = selectedCalc.map(({ worker, calc }) => ({
      Empresa: worker.empresa,
      Trabajador: worker.nombre,
      RUT: worker.rut,
      FechaIngreso: formatDate(worker.fechaIngreso),
      FechaSalida: input.fechaSalida,
      SueldoBase: Math.round(calc.sueldo),
      Gratificacion: Math.round(calc.gratificacion),
      BaseFiniquito: Math.round(calc.base),
      Vacaciones: Math.round(calc.vacaciones),
      AvisoPrevio: Math.round(calc.avisoPrevio),
      IAS: Math.round(calc.ias),
      DiasTrabajados: Math.round(calc.diasTrabajados),
      AFC: Math.round(calc.afc),
      TotalEstimado: Math.round(calc.total),
      Alertas: calc.alerts.join(" | "),
    }));

    const header = Object.keys(rows[0]).join(";");
    const body = rows
      .map((r) =>
        Object.values(r)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(";")
      )
      .join("\n");

    const blob = new Blob([`${header}\n${body}`], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "simulacion_finiquitos_raya.csv";
    a.click();
    URL.revokeObjectURL(url);
  }


  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-bold">Validando acceso...</h1>
          <p className="mt-2 text-slate-400">Conectando con Supabase y revisando permisos.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-sm text-cyan-200">
              Prototipo interno RRHH / Finanzas
            </div>
            <h1 className="text-4xl font-bold tracking-tight">
              Finiquito Smart Raya
            </h1>
            <p className="mt-2 max-w-3xl text-slate-400">
              Carga el maestro Nubox, selecciona empresa y trabajadores, simula
              finiquitos individuales o masivos y estima la caja requerida.
            </p>
            <p className="mt-2 text-sm text-emerald-300">
              {syncStatus}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {profile && (
              <div className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300">
                {profile.email} · {profile.role}
              </div>
            )}

            <button
              onClick={handleLogout}
              className="rounded-2xl border border-slate-700 px-4 py-2 font-semibold text-slate-200 hover:bg-slate-800"
            >
              Salir
            </button>

            <button
              onClick={() => loadText(sampleCSV)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Cargar ejemplo
            </button>

            <button
              onClick={exportCSV}
              disabled={!selected.length}
              className="rounded-2xl bg-white px-4 py-2 font-semibold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Exportar CSV
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card label="Trabajadores cargados" value={String(workers.length)} />
          <Card label="Seleccionados" value={String(selected.length)} />
          <Card label="Caja estimada" value={CLP.format(totalCaja)} />
          <Card label="Vacaciones" value={CLP.format(totalVacaciones)} />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-semibold">Carga Nubox</h2>

            <label className="mt-4 block text-sm text-slate-400">
              Empresa asignada al archivo
            </label>
            <select
              value={empresaCarga}
              onChange={(e) => setEmpresaCarga(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3"
            >
              {EMPRESAS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>

            <label className="mt-4 block cursor-pointer rounded-3xl border border-dashed border-cyan-400/40 p-6 text-center hover:bg-cyan-400/5">
              <span className="block font-semibold text-cyan-200">
                Subir CSV exportado desde Nubox
              </span>
              <span className="mt-1 block text-sm text-slate-400">
                Acepta archivos separados por coma, punto y coma o tabulación.
              </span>
              <input
                type="file"
                accept=".csv,text/csv,.txt"
                className="hidden"
                onChange={handleUpload}
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">IMM vigente</label>
                <input
                  value={params.imm}
                  onChange={(e) =>
                    setParams({ ...params, imm: parseCLNumber(e.target.value) })
                  }
                  className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400">UF cálculo</label>
                <input
                  value={params.uf}
                  onChange={(e) =>
                    setParams({ ...params, uf: parseCLNumber(e.target.value) })
                  }
                  className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3"
                />
              </div>
            </div>

            <button
              onClick={clearAll}
              className="mt-4 w-full rounded-2xl border border-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-800"
            >
              Limpiar datos
            </button>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 lg:col-span-2">
            <h2 className="text-xl font-semibold">Trabajadores</h2>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <select
                value={empresaFiltro}
                onChange={(e) => setEmpresaFiltro(e.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950 p-3"
              >
                <option>Todas</option>
                {EMPRESAS.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o RUT"
                className="rounded-2xl border border-slate-700 bg-slate-950 p-3 md:col-span-2"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={selectFiltered}
                className="rounded-2xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Seleccionar filtrados
              </button>

              <button
                onClick={() => setSelectedIds([])}
                className="rounded-2xl border border-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-800"
              >
                Deseleccionar
              </button>
            </div>

            <div className="mt-4 max-h-80 overflow-auto rounded-2xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-950 text-slate-400">
                  <tr>
                    <th className="p-3"></th>
                    <th className="p-3 text-left">Trabajador</th>
                    <th className="p-3 text-left">Empresa</th>
                    <th className="p-3 text-left">Ingreso</th>
                    <th className="p-3 text-right">Sueldo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w) => (
                    <tr
                      key={w.id}
                      className="border-t border-slate-800 hover:bg-slate-800/50"
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(w.id)}
                          onChange={() => toggle(w.id)}
                        />
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{w.nombre}</div>
                        <div className="text-slate-500">{w.rut}</div>
                      </td>
                      <td className="p-3">{w.empresa}</td>
                      <td className="p-3">{formatDate(w.fechaIngreso)}</td>
                      <td className="p-3 text-right">
                        {CLP.format(w.sueldoBase)}
                      </td>
                    </tr>
                  ))}

                  {!filtered.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-slate-500"
                      >
                        Carga un CSV Nubox o usa el ejemplo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Parámetros de simulación</h2>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field
              label="Fecha salida"
              type="date"
              value={input.fechaSalida}
              onChange={(v) => setInput({ ...input, fechaSalida: v })}
            />

            <div>
              <label className="text-xs text-slate-400">Causal</label>
              <select
                value={input.causal}
                onChange={(e) => setInput({ ...input, causal: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3"
              >
                <option value="art161">Art. 161 / necesidades empresa</option>
                <option value="renuncia">Renuncia</option>
                <option value="mutuo">Mutuo acuerdo sin IAS</option>
                <option value="mutuo_con_ias">Mutuo acuerdo con IAS pactada</option>
                <option value="vencimiento">Vencimiento plazo</option>
              </select>
            </div>

            <Field
              label="Días vacaciones pendientes"
              value={input.vacacionesDias}
              onChange={(v) => setInput({ ...input, vacacionesDias: v })}
            />

            <Field
              label="Monto días trabajados"
              value={input.diasTrabajadosMonto}
              onChange={(v) => setInput({ ...input, diasTrabajadosMonto: v })}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-5 text-sm text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={input.aplicaAviso}
                onChange={(e) =>
                  setInput({ ...input, aplicaAviso: e.target.checked })
                }
              />
              Aplica aviso previo
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={input.descuentaAFC}
                onChange={(e) =>
                  setInput({ ...input, descuentaAFC: e.target.checked })
                }
              />
              Descontar AFC empleador
            </label>

            {input.descuentaAFC && (
              <input
                placeholder="Monto AFC"
                value={input.afcMonto}
                onChange={(e) =>
                  setInput({ ...input, afcMonto: e.target.value })
                }
                className="rounded-2xl border border-slate-700 bg-slate-950 p-2"
              />
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card label="Total caja" value={CLP.format(totalCaja)} />
          <Card label="Total IAS" value={CLP.format(totalIAS)} />
          <Card label="Total aviso" value={CLP.format(totalAviso)} />
          <Card label="Total vacaciones" value={CLP.format(totalVacaciones)} />
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-xl font-semibold">Resultado masivo</h2>

          <div className="overflow-auto rounded-2xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-950 text-slate-400">
                <tr>
                  <th className="p-3 text-left">Trabajador</th>
                  <th className="p-3 text-right">Base</th>
                  <th className="p-3 text-right">Vacaciones</th>
                  <th className="p-3 text-right">Aviso</th>
                  <th className="p-3 text-right">IAS</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-left">Alertas</th>
                </tr>
              </thead>

              <tbody>
                {selectedCalc.map(({ worker, calc }) => (
                  <tr key={worker.id} className="border-t border-slate-800">
                    <td className="p-3">
                      <div className="font-medium">{worker.nombre}</div>
                      <div className="text-slate-500">
                        {worker.empresa} · {worker.rut} · {calc.antiguedadAnios} años{" "}
                        {calc.antiguedadMeses} meses
                      </div>
                    </td>
                    <td className="p-3 text-right">{CLP.format(calc.base)}</td>
                    <td className="p-3 text-right">
                      {CLP.format(calc.vacaciones)}
                    </td>
                    <td className="p-3 text-right">
                      {CLP.format(calc.avisoPrevio)}
                    </td>
                    <td className="p-3 text-right">{CLP.format(calc.ias)}</td>
                    <td className="p-3 text-right font-bold text-cyan-200">
                      {CLP.format(calc.total)}
                    </td>
                    <td className="p-3 text-left">
                      {calc.alerts.length ? (
                        <div className="space-y-1">
                          {calc.alerts.map((a) => (
                            <div key={a} className="text-amber-300">
                              ⚠ {a}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-emerald-300">OK</span>
                      )}
                    </td>
                  </tr>
                ))}

                {!selectedCalc.length && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Selecciona uno o más trabajadores para simular.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Herramienta de simulación interna. El pago final debe validarse con
            Nubox, causal legal, liquidación final y revisión administrativa.
          </p>
        </section>
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3"
      />
    </div>
  );
}
