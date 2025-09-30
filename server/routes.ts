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
  apiVersion: "2025-08-27.basil",
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
        const subscriptionId = session.subscription as string;
        
        // Check if subscription already exists
        const existingSubscription = await storage.getSubscriptionByStripeCustomerId(customerId);
        
        if (existingSubscription) {
          log(`Subscription already exists for customer: ${customerId}`);
          return res.json({ received: true, message: 'Subscription already exists' });
        }

        // Get metadata from session (assumes user_id is passed in metadata)
        const userId = session.metadata?.user_id || session.client_reference_id;
        
        if (!userId) {
          log(`No user_id found in session metadata`);
          return res.status(400).json({ error: 'Missing user_id in session metadata' });
        }
        
        // Fetch subscription details from Stripe to get all fields
        const stripeSubscription = subscriptionId 
          ? await stripe.subscriptions.retrieve(subscriptionId)
          : null;
        
        // Create new subscription record
        const subscriptionData: any = {
          userId,
          stripeCustomerId: customerId,
          stripePriceId: stripeSubscription?.items?.data[0]?.price?.id,
          status: stripeSubscription?.status || 'incomplete',
        };
        
        // Add current_period_end if available
        if (stripeSubscription && (stripeSubscription as any).current_period_end) {
          subscriptionData.currentPeriodEnd = new Date((stripeSubscription as any).current_period_end * 1000);
        }

        // Validate the subscription data
        const validatedData = insertSubscriptionSchema.parse(subscriptionData);
        
        // Store the subscription in the database
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
        activeCount: subscriptions.filter(s => s.status === 'active').length
      });
    } catch (error: any) {
      log(`Error fetching subscriptions: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);

  // Log the server URL on startup
  const originalListen = httpServer.listen.bind(httpServer);
  httpServer.listen = function(...args: any[]) {
    const result = originalListen(...args);
    
    // Get the port from the arguments or environment
    const port = typeof args[0] === 'number' ? args[0] : process.env.PORT || 5000;
    
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
  } as any;

  return httpServer;
}
