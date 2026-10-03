import { useMemo, useState } from 'react';
import type { PlanTimelineItem, PlanTimelineSource } from '../../utils/planTimeline';
import { cx } from '../../utils/cx';
import { formatDay, formatDeadline, formatDuration, formatRange, isPast } from '../../utils/time';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

type TimelineFilter = 'all' | PlanTimelineSource;

const FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'lms', label: 'Lịch LMS' },
  { value: 'pacewise', label: 'Kế hoạch học' },
  { value: 'busy', label: 'Lịch bận' },
];

export function CombinedSchedule({ items }: { items: PlanTimelineItem[] }) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const counts = useMemo(() => ({
    all: items.length,
    lms: items.filter((item) => item.source === 'lms').length,
    pacewise: items.filter((item) => item.source === 'pacewise').length,
    busy: items.filter((item) => item.source === 'busy').length,
  }), [items]);
  const visible = filter === 'all' ? items : items.filter((item) => item.source === filter);
  const days = Array.from(new Set(visible.map((item) => item.date)));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Lọc lịch tuần">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filter === option.value ? 'primary' : 'secondary'}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label} ({counts[option.value]})
          </Button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 rounded-xl bg-canvas px-3 py-2.5 text-sm text-muted" aria-label="Chú thích lịch">
        <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-primary" aria-hidden="true" />LMS · chỉ đọc</span>
        <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-success" aria-hidden="true" />Study block · có thể phục hồi</span>
        <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-warning" aria-hidden="true" />Không thể học · ràng buộc cứng</span>
      </div>

      {!days.length ? (
        <p className="text-muted">Không có mục nào thuộc bộ lọc này trong 7 ngày tới.</p>
      ) : (
        <div className="space-y-5">
          {days.map((date) => {
            const dayItems = visible.filter((item) => item.date === date);
            const lmsCount = dayItems.filter((item) => item.source === 'lms').length;
            const studyMinutes = dayItems
              .filter((item) => item.source === 'pacewise')
              .reduce((total, item) => total + item.durationMin, 0);
            return (
              <section key={date} aria-label={formatDay(date)}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold">{formatDay(date, { relative: true })}</h3>
                  <span className="caption">
                    · {lmsCount} mốc LMS{studyMinutes > 0 ? ` · ${formatDuration(studyMinutes)} kế hoạch học` : ''}
                  </span>
                </div>
                <ul className="space-y-2">
                  {dayItems.map((item) => <TimelineRow key={item.id} item={item} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimelineRow({ item }: { item: PlanTimelineItem }) {
  const past = isPast(item.date, item.end ?? item.start);
  const isLms = item.source === 'lms';
  const isBusy = item.source === 'busy';
  return (
    <li
      className={cx(
        'flex items-start gap-3 rounded-xl border px-3 py-3 sm:px-4',
        isLms
          ? 'border-[#C9D8FB] bg-primary-light'
          : isBusy
            ? 'border-[#F3D9A5] bg-warning-light'
            : 'border-[#C7EBD8] bg-success-light',
        past && 'opacity-70',
      )}
    >
      <div className="w-[88px] shrink-0 sm:w-[108px]">
        <p className="font-semibold tabular-nums">{item.end ? formatRange(item.start, item.end) : item.start}</p>
        <p className="caption">{item.durationMin > 0 ? formatDuration(item.durationMin) : 'Mốc thời gian'}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="font-semibold">{item.title}</p>
          {item.courseCode && <Badge tone="neutral">{item.courseCode}</Badge>}
          <Badge tone={isLms ? 'primary' : isBusy ? 'warning' : 'success'} icon={isLms ? 'lock' : isBusy ? 'clock' : 'sparkle'}>
            {isLms ? 'LMS' : isBusy ? 'Lịch bận' : 'PaceWise'}
          </Badge>
          {past && <Badge>Đã qua</Badge>}
        </div>
        <p className="caption mt-1">
          {isLms ? (
            <span className="inline-flex items-center gap-1"><Icon name="lock" size={13} />{item.kindLabel} · Chỉ đọc từ LMS</span>
          ) : isBusy ? (
            <span className="inline-flex items-center gap-1"><Icon name="clock" size={13} />{item.kindLabel} · PaceWise không xếp việc vào khoảng này</span>
          ) : item.deadline ? (
            <>Study block · Hạn chót {formatDeadline(item.deadline)}</>
          ) : 'Study block do PaceWise lập'}
        </p>
      </div>
    </li>
  );
}
