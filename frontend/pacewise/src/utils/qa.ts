import { integrityPatterns, knowledgeRules } from '../data/knowledge';
import type { QAKind } from '../types';

export interface QAResult {
  kind: QAKind;
  text: string;
  citations: string[];
  suggestions: string[];
}

const normalize = (s: string) => s.toLowerCase().normalize('NFC');

/** Rule-based stand-in for the grounded tutor. The real backend replaces this via services/api.ts. */
export function answerQuestion(question: string): QAResult {
  const q = normalize(question);
  const doItForMe = /(^|\s)(làm|giải|viết|code)\s.*\s(hộ|giùm|thay)(\s|$|[?.!,])/.test(q) || /(cho|gửi) mình (đáp án|lời giải|bài giải)/.test(q);
  if (doItForMe || integrityPatterns.some((p) => q.includes(p))) {
    return {
      kind: 'integrity',
      text: 'Mình không thể làm bài thay bạn.',
      citations: [],
      suggestions: [],
    };
  }
  const rule = knowledgeRules.find((r) => r.keywords.some((k) => q.includes(k)));
  if (rule) return { kind: 'grounded', text: rule.answer, citations: rule.citations, suggestions: rule.suggestions };
  return {
    kind: 'abstained',
    text: 'Kho học liệu của môn hiện chưa có đoạn nào trả lời câu hỏi này, nên mình chưa kết luận để tránh đưa thông tin sai.',
    citations: [],
    suggestions: ['Supervised và unsupervised learning khác nhau thế nào?', 'Overfitting là gì?'],
  };
}

export function hintFor(): QAResult {
  return {
    kind: 'hint',
    text:
      '1. Kiến thức cần dùng: hồi quy tuyến tính, hàm mất mát MSE, phép nhân ma trận trong NumPy.\n' +
      '2. Cách tiếp cận: viết công thức dự đoán ŷ = Xw trước, sau đó mới tính sai số và gradient.\n' +
      '3. Câu hỏi tự kiểm tra: kích thước của X và w là bao nhiêu để phép nhân hợp lệ?\n' +
      '4. Gửi mình đoạn bạn đang làm — mình sẽ chỉ ra chỗ cần xem lại, không viết lại toàn bộ.',
    citations: [],
    suggestions: ['Gradient descent hoạt động thế nào?'],
  };
}
