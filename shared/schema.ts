import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, uuid, integer, decimal, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const confessions = pgTable("confessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  content: text("content").notNull(),
  aiSummary: text("ai_summary"),
  aiTags: text("ai_tags").array(),
  aiIntensity: integer("ai_intensity"),
  aiReply: text("ai_reply"),
  source: text("source").default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
});

export const aiUsage = pgTable("ai_usage", {
  month: text("month").primaryKey(),
  totalInputTokens: integer("total_input_tokens").default(0).notNull(),
  totalOutputTokens: integer("total_output_tokens").default(0).notNull(),
  estCostEur: decimal("est_cost_eur", { precision: 10, scale: 4 }).default("0").notNull(),
});

export const usersSubscriptions = pgTable("users_subscriptions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripePriceId: text("stripe_price_id"),
  status: text("status").default("incomplete"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
});

export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
});

export const insertConfessionSchema = createInsertSchema(confessions).omit({
  id: true,
  createdAt: true,
  aiSummary: true,
  aiTags: true,
  aiIntensity: true,
  aiReply: true,
  source: true,
});

export const insertAiUsageSchema = createInsertSchema(aiUsage);

export const insertSubscriptionSchema = createInsertSchema(usersSubscriptions).omit({
  id: true,
  updatedAt: true,
});

export const insertEmailSchema = createInsertSchema(emails).omit({
  id: true,
  createdAt: true,
});

export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;
export type InsertConfession = z.infer<typeof insertConfessionSchema>;
export type Confession = typeof confessions.$inferSelect;
export type InsertAiUsage = z.infer<typeof insertAiUsageSchema>;
export type AiUsage = typeof aiUsage.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof usersSubscriptions.$inferSelect;
export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type Email = typeof emails.$inferSelect;
