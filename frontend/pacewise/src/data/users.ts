import type { User } from '../types';

/** Mock accounts. Password for every demo account: `demo123`. */
export const users: (User & { password: string })[] = [
  { id: 'u-student', name: 'Trần Minh', email: 'sinhvien@pacewise.edu', role: 'student', password: 'demo123' },
  { id: 'u-new', name: 'Lê An', email: 'sinhvienmoi@pacewise.edu', role: 'student', isNew: true, password: 'demo123' },
  { id: 'u-instructor', name: 'ThS. Nam Lê', email: 'giangvien@pacewise.edu', role: 'instructor', password: 'demo123' },
  { id: 'u-guest', name: 'Khách', email: 'khach@pacewise.edu', role: 'guest', password: 'demo123' },
];
