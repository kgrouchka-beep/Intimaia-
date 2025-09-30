import OpenAI from "openai";
import { storage } from "./storage";

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing required environment variable: OPENAI_API_KEY');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";
const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || "256");
const AI_MONTHLY_HARDCAP_EUR = parseFloat(process.env.AI_MONTHLY_HARDCAP_EUR || "20");
const AI_SOFTCAP_WARN_EUR = parseFloat(process.env.AI_SOFTCAP_WARN_EUR || "18");
const FX_USD_EUR = parseFloat(process.env.FX_USD_EUR || "0.92");
const FEATURE_AI = process.env.FEATURE_AI !== 'false';

interface AIAnalysis {
  summary: string;
  tags: string[];
  intensity: number;
  reply: string;
  source: 'ai' | 'heuristic';
}

interface ModerationResult {
  flagged: boolean;
  reason?: string;
}

export async function moderateContent(content: string): Promise<ModerationResult> {
  try {
    const moderation = await openai.moderations.create({
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

export async function analyzeConfession(content: string, userId: string): Promise<AIAnalysis> {
  if (!FEATURE_AI) {
    return generateHeuristicAnalysis(content);
  }

  const currentMonth = new Date().toISOString().substring(0, 7);
  const usage = await storage.getAiUsageByMonth(currentMonth);
  
  if (usage && parseFloat(usage.estCostEur) >= AI_MONTHLY_HARDCAP_EUR) {
    console.log(`AI hardcap reached for ${currentMonth}, using heuristic fallback`);
    return generateHeuristicAnalysis(content);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `Tu es un assistant empathique qui analyse des confessions personnelles. Réponds UNIQUEMENT en JSON avec cette structure:
{
  "summary": "résumé en 1-2 phrases",
  "tags": ["tag1", "tag2", "tag3"],
  "intensity": 5,
  "reply": "réponse bienveillante et encourageante"
}

- summary: résumé concis de la confession
- tags: 2-4 tags émotionnels (ex: anxiété, joie, tristesse, colère, espoir)
- intensity: niveau d'intensité émotionnelle de 0 (calme) à 10 (très intense)
- reply: réponse empathique et encourageante en 2-3 phrases`
        },
        {
          role: "user",
          content: content
        }
      ]
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('No response from AI');
    }

    const analysis = JSON.parse(response);
    
    const inputTokens = completion.usage?.prompt_tokens || 0;
    const outputTokens = completion.usage?.completion_tokens || 0;
    
    const costUSD = (inputTokens * 0.00015 + outputTokens * 0.0006) / 1000;
    const costEUR = (costUSD * FX_USD_EUR).toFixed(4);

    await storage.createOrUpdateAiUsage({
      month: currentMonth,
      inputTokensToAdd: inputTokens,
      outputTokensToAdd: outputTokens,
      costToAdd: costEUR,
    });

    return {
      summary: analysis.summary || '',
      tags: (analysis.tags || []).slice(0, 4),
      intensity: Math.min(10, Math.max(0, analysis.intensity || 5)),
      reply: analysis.reply || '',
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

export async function checkAIBudget(): Promise<{ available: boolean; usage?: any; warning?: boolean }> {
  const currentMonth = new Date().toISOString().substring(0, 7);
  const usage = await storage.getAiUsageByMonth(currentMonth);
  
  if (!usage) {
    return { available: true };
  }

  const cost = parseFloat(usage.estCostEur);
  
  if (cost >= AI_MONTHLY_HARDCAP_EUR) {
    return { available: false, usage };
  }

  if (cost >= AI_SOFTCAP_WARN_EUR) {
    return { available: true, usage, warning: true };
  }

  return { available: true, usage };
}
