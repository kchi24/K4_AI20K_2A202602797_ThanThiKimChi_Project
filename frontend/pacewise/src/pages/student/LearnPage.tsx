import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Citation, SourceModal } from '../../components/domain/Citation';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Select, Textarea } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { Banner, EmptyState, ErrorState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useDerived } from '../../hooks/useDerived';
import { ApiError, askHint, askQuestion, assessUnderstanding } from '../../services/api';
import { useAppStore } from '../../store/AppStore';
import type { QAMessage, QuickCheckResult, Source, Tone } from '../../types';
import type { QAResult } from '../../utils/qa';
import { cx } from '../../utils/cx';
import { uid } from '../../utils/time';

const MAX_LEN = 1000;
const evidenceMeta: Record<QuickCheckResult['evidenceState'], { label: string; tone: Tone }> = {
  demonstrated: { label: 'Đã thể hiện được', tone: 'success' },
  developing: { label: 'Đang hình thành', tone: 'primary' },
  misconception: { label: 'Còn nhầm lẫn', tone: 'danger' },
  abstained: { label: 'Chưa đủ bằng chứng', tone: 'warning' },
};

function AssistantMessage({ m, onOpen, onHint, onAsk, hintLoading }: { m: QAMessage; onOpen: (s: Source) => void; onHint: () => void; onAsk: (q: string) => void; hintLoading: boolean }) {
  if (m.kind === 'integrity') {
    return (
      <Card tone="accent" as="article" aria-label="Chuyển hướng liêm chính học thuật">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-accent-ink">
            <Icon name="shield" size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">Mình không thể làm bài thay bạn.</h3>
            <p className="mt-1">Nhưng PaceWise có thể giúp bạn:</p>
            <ul className="mt-2 space-y-1.5">
              {['Xác định kiến thức cần dùng', 'Gợi ý cách tiếp cận', 'Đặt câu hỏi để bạn tự kiểm tra', 'Xem lại cách bạn đang làm'].map((x) => (
                <li key={x} className="flex gap-2">
                  <Icon name="check" size={18} className="mt-0.5 shrink-0 text-accent-ink" />
                  {x}
                </li>
              ))}
            </ul>
            <Button className="mt-4" icon="lightbulb" onClick={onHint} loading={hintLoading}>
              Cho mình gợi ý
            </Button>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card as="article" className="!p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {m.kind === 'grounded' && (
          <Badge tone="success" icon="checkCircle">
            Có nguồn · {m.sources?.length ?? 0} tài liệu
          </Badge>
        )}
        {m.kind === 'abstained' && (
          <Badge tone="warning" icon="info">
            Chưa đủ nguồn
          </Badge>
        )}
        {m.kind === 'hint' && (
          <Badge tone="accent" icon="lightbulb">
            Gợi ý từng bước
          </Badge>
        )}
      </div>
      {m.kind === 'abstained' && <h3 className="mb-1 font-semibold">Chưa đủ nguồn để trả lời chắc chắn</h3>}
      <p className="whitespace-pre-line leading-relaxed">{m.text}</p>
      {m.kind === 'abstained' && <p className="caption mt-2">Bạn có thể xem syllabus của môn hoặc hỏi giảng viên trong office hour.</p>}
      {!!m.sources?.length && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold text-muted">Nguồn</h4>
          <div className="space-y-2">
            {m.sources.map((source, index) => (
              <Citation key={source.id} index={index + 1} source={source} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
      {!!m.suggestions?.length && (
        <div className="mt-4 flex flex-wrap gap-2">
          {m.suggestions.map((s) => (
            <button key={s} onClick={() => onAsk(s)} className="min-h-[40px] rounded-full border border-line bg-white px-3.5 text-sm font-medium hover:border-[#C9D8FB] hover:bg-primary-light">
              {s}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export function LearnPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'check' ? 'check' : 'qa';
  const [tab, setTab] = useState<'qa' | 'check'>(initialTab);
  useDocumentTitle(tab === 'check' ? 'Kiểm tra nhanh' : 'Học tập & Hỏi đáp');
  const { state, dispatch } = useAppStore();
  const { activeCourse, activeTasks } = useDerived();
  const toast = useToast();

  // Q&A state
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [error, setError] = useState<{ question: string; requestId: string } | null>(null);
  const [inputError, setInputError] = useState('');
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Quick Check state
  const approvedAssessments = state.assessments.filter((a) => a.status === 'approved');
  const initialAssessmentId = approvedAssessments[0]?.id ?? '';
  const [selectedAssessmentId, setSelectedAssessmentId] = useState(initialAssessmentId);
  const selectedAssessment = approvedAssessments.find((a) => a.id === selectedAssessmentId) ?? approvedAssessments[0];
  const suggestedQuestions = activeTasks.slice(0, 3).map(
    (task) => `Giải thích kiến thức cần để thực hiện “${task.title}”.`,
  );
  const [checkAnswer, setCheckAnswer] = useState('');
  const [submittingCheck, setSubmittingCheck] = useState(false);

  useEffect(() => {
    if (tab === 'qa') {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [state.qaMessages.length, loading, tab]);

  useEffect(() => {
    setSelectedAssessmentId(approvedAssessments[0]?.id ?? '');
    setCheckAnswer('');
    setError(null);
  }, [state.user?.courseId, state.assessments]);

  const switchTab = (nextTab: 'qa' | 'check') => {
    setTab(nextTab);
    setSearchParams(nextTab === 'check' ? { tab: 'check' } : {});
  };

  const push = (role: 'user' | 'assistant', text: string, r?: QAResult) =>
    dispatch({
      type: 'ADD_QA',
      message: { id: uid('qa'), role, text, kind: r?.kind, citations: r?.citations, sources: r?.sources, suggestions: r?.suggestions, createdAt: new Date().toISOString() },
    });

  const ask = async (question: string, alreadyShown = false) => {
    const text = question.trim();
    if (!text) {
      setInputError('Nhập câu hỏi trước khi gửi.');
      return;
    }
    if (text.length > MAX_LEN) {
      setInputError(`Nội dung vượt quá ${MAX_LEN} ký tự. Hãy rút gọn trước khi gửi.`);
      return;
    }
    setInputError('');
    setError(null);
    if (!alreadyShown) push('user', text);
    setQ('');
    setLoading(true);
    try {
      const r = await askQuestion(text);
      push('assistant', r.text, r);
    } catch (e) {
      setError({ question: text, requestId: e instanceof ApiError ? e.requestId : 'PW-REQ-UNKNOWN' });
    } finally {
      setLoading(false);
    }
  };

  const submitQA = (e: FormEvent) => {
    e.preventDefault();
    ask(q);
  };

  const submitQuickCheck = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedAssessment || !checkAnswer.trim()) return;
    setSubmittingCheck(true);
    const text = checkAnswer.trim();
    const resultId = uid('qc');
    try {
      const assessment = await assessUnderstanding(selectedAssessment, text);
      const reviewId = assessment.requiresInstructorReview ? assessment.reviewCaseId : undefined;
      const result: QuickCheckResult = {
        id: resultId,
        topic: selectedAssessment.topic,
        question: selectedAssessment.question,
        answer: text,
        evidenceState: assessment.evidenceState,
        confidence: assessment.confidence,
        feedback: assessment.feedback,
        submittedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        reviewItemId: reviewId,
        rubricVersion: assessment.rubricVersion,
      };
      dispatch({ type: 'SUBMIT_QUICK_CHECK', result });
      setCheckAnswer('');
      toast({
        tone: reviewId ? 'warning' : 'success',
        title: reviewId ? 'Đã chuyển giảng viên xem xét' : 'Đã đánh giá theo rubric',
        description: assessment.feedback,
      });
    } catch (error) {
      toast({ tone: 'danger', title: 'Chưa đánh giá được câu trả lời', description: error instanceof Error ? error.message : 'Hãy thử lại.' });
    } finally {
      setSubmittingCheck(false);
    }
  };

  return (
    <div className="page auto-hide-scrollbar h-[calc(100dvh-7.5rem)] max-w-3xl overflow-y-auto lg:h-[calc(100dvh-3.5rem)]">
      <PageHeader
        title="Học tập & Kiểm tra"
        description={`Hỏi đáp có trích dẫn và kiểm tra nhanh theo Rubric của ${activeCourse?.code ?? 'môn đang chọn'}.`}
        actions={
          tab === 'qa' && state.qaMessages.length > 0 ? (
            <Button variant="ghost" size="sm" icon="trash" onClick={() => dispatch({ type: 'CLEAR_QA' })}>
              Xóa hội thoại
            </Button>
          ) : undefined
        }
      />

      {/* Tabs Switcher */}
      <div className="mb-6 inline-flex rounded-xl border border-line bg-white p-1" role="tablist" aria-label="Chế độ học tập">
        <button
          role="tab"
          aria-selected={tab === 'qa'}
          onClick={() => switchTab('qa')}
          className={cx('flex items-center gap-2 min-h-[40px] rounded-lg px-4 text-sm font-semibold transition', tab === 'qa' ? 'bg-primary-light text-primary-ink' : 'text-muted hover:text-ink')}
        >
          <Icon name="message" size={18} />
          Hỏi đáp tài liệu
        </button>
        <button
          role="tab"
          aria-selected={tab === 'check'}
          onClick={() => switchTab('check')}
          className={cx('flex items-center gap-2 min-h-[40px] rounded-lg px-4 text-sm font-semibold transition', tab === 'check' ? 'bg-primary-light text-primary-ink' : 'text-muted hover:text-ink')}
        >
          <Icon name="checkCircle" size={18} />
          Kiểm tra nhanh
          {state.quickChecks.length > 0 && <span className="ml-1 rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary-dark">{state.quickChecks.length}</span>}
        </button>
      </div>

      {tab === 'qa' ? (
        <>
          <div className="space-y-4" aria-live="polite">
            {state.qaMessages.length === 0 && !loading && (
              <Card className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-light text-primary-ink">
                  <Icon name="message" size={24} />
                </span>
                <h2 className="mt-3 text-lg font-semibold">Bạn muốn hỏi điều gì?</h2>
                <p className="mx-auto mt-1 max-w-md text-muted">PaceWise chỉ trả lời từ học liệu đã được giảng viên duyệt trong môn đang chọn.</p>
                {suggestedQuestions.length > 0 && (
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                    {suggestedQuestions.map((suggestion) => (
                      <button key={suggestion} onClick={() => ask(suggestion)} className="min-h-[44px] rounded-xl border border-line bg-white px-4 text-left text-sm font-medium hover:border-[#C9D8FB] hover:bg-primary-light sm:text-center">
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {state.qaMessages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary-dark px-4 py-3 text-white">{m.text}</p>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  m={m}
                  onOpen={setOpenSource}
                  onAsk={(s) => ask(s)}
                  hintLoading={hintLoading}
                  onHint={async () => {
                    setHintLoading(true);
                    push('user', 'Cho mình gợi ý');
                    const r = await askHint();
                    push('assistant', r.text, r);
                    setHintLoading(false);
                  }}
                />
              ),
            )}

            {loading && (
              <Card className="!p-5" aria-busy="true">
                <p className="flex items-center gap-3 text-muted">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-r-transparent" aria-hidden="true" />
                  Đang tìm trong học liệu và kiểm tra nguồn…
                </p>
              </Card>
            )}

            {error && (
              <ErrorState
                title="Chưa thể kết nối dịch vụ AI"
                description="Câu hỏi của bạn vẫn được giữ lại. Chưa có gì bị mất."
                requestId={error.requestId}
                onRetry={() => ask(error.question, true)}
              />
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={submitQA} className="sticky bottom-[76px] z-20 mt-6 rounded-2xl border border-line bg-white p-3 shadow-card lg:bottom-4">
            <label htmlFor="question" className="sr-only">
              Bạn muốn hỏi điều gì?
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="question"
                rows={1}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask(q);
                  }
                }}
                placeholder="Hỏi về khái niệm, công thức hoặc cách giải thích trong bài..."
                aria-invalid={!!inputError || undefined}
                aria-describedby="q-help"
                className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-line px-3.5 py-2.5 focus:border-primary-dark focus:outline-none focus:ring-4 focus:ring-primary/15"
              />
              <Button type="submit" icon="send" loading={loading} aria-label="Gửi câu hỏi">
                <span className="hidden sm:inline">Gửi</span>
              </Button>
            </div>
            <p id="q-help" className={`mt-1.5 px-1 text-xs ${inputError ? 'font-medium text-danger-ink' : 'text-muted'}`}>
              {inputError || `Enter để gửi · Shift+Enter xuống dòng · ${q.length}/${MAX_LEN}`}
            </p>
          </form>
        </>
      ) : (
        /* Tab Quick Check */
        <div className="space-y-6">
          {/* Class Guidance from Instructor */}
          {state.guidance.length > 0 && (
            <div className="space-y-3">
              {state.guidance.map((g) => (
                <Banner key={g.id} tone="info" icon="info">
                  <div>
                    <p className="font-semibold text-primary-ink">
                      Khuyến nghị từ {g.instructorName} · Chủ đề: {g.topic}
                    </p>
                    <p className="mt-1 text-sm">{g.message}</p>
                    <span className="caption mt-1 block">Lúc {g.at}</span>
                  </div>
                </Banner>
              ))}
            </div>
          )}

          {approvedAssessments.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="Chưa có câu hỏi kiểm tra nào"
              description="Các câu hỏi kiểm tra nhanh cần được Giảng viên phê duyệt trước khi xuất bản."
            />
          ) : (
            <Card as="article">
              <CardHeader
                title="Kiểm tra mức độ hiểu bài (1–3 câu)"
                subtitle="Đánh giá theo Rubric môn học. Kết quả KHÔNG PHẢI điểm số chính thức."
              />

              <div className="mt-2">
                <Select
                  label="Chọn chủ đề kiểm tra"
                  value={selectedAssessment?.id ?? ''}
                  onChange={(e) => setSelectedAssessmentId(e.target.value)}
                  options={approvedAssessments.map((a) => ({
                    value: a.id,
                    label: `${a.topic} — ${a.level ?? 'Hiểu'}`
                  }))}
                />
              </div>

              {selectedAssessment && (
                <form onSubmit={submitQuickCheck} className="mt-5 space-y-4">
                  <div className="rounded-xl bg-canvas p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="caption">{selectedAssessment.topic}</span>
                      {selectedAssessment.level && <Badge tone="neutral">{selectedAssessment.level}</Badge>}
                      {selectedAssessment.source && <span className="caption ml-auto">{selectedAssessment.source}</span>}
                    </div>
                    <p className="mt-2 text-base font-semibold text-ink">{selectedAssessment.question}</p>

                    <div className="mt-3 border-t border-line/60 pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Tiêu chí Rubric</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
                        {selectedAssessment.rubric.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <Textarea
                    label="Câu trả lời ngắn của bạn"
                    hint="Tự giải thích theo cách hiểu của bạn. Không lo trả lời sai — hệ thống sẽ chỉ ra điểm cần hoàn thiện."
                    rows={3}
                    value={checkAnswer}
                    onChange={(e) => setCheckAnswer(e.target.value)}
                    placeholder="Nhập phần giải thích của bạn..."
                    required
                  />

                  <div className="flex justify-end">
                    <Button type="submit" icon="check" loading={submittingCheck} disabled={!checkAnswer.trim()}>
                      Nộp câu trả lời
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          )}

          {/* Quick Check Submissions / History */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Kết quả & Bằng chứng hiểu bài</h3>
            {state.quickChecks.length === 0 ? (
              <p className="caption">Bạn chưa làm câu hỏi kiểm tra nào.</p>
            ) : (
              state.quickChecks.map((qc) => {
                const meta = evidenceMeta[qc.evidenceState];
                return (
                  <Card key={qc.id} as="article" className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="caption font-semibold">{qc.topic}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <Badge tone={qc.confidence === 'low' ? 'danger' : 'success'}>
                        Độ tin cậy: {qc.confidence === 'low' ? 'thấp' : 'cao'}
                      </Badge>
                      {qc.rubricVersion && <Badge tone="neutral">Rubric v{qc.rubricVersion}</Badge>}
                      <span className="caption ml-auto">{qc.submittedAt}</span>
                    </div>

                    <p className="text-sm font-medium">{qc.question}</p>
                    <blockquote className="rounded-xl bg-canvas px-3.5 py-2.5 text-sm italic text-slate-700">
                      “{qc.answer}”
                    </blockquote>

                    <p className="text-sm text-ink">{qc.feedback}</p>

                    {qc.instructorNote && (
                      <div className="rounded-xl border border-primary/20 bg-primary-light p-3">
                        <p className="text-xs font-semibold text-primary-ink">Phản hồi từ Giảng viên (Hàng chờ duyệt):</p>
                        <p className="mt-0.5 text-sm text-primary-ink">{qc.instructorNote}</p>
                      </div>
                    )}
                    {qc.reviewItemId && !qc.instructorNote && (
                      <Banner tone="warning" icon="clock">Đang chờ giảng viên xem xét; hệ thống chưa ghi nhận kết luận mastery.</Banner>
                    )}

                    <p className="caption text-xs text-muted">
                      * Đây là bằng chứng quá trình hỗ trợ tự học, không ghi vào bảng điểm chính thức.
                    </p>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      )}

      <SourceModal source={openSource} onClose={() => setOpenSource(null)} />
    </div>
  );
}

