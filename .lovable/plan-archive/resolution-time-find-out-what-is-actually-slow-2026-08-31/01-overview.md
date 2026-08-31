# Resolution time: find out what is actually slow

The rising average is real, but it is not the typical ticket getting slower. Queried across finalized v3 tickets:

| Month | Closed | Median | Average | P90 | Closed > 7d | Share of total resolve time held by those |
| --- | --- | --- | --- | --- | --- | --- |
| Jun | 170 | 4.08d | 4.92d | 11.86d | 41 | 57% |
| Jul | 168 | 3.06d | 5.57d | 13.28d | 50 | 74% |
| Aug | 222 | 4.45d | 6.95d | 17.57d | 73 | 75% |

The median moved 0.4 days. P90 moved 5.7 days. Three quarters of all resolution time now sits in the ~30% of tickets that run past a week. So "each month costs an extra day on average" is a tail story, and averaging over everything is exactly what hides it.

Two more facts from the same data, June through August, long tickets (>7d) versus the rest:

- First reply averages 32.1h on long tickets versus 7.7h on the rest. Slow starts and slow finishes travel together.
- 29% of long tickets were reopened at least once, versus 16% of the rest. Intercom's `time_to_last_close` is wall clock to the *last* close, so a reopen re-clocks the whole ticket.

What the data cannot yet tell you is the thing you actually asked: **who the clock was waiting on**. Nothing in the Hub currently splits a ticket's elapsed time into "we owed a reply" versus "the customer owed a reply" versus "nobody said anything and it just sat". That is the gap this plan closes.
