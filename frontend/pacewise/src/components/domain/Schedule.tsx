import type { Course, Task, TimeBlock } from '../../types';
import { cx } from '../../utils/cx';
import { sortBlocks } from '../../utils/progress';
import { durationMin, formatDay, formatDeadline, formatDuration, formatRange, isPast } from '../../utils/time';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/Button';
import { CourseTag } from './TaskCard';

interface ScheduleProps {
  blocks: TimeBlock[];
  taskById: Map<string, Task>;
  courseById: Map<string, Course>;
  onEdit?: (block: TimeBlock) => void;
  highlightIds?: Set<string>;
  emptyText?: string;
}

/** Weekly schedule grouped by day. Works as a list on mobile and desktop alike. */
export function Schedule({ blocks, taskById, courseById, onEdit, highlightIds, emptyText = 'Chưa có buổi học nào.' }: ScheduleProps) {
  const sorted = sortBlocks(blocks);
  const days = Array.from(new Set(sorted.map((b) => b.date)));
  if (!days.length) return <p className="text-muted">{emptyText}</p>;
  return (
    <div className="space-y-5">
      {days.map((d) => {
        const items = sorted.filter((b) => b.date === d);
        const total = items.reduce((s, b) => s + durationMin(b.start, b.end), 0);
        return (
          <section key={d} aria-label={formatDay(d)}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[15px] font-semibold">{formatDay(d, { relative: true })}</h3>
              <span className="caption">· {formatDuration(total)}</span>
            </div>
            <ul className="space-y-2">
              {items.map((b) => {
                const task = taskById.get(b.taskId);
                const course = task ? courseById.get(task.courseId) : undefined;
                const past = isPast(b.date, b.end);
                return (
                  <li
                    key={b.id}
                    className={cx(
                      'flex items-center gap-3 rounded-xl border px-3 py-3 sm:px-4',
                      highlightIds?.has(b.id) ? 'border-[#C7EBD8] bg-success-light' : 'border-line bg-white',
                      past && 'opacity-70',
                    )}
                  >
                    <div className="w-[88px] shrink-0 sm:w-[108px]">
                      <p className="font-semibold tabular-nums">{formatRange(b.start, b.end)}</p>
                      <p className="caption">{formatDuration(durationMin(b.start, b.end))}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-semibold">{b.milestoneTitle ?? task?.title ?? 'Nhiệm vụ'}</p>
                        <CourseTag course={course} />
                        {past && <Badge>Đã qua</Badge>}
                      </div>
                      {task && <p className="caption">{b.milestoneTitle ? `${task.title} · ` : ''}Hạn chót {formatDeadline(task.deadline)}</p>}
                    </div>
                    {onEdit && <IconButton icon="edit" label={`Sửa buổi ${task?.title} ${formatRange(b.start, b.end)}`} onClick={() => onEdit(b)} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
