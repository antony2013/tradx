import { describe, expect, it } from 'vitest';
import { BoundedQueue } from '../src/capture/queue';
import {
  CaptureStateMachine,
  InvalidStateTransitionError,
} from '../src/capture/state';

describe('bounded queue', () => {
  it('rejects invalid capacities', () => {
    expect(() => new BoundedQueue(0)).toThrow();
    expect(() => new BoundedQueue(-1)).toThrow();
    expect(() => new BoundedQueue(1.5)).toThrow();
  });

  it('enqueues and drains in order', async () => {
    const queue = new BoundedQueue<number>(10);
    expect(await queue.enqueue(1, 0)).toBe(true);
    expect(await queue.enqueue(2, 0)).toBe(true);
    expect(queue.depth).toBe(2);
    expect(queue.drain(10)).toEqual([1, 2]);
    expect(queue.depth).toBe(0);
  });

  it('drains at most maxItems and tracks max depth', async () => {
    const queue = new BoundedQueue<number>(10);
    await queue.enqueue(1, 0);
    await queue.enqueue(2, 0);
    await queue.enqueue(3, 0);

    expect(queue.drain(2)).toEqual([1, 2]);
    expect(queue.depth).toBe(1);
    expect(queue.maxDepth).toBe(3);
  });

  it('counts overflow instead of silently dropping', async () => {
    const queue = new BoundedQueue<number>(1);
    expect(await queue.enqueue(1, 0)).toBe(true);
    expect(await queue.enqueue(2, 0)).toBe(false);
    expect(queue.overflowCount).toBe(1);
    expect(queue.depth).toBe(1);
    expect(queue.drain(10)).toEqual([1]);
  });

  it('unblocks a waiting enqueue after drain', async () => {
    const queue = new BoundedQueue<number>(1);
    await queue.enqueue(1, 0);

    const pending = queue.enqueue(2, 1000);
    queue.drain(1);

    expect(await pending).toBe(true);
    expect(queue.drain(10)).toEqual([2]);
  });
});

describe('capture state machine', () => {
  it('starts stopped', () => {
    expect(new CaptureStateMachine().state).toBe('STOPPED');
  });

  it('walks the healthy lifecycle', () => {
    const machine = new CaptureStateMachine();
    for (const next of [
      'CONNECTING',
      'CONNECTED',
      'CAPTURING',
      'DEGRADED',
      'CAPTURING',
      'STOPPING',
      'STOPPED',
    ] as const) {
      expect(machine.transition(next)).toBe(next);
    }
    expect(machine.state).toBe('STOPPED');
  });

  it('recovers through reconnect after an error', () => {
    const machine = new CaptureStateMachine();
    machine.transition('CONNECTING');
    machine.transition('ERROR');
    machine.transition('CONNECTING');
    machine.transition('CONNECTED');
    expect(machine.state).toBe('CONNECTED');
  });

  it('rejects invalid transitions', () => {
    const machine = new CaptureStateMachine();
    expect(() => machine.transition('CAPTURING')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => machine.transition('CAPTURING')).toThrow(
      'Invalid capture state transition: STOPPED -> CAPTURING',
    );
    expect(machine.state).toBe('STOPPED');
  });
});
