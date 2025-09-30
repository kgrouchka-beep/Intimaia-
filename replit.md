# Intimaia - AI-Augmented Intimate Journal

## Overview
Intimaia is a Node.js/Express backend for an AI-augmented intimate journal application. Users can create private confessions, receive AI-powered emotional analysis, and access premium features through Stripe subscriptions.

## Recent Changes (September 30, 2025)
### Migration from Supabase Auth to Replit Auth
- **Authentication System**: Migrated from Supabase Auth to Replit Auth with OpenID Connect
- **Session Management**: Now uses express-session with PostgreSQL session store
- **User Management**: User data stored in local PostgreSQL database instead of Supabase auth.users
- **Routes Updated**: All protected routes now use `isAuthenticated` middleware from Replit Auth
- **Admin System**: Implemented `isAdmin` middleware that checks `is_admin` column in users table
- **Row Level Security**: Enabled RLS on confessions table with policies using PostgreSQL session variables
  - Policy: `confessions_owner_isolation` - Users can only access their own confessions
  - Policy: `confessions_admin_bypass` - Admins can access all confessions
  - Implementation: Database queries wrapped in transactions with `SET LOCAL app.user_id` and `SET LOCAL app.role`
  - Uses pg Pool `runAs` pattern for explicit transaction and session variable management

### OpenAI Implementation Refactor
- **LRU Cache**: Added 20-minute caching to avoid repetitive API calls (500 item limit)
- **In-memory Budget Tracking**: Simplified budget system with monthly rollover (CAP_EUR, ALERT_EUR)
- **Generic `askMini` Helper**: Reusable AI function with configurable system prompts, temperature, tokens
- **Specialized `askConfession`**: Optimized function for confession analysis with token limits
- **Simplified Fallback**: Heuristic responses when budget exceeded or errors occur

### Authentication Endpoints
- `GET /api/login` - Initiates Replit Auth login flow
- `GET /api/callback` - OAuth callback handler
- `GET /api/logout` - Logs out user and clears session

## Tech Stack
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL (heliumdb - local Replit database)
- **ORM**: Drizzle ORM
- **Authentication**: Replit Auth (OpenID Connect)
- **Session Store**: PostgreSQL via connect-pg-simple
- **Payments**: Stripe
- **AI**: OpenAI GPT-4
- **Frontend**: React, Vite, TanStack Query, Wouter
- **Security**: Row Level Security (RLS) with PostgreSQL session variables

## Database Schema

### Users Table
- `id` (varchar, primary key) - User ID from Replit Auth
- `email` (varchar, unique) - User email
- `firstName` (varchar) - First name
- `lastName` (varchar) - Last name
- `profileImageUrl` (varchar) - Profile image URL
- `isAdmin` (boolean) - Admin status (default: false)
- `createdAt` (timestamp) - Account creation date
- `updatedAt` (timestamp) - Last update date

### Sessions Table (for express-session)
- `sid` (varchar, primary key) - Session ID
- `sess` (jsonb) - Session data
- `expire` (timestamp) - Expiration timestamp

### Confessions Table (RLS Enabled)
- `id` (uuid, primary key) - Confession ID
- `userId` (varchar) - User ID
- `content` (text) - Confession content
- `aiSummary` (text) - AI-generated summary
- `aiTags` (text[]) - AI-generated tags
- `aiIntensity` (integer) - Emotional intensity (0-10)
- `aiReply` (text) - AI-generated empathetic reply
- `source` (text) - "openai" or "heuristic"
- `createdAt` (timestamp) - Creation date
- **RLS Policies**: Owner isolation + Admin bypass using session variables

### Users Subscriptions Table
- `id` (uuid, primary key) - Subscription ID
- `userId` (varchar) - User ID
- `stripeCustomerId` (text) - Stripe customer ID
- `stripePriceId` (text) - Stripe price ID
- `status` (text) - Subscription status
- `currentPeriodEnd` (timestamp) - Current period end date
- `updatedAt` (timestamp) - Last update date

### AI Usage Table
- `month` (text, primary key) - Month identifier (YYYY-MM)
- `totalInputTokens` (integer) - Total input tokens
- `totalOutputTokens` (integer) - Total output tokens
- `estCostEur` (decimal) - Estimated cost in EUR

### Emails Table
- `id` (uuid, primary key) - Email ID
- `userId` (varchar, nullable) - User ID (if registered)
- `email` (text, unique) - Email address
- `createdAt` (timestamp) - Subscription date

## API Endpoints

### Authentication
- `GET /api/login` - Initiate Replit Auth login
- `GET /api/callback` - OAuth callback
- `GET /api/logout` - Logout
- `GET /api/me` - Get current user info

### Confessions
- `POST /api/confess` - Create confession (requires auth)
- `GET /api/confessions` - Get user's confessions (requires auth)
- `DELETE /api/confessions/:id` - Delete confession (requires auth)

### Subscriptions
- `POST /api/checkout` - Create Stripe checkout session (requires auth)
- `POST /api/billing/portal` - Access Stripe billing portal (requires auth)
- `POST /api/webhook/stripe` - Stripe webhook handler

### Admin
- `GET /api/admin/stats` - Get AI usage stats (requires auth)
- `GET /api/admin/ai-usage` - Get AI budget info (requires auth)

### Other
- `GET /api/health` - Health check
- `GET /api/me/export` - Export user data (GDPR) (requires auth)
- `POST /api/emails` - Subscribe email to newsletter

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Express session secret
- `OPENAI_API_KEY` - OpenAI API key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret
- `STRIPE_PRICE_ID` - Stripe price ID for premium subscription
- `REPLIT_DOMAINS` - Comma-separated list of Replit domains
- `REPL_ID` - Replit application ID (auto-provided)
- `ISSUER_URL` - OIDC issuer URL (defaults to https://replit.com/oidc)

### Optional
- `MAX_FREE_CONFESSIONS` - Free tier confession limit (default: 30)
- `SUPABASE_URL` - Supabase project URL (for database only)
- `SUPABASE_SERVICE_KEY` - Supabase service key (for database only)

## Features

### AI Analysis
- **Content Moderation**: OpenAI moderation API
- **Emotional Analysis**: GPT-4 provides summary, tags, intensity score, and empathetic reply
- **Fallback System**: Heuristic analysis when OpenAI quota exceeded
- **Budget Tracking**: Monitors token usage and costs per month

### Premium Features
- Free tier: 30 confessions
- Premium: Unlimited confessions via Stripe subscription

### GDPR Compliance
- User data export endpoint
- Confession deletion

## Architecture

### Authentication Flow
1. User visits app
2. Protected routes redirect to `/api/login`
3. Replit Auth OAuth flow
4. Callback creates/updates user in database
5. Session stored in PostgreSQL
6. Subsequent requests authenticated via session cookies

### Storage Layer
- Interface-based storage (`IStorage`)
- PostgreSQL implementation (`DbStorage`)
- Drizzle ORM for type-safe queries

### Middleware
- `isAuthenticated` - Validates Replit Auth session with token refresh
- `isAdmin` - Checks if user has admin privileges (requires `is_admin = true`)
- `limiterAuth` - Rate limiting for auth endpoints (30 req/min)
- `limiterGeneral` - Rate limiting for general endpoints (100 req/min)
- Helmet for security headers

### Row Level Security (RLS)
- **Implementation**: PostgreSQL session variables (`app.user_id`, `app.role`)
- **Transaction Wrapping**: All confession queries wrapped in transactions with `SET LOCAL` statements
- **Policies**:
  - `confessions_owner_isolation`: `user_id::text = current_setting('app.user_id', true)`
  - `confessions_admin_bypass`: `current_setting('app.role', true) = 'admin'`
- **Admin Access**: Users with `is_admin = true` can bypass RLS policies

## Development

### Running Locally
```bash
npm run dev
```

### Database Migrations
```bash
npm run db:push
```

### Testing
Health check: `GET /api/health`

## Admin Setup
To grant admin access to a user:
```sql
UPDATE users SET is_admin = true WHERE email = 'user@example.com';
```
Current admin: k.grouchka@gmail.com

## Known Issues
- **Stripe Configuration**: STRIPE_PRICE_ID currently contains product ID instead of price ID (needs correction)

## TODO
- [ ] Fix STRIPE_PRICE_ID to use actual price ID instead of product ID
- [ ] Add frontend authentication UI
- [ ] Implement user profile management
- [ ] Add email verification flow
- [ ] Improve AI fallback heuristics
- [ ] Add rate limiting per user
- [ ] Implement data retention policies
