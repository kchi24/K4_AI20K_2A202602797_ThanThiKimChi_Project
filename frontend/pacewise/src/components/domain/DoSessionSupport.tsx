import { useState, type FormEvent } from 'react';
import { askDoQuestion } from '../../services/api';
import type { DoSessionPreparation, Source } from '../../types';
import { uid } from '../../utils/time';
import type { QAResult } from '../../utils/qa';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';

interface SessionMessage {
  id: string;
  role: 'student' | 'assistant';
  text: string;
  kind?: QAResult['kind'];
  sources?: Source[];
}

const LMS_URL = (import.meta.env.VITE_LMS_URL || 'http://localhost:8010').replace(/\/$/, '');
const resourceUrl = (url?: string | null) => !url ? null : /^https?:\/\//i.test(url) ? url : `${LMS_URL}${url.startsWith('/') ? '' : '/'}${url}`;

export function DoSessionSupport({
  courseId,
  blockId,
  taskTitle,
  objective,
  preparation,
  loading,
  error,
}: {
  courseId: string;
  blockId: string;
  taskTitle: string;
  objective: string;
  preparation: DoSessionPreparation | null;
  loading: boolean;
  error?: string;
}) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [chatError, setChatError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || asking) return;
    setMessages((current) => [...current, { id: uid('do-msg'), role: 'student', text: value }]);
    setQuestion('');
    setChatError('');
    setAsking(true);
    try {
      const result = await askDoQuestion({ courseId, blockId, taskTitle, objective, question: value });
      setMessages((current) => [...current, {
        id: uid('do-msg'),
        role: 'assistant',
        text: result.text,
        kind: result.kind,
        sources: result.sources,
      }]);
    } catch (requestError) {
      setChatError(requestError instanceof Error ? requestError.message : 'Chưa thể hỏi Do Agent.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <aside className="space-y-4" aria-label="Do Agent hỗ trợ phiên học">
      <Card className="!p-4">
        <div className="flex items-center gap-2">
          <Icon name="book" size={18} className="text-primary-ink" />
          <h2 className="font-bold">Tài liệu gợi ý</h2>
        </div>
        <p className="mt-1 text-xs text-muted">Do Agent chọn từ module của đúng môn học.</p>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted"><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-r-transparent" />Đang chuẩn bị học liệu…</p>
        ) : error ? (
          <p className="mt-4 rounded-lg bg-danger-light p-3 text-sm text-danger-ink">{error}</p>
        ) : preparation?.recommended_resources.length ? (
          <ul className="mt-3 space-y-2">
            {preparation.recommended_resources.map((resource) => {
              const href = resourceUrl(resource.url);
              const content = (
                <>
                  <span className="block truncate text-sm font-semibold">{resource.title}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">{resource.module} · {resource.kind}</span>
                </>
              );
              return (
                <li key={`${resource.id}:${resource.citation}`} className="rounded-xl border border-line bg-canvas px-3 py-2.5">
                  {href ? <a href={href} target="_blank" rel="noreferrer" className="block hover:text-primary-ink">{content}</a> : content}
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-4 text-sm text-muted">Chưa có học liệu phù hợp được giảng viên công bố.</p>}
      </Card>

      <Card className="flex min-h-[360px] flex-col !p-4">
        <div className="flex items-center gap-2">
          <Icon name="message" size={18} className="text-primary-ink" />
          <h2 className="font-bold">Hỏi đáp trong phiên</h2>
        </div>
        <p className="mt-1 text-xs text-muted">Có trích nguồn · không làm hộ bài tính điểm.</p>

        <div className="auto-hide-scrollbar mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
          {messages.length === 0 && (
            <div className="rounded-xl bg-primary-light p-3 text-sm text-primary-ink">
              {preparation?.opening_prompt ?? `Hỏi về kiến thức cần để thực hiện “${taskTitle}”.`}
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={message.role === 'student' ? 'ml-8 rounded-xl bg-primary-dark px-3 py-2.5 text-sm text-white' : 'mr-3 rounded-xl border border-line bg-white px-3 py-2.5 text-sm'}>
              <p className="whitespace-pre-line">{message.text}</p>
              {message.role === 'assistant' && message.kind === 'abstained' && <p className="mt-2 text-xs font-semibold text-warning-ink">Chưa đủ nguồn để trả lời chắc chắn.</p>}
              {!!message.sources?.length && (
                <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
                  {message.sources.map((source) => <li key={source.id}>[{source.id}] {source.name} · {source.location}</li>)}
                </ul>
              )}
            </div>
          ))}
          {asking && <p className="text-sm text-muted">Đang tìm trong học liệu đã duyệt…</p>}
          {chatError && <p className="rounded-lg bg-danger-light p-2 text-xs text-danger-ink">{chatError}</p>}
        </div>

        <form onSubmit={submit} className="mt-3 flex items-end gap-2 border-t border-line pt-3">
          <label className="sr-only" htmlFor="do-question">Câu hỏi trong phiên học</label>
          <textarea
            id="do-question"
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Hỏi về khái niệm đang học…"
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2 text-sm focus:border-primary-dark focus:outline-none"
          />
          <Button type="submit" size="sm" icon="send" loading={asking} disabled={!question.trim()} aria-label="Gửi câu hỏi" />
        </form>
      </Card>
    </aside>
  );
}
