// src/worker.js
// إصدار: 2026-09-22.2
var ALLOWED_ORIGINS = ["https://injaz.awraqai.com", "https://teachermnr-ui.github.io"];
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

var EXERCISE_TYPES_GUIDE = `
أنواع التمارين المسموح بإنتاجها فقط، وشكل كل نوع بالضبط:

1) "fill-blank" (أكمل الفراغ):
   data: { "items": [ { "prompt": "نص السؤال فيه فراغ ___", "answer": "الإجابة الصحيحة" } ] }

2) "true-false" (صواب أو خطأ):
   data: { "items": [ { "statement": "نص العبارة", "answer": true } ] }
   (answer يكون true أو false فقط)

3) "mcq" (اختيار من متعدد):
   data: { "items": [ { "prompt": "نص السؤال", "options": ["خيار1","خيار2","خيار3","خيار4"], "correctIndex": 0 } ] }
   (correctIndex هو رقم موقع الإجابة الصحيحة داخل options، يبدأ من صفر)

4) "matching" (توصيل/مزاوجة):
   data: { "pairs": [ { "left": "العنصر الأول", "right": "ما يقابله الصحيح" } ] }

5) "ordering" (ترتيب):
   data: { "items": ["الخطوة الأولى", "الخطوة الثانية", "الخطوة الثالثة"] }
   (يجب أن تكون العناصر بترتيبها الصحيح بالضبط)

6) "open-text" (سؤال مقالي مفتوح، بدون تصحيح تلقائي):
   data: { "prompt": "نص السؤال المفتوح" }

لا تخترع أنواعًا أخرى غير هذه الستة إطلاقًا.
`;

async function callClaude(env, imageBase64, mediaType, counts) {
  const countsText = counts && Object.keys(counts).length
    ? `العدد المطلوب تحديدًا من كل نوع: ${JSON.stringify(counts)}. التزم بهذه الأعداد بالضبط إن أمكن استخراجها من محتوى الصفحة.`
    : `استخرج كل الأسئلة/التمارين الموجودة فعليًا في الصفحة، بأنواعها المناسبة.`;

  const systemPrompt = `أنت محرك تحليل أوراق عمل تعليمية عربية. ستستلم صورة صفحة من ملف PDF (قد تحتوي على أخطاء طباعة أو خط غير واضح جزئيًا). مهمتك: اقرأ محتوى الصفحة بدقة تامة معتمدًا على الشكل المرئي الفعلي للحروف، وحوّل كل سؤال/تمرين تجده إلى الصيغة المنظّمة التالية.

${EXERCISE_TYPES_GUIDE}

${countsText}

أعد النتيجة حصرًا عبر استدعاء الأداة return_exercises المتاحة لك، ولا تكتب أي نص خارجها.`;

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 }
          },
          { type: "text", text: "حلّل هذه الصفحة واستخرج التمارين منها حسب التعليمات." }
        ]
      }
    ],
    tools: [
      {
        name: "return_exercises",
        description: "إرجاع قائمة التمارين المستخرجة من الصفحة بصيغة منظّمة",
        input_schema: {
          type: "object",
          properties: {
            exercises: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["fill-blank", "true-false", "mcq", "matching", "ordering", "open-text"]
                  },
                  data: { type: "object" }
                },
                required: ["type", "data"]
              }
            }
          },
          required: ["exercises"]
        }
      }
    ],
    tool_choice: { type: "tool", name: "return_exercises" }
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Claude API error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const toolUse = (data.content || []).find((b) => b.type === "tool_use" && b.name === "return_exercises");
  if (!toolUse) throw new Error("لم يُرجع Claude نتيجة منظّمة.");
  return toolUse.input.exercises || [];
}

export default {
  async fetch(request, env) {
    const CORS_HEADERS = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
      const payload = await request.json();
      const { image, counts } = payload;

      if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
        return new Response(
          JSON.stringify({ error: "يجب إرسال صورة صحيحة بصيغة data URL (data:image/...)." }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const match = image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (!match) {
        return new Response(
          JSON.stringify({ error: "تعذّر قراءة تنسيق الصورة المرسلة." }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const mediaType = match[1];
      const imageBase64 = match[2];
      const exercises = await callClaude(env, imageBase64, mediaType, counts);

      return new Response(JSON.stringify({ exercises }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message || "خطأ غير متوقع في السيرفر." }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  }
};
