import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DoSessionPreparation } from '../../types';
import { DoSessionSupport } from './DoSessionSupport';

const preparation: DoSessionPreparation = {
  action: 'prepare', status: 'ready', block_id: 'b1', task_id: 't1', title: 'Vòng lặp',
  objective: 'Hiểu vòng lặp for', planned_minutes: 45, opening_prompt: 'Hãy hỏi khi cần.',
  recommended_resources: [{ id: 'r1', title: 'Slide vòng lặp', kind: 'file', module: 'Tuần 2', citation: '[Tuần 2 · Slide vòng lặp]', url: '/mock.pdf' }],
};

describe('DoSessionSupport', () => {
  it('shows grounded session resources and an embedded question form', () => {
    render(<DoSessionSupport courseId="1" blockId="b1" taskTitle="Vòng lặp" objective="Hiểu vòng lặp" preparation={preparation} loading={false} />);
    expect(screen.getByText('Slide vòng lặp')).toBeTruthy();
    const resourceLink = screen.getByRole('link', { name: /Slide vòng lặp/i });
    expect(resourceLink.getAttribute('target')).toBe('_blank');
    expect(resourceLink.getAttribute('href')).toBe('http://localhost:8010/mock.pdf');
    expect(screen.getByPlaceholderText('Hỏi về khái niệm đang học…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gửi câu hỏi' })).toBeTruthy();
  });
});
