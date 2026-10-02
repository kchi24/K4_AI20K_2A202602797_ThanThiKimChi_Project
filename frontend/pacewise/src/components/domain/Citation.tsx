import { useState } from 'react';
import type { Source } from '../../types';
import { reportCitation } from '../../services/api';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

export function Citation({ index, source, onOpen }: { index: number; source: Source; onOpen: (s: Source) => void }) {
  return (
    <button
      onClick={() => onOpen(source)}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:border-[#C9D8FB] hover:bg-[#FBFCFF]"
      aria-label={`Mở đoạn nguồn ${index}: ${source.name}, ${source.location}`}
    >
      <span className="flex h-7 min-w-[28px] items-center justify-center rounded-lg bg-primary-light text-xs font-bold text-primary-ink">{index}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{source.name}</span>
        <span className="caption block">{source.location}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-primary-ink sm:inline-flex">
        Mở đoạn nguồn <Icon name="arrowRight" size={16} />
      </span>
    </button>
  );
}

export function SourceModal({ source, onClose }: { source: Source | null; onClose: () => void }) {
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  return (
    <Modal
      open={!!source}
      onClose={onClose}
      title={source?.name ?? ''}
      description={source?.location}
      footer={
        <>
          <Button
            variant="ghost"
            icon="flag"
            loading={reporting}
            onClick={async () => {
              if (!source) return;
              setReporting(true);
              try {
                const { disputeId } = await reportCitation(source.id);
                onClose();
                toast({ tone: 'info', title: 'Đã ghi nhận phản ánh', description: `Đoạn nguồn tạm không dùng làm căn cứ chính. Mã: ${disputeId}` });
              } catch {
                toast({ tone: 'danger', title: 'Chưa thể gửi phản ánh', description: 'Vui lòng thử lại sau.' });
              } finally {
                setReporting(false);
              }
            }}
          >
            Báo nguồn sai
          </Button>
          <Button onClick={onClose}>Quay lại câu trả lời</Button>
        </>
      }
    >
      {source && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Đoạn liên quan</p>
            <blockquote className="mt-2 rounded-xl border border-[#F2E2A8] bg-[#FFF9E6] px-4 py-3 leading-relaxed">{source.excerpt}</blockquote>
          </div>
          {source.context && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Ngữ cảnh</p>
              <p className="mt-1 text-muted">{source.context}</p>
            </div>
          )}
          <p className="caption flex items-center gap-2">
            <Icon name="lock" size={16} /> Câu hỏi bạn đang soạn vẫn được giữ nguyên.
          </p>
        </div>
      )}
    </Modal>
  );
}
