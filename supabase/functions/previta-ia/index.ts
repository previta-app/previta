// PREVITA · IA do assistente PREV e da leitura de receita (Groq), no Supabase do Foster Calc.
// Mesmo formato do Worker antigo: POST { pergunta, modo } -> { resposta }. modo: 'receita' ou vazio (pergunta de saúde).
// Sem login (o PREVITA não tem conta): limite de uso por IP (guardado só como hash) para proteger a chave.
// Segredo: GROQ_API_KEY (o mesmo do VistorIA). verify_jwt desligado: função pública com limite próprio.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGENS = ["https://previta-app.github.io", "https://fosterfcs.github.io"];
const MODELOS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
const LIMITE_HORA = 40;

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGENS.includes(o) || o.startsWith("http://localhost") ? o : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const resp = (req: Request, status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const SISTEMA_CHAT = `Você é o PREV, assistente do app PREVITA (Prevenção + Vida), usado por famílias e idosos no Brasil para lembrar remédios e consultas.
Responda em português do Brasil, com frases curtas e palavras simples, em no máximo 8 linhas.
Dê informações gerais sobre remédios, doenças comuns, prevenção e uso do SUS (UBS, agentes comunitários, vacinas).
Nunca faça diagnóstico, nunca mande começar, parar, trocar ou mudar a dose de um remédio: diga para falar com o médico, o enfermeiro ou o farmacêutico.
Se a pergunta indicar emergência (dor no peito, falta de ar, desmaio, sinais de AVC, sangramento forte, intoxicação, pensamento de se machucar), mande ligar 192 (SAMU) na primeira linha.
Se não souber, diga que não sabe. Não invente nomes de remédios, doses ou números.`;

const SISTEMA_RECEITA = `Você recebe um texto lido por OCR de uma receita médica brasileira, que pode ter erros de leitura.
Extraia SOMENTE os medicamentos, um por linha, no formato "Nome concentração" (ex.: "Losartana 50 mg"), corrigindo erros óbvios de OCR em nomes conhecidos.
Não inclua nome de médico, paciente, CRM, endereço, datas, quantidades de caixas nem modo de usar.
Não escreva explicações, títulos ou numeração. Se não houver nenhum medicamento, responda apenas: NENHUM`;

async function hash(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("previta|" + s));
  return Array.from(new Uint8Array(d)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function chamarIA(chave: string, sistema: string, texto: string, maxTokens: number) {
  let ultimo = "";
  for (const modelo of MODELOS) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, temperature: 0.2, max_completion_tokens: maxTokens,
        messages: [{ role: "system", content: sistema }, { role: "user", content: texto }] }),
    });
    const t = await r.text();
    if (r.ok) {
      const c = (JSON.parse(t)?.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (c) return { ok: true, texto: c, modelo };
      ultimo = `${modelo}: resposta vazia`; continue;
    }
    ultimo = `${modelo} ${r.status}: ${t.slice(0, 200)}`;
    console.log(JSON.stringify({ diag: "groq_erro", modelo, status: r.status, corpo: t.slice(0, 300) }));
    if (r.status === 401 || r.status === 429) return { ok: false, motivo: r.status === 401 ? "chave" : "ocupada", detalhe: ultimo };
    // 400/404 de modelo indisponível: tenta o próximo
  }
  return { ok: false, motivo: "ia", detalhe: ultimo };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resp(req, 405, { erro: "Use POST" });

  let corpo: any = null;
  try { corpo = await req.json(); } catch { /* inválido */ }
  const modo = corpo?.modo === "receita" ? "receita" : "chat";
  const pergunta = String(corpo?.pergunta || "").trim().slice(0, modo === "receita" ? 6000 : 1200);
  if (pergunta.length < 2) return resp(req, 400, { erro: "Pergunta vazia." });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // chave: segredo da função; se não houver, a reserva guardada em config_privada (só o servidor lê)
  let chave = (Deno.env.get("GROQ_API_KEY") || "").trim();
  if (!chave) { const { data } = await sb.from("config_privada").select("valor").eq("nome", "GROQ_API_KEY").maybeSingle(); chave = (data?.valor || "").trim(); }
  if (!chave) return resp(req, 503, { erro: "IA não configurada." });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sem-ip";
  const h = await hash(ip);
  const { count } = await sb.from("previta_ia_uso").select("id", { count: "exact", head: true })
    .eq("chave", h).gte("criado_em", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= LIMITE_HORA) return resp(req, 429, { erro: "Muitas perguntas seguidas. Tente de novo daqui a pouco." });
  await sb.from("previta_ia_uso").insert({ chave: h, modo });

  const ia = modo === "receita"
    ? await chamarIA(chave, SISTEMA_RECEITA, pergunta, 400)
    : await chamarIA(chave, SISTEMA_CHAT, pergunta, 600);
  if (!ia.ok) return resp(req, 502, { erro: ia.motivo === "ocupada" ? "A IA está ocupada. Tente de novo em um minuto." : "A IA não respondeu agora." });

  let texto = ia.texto!;
  if (modo === "receita") {
    texto = texto.split(/\r?\n/).map((l) => l.replace(/^[\s\-•*\d.)]+/, "").trim())
      .filter((l) => l.length > 2 && l.length < 80 && !/^(nenhum|erro|aqui|segue|medicamentos?:)/i.test(l)).slice(0, 15).join("\n") || "NENHUM";
  }
  return resp(req, 200, { resposta: texto });
});
