import { useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Course, PersonalSlotCategory, RoutineProfile, Task } from '../../types';
import type { PlanTimelineItem } from '../../utils/planTimeline';
import { formatDay } from '../../utils/time';
import { Icon } from '../ui/Icon';

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 58;
const MIN_EVENT_HEIGHT = 34;

type DragPayload =
  | { kind: 'block'; id: string }
  | { kind: 'busy'; category: PersonalSlotCategory; label: string };

interface PlanCalendarBoardProps {
  dates: string[];
  courses: Course[];
  tasks: Task[];
  items: PlanTimelineItem[];
  draftMode: boolean;
  onMoveBlock: (id: string, date: string, start: string) => void;
  onResizeBlock: (id: string, end: string) => void;
  onResizeBusy: (id: string, end: string) => void;
  onAddBusy: (date: string, start: string, category: PersonalSlotCategory, label: string) => void;
  onOpenPersonal: (category: PersonalSlotCategory, label: string) => void;
  onOpenRoutine: () => void;
  routineProfile: RoutineProfile | null;
  onOpenBlock: (id: string) => void;
  onSetPriority?: (taskId: string, priority: 1 | 2 | 3 | 4) => void;
  onRemoveBlock: (id: string) => void;
  onRemoveBusy: (id: string) => void;
}

const minuteOf = (clock: string) => {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
};

const clockOf = (minutes: number, allowGridEnd = false) => {
  const maximum = (allowGridEnd ? END_HOUR : END_HOUR - 1) * 60;
  const bounded = Math.max(START_HOUR * 60, Math.min(maximum, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
};

const payloadOf = (event: DragEvent): DragPayload | null => {
  try {
    return JSON.parse(event.dataTransfer.getData('application/x-pacewise')) as DragPayload;
  } catch {
    return null;
  }
};

const setPayload = (event: DragEvent, payload: DragPayload) => {
  event.dataTransfer.effectAllowed = payload.kind === 'block' ? 'move' : 'copy';
  event.dataTransfer.setData('application/x-pacewise', JSON.stringify(payload));
};

const sourceStyle: Record<PlanTimelineItem['source'], string> = {
  lms: 'border-l-[#596579] bg-[#EEF1F5] text-[#253044]',
  pacewise: 'border-l-[#526FE8] bg-[#E8EDFF] text-[#203A99]',
  busy: 'border-l-[#E8A426] bg-[#FFF5DE] text-[#70480A]',
};

const isPointMarker = (item: PlanTimelineItem) => !item.end && item.durationMin <= 0;

interface PositionedItem {
  item: PlanTimelineItem;
  lane: number;
  laneCount: number;
}

const visualRange = (item: PlanTimelineItem) => {
  const start = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 30, minuteOf(item.start)));
  const actualEnd = item.end ? minuteOf(item.end) : start + Math.max(item.durationMin, 30);
  const visualMinutes = Math.ceil(MIN_EVENT_HEIGHT / HOUR_HEIGHT * 60);
  return { start, end: Math.max(start + visualMinutes, actualEnd) };
};

/** Assign overlapping events to horizontal lanes instead of painting them on top of each other. */
export function positionCalendarItems(items: PlanTimelineItem[]): PositionedItem[] {
  const sorted = [...items].sort((left, right) => {
    const leftRange = visualRange(left);
    const rightRange = visualRange(right);
    return leftRange.start - rightRange.start || rightRange.end - leftRange.end || left.id.localeCompare(right.id);
  });
  const result: PositionedItem[] = [];
  let cluster: Array<{ item: PlanTimelineItem; start: number; end: number; lane: number }> = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneCount = Math.max(...cluster.map((entry) => entry.lane)) + 1;
    cluster.forEach((entry) => result.push({ item: entry.item, lane: entry.lane, laneCount }));
    cluster = [];
    clusterEnd = -1;
  };

  sorted.forEach((item) => {
    const range = visualRange(item);
    if (cluster.length && range.start >= clusterEnd) flush();
    const occupied = new Set(cluster.filter((entry) => entry.end > range.start).map((entry) => entry.lane));
    let lane = 0;
    while (occupied.has(lane)) lane += 1;
    cluster.push({ item, ...range, lane });
    clusterEnd = Math.max(clusterEnd, range.end);
  });
  flush();
  return result;
}

const PRIORITY_OPTIONS = [
  { value: 1, label: '1 · Thấp' },
  { value: 2, label: '2 · Bình thường' },
  { value: 3, label: '3 · Cao' },
  { value: 4, label: '4 · Rất cao' },
] as const;

function CourseTaskList({ courses, tasks, onSetPriority }: Pick<PlanCalendarBoardProps, 'courses' | 'tasks' | 'onSetPriority'>) {
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const [selectedTaskId, setSelectedTaskId] = useState(openTasks[0]?.id ?? '');
  const selectedTask = openTasks.find((task) => task.id === selectedTaskId) ?? openTasks[0];
  const selectedCourse = courses.find((course) => course.id === selectedTask?.courseId);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-b border-line bg-white lg:w-[232px] lg:border-b-0 lg:border-r" aria-label="Dữ liệu đầu vào kế hoạch">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Nhiệm vụ từ LMS</p>
        <p className="mt-1 text-xs text-muted">Dữ liệu chỉ đọc; Agent tự chia và xếp lịch học.</p>
      </div>
      <div className="min-h-0 flex-1 p-3">
        {selectedTask ? (
          <>
            <label className="block text-xs font-bold text-muted">
              Chọn nhiệm vụ
              <select
                value={selectedTask.id}
                onChange={(event) => setSelectedTaskId(event.target.value)}
                className="mt-1.5 block h-10 w-full rounded-lg border border-line bg-white px-2 text-xs font-semibold text-ink"
              >
                {courses.map((course) => {
                  const courseTasks = openTasks.filter((task) => task.courseId === course.id);
                  if (!courseTasks.length) return null;
                  return (
                    <optgroup key={course.id} label={`${course.code} · ${course.name}`}>
                      {courseTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                    </optgroup>
                  );
                })}
              </select>
            </label>

            <section className="mt-3 rounded-xl border border-line bg-canvas p-3" aria-live="polite">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <p className="truncate text-xs font-bold">{selectedCourse?.code ?? 'Môn học'}</p>
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-semibold">{selectedTask.title}</p>
              <dl className="mt-2 space-y-1 text-[11px] text-muted">
                <div className="flex justify-between gap-2"><dt>Còn lại</dt><dd className="font-semibold text-ink">{Math.max(0, selectedTask.estimateMin - selectedTask.loggedMin)} phút</dd></div>
                {selectedTask.assignmentGroup?.weight ? <div className="flex justify-between gap-2"><dt>Trọng số nhóm</dt><dd className="font-semibold text-ink">{selectedTask.assignmentGroup.weight}%</dd></div> : null}
              </dl>
            </section>

            <label className="mt-3 block text-xs font-bold text-muted">
              Ưu tiên cá nhân
              <select
                value={selectedTask.personalPriority ?? 2}
                onChange={(event) => onSetPriority?.(selectedTask.id, Number(event.target.value) as 1 | 2 | 3 | 4)}
                aria-label={`Ưu tiên cá nhân cho ${selectedTask.title}`}
                className="mt-1.5 block h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-primary-ink"
              >
                {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <p className="mt-2 text-[11px] leading-4 text-muted">Ưu tiên này là tín hiệu cá nhân. Deadline và trọng số từ LMS vẫn được Agent kiểm tra.</p>
          </>
        ) : <p className="text-xs text-muted">Không có nhiệm vụ đang mở.</p>}
      </div>
    </aside>
  );
}

const PERSONAL_CATEGORIES: Array<{ value: PersonalSlotCategory; label: string; help: string }> = [
  { value: 'meal', label: 'Ăn uống', help: 'Khoảng không xếp việc học' },
  { value: 'self_study', label: 'Giờ tự học', help: 'Khung Agent ưu tiên xếp học' },
  { value: 'sleep', label: 'Ngủ', help: 'Khoảng nghỉ được bảo vệ' },
  { value: 'other', label: 'Bận khác', help: 'Bạn tự đặt tên hoạt động' },
];

function PersonalSchedulePanel({ onAdd, onOpenRoutine, routineProfile }: {
  onAdd: (category: PersonalSlotCategory, label: string) => void;
  onOpenRoutine: () => void;
  routineProfile: RoutineProfile | null;
}) {
  const [category, setCategory] = useState<PersonalSlotCategory>('meal');
  const [customLabel, setCustomLabel] = useState('');
  const selected = PERSONAL_CATEGORIES.find((item) => item.value === category)!;
  const label = category === 'other' ? customLabel.trim() || 'Bận khác' : selected.label;
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-t border-line bg-white lg:w-[220px] lg:border-l lg:border-t-0" aria-labelledby="personal-events">
      <div className="border-b border-line px-4 py-3">
        <h2 id="personal-events" className="text-sm font-bold">Lịch cá nhân</h2>
        <p className="mt-1 text-xs text-muted">Kéo hoạt động vào lịch hoặc bấm để nhập giờ.</p>
      </div>
      <div className="auto-hide-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <label className="text-xs font-bold text-muted">Loại hoạt động
          <select value={category} onChange={(event) => setCategory(event.target.value as PersonalSlotCategory)} className="mt-1 block h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink">
            {PERSONAL_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        {category === 'other' && (
          <label className="mt-3 block text-xs font-bold text-muted">Tên hoạt động
            <input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} maxLength={80} placeholder="Ví dụ: Làm thêm" className="mt-1 block h-10 w-full rounded-lg border border-line px-3 text-sm font-normal text-ink" />
          </label>
        )}
        <button
          type="button"
          draggable
          onDragStart={(event) => setPayload(event, { kind: 'busy', category, label })}
          onClick={() => onAdd(category, label)}
          className={`mt-3 flex w-full cursor-grab items-start gap-2 rounded-xl border border-dashed px-3 py-3 text-left active:cursor-grabbing ${category === 'self_study' ? 'border-[#7DA98A] bg-[#EEF8F1] text-[#245D34]' : 'border-[#E3B85F] bg-[#FFF9EA] text-[#70480A]'}`}
          title="Kéo vào lịch hoặc bấm để chọn ngày giờ"
        >
          <Icon name={category === 'self_study' ? 'book' : 'plus'} size={16} className="mt-0.5 shrink-0" />
          <span><span className="block text-xs font-bold">{label}</span><span className="mt-0.5 block text-[11px] opacity-75">{selected.help}</span></span>
        </button>
      </div>
      <div className="shrink-0 border-t border-line p-3">
        <button type="button" onClick={onOpenRoutine} className="flex w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:bg-slate-50">
          <Icon name="clock" size={16} className="text-primary-ink" />
          <span className="min-w-0"><span className="block text-xs font-bold">Giờ sinh hoạt</span><span className="block truncate text-[11px] text-muted">{routineProfile ? `${routineProfile.wakeTime} thức · ${routineProfile.sleepTime} ngủ` : 'Thiết lập nhịp học cá nhân'}</span></span>
        </button>
      </div>
    </aside>
  );
}

function CalendarEvent({
  item,
  lane,
  laneCount,
  draftMode,
  onResizeBlock,
  onResizeBusy,
  onOpenBlock,
  onRemoveBlock,
  onRemoveBusy,
}: {
  item: PlanTimelineItem;
  lane: number;
  laneCount: number;
  draftMode: boolean;
  onResizeBlock: (id: string, end: string) => void;
  onResizeBusy: (id: string, end: string) => void;
  onOpenBlock: (id: string) => void;
  onRemoveBlock: (id: string) => void;
  onRemoveBusy: (id: string) => void;
}) {
  const start = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - 30, minuteOf(item.start)));
  const end = item.end ? minuteOf(item.end) : start + Math.max(item.durationMin, 30);
  const [resizeEnd, setResizeEnd] = useState<number | null>(null);
  const displayEnd = resizeEnd ?? end;
  const top = ((start - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const height = Math.max(MIN_EVENT_HEIGHT, ((Math.max(start + 30, displayEnd) - start) / 60) * HOUR_HEIGHT - 3);
  const canMove = item.source === 'pacewise' && !item.readOnly && draftMode && item.entityId;
  const canDeleteBusy = item.source === 'busy' && !item.readOnly && item.entityId;
  const canResize = Boolean(canMove || canDeleteBusy);
  const canOpen = item.source === 'pacewise' && item.scheduleStatus !== 'history' && Boolean(item.entityId && item.taskId);
  const widthPercent = 100 / laneCount;
  const leftPercent = lane * widthPercent;

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canResize || !item.entityId) return;
    event.preventDefault();
    event.stopPropagation();
    const originY = Number.isFinite(event.clientY) ? event.clientY : 0;
    const originEnd = end;
    let latestEnd = originEnd;
    const move = (pointerEvent: PointerEvent) => {
      const pointerY = Number.isFinite(pointerEvent.clientY) ? pointerEvent.clientY : originY;
      const delta = Math.round(((pointerY - originY) / HOUR_HEIGHT) * 2) * 30;
      latestEnd = Math.max(start + 30, Math.min(END_HOUR * 60, originEnd + delta));
      setResizeEnd(latestEnd);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setResizeEnd(null);
      if (latestEnd !== originEnd) {
        const nextEnd = clockOf(latestEnd, true);
        if (item.source === 'pacewise') onResizeBlock(item.entityId!, nextEnd);
        if (item.source === 'busy') onResizeBusy(item.entityId!, nextEnd);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  return (
    <article
      draggable={Boolean(canMove)}
      onDragStart={(event) => canMove && setPayload(event, { kind: 'block', id: item.entityId! })}
      onClick={() => canOpen && onOpenBlock(item.entityId!)}
      onKeyDown={(event) => {
        if (canOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpenBlock(item.entityId!);
        }
      }}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      className={`group absolute z-10 overflow-hidden rounded-md border border-white/70 border-l-[3px] px-2 py-1 shadow-sm ${item.kind === 'personal_self_study' ? 'border-l-[#4E9462] bg-[#EAF7EE] text-[#245D34]' : sourceStyle[item.source]} ${item.scheduleStatus === 'tentative' ? 'border-dashed opacity-70' : ''} ${item.scheduleStatus === 'history' ? 'opacity-55 grayscale' : ''} ${canMove ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ top, height, left: `calc(${leftPercent}% + 3px)`, width: `calc(${widthPercent}% - 5px)` }}
      title={`${item.start}${item.end ? `–${item.end}` : ''} · ${item.title}${canOpen ? ' · Mở phiên tự học' : ''}`}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold leading-4">{item.start}{item.end ? `–${clockOf(displayEnd, true)}` : ''}</p>
          <p className={`${height < 48 ? 'truncate' : 'line-clamp-2'} text-[11px] font-bold leading-4`}>{item.courseCode ? `${item.courseCode} · ` : ''}{item.title}{item.scheduleStatus === 'tentative' ? ' · Dự kiến' : ''}</p>
        </div>
        {(canMove || canDeleteBusy) && (
          <button
            type="button"
            aria-label={`Xóa ${item.title}`}
            title="Xóa khỏi bản nháp"
            onClick={(event) => {
              event.stopPropagation();
              if (canMove) onRemoveBlock(item.entityId!);
              else if (canDeleteBusy) onRemoveBusy(item.entityId!);
            }}
            className="mt-0.5 rounded p-0.5 opacity-70 hover:bg-white hover:opacity-100"
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {canResize && (
        <button
          type="button"
          draggable={false}
          aria-label={`Thay đổi thời lượng ${item.title}`}
          title="Kéo để tăng hoặc giảm thời lượng"
          onPointerDown={startResize}
          className={`absolute inset-x-0 bottom-0 flex h-2.5 touch-none cursor-ns-resize items-center justify-center bg-white/15 opacity-0 transition-opacity hover:bg-white/50 focus:opacity-100 group-hover:opacity-100 ${resizeEnd === null ? '' : 'opacity-100'}`}
        >
          <span className="h-0.5 w-5 rounded-full bg-current opacity-45" aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

export function PlanCalendarBoard(props: PlanCalendarBoardProps) {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  const handleDrop = (event: DragEvent<HTMLDivElement>, date: string) => {
    event.preventDefault();
    const payload = payloadOf(event);
    if (!payload) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = Math.round(((event.clientY - rect.top) / HOUR_HEIGHT) * 2) * 30 + START_HOUR * 60;
    const start = clockOf(minute);
    if (payload.kind === 'block') props.onMoveBlock(payload.id, date, start);
    if (payload.kind === 'busy') props.onAddBusy(date, start, payload.category, payload.label);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card lg:flex-row">
      <CourseTaskList courses={props.courses} tasks={props.tasks} onSetPriority={props.onSetPriority} />

      <section className="h-full min-h-0 min-w-0 flex-1" aria-label="Lịch tuần kéo thả">
        <div className="auto-hide-scrollbar h-full overflow-x-auto">
          <div className="flex h-full min-w-[860px] flex-col">
            <div className="z-20 grid shrink-0 border-b border-line bg-white" style={{ gridTemplateColumns: '58px repeat(7, minmax(112px, 1fr))' }}>
              <div className="border-r border-line" />
              {props.dates.map((date) => {
                const markers = props.items.filter((item) => item.date === date && isPointMarker(item));
                return (
                  <div key={date} className="min-w-0 border-r border-line px-2 py-2 text-center last:border-r-0">
                    <p className="text-xs font-bold capitalize text-ink">{formatDay(date, { short: true })}</p>
                    <p className="text-[11px] text-muted">{date.slice(8, 10)}/{date.slice(5, 7)}</p>
                    {markers.length > 0 && (
                      <div
                        className="mt-1 flex min-w-0 items-center justify-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                        title={markers.map((item) => `${item.start} · ${item.courseCode ? `${item.courseCode} · ` : ''}${item.title}`).join('\n')}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" aria-hidden="true" />
                        <span className="truncate">{markers[0].start} · {markers[0].courseCode ?? markers[0].kindLabel}</span>
                        {markers.length > 1 && <span className="shrink-0">+{markers.length - 1}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="auto-hide-scrollbar min-h-0 flex-1 overflow-y-auto">
              <div className="grid" style={{ gridTemplateColumns: '58px repeat(7, minmax(112px, 1fr))' }}>
                <div className="relative border-r border-line bg-[#FBFCFE]" style={{ height: gridHeight }} aria-hidden="true">
                  {hours.slice(0, -1).map((hour) => (
                    <span key={hour} className={`absolute right-2 text-[10px] font-medium text-muted ${hour === START_HOUR ? '' : '-translate-y-1/2'}`} style={{ top: hour === START_HOUR ? 4 : (hour - START_HOUR) * HOUR_HEIGHT }}>
                      {String(hour).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>

                {props.dates.map((date) => (
                  <div
                    key={date}
                    className="relative border-r border-line last:border-r-0"
                    style={{ height: gridHeight }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(event) => handleDrop(event, date)}
                  >
                    {hours.slice(0, -1).map((hour) => (
                      <div key={hour} className="absolute inset-x-0 border-t border-[#E9EDF4]" style={{ top: (hour - START_HOUR) * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
                        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#F1F3F7]" />
                      </div>
                    ))}
                    {positionCalendarItems(props.items.filter((item) => item.date === date && !isPointMarker(item))).map(({ item, lane, laneCount }) => (
                      <CalendarEvent
                        key={item.id}
                        item={item}
                        lane={lane}
                        laneCount={laneCount}
                        draftMode={props.draftMode}
                        onResizeBlock={props.onResizeBlock}
                        onResizeBusy={props.onResizeBusy}
                        onOpenBlock={props.onOpenBlock}
                        onRemoveBlock={props.onRemoveBlock}
                        onRemoveBusy={props.onRemoveBusy}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
      <PersonalSchedulePanel onAdd={props.onOpenPersonal} onOpenRoutine={props.onOpenRoutine} routineProfile={props.routineProfile} />
    </div>
  );
}
