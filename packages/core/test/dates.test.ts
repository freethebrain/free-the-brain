// Date semantics with fixed dates: offsets, the DL/SO/SB state machine, quadrants, Monday, stamps.
import { describe, expect, it } from 'vitest';
import {
  cycleMonday,
  daysSinceTriage,
  dleft,
  dstate,
  inFortnight,
  isOverdue,
  offsetDate,
  quadrant,
  sofiaOffset,
  sofiaStamp,
  sofiaToday,
  stampToTimestamp,
} from '../src/index.ts';
import type { Dated } from '../src/index.ts';

const TODAY = '2026-09-07'; // a Monday

const row = (deadline: string | null, type: Dated['deadline_type'], status: Dated['status'] = 'Planned'): Dated => ({
  deadline,
  deadline_type: type,
  status,
});

describe('dleft / offsetDate / cycleMonday', () => {
  it('counts whole days, negative when passed', () => {
    expect(dleft(TODAY, '2026-09-07')).toBe(0);
    expect(dleft(TODAY, '2026-09-21')).toBe(14);
    expect(dleft(TODAY, '2026-08-26')).toBe(-12);
    expect(dleft('2026-03-28', '2026-03-30')).toBe(2); // across the DST switch
  });

  it('applies months first, clamped to month end, then weeks, then days', () => {
    expect(offsetDate('2026-01-31', 1, 0, 0)).toBe('2026-02-28');
    expect(offsetDate('2026-01-31', 1, 0, 1)).toBe('2026-03-01');
    expect(offsetDate('2026-08-31', 1, 1, 0)).toBe('2026-10-07');
    expect(offsetDate(TODAY, 0, 2, 3)).toBe('2026-09-24');
    expect(offsetDate('2026-11-30', 3, 0, 0)).toBe('2027-02-28');
    expect(offsetDate(TODAY, 0, 0, 0)).toBe(TODAY);
  });

  it('finds the ISO-week Monday', () => {
    expect(cycleMonday(TODAY)).toBe('2026-09-07');
    expect(cycleMonday('2026-09-13')).toBe('2026-09-07'); // Sunday
    expect(cycleMonday('2026-09-06')).toBe('2026-08-31');
    expect(cycleMonday('2026-01-01')).toBe('2025-12-29');
  });
});

describe('dstate', () => {
  it('DL: overdue past the date, due otherwise', () => {
    expect(dstate(row('2026-09-06', 'DL'), TODAY)).toEqual({ k: 'overdue', n: -1 });
    expect(dstate(row('2026-09-07', 'DL'), TODAY)).toEqual({ k: 'due', n: 0 });
    expect(dstate(row('2026-09-10', null), TODAY)).toEqual({ k: 'due', n: 3 }); // unprefixed = DL
    expect(dstate(row(null, null), TODAY)).toBeNull();
  });

  it('SB: overdue only while Inbox/Planned, "started" once Active/Blocked', () => {
    expect(dstate(row('2026-09-01', 'SB', 'Inbox'), TODAY)).toEqual({ k: 'overdue', n: -6 });
    expect(dstate(row('2026-09-01', 'SB', 'Planned'), TODAY)).toEqual({ k: 'overdue', n: -6 });
    expect(dstate(row('2026-09-01', 'SB', 'Active'), TODAY)).toEqual({ k: 'started', n: -6 });
    expect(dstate(row('2026-09-01', 'SB', 'Blocked'), TODAY)).toEqual({ k: 'started', n: -6 });
    expect(dstate(row('2026-09-09', 'SB'), TODAY)).toEqual({ k: 'startby', n: 2 });
  });

  it('SO: never overdue — dormant, starts, eligible', () => {
    expect(dstate(row('2026-09-21', 'SO'), TODAY)).toEqual({ k: 'dormant', n: 14 });
    expect(dstate(row('2026-09-07', 'SO'), TODAY)).toEqual({ k: 'starts', n: 0 });
    expect(dstate(row('2026-09-01', 'SO', 'Inbox'), TODAY)).toEqual({ k: 'eligible', n: -6 });
    expect(isOverdue(row('2026-08-01', 'SO', 'Inbox'), TODAY)).toBe(false);
  });

  it('isOverdue / inFortnight follow the states', () => {
    expect(isOverdue(row('2026-09-06', 'DL'), TODAY)).toBe(true);
    expect(isOverdue(row('2026-09-06', 'SB', 'Active'), TODAY)).toBe(false);
    expect(inFortnight(row('2026-09-21', 'DL'), TODAY)).toBe(true);
    expect(inFortnight(row('2026-09-22', 'DL'), TODAY)).toBe(false);
    expect(inFortnight(row('2026-09-21', 'SO'), TODAY)).toBe(false); // dormant
    expect(inFortnight(row('2026-09-07', 'SO'), TODAY)).toBe(true); // starts today
    expect(inFortnight(row('2026-09-06', 'DL'), TODAY)).toBe(false); // overdue is not "within"
  });
});

describe('quadrant', () => {
  it('derives the four quadrants and Unjudged', () => {
    expect(quadrant('H', 'H')).toBe('Do now');
    expect(quadrant('M', 'H')).toBe('Schedule');
    expect(quadrant('L', 'H')).toBe('Schedule');
    expect(quadrant('H', 'M')).toBe('Minimize');
    expect(quadrant('M', 'M')).toBe('Later');
    expect(quadrant('L', 'L')).toBe('Later');
    expect(quadrant(null, 'H')).toBe('Unjudged');
    expect(quadrant(null, null)).toBe('Unjudged');
  });
});

describe('Europe/Sofia clock', () => {
  it('stamps in 24-hour Sofia wall time', () => {
    const at = new Date('2026-09-07T21:05:30Z'); // 00:05 next day in Sofia (UTC+3)
    expect(sofiaStamp(at)).toBe('2026-09-08-0005');
    expect(sofiaToday(at)).toBe('2026-09-08');
    expect(sofiaOffset(at)).toBe('+03:00');
    expect(sofiaOffset(new Date('2026-01-15T12:00:00Z'))).toBe('+02:00');
  });

  it('turns a stamp into an ISO timestamp with the right offset', () => {
    expect(stampToTimestamp('2026-08-31-1137')).toBe('2026-08-31T11:37:00+03:00');
    expect(stampToTimestamp('2026-12-01-0900')).toBe('2026-12-01T09:00:00+02:00');
  });
});

describe('daysSinceTriage', () => {
  it('is null when never judged, else whole days since the Triaged date', () => {
    expect(daysSinceTriage({ triaged: null }, TODAY)).toBeNull();
    expect(daysSinceTriage({ triaged: '' as unknown as null }, TODAY)).toBeNull();
    expect(daysSinceTriage({ triaged: TODAY }, TODAY)).toBe(0);
    expect(daysSinceTriage({ triaged: '2026-08-11' }, TODAY)).toBe(27);
    expect(daysSinceTriage({ triaged: '2026-03-28' }, '2026-03-30')).toBe(2); // across the DST switch
  });

  it('never goes negative for a Triaged date after today', () => {
    expect(daysSinceTriage({ triaged: '2026-09-09' }, TODAY)).toBe(0);
  });
});
