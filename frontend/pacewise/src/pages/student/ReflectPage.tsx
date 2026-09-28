import { useState } from 'react';
import { StatTile } from '../../components/domain/StatTile';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Textarea } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { Banner } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDerived } from '../../hooks/useDerived';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { confirmReflection, createReflection, type AgentResponse } from '../../services/api';
import { WEEK_START, addDays, formatDM, formatHours } from '../../utils/time';

const QUESTIONS = ['Điều gì giúp bạn học hiệu quả?', 'Điều gì khiến kế hoạch bị lệch?', 'Tuần sau bạn muốn thay đổi điều gì?'] as const;
const MAX = 500;

export function ReflectPage() {
  useDocumentTitle('Tổng kết tuần');
  const { state, dispatch } = useAppStore();
  const { stats } = useDerived();
  const toast = useToast();
  const [answers, setAnswers] = useState<[string, string, string]>(state.reflection?.answers ?? ['', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<AgentResponse | null>(null);
  const dirty = JSON.stringify(answers) !== JSON.stringify(state.reflection?.answers ?? ['', '', '']);

  const save = async () => {
    if (answers.every((a) => !a.trim())) {
      setError('Trả lời ít nhất một câu để lưu tổng kết.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await createReflection(answers.map((a) => a.trim()) as [string, string, string], stats as unknown as Record<string, unknown>);
      setDraft(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa tạo được bản phản tư.');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      await confirmReflection();
      dispatch({
        type: 'SAVE_REFLECTION',
        answers: answers.map((a) => a.trim()) as [string, string, string],
        aiDraft: draft.reflection_draft ?? undefined,
        aiSummary: draft.response,
      });
      setDraft(null);
      toast({ tone: 'success', title: 'Đã lưu tổng kết tuần', description: 'Điều chỉnh chỉ được lưu sau khi bạn xác nhận.' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Chưa xác nhận được bản phản tư.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page max-w-4xl">
      <PageHeader
        title="Tuần này của bạn"
        description={`Nhìn lại tuần ${formatDM(WEEK_START)} – ${formatDM(addDays(WEEK_START, 6))} bằng dữ kiện. Đây không phải đánh giá về tính cách hay năng lực.`}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon="checkCircle" label="Nhiệm vụ hoàn thành" value={`${stats.done} / ${stats.total}`} />
        <StatTile icon="clock" label="Phiên học" value={stats.sessionCount} />
        <StatTile icon="chart" label="Thời gian học" value={formatHours(stats.studiedMin)} />
        <StatTile icon="calendar" label="Kế hoạch dự kiến" value={formatHours(stats.plannedMin)} />
      </div>

      <Card className="mt-5" aria-labelledby="q">
        <CardHeader id="q" title="Ba câu hỏi" subtitle="Viết ngắn thôi — vài câu là đủ." />
        {state.reflection && !dirty && (
          <div className="mb-4">
            <Banner tone="success" icon="checkCircle">
              Đã lưu lúc {new Date(state.reflection.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}. Bạn vẫn có thể chỉnh sửa.
            </Banner>
          </div>
        )}
        <div className="space-y-5">
          {QUESTIONS.map((label, i) => (
            <Textarea
              key={label}
              label={`${i + 1}. ${label}`}
              value={answers[i]}
              maxLength={MAX}
              hint={`${answers[i].length}/${MAX} ký tự`}
              onChange={(e) => {
                const next = [...answers] as [string, string, string];
                next[i] = e.target.value;
                setAnswers(next);
              }}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-danger-ink">
            {error}
          </p>
        )}
        {draft && (
          <div className="mt-5 rounded-xl border border-[#D6E2FD] bg-primary-light p-4">
            <h3 className="font-semibold">Bản phản tư do AI đề xuất — chưa lưu</h3>
            <p className="mt-2 whitespace-pre-line text-sm">{draft.response}</p>
            <div className="mt-4 flex gap-3">
              <Button icon="check" onClick={confirm} loading={loading}>Xác nhận điều chỉnh</Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>Chỉnh lại câu trả lời</Button>
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button icon="check" onClick={save} loading={loading} disabled={!!state.reflection && !dirty}>
            Tạo bản phản tư
          </Button>
          {dirty && <span className="caption">Có thay đổi chưa lưu</span>}
        </div>
      </Card>
    </div>
  );
}
