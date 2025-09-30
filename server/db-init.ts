import { db } from "./storage";
import { sql } from "drizzle-orm";
import { log } from "./vite";

export async function initDatabase() {
  try {
    log("Initializing database tables...");
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        is_premium BOOLEAN DEFAULT false NOT NULL,
        stripe_customer_id TEXT,
        created_at TIMESTAMP DEFAULT now() NOT NULL
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS confessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        ai_summary TEXT,
        ai_tags TEXT[],
        ai_intensity INTEGER,
        ai_reply TEXT,
        created_at TIMESTAMP DEFAULT now() NOT NULL
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        tokens INTEGER DEFAULT 0 NOT NULL,
        est_cost_eur DECIMAL(10, 4) DEFAULT 0 NOT NULL,
        created_at TIMESTAMP DEFAULT now() NOT NULL
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users_subscriptions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_session_id TEXT NOT NULL UNIQUE,
        stripe_subscription_id TEXT,
        active BOOLEAN DEFAULT true NOT NULL,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT now() NOT NULL
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS emails (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT now() NOT NULL
      );
    `);

    log("✅ Database tables initialized successfully");
  } catch (error: any) {
    log(`❌ Database initialization error: ${error.message}`);
    throw error;
  }
}
