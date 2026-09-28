import type {
  InstrumentSearchClient,
  InstrumentSearchParams,
  InstrumentSearchResult,
} from '../src/instruments/upstox-search';

/** Test-only stub. Production code always uses UpstoxSearchClient. */
export class FakeSearchClient implements InstrumentSearchClient {
  readonly calls: InstrumentSearchParams[] = [];

  constructor(
    private readonly result: InstrumentSearchResult = {
      data: [
        {
          instrument_key: 'NSE_FO|73985',
          trading_symbol: 'NIFTY 23500 CE 29 SEP 26',
        },
      ],
      meta: null,
    },
    private readonly error?: unknown,
  ) {}

  async search(params: InstrumentSearchParams): Promise<InstrumentSearchResult> {
    this.calls.push(params);
    if (this.error) {
      throw this.error;
    }
    return this.result;
  }
}
