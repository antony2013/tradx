const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export type SessionResolution = {
  sessionDate: string;
  isOpen: boolean;
};

export type SessionResolver = {
  resolve(timestamp: number): SessionResolution;
};

export class IstSessionResolver implements SessionResolver {
  resolve(timestamp: number): SessionResolution {
    const sessionDate = dateFormatter.format(new Date(timestamp));
    const parts = Object.fromEntries(
      timeFormatter
        .formatToParts(new Date(timestamp))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const weekday = parts['weekday'];
    const hour = Number(parts['hour']);
    const minute = Number(parts['minute']);
    const minutes = hour * 60 + minute;
    const isOpen =
      weekday !== 'Sat' &&
      weekday !== 'Sun' &&
      minutes >= 9 * 60 &&
      minutes <= 15 * 60 + 45;

    return { sessionDate, isOpen };
  }
}
