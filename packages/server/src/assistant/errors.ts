import { AppError } from '../utils/errors';

/** An error with a stable machine code the app can switch on. */
export class AssistantError extends AppError {
  constructor(status: number, public readonly code: string, message: string) {
    super(status, message);
    this.name = 'AssistantError';
  }
}
