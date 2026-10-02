import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Select, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';
import { saveInstructorAction } from '../../services/api';
import type { ReviewItem, ReviewStatus, Tone } from '../../types';
import { cx } from '../../utils/cx';

const statusMeta: Record<ReviewStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Chờ xem', tone: 'warning' },
  in_review: { label: 'Đang xem', tone: 'primary' },
  approved: { label: 'Đã duyệt', tone: 'success' },
  edited: { label: 'Đã sửa & duyệt', tone: 'success' },
  rejected: { label: 'Đã từ chối', tone: 'danger' },
  needs_evidence: { label: 'Chờ thêm bằng chứng', tone: 'accent' },
};

export function EvidenceCard({ item, onReview }: { item: ReviewItem; onReview: () => void }) {
  const s = statusMeta[item.status];
  return (
    <Card as="article" aria-labelledby={`r-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`r-${item.id}`} className="font-semibold">
          Ca #{item.id}
        </h2>
        <Badge tone={s.tone}>{s.label}</Badge>
        <Badge tone={item.confidence === 'low' ? 'danger' : 'warning'}>Độ tin cậy: {item.confidence === 'low' ? 'thấp' : 'trung bình'}</Badge>
        <span className="caption ml-auto">{item.submittedAt}</span>
      </div>
      <p className="caption mt-2">{item.topic}</p>
      <p className="mt-1 font-medium">{item.question}</p>
      <blockquote className="mt-3 rounded-xl bg-canvas px-4 py-3 italic text-slate-700">{item.responseExcerpt}</blockquote>
      <p className="mt-3 text-[15px]">
        <strong>Lý do chuyển: </strong>
        {item.reason}
      </p>
      {item.note && <p className="caption mt-2">Ghi chú: {item.note}</p>}
      <div className="mt-4">
        <Button variant={['approved', 'edited', 'rejected'].includes(item.status) ? 'secondary' : 'primary'} size="sm" onClick={onReview}>
          {['approved', 'edited', 'rejected'].includes(item.status) ? 'Xem lại quyết định' : 'Xem xét & Duyệt'}
        </Button>
      </div>
    </Card>
  );
}

export function ReviewQueuePage() {
  useDocumentTitle('Hàng chờ duyệt');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [active, setActive] = useState<ReviewItem | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [correctedStatus, setCorrectedStatus] = useState('đang hình thành');
  const [saving, setSaving] = useState(false);

  const items = state.reviewQueue.filter((r) => filter === 'all' || r.status === 'pending' || r.status === 'in_review');

  const decide = async (status: ReviewStatus) => {
    if (!active) return;
    if (['edited', 'rejected', 'needs_evidence'].includes(status) && !note.trim()) {
      setNoteError('Thêm ghi chú để người xem tiếp theo biết cần kiểm tra gì.');
      return;
    }
    const payload = {
      status,
      note: note.trim() || undefined,
      ...(status === 'edited'
        ? { edited_result: { status: correctedStatus, confidence: 'teacher_confirmed' } }
        : {}),
    };
    setSaving(true);
    try {
      await saveInstructorAction('review', active.id, payload);
      dispatch({ type: 'SET_REVIEW_STATUS', id: active.id, status, note: payload.note });
      const title = {
        approved: `Đã duyệt ca #${active.id}`,
        edited: `Đã sửa và duyệt ca #${active.id}`,
        rejected: `Đã từ chối ca #${active.id}`,
        needs_evidence: `Đã yêu cầu thêm bằng chứng cho ca #${active.id}`,
        pending: `Đã đưa ca #${active.id} về chờ`,
        in_review: `Đang xem ca #${active.id}`,
      }[status];
      toast({ tone: 'success', title, description: 'Quyết định đã được ghi vào audit.' });
      setActive(null);
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : 'Chưa lưu được quyết định.');
    } finally {
      setSaving(false);
    }
  };

  const openReview = async (item: ReviewItem) => {
    setActive(item);
    setNote(item.note ?? '');
    setCorrectedStatus(item.suggestedStatus ?? 'đang hình thành');
    setNoteError('');
    if (item.status !== 'pending') return;
    setSaving(true);
    try {
      await saveInstructorAction('review', item.id, { status: 'in_review' });
      dispatch({ type: 'SET_REVIEW_STATUS', id: item.id, status: 'in_review' });
      setActive({ ...item, status: 'in_review' });
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : 'Chưa thể nhận xử lý ca này.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page max-w-4xl">
      <PageHeader title="Hàng chờ duyệt" description="Các ca hệ thống không đủ tin cậy để tự kết luận. Chỉ hiển thị trích đoạn liên quan tới rubric." />
      <div className="mb-5 inline-flex rounded-xl border border-line bg-white p-1" role="tablist" aria-label="Lọc hàng chờ">
        {(
          [
            ['open', 'Cần xử lý'],
            ['all', 'Tất cả'],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            role="tab"
            aria-selected={filter === v}
            onClick={() => setFilter(v)}
            className={cx('min-h-[40px] rounded-lg px-4 text-sm font-semibold', filter === v ? 'bg-primary-light text-primary-ink' : 'text-muted hover:text-ink')}
          >
            {l}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState icon="inbox" title="Không còn ca nào cần xử lý" description="Khi có ca độ tin cậy thấp hoặc nguồn bị phản ánh, chúng sẽ xuất hiện ở đây." />
      ) : (
        <div className="space-y-4">
          {items.map((r) => (
            <EvidenceCard
              key={r.id}
              item={r}
              onReview={() => void openReview(r)}
            />
          ))}
        </div>
      )}

      <Card className="mt-6" aria-labelledby="audit">
        <CardHeader id="audit" title="Nhật ký quyết định (audit)" />
        <ul className="divide-y divide-line">
          {state.audit.slice(0, 6).map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-3">
              <span className="caption w-28 shrink-0 tabular-nums">{a.at}</span>
              <span className="text-[15px]">
                <strong>{a.actor}</strong> · {a.action}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        size="lg"
        title={`Xem xét ca #${active?.id ?? ''}`}
        description="Xem bằng chứng rồi chọn quyết định. Sinh viên không bị gắn nhãn cho tới khi bạn duyệt."
        footer={
          <>
            <Button variant="secondary" onClick={() => setActive(null)}>
              Để sau
            </Button>
            <Button variant="ghost" onClick={() => void decide('rejected')} loading={saving}>
              Từ chối
            </Button>
            <Button variant="soft" icon="refresh" onClick={() => void decide('needs_evidence')} loading={saving}>
              Yêu cầu thêm bằng chứng
            </Button>
            <Button variant="secondary" icon="edit" onClick={() => void decide('edited')} loading={saving}>
              Sửa & duyệt
            </Button>
            <Button icon="check" onClick={() => void decide('approved')} loading={saving}>
              Phê duyệt
            </Button>
          </>
        }
      >
        {active && (
          <div className="space-y-4">
            <div>
              <p className="caption">{active.topic}</p>
              <p className="font-medium">{active.question}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted">Trích đoạn câu trả lời</p>
              <blockquote className="mt-1 rounded-xl bg-canvas px-4 py-3 italic">{active.responseExcerpt}</blockquote>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-3">
                <p className="caption">Độ tin cậy</p>
                <p className="font-semibold">{active.confidence === 'low' ? 'Thấp' : 'Trung bình'}</p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="caption">Lý do</p>
                <p className="text-[15px]">{active.reason}</p>
              </div>
            </div>
            {active.rubricVersion && (
              <p className="caption">Rubric version đã dùng: v{active.rubricVersion}</p>
            )}
            <Select
              label="Kết luận hiệu chỉnh"
              value={correctedStatus}
              onChange={(event) => setCorrectedStatus(event.target.value)}
              options={[
                { value: 'thể hiện hiểu biết', label: 'Thể hiện hiểu biết' },
                { value: 'đang hình thành', label: 'Đang hình thành' },
                { value: 'còn nhầm lẫn', label: 'Còn nhầm lẫn' },
                { value: 'chưa đủ bằng chứng', label: 'Chưa đủ bằng chứng' },
              ]}
            />
            <Textarea label="Ghi chú quyết định" value={note} onChange={(e) => setNote(e.target.value)} error={noteError} hint="Bắt buộc khi sửa, từ chối hoặc yêu cầu thêm bằng chứng." rows={3} />
          </div>
        )}
      </Modal>
    </div>
  );
}
