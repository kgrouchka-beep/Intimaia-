import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, uuid, integer, decimal, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  isPremium: boolean("is_premium").default(false).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const confessions = pgTable("confessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  aiSummary: text("ai_summary"),
  aiTags: text("ai_tags").array(),
  aiIntensity: integer("ai_intensity"),
  aiReply: text("ai_reply"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const aiUsage = pgTable("ai_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  tokens: integer("tokens").default(0).notNull(),
  estCostEur: decimal("est_cost_eur", { precision: 10, scale: 4 }).default("0").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const usersSubscriptions = pgTable("users_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  active: boolean("active").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const emails = pgTable("emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertConfessionSchema = createInsertSchema(confessions).omit({
  id: true,
  createdAt: true,
  aiSummary: true,
  aiTags: true,
  aiIntensity: true,
  aiReply: true,
});

export const insertAiUsageSchema = createInsertSchema(aiUsage).omit({
  id: true,
  createdAt: true,
});

export const insertSubscriptionSchema = createInsertSchema(usersSubscriptions).omit({
  id: true,
  createdAt: true,
});

export const insertEmailSchema = createInsertSchema(emails).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertConfession = z.infer<typeof insertConfessionSchema>;
export type Confession = typeof confessions.$inferSelect;
export type InsertAiUsage = z.infer<typeof insertAiUsageSchema>;
export type AiUsage = typeof aiUsage.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof usersSubscriptions.$inferSelect;
export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type Email = typeof emails.$inferSelect;
