import { useState } from 'react';
import {
  formatDuration,
  formatNaira,
  type Subscription,
  type SubscriptionInput,
  type SubscriptionSummary,
} from '@waifai/shared';
import {
  Async,
  Button,
  Card,
  Checkbox,
  FigureRow,
  Hero,
  Hint,
  KeyFigure,
  List,
  ListRow,
  Meter,
  ago,
  type Tone,
} from './ui.tsx';
import { Sheet } from './Sheet.tsx';
import { endpoints, humanError, useApi } from '../lib/api.ts';
import { useToast } from './Toast.tsx';
import { CalendarIcon } from './icons.tsx';

/**
 * When the line was paid for, when it started running, and the day it stops.
 *
 * The only part of this app with nothing measuring for it. The router reports
 * light and bytes and has never heard of a plan; MTN knows the answer and
 * keeps it behind a login. So the household writes the payment down once and
 * the app does the part a person should not have to: counting the days out
 * loud every time the screen is opened, rather than on the morning the
 * internet stops.
 */

const DAY = 86_400_000;

/** Under this, the countdown stops being something to watch and becomes a job. */
const RUNNING_OUT_DAYS = 3;

/** How many payments the ledger shows before the rest go behind a fold. */
const LEDGER_ROWS = 4;

export function SubscriptionCard(): React.JSX.Element {
  const state = useApi<SubscriptionSummary>('/subscriptions');
  /* `undefined` shuts the sheet, `null` opens it empty, a record opens it filled. */
  const [editing, setEditing] = useState<Subscription | null | undefined>(undefined);

  const close = (): void => setEditing(undefined);

  /*
   * A month the server carried forward is the one thing here worth changing
   * the button for. Recording a payment is the wrong offer when the month is
   * already on the screen and the only things missing from it are the receipt
   * number and somebody's word that MTN was actually paid - so the button
   * opens that record instead of an empty form.
   */
  const carried = state.data?.current?.assumed === true ? state.data.current : null;

  return (
    <>
      <Card
        title="Subscription"
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<CalendarIcon size={14} />}
            onClick={() => setEditing(carried)}
          >
            {carried === null ? 'Record payment' : 'Confirm this month'}
          </Button>
        }
      >
        <Async state={state}>
          {(data) => <Standing data={data} onPick={(s) => setEditing(s)} />}
        </Async>
      </Card>

      {/*
        Outside the Card, the way the device sheet sits outside its list: a
        fixed overlay declared inside a panel is one `transform` away from
        being positioned against that panel instead of the window.
      */}
      <Sheet
        open={editing !== undefined}
        title={
          editing === null
            ? 'Record a payment'
            : editing?.assumed === true
              ? 'Confirm this month'
              : 'Edit this payment'
        }
        onClose={close}
      >
        {editing !== undefined && (
          /* Keyed, so opening a second record replaces the fields rather than
             leaving the first one's half-typed amount in them. */
          <PaymentForm
            key={editing === null ? 'new' : editing.id}
            record={editing}
            typicalDays={state.data?.typicalDays ?? null}
            renewsByDefault={(state.data?.current ?? state.data?.previous)?.autoRenew ?? false}
            onClose={close}
            onSaved={() => {
              close();
              state.reload();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/* -- where the line stands ------------------------------------------------- */

function Standing({
  data,
  onPick,
}: {
  data: SubscriptionSummary;
  onPick: (s: Subscription) => void;
}): React.JSX.Element {
  const { current, upcoming, previous } = data;
  const shown = current ?? upcoming ?? previous;

  if (shown === null) {
    return (
      <p className="muted">
        Nothing recorded yet. Put in the last payment and this counts the days down to the one the
        line runs out on.
      </p>
    );
  }

  const waiting = current === null && upcoming !== null;
  const lapsed = current === null && upcoming === null;

  const startsInSec = upcoming === null ? 0 : Math.round((upcoming.startTs - data.now) / 1000);
  const leftSec = data.remainingSec ?? 0;

  const tone: Tone = lapsed
    ? 'bad'
    : waiting
      ? 'warn'
      : leftSec <= RUNNING_OUT_DAYS * 86_400
        ? 'warn'
        : 'accent';

  const headline = lapsed ? 'Expired' : countdown(waiting ? startsInSec : leftSec);
  const caption = lapsed
    ? `Ran out ${ago(shown.endTs)}`
    : waiting
      ? 'until this one starts'
      : shown.plan === ''
        ? 'left on this subscription'
        : `left on ${shown.plan}`;

  const head = data.history.slice(0, LEDGER_ROWS);
  const rest = data.history.slice(LEDGER_ROWS);

  return (
    <>
      <Hero value={headline} tone={tone} caption={caption} />

      {/* Only while something is actually running. A full bar under the word
          "Expired" is the same fact drawn a second time. */}
      {current !== null && data.elapsedFraction !== null && (
        <Meter fraction={data.elapsedFraction} tone={tone} />
      )}

      {/*
        The three dates, kept apart because they are three different days and
        get asked about separately: the payment is the one with a receipt
        against it, the activation is the one MTN chose, and the expiry is the
        one that decides whether there is internet tomorrow.
      */}
      <FigureRow>
        <KeyFigure label="Paid" value={dayLabel(shown.paidTs)} />
        <KeyFigure label={waiting ? 'Starts' : 'Active from'} value={dayLabel(shown.startTs)} />
        {/* No tone on this one, deliberately. The headline above is already
            amber at three days and red past the end; colouring the date as
            well is the same warning said a third time. */}
        <KeyFigure label={lapsed ? 'Expired' : 'Expires'} value={dayLabel(shown.endTs)} />
      </FigureRow>

      {current !== null && upcoming !== null && (
        <Hint>The next one is already paid for and starts {dayLabel(upcoming.startTs)}.</Hint>
      )}
      {waiting && previous !== null && (
        <Hint tone="bad">
          The last one ended {dayLabel(previous.endTs)}, leaving the line unpaid in between.
        </Hint>
      )}

      <List>
        {head.map((s) => (
          <PaymentRow key={s.id} record={s} live={s.id === current?.id} onPick={onPick} />
        ))}
      </List>

      {rest.length > 0 && (
        <details className="details">
          <summary>Earlier payments ({rest.length})</summary>
          <List>
            {rest.map((s) => (
              <PaymentRow key={s.id} record={s} live={false} onPick={onPick} />
            ))}
          </List>
        </details>
      )}
    </>
  );
}

function PaymentRow({
  record,
  live,
  onPick,
}: {
  record: Subscription;
  /** The window covering today, which is the one row worth a colour. */
  live: boolean;
  onPick: (s: Subscription) => void;
}): React.JSX.Element {
  const days = Math.max(1, Math.round((record.endTs - record.startTs) / DAY));
  const length = `${days} ${days === 1 ? 'day' : 'days'}`;
  const span = `${dayLabel(record.startTs)} - ${dayLabel(record.endTs)}`;

  return (
    <ListRow
      icon={<CalendarIcon size={16} />}
      tone={live ? 'accent' : 'neutral'}
      title={record.plan === '' ? `Paid ${dayLabel(record.paidTs)}` : record.plan}
      /*
        A ledger that cannot tell a receipt from an assumption is not a ledger,
        and this row is the only place that distinction is drawn: the button
        above offers to confirm the month, which is the same fact said once,
        for the one month it applies to.

        On the date line rather than in a badge of its own, and behind a middot
        rather than the dash the dates use, which read as a third date.
      */
      sub={record.assumed ? `${span} · carried over` : span}
      value={record.amount === null ? length : formatNaira(record.amount)}
      {...(record.amount === null ? {} : { valueSub: length })}
      onClick={() => onPick(record)}
    />
  );
}

/* -- writing one down ------------------------------------------------------ */

function PaymentForm({
  record,
  typicalDays,
  renewsByDefault,
  onClose,
  onSaved,
}: {
  /** Null when this is a new payment rather than a correction to an old one. */
  record: Subscription | null;
  typicalDays: number | null;
  /** Whether the line this is being added to renews itself already. */
  renewsByDefault: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const span = typicalDays ?? 30;
  const today = toDateInput(Date.now());

  const [plan, setPlan] = useState(record?.plan ?? '');
  const [amount, setAmount] = useState(record?.amount == null ? '' : String(record.amount));
  const [paid, setPaid] = useState(record === null ? today : toDateInput(record.paidTs));
  const [start, setStart] = useState(record === null ? today : toDateInput(record.startTs));
  const [end, setEnd] = useState(record === null ? shiftDays(today, span) : toDateInput(record.endTs));
  const [reference, setReference] = useState(record?.reference ?? '');
  const [note, setNote] = useState(record?.note ?? '');
  /* A household that renews every month renews this one too, so a new payment
     inherits the arrangement rather than asking about it again. */
  const [autoRenew, setAutoRenew] = useState(record?.autoRenew ?? renewsByDefault);

  /*
   * The usual case is one date and two taps: paid today, running from today,
   * lasting as long as the last few did. Each date stops following the one
   * above it the moment it is touched, so the arithmetic never overwrites
   * something typed on purpose - and an existing record arrives with both
   * already pinned, because every date in it was typed on purpose already.
   */
  const [startPinned, setStartPinned] = useState(record !== null);
  const [endPinned, setEndPinned] = useState(record !== null);

  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const { showToast } = useToast();

  const changePaid = (v: string): void => {
    setPaid(v);
    if (startPinned) return;
    setStart(v);
    if (!endPinned) setEnd(shiftDays(v, span));
  };

  const changeStart = (v: string): void => {
    setStartPinned(true);
    setStart(v);
    if (!endPinned) setEnd(shiftDays(v, span));
  };

  const changeEnd = (v: string): void => {
    setEndPinned(true);
    setEnd(v);
  };

  const save = async (): Promise<void> => {
    const paidTs = fromDateInput(paid);
    const startTs = fromDateInput(start);
    const endTs = fromDateInput(end);

    if (paidTs === null || startTs === null || endTs === null) {
      showToast('All three dates have to be filled in.', 'error');
      return;
    }
    if (endTs <= startTs) {
      showToast('The expiry has to come after the day it starts.', 'error');
      return;
    }

    // Typed as "25,000" or with a naira sign as often as not, and none of that
    // survives being handed to Number().
    const digits = amount.replace(/[^\d.]/g, '');

    const input: SubscriptionInput = {
      paidTs,
      startTs,
      endTs,
      plan: plan.trim(),
      amount: digits === '' ? null : Number(digits),
      reference: reference.trim() === '' ? null : reference.trim(),
      note: note.trim() === '' ? null : note.trim(),
      autoRenew,
      // Whatever this was before, somebody has now read it and pressed Save,
      // which is the entire difference between a record and an assumption.
      assumed: false,
    };

    setSaving(true);
    try {
      if (record === null) await endpoints.addSubscription(input);
      else await endpoints.updateSubscription(record.id, input);
      showToast('Saved', 'success');
      onSaved();
    } catch (err) {
      showToast(humanError(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  /*
   * Two taps, as the router restart is. Everything else this app can lose it
   * can measure again on the next poll; a receipt is the one thing in the
   * database that only ever existed because somebody typed it.
   */
  const remove = async (): Promise<void> => {
    if (record === null) return;
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 5000);
      return;
    }
    setArmed(false);
    setSaving(true);
    try {
      await endpoints.deleteSubscription(record.id);
      showToast('Payment removed', 'success');
      onSaved();
    } catch (err) {
      showToast(humanError(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-panel">
      <label className="field">
        <span>What was bought</span>
        <input
          className="input"
          value={plan}
          maxLength={64}
          placeholder="FibreX 25 Mbps"
          onChange={(e) => setPlan(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Amount</span>
        <input
          className="input"
          value={amount}
          inputMode="decimal"
          maxLength={16}
          placeholder="25,000"
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Paid on</span>
        <input
          className="input"
          type="date"
          value={paid}
          onChange={(e) => changePaid(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Active from</span>
        <input
          className="input"
          type="date"
          value={start}
          onChange={(e) => changeStart(e.target.value)}
        />
        <Hint>The day it started running, which is not always the day it was paid.</Hint>
      </label>

      <label className="field">
        <span>Expires</span>
        <input
          className="input"
          type="date"
          value={end}
          onChange={(e) => changeEnd(e.target.value)}
        />
        <Hint>The day it runs out, which is the day a renewal starts.</Hint>
      </label>

      <label className="field">
        <span>Receipt or reference</span>
        <input
          className="input"
          value={reference}
          maxLength={64}
          placeholder="What the receipt says"
          onChange={(e) => setReference(e.target.value)}
        />
      </label>

      {/*
        Under the dates, because it is a statement about them: it decides what
        the next month's dates will be, and it is the only control in this
        sheet that writes anything the household did not type.
      */}
      <Checkbox
        checked={autoRenew}
        onChange={setAutoRenew}
        label="Renew this every month"
        hint="On the day it expires, the same plan and price carry into the next month."
      />

      <label className="field">
        <span>Note</span>
        <input
          className="input"
          value={note}
          maxLength={500}
          placeholder="Anything worth remembering"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="form-actions">
        <Button variant="primary" busy={saving} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {record !== null && (
          <Button variant={armed ? 'danger' : 'ghost'} onClick={() => void remove()}>
            {armed ? 'Tap again to remove' : 'Remove'}
          </Button>
        )}
      </div>
    </div>
  );
}

/* -- dates ----------------------------------------------------------------- */

/**
 * The countdown, at the precision the answer is worth.
 *
 * Whole days for as long as there are days, because "27d 4h" invites reading
 * an hour nobody is going to act on. Inside the last two days it switches to
 * hours, which is the point at which the hour is the whole question.
 */
function countdown(sec: number): string {
  if (sec <= 0) return 'Expired';
  if (sec < 2 * 86_400) return formatDuration(sec);
  const days = Math.floor(sec / 86_400);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(
    undefined,
    thisYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

/** What a `<input type="date">` wants, in the phone's own timezone. */
function toDateInput(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * A typed day back into an instant: midnight at the top of it.
 *
 * Both ends of a window, deliberately. An expiry is the day the line stops
 * rather than the last day it works, because that is what the household means
 * by it - the day somebody goes and pays. So a month bought on the 3rd expires
 * on the 3rd, and the renewal recorded that day starts exactly where the old
 * one ended instead of a day after it.
 *
 * An expiry used to be stored as the last millisecond of the day it named. It
 * drew the same countdown, and left every window overlapping the next by a
 * day; what made the difference matter is the renewal chain, which hands the
 * next window the instant this one ends and would have walked the renewal date
 * one day further into the month every month.
 */
function fromDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

/** Add whole days to a date-input string, staying on local calendar days. */
function shiftDays(value: string, days: number): string {
  const ts = fromDateInput(value);
  if (ts === null) return value;
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return toDateInput(d.getTime());
}
