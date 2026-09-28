import type { AssessmentItem, AuditEntry, ClassGroup, GroupStats, ReviewItem } from '../types';

export const classGroups: ClassGroup[] = [
  { id: 'all', name: 'Cả lớp', n: 42 },
  { id: 'g-morning', name: 'Nhóm sáng', n: 24 },
  { id: 'g-thu', name: 'Nhóm chiều Thứ Năm', n: 3 },
];

export const groupStats: Record<string, GroupStats> = {
  all: {
    groupId: 'all',
    onTimeRate: 0.78,
    onTimeCount: 33,
    atRisk: 12,
    weeklyCompletion: [
      { week: 'Tuần 1', rate: 0.7, count: 29, total: 41 },
      { week: 'Tuần 2', rate: 0.74, count: 31, total: 42 },
      { week: 'Tuần 3', rate: 0.78, count: 33, total: 42 },
      { week: 'Tuần 4 (hiện tại)', rate: 0.78, count: 33, total: 42 },
    ],
    topics: [
      { topic: 'Hypothesis Testing', needsSupport: 14, n: 38 },
      { topic: 'Supervised vs. Unsupervised', needsSupport: 8, n: 40 },
      { topic: 'Color scales', needsSupport: 5, n: 35 },
    ],
  },
  'g-morning': {
    groupId: 'g-morning',
    onTimeRate: 0.83,
    onTimeCount: 20,
    atRisk: 5,
    weeklyCompletion: [
      { week: 'Tuần 1', rate: 0.75, count: 18, total: 24 },
      { week: 'Tuần 2', rate: 0.79, count: 19, total: 24 },
      { week: 'Tuần 3', rate: 0.83, count: 20, total: 24 },
      { week: 'Tuần 4 (hiện tại)', rate: 0.83, count: 20, total: 24 },
    ],
    topics: [
      { topic: 'Hypothesis Testing', needsSupport: 7, n: 22 },
      { topic: 'Supervised vs. Unsupervised', needsSupport: 3, n: 23 },
      { topic: 'Color scales', needsSupport: 2, n: 20 },
    ],
  },
};

export const reviewQueue: ReviewItem[] = [
  {
    id: 'PW-104',
    topic: 'Hypothesis Testing',
    question: 'Giải thích ý nghĩa của p-value = 0,03 trong kiểm định một mẫu.',
    responseExcerpt: '“p-value 0,03 nghĩa là giả thuyết H0 có 3% khả năng đúng.”',
    confidence: 'low',
    reason: 'Câu trả lời mâu thuẫn với câu trước đó; nằm ngoài các mẫu trong rubric.',
    status: 'pending',
    submittedAt: '29/09 08:40',
  },
  {
    id: 'PW-101',
    topic: 'Supervised vs. Unsupervised',
    question: 'Phân loại email spam là bài toán supervised hay unsupervised? Vì sao?',
    responseExcerpt: '“Là unsupervised vì mô hình tự tìm ra email nào là spam.”',
    confidence: 'low',
    reason: 'Có dấu hiệu nhầm lẫn nhưng câu trả lời quá ngắn để kết luận.',
    status: 'pending',
    submittedAt: '28/09 21:15',
  },
  {
    id: 'PW-099',
    topic: 'Color scales',
    question: 'Khi nào nên dùng thang màu phân kỳ (diverging)?',
    responseExcerpt: '“Khi dữ liệu có một điểm giữa có ý nghĩa, ví dụ 0 hoặc giá trị trung bình.”',
    confidence: 'medium',
    reason: 'Bộ chấm tự động và rubric không thống nhất ở tiêu chí “ví dụ minh họa”.',
    status: 'in_review',
    submittedAt: '28/09 16:02',
  },
];

export const assessments: AssessmentItem[] = [
  {
    id: 'as-1',
    topic: 'Supervised vs. Unsupervised',
    question: 'Cho một ví dụ bài toán unsupervised trong thực tế và giải thích vì sao.',
    rubric: ['Nêu đúng dữ liệu không có nhãn', 'Ví dụ phù hợp (clustering, giảm chiều…)', 'Giải thích mục tiêu là tìm cấu trúc'],
    status: 'approved',
    level: 'Áp dụng (Bloom 3)',
    source: 'Slide tuần 4 — tr. 12–15',
    aiGenerated: true,
    history: [{ at: '26/09 10:12', text: 'Tạo tự động' }, { at: '28/09 10:12', text: 'Duyệt và xuất bản' }],
  },
  {
    id: 'as-2',
    topic: 'Hypothesis Testing',
    question: 'Giải thích ý nghĩa của p-value trong một câu, dùng ví dụ của bạn.',
    rubric: ['Đúng định nghĩa xác suất có điều kiện theo H0', 'Không diễn giải p-value là xác suất H0 đúng', 'Có ví dụ cụ thể'],
    status: 'review',
    level: 'Hiểu (Bloom 2)',
    source: 'Slide tuần 3 — tr. 12–14',
    aiGenerated: true,
    history: [{ at: '26/09 10:12', text: 'Tạo tự động' }, { at: '27/09 08:40', text: 'Sửa tiêu chí 2' }],
  },
  {
    id: 'as-3',
    topic: 'Color scales',
    question: 'Chọn thang màu cho bản đồ nhiệt độ lệch so với trung bình và giải thích.',
    rubric: ['Chọn thang phân kỳ', 'Nêu điểm giữa có ý nghĩa', 'Lưu ý người mù màu'],
    status: 'draft',
    level: 'Phân tích (Bloom 4)',
    source: 'Reading — Color scales, mục 3',
    aiGenerated: true,
    history: [{ at: '27/09 15:40', text: 'Tạo tự động' }],
  },
];

export const auditLog: AuditEntry[] = [
  { id: 'a1', at: '28/09 10:12', actor: 'ThS. Nam Lê', action: 'Duyệt câu hỏi “Ví dụ bài toán unsupervised”' },
  { id: 'a2', at: '27/09 15:40', actor: 'ThS. Nam Lê', action: 'Trả lại rubric “Color scales” kèm ghi chú' },
];
