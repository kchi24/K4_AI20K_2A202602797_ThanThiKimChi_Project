import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { saveInstructorAction } from '../../services/api';
import type { AssessmentItem, AssessmentStatus, Tone } from '../../types';

const meta: Record<AssessmentStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Bản nháp', tone: 'neutral' },
  review: { label: 'Chờ duyệt', tone: 'warning' },
  approved: { label: 'Đã duyệt', tone: 'success' },
  rejected: { label: 'Bị trả lại', tone: 'danger' },
};

export function AssessmentPage() {
  useDocumentTitle('Ngân hàng câu hỏi');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [returning, setReturning] = useState<AssessmentItem | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const updateStatus = async (item: AssessmentItem, status: AssessmentStatus, actionNote?: string) => {
    setBusyId(item.id);
    setActionError('');
    try {
      const saved = await saveInstructorAction('assessment', item.id, {
        question: item.question,
        rubric: item.rubric,
        level: item.level,
        source: item.source,
        status,
        ...(actionNote ? { note: actionNote } : {}),
      });
      dispatch({
        type: 'UPDATE_ASSESSMENT',
        item: { ...item, version: Number(saved.payload.version ?? item.version ?? 1) },
        status,
        note: actionNote,
        historyText: status === 'approved' ? 'Duyệt và xuất bản' : status === 'rejected' ? 'Trả lại kèm ghi chú' : 'Gửi duyệt',
      });
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Chưa lưu được thay đổi.');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page max-w-4xl">
      <PageHeader title="Ngân hàng câu hỏi" description="Duyệt câu hỏi và rubric trước khi dùng cho sinh viên. Nội dung do hệ thống tạo không tự xuất bản." />
      {actionError && <p role="alert" className="mb-4 text-sm font-medium text-danger-ink">{actionError}</p>}
      <div className="space-y-4">
        {state.assessments.map((a) => (
          <Card as="article" key={a.id} aria-labelledby={`as-${a.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="caption">{a.topic}</p>
              <Badge tone="neutral">v{a.version ?? 0}</Badge>
              <Badge tone={meta[a.status].tone} className="ml-auto">
                {meta[a.status].label}
              </Badge>
            </div>
            <h2 id={`as-${a.id}`} className="mt-1 text-lg font-semibold">
              {a.question}
            </h2>
            <p className="mt-3 text-sm font-semibold text-muted">Rubric</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px]">
              {a.rubric.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {a.note && <p className="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger-ink">Ghi chú khi trả lại: {a.note}</p>}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              {a.status === 'draft' && (
                <Button size="sm" variant="secondary" loading={busyId === a.id} onClick={() => void updateStatus(a, 'review')}>
                  Gửi duyệt
                </Button>
              )}
              {(a.status === 'review' || a.status === 'rejected') && (
                <>
                  <Button
                    size="sm"
                    icon="check"
                    loading={busyId === a.id}
                    onClick={() => void updateStatus(a, 'approved').then((saved) => {
                      if (saved) toast({ tone: 'success', title: 'Đã duyệt và xuất bản cho pilot' });
                    })}
                  >
                    Duyệt và xuất bản
                  </Button>
                  {a.status === 'review' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setReturning(a);
                        setNote('');
                        setErr('');
                      }}
                    >
                      Trả lại kèm ghi chú
                    </Button>
                  )}
                </>
              )}
              {a.status === 'approved' && <p className="caption">Đang được dùng trong kiểm tra nhanh.</p>}
              {a.status !== 'approved' && (
                <ButtonLink to={`/instructor/assessment/${a.id}`} size="sm" variant="ghost" icon="edit" className="sm:ml-auto">
                  Sửa
                </ButtonLink>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={!!returning}
        onClose={() => setReturning(null)}
        title="Trả lại câu hỏi"
        description={returning?.question}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReturning(null)}>
              Hủy
            </Button>
            <Button
              onClick={() => {
                if (!note.trim()) {
                  setErr('Ghi chú là bắt buộc khi trả lại.');
                  return;
                }
                void updateStatus(returning!, 'rejected', note.trim()).then((saved) => {
                  if (!saved) return;
                  toast({ tone: 'info', title: 'Đã trả lại kèm ghi chú' });
                  setReturning(null);
                });
              }}
              loading={busyId === returning?.id}
            >
              Trả lại
            </Button>
          </>
        }
      >
        <Textarea label="Ghi chú cho người soạn" value={note} onChange={(e) => setNote(e.target.value)} error={err} rows={4} />
      </Modal>
    </div>
  );
}
