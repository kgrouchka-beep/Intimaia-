import { z } from "zod";

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const signupSchema = z.object({
  email: z.string().regex(emailRegex, "Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.string().regex(emailRegex, "Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export const confessionSchema = z.object({
  content: z.string()
    .min(10, "Confession must be at least 10 characters")
    .max(5000, "Confession cannot exceed 5000 characters")
    .refine(
      (val) => !/<script|<iframe|javascript:/i.test(val),
      "HTML/Script tags are not allowed"
    ),
});

export const emailSubscribeSchema = z.object({
  email: z.string().regex(emailRegex, "Invalid email format"),
});

export function sanitizeText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

export function validateTags(tags: string[]): string[] {
  return tags
    .filter(tag => typeof tag === 'string' && tag.length > 0)
    .map(tag => sanitizeText(tag))
    .slice(0, 4);
}
