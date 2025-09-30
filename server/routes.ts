import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertSubscriptionSchema, insertConfessionSchema, insertEmailSchema } from "@shared/schema";
import { log } from "./vite";
import { requireAuth, requireAdmin, optionalAuth, supabase, type AuthRequest } from "./auth";
import { moderateContent, analyzeConfession, checkAIBudget } from "./openai";
import { confessionSchema, emailSubscribeSchema, signupSchema, loginSchema } from "./validation";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required environment variable: STRIPE_SECRET_KEY');
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error('Missing required environment variable: STRIPE_WEBHOOK_SECRET');
}

if (!process.env.STRIPE_PRICE_ID) {
  throw new Error('Missing required environment variable: STRIPE_PRICE_ID');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
});

const MAX_FREE_CONFESSIONS = parseInt(process.env.MAX_FREE_CONFESSIONS || "30");

const limiterAuth = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const limiterGeneral = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  }));

  app.use(optionalAuth as any);

  app.get("/api/health", async (req, res) => {
    try {
      res.json({ ok: true });
    } catch (error: any) {
      log(`Health check error: ${error.message}`);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/auth/signup", limiterAuth, async (req, res) => {
    try {
      const { email, password } = signupSchema.parse(req.body);
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({ 
        user: data.user, 
        session: data.session,
        message: 'Signup successful' 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", limiterAuth, async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return res.status(401).json({ error: error.message });
      }

      res.json({ 
        user: data.user, 
        session: data.session,
        message: 'Login successful' 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.substring(7);

      if (token) {
        await supabase.auth.admin.signOut(token);
      }

      res.json({ message: 'Logout successful' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/me", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const subscriptions = await storage.getUserSubscriptions(req.user.id);
      const activeSubscription = subscriptions.find(s => s.status === 'active');
      const confessionCount = await storage.getConfessionCount(req.user.id);

      res.json({
        id: req.user.id,
        email: req.user.email,
        isPremium: !!activeSubscription,
        confessionCount,
        subscription: activeSubscription || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/me/export", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const confessions = await storage.getConfessionsByUserId(req.user.id, 10000);
      const subscriptions = await storage.getUserSubscriptions(req.user.id);

      const exportData = {
        user: {
          id: req.user.id,
          email: req.user.email,
          exportDate: new Date().toISOString(),
        },
        confessions: confessions.map(c => ({
          id: c.id,
          content: c.content,
          createdAt: c.createdAt,
          aiSummary: c.aiSummary,
          aiTags: c.aiTags,
          aiIntensity: c.aiIntensity,
          aiReply: c.aiReply,
          source: c.source,
        })),
        subscriptions: subscriptions.map(s => ({
          id: s.id,
          status: s.status,
          currentPeriodEnd: s.currentPeriodEnd,
          updatedAt: s.updatedAt,
        })),
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="intimaia-export-${req.user.id}.json"`);
      res.json(exportData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/confess", limiterGeneral, requireAuth as any, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { content } = confessionSchema.parse(req.body);

      const moderation = await moderateContent(content);
      if (moderation.flagged) {
        return res.status(400).json({ 
          error: 'Content violates community guidelines',
          reason: moderation.reason 
        });
      }

      const confessionCount = await storage.getConfessionCount(req.user.id);
      const subscriptions = await storage.getUserSubscriptions(req.user.id);
      const isPremium = subscriptions.some(s => s.status === 'active');

      if (!isPremium && confessionCount >= MAX_FREE_CONFESSIONS) {
        return res.status(403).json({ 
          error: 'Free confession limit reached. Upgrade to premium for unlimited confessions.',
          limit: MAX_FREE_CONFESSIONS 
        });
      }

      const analysis = await analyzeConfession(content, req.user.id);

      const confession = await storage.createConfession({
        userId: req.user.id,
        content,
      });

      if (analysis) {
        await storage.updateConfessionAiData(confession.id, {
          aiSummary: analysis.summary,
          aiTags: analysis.tags,
          aiIntensity: analysis.intensity,
          aiReply: analysis.reply,
        });
      }

      res.json({
        confession: {
          ...confession,
          aiSummary: analysis.summary,
          aiTags: analysis.tags,
          aiIntensity: analysis.intensity,
          aiReply: analysis.reply,
          source: analysis.source,
        }
      });
    } catch (error: any) {
      log(`Confession error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/confessions", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const confessions = await storage.getConfessionsByUserId(req.user.id, limit);

      res.json({ confessions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/confessions/:id", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { id } = req.params;
      const deleted = await storage.deleteConfession(id, req.user.id);

      if (!deleted) {
        return res.status(404).json({ error: 'Confession not found or not authorized' });
      }

      res.json({ message: 'Confession deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/checkout", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: process.env.STRIPE_PRICE_ID,
            quantity: 1,
          },
        ],
        success_url: `${req.headers.origin || 'http://localhost:5000'}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || 'http://localhost:5000'}/pricing`,
        client_reference_id: req.user.id,
        metadata: {
          user_id: req.user.id,
        },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/billing/portal", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const subscriptions = await storage.getUserSubscriptions(req.user.id);
      const activeSubscription = subscriptions.find(s => s.status === 'active');

      if (!activeSubscription || !activeSubscription.stripeCustomerId) {
        return res.status(404).json({ error: 'No active subscription found' });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: activeSubscription.stripeCustomerId,
        return_url: `${req.headers.origin || 'http://localhost:5000'}/account`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/webhook/stripe", async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    if (!sig) {
      log('Missing Stripe signature header');
      return res.status(400).json({ error: 'Missing signature header' });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody as Buffer,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
      
      log(`Webhook verified: ${event.type}`);
    } catch (err: any) {
      log(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      try {
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        
        const existingSubscription = await storage.getSubscriptionByStripeCustomerId(customerId);
        
        if (existingSubscription) {
          log(`Subscription already exists for customer: ${customerId}`);
          return res.json({ received: true, message: 'Subscription already exists' });
        }

        const userId = session.metadata?.user_id || session.client_reference_id;
        
        if (!userId) {
          log(`No user_id found in session metadata`);
          return res.status(400).json({ error: 'Missing user_id in session metadata' });
        }
        
        const stripeSubscription = subscriptionId 
          ? await stripe.subscriptions.retrieve(subscriptionId)
          : null;
        
        const subscriptionData: any = {
          userId,
          stripeCustomerId: customerId,
          stripePriceId: stripeSubscription?.items?.data[0]?.price?.id,
          status: stripeSubscription?.status || 'incomplete',
        };
        
        if (stripeSubscription && (stripeSubscription as any).current_period_end) {
          subscriptionData.currentPeriodEnd = new Date((stripeSubscription as any).current_period_end * 1000);
        }

        const validatedData = insertSubscriptionSchema.parse(subscriptionData);
        const newSubscription = await storage.createSubscription(validatedData);
        
        log(`Created subscription: ${newSubscription.id} for customer: ${customerId}`);
        
        res.json({ 
          received: true, 
          message: 'Subscription created successfully',
          subscriptionId: newSubscription.id 
        });
        
      } catch (error: any) {
        log(`Error processing checkout session: ${error.message}`);
        res.status(500).json({ 
          error: 'Failed to process subscription',
          message: error.message 
        });
      }
    } else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      
      try {
        const customerId = invoice.customer as string;
        const subscriptionId = (invoice as any).subscription as string;

        if (!subscriptionId) {
          return res.json({ received: true, message: 'No subscription in invoice' });
        }

        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        
        await storage.updateSubscriptionStatus(
          customerId,
          stripeSubscription.status,
          new Date((stripeSubscription as any).current_period_end * 1000)
        );

        log(`Updated subscription for customer: ${customerId}`);
        res.json({ received: true });
      } catch (error: any) {
        log(`Error processing invoice: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    } else {
      log(`Unhandled webhook event type: ${event.type}`);
      res.json({ received: true, message: 'Event type not handled' });
    }
  });

  app.post("/api/emails", async (req, res) => {
    try {
      const { email } = emailSubscribeSchema.parse(req.body);
      
      const existingEmail = await storage.getEmails();
      if (existingEmail.some(e => e.email === email)) {
        return res.status(400).json({ error: 'Email already subscribed' });
      }

      await storage.createEmail({ email, userId: null });
      res.json({ message: 'Email subscribed successfully' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/admin/stats", requireAdmin as any, async (req: AuthRequest, res) => {
    try {
      const currentMonth = new Date().toISOString().substring(0, 7);
      const aiUsage = await storage.getAiUsageByMonth(currentMonth);

      res.json({
        month: currentMonth,
        aiUsage: aiUsage || { month: currentMonth, totalInputTokens: 0, totalOutputTokens: 0, estCostEur: '0' },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/ai-usage", requireAdmin as any, async (req: AuthRequest, res) => {
    try {
      const budget = await checkAIBudget();
      res.json(budget);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/subscriptions/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const subscriptions = await storage.getUserSubscriptions(userId);
      
      res.json({
        subscriptions,
        activeCount: subscriptions.filter(s => s.status === 'active').length
      });
    } catch (error: any) {
      log(`Error fetching subscriptions: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);

  const originalListen = httpServer.listen.bind(httpServer);
  httpServer.listen = function(...args: any[]) {
    const result = originalListen(...args);
    
    const port = typeof args[0] === 'number' ? args[0] : process.env.PORT || 5000;
    
    const replitDomains = process.env.REPLIT_DOMAINS;
    if (replitDomains) {
      const publicUrl = `https://${replitDomains.split(',')[0]}`;
      log(`🚀 Intimaia Backend is live!`);
      log(`📍 Public URL: ${publicUrl}`);
      log(`🔗 Health Check: ${publicUrl}/api/health`);
      log(`🎯 Stripe Webhook URL: ${publicUrl}/api/webhook/stripe`);
      log(`📋 Copy this webhook URL to your Stripe dashboard`);
    } else {
      log(`🚀 Intimaia Backend running on port ${port}`);
      log(`🔗 Health Check: http://localhost:${port}/api/health`);
      log(`🎯 Stripe Webhook: http://localhost:${port}/api/webhook/stripe`);
    }
    
    return result;
  } as any;

  return httpServer;
}
