import type { Logger } from '../lib/logger';

export type HolidayCalendarState = 'applied' | 'unavailable';

export type ClosedDatesResult = {
  /** YYYY-MM-DD dates with no session for the dataset's segment. */
  dates: Set<string>;
  calendar: HolidayCalendarState;
  note?: string;
};

export type HolidayProvider = {
  getClosedDates(
    from: string,
    to: string,
    instrumentKey: string,
  ): Promise<ClosedDatesResult>;
};

export type MarketHolidaysClient = {
  getMarketHolidays(date?: string): Promise<unknown>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Instrument-key segment -> Upstox holiday closed_exchanges code.
// Vocabulary is Upstox's own (ref §12.5 + live /v2/market/holidays);
// the HOLIDAYS always come from the API, never hardcoded — only this
// code translation is mapped. Unknown segments fall back to the exchange
// prefix, then to conservative "no holidays" with a note.
const SEGMENT_TO_HOLIDAY_CODE: Record<string, string> = {
  NSE_EQ: 'NSE',
  NSE_INDEX: 'NSE',
  NSE_FO: 'NFO',
  BSE_EQ: 'BSE',
  BSE_INDEX: 'BSE',
  BSE_FO: 'BFO',
  MCX_FO: 'MCX',
};

function codesForSegment(segment: string): {
  codes: string[];
  known: boolean;
} {
  const mapped = SEGMENT_TO_HOLIDAY_CODE[segment];
  if (mapped) {
    return { codes: [segment, mapped], known: true };
  }
  const prefix = segment.split('_')[0];
  if (prefix) {
    return { codes: [segment, prefix], known: false };
  }
  return { codes: [segment], known: false };
}

// The rule is data-driven on closed_exchanges membership, never on
// holiday_type: TRADING_HOLIDAY closes everything, SETTLEMENT_HOLIDAY
// closes only settlement segments (market still trades), and
// SPECIAL_TIMING days (e.g. budget-day sessions) stay trading days for
// exchanges absent from closed_exchanges. Verified against the live
// 2026 list (16/2/4 across the three types).
function closedDateForSegment(
  entry: unknown,
  codes: string[],
  from: string,
  to: string,
): string | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const date = record['date'];
  const closed = record['closed_exchanges'];
  if (
    typeof date !== 'string' ||
    !DATE_PATTERN.test(date) ||
    date < from ||
    date > to ||
    !Array.isArray(closed)
  ) {
    return null;
  }
  return codes.some((code) => closed.includes(code)) ? date : null;
}

export function createUpstoxHolidayProvider(
  client: MarketHolidaysClient,
  logger: Logger,
): HolidayProvider {
  return {
    async getClosedDates(from, to, instrumentKey) {
      const segment = instrumentKey.split('|')[0] ?? '';
      const { codes, known } = codesForSegment(segment);
      try {
        const body = (await client.getMarketHolidays()) as {
          data?: unknown;
        };
        const rows = Array.isArray(body?.data) ? body.data : [];
        const dates = new Set<string>();
        for (const row of rows) {
          const closed = closedDateForSegment(row, codes, from, to);
          if (closed) {
            dates.add(closed);
          }
        }
        const result: ClosedDatesResult = { dates, calendar: 'applied' };
        if (!known) {
          result.note =
            `Unknown instrument segment '${segment}'; matched by exchange ` +
            'prefix only, verify holiday coverage for this segment.';
        }
        return result;
      } catch (error) {
        logger.warn(
          'holiday_calendar_unavailable',
          'Holiday provider failed; validating against plain weekdays',
          {
            detail: error instanceof Error ? error.message : 'Unknown error',
          },
        );
        return {
          dates: new Set<string>(),
          calendar: 'unavailable',
          note: 'Holiday calendar unavailable (provider failed); validated against plain weekdays, holidays appear as gaps.',
        };
      }
    },
  };
}
