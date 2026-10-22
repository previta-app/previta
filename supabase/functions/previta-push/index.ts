// PREVITA · avisos de remédio com o app fechado (Web Push).
// POST { acao: 'registrar', dispositivo, assinatura, horarios, fuso }  → guarda o celular e os horários (HH:MM)
// POST { acao: 'remover', dispositivo }                                 → para de enviar para este celular
// POST { acao: 'teste', dispositivo }                                   → manda um aviso de teste agora (1 por minuto)
// POST { acao: 'enviar' } + cabeçalho x-cron-token                      → chamado a cada minuto pelo pg_cron
// Nome de remédio e doença nunca chegam aqui: o aviso é genérico e o app mostra os detalhes ao abrir.
// Chaves (VAPID_PUBLIC, VAPID_PRIVATE, PUSH_CRON_TOKEN) ficam em config_privada, que só o servidor lê.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const ORIGENS = ["https://previta-app.github.io"];
const SERVICOS_PUSH = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)\//i;

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

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
let config: Record<string, string> | null = null;
async function cfg() {
  if (config) return config;
  const { data } = await sb.from("config_privada").select("nome, valor").in("nome", ["VAPID_PUBLIC", "VAPID_PRIVATE", "PUSH_CRON_TOKEN"]);
  config = Object.fromEntries((data || []).map((r: any) => [r.nome, r.valor]));
  webpush.setVapidDetails("mailto:comercial@fosterconstrucoes.com.br", config.VAPID_PUBLIC, config.VAPID_PRIVATE);
  return config;
}

// "2026-10-22 08:30" no fuso informado
function agoraNoFuso(fuso: string, menosMin = 0) {
  const d = new Date(Date.now() - menosMin * 60000);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { chave: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`, hora: `${p.hour}:${p.minute}` };
}
const fusoValido = (f: string) => { try { new Intl.DateTimeFormat("en", { timeZone: f }); return true; } catch { return false; } };

async function enviar(linha: any, dados: Record<string, unknown>) {
  try {
    await webpush.sendNotification({ endpoint: linha.endpoint, keys: { p256dh: linha.p256dh, auth: linha.auth } }, JSON.stringify(dados), { TTL: 900, urgency: "high" });
    if (linha.falhas) await sb.from("previta_push").update({ falhas: 0 }).eq("dispositivo", linha.dispositivo);
    return "ok";
  } catch (e: any) {
    const st = e?.statusCode || 0;
    if (st === 404 || st === 410) { await sb.from("previta_push").delete().eq("dispositivo", linha.dispositivo); return "removido"; }
    console.log(JSON.stringify({ diag: "push_falhou", status: st, corpo: String(e?.body || e).slice(0, 200) }));
    await sb.from("previta_push").update({ falhas: (linha.falhas || 0) + 1 }).eq("dispositivo", linha.dispositivo);
    return "falhou";
  }
}

async function rodadaDoMinuto() {
  const { data: fusos } = await sb.from("previta_push").select("fuso").lt("falhas", 50);
  const lista = [...new Set((fusos || []).map((f: any) => f.fuso))];
  let enviados = 0;
  for (const fuso of lista) {
    // minuto atual e o anterior (caso o agendador atrase um pouco)
    for (const m of [1, 0]) {
      const { chave, hora } = agoraNoFuso(fuso, m);
      const { data: linhas } = await sb.from("previta_push").select("*").eq("fuso", fuso).contains("horarios", [hora]).lt("falhas", 50);
      for (const l of linhas || []) {
        if (l.ultimo_envio && l.ultimo_envio >= chave) continue;
        await sb.from("previta_push").update({ ultimo_envio: chave }).eq("dispositivo", l.dispositivo);
        const r = await enviar(l, { tipo: "remedio", hora, titulo: "💊 Hora do remédio", corpo: `São ${hora}. Toque para abrir o PREVITA e ver qual remédio tomar.` });
        if (r === "ok") enviados++;
      }
    }
  }
  return enviados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resp(req, 405, { erro: "Use POST" });
  let b: any = null;
  try { b = await req.json(); } catch { return resp(req, 400, { erro: "Pedido inválido" }); }
  const c = await cfg();
  if (!c.VAPID_PUBLIC || !c.VAPID_PRIVATE) return resp(req, 503, { erro: "Avisos ainda não configurados." });

  if (b?.acao === "enviar") {
    if (!c.PUSH_CRON_TOKEN || req.headers.get("x-cron-token") !== c.PUSH_CRON_TOKEN) return resp(req, 401, { erro: "não autorizado" });
    return resp(req, 200, { enviados: await rodadaDoMinuto() });
  }

  const dispositivo = String(b?.dispositivo || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(dispositivo)) return resp(req, 400, { erro: "Dispositivo inválido" });

  if (b.acao === "registrar") {
    const a = b.assinatura || {};
    const endpoint = String(a.endpoint || ""), p256dh = String(a.keys?.p256dh || ""), auth = String(a.keys?.auth || "");
    if (!SERVICOS_PUSH.test(endpoint) || endpoint.length > 600 || !p256dh || !auth) return resp(req, 400, { erro: "Assinatura inválida" });
    const horarios = [...new Set((Array.isArray(b.horarios) ? b.horarios : []).map((h: unknown) => String(h)).filter((h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)))].sort().slice(0, 48);
    const fuso = fusoValido(String(b.fuso || "")) ? String(b.fuso) : "America/Sao_Paulo";
    // o mesmo celular pode ter trocado de identificador: o endereço de entrega manda
    await sb.from("previta_push").delete().eq("endpoint", endpoint).neq("dispositivo", dispositivo);
    const { error } = await sb.from("previta_push").upsert({ dispositivo, endpoint, p256dh: p256dh.slice(0, 200), auth: auth.slice(0, 100), horarios, fuso, falhas: 0, atualizado_em: new Date().toISOString() });
    if (error) { console.log(JSON.stringify({ diag: "registrar_erro", erro: error.message })); return resp(req, 500, { erro: "Não foi possível salvar." }); }
    return resp(req, 200, { ok: true, horarios: horarios.length });
  }
  if (b.acao === "remover") {
    await sb.from("previta_push").delete().eq("dispositivo", dispositivo);
    return resp(req, 200, { ok: true });
  }
  if (b.acao === "teste") {
    const { data: l } = await sb.from("previta_push").select("*").eq("dispositivo", dispositivo).maybeSingle();
    if (!l) return resp(req, 404, { erro: "Este celular ainda não está cadastrado para avisos." });
    if (l.ultimo_teste && Date.now() - new Date(l.ultimo_teste).getTime() < 60000) return resp(req, 429, { erro: "Espere 1 minuto para testar de novo." });
    await sb.from("previta_push").update({ ultimo_teste: new Date().toISOString() }).eq("dispositivo", dispositivo);
    const r = await enviar(l, { tipo: "teste", titulo: "🔔 Teste do PREVITA", corpo: "Funcionando! Os avisos de remédio vão chegar mesmo com o app fechado." });
    return resp(req, r === "ok" ? 200 : 502, r === "ok" ? { ok: true } : { erro: "O serviço de notificações do celular não aceitou o aviso." });
  }
  return resp(req, 400, { erro: "Ação desconhecida" });
});
