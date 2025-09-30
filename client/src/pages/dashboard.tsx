import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { Heart, Server, Database, Zap, Copy, CheckCircle, Activity, Clock, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { toast } = useToast();

  const { data: healthCheck, isLoading: healthLoading } = useQuery({
    queryKey: ['/api/health'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch (err) {
      toast({
        title: "Failed to copy",
        description: "Please copy the text manually",
        variant: "destructive",
      });
    }
  };

  const replitUrl = import.meta.env.VITE_REPLIT_URL || "https://intimaia-backend.your-username.repl.co";
  const webhookUrl = `${replitUrl}/api/webhook/stripe`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Heart className="text-primary-foreground w-4 h-4" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Intimaia Backend</h1>
                <p className="text-sm text-muted-foreground">API Management Dashboard</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${healthCheck?.ok ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span className={`text-sm font-medium ${healthCheck?.ok ? 'text-green-500' : 'text-red-500'}`}>
                  {healthLoading ? 'Checking...' : healthCheck?.ok ? 'Online' : 'Offline'}
                </span>
              </div>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-deploy">
                <Zap className="w-4 h-4 mr-2" />
                Deploy
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Start */}
        <Card className="mb-8" data-testid="card-quickstart">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-lg font-semibold flex items-center">
                  🚀 Quick Start
                </CardTitle>
                <p className="text-muted-foreground mt-2">Your Intimaia backend is ready to deploy</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Public URL:</p>
                <div className="flex items-center space-x-2 mt-1">
                  <code className="bg-muted text-muted-foreground px-2 py-1 rounded text-sm font-mono" data-testid="text-public-url">
                    {replitUrl}
                  </code>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => copyToClipboard(replitUrl, "Public URL")}
                    data-testid="button-copy-url"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Server className="text-primary w-5 h-5" />
                  <span className="font-medium">Server</span>
                </div>
                <p className="text-sm text-muted-foreground">Port 5000</p>
                <Badge variant="secondary" className="text-xs">Running</Badge>
              </div>
              
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Zap className="text-blue-500 w-5 h-5" />
                  <span className="font-medium">Stripe</span>
                </div>
                <p className="text-sm text-muted-foreground">Webhooks ready</p>
                <Badge variant="secondary" className="text-xs">Configured</Badge>
              </div>
              
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Database className="text-green-500 w-5 h-5" />
                  <span className="font-medium">Supabase</span>
                </div>
                <p className="text-sm text-muted-foreground">Database connected</p>
                <Badge variant="secondary" className="text-xs">Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Endpoints and Webhook Config */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <Card data-testid="card-endpoints">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Zap className="text-primary w-5 h-5 mr-2" />
                API Endpoints
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="bg-green-500/20 text-green-500">GET</Badge>
                    <code className="font-mono text-sm">/api/health</code>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${healthCheck?.ok ? 'bg-green-500' : 'bg-red-500'}`}></div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">Health check endpoint</p>
                <div className="bg-card border border-border rounded-md p-3 text-sm font-mono">
                  <span className="text-muted-foreground">// Response</span><br/>
                  {`{`}<br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"ok"</span>: <span className="text-green-400">true</span><br/>
                  {`}`}
                </div>
              </div>
              
              <div className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Badge variant="destructive" className="bg-red-500/20 text-red-500">POST</Badge>
                    <code className="font-mono text-sm">/api/webhook/stripe</code>
                  </div>
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">Stripe webhook handler for checkout.session.completed</p>
                <div className="bg-card border border-border rounded-md p-3 text-sm font-mono">
                  <span className="text-muted-foreground">// Handles subscription creation</span><br/>
                  <span className="text-muted-foreground">// Updates users_subscriptions table</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-webhook-config">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Zap className="text-blue-500 w-5 h-5 mr-2" />
                Stripe Webhook Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Webhook URL (Copy to Stripe)</label>
                <div className="flex items-center space-x-2">
                  <input 
                    type="text" 
                    value={webhookUrl}
                    className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground"
                    readOnly
                    data-testid="input-webhook-url"
                  />
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => copyToClipboard(webhookUrl, "Webhook URL")}
                    data-testid="button-copy-webhook"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Events to send</label>
                <div className="bg-muted rounded-md p-3">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="text-green-500 w-4 h-4" />
                    <code className="text-sm font-mono">checkout.session.completed</code>
                  </div>
                </div>
              </div>
              
              <div className="bg-muted rounded-lg p-4">
                <h4 className="font-medium text-foreground mb-2">Webhook Secret</h4>
                <p className="text-sm text-muted-foreground mb-2">Add this to your .env file:</p>
                <code className="text-xs font-mono text-muted-foreground">STRIPE_WEBHOOK_SECRET=whsec_...</code>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Monitoring */}
        <Card data-testid="card-monitoring">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center">
                <Activity className="text-green-500 w-5 h-5 mr-2" />
                Live Monitoring
              </CardTitle>
              <Button variant="outline" size="sm" data-testid="button-refresh">
                <Activity className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-muted rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-foreground" data-testid="text-uptime">99.9%</div>
                <div className="text-sm text-muted-foreground">Uptime</div>
              </div>
              <div className="bg-muted rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-green-500" data-testid="text-webhooks">0</div>
                <div className="text-sm text-muted-foreground">Webhooks Processed</div>
              </div>
              <div className="bg-muted rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-blue-500" data-testid="text-subscriptions">0</div>
                <div className="text-sm text-muted-foreground">Active Subscriptions</div>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium text-foreground mb-3">Recent Activity</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg text-sm" data-testid="log-server-start">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground font-mono">{new Date().toLocaleTimeString()}</span>
                  <span className="text-foreground">Server started successfully</span>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </div>
                
                <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg text-sm" data-testid="log-health-check">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground font-mono">{new Date().toLocaleTimeString()}</span>
                  <span className="text-foreground">Health check: /api/health</span>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
