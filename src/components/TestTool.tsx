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
    <div className="space-y-5 max-w-2xl">
      <Card className="border-border rounded-xl overflow-hidden">
        <CardHeader className="py-3 px-5 border-b border-border/50">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">测试请求</CardTitle>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <Field label="模型">
            <Input value={request.model} onChange={e => setRequest({ ...request, model: e.target.value })} placeholder="gpt-5" />
          </Field>

          <div className="flex items-center justify-between py-1">
            <div>
              <Label className="text-sm">流式输出</Label>
              <p className="text-xs text-muted-foreground mt-0.5">启用流式响应</p>
            </div>
            <Switch checked={request.stream} onChange={e => setRequest({ ...request, stream: e.target.checked })} />
          </div>

          <Field label="消息内容">
            <Textarea
              value={request.message}
              onChange={e => setRequest({ ...request, message: e.target.value })}
              placeholder="输入测试消息..."
              rows={4}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground text-right">{request.message.length} 字符</p>
          </Field>

          <Button className="w-full h-10" onClick={handleTest} disabled={loading || !request.message.trim()}>
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 发送中...</>
            ) : (
              <><Rocket className="w-4 h-4" /> 发送测试请求</>
            )}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-border rounded-xl overflow-hidden animate-slide-up">
          <CardHeader className="py-3 px-5 border-b border-border/50">
            <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">响应结果</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {result.success
                ? <><CheckCircle2 className="w-4 h-4 text-primary" /><Badge variant="success">成功</Badge></>
                : <><XCircle className="w-4 h-4 text-destructive" /><Badge variant="destructive">失败</Badge></>
              }
              {result.status && <Badge variant="outline">HTTP {result.status}</Badge>}
              {result.latency && <span className="text-xs text-muted-foreground">{result.latency}ms</span>}
            </div>

            {result.response && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">响应内容</Label>
                <div className="bg-muted/50 rounded-lg p-4 text-[13px] whitespace-pre-wrap max-h-[300px] overflow-auto font-mono">
                  {result.response}
                </div>
              </div>
            )}

            {result.tokens && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['输入', result.tokens.input],
                  ['输出', result.tokens.output],
                  ['总计', result.tokens.total],
                ].map(([label, val]) => (
                  <div key={label as string} className="bg-muted/50 rounded-lg p-3 text-center">
                    <div className="text-lg font-bold">{val as number}</div>
                    <div className="text-[11px] text-muted-foreground">{label as string}</div>
                  </div>
                ))}
              </div>
            )}

            {result.error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-4 py-3 text-[13px]">
                {result.error}
              </div>
            )}
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
