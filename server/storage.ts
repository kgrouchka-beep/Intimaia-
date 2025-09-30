import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, desc } from "drizzle-orm";
import { 
  type User, 
  type InsertUser, 
  type Subscription, 
  type InsertSubscription,
  type Confession,
  type InsertConfession,
  type AiUsage,
  type InsertAiUsage,
  type Email,
  type InsertEmail,
  users,
  confessions,
  aiUsage,
  usersSubscriptions,
  emails
} from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const sql = postgres(process.env.DATABASE_URL);
export const db = drizzle(sql);

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPremiumStatus(userId: string, isPremium: boolean, stripeCustomerId?: string): Promise<User | undefined>;
  deleteUser(userId: string): Promise<void>;
  
  // Confession methods
  createConfession(confession: InsertConfession): Promise<Confession>;
  getConfessionsByUserId(userId: string, limit?: number): Promise<Confession[]>;
  getConfessionCount(userId: string): Promise<number>;
  deleteConfession(id: string, userId: string): Promise<boolean>;
  updateConfessionAiData(id: string, aiData: {
    aiSummary: string;
    aiTags: string[];
    aiIntensity: number;
    aiReply: string;
  }): Promise<Confession | undefined>;
  
  // AI Usage methods
  getAiUsage(userId: string, month: string): Promise<AiUsage | undefined>;
  createOrUpdateAiUsage(data: InsertAiUsage & { tokensToAdd: number; costToAdd: string }): Promise<AiUsage>;
  
  // Subscription methods
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  getSubscriptionByStripeSessionId(stripeSessionId: string): Promise<Subscription | undefined>;
  getUserSubscriptions(userId: string): Promise<Subscription[]>;
  updateSubscriptionStatus(stripeSessionId: string, active: boolean, expiresAt?: Date): Promise<Subscription | undefined>;
  
  // Email methods
  createEmail(email: InsertEmail): Promise<Email>;
  getEmails(): Promise<Email[]>;
}

export class DbStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async updateUserPremiumStatus(userId: string, isPremium: boolean, stripeCustomerId?: string): Promise<User | undefined> {
    const updateData: any = { isPremium };
    if (stripeCustomerId) {
      updateData.stripeCustomerId = stripeCustomerId;
    }
    const result = await db.update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }

  async deleteUser(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  // Confession methods
  async createConfession(insertConfession: InsertConfession): Promise<Confession> {
    const result = await db.insert(confessions).values(insertConfession).returning();
    return result[0];
  }

  async getConfessionsByUserId(userId: string, limit: number = 100): Promise<Confession[]> {
    return await db.select()
      .from(confessions)
      .where(eq(confessions.userId, userId))
      .orderBy(desc(confessions.createdAt))
      .limit(limit);
  }

  async getConfessionCount(userId: string): Promise<number> {
    const result = await db.select().from(confessions).where(eq(confessions.userId, userId));
    return result.length;
  }

  async deleteConfession(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(confessions)
      .where(and(eq(confessions.id, id), eq(confessions.userId, userId)))
      .returning();
    return result.length > 0;
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
  async getAiUsage(userId: string, month: string): Promise<AiUsage | undefined> {
    const result = await db.select()
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)))
      .limit(1);
    return result[0];
  }

  async createOrUpdateAiUsage(data: InsertAiUsage & { tokensToAdd: number; costToAdd: string }): Promise<AiUsage> {
    const existing = await this.getAiUsage(data.userId, data.month);
    
    if (existing) {
      const newTokens = existing.tokens + data.tokensToAdd;
      const newCost = (parseFloat(existing.estCostEur) + parseFloat(data.costToAdd)).toFixed(4);
      
      const result = await db.update(aiUsage)
        .set({ 
          tokens: newTokens, 
          estCostEur: newCost 
        })
        .where(and(eq(aiUsage.userId, data.userId), eq(aiUsage.month, data.month)))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(aiUsage).values({
        userId: data.userId,
        month: data.month,
        tokens: data.tokensToAdd,
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

  async getSubscriptionByStripeSessionId(stripeSessionId: string): Promise<Subscription | undefined> {
    const result = await db.select()
      .from(usersSubscriptions)
      .where(eq(usersSubscriptions.stripeSessionId, stripeSessionId))
      .limit(1);
    return result[0];
  }

  async getUserSubscriptions(userId: string): Promise<Subscription[]> {
    return await db.select()
      .from(usersSubscriptions)
      .where(eq(usersSubscriptions.userId, userId))
      .orderBy(desc(usersSubscriptions.createdAt));
  }

  async updateSubscriptionStatus(stripeSessionId: string, active: boolean, expiresAt?: Date): Promise<Subscription | undefined> {
    const updateData: any = { active };
    if (expiresAt) {
      updateData.expiresAt = expiresAt;
    }
    const result = await db.update(usersSubscriptions)
      .set(updateData)
      .where(eq(usersSubscriptions.stripeSessionId, stripeSessionId))
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
