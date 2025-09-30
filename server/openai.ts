import OpenAI from "openai";
import { LRUCache } from "lru-cache";
import crypto from "crypto";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const BASE_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const SYSTEM_BASE = "Tu es l'assistant d'Intimaia. Réponds bref, clair, utile.";
const DEFAULT_TEMP = 0.4;

const aiCache = new LRUCache<string, string>({
  max: 500,
  ttl: 1000 * 60 * 20,
});

function cacheKey(userId: string, input: string, extra?: string) {
  const norm = (s: string) => s.trim().toLowerCase();
  const raw = `${userId}|${norm(input)}|${norm(extra ?? "")}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

type Budget = { euros: number; month: string };
const PRICE_PER_1K = Number(process.env.AI_PRICE_PER_1K ?? 0.15);
const CAP_EUR = Number(process.env.AI_CAP_EUR ?? 20);
const ALERT_EUR = Number(process.env.AI_ALERT_EUR ?? 18);

let budget: Budget = { euros: 0, month: new Date().toISOString().slice(0, 7) };

function rolloverMonth() {
  const nowMonth = new Date().toISOString().slice(0, 7);
  if (nowMonth !== budget.month) budget = { euros: 0, month: nowMonth };
}
function addUsage(tokensIn: number, tokensOut: number) {
  rolloverMonth();
  const euros = ((tokensIn + tokensOut) / 1000) * PRICE_PER_1K;
  budget.euros += euros;
  return budget.euros;
}
export function getBudget() {
  rolloverMonth();
  return { ...budget, cap: CAP_EUR, alert: ALERT_EUR };
}
export function aiAllowed() {
  rolloverMonth();
  return budget.euros < CAP_EUR;
}

type AskMiniOpts = {
  userId: string;
  input: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  cacheTtlMs?: number;
  signal?: AbortSignal;
};

export async function askMini(opts: AskMiniOpts): Promise<string> {
  const {
    userId,
    input,
    system = SYSTEM_BASE,
    temperature = DEFAULT_TEMP,
    maxTokens = 250,
    cacheTtlMs,
    signal,
  } = opts;

  const k = cacheKey(userId, input, system);
  const cached = aiCache.get(k);
  if (cached) return cached;

  if (!aiAllowed()) return fallbackAnswer(input, "budget");

  try {
    const res = await client.chat.completions.create({
      model: BASE_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
    }, signal ? { signal } : undefined);

    const choice = res.choices?.[0]?.message?.content?.trim() ?? "";
    const inTok = (res.usage?.prompt_tokens ?? 0);
    const outTok = (res.usage?.completion_tokens ?? 0);
    addUsage(inTok, outTok);

    if (budget.euros >= ALERT_EUR) {
      console.warn(`[AI] ALERT nearing cap: €${budget.euros.toFixed(2)}/${CAP_EUR}`);
    }

    aiCache.set(k, choice, { ttl: cacheTtlMs ?? aiCache.ttl });
    return choice || fallbackAnswer(input, "empty");
  } catch (e) {
    console.error("[AI] askMini error:", e);
    return fallbackAnswer(input, "error");
  }
}

type AskConfessionOpts = {
  userId: string;
  text: string;
};

const CONFESSION_SYSTEM =
  "Tu analyses un texte intime et renvoies des conseils brefs, doux, concrets. 3 points max.";

export async function askConfession({ userId, text }: AskConfessionOpts) {
  const userPrompt =
    `Analyse ce texte (max 3 bullet points concrets, style apaisant) :\n` +
    truncate(text, 800);

  const answer = await askMini({
    userId,
    input: userPrompt,
    system: CONFESSION_SYSTEM,
    maxTokens: 220,
    temperature: 0.3,
  });

  return {
    ok: true,
    type: "confession_advice",
    data: { advice: answer },
    budget: getBudget(),
  };
}

interface ModerationResult {
  flagged: boolean;
  reason?: string;
}

export async function moderateContent(content: string): Promise<ModerationResult> {
  try {
    const moderation = await client.moderations.create({
      input: content,
    });

    const result = moderation.results[0];
    
    if (result.flagged) {
      const categories = Object.entries(result.categories)
        .filter(([_, flagged]) => flagged)
        .map(([category]) => category);
      
      return {
        flagged: true,
        reason: `Content flagged for: ${categories.join(', ')}`
      };
    }

    return { flagged: false };
  } catch (error: any) {
    console.error('Moderation error:', error.message);
    return { flagged: false };
  }
}

interface AIAnalysis {
  summary: string;
  tags: string[];
  intensity: number;
  reply: string;
  source: 'ai' | 'heuristic';
}

export async function analyzeConfession(content: string, userId: string): Promise<AIAnalysis> {
  if (!aiAllowed()) {
    return generateHeuristicAnalysis(content);
  }

  try {
    const result = await askConfession({ userId, text: content });
    
    const tags = extractTags(content);
    const intensity = estimateIntensity(content);
    
    return {
      summary: truncate(content, 100),
      tags,
      intensity,
      reply: result.data.advice,
      source: 'ai'
    };
  } catch (error: any) {
    console.error('AI analysis error:', error.message);
    return generateHeuristicAnalysis(content);
  }
}

function generateHeuristicAnalysis(content: string): AIAnalysis {
  const words = content.toLowerCase();
  const length = content.length;
  
  const emotionKeywords = {
    tristesse: ['triste', 'déprim', 'pleur', 'chagrin', 'mélancolie', 'peine'],
    anxiété: ['anxie', 'stress', 'peur', 'inquiet', 'angoiss', 'nerveu'],
    colère: ['colère', 'énervé', 'furieu', 'rage', 'frustré', 'irrité'],
    joie: ['heureu', 'joie', 'content', 'ravi', 'euphori', 'sourire'],
    espoir: ['espoir', 'optimis', 'confian', 'positif', 'avenir', 'rêve'],
    solitude: ['seul', 'isolé', 'abandon', 'solitaire'],
    amour: ['amour', 'aime', 'affection', 'tendresse'],
    honte: ['honte', 'gêne', 'embarrass', 'coupable']
  };

  const detectedTags: string[] = [];
  let totalScore = 0;

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    const score = keywords.reduce((sum, keyword) => {
      const matches = (words.match(new RegExp(keyword, 'g')) || []).length;
      return sum + matches;
    }, 0);

    if (score > 0) {
      detectedTags.push(emotion);
      totalScore += score;
    }
  }

  const tags = detectedTags.length > 0 
    ? detectedTags.slice(0, 4) 
    : ['réflexion'];

  const intensity = Math.min(10, Math.max(1, Math.floor(totalScore * 1.5 + length / 200)));

  const summary = content.length > 100 
    ? content.substring(0, 97) + '...' 
    : content;

  const replies = [
    "Merci d'avoir partagé cela. Vos sentiments sont valides et importants.",
    "Je comprends que ce soit difficile. Prendre le temps d'écrire est déjà un pas vers le mieux-être.",
    "Vos émotions méritent d'être reconnues. Continuez à vous exprimer, cela fait partie du processus.",
    "C'est courageux de partager ces pensées. Vous n'êtes pas seul(e) dans ce ressenti."
  ];

  const reply = replies[Math.floor(Math.random() * replies.length)];

  return {
    summary,
    tags,
    intensity,
    reply,
    source: 'heuristic'
  };
}

function extractTags(text: string): string[] {
  const words = text.toLowerCase();
  const emotionKeywords = {
    tristesse: ['triste', 'déprim', 'pleur'],
    anxiété: ['anxie', 'stress', 'peur'],
    colère: ['colère', 'énervé', 'furieu'],
    joie: ['heureu', 'joie', 'content'],
  };

  const tags: string[] = [];
  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    if (keywords.some(k => words.includes(k))) {
      tags.push(emotion);
    }
  }
  return tags.length > 0 ? tags.slice(0, 3) : ['réflexion'];
}

function estimateIntensity(text: string): number {
  const length = text.length;
  const exclamations = (text.match(/!/g) || []).length;
  const questions = (text.match(/\?/g) || []).length;
  return Math.min(10, Math.max(1, Math.floor(length / 100 + exclamations * 2 + questions)));
}

function fallbackAnswer(input: string, reason: "budget" | "error" | "empty") {
  const base =
    reason === "budget"
      ? "Mode éco activé : réponse courte sans IA."
      : "Réponse courte (hors-ligne).";
  const s = summarizeOneLine(input);
  return `${base} ${s ? "Idée clé : " + s : ""}`.trim();
}

function summarizeOneLine(t: string): string {
  const one = t.replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.split(" ").slice(0, 22).join(" ");
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

export async function checkAIBudget(): Promise<{ available: boolean; usage?: any; warning?: boolean }> {
  rolloverMonth();
  const budgetInfo = getBudget();
  
  if (budgetInfo.euros >= budgetInfo.cap) {
    return { 
      available: false, 
      usage: { estCostEur: budgetInfo.euros.toFixed(2), month: budgetInfo.month }
    };
  }

  if (budgetInfo.euros >= budgetInfo.alert) {
    return { 
      available: true, 
      usage: { estCostEur: budgetInfo.euros.toFixed(2), month: budgetInfo.month },
      warning: true 
    };
  }

  return { 
    available: true, 
    usage: { estCostEur: budgetInfo.euros.toFixed(2), month: budgetInfo.month }
  };
}
