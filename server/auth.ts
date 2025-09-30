import { createClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

if (!process.env.SUPABASE_URL) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}

if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing required environment variable: SUPABASE_ANON_KEY');
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_KEY');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7);
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = {
      id: user.id,
      email: user.email
    };

    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      
      if (user) {
        req.user = {
          id: user.id,
          email: user.email
        };
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await requireAuth(req, res, () => {});
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: userData, error } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', req.user.id)
      .single();

    if (error || !userData?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (error: any) {
    return res.status(403).json({ error: 'Access denied' });
  }
}
