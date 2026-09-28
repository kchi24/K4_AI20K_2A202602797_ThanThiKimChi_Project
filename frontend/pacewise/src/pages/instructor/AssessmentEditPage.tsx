import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { saveInstructorAction } from '../../services/api';
import type { AssessmentStatus, Tone } from '../../types';

const statusMeta: Record<AssessmentStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Bản nháp', tone: 'neutral' },
  review: { label: 'Chờ duyệt', tone: 'warning' },
  approved: { label: 'Đã duyệt', tone: 'success' },
  rejected: { label: 'Bị trả lại', tone: 'danger' },
};

const levels = ['Nhớ (Bloom 1)', 'Hiểu (Bloom 2)', 'Áp dụng (Bloom 3)', 'Phân tích (Bloom 4)'];
const sources = ['Slide tuần 3 — tr. 12–14', 'Slide tuần 4 — tr. 12–15', 'Reading 2 — ISLR Ch. 2', 'Reading — Color scales, mục 3'];

interface Errors {
  question?: string;
  rubric?: string;
  note?: string;
}

export function AssessmentEditPage() {
  const { itemId } = useParams();
  const { state, dispatch } = useAppStore();
  const navigate = useNavigate();
  const toast = useToast();
  const item = state.assessments.find((a) => a.id === itemId);
  useDocumentTitle('Sửa câu hỏi');

  const [question, setQuestion] = useState(item?.question ?? '');
  const [level, setLevel] = useState(item?.level ?? levels[1]);
  const [source, setSource] = useState(item?.source ?? sources[0]);
  const [rubric, setRubric] = useState<string[]>(item?.rubric ?? ['']);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  if (!item) {
    return (
      <div className="page max-w-3xl">
        <EmptyState
          icon="clipboard"
          title="Không tìm thấy câu hỏi"
          description="Câu hỏi này có thể đã bị xoá hoặc đường dẫn chưa đúng."
          action={
            <Link to="/instructor/assessment" className="font-semibold text-primary-ink underline">
              Về Ngân hàng câu hỏi
            </Link>
          }
        />
      </div>
    );
  }

  const cleanRubric = rubric.map((r) => r.trim()).filter(Boolean);
  const payload = { id: item.id, question: question.trim(), rubric: cleanRubric, level, source };

  const validate = (needNote = false) => {
    const next: Errors = {};
    if (question.trim().length < 10) next.question = 'Câu hỏi cần ít nhất 10 ký tự.';
    if (cleanRubric.length < 2) next.rubric = 'Rubric cần ít nhất 2 tiêu chí.';
    if (needNote && !note.trim()) next.note = 'Nhập ghi chú để người soạn biết cần sửa gì.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const approve = () => {
    if (!validate()) return;
    dispatch({ type: 'UPDATE_ASSESSMENT', item: payload, status: 'approved', historyText: 'Duyệt và xuất bản' });
    void saveInstructorAction('assessment', payload.id, { ...payload, status: 'approved' });
    toast({ tone: 'success', title: 'Đã duyệt và xuất bản' });
    navigate('/instructor/assessment');
  };
  const saveDraft = () => {
    if (!validate()) return;
    dispatch({ type: 'UPDATE_ASSESSMENT', item: payload, historyText: 'Lưu thay đổi' });
    void saveInstructorAction('assessment', payload.id, payload);
    toast({ tone: 'info', title: 'Đã lưu nháp' });
    navigate('/instructor/assessment');
  };
  const sendBack = () => {
    if (!validate(true)) return;
    dispatch({ type: 'UPDATE_ASSESSMENT', item: payload, status: 'rejected', note: note.trim(), historyText: 'Trả lại kèm ghi chú' });
    void saveInstructorAction('assessment', payload.id, { ...payload, status: 'rejected', note: note.trim() });
    toast({ tone: 'info', title: 'Đã trả lại kèm ghi chú' });
    navigate('/instructor/assessment');
  };

  const meta = statusMeta[item.status];

  return (
    <div className="page max-w-6xl">
      <PageHeader
        back={{ to: '/instructor/assessment', label: 'Ngân hàng câu hỏi' }}
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="caption">{item.topic}</span>
          </div>
        }
        title="Sửa câu hỏi & rubric"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <Card aria-labelledby="edit-title">
          <CardHeader id="edit-title" title="Nội dung" />
          <div className="space-y-5">
            <Textarea
              label="Câu hỏi"
              hint="Câu hỏi mở — sinh viên trả lời bằng lời của mình."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              error={errors.question}
              rows={3}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Mức độ" value={level} onChange={(e) => setLevel(e.target.value)} options={levels.map((l) => ({ value: l, label: l }))} />
              <Select label="Nguồn tài liệu" value={source} onChange={(e) => setSource(e.target.value)} options={sources.map((s) => ({ value: s, label: s }))} />
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Tiêu chí rubric</legend>
              <div className="space-y-2">
                {rubric.map((r, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <span className="caption w-5 pb-3 text-center" aria-hidden="true">
                      {i + 1}
                    </span>
                    <Input
                      className="flex-1"
                      label={`Tiêu chí ${i + 1}`}
                      hideLabel
                      value={r}
                      onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <IconButton icon="trash" label={`Xoá tiêu chí ${i + 1}`} onClick={() => setRubric(rubric.filter((_, j) => j !== i))} disabled={rubric.length <= 1} />
                  </div>
                ))}
              </div>
              {errors.rubric && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-danger-ink">
                  {errors.rubric}
                </p>
              )}
              <Button type="button" variant="secondary" size="sm" icon="plus" className="mt-3" onClick={() => setRubric([...rubric, ''])} disabled={rubric.length >= 6}>
                Thêm tiêu chí
              </Button>
            </fieldset>

            <Textarea
              label="Ghi chú khi trả lại"
              hint="Chỉ bắt buộc khi bạn trả lại câu hỏi."
              placeholder="Ví dụ: thêm một tiêu chí về giả thuyết đối"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={errors.note}
              rows={2}
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row">
            <Button icon="check" onClick={approve}>
              Duyệt và xuất bản
            </Button>
            <Button variant="secondary" onClick={saveDraft}>
              Lưu nháp
            </Button>
            <Button variant="ghost" className="sm:ml-auto" onClick={sendBack}>
              Trả lại kèm ghi chú
            </Button>
          </div>
        </Card>

        <aside className="space-y-4">
          <Card aria-labelledby="pv-title">
            <CardHeader id="pv-title" title="Sinh viên sẽ thấy" />
            <div className="space-y-2 rounded-xl border border-line bg-canvas p-4">
              <Badge tone="primary">Kiểm tra nhanh</Badge>
              <p className="text-[15px] font-semibold leading-snug">{question.trim() || 'Câu hỏi sẽ hiện ở đây'}</p>
              <div className="h-16 rounded-lg border border-dashed border-slate-300 bg-white" aria-hidden="true" />
            </div>
            <p className="caption mt-3">Rubric chỉ dùng để chấm, không hiện cho sinh viên.</p>
          </Card>

          {item.aiGenerated && (
            <Card tone="accent">
              <div className="flex gap-3">
                <Icon name="sparkle" className="shrink-0 text-accent-ink" />
                <div>
                  <p className="font-semibold">Do hệ thống gợi ý</p>
                  <p className="mt-1 text-sm">Câu hỏi được tạo từ {item.source ?? 'tài liệu môn học'}. Chỉ xuất bản sau khi bạn duyệt.</p>
                </div>
              </div>
            </Card>
          )}

          <Card aria-labelledby="hs-title">
            <CardHeader id="hs-title" title="Lịch sử" />
            {item.history?.length ? (
              <ol className="space-y-2 text-sm">
                {item.history.map((h, i) => (
                  <li key={i}>
                    <span className="text-muted">{h.at}</span> · {h.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="caption">Chưa có thay đổi.</p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
