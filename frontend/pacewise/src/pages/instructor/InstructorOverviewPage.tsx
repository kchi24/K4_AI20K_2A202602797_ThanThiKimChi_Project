import { useEffect, useMemo, useState } from 'react';
import { StatTile } from '../../components/domain/StatTile';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Select, Textarea } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ErrorState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { ApiError, fetchInstructorData } from '../../services/api';
import { saveInstructorAction } from '../../services/api';
import {
  readInstructorOverviewCache,
  writeInstructorOverviewCache,
} from '../../services/instructorOverviewCache';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useAppStore } from '../../store/AppStore';

const MIN_GROUP = 5;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const formatDateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date(value));

function currentWeekLabel() {
  const today = new Date();
  const monday = new Date(today);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const short = (value: Date) => value.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return `${short(monday)} – ${short(sunday)}`;
}

export function InstructorOverviewPage() {
  useDocumentTitle('Tổng quan lớp');
  const { state, dispatch } = useAppStore();
  const toast = useToast();
  const [groupId, setGroupId] = useState('all');
  const [guidanceTopic, setGuidanceTopic] = useState<string | null>(null);
  const [guidanceText, setGuidanceText] = useState('');
  const cachedData = useMemo(
    () => readInstructorOverviewCache(state.user?.id, state.user?.courseId),
    [state.user?.courseId, state.user?.id],
  );
  const [loading, setLoading] = useState(!cachedData);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const classGroups = state.classGroups.length > 0
    ? state.classGroups
    : cachedData?.classGroups ?? [];
  const groupStats = state.classGroups.length > 0
    ? state.groupStats
    : cachedData?.groupStats ?? {};
  const group = classGroups.find((g) => g.id === groupId) ?? classGroups[0] ?? { id: 'all', name: 'Cả lớp', n: 0 };
  const stats = groupStats[group.id];
  const reviewQueue = state.classGroups.length > 0
    ? state.reviewQueue
    : cachedData?.reviewQueue ?? [];
  const pending = reviewQueue.filter((r) => r.status === 'pending' || r.status === 'in_review').length;
  const lmsSummary = state.classGroups.length > 0
    ? state.lmsInstructorSummary
    : cachedData?.lmsSummary ?? null;
  const activeCourse = state.courses.find((course) => course.id === state.user?.courseId);
  const enough = group.n >= MIN_GROUP && !!stats;

  useEffect(() => {
    let active = true;
    const cached = readInstructorOverviewCache(state.user?.id, state.user?.courseId);
    if (cached) {
      dispatch({ type: 'SET_INSTRUCTOR_DATA', ...cached });
      setGroupId(cached.classGroups[0]?.id ?? 'all');
    }
    setLoading(!cached && state.classGroups.length === 0);
    fetchInstructorData()
      .then((data) => {
        if (!active) return;
        writeInstructorOverviewCache(state.user?.id, state.user?.courseId, data);
        dispatch({ type: 'SET_INSTRUCTOR_DATA', ...data });
        setGroupId(data.classGroups[0]?.id ?? 'all');
        setLoadError(null);
      })
      .catch((error) => active && setLoadError(error instanceof ApiError ? error : new ApiError('UNKNOWN', 'Không thể tải dữ liệu lớp.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [dispatch, state.lmsRevision, state.user?.courseId, state.user?.id]);

  if (loading && classGroups.length === 0) {
    return (
      <div className="page" aria-busy="true">
        <PageHeader
          title="Tổng quan lớp"
          description="Đang đồng bộ dữ liệu tổng hợp từ LMS..."
        />
        <Card className="flex items-center gap-4 px-5 py-6">
          <span
            className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-primary border-r-transparent"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-semibold">Đang chuẩn bị số liệu lớp</h2>
            <p className="mt-1 text-sm text-muted">
              Dữ liệu được tổng hợp và loại bỏ định danh trước khi hiển thị.
            </p>
          </div>
        </Card>
      </div>
    );
  }
  if (loadError && classGroups.length === 0) {
    return <div className="page"><ErrorState title="Không thể tải tổng quan lớp" description={loadError.message} requestId={loadError.requestId} /></div>;
  }

  return (
    <div className="page">
      <PageHeader
        title="Tổng quan lớp"
        description={`${activeCourse?.code ?? 'Môn đang chọn'} · ${activeCourse?.name ?? 'Dữ liệu lớp học'} — tuần ${currentWeekLabel()}`}
        actions={
          <Select
            className="w-full sm:w-64"
            label="Nhóm sinh viên"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            options={classGroups.map((g) => ({ value: g.id, label: `${g.name} (n = ${g.n})` }))}
          />
        }
      />

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3">
        <Icon name="eyeOff" size={20} className="mt-0.5 shrink-0 text-muted" />
        <p className="text-[15px]">
          <strong>Chỉ hiển thị dữ liệu tổng hợp của nhóm từ {MIN_GROUP} sinh viên.</strong> Không có tên, nội dung hỏi đáp hay tổng kết cá nhân. Không dùng để xếp hạng hay chấm điểm.
        </p>
      </div>

      {!enough ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
            <Icon name="eyeOff" size={28} />
          </span>
          <h2 className="mt-4 text-xl font-semibold">Chưa đủ dữ liệu để hiển thị.</h2>
          <p className="mt-2 max-w-md text-muted">
            Nhóm “{group.name}” có {group.n} sinh viên. Số liệu chỉ hiển thị khi nhóm có ít nhất {MIN_GROUP} sinh viên để không ai bị nhận diện.
          </p>
          <button className="mt-6 min-h-[44px] rounded-xl bg-primary-dark px-4 font-semibold text-white hover:bg-primary-deeper" onClick={() => setGroupId('all')}>
            Xem cả lớp
          </button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile icon="checkCircle" label="Nộp đúng hạn" value={pct(stats.onTimeRate)} hint={`${stats.onTimeCount}/${stats.onTimeTotal ?? group.n} lượt nộp đã đến hạn`} />
            <StatTile icon="alert" label="Có tín hiệu nguy cơ" value={stats.atRisk} hint={`trong ${stats.riskWindowDays ?? 14} ngày tới`} />
            <StatTile
              icon="chart"
              label="Cải thiện tiến độ"
              value={stats.progressImprovement == null ? 'Chưa đủ mẫu' : `${stats.progressImprovement >= 0 ? '+' : ''}${Math.round(stats.progressImprovement * 100)} điểm %`}
              hint="so với tuần đầu trong cửa sổ"
            />
            <StatTile icon="users" label="Quy mô nhóm" value={group.n} hint="sinh viên" />
            <StatTile icon="inbox" label="Ca cần xem" value={pending} hint="trong Hàng chờ duyệt" />
          </div>

          <Card className="mt-5" aria-labelledby="assignment-risks">
            <CardHeader
              id="assignment-risks"
              title="Deadline cần can thiệp"
              subtitle={`Bài chưa nộp, còn tối đa 72 giờ và nằm trong cửa sổ ${stats.riskWindowDays ?? 14} ngày`}
            />
            {(stats.assignmentRisks ?? []).length === 0 ? (
              <p className="text-[15px] text-muted">Chưa có deadline nào cần can thiệp ngay.</p>
            ) : (
              <ul className="divide-y divide-line">
                {(stats.assignmentRisks ?? []).map((item) => (
                  <li key={item.assignmentId} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5">
                    <div>
                      <p className="font-semibold text-ink">{item.title}</p>
                      <p className="caption">Hạn {formatDateTime(item.dueAt)}</p>
                    </div>
                    <p className="text-sm"><strong>{item.atRiskCount}/{item.totalStudents}</strong> sinh viên chưa nộp</p>
                    <p className="text-sm text-warning-ink"><strong>{Math.round(item.missingMinutes / 60)} giờ</strong> chưa được bảo vệ</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {lmsSummary && (
            <Card className="mt-5" aria-labelledby="lms-course-structure">
              <CardHeader
                id="lms-course-structure"
                title="Cấu trúc và hoạt động LMS"
                subtitle="Tổng hợp cấp lớp; không hiển thị định danh sinh viên"
              />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <StatTile icon="chart" label="Sự kiện học" value={lmsSummary.analytics.events} hint={`${lmsSummary.analytics.active_users} người hoạt động`} />
                <StatTile icon="clock" label="Thời lượng" value={Math.round(lmsSummary.analytics.duration_seconds / 3600)} hint="giờ ghi nhận" />
                <StatTile icon="users" label="Lớp học phần" value={lmsSummary.sections.length} hint="section" />
                <StatTile icon="users" label="Nhóm học" value={lmsSummary.groups.reduce((sum, item) => sum + item.teamCount, 0)} hint="team" />
                <StatTile icon="book" label="Module" value={lmsSummary.modules.length} hint="module" />
                <StatTile icon="clipboard" label="Có rubric" value={lmsSummary.rubricAssignments} hint="bài tập" />
              </div>
            </Card>
          )}

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
            <Card aria-labelledby="trend">
              <CardHeader id="trend" title="Xu hướng hoàn thành" subtitle="Tỉ lệ nộp đúng hạn theo tuần" />
              <ul className="space-y-4">
                {stats.weeklyCompletion.map((w) => (
                  <li key={w.week}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="font-medium">{w.week}</span>
                      <span className="tabular-nums text-muted">
                        <strong className="text-ink">{pct(w.rate)}</strong> · {w.count}/{w.total}
                      </span>
                    </div>
                    <ProgressBar value={w.count} max={w.total} label={`${w.week}: ${pct(w.rate)}`} tone="success" />
                  </li>
                ))}
              </ul>
            </Card>

            <Card aria-labelledby="topics">
              <CardHeader id="topics" title="Chủ đề khó" subtitle="Số sinh viên có bằng chứng “còn nhầm lẫn” hoặc “chưa đủ bằng chứng”" />
              <ul className="space-y-4">
                {stats.topics.map((t) => (
                  <li key={t.topic} className="rounded-xl border border-line/60 bg-canvas/50 p-3">
                    <div className="mb-1.5 flex justify-between gap-3 text-sm">
                      <span className="font-semibold text-ink">{t.topic}</span>
                      <span className="shrink-0 tabular-nums text-muted">
                        <strong className="text-ink">{t.needsSupport}</strong>/{t.n} ({pct(t.needsSupport / t.n)})
                      </span>
                    </div>
                    <ProgressBar value={t.needsSupport} max={t.n} label={`${t.topic}: ${t.needsSupport} trên ${t.n}`} tone="warning" />
                    <div className="mt-3 flex items-center justify-end gap-2 border-t border-line/50 pt-2.5">
                      <ButtonLink to="/instructor/assessment" size="sm" variant="ghost" icon="edit">
                        Xem câu hỏi/Rubric
                      </ButtonLink>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="message"
                        onClick={() => {
                          setGuidanceTopic(t.topic);
                          setGuidanceText(`Lưu ý ôn kỹ các khái niệm cốt lõi của phần ${t.topic}, đối chiếu với Rubric trước khi làm bài tập lớn.`);
                        }}
                      >
                        Khuyến nghị ôn tập
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="mt-5" tone="accent" aria-labelledby="rq">
            <CardHeader id="rq" title="Hàng chờ duyệt" subtitle={`${pending} ca có độ tin cậy thấp đang chờ bạn xem`} action={<ButtonLink to="/instructor/review" size="sm">Mở hàng chờ</ButtonLink>} />
            <p className="text-[15px]">Hệ thống không tự kết luận ở các ca này. Quyết định của bạn được ghi vào nhật ký audit.</p>
          </Card>
        </>
      )}

      <Modal
        open={!!guidanceTopic}
        onClose={() => setGuidanceTopic(null)}
        title={`Gợi ý ôn tập — ${guidanceTopic ?? ''}`}
        description="Thông điệp sư phạm này sẽ hiển thị ẩn danh cho toàn bộ sinh viên trong nhóm môn học."
        footer={
          <>
            <Button variant="secondary" onClick={() => setGuidanceTopic(null)}>
              Hủy
            </Button>
            <Button
              icon="check"
              disabled={!guidanceText.trim()}
              onClick={async () => {
                if (!guidanceTopic || !guidanceText.trim()) return;
                await saveInstructorAction('guidance', guidanceTopic, { message: guidanceText.trim() });
                dispatch({ type: 'ADD_CLASS_GUIDANCE', topic: guidanceTopic, message: guidanceText.trim() });
                toast({ tone: 'success', title: 'Đã gửi khuyến nghị ôn tập', description: `Đã phát thông điệp cho chủ đề “${guidanceTopic}”.` });
                setGuidanceTopic(null);
              }}
            >
              Xác nhận gửi
            </Button>
          </>
        }
      >
        <Textarea
          label="Nội dung khuyến nghị"
          hint="Gợi ý tài liệu, phần bài đọc hoặc lưu ý quan trọng cần ôn tập."
          rows={3}
          value={guidanceText}
          onChange={(e) => setGuidanceText(e.target.value)}
        />
      </Modal>
    </div>
  );
}
