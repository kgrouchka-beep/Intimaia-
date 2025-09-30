import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertSubscriptionSchema } from "@shared/schema";
import { log } from "./vite";

// Environment variable validation
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required environment variable: STRIPE_SECRET_KEY');
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error('Missing required environment variable: STRIPE_WEBHOOK_SECRET');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint
  app.get("/api/health", async (req, res) => {
    try {
      res.json({ ok: true });
    } catch (error: any) {
      log(`Health check error: ${error.message}`);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Stripe webhook endpoint
  app.post("/api/webhook/stripe", async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    if (!sig) {
      log('Missing Stripe signature header');
      return res.status(400).json({ error: 'Missing signature header' });
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
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

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      try {
        // Extract customer information from the session
        const customerId = session.customer as string;
        const sessionId = session.id;
        
        // Check if subscription already exists
        const existingSubscription = await storage.getSubscriptionByStripeSessionId(sessionId);
        
        if (existingSubscription) {
          log(`Subscription already exists for session: ${sessionId}`);
          return res.json({ received: true, message: 'Subscription already exists' });
        }

        // For demo purposes, we'll use a default user ID
        // In a real app, you'd associate the customer ID with a user
        const defaultUserId = "default-user-id";
        
        // Create new subscription record
        const subscriptionData = {
          userId: defaultUserId,
          stripeSessionId: sessionId,
          active: true,
        };

        // Validate the subscription data
        const validatedData = insertSubscriptionSchema.parse(subscriptionData);
        
        // Store the subscription in the database
        const newSubscription = await storage.createSubscription(validatedData);
        
        log(`Created subscription: ${newSubscription.id} for session: ${sessionId}`);
        
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
    } else {
      log(`Unhandled webhook event type: ${event.type}`);
      res.json({ received: true, message: 'Event type not handled' });
    }
  });

  // Get subscription status endpoint (bonus feature)
  app.get("/api/subscriptions/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const subscriptions = await storage.getUserSubscriptions(userId);
      
      res.json({
        subscriptions,
        activeCount: subscriptions.filter(s => s.active).length
      });
    } catch (error: any) {
      log(`Error fetching subscriptions: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);

  // Log the server URL on startup
  const originalListen = httpServer.listen;
  httpServer.listen = function(this: any, ...args: any[]) {
    const result = originalListen.apply(this, args);
    
    // Get the port from the arguments or environment
    const port = args[0]?.port || process.env.PORT || 5000;
    
    // Check if we have a Replit domain
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
  };

  return httpServer;
}
