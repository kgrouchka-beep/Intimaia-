import { Router } from "express";
import { askConfession } from "../openai";
import { isAuthenticated, getUserId } from "../replitAuth";

export const confessionsRouter = Router();

confessionsRouter.post("/analyze", isAuthenticated, async (req, res) => {
  try {
    const userId = getUserId(req);
    
    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const { text } = req.body as { text: string };
    
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_TEXT" });
    }

    const result = await askConfession({ userId, text });
    res.json(result);
  } catch (e) {
    console.error("[Confessions] Analyze error:", e);
    res.status(500).json({ ok: false, error: "ANALYZE_FAILED" });
  }
});
