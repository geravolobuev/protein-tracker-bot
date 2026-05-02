const OPENROUTER_MODELS = [
  "google/gemini-2.0-flash-001",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-4-maverick:free",
];

export async function analyzeMealWithGemini({ type, content }) {
  const apiKey = envOrThrow("OPENROUTER_API_KEY");

  const messages =
    type === "image"
      ? [
          {
            role: "user",
            content: [
              { type: "text", text: MEAL_PROMPT },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${content}` },
              },
            ],
          },
        ]
      : [{ role: "user", content: `${MEAL_PROMPT}\n\n${content}` }];

  let lastError = null;

  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        lastError = new Error(`OpenRouter error (${model}): ${res.status} ${errorText}`);
        console.error(lastError.message);
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      const parsed = parseModelJson(text);

      return {
        meal_name: String(parsed.meal_name || (type === "text" ? content : "Прием пищи")),
        calories: Number(parsed.calories || 0),
        protein_grams: Number(parsed.protein_grams || 0),
        fat_grams: Number(parsed.fat_grams || 0),
        carb_grams: Number(parsed.carb_grams || 0),
        fiber_grams: Number(parsed.fiber_grams || 0),
        confidence: String(parsed.confidence || "low"),
      };
    } catch (e) {
      lastError = e;
      console.error(`Model ${model} failed:`, e.message);
      continue;
    }
  }

  throw lastError || new Error("Все модели недоступны");
}