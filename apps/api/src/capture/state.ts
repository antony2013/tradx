import type { CaptureState } from './types';

const allowedTransitions: Record<CaptureState, Set<CaptureState>> = {
  STOPPED: new Set(['CONNECTING', 'STOPPED']),
  CONNECTING: new Set(['CONNECTED', 'ERROR', 'STOPPING', 'STOPPED']),
  CONNECTED: new Set(['CAPTURING', 'DEGRADED', 'ERROR', 'STOPPING', 'STOPPED']),
  CAPTURING: new Set(['DEGRADED', 'ERROR', 'STOPPING', 'STOPPED']),
  DEGRADED: new Set(['CAPTURING', 'ERROR', 'STOPPING', 'STOPPED']),
  ERROR: new Set(['CONNECTING', 'STOPPING', 'STOPPED']),
  STOPPING: new Set(['STOPPED']),
};

export class InvalidStateTransitionError extends Error {
  constructor(from: CaptureState, to: CaptureState) {
    super(`Invalid capture state transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class CaptureStateMachine {
  private currentState: CaptureState = 'STOPPED';

  get state(): CaptureState {
    return this.currentState;
  }

  transition(next: CaptureState): CaptureState {
    if (!allowedTransitions[this.currentState].has(next)) {
      throw new InvalidStateTransitionError(this.currentState, next);
    }
    this.currentState = next;
    return next;
  }
}
