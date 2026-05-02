import { useEffect, useMemo, useState } from "react";

export default function HomePage() {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [meals, setMeals] = useState([]);
  const [totals, setTotals] = useState({ protein_grams: 0 });
  const [target, setTarget] = useState({ protein_min: null, protein_max: null });
  const [proteinMinInput, setProteinMinInput] = useState("");
  const [proteinMaxInput, setProteinMaxInput] = useState("");

  const progressPct = useMemo(() => {
    if (!target?.protein_max) return 0;
    return Math.max(0, Math.min(100, (Number(totals?.protein_grams || 0) / Number(target.protein_max)) * 100));
  }, [totals, target]);

  async function loadToday() {
    try {
      setError("");
      const res = await fetch("/api/web-today");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Ошибка загрузки");
      setMeals(data.meals || []);
      setTotals(data.totals || { protein_grams: 0 });
      setTarget(data.target || { protein_min: null, protein_max: null });
      setProteinMinInput(data.target?.protein_min ?? "");
      setProteinMaxInput(data.target?.protein_max ?? "");
    } catch (e) {
      setError(e.message || "Ошибка загрузки");
    }
  }

  useEffect(() => {
    loadToday();
  }, []);

  async function onSubmitMeal(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const payload = mode === "text"
        ? { type: "text", content: text.trim() }
        : { type: "image", content: imageBase64 };

      if (!payload.content) throw new Error(mode === "text" ? "Введите описание блюда" : "Загрузите фото");

      const res = await fetch("/api/web-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось записать прием");

      setSuccess(`Записано: ${data.meal_name}. Белок: ${Math.round(Number(data.protein_grams || 0))} г`);
      setText("");
      setImageBase64("");
      setImagePreview("");
      await loadToday();
    } catch (e) {
      setError(e.message || "Ошибка записи");
    } finally {
      setLoading(false);
    }
  }

  async function onSaveTarget(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const min = Number(proteinMinInput);
      const max = Number(proteinMaxInput);
      const res = await fetch("/api/web-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protein_min: min, protein_max: max }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось сохранить цель");
      setTarget({ protein_min: data.protein_min, protein_max: data.protein_max });
      setSuccess("Цель сохранена");
    } catch (e) {
      setError(e.message || "Ошибка сохранения цели");
    } finally {
      setLoading(false);
    }
  }

  function onPickImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const parts = result.split(",");
      setImagePreview(result);
      setImageBase64(parts[1] || "");
    };
    reader.readAsDataURL(file);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Трекер КБЖУ</h1>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Сегодня съедено белка</p>
          <p className="mt-1 text-lg font-semibold">
            {Math.round(Number(totals?.protein_grams || 0))} / {target?.protein_max ?? "-"} г
          </p>
          <div className="mt-3 h-3 w-full rounded-full bg-slate-200">
            <div className="h-3 rounded-full bg-emerald-500" style={{ width: `${progressPct}%` }} />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Цель по белку</h2>
          <form className="mt-3 space-y-3" onSubmit={onSaveTarget}>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
                type="number"
                placeholder="Мин"
                value={proteinMinInput}
                onChange={(e) => setProteinMinInput(e.target.value)}
              />
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
                type="number"
                placeholder="Макс"
                value={proteinMaxInput}
                onChange={(e) => setProteinMaxInput(e.target.value)}
              />
            </div>
            <button className="w-full rounded-xl bg-slate-900 px-4 py-3 text-base font-medium text-white" type="submit" disabled={loading}>
              Сохранить цель
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Добавить прием пищи</h2>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`rounded-xl px-4 py-3 text-base ${mode === "text" ? "bg-slate-900 text-white" : "bg-slate-200"}`}
              onClick={() => setMode("text")}
            >
              Текст
            </button>
            <button
              type="button"
              className={`rounded-xl px-4 py-3 text-base ${mode === "image" ? "bg-slate-900 text-white" : "bg-slate-200"}`}
              onClick={() => setMode("image")}
            >
              Фото
            </button>
          </div>

          <form className="mt-3 space-y-3" onSubmit={onSubmitMeal}>
            {mode === "text" ? (
              <textarea
                className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
                placeholder="Например: гречка с курицей и салатом"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            ) : (
              <div className="space-y-3">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
                  onChange={(e) => onPickImage(e.target.files?.[0])}
                />
                {imagePreview ? <img src={imagePreview} alt="preview" className="max-h-48 w-full rounded-xl object-cover" /> : null}
              </div>
            )}

            <button className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-medium text-white" type="submit" disabled={loading}>
              {loading ? "Сохраняю..." : "Записать"}
            </button>
          </form>

          {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          {success ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p> : null}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Сегодняшние приемы</h2>
          <ul className="mt-3 space-y-2">
            {meals.length === 0 ? <li className="text-sm text-slate-500">Пока пусто</li> : null}
            {meals.map((meal, idx) => (
              <li key={meal.id || idx} className="rounded-xl bg-slate-100 p-3">
                <p className="text-sm font-medium">{idx + 1}. {meal.meal_description}</p>
                <p className="mt-1 text-sm text-slate-600">Белок: {Math.round(Number(meal.protein_grams || 0))} г</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
