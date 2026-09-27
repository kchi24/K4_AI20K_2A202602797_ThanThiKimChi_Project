import type { Source } from '../types';

/** Approved course materials the Q&A assistant may cite. */
export const sources: Source[] = [
  {
    id: 'src-ml-w4',
    name: 'Course Lecture — Week 4: Supervised vs. Unsupervised Learning',
    location: 'Slide 12 · đoạn 2',
    excerpt:
      'Supervised learning học từ dữ liệu đã có nhãn: mỗi mẫu gồm đầu vào và đáp án mong muốn, ví dụ ảnh kèm nhãn "mèo" hoặc "chó". Mục tiêu là dự đoán nhãn cho dữ liệu mới.',
    context: 'Slide 11 giới thiệu khái niệm "nhãn" (label). Slide 13 so sánh classification và regression.',
  },
  {
    id: 'src-ml-w4b',
    name: 'Course Lecture — Week 4: Supervised vs. Unsupervised Learning',
    location: 'Slide 15 · đoạn 1',
    excerpt:
      'Unsupervised learning làm việc với dữ liệu không có nhãn và tìm cấu trúc ẩn trong dữ liệu, ví dụ phân cụm khách hàng theo hành vi mua sắm (clustering).',
    context: 'Slide 16 trình bày thuật toán k-means như một ví dụ phân cụm.',
  },
  {
    id: 'src-reading2',
    name: 'Reading 2 — Introduction to Statistical Learning, Ch. 2',
    location: 'Trang 26 · mục 2.1.4',
    excerpt:
      'Hầu hết bài toán học thống kê thuộc một trong hai loại: có giám sát (supervised) hoặc không giám sát (unsupervised). Điểm khác biệt nằm ở việc có hay không biến phản hồi đi kèm mỗi quan sát.',
  },
  {
    id: 'src-ml-w5',
    name: 'Course Lecture — Week 5: Model Evaluation',
    location: 'Slide 8 · đoạn 3',
    excerpt:
      'Overfitting xảy ra khi mô hình học quá sát dữ liệu huấn luyện, kể cả nhiễu, nên sai số trên tập huấn luyện thấp nhưng sai số trên tập kiểm tra cao.',
    context: 'Slide 9 giới thiệu cách phát hiện overfitting bằng tập validation.',
  },
];

export interface KnowledgeRule {
  keywords: string[];
  answer: string;
  citations: string[];
  suggestions: string[];
}

export const knowledgeRules: KnowledgeRule[] = [
  {
    keywords: ['supervised', 'unsupervised', 'giám sát', 'có nhãn', 'không nhãn'],
    answer:
      'Supervised learning sử dụng dữ liệu đã có nhãn — mỗi mẫu đi kèm đáp án đúng — để mô hình học cách dự đoán nhãn cho dữ liệu mới. Unsupervised learning làm việc với dữ liệu chưa có nhãn và tìm cấu trúc ẩn, ví dụ phân cụm. Điểm khác biệt cốt lõi là có hay không biến phản hồi đi kèm mỗi quan sát.',
    citations: ['src-ml-w4', 'src-ml-w4b', 'src-reading2'],
    suggestions: ['Cho mình một ví dụ về clustering', 'Classification khác regression thế nào?'],
  },
  {
    keywords: ['overfitting', 'quá khớp', 'học vẹt'],
    answer:
      'Overfitting là khi mô hình học quá sát dữ liệu huấn luyện, kể cả phần nhiễu. Dấu hiệu thường gặp: sai số trên tập huấn luyện rất thấp nhưng sai số trên tập kiểm tra lại cao.',
    citations: ['src-ml-w5'],
    suggestions: ['Làm sao phát hiện overfitting?'],
  },
  {
    keywords: ['clustering', 'phân cụm', 'k-means'],
    answer:
      'Clustering là một dạng unsupervised learning: thuật toán nhóm các mẫu giống nhau lại với nhau mà không cần nhãn, ví dụ nhóm khách hàng theo hành vi mua sắm.',
    citations: ['src-ml-w4b'],
    suggestions: ['Supervised và unsupervised khác nhau thế nào?'],
  },
];

/** Phrases that indicate a request to do graded work on the student's behalf. */
export const integrityPatterns = [
  'làm hộ',
  'làm bài này',
  'làm giúp bài',
  'giải hộ',
  'viết hộ',
  'làm thay',
  'đáp án bài',
  'cho mình đáp án',
  'viết giúp mình toàn bộ',
  'do my homework',
];

export const suggestedQuestions = [
  'Supervised và unsupervised learning khác nhau thế nào?',
  'Overfitting là gì?',
  'Làm bài Lab 4 hộ mình được không?',
];
