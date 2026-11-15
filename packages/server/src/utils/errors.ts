/** Domain error whose message is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}
