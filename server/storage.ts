import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, desc } from "drizzle-orm";
import { 
  type Subscription, 
  type InsertSubscription,
  type Confession,
  type InsertConfession,
  type AiUsage,
  type InsertAiUsage,
  type Email,
  type InsertEmail,
  type User,
  type UpsertUser,
  confessions,
  aiUsage,
  usersSubscriptions,
  emails,
  users
} from "@shared/schema";
import { pool, runAs } from "./db";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseUrl = process.env.DATABASE_URL;
console.log(`[DB] Connecting to: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
  prepare: false,
});

export const db = drizzle(sql);

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Confession methods
  createConfession(confession: InsertConfession, role?: string): Promise<Confession>;
  getConfessionsByUserId(userId: string, role?: string, limit?: number): Promise<Confession[]>;
  getConfessionCount(userId: string, role?: string): Promise<number>;
  deleteConfession(id: string, userId: string, role?: string): Promise<boolean>;
  updateConfessionAiData(id: string, aiData: {
    aiSummary: string;
    aiTags: string[];
    aiIntensity: number;
    aiReply: string;
  }): Promise<Confession | undefined>;
  
  // AI Usage methods
  getAiUsageByMonth(month: string): Promise<AiUsage | undefined>;
  createOrUpdateAiUsage(data: {
    month: string;
    inputTokensToAdd: number;
    outputTokensToAdd: number;
    costToAdd: string;
  }): Promise<AiUsage>;
  
  // Subscription methods
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | undefined>;
  getUserSubscriptions(userId: string): Promise<Subscription[]>;
  updateSubscriptionStatus(
    stripeCustomerId: string, 
    status: string, 
    currentPeriodEnd?: Date
  ): Promise<Subscription | undefined>;
  
  // Email methods
  createEmail(email: InsertEmail): Promise<Email>;
  getEmails(): Promise<Email[]>;
}

export class DbStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Confession methods
  async createConfession(insertConfession: InsertConfession, role: string = 'user'): Promise<Confession> {
    return await runAs({ id: insertConfession.userId, role }, async (client) => {
      const result = await client.query(
        `INSERT INTO confessions (user_id, content, source) 
         VALUES ($1, $2, $3) 
         RETURNING 
           id, 
           user_id as "userId", 
           content, 
           ai_summary as "aiSummary", 
           ai_tags as "aiTags", 
           ai_intensity as "aiIntensity", 
           ai_reply as "aiReply", 
           source, 
           created_at as "createdAt"`,
        [insertConfession.userId, insertConfession.content, insertConfession.source || 'user']
      );
      return result.rows[0];
    });
  }

  async getConfessionsByUserId(userId: string, role: string = 'user', limit: number = 100): Promise<Confession[]> {
    return await runAs({ id: userId, role }, async (client) => {
      const result = await client.query(
        `SELECT 
           id, 
           user_id as "userId", 
           content, 
           ai_summary as "aiSummary", 
           ai_tags as "aiTags", 
           ai_intensity as "aiIntensity", 
           ai_reply as "aiReply", 
           source, 
           created_at as "createdAt"
         FROM confessions 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    });
  }

  async getConfessionCount(userId: string, role: string = 'user'): Promise<number> {
    return await runAs({ id: userId, role }, async (client) => {
      const result = await client.query(
        `SELECT COUNT(*) as count FROM confessions WHERE user_id = $1`,
        [userId]
      );
      return parseInt(result.rows[0].count, 10);
    });
  }

  async deleteConfession(id: string, userId: string, role: string = 'user'): Promise<boolean> {
    return await runAs({ id: userId, role }, async (client) => {
      const result = await client.query(
        `DELETE FROM confessions WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId]
      );
      return result.rows.length > 0;
    });
  }

  async updateConfessionAiData(id: string, aiData: {
    aiSummary: string;
    aiTags: string[];
    aiIntensity: number;
    aiReply: string;
  }): Promise<Confession | undefined> {
    const result = await db.update(confessions)
      .set(aiData)
      .where(eq(confessions.id, id))
      .returning();
    return result[0];
  }

  // AI Usage methods
  async getAiUsageByMonth(month: string): Promise<AiUsage | undefined> {
    const result = await db.select()
      .from(aiUsage)
      .where(eq(aiUsage.month, month))
      .limit(1);
    return result[0];
  }

  async createOrUpdateAiUsage(data: {
    month: string;
    inputTokensToAdd: number;
    outputTokensToAdd: number;
    costToAdd: string;
  }): Promise<AiUsage> {
    const existing = await this.getAiUsageByMonth(data.month);
    
    if (existing) {
      const newInputTokens = (existing.totalInputTokens || 0) + data.inputTokensToAdd;
      const newOutputTokens = (existing.totalOutputTokens || 0) + data.outputTokensToAdd;
      const newCost = (parseFloat(existing.estCostEur) + parseFloat(data.costToAdd)).toFixed(4);
      
      const result = await db.update(aiUsage)
        .set({ 
          totalInputTokens: newInputTokens,
          totalOutputTokens: newOutputTokens,
          estCostEur: newCost 
        })
        .where(eq(aiUsage.month, data.month))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(aiUsage).values({
        month: data.month,
        totalInputTokens: data.inputTokensToAdd,
        totalOutputTokens: data.outputTokensToAdd,
        estCostEur: data.costToAdd,
      }).returning();
      return result[0];
    }
  }

  // Subscription methods
  async createSubscription(insertSubscription: InsertSubscription): Promise<Subscription> {
    const result = await db.insert(usersSubscriptions).values(insertSubscription).returning();
    return result[0];
  }

  async getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | undefined> {
    const result = await db.select()
      .from(usersSubscriptions)
      .where(eq(usersSubscriptions.stripeCustomerId, stripeCustomerId))
      .limit(1);
    return result[0];
  }

  async getUserSubscriptions(userId: string): Promise<Subscription[]> {
    return await db.select()
      .from(usersSubscriptions)
      .where(eq(usersSubscriptions.userId, userId))
      .orderBy(desc(usersSubscriptions.updatedAt));
  }

  async updateSubscriptionStatus(
    stripeCustomerId: string, 
    status: string, 
    currentPeriodEnd?: Date
  ): Promise<Subscription | undefined> {
    const updateData: any = { status, updatedAt: new Date() };
    if (currentPeriodEnd) {
      updateData.currentPeriodEnd = currentPeriodEnd;
    }
    const result = await db.update(usersSubscriptions)
      .set(updateData)
      .where(eq(usersSubscriptions.stripeCustomerId, stripeCustomerId))
      .returning();
    return result[0];
  }

  // Email methods
  async createEmail(insertEmail: InsertEmail): Promise<Email> {
    const result = await db.insert(emails).values(insertEmail).returning();
    return result[0];
  }

  async getEmails(): Promise<Email[]> {
    return await db.select().from(emails).orderBy(desc(emails.createdAt));
  }
}

export const storage = new DbStorage();
