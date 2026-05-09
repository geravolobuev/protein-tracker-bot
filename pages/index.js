import { useEffect, useMemo, useRef, useState } from "react";

export default function HomePage() {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [imageCaption, setImageCaption] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [meals, setMeals] = useState([]);
  const [totals, setTotals] = useState({ protein_grams: 0 });
  const [target, setTarget] = useState({ protein_target: null });
  const [proteinTargetInput, setProteinTargetInput] = useState("");
  const [historyDays, setHistoryDays] = useState([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [expandedDates, setExpandedDates] = useState({});
  const [historyMealsByDate, setHistoryMealsByDate] = useState({});
  const [historyMealsLoading, setHistoryMealsLoading] = useState({});

  const [editingMealId, setEditingMealId] = useState(null);
  const [editingMealText, setEditingMealText] = useState("");

  const [authReady, setAuthReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [token, setToken] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const progressPct = useMemo(() => {
    if (!target?.protein_target) return 0;
    return Math.max(0, Math.min(100, (Number(totals?.protein_grams || 0) / Number(target.protein_target)) * 100));
  }, [totals, target]);

  function authHeaders(currentToken, includeJson = false) {
    return {
      ...(includeJson ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${currentToken}`,
    };
  }

  function formatDay(ymd) {
    const [y, m, d] = String(ymd || "").split("-");
    if (!y || !m || !d) return ymd;
    return `${d}.${m}`;
  }

  function dayStatus(day) {
    const protein = Number(day?.protein_grams || 0);
    if (protein <= 0) return "—";
    return day?.in_target ? "✅" : "⚠️";
  }

  async function loadHistoryRange(currentToken, nextOffset, append) {
    const res = await fetch(`/api/web-history?range=7&offset=${nextOffset}`, {
      headers: authHeaders(currentToken),
    });
    const data = await res.json();
    if (res.status === 401) {
      localStorage.removeItem("auth_token");
      setIsAuthed(false);
      setToken("");
      setAuthError("Сессия истекла. Введите пароль снова");
      return;
    }
    if (!res.ok) throw new Error(data?.error || "Ошибка загрузки истории");

    setHistoryDays((prev) => (append ? [...prev, ...(data.days || [])] : (data.days || [])));
    setHistoryHasMore(Boolean(data.has_more));
    setHistoryOffset(nextOffset + 7);
  }

  async function loadHistoryDay(currentToken, date) {
    const res = await fetch(`/api/web-history?date=${date}`, {
      headers: authHeaders(currentToken),
    });
    const data = await res.json();
    if (res.status === 401) {
      localStorage.removeItem("auth_token");
      setIsAuthed(false);
      setToken("");
      setAuthError("Сессия истекла. Введите пароль снова");
      return null;
    }
    if (!res.ok) throw new Error(data?.error || "Ошибка загрузки дня");
    return data;
  }

  async function loadToday(currentToken) {
    try {
      setError("");
      const res = await fetch("/api/web-today", {
        headers: authHeaders(currentToken),
      });
      const data = await res.json();

      if (res.status === 401) {
        localStorage.removeItem("auth_token");
        setIsAuthed(false);
        setToken("");
        setAuthError("Неверный пароль");
        return;
      }

      if (!res.ok) throw new Error(data?.error || "Ошибка загрузки");
      setMeals(data.meals || []);
      setTotals(data.totals || { protein_grams: 0 });
      setTarget(data.target || { protein_target: null });
      setProteinTargetInput(data.target?.protein_target ?? "");
      await loadHistoryRange(currentToken, 0, false);
    } catch (e) {
      setError(e.message || "Ошибка загрузки");
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem("auth_token") || "";
    if (!stored) {
      setAuthReady(true);
      return;
    }

    setToken(stored);
    setIsAuthed(true);
    setAuthReady(true);
    loadToday(stored);
  }, []);

  async function onLogin(e) {
    e.preventDefault();
    const candidate = passwordInput.trim();
    if (!candidate) {
      setAuthError("Введите пароль");
      return;
    }

    setLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/web-today", {
        headers: authHeaders(candidate),
      });
      const data = await res.json();
      if (res.status === 401) {
        setAuthError("Неверный пароль");
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Ошибка входа");

      localStorage.setItem("auth_token", candidate);
      setToken(candidate);
      setIsAuthed(true);
      setMeals(data.meals || []);
      setTotals(data.totals || { protein_grams: 0 });
      setTarget(data.target || { protein_target: null });
      setProteinTargetInput(data.target?.protein_target ?? "");
      await loadHistoryRange(candidate, 0, false);
      setPasswordInput("");
    } catch (e) {
      setAuthError(e.message || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitMeal(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const payload = mode === "text"
        ? { type: "text", content: text.trim() }
        : { type: "image", content: imageBase64, caption: imageCaption.trim() };

      if (!payload.content) throw new Error(mode === "text" ? "Введите описание блюда" : "Загрузите фото");

      const res = await fetch("/api/web-log", {
        method: "POST",
        headers: authHeaders(token, true),
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 401) {
        localStorage.removeItem("auth_token");
        setIsAuthed(false);
        setToken("");
        setAuthError("Сессия истекла. Введите пароль снова");
        return;
      }

      if (!res.ok) throw new Error(data?.error || "Не удалось записать прием");

      setSuccess(`Записано: ${data.meal_name}. Белок: ${Math.round(Number(data.protein_grams || 0))} г`);
      setText("");
      setImageBase64("");
      setImagePreview("");
      setImageCaption("");
      await loadToday(token);
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
      const proteinTarget = Number(proteinTargetInput);
      const res = await fetch("/api/web-user", {
        method: "POST",
        headers: authHeaders(token, true),
        body: JSON.stringify({ protein_target: proteinTarget }),
      });
      const data = await res.json();

      if (res.status === 401) {
        localStorage.removeItem("auth_token");
        setIsAuthed(false);
        setToken("");
        setAuthError("Сессия истекла. Введите пароль снова");
        return;
      }

      if (!res.ok) throw new Error(data?.error || "Не удалось сохранить цель");
      setTarget({ protein_target: data.protein_target });
      setSuccess("Цель сохранена");
    } catch (e) {
      setError(e.message || "Ошибка сохранения цели");
    } finally {
      setLoading(false);
    }
  }

  async function onDeleteMeal(mealId) {
    if (!confirm("Удалить эту запись?")) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/web-meal?id=${mealId}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      const data = await res.json();

      if (res.status === 401) {
        localStorage.removeItem("auth_token");
        setIsAuthed(false);
        setToken("");
        setAuthError("Сессия истекла. Введите пароль снова");
        return;
      }

      if (!res.ok) throw new Error(data?.error || "Не удалось удалить запись");
      setSuccess("Запись удалена");
      await loadToday(token);
    } catch (e) {
      setError(e.message || "Ошибка удаления");
    } finally {
      setLoading(false);
    }
  }

  async function onSaveMealEdit(mealId) {
    const newText = editingMealText.trim();
    if (!newText) {
      setError("Описание не может быть пустым");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/web-meal?id=${mealId}`, {
        method: "PATCH",
        headers: authHeaders(token, true),
        body: JSON.stringify({ meal_description: newText }),
      });
      const data = await res.json();

      if (res.status === 401) {
        localStorage.removeItem("auth_token");
        setIsAuthed(false);
        setToken("");
        setAuthError("Сессия истекла. Введите пароль снова");
        return;
      }

      if (!res.ok) throw new Error(data?.error || "Не удалось обновить запись");

      setEditingMealId(null);
      setEditingMealText("");
      setSuccess("Запись обновлена");
      await loadToday(token);
    } catch (e) {
      setError(e.message || "Ошибка обновления");
    } finally {
      setLoading(false);
    }
  }

  async function convertToJpeg(file) {
    let blob = file;

    // Конвертируем HEIC через heic2any
    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.type === "" ||
      file.name?.toLowerCase().endsWith(".heic") ||
      file.name?.toLowerCase().endsWith(".heif");

    if (isHeic) {
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.7 });
      blob = Array.isArray(converted) ? converted[0] : converted;
    }

    // Сжимаем через canvas до максимум 1200px и quality 0.7
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1200;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((result) => {
          if (!result) { reject(new Error("Не удалось сжать фото")); return; }
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = String(reader.result || "").split(",")[1] || "";
            if (!base64) { reject(new Error("Не удалось прочитать фото")); return; }
            resolve(base64);
          };
          reader.onerror = () => reject(new Error("Ошибка чтения"));
          reader.readAsDataURL(result);
        }, "image/jpeg", 0.7);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось открыть фото")); };
      img.src = url;
    });
  }

  async function onPickImage(file) {
    if (!file) return;
    try {
      setError("");
      const base64 = await convertToJpeg(file);
      setImageBase64(base64);
      setImagePreview(`data:image/jpeg;base64,${base64}`);
    } catch (e) {
      setError(e.message || "Не удалось обработать фото");
    }
  }

  async function onLoadMoreHistory() {
    setHistoryLoadingMore(true);
    setError("");
    try {
      await loadHistoryRange(token, historyOffset, true);
    } catch (e) {
      setError(e.message || "Ошибка загрузки истории");
    } finally {
      setHistoryLoadingMore(false);
    }
  }

  async function onToggleHistoryDay(date) {
    const isOpen = Boolean(expandedDates[date]);
    if (isOpen) {
      setExpandedDates((prev) => ({ ...prev, [date]: false }));
      return;
    }

    setExpandedDates((prev) => ({ ...prev, [date]: true }));
    if (historyMealsByDate[date]) return;

    setHistoryMealsLoading((prev) => ({ ...prev, [date]: true }));
    setError("");
    try {
      const data = await loadHistoryDay(token, date);
      if (!data) return;
      setHistoryMealsByDate((prev) => ({ ...prev, [date]: data }));
    } catch (e) {
      setError(e.message || "Ошибка загрузки дня");
      setExpandedDates((prev) => ({ ...prev, [date]: false }));
    } finally {
      setHistoryMealsLoading((prev) => ({ ...prev, [date]: false }));
    }
  }

  if (!authReady) {
    return <main className="min-h-screen bg-white" />;
  }

  if (!isAuthed) {
    return (
      <main className="min-h-screen bg-white px-4">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
          <form onSubmit={onLogin} className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h1 className="text-lg font-semibold">Вход</h1>
            <p className="mt-1 text-sm text-slate-500">Введите пароль</p>
            <input
              type="password"
              className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
              placeholder="Пароль"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-base font-medium text-white"
            >
              {loading ? "Проверка..." : "Войти"}
            </button>
            {authError ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{authError}</p> : null}
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Трекер КБЖУ</h1>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Сегодня съедено белка</p>
          <p className="mt-1 text-lg font-semibold">
            {Math.round(Number(totals?.protein_grams || 0))} / {target?.protein_target ?? "-"} г
          </p>
          <div className="mt-3 h-3 w-full rounded-full bg-slate-200">
            <div className="h-3 rounded-full bg-emerald-500" style={{ width: `${progressPct}%` }} />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-slate-100 p-3">
              <p className="text-xs text-slate-500">Калории</p>
              <p className="mt-1 text-sm font-semibold">{Math.round(Number(totals?.calories || 0))} ккал</p>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <p className="text-xs text-slate-500">Жиры</p>
              <p className="mt-1 text-sm font-semibold">{Math.round(Number(totals?.fat_grams || 0))} г</p>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <p className="text-xs text-slate-500">Углеводы</p>
              <p className="mt-1 text-sm font-semibold">{Math.round(Number(totals?.carb_grams || 0))} г</p>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <p className="text-xs text-slate-500">Клетчатка</p>
              <p className="mt-1 text-sm font-semibold">{Math.round(Number(totals?.fiber_grams || 0))} г</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Цель по белку</h2>
          <form className="mt-3 space-y-3" onSubmit={onSaveTarget}>
            <input
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
              type="number"
              placeholder="Цель в граммах"
              value={proteinTargetInput}
              onChange={(e) => setProteinTargetInput(e.target.value)}
            />
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
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="rounded-xl bg-slate-200 px-4 py-3 text-base"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    Камера
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-slate-200 px-4 py-3 text-base"
                    onClick={() => galleryInputRef.current?.click()}
                  >
                    Галерея
                  </button>
                </div>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*,image/heic,image/heif"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => onPickImage(e.target.files?.[0])}
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*,image/heic,image/heif"
                  className="hidden"
                  onChange={(e) => onPickImage(e.target.files?.[0])}
                />
                {imagePreview ? (
                  <div className="space-y-3">
                    <img src={imagePreview} alt="preview" className="max-h-[200px] w-full rounded-xl object-cover" />
                    <input
                      className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base"
                      placeholder="Добавить описание (необязательно)"
                      value={imageCaption}
                      onChange={(e) => setImageCaption(e.target.value)}
                    />
                  </div>
                ) : null}
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
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingMealId === meal.id ? (
                      <div className="space-y-2">
                        <input
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          value={editingMealText}
                          onChange={(e) => setEditingMealText(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                            onClick={() => onSaveMealEdit(meal.id)}
                          >
                            Сохранить
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-slate-300 px-3 py-2 text-sm"
                            onClick={() => {
                              setEditingMealId(null);
                              setEditingMealText("");
                            }}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium">{idx + 1}. {meal.meal_description}</p>
                        <p className="mt-1 text-sm text-slate-600">Белок: {Math.round(Number(meal.protein_grams || 0))} г</p>
                      </>
                    )}
                  </div>
                  {editingMealId !== meal.id ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="h-10 w-10 rounded-xl bg-white text-lg"
                        onClick={() => {
                          setEditingMealId(meal.id);
                          setEditingMealText(meal.meal_description || "");
                        }}
                        aria-label="Редактировать"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="h-10 w-10 rounded-xl bg-white text-lg"
                        onClick={() => onDeleteMeal(meal.id)}
                        aria-label="Удалить"
                      >
                        🗑️
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">История</h2>
          <ul className="mt-3 space-y-2">
            {historyDays.length === 0 ? <li className="text-sm text-slate-500">Нет данных</li> : null}
            {historyDays.map((day) => (
              <li key={day.date} className="rounded-xl bg-slate-100 p-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl text-left"
                  onClick={() => onToggleHistoryDay(day.date)}
                >
                  <span className="text-sm font-medium">{formatDay(day.date)}</span>
                  <span className="text-sm text-slate-700">{Math.round(Number(day.protein_grams || 0))} г</span>
                  <span className="text-lg">{dayStatus(day)}</span>
                </button>

                {expandedDates[day.date] ? (
                  <div className="mt-3 rounded-xl bg-white p-3">
                    {historyMealsLoading[day.date] ? (
                      <p className="text-sm text-slate-500">Загрузка...</p>
                    ) : (
                      <>
                        <ul className="space-y-2">
                          {(historyMealsByDate[day.date]?.meals || []).length === 0 ? (
                            <li className="text-sm text-slate-500">Записей нет</li>
                          ) : (
                            (historyMealsByDate[day.date]?.meals || []).map((meal, idx) => (
                              <li key={meal.id || idx} className="text-sm">
                                {idx + 1}. {meal.meal_description} ({Math.round(Number(meal.protein_grams || 0))} г)
                              </li>
                            ))
                          )}
                        </ul>
                        <p className="mt-2 text-sm text-slate-600">
                          Итого: {Math.round(Number(historyMealsByDate[day.date]?.totals?.protein_grams || 0))} г, {Math.round(Number(historyMealsByDate[day.date]?.totals?.calories || 0))} ккал
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {historyHasMore ? (
            <button
              type="button"
              className="mt-3 w-full rounded-xl bg-slate-200 px-4 py-3 text-base"
              disabled={historyLoadingMore}
              onClick={onLoadMoreHistory}
            >
              {historyLoadingMore ? "Загрузка..." : "Загрузить ещё 7 дней"}
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
