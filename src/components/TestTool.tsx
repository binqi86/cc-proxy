import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Rocket, CheckCircle2, XCircle, Loader2 } from '@/components/icons';
import type { TestConfig, TestResult } from '@/lib/config';

export default function TestTool() {
  const [request, setRequest] = useState<TestConfig>({ model: 'gpt-5', stream: true, message: '' });
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    if (!request.message.trim()) return;
    setLoading(true);
    try { setResult(await api.test.connection(request)); }
    catch (e) { setResult({ success: false, error: String(e) }); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="border-border">
        <CardHeader className="py-3 px-5 border-b border-border/50">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Request</CardTitle>
        </CardHeader>
        <CardContent className="p-5 space-y-3">
          <Field label="Model">
            <Input value={request.model} onChange={e => setRequest({ ...request, model: e.target.value })} placeholder="gpt-5" />
          </Field>

          <div className="flex items-center justify-between py-1">
            <div>
              <Label className="text-sm">Stream</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Enable streaming response</p>
            </div>
            <Switch checked={request.stream} onChange={e => setRequest({ ...request, stream: e.target.checked })} />
          </div>

          <Field label="Message">
            <Textarea value={request.message} onChange={e => setRequest({ ...request, message: e.target.value })} placeholder="Enter test message..." rows={4} />
            <p className="text-[11px] text-muted-foreground text-right">{request.message.length} chars</p>
          </Field>

          <Button className="w-full" onClick={handleTest} disabled={loading || !request.message.trim()}>
            {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</> : <><Rocket className="w-3.5 h-3.5" /> Send Test Request</>}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-border animate-slide-up">
          <CardHeader className="py-3 px-5 border-b border-border/50">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {result.success
                ? <><CheckCircle2 className="w-4 h-4 text-primary" /><Badge variant="success">Success</Badge></>
                : <><XCircle className="w-4 h-4 text-destructive" /><Badge variant="destructive">Failed</Badge></>
              }
              {result.status && <Badge variant="outline">HTTP {result.status}</Badge>}
              {result.latency && <span className="text-xs text-muted-foreground">{result.latency}ms</span>}
            </div>

            {result.response && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Response Body</Label>
                <div className="bg-muted rounded-md p-4 text-[13px] whitespace-pre-wrap max-h-[300px] overflow-auto font-mono">{result.response}</div>
              </div>
            )}

            {result.tokens && (
              <div className="grid grid-cols-3 gap-3">
                {[['Input', result.tokens.input], ['Output', result.tokens.output], ['Total', result.tokens.total]].map(([label, val]) => (
                  <div key={label as string} className="bg-muted rounded-md p-3 text-center">
                    <div className="text-lg font-semibold">{val as number}</div>
                    <div className="text-[11px] text-muted-foreground">{label as string}</div>
                  </div>
                ))}
              </div>
            )}

            {result.error && <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-md px-4 py-3 text-[13px]">{result.error}</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
